// Does `observe` actually write nothing, or only appear to?
//
//   npm run check:ceiling
//
// The level tests assert over the STEP LIST, which is not the same claim:
// watch_videos likes as part of its own watch plan, so a programme with no
// `like` step could still like. This runs observe's real steps against a
// fixture that records every click.
import { chromium } from 'patchright'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import * as path from 'node:path'
import { runSession } from '../src/main/runner.ts'
import { SelectorSetSchema } from '../src/shared/selectors.ts'
import { ScriptSchema, planSessions } from '../src/shared/session.ts'
import { NICHES } from '../src/shared/niches.ts'
import { withPersonality } from '../src/shared/content.ts'
import { emojiHabitFor } from '../src/shared/emoji.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const selectors = SelectorSetSchema.parse(
  parse(readFileSync(path.join(ROOT, 'warmup/fixture-selectors.yaml'), 'utf8'))
)
selectors.feed.url = pathToFileURL(path.join(ROOT, 'scripts/fixture-feed.html')).href

const script = ScriptSchema.parse(
  parse(readFileSync(path.join(ROOT, 'warmup/instagram/observe.yaml'), 'utf8'))
)
const plan = planSessions(script, 'fixture:ceiling')
const permitted = new Set(plan.flatMap((s) => s.steps.map((t) => t.action)))
console.log(`observe declares: ${[...permitted].join(', ')}`)

const failures = []
// The sessions carrying watch_videos, which is the step that writes without
// declaring it. Sampled rather than exhaustive: every session runs at realistic
// dwell, so the full programme takes twenty minutes and tests the same thing
// eleven times.
const risky = plan
  .filter((s) => s.kind === 'active' && s.steps.some((t) => t.action === 'watch_videos'))
  .slice(0, 2)
console.log(`checking ${risky.length} of ${plan.length} sessions (those with watch_videos)
`)
for (const session of risky) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(selectors.feed.url, { waitUntil: 'domcontentloaded' })

  const report = await runSession(page, session, {
    accountId: 'fixture:ceiling',
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
    managedHandles: new Set(),
    friendedTargets: new Set(),
    joinedGroups: new Set(),
    permitted
  })

  const liked = JSON.parse((await page.locator('body').getAttribute('data-liked')) ?? '[]')
  const commented = JSON.parse((await page.locator('body').getAttribute('data-commented')) ?? '[]')
  const followed = JSON.parse((await page.locator('body').getAttribute('data-followed')) ?? '[]')
  const saved = JSON.parse((await page.locator('body').getAttribute('data-saved')) ?? '[]')
  await browser.close()

  const writes = liked.length + commented.length + followed.length + saved.length
  const detail = report.steps.map((s) => `${s.action}:${s.engaged}`).join(' ')
  if (writes > 0) {
    failures.push(
      `session ${session.index}: liked ${liked.length}, commented ${commented.length}, followed ${followed.length}, saved ${saved.length}`
    )
    console.log(`FAIL  session ${session.index}  ${detail}`)
  } else {
    console.log(`PASS  session ${session.index}  ${detail}`)
  }
}

console.log(
  failures.length
    ? `\nFAILURES:\n  ${failures.join('\n  ')}`
    : '\nobserve wrote nothing, in any session. FAILURES: none'
)
process.exit(failures.length ? 1 : 0)
