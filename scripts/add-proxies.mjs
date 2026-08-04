// Bulk-adds proxies through the app's own IPC, then verifies each one.
//
//   node scripts/add-proxies.mjs <file-of-ip:port:user:pass-lines>
//
// Going through the app rather than writing data/proxies.yaml by hand is the
// point: passwords are sealed with Electron safeStorage (DPAPI on Windows), and
// that key only exists inside the main process. A hand-written YAML would put
// them on disk in plaintext.
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const listFile = process.argv[2]
if (!listFile) {
  console.error('usage: node scripts/add-proxies.mjs <file>')
  process.exit(1)
}
const text = fs.readFileSync(listFile, 'utf8')

const electronBin =
  process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

// Inherited from an Electron parent (an editor, an embedded terminal), this
// makes electron.exe run as plain Node and the app dies on startup.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.BOILER_ALLOW_MULTI = '1'

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', APP_DIR],
  env,
  timeout: 30_000
})
// A main-process crash mid-verification otherwise surfaces only as "target
// closed", which says nothing about the cause.
app.process().stderr?.on('data', (d) => process.stderr.write(`[main] ${d}`))
app.on('close', () => console.error('[main] the app exited'))

const page = await app.firstWindow()
await page.waitForSelector('#root > *', { timeout: 20_000 })

// Every IPC call comes back as a Result — a rejection crossing the boundary
// arrives as an opaque string, so failures are values here.
const unwrap = (r, what) => {
  if (!r?.ok) throw new Error(`${what} failed: ${r?.error ?? JSON.stringify(r)}`)
  return r.value
}

const added = unwrap(
  await page.evaluate(([body]) => window.boiler.addProxyBatch(body, { country: 'US' }), [text]),
  'addProxyBatch'
)
console.log('added:  ', added.added.map((p) => `${p.id} ${p.host}:${p.port}`).join('\n         ') || '(none)')
if (added.skipped.length) console.log('skipped:', added.skipped.join('\n         '))

// Verify every proxy in the pool, not just the newly added ones — a proxy that
// was already there and has since drifted is exactly what verification is for.
const pool = unwrap(await page.evaluate(() => window.boiler.listProxies()), 'listProxies')
for (const p of pool) {
  const v = unwrap(await page.evaluate((id) => window.boiler.verifyProxy(id), p.id), `verify ${p.id}`)
  console.log(
    [
      v.ok ? 'PASS' : 'FAIL',
      `${p.host}:${p.port}`.padEnd(22),
      (v.egressIp ?? '-').padEnd(16),
      [v.city, v.region, v.country].filter(Boolean).join(', ').padEnd(30),
      v.classification.padEnd(8),
      `ja3 ${v.tls?.matches === true ? 'same' : v.tls?.matches === false ? 'DIFFERS' : '?'}`,
      v.org ?? ''
    ].join(' ')
  )
  for (const problem of v.problems) console.log('       -', problem)
}

await app.close()
process.exit(0)
