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
  shuffle,
  traitsFor,
  typingDelays,
  uniform,
  type Rng,
  type Traits
} from '@shared/human'
import { shouldEngage, watchPlan, type TasteProfile } from '@shared/content'
import { matchesCountry } from '@shared/geo'
import { reorientQueries } from '@shared/queries'
import { NICHES, type NicheKey } from '@shared/niches'
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
  // Written as plain fields rather than constructor parameter properties:
  // the verification harnesses import this module through Node's strip-only
  // TypeScript support, which cannot transform parameter properties.
  readonly selector: string
  readonly step: string

  constructor(selector: string, step: string) {
    super(`selector not found during "${step}": ${selector}`)
    this.name = 'SelectorMiss'
    this.selector = selector
    this.step = step
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
   * Handles any account in the fleet has already followed. Ticket 12's core
   * invariant: no two managed accounts build the same follow graph.
   */
  followedTargets: Set<string>
  /** Handles belonging to the fleet itself — never follow our own accounts. */
  managedHandles: ReadonlySet<string>
  /**
   * People any account in the fleet has already sent a friend request to, and
   * groups it has already joined.
   *
   * This matters more on Facebook than the follow graph does on Instagram. A
   * shared friend between two of your own accounts is a mutual connection
   * Meta can see from both ends, and a cluster of accounts converging on the
   * same people or the same groups is the shape its classifier is built to
   * find. Keeping these disjoint is the whole point of tracking them fleet-wide.
   */
  friendedTargets: Set<string>
  joinedGroups: Set<string>
  /** Values written when a profile_mutation step runs, keyed by field. */
  profileValues?: Record<string, string>
  /**
   * Probability of commenting on an item the persona engaged with. Low by
   * design — most people overwhelmingly lurk, and an account that comments on
   * everything it likes is a pattern regardless of what the comments say.
   * Defaults to the persona's own habit.
   */
  commentRate?: number
  /** Probability of liking an engaged item. */
  likeRate?: number
  /**
   * Probability of confirming any one incoming friend request. Defaults to the
   * persona's own habit, which is never 1 — confirming everything the instant
   * it arrives is as much a pattern as confirming nothing.
   */
  acceptRate?: number
  /**
   * ISO country the account claims to live in. When set, an incoming friend
   * request is only confirmed if the requester's profile positively says they
   * are in that country — unknown and unreadable both count as no.
   */
  requireCountry?: string
  /**
   * Which round of reorientation this is, so an account searching on day 5
   * does not repeat the phrases it used on day 1. The session index is the
   * natural value.
   */
  exploreRound?: number
  /**
   * Every action the PROGRAMME declares anywhere, not just this session.
   *
   * The level is supposed to be a ceiling, and asserting that over the step
   * list is not enough: watch_videos likes as part of its own watch plan, so
   * `observe` — defined as "no writes at all" — would quietly like posts.
   * Found on a live account. When this is set, an incidental write whose
   * action the programme never declares is suppressed.
   *
   * Left undefined by fixtures, which then behave as before.
   */
  permitted?: ReadonlySet<string>
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
  author: string
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
async function readItems(page: Page, sel: SelectorSet, step: string): Promise<Item[]> {
  const f = sel.feed
  // A feed with nothing in it means the post selector is wrong, or the page is
  // not the feed at all — a checkpoint, a login wall, or a layout that never
  // rendered. Every one of those makes the rest of the session meaningless, and
  // a session that scrolls an empty page for two minutes and reports "completed"
  // is worse than one that fails: it advances the account's counter as though
  // something happened. Measured on a real account, where a wrong `post`
  // selector produced seen=0 and a completed session.
  if ((await page.locator(f.post).count()) === 0) {
    throw new SelectorMiss(`feed.post (${f.post}) matched nothing`, step)
  }
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
        // A post's identity has to survive the next session, because the
        // registry uses it to stop two accounts commenting on the same post.
        // Facebook exposes no stable id on an article, so falling back to the
        // position would make "idx-0" a permanent fleet-wide identity that
        // every account claims once and then blocks for all the others.
        // Deriving it from the content instead identifies the post by what it
        // is, which is what the registry actually means.
        // The platforms' "See translation" affordance has no stable attribute
        // to hook, so text is genuinely the only handle for it — but this runs
        // through querySelector, which is CSS only. Playwright's `text=` engine
        // does not exist in here, and passing one through threw "not a valid
        // selector" and aborted the whole session. Matched by hand instead.
        //
        // Written inline rather than as a helper on purpose: bundlers with
        // keepNames wrap named inner functions in a `__name` shim that does not
        // exist in the page.
        let translated = false
        if (s.translationPrompt) {
          if (s.translationPrompt.startsWith('text=')) {
            const wanted = s.translationPrompt.slice(5).trim().toLowerCase()
            const all = n.querySelectorAll('*')
            for (let i = 0; i < all.length && !translated; i++) {
              const t = (all[i].textContent || '').trim().toLowerCase()
              if (t && t.length < 200 && t.includes(wanted)) translated = true
            }
          } else {
            translated = !!n.querySelector(s.translationPrompt)
          }
        }

        // The author is an attribute on the post where the platform provides
        // one, and otherwise a value read off a nested element — Facebook
        // exposes it only as "Actions for this post by NAME" on a menu button.
        let author = n.getAttribute(s.authorAttribute) || ''
        if (!author && s.author) {
          const an = n.querySelector(s.author)
          if (an) {
            const raw = s.authorAttr ? an.getAttribute(s.authorAttr) : an.textContent
            author = (raw || '').trim()
            if (s.authorStrip && author.startsWith(s.authorStrip)) {
              author = author.slice(s.authorStrip.length).trim()
            }
          }
        }
        const declaredId = n.getAttribute(s.postIdAttribute)
        let derived = ''
        if (!declaredId) {
          const basis = (author + '|' + caption).slice(0, 240)
          let h = 5381
          for (let i = 0; i < basis.length; i++) h = ((h * 33) ^ basis.charCodeAt(i)) >>> 0
          derived = basis.trim() ? 'c-' + h.toString(36) : 'idx-' + index
        }

        return {
          index,
          postId: declaredId || derived,
          author,
          caption,
          hashtags: (rawTags.match(/#[\w]+/g) || []).map((t: string) => t.slice(1)),
          hasVideo: s.video ? !!n.querySelector(s.video) : false,
          hasTranslationPrompt: translated,
          comments
        }
      }),
    {
      caption: f.caption,
      hashtags: f.hashtags,
      video: f.video,
      translationPrompt: f.translationPrompt,
      commentText: f.commentText,
      postIdAttribute: f.postIdAttribute,
      authorAttribute: f.authorAttribute,
      author: f.author,
      authorAttr: f.authorAttr,
      authorStrip: f.authorStrip
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
      const items = await readItems(page, sel, step.action)
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
      const items = (await readItems(page, sel, step.action)).filter((i) => i.hasVideo)
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

        // Incidental like, gated by the programme's own ceiling: a level that
        // never declares a `like` step must not like here either.
        const mayLike = ctx.permitted ? ctx.permitted.has('like') : true
        if (plan.like && mayLike && sel.feed.likeButton && !env.likedThisSession.has(item.postId)) {
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
      const items = await readItems(page, sel, step.action)
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
      const items = await readItems(page, sel, step.action)
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
      // Submit it. Typing into the box and walking away is not a search — it
      // never loads a result page, so the recommender sees nothing.
      await sleep(uniform(300, 1100, rng) * traits.tempo)
      await page.keyboard.press('Enter')
      await page.waitForLoadState('domcontentloaded').catch(() => undefined)
      // A pause reading the results before doing anything with them.
      await sleep(dwellMs(traits, mood, rng))
      return { action: step.action, seen: 0, engaged: 0, detail: `searched "${query}"` }
    }

    case 'explore': {
      // Reorients an account whose feed is in the wrong language or country.
      //
      // Consumption is what a recommender learns from, so this searches and
      // then WATCHES what comes back. It engages with nothing — no likes, no
      // follows, no comments — because the point is to change what the feed
      // offers, not to act on it.
      const search = sel.search
      if (!search) throw new SelectorMiss('search', 'explore')
      if (!search.resultItem) throw new SelectorMiss('search.resultItem', 'explore')

      const want = countFor(step.count ?? [2, 4], mood, rng)
      const queries = step.query
        ? [step.query]
        : reorientQueries(
            (ctx.niche in NICHES ? ctx.niche : 'home-fitness') as NicheKey,
            ctx.accountId,
            ctx.exploreRound ?? 0,
            want
          )

      let searched = 0
      let opened = 0
      for (const query of queries.slice(0, want)) {
        await page.goto(search.url, { waitUntil: 'domcontentloaded' })
        await sleep(uniform(1200, 3400, rng) * traits.tempo)

        const input = page.locator(search.input)
        if ((await input.count()) === 0) throw new SelectorMiss(search.input, 'explore')
        await input.first().click()

        const delays = typingDelays(query, traits, rng)
        for (const [i, ch] of [...query].entries()) {
          await page.keyboard.type(ch)
          await sleep(delays[i])
        }
        await sleep(uniform(300, 1200, rng) * traits.tempo)
        await page.keyboard.press('Enter')
        await page.waitForLoadState('domcontentloaded').catch(() => undefined)
        await sleep(uniform(1800, 4200, rng) * traits.tempo)
        searched++

        // Narrowing to video where the platform offers it, since watch time is
        // the heaviest signal these recommenders carry.
        if (search.videoTab) {
          const tab = page.locator(search.videoTab)
          if ((await tab.count()) > 0) {
            await tab.first().click({ timeout: 8000 }).catch(() => undefined)
            await sleep(uniform(1500, 3500, rng) * traits.tempo)
          }
        }

        const results = page.locator(search.resultItem)
        const found = await results.count()
        if (found === 0) continue

        // One or two results per query, opened and actually watched. Reading a
        // results page without opening anything is a much weaker signal than
        // dwelling on what it returned.
        const opens = Math.min(found, int(1, 2, rng))
        for (let i = 0; i < opens; i++) {
          const pick = int(0, Math.min(found, 8) - 1, rng)
          const target = results.nth(pick)
          if ((await target.count()) === 0) continue
          await target.click({ timeout: 10_000 }).catch(() => undefined)
          await page.waitForLoadState('domcontentloaded').catch(() => undefined)
          // Long enough to count as watched rather than bounced.
          await sleep(uniform(9000, 26_000, rng) * traits.tempo * mood)
          opened++
          await page.goBack().catch(() => undefined)
          await page.waitForLoadState('domcontentloaded').catch(() => undefined)
          await sleep(uniform(1200, 3000, rng) * traits.tempo)
        }
      }

      return {
        action: step.action,
        seen: searched,
        engaged: opened,
        detail: `searched ${searched} (${queries.slice(0, want).join(', ')}), watched ${opened}`
      }
    }

    case 'story_views': {
      if (!sel.stories) throw new SelectorMiss('stories', 'story_views')
      const want = countFor(step.count ?? [10, 15], mood, rng)
      const tray = page.locator(sel.stories.trayItem)
      if ((await tray.count()) === 0) throw new SelectorMiss(sel.stories.trayItem, 'story_views')

      await tray.first().click()
      let viewed = 0
      for (; viewed < want; viewed++) {
        // Stories are short and skimmed far faster than feed posts.
        await sleep(dwellMs(traits, mood, rng) * uniform(0.25, 0.7, rng))
        const next = page.locator(sel.stories.next)
        if ((await next.count()) === 0) break
        await next.first().click()
      }
      const close = page.locator(sel.stories.close)
      if ((await close.count()) > 0) await close.first().click()
      return { action: step.action, seen: viewed, engaged: viewed, detail: `viewed ${viewed} stories` }
    }

    case 'follow': {
      if (!sel.feed.followButton) throw new SelectorMiss('feed.followButton', 'follow')
      const want = countFor(step.count ?? [4, 8], mood, rng)
      const items = await readItems(page, sel, step.action)
      env.harvest(items)
      let followed = 0
      let skipped = 0

      // Shuffled, so two accounts never traverse the same candidate list in the
      // same order even when their feeds overlap.
      for (const item of shuffle(items, rng)) {
        if (followed >= want) break
        const handle = item.author
        if (!handle) continue
        // Never follow our own accounts, and never a target the fleet already
        // holds. Both are ticket 12 invariants and both are checked here rather
        // than hoped for.
        if (ctx.managedHandles.has(handle) || ctx.followedTargets.has(handle)) {
          skipped++
          continue
        }
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
        await clickIn(page, sel.feed.post, item.index, sel.feed.followButton, 'follow', rng)
        ctx.followedTargets.add(handle)
        followed++
        // Follows are the most rate-sensitive action in warmup. Leave real gaps
        // rather than firing a burst.
        await sleep(uniform(4000, 14_000, rng) * traits.tempo * mood)
      }
      return {
        action: step.action,
        seen: items.length,
        engaged: followed,
        detail: `followed ${followed}${skipped ? `, skipped ${skipped} already in the fleet graph` : ''}`
      }
    }

    case 'accept_friend': {
      const people = sel.people
      if (!people) throw new SelectorMiss('people', 'accept_friend')
      const want = countFor(step.count ?? [1, 2], mood, rng)

      await page.goto(people.url, { waitUntil: 'domcontentloaded' })
      await sleep(uniform(1500, 4000, rng) * traits.tempo)

      // The container has to be there; the cards do not. An account nobody has
      // friended has an empty list every session, and that is the normal state
      // rather than a broken selector. Checking the container separately is
      // what keeps "empty" and "broken" distinguishable.
      if ((await page.locator(people.container).count()) === 0) {
        throw new SelectorMiss('people.container', 'accept_friend')
      }

      const cards = page.locator(people.card)
      const total = await cards.count()
      if (total === 0) {
        return {
          action: step.action,
          seen: 0,
          engaged: 0,
          detail: 'no pending requests'
        }
      }

      // Read identities up front: accepting re-renders the list, so indices
      // taken during the loop drift.
      const ids: string[] = []
      for (let i = 0; i < total; i++) {
        const id =
          (await cards.nth(i).getAttribute(people.idAttribute)) ??
          (people.name ? await cards.nth(i).locator(people.name).textContent() : null)
        ids.push((id ?? '').trim())
      }

      // Seeded per account, so one persona clears its requests and another sits
      // on them for days. Accepting everything the moment it arrives is as much
      // a pattern as accepting nothing.
      const rate = ctx.acceptRate ?? acceptHabitFor(ctx.accountId)

      let accepted = 0
      let ignored = 0
      let skipped = 0
      let foreign = 0
      let unreadable = 0
      for (const index of shuffle([...ids.keys()], rng)) {
        if (accepted >= want) break
        const id = ids[index]
        if (!id) continue
        // Never accept one of our own accounts. Two managed identities becoming
        // friends is a mutual connection visible from both ends — the single
        // clearest way to tie a fleet together.
        if (ctx.managedHandles.has(id)) {
          skipped++
          continue
        }
        if (ctx.friendedTargets.has(id)) {
          skipped++
          continue
        }
        // Left pending, not declined. Ignoring a request is the most common
        // thing people do with one, and it costs the account nothing.
        if (rng() > rate) {
          ignored++
          continue
        }

        // Only confirm people from the country this account claims to live in.
        //
        // The request card carries no country, so the profile has to be opened
        // to read one — which is also what a person does before confirming a
        // stranger. FAIL CLOSED: a location that cannot be read, or cannot be
        // positively identified, is not a match. An account that confirms
        // whoever happens to ask builds a friend graph that looks nothing like
        // the place its IP says it lives.
        if (ctx.requireCountry) {
          if (!people.profileLink || !people.profileLocation) {
            unreadable++
            continue
          }
          const link = cards.nth(index).locator(people.profileLink)
          if ((await link.count()) === 0) {
            unreadable++
            continue
          }

          await sleep(dwellMs(traits, mood, rng))
          await link.first().click({ timeout: 10_000 })
          await page.waitForLoadState('domcontentloaded').catch(() => undefined)
          await sleep(uniform(1200, 3800, rng) * traits.tempo)

          const where = page.locator(people.profileLocation)
          const text = (await where.count()) > 0 ? await where.first().textContent() : null

          // Read it, look around a moment, then come back to the list.
          await sleep(dwellMs(traits, mood, rng))
          await page.goBack().catch(() => undefined)
          await page.waitForLoadState('domcontentloaded').catch(() => undefined)
          await sleep(uniform(900, 2600, rng) * traits.tempo)

          if (!text) {
            unreadable++
            continue
          }
          if (!matchesCountry(text, ctx.requireCountry)) {
            foreign++
            continue
          }
        }

        const button = cards.nth(index).locator(people.acceptButton)
        if ((await button.count()) === 0) continue

        // Look at who this is before confirming, the way a person would.
        await sleep(dwellMs(traits, mood, rng))
        await button.first().click({ timeout: 10_000 })
        ctx.friendedTargets.add(id)
        accepted++
        await sleep(uniform(3000, 11_000, rng) * traits.tempo * mood)
      }

      const notes = [
        ignored ? `left ${ignored} pending` : '',
        foreign ? `passed over ${foreign} outside ${ctx.requireCountry}` : '',
        unreadable ? `passed over ${unreadable} with no readable location` : '',
        skipped ? `skipped ${skipped} already in the fleet graph` : ''
      ].filter(Boolean)
      return {
        action: step.action,
        seen: total,
        engaged: accepted,
        detail: `accepted ${accepted}${notes.length ? `, ${notes.join(', ')}` : ''}`
      }
    }

    case 'join_group': {
      const groups = sel.groups
      if (!groups) throw new SelectorMiss('groups', 'join_group')
      // Deliberately tiny. Practitioner reporting puts a group/page join ceiling
      // around 25/day with a two-week block behind it, and there is no reason
      // for a warming account to go anywhere near that.
      const want = countFor(step.count ?? [1, 2], mood, rng)

      await page.goto(groups.url, { waitUntil: 'domcontentloaded' })
      await sleep(uniform(1500, 4000, rng) * traits.tempo)

      const cards = page.locator(groups.card)
      const total = await cards.count()
      if (total === 0) throw new SelectorMiss('groups.card', 'join_group')

      const ids: string[] = []
      for (let i = 0; i < total; i++) {
        const id =
          (await cards.nth(i).getAttribute(groups.idAttribute)) ??
          (groups.name ? await cards.nth(i).locator(groups.name).textContent() : null)
        ids.push((id ?? '').trim())
      }

      let joined = 0
      let skipped = 0
      for (const index of shuffle([...ids.keys()], rng)) {
        if (joined >= want) break
        const id = ids[index]
        if (!id) continue
        // Two of your accounts in the same niche group is a co-membership Meta
        // can see directly.
        if (ctx.joinedGroups.has(id)) {
          skipped++
          continue
        }

        const button = cards.nth(index).locator(groups.joinButton)
        if ((await button.count()) === 0) continue

        await sleep(dwellMs(traits, mood, rng))
        await button.first().click({ timeout: 10_000 })
        ctx.joinedGroups.add(id)
        joined++
        await sleep(uniform(10_000, 30_000, rng) * traits.tempo * mood)
      }

      return {
        action: step.action,
        seen: total,
        engaged: joined,
        detail: `joined ${joined}${skipped ? `, skipped ${skipped} the fleet is already in` : ''}`
      }
    }

    case 'visit_profiles': {
      if (!sel.feed.authorLink) throw new SelectorMiss('feed.authorLink', 'visit_profiles')
      const want = countFor(step.count ?? [2, 5], mood, rng)
      const items = await readItems(page, sel, step.action)
      let visited = 0

      for (const item of shuffle(items, rng)) {
        if (visited >= want) break
        const link = page.locator(sel.feed.post).nth(item.index).locator(sel.feed.authorLink)
        if ((await link.count()) === 0) continue
        await clickIn(page, sel.feed.post, item.index, sel.feed.authorLink, 'visit_profiles', rng)
        // Look around, then come back. The visit is the point, not the target.
        await sleep(dwellMs(traits, mood, rng) * uniform(1.2, 3, rng))
        await page.goBack().catch(() => undefined)
        await sleep(uniform(800, 2600, rng) * traits.tempo)
        visited++
      }
      return { action: step.action, seen: items.length, engaged: visited, detail: `visited ${visited}` }
    }

    case 'profile_mutation': {
      const pe = sel.profileEdit
      if (!pe) throw new SelectorMiss('profileEdit', 'profile_mutation')
      const field = step.field
      if (!field) throw new Error('profile_mutation step declares no field')
      const fieldSel = pe.fields[field]
      if (!fieldSel) throw new SelectorMiss(`profileEdit.fields.${field}`, 'profile_mutation')

      const value = ctx.profileValues?.[field]
      // Refuse rather than write a placeholder. The profile is the account's
      // identity; inventing one is worse than not changing it at all.
      if (!value) throw new Error(`no value supplied for profile field "${field}"`)

      if (pe.url && pe.url !== 'fixture') await page.goto(pe.url)
      const input = page.locator(fieldSel)
      if ((await input.count()) === 0) throw new SelectorMiss(fieldSel, 'profile_mutation')

      await input.first().click()
      await input.first().fill('')
      const delays = typingDelays(value, traits, rng)
      for (const [i, ch] of [...value].entries()) {
        await page.keyboard.type(ch)
        await sleep(delays[i])
      }
      // A beat before committing, as someone re-reading what they typed.
      await sleep(dwellMs(traits, mood, rng))
      const save = page.locator(pe.save)
      if ((await save.count()) === 0) throw new SelectorMiss(pe.save, 'profile_mutation')
      await save.first().click()
      await sleep(uniform(1200, 3500, rng))

      return { action: step.action, seen: 1, engaged: 1, detail: `set ${field}` }
    }

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

/**
 * How readily this account confirms an incoming friend request, seeded per
 * account so one persona clears its list and another sits on it for days.
 *
 * Never 1. An account that confirms every request the moment it appears is as
 * much a pattern as one that never does, and leaving some pending is both the
 * commonest real behaviour and free.
 */
export function acceptHabitFor(accountId: string): number {
  const rng = makeRng(`accept:${accountId}`)
  return uniform(0.25, 0.75, rng)
}

/** Steps the runner can currently execute end-to-end. */
export const IMPLEMENTED_STEPS = [
  'idle',
  'feed_scroll',
  'watch_videos',
  'like',
  'comment',
  'search',
  'story_views',
  'follow',
  'visit_profiles',
  'profile_mutation'
] as const
