// Can a session run off-screen without (a) intruding on the operator and
// (b) being throttled into doing nothing?
//
// Chrome treats an off-screen window as occluded and clamps timers, starves
// requestAnimationFrame and pauses video. Watch-to-completion is a core warmup
// action, so a throttled session would silently do nothing.
//
//   node scripts/background-check.mjs
import { chromium } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const OFFSCREEN = ['--window-position=-32000,-32000']
const ANTI_THROTTLE = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  // Windows-specific: Chrome's native occlusion detection is what marks an
  // off-screen window as hidden in the first place.
  '--disable-features=CalculateNativeWinOcclusion'
]

// Built via evaluate() rather than an inline <script> in a data: URL — inline
// scripts there did not execute, which silently produced NaN counters.
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

function instrument(videoSrc) {
  document.body.style.margin = '0'
  document.body.innerHTML =
    `<video id="v" muted playsinline src="${videoSrc}"></video><input id="t" />`

  window.frames_ = 0
  const tick = () => {
    window.frames_++
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  window.ticks_ = 0
  setInterval(() => window.ticks_++, 100)

  window.trusted_ = null
  window.mouseTrusted_ = null
  document.getElementById('t').addEventListener('keydown', (e) => {
    window.trusted_ = e.isTrusted
  })
  document.addEventListener('mousemove', (e) => {
    window.mouseTrusted_ = e.isTrusted
  })
}

async function measure(label, args) {
  const dir = path.join(os.tmpdir(), `bgcheck-${label.replace(/\W/g, '')}`)
  fs.rmSync(dir, { recursive: true, force: true })

  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chrome',
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check', ...args],
    viewport: null
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto('about:blank')
  await page.evaluate(instrument, VIDEO)
  await page.waitForTimeout(500)

  // Drive it the way a session would: CDP mouse + keyboard.
  await page.mouse.move(120, 140)
  await page.mouse.move(240, 200)
  await page.click('#t')
  await page.keyboard.type('home workout', { delay: 40 })

  await page.evaluate(() => {
    const v = document.getElementById('v')
    v.play().catch(() => {})
  })

  const t0 = Date.now()
  const before = await page.evaluate(() => ({
    f: window.frames_,
    t: window.ticks_,
    v: document.getElementById('v').currentTime
  }))
  await page.waitForTimeout(3000)
  const after = await page.evaluate(() => ({
    f: window.frames_,
    t: window.ticks_,
    v: document.getElementById('v').currentTime,
    typed: document.getElementById('t').value,
    trusted: window.trusted_,
    mouseTrusted: window.mouseTrusted_
  }))
  const elapsed = (Date.now() - t0) / 1000

  await ctx.close()
  fs.rmSync(dir, { recursive: true, force: true })

  return {
    label,
    fps: ((after.f - before.f) / elapsed).toFixed(1),
    timersPerSec: ((after.t - before.t) / elapsed).toFixed(1),
    videoAdvanced: (after.v - before.v).toFixed(2),
    typed: after.typed,
    keyTrusted: after.trusted,
    mouseTrusted: after.mouseTrusted
  }
}

const results = []
results.push(await measure('on-screen (baseline)', []))
results.push(await measure('off-screen, no flags', OFFSCREEN))
results.push(await measure('off-screen + anti-throttle', [...OFFSCREEN, ...ANTI_THROTTLE]))

console.log('\n' + 'configuration'.padEnd(28) + 'fps    timers/s  video+s  typed          isTrusted')
console.log('-'.repeat(92))
for (const r of results) {
  console.log(
    r.label.padEnd(28) +
      String(r.fps).padEnd(7) +
      String(r.timersPerSec).padEnd(10) +
      String(r.videoAdvanced).padEnd(9) +
      String(r.typed).padEnd(15) +
      `key=${r.keyTrusted} mouse=${r.mouseTrusted}`
  )
}
console.log(
  '\nExpected unthrottled: ~10 timers/s (100ms interval), video advancing ~3s.' +
    '\nThrottled looks like: ~1 timer/s, video stalled at 0.00.'
)
