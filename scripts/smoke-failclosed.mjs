// Asserts the safety property: a profile with no proxy and no explicit
// real-IP opt-in must REFUSE to open. Also cleans up the smoke fixtures.
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

console.log('=== create a profile with NO proxy and NO opt-in')
await page.getByRole('button', { name: 'New profile' }).click()
await page.getByPlaceholder('Maya · Instagram').fill('Fail Closed')
await page.getByPlaceholder('Maya', { exact: true }).fill('Fail Closed')
await page.getByPlaceholder('home fitness').fill('safety check')
// Deliberately do NOT tick the real-IP checkbox.
await page.getByRole('button', { name: 'Create profile' }).click()
await page.waitForTimeout(1000)

console.log('=== click Open — expect a refusal, not a browser')
const row = page.locator('[data-profile-id="fail-closed-01"]')
await row.getByRole('button', { name: 'Open', exact: true }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: path.join(APP_DIR, '.shots', '09-fail-closed.png') })

const body = await page.locator('body').innerText()
const refused = body.includes('no proxy assigned')
console.log('REFUSED:', refused)
console.log(body.split('\n').filter((l) => l.includes('proxy assigned')).join('\n'))

console.log('\n=== cleanup: delete both smoke profiles (two-step confirm)')
for (let i = 0; i < 6; i++) {
  const del = page.getByRole('button', { name: 'Delete', exact: true })
  if ((await del.count()) === 0) break
  await del.first().click()
  await page.getByRole('button', { name: 'Confirm delete' }).first().click()
  await page.waitForTimeout(900)
}
console.log(await page.locator('body').innerText())

const dataDir = (await page.evaluate(() => window.boiler.dataDir())).value
console.log('personas dir remaining:', fs.existsSync(path.join(dataDir, 'personas')))

await app.close()
process.exit(refused ? 0 : 1)
