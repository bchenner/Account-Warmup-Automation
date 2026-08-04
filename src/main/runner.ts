import type { Page } from 'patchright'
import {
  chance,
  countFor,
  dwellMs,
  int,
  liveRng,
  makeRng,
  mousePath,
  scrollPlan,
  sessionMood,
  traitsFor,
  typingDelays,
  uniform,
  type Rng,
  type Traits
} from '@shared/human'
import { shouldEngage, watchPlan, type TasteProfile } from '@shared/content'
import { decorate, type EmojiHabit } from '@shared/emoji'
import {
  assessComment,
  pickComment,
  shouldComment,
  type HarvestedComment
} from '@shared/comments'
import type { PlannedSession, Step } from '@shared/session'
import type { SelectorSet } from '@shared/selectors'

/**
 * Executes one planned session against a live page.
 *
 * Two rules run through everything here:
 *
 *  - **Fail loudly.** With no AI there is no fallback when a selector breaks,
 *    so a miss aborts the session and reports which selector failed. Never
 *    continue, never approximate — a silent partial session leaves the
 *    account's real state diverged from what the counter believes, which is
 *    worse than no session at all.
 *  - **Nothing is a literal.** Every count, delay and distance is sampled from
 *    a range, through the account's own traits. A session that always does
 *    exactly twelve story views is a signature.
 */

export class SelectorMiss extends Error {
  constructor(
    readonly selector: string,
    readonly step: string
  ) {
    super(`selector not found during "${step}": ${selector}`)
    this.name = 'SelectorMiss'
  }
}

export type RunnerContext = {
  accountId: string
  taste: TasteProfile
  emoji: EmojiHabit
  niche: string
  selectors: SelectorSet
  /** Search terms drawn from when a step declares no explicit query. */
  searchTerms: readonly string[]
  /** Growing corpus of harvested comments, fleet-wide. */
  corpus: HarvestedComment[]
  /** Comment texts already posted by any account. */
  usedComments: readonly string[]
  /** Fingerprints of harvested originals already spent. */
  usedSources: Set<string>
  /** Posts another managed account already commented on. */
  claimedPosts: Set<string>
  /**
   * Probability of commenting on an item the persona engaged with. Low by
   * design — most people overwhelmingly lurk, and an account that comments on
   * everything it likes is a pattern regardless of what the comments say.
   * Defaults to the persona's own habit.
   */
  commentRate?: number
  /** Probability of liking an engaged item. */
  likeRate?: number
  rng?: Rng
}

export type StepReport = {
  action: string
  seen: number
  engaged: number
  detail: string
}

export type SessionReport = {
  completed: boolean
  steps: StepReport[]
  harvested: number
  /** Present only when the session aborted. */
  abortedAt?: string
  error?: string
}

