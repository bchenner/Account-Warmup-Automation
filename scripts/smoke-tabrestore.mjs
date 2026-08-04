// Behavioural check: open a page in a profile, close it, reopen it, and assert
// the page came back. Asserting restore_on_startup == 1 is not the same thing —
// this reads the actual restored window title.
import { _electron as electron } from 'playwright-core'
import { execFileSync, spawn } from 'node:child_process'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.BOILER_ALLOW_MULTI = '1'

const NAME = 'Tab Restore'
const SLUG = 'tab-restore'
const URL = 'https://example.com/'
const fail = []

const ps = (cmd) =>
  execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim()

/** Title of the Chrome window belonging to this profile, or '' if none. */
const chromeTitle = (dir) =>
  ps(
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |` +
      ` Where-Object { $_.CommandLine -like '*${dir.replace(/'/g, "''")}*' } |` +
      ` ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue;` +
      ` if ($p -and $p.MainWindowHandle -ne 0) { $p.MainWindowTitle } }`
  )

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron.exe'),
  args: ['--no-sandbox', APP_DIR],
  env,
  timeout: 30_000
})
const page = await app.firstWindow()
await page.waitForSelector('#root > *', { timeout: 20_000 })

console.log('=== create profile')
await page.getByRole('button', { name: 'New profile' }).click()
await page.getByPlaceholder('Maya · Instagram').fill(NAME)
await page.getByPlaceholder('Maya', { exact: true }).fill(NAME)
await page.getByPlaceholder('home fitness').fill('tabs')
await page.getByRole('checkbox').check()
await page.getByRole('button', { name: 'Create profile' }).click()
await page.waitForTimeout(1000)

const profileId = await page.evaluate((n) => {
  const el = [...document.querySelectorAll('[data-profile-id]')].find((e) =>
    e.textContent?.includes(n)
  )
  return el?.getAttribute('data-profile-id') ?? null
}, NAME)
if (!profileId) throw new Error('profile row did not appear')
const row = page.locator(`[data-profile-id="${profileId}"]`)

const dataDir = (await page.evaluate(() => window.boiler.dataDir())).value
const chromeDir = path.join(dataDir, 'personas', SLUG, 'profiles', profileId, 'chrome')

console.log('=== open profile')
await row.getByRole('button', { name: 'Open', exact: true }).click()
await page.waitForTimeout(6000)

console.log('=== navigate it to', URL)
// Same --user-data-dir, so Chrome hands the URL to the running instance.
spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--user-data-dir=${chromeDir}`, URL],
  { stdio: 'ignore', detached: true }
).unref()
await new Promise((r) => setTimeout(r, 7000))
const before = chromeTitle(chromeDir)
console.log('title before close:', JSON.stringify(before))
if (!before.includes('Example')) fail.push(`navigation did not take effect (title: ${before})`)

console.log('=== close via the app')
await row.getByRole('button', { name: 'Close' }).click()
await page.waitForTimeout(9000)
console.log('chrome gone:', chromeTitle(chromeDir) === '')

console.log('=== reopen')
await row.getByRole('button', { name: 'Open', exact: true }).click()
await page.waitForTimeout(9000)
const after = chromeTitle(chromeDir)
console.log('title after reopen:', JSON.stringify(after))
if (!after.includes('Example')) {
  fail.push(`tabs did NOT restore — expected the Example page, got ${JSON.stringify(after)}`)
}

console.log('=== cleanup')
await row.getByRole('button', { name: 'Close' }).click()
await page.waitForTimeout(9000)
await row.getByRole('button', { name: 'Delete', exact: true }).click()
await row.getByRole('button', { name: 'Confirm delete' }).click()
await page.waitForTimeout(1500)

console.log('\nFAILURES:', fail.length ? JSON.stringify(fail, null, 2) : 'none')
await app.close()
process.exit(fail.length ? 1 : 0)
