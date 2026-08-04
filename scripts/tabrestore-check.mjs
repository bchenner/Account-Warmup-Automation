// Does a profile still reopen its tabs after being closed?
//
//   node scripts/tabrestore-check.mjs
//
// Guards --restore-last-session against the launch-argument changes around it,
// notably the debugging port the timezone override needs. Drives the app's own
// IPC rather than the UI, so it does not rot when the interface changes.
import { _electron as electron } from 'playwright-core'
import { chromium } from 'patchright'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.BOILER_ALLOW_MULTI = '1'

const MARKERS = ['https://example.com/', 'https://www.iana.org/help/example-domains']

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
  args: ['--no-sandbox', APP_DIR],
  env,
  timeout: 30_000
})
const page = await app.firstWindow()
await page.waitForSelector('#root > *', { timeout: 20_000 })

const call = async (fn, arg, what) => {
  const r = await page.evaluate(fn, arg)
  if (!r?.ok) throw new Error(`${what}: ${r?.error ?? JSON.stringify(r)}`)
  return r.value
}

const cdpFor = async (dir) => {
  let port
  for (let i = 0; i < 60 && !port; i++) {
    try {
      port = (await readFile(path.join(dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim()
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  if (!port) throw new Error('no debugging port')
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`)
}

const settle = async (id) => {
  await call((i) => window.boiler.stopProfile(i), id, 'stopProfile')
  // Chrome writes its session file during shutdown; relaunching before it has
  // finished is what makes restore look broken when it is not.
  await new Promise((r) => setTimeout(r, 6000))
}

let created
let failed = false
try {
  created = await call(
    () =>
      window.boiler.createProfile({
        personaName: 'tabcheck',
        name: 'tab restore check',
        niche: 'home-fitness',
        country: 'US',
        proxyId: null,
        allowDirect: true,
        notes: '',
        windowWidth: 1280,
        windowHeight: 900,
        timezone: 'America/New_York',
        locale: 'en-US'
      }),
    null,
    'createProfile'
  )
  const dir = path.join(
    process.env.APPDATA,
    'boiler/data/personas',
    created.personaSlug,
    'profiles',
    created.id,
    'chrome'
  )

  // --- first run: open the markers -----------------------------------------
  await call((id) => window.boiler.launchProfile(id), created.id, 'launchProfile')
  {
    const browser = await cdpFor(dir)
    const ctx = browser.contexts()[0]
    for (const url of MARKERS) {
      const t = await ctx.newPage()
      await t.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
    }
    console.log('opened:', ctx.pages().map((p) => p.url()).join('  '))
    await browser.close().catch(() => {})
  }
  await settle(created.id)

  // --- second run: are they back? ------------------------------------------
  await call((id) => window.boiler.launchProfile(id), created.id, 'launchProfile')
  {
    const browser = await cdpFor(dir)
    const ctx = browser.contexts()[0]
    await new Promise((r) => setTimeout(r, 4000))
    const urls = ctx.pages().map((p) => p.url())
    console.log('restored:', urls.join('  ') || '(nothing)')
    const back = MARKERS.filter((m) => urls.some((u) => u.startsWith(m.split('/help')[0])))
    failed = back.length === 0
    console.log(
      failed
        ? '\nFAIL — the profile came back with none of its tabs'
        : `\nPASS — ${back.length}/${MARKERS.length} marker tab(s) restored`
    )
    await browser.close().catch(() => {})
  }
  await settle(created.id)
} finally {
  if (created) {
    let removed = false
    for (let i = 0; i < 10 && !removed; i++) {
      const r = await page
        .evaluate(([s, i2]) => window.boiler.deleteProfile(s, i2), [created.personaSlug, created.id])
        .catch(() => null)
      removed = r?.ok === true
      if (!removed) await new Promise((res) => setTimeout(res, 1000))
    }
    if (!removed) console.error(`WARNING: could not remove ${created.id}`)
  }
  await app.close()
}
process.exit(failed ? 1 : 0)
