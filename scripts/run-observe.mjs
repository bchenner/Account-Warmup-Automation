// Runs one real warmup session, through the app, on a named profile.
//
//   node scripts/run-observe.mjs <profileId> <platform> [level]
//
// Everything goes through the app's own IPC, so this exercises the same path
// the Run warmup button does — including the fail-closed proxy pre-flight and
// the timezone override.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'

const [profileId, platform, level = 'observe'] = process.argv.slice(2)
if (!profileId || !platform) {
  console.error('usage: node scripts/run-observe.mjs <profileId> <platform> [level]')
  process.exit(1)
}

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

const rows = await call(() => window.boiler.listProfiles(), null, 'listProfiles')
const row = rows.find((r) => r.id === profileId)
if (!row) throw new Error(`no such profile: ${profileId} (have ${rows.map((r) => r.id).join(', ')})`)
console.log(`profile ${row.id} "${row.name}"  persona=${row.personaSlug}`)
console.log(`  proxy ${row.proxyLabel ?? 'DIRECT'}${row.proxyVerified ? ' (verified)' : ''}`)
console.log(`  tz ${row.fingerprint.timezone}  locale ${row.fingerprint.locale}`)

if (!row.accounts.some((a) => a.platform === platform)) {
  console.log(`\nadding a ${platform} account`)
  await call(
    ([id, slug, p]) => window.boiler.addAccount({ personaSlug: slug, profileId: id, platform: p }),
    [row.id, row.personaSlug, platform],
    'addAccount'
  )
}

// A session refuses to run on an unregistered account. The username is only a
// label at this level — `observe` never touches the profile — so an explicit
// one can be passed in, and BOILER_USERNAME makes it obvious in the record that
// it was set here rather than read off the real account.
const account = row.accounts.find((a) => a.platform === platform)
const username = process.env.BOILER_USERNAME || account?.username || null
await call(
  ([id, slug, p, l, u]) =>
    window.boiler.updateAccount(slug, id, p, {
      level: l,
      ...(u ? { username: u, registered: true } : {})
    }),
  [row.id, row.personaSlug, platform, level, username],
  'set level'
)
if (username && username !== account?.username) {
  console.log(`  username recorded as "${username}" — correct it in the UI if that is not it`)
}

const plan = await call(
  ([id, slug, p]) => window.boiler.sessionPlan(slug, id, p),
  [row.id, row.personaSlug, platform],
  'sessionPlan'
)
console.log(`\n${platform} / ${plan.level}: session ${plan.next}/${plan.total} · ${plan.estimate}`)
console.log(`  ${plan.label}`)

console.log('\nrunning — the browser is off-screen and will not take focus…')
const started = Date.now()
const result = await call(
  ([id, slug, p]) => window.boiler.runSession(slug, id, p),
  [row.id, row.personaSlug, platform],
  'runSession'
)
const secs = ((Date.now() - started) / 1000).toFixed(0)

console.log(`\ncompleted: ${result.completed}  (${secs}s)  egress ${result.egressIp ?? 'DIRECT'}`)
for (const s of result.steps ?? []) {
  console.log(`  ${s.action.padEnd(16)} seen=${String(s.seen).padEnd(4)} engaged=${s.engaged}  ${s.detail}`)
}
if (result.error) console.log(`\nABORTED: ${result.error}`)

const after = await call(
  ([id, slug, p]) => window.boiler.sessionPlan(slug, id, p),
  [row.id, row.personaSlug, platform],
  'sessionPlan'
)
console.log(`\nnext: session ${after.next}/${after.total} — ${after.label}`)

await app.close()
process.exit(result.completed ? 0 : 1)
