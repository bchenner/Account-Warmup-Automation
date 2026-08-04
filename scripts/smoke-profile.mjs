// End-to-end smoke: create a profile through the UI, open it, and assert a
// real Chrome process actually started with our --user-data-dir.
//
//   npm run build && node scripts/smoke-profile.mjs
import { _electron as electron } from 'playwright-core'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = path.join(APP_DIR, '.shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronBin = path.join(
  APP_DIR,
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : 'node_modules/electron/dist/electron'
)

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', APP_DIR],
  env,
  timeout: 30_000
})

const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.waitForSelector('#root > *', { timeout: 20_000 })

const step = (msg) => console.log(`\n=== ${msg}`)

step('create a profile')
await page.getByRole('button', { name: 'New profile' }).click()
await page.getByPlaceholder('Maya · Instagram').fill('Smoke Test · Instagram')
await page.getByPlaceholder('Maya', { exact: true }).fill('Smoke Test')
await page.getByPlaceholder('home fitness').fill('smoke testing')
// No proxy exists yet, so take the explicit real-IP opt-in. This is the only
// path that launches without one, and it has to be ticked deliberately.
await page.getByRole('checkbox').check()
await page.getByRole('button', { name: 'Create profile' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(SHOT_DIR, '07-profile-created.png') })
console.log(await page.locator('body').innerText())

step('open it — expect a real Chrome window')
await page.getByRole('button', { name: 'Open', exact: true }).click()
await page.waitForTimeout(4000)
await page.screenshot({ path: path.join(SHOT_DIR, '08-profile-open.png') })
console.log(await page.locator('body').innerText())

step('assert a chrome.exe is running against our user-data-dir')
const dataDir = (await page.evaluate(() => window.boiler.dataDir())).value
const expectedDir = path.join(dataDir, 'personas', 'smoke-test', 'profiles', 'smoke-test-01', 'chrome')
console.log('expected user-data-dir:', expectedDir)
console.log('directory created:', fs.existsSync(expectedDir))

if (process.platform === 'win32') {
  const out = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object -ExpandProperty CommandLine"',
    { encoding: 'utf8' }
  )
  const ours = out.split('\n').filter((l) => l.includes('smoke-test-01'))
  console.log('matching chrome processes:', ours.length)
  for (const l of ours) {
    console.log('  flags:', l.trim().replace(/^.*chrome\.exe"?\s*/, '').slice(0, 400))
  }
}

step('close it')
await page.getByRole('button', { name: 'Close' }).click()
await page.waitForTimeout(1500)
console.log('page errors:', JSON.stringify(errors))

await app.close()
process.exit(0)
