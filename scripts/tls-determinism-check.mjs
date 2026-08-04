// Is verifyProxy's TLS check deterministic?
//
// Calls the app's own verifyProxy five times against the SAME proxy and prints
// both fingerprints it recorded each time. directJa3 is measured with no proxy
// in the path at all, so if that value varies between calls, the client's own
// ClientHello is changing and the direct-vs-proxied comparison cannot mean what
// it claims to.
import { _electron as electron } from 'playwright-core'
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

const unwrap = (r, what) => {
  if (!r?.ok) throw new Error(`${what} failed: ${r?.error ?? JSON.stringify(r)}`)
  return r.value
}

const pool = unwrap(await page.evaluate(() => window.boiler.listProxies()), 'listProxies')
const target = pool[0]
console.log(`probing ${target.host}:${target.port} five times\n`)

const direct = new Set()
const proxied = new Set()
for (let i = 1; i <= 5; i++) {
  const v = unwrap(await page.evaluate((id) => window.boiler.verifyProxy(id), target.id), 'verify')
  direct.add(v.tls?.directJa3 ?? 'null')
  proxied.add(v.tls?.proxiedJa3 ?? 'null')
  console.log(`#${i} ${v.ok ? 'PASS' : 'FAIL'}  matches=${v.tls?.matches}`)
  console.log(`   direct  ${v.tls?.directJa3}`)
  console.log(`   proxied ${v.tls?.proxiedJa3}`)
}

console.log(`\ndistinct directJa3 across 5 runs:  ${direct.size}`)
console.log(`distinct proxiedJa3 across 5 runs: ${proxied.size}`)
console.log(
  direct.size > 1
    ? '\n=> the CLIENT fingerprint is not stable; the comparison is meaningless'
    : '\n=> client fingerprint is stable; differences would be attributable to the proxy'
)

await app.close()
process.exit(0)
