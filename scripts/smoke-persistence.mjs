// Asserts the profile is a real persistent Chrome profile, not an incognito
// session: tabs are restored on next launch, and the editor round-trips.
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

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
const page = await app.firstWindow()
await page.waitForSelector('#root > *', { timeout: 20_000 })
const fail = []

console.log('=== create a profile')
await page.getByRole('button', { name: 'New profile' }).click()
await page.getByPlaceholder('Maya · Instagram').fill('Persist Test')
await page.getByPlaceholder('Maya', { exact: true }).fill('Persist Test')
await page.getByPlaceholder('home fitness').fill('persistence')
await page.getByRole('checkbox').check()
await page.getByRole('button', { name: 'Create profile' }).click()
await page.waitForTimeout(1000)

// Resolve the id rather than assuming it: numbering depends on what already
// exists under the persona, and the operator's own profiles share this store.
const profileId = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-profile-id]')].find((e) =>
    e.textContent?.includes('Persist Test')
  )
  return el?.getAttribute('data-profile-id') ?? null
})
console.log('created profile id:', profileId)
if (!profileId) throw new Error('profile row did not appear after creation')
const row = page.locator(`[data-profile-id="${profileId}"]`)
const slug = 'persist-test'

console.log('\n=== open it, then inspect the Chrome profile on disk')
await row.getByRole('button', { name: 'Open', exact: true }).click()
await page.waitForTimeout(5000)

const dataDir = (await page.evaluate(() => window.boiler.dataDir())).value
const chromeDir = path.join(dataDir, 'personas', slug, 'profiles', profileId, 'chrome')
const prefsPath = path.join(chromeDir, 'Default', 'Preferences')

// Tab restore is covered behaviourally by smoke-tabrestore.mjs. It is NOT
// asserted here as a preference value: session.restore_on_startup is a
// protected pref that Chrome resets if written by hand, so the launcher uses
// the --restore-last-session flag instead.

// A persistent profile keeps these on disk; an incognito session has no store
// at all. Modern Chrome keeps cookies under Default/Network/, not Default/.
// Preferences is deliberately not in this list: Chrome writes it on exit, so
// mid-run absence is expected. The post-close read below proves it exists.
for (const f of ['Network/Cookies', 'Local Storage', 'History']) {
  const p = path.join(chromeDir, 'Default', ...f.split('/'))
  const found = fs.existsSync(p)
  console.log(`${f}:`, found ? 'present' : 'ABSENT')
  if (!found) fail.push(`${f} missing — profile is not persisting to disk`)
}
console.log('Local State present:', fs.existsSync(path.join(chromeDir, 'Local State')))

console.log('\n=== close gracefully, then check the exit was recorded as clean')
await row.getByRole('button', { name: 'Close' }).click()
await page.waitForTimeout(6000)
const after = JSON.parse(fs.readFileSync(prefsPath, 'utf8'))
console.log('profile.exit_type:', after.profile?.exit_type)
if (after.profile?.exit_type !== 'Normal') {
  fail.push(`exit_type is ${after.profile?.exit_type}, expected Normal (a hard kill records Crashed)`)
}

console.log('\n=== edit the profile and confirm it round-trips')
await row.getByRole('button', { name: 'Edit' }).click()
await page.waitForTimeout(400)
await row.getByPlaceholder('notes').fill('edited note')
await row.getByRole('button', { name: 'Save changes' }).click()
await page.waitForTimeout(1200)
const body = await page.locator('body').innerText()
console.log('note visible in list:', body.includes('edited note'))
if (!body.includes('edited note')) fail.push('edited note did not persist to the list')

const saved = fs.readFileSync(
  path.join(dataDir, 'personas', slug, 'profiles', profileId, 'profile.yaml'),
  'utf8'
)
console.log('profile.yaml notes line:', saved.split('\n').find((l) => l.startsWith('notes:')))

console.log('\n=== cleanup')
await row.getByRole('button', { name: 'Delete', exact: true }).click()
await row.getByRole('button', { name: 'Confirm delete' }).click()
await page.waitForTimeout(1000)

console.log('\nFAILURES:', fail.length ? JSON.stringify(fail, null, 2) : 'none')
await app.close()
process.exit(fail.length ? 1 : 0)
