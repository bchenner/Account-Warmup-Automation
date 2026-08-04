// What does a profile actually see, and which selectors match?
//
//   node --import ./scripts/alias-register.mjs scripts/selector-probe.mjs <persona> <profileId> <platform>
//
// Opens the profile on its own proxy exactly as a session does, screenshots the
// page, and reports a match count for every selector in that platform's set.
// This is the tool for correcting selectors against the live site.
import { chromium } from 'patchright'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { SelectorSetSchema } from '../src/shared/selectors.ts'
import { BACKGROUND_ARGS } from '../src/shared/chrome-args.ts'
import { startRelay } from '../src/main/relay.ts'

const [persona, profileId, platform] = process.argv.slice(2)
if (!persona || !profileId || !platform) {
  console.error('usage: selector-probe.mjs <persona> <profileId> <platform>')
  process.exit(1)
}

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA = path.join(process.env.APPDATA, 'boiler', 'data')
const userDataDir = path.join(DATA, 'personas', persona, 'profiles', profileId, 'chrome')
const profile = parse(
  readFileSync(path.join(DATA, 'personas', persona, 'profiles', profileId, 'profile.yaml'), 'utf8')
)
const sel = SelectorSetSchema.parse(
  parse(readFileSync(path.join(ROOT, 'warmup', platform, 'selectors.yaml'), 'utf8'))
)

// Reached the same way a session reaches it: through the loopback relay.
// Chrome cannot authenticate to a proxy — credentials on --proxy-server are
// ignored and the navigation fails with ERR_INVALID_AUTH_CREDENTIALS.
// Credentials come from the environment rather than the encrypted pool, since
// safeStorage only works inside Electron.
let relay
let proxy
if (process.env.BOILER_TEST_PROXY) {
  const u = new URL(process.env.BOILER_TEST_PROXY)
  relay = await startRelay({
    host: u.hostname,
    port: Number(u.port),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password)
  })
  proxy = `http://127.0.0.1:${relay.port}`
}
console.log(`profile ${profileId}  tz ${profile.fingerprint.timezone}  proxy ${relay ? 'via relay' : 'DIRECT'}`)

const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: [
    `--window-size=${profile.fingerprint.windowWidth},${profile.fingerprint.windowHeight}`,
    `--lang=${profile.fingerprint.locale}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...BACKGROUND_ARGS,
    ...(proxy ? ['--webrtc-ip-handling-policy=disable_non_proxied_udp'] : [])
  ],
  ...(proxy ? { proxy: { server: proxy } } : {}),
  timezoneId: profile.fingerprint.timezone,
  locale: profile.fingerprint.locale,
  viewport: null
})

const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(sel.feed.url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

console.log(`\nurl:   ${page.url()}`)
console.log(`title: ${await page.title()}`)

const shot = path.join(ROOT, '.shots')
fs.mkdirSync(shot, { recursive: true })
const file = path.join(shot, `probe-${profileId}-${platform}.png`)
await page.screenshot({ path: file, fullPage: false })
console.log(`shot:  ${file}`)

// Is this even a logged-in feed?
const bodyText = (await page.locator('body').innerText().catch(() => '')) || ''
const signals = {
  'log in form': /log in|sign up|create new account/i.test(bodyText.slice(0, 2000)),
  'checkpoint / review': /we need to confirm|confirm your identity|temporarily (locked|restricted)|review/i.test(bodyText),
  'captcha': /captcha|security check/i.test(bodyText)
}
for (const [k, v] of Object.entries(signals)) if (v) console.log(`  ⚠ page mentions: ${k}`)
console.log(`  body text length: ${bodyText.length}`)

const count = async (css) => {
  if (!css || css.startsWith('text=')) return css ? '(text= — matched in-page, not probed here)' : '-'
  try {
    return String(await page.locator(css).count())
  } catch (e) {
    return `ERROR ${e.message.split('\n')[0]}`
  }
}

console.log('\nfeed')
for (const [k, v] of Object.entries(sel.feed)) {
  if (k === 'url' || k.endsWith('Attribute')) continue
  console.log(`  ${k.padEnd(18)} ${String(v).padEnd(52)} ${await count(v)}`)
}
if (sel.stories) {
  console.log('stories')
  for (const [k, v] of Object.entries(sel.stories)) {
    console.log(`  ${k.padEnd(18)} ${String(v).padEnd(52)} ${await count(v)}`)
  }
}

// A few plausible alternatives, to suggest what the post container should be.
console.log('\ncandidates for the post container')
for (const css of [
  'div[role="article"]',
  'div[role="feed"] > div',
  'div[role="feed"] div[role="article"]',
  'div[data-pagelet^="FeedUnit"]',
  '[aria-posinset]'
]) {
  console.log(`  ${css.padEnd(46)} ${await count(css)}`)
}

await ctx.close()
await relay?.close()
