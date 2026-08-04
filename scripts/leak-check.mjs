// Launches Chrome with the SAME flags and env the app uses, then reports the
// signals a site would read to work out where you are and whose IP you are on.
//
//   node scripts/leak-check.mjs [host:port]
//
// With no proxy argument it measures the un-proxied baseline, which is still
// useful: timezone, locale and geolocation must hold regardless of the proxy.
import { chromium } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const proxyArg = process.argv[2] ?? null
const TZ = 'America/New_York'
const LOCALE = 'en-US'

const userDataDir = path.join(os.tmpdir(), 'boiler-leakcheck')
fs.rmSync(userDataDir, { recursive: true, force: true })

// Mirrors src/main/profiles.ts launchProfile().
const args = [
  '--window-size=1512,982',
  `--lang=${LOCALE}`,
  '--restore-last-session',
  '--no-first-run',
  '--no-default-browser-check',
  ...(proxyArg
    ? [
        `--proxy-server=http://${proxyArg}`,
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
      ]
    : [])
]

// Credentials come from the environment so they never land in argv, a file, or
// this repo — which is public.
const auth =
  process.env.PROXY_USER && process.env.PROXY_PASS
    ? { username: process.env.PROXY_USER, password: process.env.PROXY_PASS }
    : {}

const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: process.env.HEADLESS === '1',
  args,
  viewport: null,
  ...(proxyArg ? { proxy: { server: `http://${proxyArg}`, ...auth } } : {}),
  env: { ...process.env, TZ }
})

const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto('about:blank')

const js = await page.evaluate(() => {
  const g = navigator
  return {
    intlTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffsetMinutes: new Date().getTimezoneOffset(),
    dateString: new Date().toString(),
    language: g.language,
    languages: g.languages,
    platform: g.platform,
    userAgent: g.userAgent,
    webdriver: g.webdriver,
    hardwareConcurrency: g.hardwareConcurrency,
    deviceMemory: g.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height}`,
    hasGeolocation: 'geolocation' in g,
    // Highest-entropy surface on Chrome, and the one headless most often
    // breaks by falling back to a software rasteriser.
    webgl: (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl')
        const d = gl.getExtension('WEBGL_debug_renderer_info')
        return {
          vendor: gl.getParameter(d.UNMASKED_VENDOR_WEBGL),
          renderer: gl.getParameter(d.UNMASKED_RENDERER_WEBGL)
        }
      } catch (e) {
        return { vendor: 'ERR', renderer: String(e) }
      }
    })()
  }
})

console.log('--- what the page reads -------------------------------------')
console.log(`  TZ env var passed in : ${TZ}`)
console.log(`  Intl timeZone        : ${js.intlTimeZone}   ${js.intlTimeZone === TZ ? 'OK' : '<-- MISMATCH'}`)
console.log(`  getTimezoneOffset    : ${js.tzOffsetMinutes} min`)
console.log(`  Date.toString        : ${js.dateString}`)
console.log(`  navigator.language   : ${js.language}`)
console.log(`  navigator.languages  : ${JSON.stringify(js.languages)}`)
console.log(`  platform / UA        : ${js.platform} / ${js.userAgent.slice(0, 80)}...`)
console.log(`  webdriver            : ${js.webdriver}`)
console.log(`  cores / memory       : ${js.hardwareConcurrency} / ${js.deviceMemory}`)
console.log(`  screen               : ${js.screen}`)
console.log(`  WebGL vendor         : ${js.webgl.vendor}`)
console.log(`  WebGL renderer       : ${js.webgl.renderer}`)

console.log('\n--- Accept-Language actually sent ---------------------------')
try {
  const r = await page.evaluate(async () => {
    const res = await fetch('https://httpbin.org/headers')
    return (await res.json()).headers
  })
  console.log(`  Accept-Language      : ${r['Accept-Language']}`)
  console.log(`  User-Agent           : ${String(r['User-Agent']).slice(0, 80)}...`)
} catch (e) {
  console.log('  (header echo unavailable:', e.message.split('\n')[0], ')')
}

console.log('\n--- egress IP as the page sees it ---------------------------')
try {
  const ip = await page.evaluate(async () => {
    const res = await fetch('https://ipinfo.io/json')
    return await res.json()
  })
  console.log(`  IP / country / city  : ${ip.ip} / ${ip.country} / ${ip.city}`)
  console.log(`  IP timezone          : ${ip.timezone}`)
  console.log(
    `  timezone vs IP       : ${ip.timezone === js.intlTimeZone ? 'CONSISTENT' : '<-- MISMATCH, this is a productised detection signal'}`
  )
} catch (e) {
  console.log('  (ip lookup failed:', e.message.split('\n')[0], ')')
}

console.log('\n--- WebRTC: does it leak an IP outside the proxy? -----------')
const rtc = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const found = new Set()
      let pc
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      } catch (e) {
        return resolve({ error: String(e) })
      }
      pc.createDataChannel('x')
      pc.onicecandidate = (e) => {
        if (!e.candidate) return
        const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(e.candidate.candidate)
        if (m) found.add(m[1])
      }
      pc.createOffer().then((o) => pc.setLocalDescription(o))
      setTimeout(() => resolve({ candidates: [...found] }), 6000)
    })
)
console.log('  ICE candidate IPs    :', JSON.stringify(rtc))

await ctx.close()
fs.rmSync(userDataDir, { recursive: true, force: true })
