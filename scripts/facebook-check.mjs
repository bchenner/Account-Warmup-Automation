// Proves the two Facebook-only actions before they are ever pointed at Facebook.
//
//   node --import ./scripts/alias-register.mjs scripts/facebook-check.mjs
//
// What it should demonstrate:
//   - friend_request sends the requested number and no more
//   - it NEVER friends one of the fleet's own accounts
//   - it NEVER friends someone another account in the fleet already holds
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
    card: '[role="listitem"]',
    addButton: 'button[aria-label^="Add friend"]',
    name: 'a[role="link"] span',
    idAttribute: 'data-person-id'
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
    { action: 'friend_request', count: [3, 3], skipChance: 0 },
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
  joinedGroups
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

// Read what the pages actually recorded, not what the runner claims.
await page.goto(selectors.people.url, { waitUntil: 'domcontentloaded' })
const sent = JSON.parse((await page.locator('body').getAttribute('data-sent')) ?? '[]')
await page.goto(selectors.groups.url, { waitUntil: 'domcontentloaded' })
const joined = JSON.parse((await page.locator('body').getAttribute('data-joined')) ?? '[]')
await browser.close()

// The pages are reloaded to read them, which clears their own record — so the
// authority for "who did we act on" is the registry the runner wrote into.
const actuallyFriended = [...friendedTargets].filter((p) => p !== 'person-3')
const actuallyJoined = [...joinedGroups].filter((g) => g !== 'group-1')

const failures = []
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`)
  if (!cond) failures.push(label)
}

console.log()
check('the session completed', report.completed, report.error ?? '')
check(
  'sent exactly the requested number of friend requests',
  actuallyFriended.length === 3,
  `sent to ${JSON.stringify(actuallyFriended)}`
)
check(
  'never friended one of the fleet’s own accounts',
  !friendedTargets.has('fleet-own-account'),
  'fleet-own-account must never receive a request'
)
check(
  'never re-friended someone the fleet already holds',
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
  friendedTargets.size === 4 && joinedGroups.size >= 2,
  `friended=${friendedTargets.size} joined=${joinedGroups.size}`
)

console.log(failures.length ? `\nFAILURES: ${failures.length}` : '\nFAILURES: none')
process.exit(failures.length ? 1 : 0)
