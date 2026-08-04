// What does a warmup session actually cost this machine?
//
//   npm run check:resources
//
// Samples CPU and working set for every Chrome and Electron process while a
// real session runs, and reports the peak and the mean. Answering this by
// guessing would be worthless — Chrome's cost depends entirely on what the
// page does, and a warmup session watches video.
import { chromium } from 'patchright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import * as os from 'node:os'
import * as path from 'node:path'
import { runSession } from '../src/main/runner.ts'
import { SelectorSetSchema } from '../src/shared/selectors.ts'
import { NICHES } from '../src/shared/niches.ts'
import { withPersonality } from '../src/shared/content.ts'
import { emojiHabitFor } from '../src/shared/emoji.ts'
import { BACKGROUND_ARGS } from '../src/shared/chrome-args.ts'

const run = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '..')
const url = (f) => pathToFileURL(path.join(ROOT, 'scripts', f)).href

console.log(`machine: ${os.cpus().length} logical cores, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM`)
console.log(`         ${os.cpus()[0].model.trim()}\n`)

// Chrome spawns a process per renderer, GPU and utility, so a single number
// means nothing — every chrome.exe has to be summed.
const sample = async () => {
  const { stdout } = await run(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$p = Get-Process chrome -ErrorAction SilentlyContinue;
       $ws = ($p | Measure-Object WorkingSet64 -Sum).Sum;
       $cpu = ($p | Measure-Object CPU -Sum).Sum;
       "$($p.Count)|$ws|$cpu"`
    ],
    { windowsHide: true }
  )
  const [count, ws, cpu] = stdout.trim().split('|')
  return { count: Number(count) || 0, rssMB: (Number(ws) || 0) / 2 ** 20, cpuSec: Number(cpu) || 0 }
}

const selectors = SelectorSetSchema.parse({
  platform: 'instagram',
  version: 'fixture',
  feed: {
    url: url('fixture-feed.html'),
    post: 'article',
    caption: '[data-caption]',
    video: 'video',
    likeButton: 'button[data-like]',
    commentText: '[data-comment]',
    postIdAttribute: 'data-post-id',
    authorAttribute: 'data-author'
  }
})

const session = {
  index: 1,
  kind: 'active',
  label: 'resource sample',
  estimateMs: 0,
  steps: [
    { action: 'feed_scroll', seconds: [45, 60], skipChance: 0 },
    { action: 'watch_videos', count: [4, 6], skipChance: 0 },
    { action: 'like', count: [2, 3], skipChance: 0 }
  ]
}

const ctx = {
  accountId: 'fixture:resources',
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
  joinedGroups: new Set()
}

const before = await sample()
console.log(`chrome before launch: ${before.count} processes, ${before.rssMB.toFixed(0)} MB\n`)

// Launched exactly as a session launches it — headed, off-screen, with the
// anti-throttling flags. A headless measurement would understate it.
const ctxBrowser = await chromium.launchPersistentContext(
  path.join(os.tmpdir(), `boiler-res-${Date.now()}`),
  {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    args: ['--window-size=1512,982', '--no-first-run', '--no-default-browser-check', ...BACKGROUND_ARGS],
    viewport: null
  }
)
const page = ctxBrowser.pages()[0] ?? (await ctxBrowser.newPage())
await page.goto(selectors.feed.url, { waitUntil: 'domcontentloaded' })

const samples = []
let sampling = true
const loop = (async () => {
  while (sampling) {
    samples.push(await sample())
    await new Promise((r) => setTimeout(r, 1500))
  }
})()

const started = Date.now()
const report = await runSession(page, session, ctx)
const elapsed = (Date.now() - started) / 1000
sampling = false
await loop

const after = await sample()
await ctxBrowser.close()

const peakRss = Math.max(...samples.map((s) => s.rssMB))
const meanRss = samples.reduce((a, s) => a + s.rssMB, 0) / samples.length
const peakProcs = Math.max(...samples.map((s) => s.count))
// CPU seconds are cumulative per process, so the delta over the run divided by
// wall-clock gives the average share of ONE core.
const cpuSeconds = Math.max(0, after.cpuSec - before.cpuSec)
const coreShare = cpuSeconds / elapsed

console.log(`session completed: ${report.completed} in ${elapsed.toFixed(0)}s`)
console.log(`\nwhile the session ran:`)
console.log(`  chrome processes   peak ${peakProcs}`)
console.log(`  memory             peak ${peakRss.toFixed(0)} MB, mean ${meanRss.toFixed(0)} MB`)
console.log(`  cpu                ${cpuSeconds.toFixed(1)}s over ${elapsed.toFixed(0)}s wall`)
console.log(`                     = ${(coreShare * 100).toFixed(0)}% of one core`)
console.log(`                     = ${((coreShare / os.cpus().length) * 100).toFixed(1)}% of this machine`)
console.log(`\nper additional account running at the same time, expect roughly the same again.`)
