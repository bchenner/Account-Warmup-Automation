// End-to-end: does binding a proxy set the profile's zone, and does the
// browser it opens actually report it?
//
//   node scripts/timezone-sync-check.mjs
//
// Uses a throwaway persona so no real profile's proxy binding is decided here,
// and removes it afterwards whether or not the checks pass.
import { _electron as electron } from 'playwright-core'
import { chromium } from 'patchright'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.BOILER_ALLOW_MULTI = '1'

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
  args: ['--no-sandbox', APP_DIR],
  env,
  timeout: 30_000
})
app.process().stderr?.on('data', (d) => process.stderr.write(`[main] ${d}`))
const page = await app.firstWindow()
await page.waitForSelector('#root > *', { timeout: 20_000 })

const call = async (fn, arg, what) => {
  const r = await page.evaluate(fn, arg)
  if (!r?.ok) throw new Error(`${what}: ${r?.error ?? JSON.stringify(r)}`)
  return r.value
}

const failures = []
const check = (label, got, want) => {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        got ${got}\n        want ${want}`)
  if (!ok) failures.push(label)
}

let created
try {
  // Pick a verified proxy whose zone is NOT this machine's, so a pass cannot be
  // the host's own setting leaking through and looking correct.
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const proxies = await call(() => window.boiler.listProxies(), null, 'listProxies')
  const proxy = proxies.find(
    (p) => p.lastVerification?.ok && p.lastVerification.timezone && p.lastVerification.timezone !== hostZone
  )
  if (!proxy) throw new Error('no verified proxy with a usable timezone')
  const want = proxy.lastVerification.timezone
  console.log(`host is ${hostZone}; using ${proxy.id} (${proxy.host}) which reports ${want}\n`)

  // 1. Create with a deliberately WRONG zone, and bind the proxy at creation.
  created = await call(
    (id) =>
      window.boiler.createProfile({
        personaName: 'tzcheck',
        name: 'tz check',
        niche: 'home-fitness',
        country: 'US',
        proxyId: id,
        allowDirect: false,
        notes: '',
        windowWidth: 1512,
        windowHeight: 982,
        timezone: 'Europe/Berlin',
        locale: 'en-US'
      }),
    proxy.id,
    'createProfile'
  )
  check('create with a bound proxy overrides the submitted zone', created.fingerprint.timezone, want)

  // 2. The stored record, re-read, agrees.
  const stored = (await call(() => window.boiler.listProfiles(), null, 'listProfiles')).find(
    (p) => p.id === created.id
  )
  check('the persisted profile carries it', stored.fingerprint.timezone, want)

  // 3. Open it, and ask the actual browser.
  await call((id) => window.boiler.launchProfile(id), created.id, 'launchProfile')
  const userDataDir = path.join(
    process.env.APPDATA,
    'boiler/data/personas',
    created.personaSlug,
    'profiles',
    created.id,
    'chrome'
  )
  let port
  for (let i = 0; i < 60 && !port; i++) {
    try {
      port = (await readFile(path.join(userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim()
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const ctx = browser.contexts()[0]

  // The tab that already existed when the override was installed.
  const first = ctx.pages()[0]
  if (first) {
    await first.goto('about:blank', { timeout: 20_000 }).catch(() => {})
    check(
      'the tab open at launch reports the proxy zone',
      await first.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      want
    )
  }

  // A NEW tab, i.e. one that did not exist when the override was installed.
  const tab = await ctx.newPage()
  await tab.goto('https://ipinfo.io/json', { waitUntil: 'domcontentloaded', timeout: 45_000 })
  const seen = await tab.evaluate(() => ({
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    body: document.body.innerText
  }))
  const geo = JSON.parse(seen.body)

  check('a newly opened tab reports the proxy zone', seen.zone, want)
  check('and it is browsing from the proxy', geo.ip, proxy.lastVerification.egressIp)
  check('the IP and the clock agree', seen.zone, geo.timezone)

  await browser.close().catch(() => {})
  await call((id) => window.boiler.stopProfile(id), created.id, 'stopProfile')
  // stopProfile posts WM_CLOSE and returns; Chrome still holds the user-data
  // dir for a moment afterwards, and deleting it too early fails silently and
  // leaves the proxy bound to a profile that no longer exists.
  for (let i = 0; i < 60; i++) {
    const still = await call(() => window.boiler.listProfiles(), null, 'listProfiles')
    if (!still.find((p) => p.id === created.id)?.running) break
    await new Promise((r) => setTimeout(r, 500))
  }
  await new Promise((r) => setTimeout(r, 2000))
} finally {
  if (created) {
    // Retried, and reported if it never succeeds: a silent failure here leaves
    // a proxy bound to a profile that is gone, which blocks the next run.
    let removed = false
    for (let i = 0; i < 10 && !removed; i++) {
      const r = await page
        .evaluate(
          ([slug, id]) => window.boiler.deleteProfile(slug, id),
          [created.personaSlug, created.id]
        )
        .catch(() => null)
      removed = r?.ok === true
      if (!removed) await new Promise((res) => setTimeout(res, 1000))
    }
    if (!removed) console.error(`WARNING: could not remove ${created.id}; unassign its proxy by hand`)
  }
  await app.close()
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
