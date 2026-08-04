// Does the profile's timezone actually reach the page?
//
//   BOILER_TEST_PROXY=http://user:pass@host:port node scripts/timezone-check.mjs
//
// Two mechanisms are compared against the same proxy:
//   1. TZ in the child process environment — what launchProfile does today.
//   2. Playwright's timezoneId, which rides CDP Emulation.setTimezoneOverride.
//
// The proxy decides the expected answer: whatever zone the geo lookup reports
// for the egress IP is what the browser must report, or the account presents a
// clock that disagrees with its own IP.
import { chromium } from 'patchright'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetch, ProxyAgent } from 'undici'

const PROXY = process.env.BOILER_TEST_PROXY
if (!PROXY) {
  console.error('set BOILER_TEST_PROXY=http://user:pass@host:port')
  process.exit(1)
}
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// What the proxy's own IP claims, which is the target both mechanisms must hit.
const agent = new ProxyAgent({ uri: PROXY, requestTls: { maxCachedSessions: 0 } })
const geo = await (await fetch('https://ipinfo.io/json', { dispatcher: agent })).json()
await agent.close()
console.log(`egress ${geo.ip}  ${geo.city}, ${geo.region}  ->  expects ${geo.timezone}\n`)

const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone
console.log(`this machine is in ${hostZone}\n`)

const READ = `(${(() => ({
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  offsetMinutes: new Date().getTimezoneOffset(),
  stringified: new Date(0).toString()
})).toString()})()`

// --- 1. TZ environment variable, as launchProfile does it -------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'tzenv-'))
  const child = spawn(
    CHROME,
    [`--user-data-dir=${dir}`, '--remote-debugging-port=9333', '--no-first-run',
     '--no-default-browser-check', '--headless=new', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, TZ: geo.timezone } }
  )
  await new Promise((r) => setTimeout(r, 3500))
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9333')
    const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage())
    const got = await page.evaluate(READ)
    console.log(`TZ env var      -> ${got.zone}  (offset ${got.offsetMinutes})`)
    console.log(`                   ${got.zone === geo.timezone ? 'MATCHES the proxy' : `WRONG — wanted ${geo.timezone}`}`)
    await browser.close()
  } catch (e) {
    console.log('TZ env var      -> could not read:', e.message)
  }
  child.kill()
}

// --- 2. timezoneId over CDP, as the session runner now does it --------------
{
  const dir = mkdtempSync(join(tmpdir(), 'tzcdp-'))
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: CHROME,
    headless: true,
    timezoneId: geo.timezone,
    proxy: { server: PROXY },
    viewport: null
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto('about:blank')
  const got = await page.evaluate(READ)
  console.log(`\ntimezoneId/CDP  -> ${got.zone}  (offset ${got.offsetMinutes})`)
  console.log(`                   ${got.zone === geo.timezone ? 'MATCHES the proxy' : `WRONG — wanted ${geo.timezone}`}`)
  console.log(`                   Date: ${got.stringified}`)
  await ctx.close()
}
