// Proves the two Facebook-only actions before they are ever pointed at Facebook.
//
//   node --import ./scripts/alias-register.mjs scripts/facebook-check.mjs
//
// What it should demonstrate:
//   - accept_friend confirms INCOMING requests and never sends one
//   - it NEVER confirms one of the fleet's own accounts
//   - it NEVER re-adds someone another account in the fleet already holds
//   - an EMPTY request list is reported as normal, not as a selector miss
//   - a missing container IS a selector miss, so empty and broken stay distinct
//   - join_group joins, and skips groups the fleet is already in
//   - both write back into the fleet registry sets, so the next account sees them
import { chromium } from 'patchright'
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import { runSession } from '../src/main/runner.ts'
import { SelectorSetSchema } from '../src/shared/selectors.ts'
import { NICHES } from '../src/shared/niches.ts'
import { withPersonality } from '../src/shared/content.ts'
import { emojiHabitFor } from '../src/shared/emoji.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const url = (f) => pathToFileURL(path.join(ROOT, 'scripts', f)).href

const selectors = SelectorSetSchema.parse({
  platform: 'facebook',
  version: 'fixture',
  feed: {
    url: url('fixture-feed.html'),
    post: 'article',
    caption: '[data-caption]',
    postIdAttribute: 'data-post-id',
    authorAttribute: 'data-author'
  },
  people: {
    url: url('fixture-people.html'),
    container: '[role="main"]',
    card: '[role="listitem"]',
    acceptButton: 'button[aria-label^="Confirm"]',
    name: 'a[role="link"] span',
    idAttribute: 'data-person-id',
    profileLink: 'a[data-profile]',
    profileLocation: '[data-location]'
  },
  groups: {
    url: url('fixture-groups.html'),
    card: '[role="listitem"]',
    joinButton: 'button[aria-label^="Join"]',
    name: 'a[role="link"] span',
    idAttribute: 'data-group-id'
  }
})

// The fleet's prior state: one account of our own, one person and one group
// another account already took.
const managedHandles = new Set(['fleet-own-account'])
const friendedTargets = new Set(['person-3'])
const joinedGroups = new Set(['group-1'])

const session = {
  index: 1,
  kind: 'active',
  label: 'facebook fixture',
  estimateMs: 0,
  steps: [
    { action: 'accept_friend', count: [3, 3], skipChance: 0 },
    { action: 'join_group', count: [2, 2], skipChance: 0 }
  ]
}

const ctx = {
  accountId: 'fixture:facebook',
  taste: withPersonality(NICHES['home-fitness'].taste, 'fixture'),
  emoji: emojiHabitFor('fixture'),
  niche: 'home-fitness',
  selectors,
  searchTerms: ['workout'],
  corpus: [],
  usedComments: [],
  usedSources: new Set(),
  claimedPosts: new Set(),
  followedTargets: new Set(),
  managedHandles,
  friendedTargets,
  joinedGroups,
  // Confirm deterministically, so the assertions below test the COUNTRY filter
  // rather than the per-account acceptance habit. That habit is never 1 in
  // production and is asserted separately.
  acceptRate: 1,
  requireCountry: 'US'
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(selectors.feed.url, { waitUntil: 'domcontentloaded' })

const started = Date.now()
const report = await runSession(page, session, ctx)
console.log(`completed: ${report.completed}  (${((Date.now() - started) / 1000).toFixed(1)}s)`)
for (const s of report.steps) {
  console.log(`  ${s.action.padEnd(15)} seen=${String(s.seen).padEnd(3)} engaged=${s.engaged}  ${s.detail}`)
}
if (report.error) console.log('  error:', report.error)

// Reloading a page clears its own record, so the authority for "who did we act
// on" is the registry the runner wrote into.
const actuallyFriended = [...friendedTargets].filter((p) => p !== 'person-3')
const actuallyJoined = [...joinedGroups].filter((g) => g !== 'group-1')

const failures = []
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`)
  if (!cond) failures.push(label)
}

console.log()
check('the session completed', report.completed, report.error ?? '')
// The fixture is built so exactly three requesters are US, unclaimed and not
// ours: person-1 (Austin TX), person-2 (Springfield MA), person-7 (Reno NV).
const EXPECTED = ['person-1', 'person-2', 'person-7']
check(
  'confirmed exactly the US requesters, and nobody else',
  actuallyFriended.length === EXPECTED.length &&
    EXPECTED.every((p) => actuallyFriended.includes(p)),
  `confirmed ${JSON.stringify(actuallyFriended.sort())}, wanted ${JSON.stringify(EXPECTED)}`
)
check(
  'never confirmed anyone outside the US',
  !actuallyFriended.includes('person-4') && !actuallyFriended.includes('person-5'),
  'person-4 is in Toronto, person-5 in London'
)
check(
  'never confirmed someone whose location could not be read',
  !actuallyFriended.includes('person-6'),
  'person-6 has no location on their profile — unknown is not US'
)
check(
  'did not read a bare "Georgia" as the US state',
  !actuallyFriended.includes('person-8'),
  'person-8 lives in Georgia the country, or possibly the state — ambiguous means no'
)
check(
  'never confirmed one of the fleet’s own accounts',
  !friendedTargets.has('fleet-own-account'),
  'fleet-own-account must never become a friend of another managed account'
)
check(
  'never re-added someone the fleet already holds',
  actuallyFriended.every((p) => p !== 'person-3'),
  'person-3 was already in the graph'
)
check(
  'joined groups, skipping the one the fleet is already in',
  actuallyJoined.length >= 1 && actuallyJoined.every((g) => g !== 'group-1'),
  `joined ${JSON.stringify(actuallyJoined)}`
)
check(
  'the registry sets were written for the next account to see',
  friendedTargets.size >= 2 && joinedGroups.size >= 2,
  `friended=${friendedTargets.size} joined=${joinedGroups.size}`
)

// --- empty vs broken ---------------------------------------------------------
//
// For a warming account nobody has friended, an empty request list is EVERY
// session. If that aborted, the account would never get past this step. But a
// genuinely broken selector still has to fail loudly, so the two must not look
// the same to the runner.
const scenario = async (people, label) => {
  const p = await browser.newPage()
  await p.goto(selectors.feed.url, { waitUntil: 'domcontentloaded' })
  const r = await runSession(
    p,
    { ...session, steps: [{ action: 'accept_friend', count: [2, 2], skipChance: 0 }] },
    { ...ctx, selectors: { ...selectors, people } }
  )
  await p.close()
  console.log(`\n${label}: completed=${r.completed} — ${r.error ?? r.steps[0]?.detail ?? ''}`)
  return r
}

const empty = await scenario(
  { ...selectors.people, url: url('fixture-people-empty.html') },
  'empty request list'
)
check(
  'an empty request list is normal, not a failure',
  empty.completed && empty.steps[0]?.detail === 'no pending requests',
  empty.error ?? empty.steps[0]?.detail
)

const broken = await scenario(
  { ...selectors.people, container: '#definitely-not-here' },
  'broken container selector'
)
check(
  'a broken selector still aborts loudly',
  !broken.completed && String(broken.error).includes('people.container'),
  broken.error ?? '(the session completed, which it must not)'
)

await browser.close()
console.log(failures.length ? `\nFAILURES: ${failures.length}` : '\nFAILURES: none')
process.exit(failures.length ? 1 : 0)