type Item = {
  index: number
  postId: string
  caption: string
  hashtags: string[]
  hasVideo: boolean
  hasTranslationPrompt: boolean
  comments: string[]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Read the visible feed items in one pass, so the DOM is queried once.
 *
 * The page-side callback deliberately contains no named inner functions.
 * Bundlers with `keepNames` enabled (esbuild, and therefore tsx) wrap named
 * declarations in a `__name` helper — which does not exist inside the browser,
 * so the evaluate throws `__name is not defined` at runtime and nowhere else.
 */
async function readItems(page: Page, sel: SelectorSet): Promise<Item[]> {
  const f = sel.feed
  return page.$$eval(
    f.post,
    (nodes, s) =>
      nodes.map((n, index) => {
        const capNode = s.caption ? n.querySelector(s.caption) : null
        const caption = ((capNode && capNode.textContent) || '').trim()
        const tagNode = s.hashtags ? n.querySelector(s.hashtags) : null
        const rawTags = s.hashtags ? ((tagNode && tagNode.textContent) || '').trim() : caption
        const comments: string[] = []
        if (s.commentText) {
          const found = n.querySelectorAll(s.commentText)
          for (let i = 0; i < found.length; i++) {
            comments.push((found[i].textContent || '').trim())
          }
        }
        return {
          index,
          postId: n.getAttribute(s.postIdAttribute) || 'idx-' + index,
          caption,
          hashtags: (rawTags.match(/#[\w]+/g) || []).map((t: string) => t.slice(1)),
          hasVideo: s.video ? !!n.querySelector(s.video) : false,
          hasTranslationPrompt: s.translationPrompt ? !!n.querySelector(s.translationPrompt) : false,
          comments
        }
      }),
    {
      caption: f.caption,
      hashtags: f.hashtags,
      video: f.video,
      translationPrompt: f.translationPrompt,
      commentText: f.commentText,
      postIdAttribute: f.postIdAttribute
    }
  )
}

/** Move the pointer along a curved path before acting on something. */
async function moveTo(page: Page, x: number, y: number, from: { x: number; y: number }, rng: Rng) {
  for (const p of mousePath(from, { x, y }, rng)) {
    await page.mouse.move(p.x, p.y)
    await sleep(uniform(4, 16, rng))
  }
}

async function clickIn(
  page: Page,
  postSelector: string,
  index: number,
  within: string,
  step: string,
  rng: Rng
): Promise<void> {
  const target = page.locator(postSelector).nth(index).locator(within)
  if ((await target.count()) === 0) throw new SelectorMiss(within, step)
  const box = await target.first().boundingBox()
  if (!box) throw new SelectorMiss(`${within} (not visible)`, step)
  await moveTo(
    page,
    box.x + box.width / 2 + uniform(-4, 4, rng),
    box.y + box.height / 2 + uniform(-3, 3, rng),
    { x: box.x - uniform(60, 240, rng), y: box.y - uniform(40, 180, rng) },
    rng
  )
  await target.first().click()
}

export async function runSession(
  page: Page,
  session: PlannedSession,
  ctx: RunnerContext
): Promise<SessionReport> {
  const rng = ctx.rng ?? liveRng
  const traits = traitsFor(ctx.accountId)
  const mood = sessionMood(ctx.accountId, session.index)
  const steps: StepReport[] = []
  let harvested = 0
  // Posts already liked in THIS session. On these platforms a second click on
  // an already-liked post un-likes it, so watch_videos and like must not both
  // act on the same item.
  const likedThisSession = new Set<string>()

  const harvest = (items: Item[]): void => {
    for (const item of items) {
      for (const text of item.comments) {
        if (assessComment(text) !== 'ok') continue
        if (ctx.corpus.some((c) => c.text === text)) continue
        ctx.corpus.push({
          text,
          sourcePostId: item.postId,
          platform: ctx.selectors.platform,
          harvestedAt: new Date().toISOString()
        })
        harvested++
      }
    }
  }

  try {
    for (const step of session.steps) {
      steps.push(await runStep(page, step, { ctx, traits, mood, rng, harvest, likedThisSession }))
      // A beat between steps — nobody moves straight from one activity to the next.
      await sleep(uniform(900, 4200, rng) * traits.tempo * mood)
    }
    return { completed: true, steps, harvested }
  } catch (err) {
    return {
      completed: false,
      steps,
      harvested,
      abortedAt: err instanceof SelectorMiss ? err.step : 'unknown',
      error: (err as Error).message
    }
  }
}

type StepEnv = {
  ctx: RunnerContext
  traits: Traits
  mood: number
  rng: Rng
  harvest: (items: Item[]) => void
  likedThisSession: Set<string>
}

async function runStep(page: Page, step: Step, env: StepEnv): Promise<StepReport> {
  const { ctx, traits, mood, rng } = env
  const sel = ctx.selectors

  switch (step.action) {
    case 'idle': {
      const ms = uniform(...(step.seconds ?? [20, 60]), rng) * 1000 * traits.tempo
      await sleep(ms)
      return { action: step.action, seen: 0, engaged: 0, detail: `idled ${Math.round(ms / 1000)}s` }
    }

    case 'feed_scroll': {
      const budgetMs = uniform(...(step.seconds ?? [60, 180]), rng) * 1000
      const started = Date.now()
      let bursts = 0
      // A plan long enough to outlast the budget; the clock stops it, not the plan.
      for (const s of scrollPlan(traits, mood, 40_000, rng)) {
        if (Date.now() - started > budgetMs) break
        await page.mouse.wheel(0, s.deltaY)
        await sleep(s.pauseMs)
        bursts++
      }
      const items = await readItems(page, sel)
      env.harvest(items)
      return {
        action: step.action,
        seen: items.length,
        engaged: 0,
        detail: `${bursts} scroll bursts over ${Math.round((Date.now() - started) / 1000)}s`
      }
    }

    case 'watch_videos': {
      const want = countFor(step.count ?? [3, 8], mood, rng)
      const items = (await readItems(page, sel)).filter((i) => i.hasVideo)
      env.harvest(items)
      let watched = 0
      let liked = 0

      for (const item of items) {
        if (watched >= want) break
        const plan = watchPlan(
          {
            caption: item.caption,
            hashtags: item.hashtags,
            hasTranslationPrompt: item.hasTranslationPrompt
          },
          ctx.taste,
          { likeRate: ctx.likeRate ?? 0.25 },
          rng
        )

        // Even a skipped video is looked at briefly — the scroll passes over it.
        const base = dwellMs(traits, mood, rng)
        await sleep(base * (0.4 + plan.fraction * 1.6))
        watched++

        if (plan.like && sel.feed.likeButton && !env.likedThisSession.has(item.postId)) {
          await clickIn(page, sel.feed.post, item.index, sel.feed.likeButton, 'watch_videos', rng)
          env.likedThisSession.add(item.postId)
          liked++
          await sleep(uniform(500, 2200, rng))
        }
      }
      return {
        action: step.action,
        seen: items.length,
        engaged: liked,
        detail: `watched ${watched}, liked ${liked}`
      }
    }

    case 'like': {
      if (!sel.feed.likeButton) throw new SelectorMiss('feed.likeButton', 'like')
      const want = countFor(step.count ?? [2, 6], mood, rng)
      const items = await readItems(page, sel)
      env.harvest(items)
      let liked = 0

      for (const item of items) {
        if (liked >= want) break
        if (env.likedThisSession.has(item.postId)) continue
        const verdict = shouldEngage(
          {
            caption: item.caption,
            hashtags: item.hashtags,
            hasTranslationPrompt: item.hasTranslationPrompt
          },
          ctx.taste,
          rng
        )
        if (!verdict.engage) continue
        await sleep(dwellMs(traits, mood, rng))
        await clickIn(page, sel.feed.post, item.index, sel.feed.likeButton, 'like', rng)
        env.likedThisSession.add(item.postId)
        liked++
        await sleep(uniform(700, 3000, rng) * traits.tempo)
      }
      return { action: step.action, seen: items.length, engaged: liked, detail: `liked ${liked}` }
    }

    case 'comment': {
      const box = sel.feed.commentInput
      if (!box) throw new SelectorMiss('feed.commentInput', 'comment')
      const want = countFor(step.count ?? [1, 2], mood, rng)
      const items = await readItems(page, sel)
      env.harvest(items)
      let posted = 0

      for (const item of items) {
        if (posted >= want) break
        if (!shouldComment(ctx.commentRate ?? commentHabitFor(ctx.accountId), rng)) continue
        const verdict = shouldEngage(
          {
            caption: item.caption,
            hashtags: item.hashtags,
            hasTranslationPrompt: item.hasTranslationPrompt
          },
          ctx.taste,
          rng
        )
        if (!verdict.engage) continue

        const picked = pickComment(
          ctx.corpus,
          {
            targetPostId: item.postId,
            usedTexts: ctx.usedComments,
            usedSourceFingerprints: ctx.usedSources,
            claimedPostIds: ctx.claimedPosts
          },
          rng
        )
        // Nothing safe to say is a normal outcome, and it must stay silent
        // rather than fall back to something generic.
        if (!picked) continue

        const text = decorate(picked.text, ctx.emoji, rng, { niche: ctx.niche })
        const field = page.locator(sel.feed.post).nth(item.index).locator(box)
        if ((await field.count()) === 0) throw new SelectorMiss(box, 'comment')

        await field.first().click()
        for (const [i, ch] of [...text].entries()) {
          await page.keyboard.type(ch)
          await sleep(typingDelays(text, traits, rng)[i])
        }
        await page.keyboard.press('Enter')

        ctx.usedSources.add(picked.sourceFingerprint)
        ctx.claimedPosts.add(item.postId)
        ;(ctx.usedComments as string[]).push(text)
        posted++
        await sleep(uniform(2000, 6000, rng) * traits.tempo)
      }
      return { action: step.action, seen: items.length, engaged: posted, detail: `posted ${posted}` }
    }

    case 'search': {
      if (!sel.search) throw new SelectorMiss('search', 'search')
      const query =
        step.query ?? ctx.searchTerms[Math.floor(rng() * Math.max(1, ctx.searchTerms.length))] ?? ''
      if (!query) return { action: step.action, seen: 0, engaged: 0, detail: 'no search term' }

      const input = page.locator(sel.search.input)
      if ((await input.count()) === 0) throw new SelectorMiss(sel.search.input, 'search')
      await input.first().click()

      const delays = typingDelays(query, traits, rng)
      for (const [i, ch] of [...query].entries()) {
        await page.keyboard.type(ch)
        await sleep(delays[i])
      }
      // A pause reading the results before doing anything with them.
      await sleep(dwellMs(traits, mood, rng))
      return { action: step.action, seen: 0, engaged: 0, detail: `searched "${query}"` }
    }

    // Not yet implemented. Aborting is deliberate: a step that silently does
    // nothing would advance the session counter while the account's real state
    // stands still, which is exactly the divergence the design forbids.
    case 'story_views':
    case 'follow':
    case 'visit_profiles':
    case 'profile_mutation':
      throw new Error(`step "${step.action}" is not implemented yet`)

    default:
      throw new Error(`unknown step action: ${String(step.action)}`)
  }
}

/**
 * How talkative an account is, stable for its life. Ranges from an account
 * that essentially never comments to one that comments on roughly a fifth of
 * what it engages with — nobody comments on everything.
 */
export function commentHabitFor(accountId: string): number {
  const rng = makeRng(`comment:${accountId}`)
  return chance(0.25, rng) ? 0 : uniform(0.05, 0.22, rng)
}

/** Steps the runner can currently execute end-to-end. */
export const IMPLEMENTED_STEPS = [
  'idle',
  'feed_scroll',
  'watch_videos',
  'like',
  'comment',
  'search'
] as const
