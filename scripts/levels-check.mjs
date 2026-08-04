// Does the app resolve a different programme per level, through real IPC?
//
//   node scripts/levels-check.mjs
//
// The unit tests read the YAML directly. This goes through the app: create a
// profile, add an account, move it up the levels, and confirm the plan the UI
// would show actually changes — including that the session counter resets,
// since carrying it across would drop an account into follows it never ramped
// up to.
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
app.process().stderr?.on('data', (d) => process.stderr.write(`[main] ${d}`))
const page = await app.firstWindow()
await page.waitForSelector('#root > *', { timeout: 20_000 })

const call = async (fn, arg, what) => {
  const r = await page.evaluate(fn, arg)
  if (!r?.ok) throw new Error(`${what}: ${r?.error ?? JSON.stringify(r)}`)
  return r.value
}

const failures = []
const check = (label, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`)
  if (!cond) failures.push(label)
}

let created
try {
  created = await call(
    () =>
      window.boiler.createProfile({
        personaName: 'levelcheck',
        name: 'level check',
        niche: 'cooking',
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
  check('the niche survives as a valid key', created.personaSlug === 'levelcheck')

  for (const platform of ['instagram', 'facebook']) {
    await call(
      ([id, p]) => window.boiler.addAccount({ personaSlug: 'levelcheck', profileId: id, platform: p }),
      [created.id, platform],
      `addAccount ${platform}`
    )
    await call(
      ([id, p]) =>
        window.boiler.updateAccount('levelcheck', id, p, {
          username: 'levelcheck',
          registered: true
        }),
      [created.id, platform],
      `register ${platform}`
    )
  }

  let PLATFORM = 'instagram'
  const planFor = async () =>
    call(
      ([id, p]) => window.boiler.sessionPlan('levelcheck', id, p),
      [created.id, PLATFORM],
      'sessionPlan'
    )

  // A newly added account must land on the most cautious level, not the one
  // that would edit an aged account's profile.
  const first = await planFor()
  check('a new account defaults to observe', first.level === 'observe', JSON.stringify(first.level))

  for (const platform of ['instagram', 'facebook']) {
    PLATFORM = platform
    const seen = {}
    for (const level of ['observe', 'reorient', 'light', 'standard', 'establish']) {
      await call(
        ([id, l, p]) => window.boiler.updateAccount('levelcheck', id, p, { level: l }),
        [created.id, level, platform],
        `setLevel ${platform}/${level}`
      )
      const plan = await planFor()
      seen[level] = plan.total
      check(
        `${platform}/${level}: reports its level and restarts at session 1`,
        plan.level === level && plan.next === 1,
        `next=${plan.next} total=${plan.total} — ${plan.label}`
      )
    }
    check(
      `${platform}: the levels are genuinely different programmes`,
      new Set(Object.values(seen)).size > 1,
      `session counts: ${JSON.stringify(seen)}`
    )
  }
} finally {
  if (created) {
    let removed = false
    for (let i = 0; i < 10 && !removed; i++) {
      const r = await page
        .evaluate(([s, i2]) => window.boiler.deleteProfile(s, i2), [created.personaSlug, created.id])
        .catch(() => null)
      removed = r?.ok === true
      if (!removed) await new Promise((res) => setTimeout(res, 800))
    }
    if (!removed) console.error(`WARNING: could not remove ${created.id}`)
  }
  await app.close()
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
