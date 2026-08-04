// Proves `explore` before it is pointed at a real platform.
//
//   npm run check:explore
//
// What it should demonstrate:
//   - it SUBMITS the query rather than typing and walking away
//   - it OPENS results and dwells on them, which is the whole signal
//   - the queries are English, on-niche, and different per account
//   - it engages with nothing — no likes, follows or comments
import { chromium } from 'patchright'
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import { runSession } from '../src/main/runner.ts'
import { SelectorSetSchema } from '../src/shared/selectors.ts'
import { NICHES } from '../src/shared/niches.ts'
import { withPersonality } from '../src/shared/content.ts'
import { emojiHabitFor } from '../src/shared/emoji.ts'
import { reorientQueries } from '../src/shared/queries.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const url = (f) => pathToFileURL(path.join(ROOT, 'scripts', f)).href

const selectors = SelectorSetSchema.parse({
  platform: 'instagram',
  version: 'fixture',
  feed: { url: url('fixture-feed.html'), post: 'article', caption: '[data-caption]' },
  search: {
    url: url('fixture-search.html'),
    input: 'input[aria-label="Search"]',
    resultItem: '.r a'
  }
})

const ACCOUNT = 'fixture:explore'
const session = {
  index: 1,
  kind: 'active',
  label: 'explore fixture',
  estimateMs: 0,
  steps: [{ action: 'explore', count: [3, 3], skipChance: 0 }]
}

const ctx = {
  accountId: ACCOUNT,
  taste: withPersonality(NICHES.cooking.taste, 'fixture'),
  emoji: emojiHabitFor('fixture'),
  niche: 'cooking',
  selectors,
  searchTerms: [],
  corpus: [],
  usedComments: [],
  usedSources: new Set(),
  claimedPosts: new Set(),
  followedTargets: new Set(),
  managedHandles: new Set(),
  friendedTargets: new Set(),
  joinedGroups: new Set(),
  exploreRound: 0
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto(selectors.search.url, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.goto(selectors.feed.url, { waitUntil: 'domcontentloaded' })

const started = Date.now()
const report = await runSession(page, session, ctx)
console.log(`completed: ${report.completed}  (${((Date.now() - started) / 1000).toFixed(1)}s)`)
for (const s of report.steps) {
  console.log(`  ${s.action.padEnd(10)} seen=${s.seen} engaged=${s.engaged}  ${s.detail}`)
}
if (report.error) console.log('  error:', report.error)

await page.goto(selectors.search.url, { waitUntil: 'domcontentloaded' })
const searched = JSON.parse((await page.locator('body').getAttribute('data-searched')) ?? '[]')
const opened = JSON.parse((await page.locator('body').getAttribute('data-opened')) ?? '[]')
await browser.close()

const failures = []
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`)
  if (!cond) failures.push(label)
}

console.log()
check('the session completed', report.completed, report.error ?? '')
check(
  'the query was actually SUBMITTED, not just typed',
  searched.length === 3,
  `search pages loaded for: ${JSON.stringify(searched)}`
)
check(
  'results were opened and watched',
  opened.length >= 3,
  `opened ${opened.length}: ${JSON.stringify(opened.slice(0, 4))}`
)
check(
  'it searched the queries the generator produced for this account',
  searched.every((q) => reorientQueries('cooking', ACCOUNT, 0, 3).includes(q)),
  `wanted from ${JSON.stringify(reorientQueries('cooking', ACCOUNT, 0, 3))}`
)
check(
  'the queries are on-niche',
  /recipe|cook|kitchen|bak|meal|food|dinner|sauce|ingredient/i.test(searched.join(' ')),
  searched.join(' | ')
)
check(
  'it engaged with nothing',
  report.steps.every((s) => s.action === 'explore'),
  `steps: ${report.steps.map((s) => s.action).join(', ')}`
)

console.log(failures.length ? `\nFAILURES: ${failures.length}` : '\nFAILURES: none')
process.exit(failures.length ? 1 : 0)
