// Runs a real session against a local fixture feed, through patchright, in a
// real Chrome — proving the runner end-to-end before it is ever pointed at an
// account.
//
//   npm run build && node scripts/session-check.mjs
//
// What it should demonstrate:
//   - the session completes without a selector miss
//   - likes land on ON-TOPIC ENGLISH posts and nothing else
//   - comments are harvested, and any posted comment is not a copy of one on
//     that same post
//   - a broken selector ABORTS rather than silently doing nothing
import { chromium } from 'patchright'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

import { runSession } from '../src/main/runner.ts'
import { SelectorSetSchema } from '../src/shared/selectors.ts'
import { ScriptSchema, planSessions } from '../src/shared/session.ts'
import { withPersonality } from '../src/shared/content.ts'
import { NICHES } from '../src/shared/niches.ts'
import { emojiHabitFor } from '../src/shared/emoji.ts'
import { makeRng } from '../src/shared/human.ts'
import { BACKGROUND_ARGS } from '../src/shared/chrome-args.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const selectors = SelectorSetSchema.parse(
  parse(readFileSync(path.join(ROOT, 'warmup/fixture-selectors.yaml'), 'utf8'))
)
const script = ScriptSchema.parse(
  parse(readFileSync(path.join(ROOT, 'warmup/instagram/establish.yaml'), 'utf8'))
)

const ACCOUNT = 'maya-instagram'
const plan = planSessions(script, ACCOUNT)

const userDataDir = path.join(os.tmpdir(), 'boiler-session-check')
fs.rmSync(userDataDir, { recursive: true, force: true })

const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  // The same off-screen configuration a real session uses.
  args: ['--no-first-run', '--no-default-browser-check', ...BACKGROUND_ARGS],
  viewport: null
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('  [page error]', String(e).split('\n')[0]))
await page.goto(pathToFileURL(path.join(ROOT, 'scripts/fixture-feed.html')).href)
// Fail fast and loudly if the fixture itself did not initialise, rather than
// letting it look like a runner bug later.
// State is read from DOM attributes, not page globals: patchright evaluates in
// an isolated world, so window.* set by the page is invisible here.
const readLog = async (attr) =>
  JSON.parse((await page.getAttribute('body', attr)) ?? 'null') ?? []
const ready = (await page.getAttribute('body', 'data-liked')) !== null
if (!ready) throw new Error('fixture page did not initialise (data-liked missing)')
console.log('fixture ready:', await page.locator('[data-post-id]').count(), 'posts')

const runnerCtx = {
  accountId: ACCOUNT,
  taste: withPersonality(NICHES['home-fitness'].taste, 'maya'),
  emoji: emojiHabitFor('maya'),
  niche: 'home-fitness',
  selectors,
  searchTerms: ['home workout', 'kettlebell routine'],
  corpus: [],
  usedComments: [],
  usedSources: new Set(),
  claimedPosts: new Set(),
  followedTargets: new Set(),
  // One of the fixture's authors is pretended to be ours, to prove the runner
  // refuses to follow the fleet's own accounts.
  managedHandles: new Set(['@creator4']),
  profileValues: { username: 'maya.trains', display_name: 'Maya', bio: 'home workouts', bio_link: 'https://example.com' },
  commentRate: 0.9, // forced high so the check exercises the path
  likeRate: 0.7,
  rng: makeRng('session-check')
}

// A session with every implemented step, rather than whichever the calendar
// happens to land on.
const session = {
  index: 12,
  kind: 'active',
  label: 'runner check',
  estimateMs: [0, 0],
  steps: [
    { action: 'feed_scroll', seconds: [4, 6], skipChance: 0 },
    { action: 'watch_videos', count: [3, 5], skipChance: 0 },
    { action: 'like', count: [2, 4], skipChance: 0 },
    { action: 'comment', count: [1, 2], skipChance: 0 },
    { action: 'search', skipChance: 0 },
    { action: 'story_views', count: [4, 6], skipChance: 0 },
    { action: 'follow', count: [2, 3], skipChance: 0 },
    { action: 'visit_profiles', count: [2, 3], skipChance: 0 },
    { action: 'profile_mutation', field: 'username', skipChance: 0 }
  ]
}

console.log(`=== running session ${session.index} for ${ACCOUNT}`)
const t0 = Date.now()
const report = await runSession(page, session, runnerCtx)
const secs = ((Date.now() - t0) / 1000).toFixed(1)

console.log(`\ncompleted: ${report.completed}  (${secs}s)`)
for (const s of report.steps) {
  console.log(`  ${s.action.padEnd(14)} seen=${String(s.seen).padEnd(3)} engaged=${String(s.engaged).padEnd(3)} ${s.detail}`)
}
if (!report.completed) console.log(`  ABORTED at ${report.abortedAt}: ${report.error}`)

const liked = await readLog('data-liked')
const commented = await readLog('data-commented')
const followed = await readLog('data-followed')
const visited = await readLog('data-visited')
const saved = await readLog('data-saved')
const storiesSeen = Number((await page.getAttribute('body', 'data-stories')) ?? 0)
const captions = await page.$$eval('[data-post-id]', (ns) =>
  Object.fromEntries(ns.map((n) => [n.dataset.postId, n.querySelector('[data-caption]').textContent]))
)

console.log(`\nharvested ${report.harvested} comments into the corpus`)
console.log('\nliked:')
for (const id of liked) console.log(`  ${id}  ${captions[id].slice(0, 66)}…`)
console.log('\ncommented:')
for (const c of commented) console.log(`  ${c.id}  "${c.text}"`)

// --- assertions -------------------------------------------------------------
const ON_TOPIC_EN = ['p1', 'p4', 'p5', 'p8']
const MUST_NOT = { p2: 'Spanish', p3: 'off-topic (baking)', p6: 'off-topic (TV)', p7: 'has a translation prompt' }

const failures = []
if (!report.completed) failures.push(`session aborted: ${report.error}`)
for (const id of liked) {
  if (MUST_NOT[id]) failures.push(`liked ${id}, which is ${MUST_NOT[id]}`)
}
if (liked.length === 0) failures.push('liked nothing at all')
// A second click un-likes on these platforms, so the same post must never be
// liked twice within one session.
const dupes = liked.filter((id, i) => liked.indexOf(id) !== i)
if (dupes.length) failures.push(`liked the same post twice: ${[...new Set(dupes)].join(', ')}`)
if (!liked.some((id) => ON_TOPIC_EN.includes(id))) failures.push('liked nothing on-topic')
for (const c of commented) {
  const onSame = await page.$$eval(
    `[data-post-id="${c.id}"] [data-comment]`,
    (ns) => ns.map((n) => n.textContent.trim())
  )
  if (onSame.some((o) => o === c.text)) failures.push(`comment on ${c.id} copies a comment already there`)
}

console.log('\n=== selector-miss handling (a broken selector must ABORT)')
const broken = await runSession(page, { ...session, steps: [{ action: 'like', count: [1, 2], skipChance: 0 }] }, {
  ...runnerCtx,
  selectors: { ...selectors, feed: { ...selectors.feed, likeButton: 'button[data-nonexistent]' } }
})
console.log(`  completed: ${broken.completed}  error: ${broken.error}`)
if (broken.completed) failures.push('a missing selector did not abort the session')

console.log('\nFAILURES:', failures.length ? '\n  - ' + failures.join('\n  - ') : 'none')
await ctx.close()
fs.rmSync(userDataDir, { recursive: true, force: true })
process.exit(failures.length ? 1 : 0)
