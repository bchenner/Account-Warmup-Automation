import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises'
// (writeFile is reused by seedPreferences below.)
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { parse, stringify } from 'yaml'
import {
  AccountSchema,
  PersonaSchema,
  ProfileSchema,
  type Account,
  type Persona,
  type Profile
} from '@shared/schemas'
import { getDataRoot, loadProxyPool } from './store'
import { resolveEgressIp } from './proxy-verify'

const personasRoot = (): string => join(getDataRoot(), 'personas')
const personaDir = (slug: string): string => join(personasRoot(), slug)
const profileDir = (slug: string, id: string): string => join(personaDir(slug), 'profiles', id)
/** The Chrome --user-data-dir. This directory IS the account's identity. */
export const chromeDir = (slug: string, id: string): string => join(profileDir(slug, id), 'chrome')

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, contents, 'utf8')
  await rename(tmp, path)
}

async function readYaml(path: string): Promise<unknown> {
  return parse(await readFile(path, 'utf8'))
}

async function listDirs(path: string): Promise<string[]> {
  if (!existsSync(path)) return []
  const entries = await readdir(path, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export async function listPersonas(): Promise<Persona[]> {
  const out: Persona[] = []
  for (const slug of await listDirs(personasRoot())) {
    const file = join(personaDir(slug), 'persona.yaml')
    if (!existsSync(file)) continue
    out.push(PersonaSchema.parse(await readYaml(file)))
  }
  return out
}

export async function upsertPersona(persona: Persona): Promise<Persona> {
  const parsed = PersonaSchema.parse(persona)
  await writeAtomic(join(personaDir(parsed.slug), 'persona.yaml'), stringify(parsed))
  return parsed
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function listProfiles(): Promise<Profile[]> {
  const out: Profile[] = []
  for (const slug of await listDirs(personasRoot())) {
    for (const id of await listDirs(join(personaDir(slug), 'profiles'))) {
      const file = join(profileDir(slug, id), 'profile.yaml')
      if (!existsSync(file)) continue
      out.push(ProfileSchema.parse(await readYaml(file)))
    }
  }
  return out
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const parsed = ProfileSchema.parse(profile)
  await writeAtomic(
    join(profileDir(parsed.personaSlug, parsed.id), 'profile.yaml'),
    stringify(parsed)
  )
  return parsed
}

export async function deleteProfile(personaSlug: string, id: string): Promise<void> {
  if (isRunning(id)) throw new Error('close the browser before deleting this profile')
  // Deleting the chrome/ directory destroys the account's accumulated identity
  // (datr, sb, local storage) and no re-login restores it. The UI confirms first.
  await rm(profileDir(personaSlug, id), { recursive: true, force: true })
}

export async function nextProfileId(personaSlug: string): Promise<string> {
  const existing = await listDirs(join(personaDir(personaSlug), 'profiles'))
  let max = 0
  for (const id of existing) {
    const m = /-(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${personaSlug}-${String(max + 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Accounts (per profile)
// ---------------------------------------------------------------------------

export async function listAccounts(personaSlug: string, id: string): Promise<Account[]> {
  const dir = join(profileDir(personaSlug, id), 'accounts')
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml'))
  const out: Account[] = []
  for (const f of files) out.push(AccountSchema.parse(await readYaml(join(dir, f))))
  return out
}

// ---------------------------------------------------------------------------
// Launching real Chrome
// ---------------------------------------------------------------------------

/** The user-data-dir is tracked alongside the child because it, not the pid, is
 * what reliably identifies the browser process at shutdown. */
const running = new Map<string, { child: ChildProcess; userDataDir: string }>()

export function isRunning(profileId: string): boolean {
  return running.has(profileId)
}

export function runningIds(): string[] {
  return [...running.keys()]
}

/** Real Chrome, not Chromium — the fingerprint we present should be a real one. */
export function findChrome(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
          join(
            process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
            'Google/Chrome/Application/chrome.exe'
          ),
          join(process.env['LOCALAPPDATA'] ?? '', 'Google/Chrome/Application/chrome.exe')
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']

  return candidates.find((p) => p && existsSync(p)) ?? null
}

export type LaunchResult = { egressIp: string | null; direct: boolean }

/**
 * Flags that let a warmup session run without taking over the operator's
 * screen.
 *
 * Input is already non-intrusive without any of this: the driver dispatches
 * mouse and keyboard over CDP, which goes straight to the browser target. The
 * real cursor never moves, keyboard focus is never taken, and typing cannot
 * land in whatever the operator is doing. Measured: the page still sees
 * `isTrusted === true` on both.
 *
 * What these solve is the window being *visible*. Position it off-screen and
 * Chrome may treat it as occluded — clamping timers to 1/sec, starving
 * requestAnimationFrame and pausing video. Watch-to-completion is a core
 * warmup action, so a throttled session would silently do nothing.
 *
 * ⚠️ Measured at 60fps / 10 timers-per-sec / video playing with these present.
 * The measurement could NOT prove they are each necessary, because Playwright
 * injects three of them by default and the driver-launched comparison was
 * therefore not flag-free. They are passed explicitly rather than inherited
 * from a driver's undocumented defaults — and CalculateNativeWinOcclusion is
 * not in Playwright's set at all.
 */
export const BACKGROUND_ARGS = [
  '--window-position=-32000,-32000',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion'
]

// Tab restore is handled by the --restore-last-session launch flag, not by
// editing Preferences.
//
// `session.restore_on_startup` is a PROTECTED preference on Windows: Chrome
// HMAC-validates it against Secure Preferences, so writing it by hand reads
// back correctly once and is then silently reset to the default on the next
// launch. Measured, not assumed — the value came back empty after a second
// run. The flag achieves the same thing per launch, needs no tampering, and
// applies to profiles created before this existed.

export async function launchProfile(
  profile: Profile,
  opts: { background?: boolean } = {}
): Promise<LaunchResult> {
  if (isRunning(profile.id)) throw new Error('this profile is already open')

  const chrome = findChrome()
  if (!chrome) throw new Error('Google Chrome not found — install it, or set the path in settings')

  let proxyArg: string | null = null
  let egressIp: string | null = null

  if (profile.proxyId) {
    const pool = await loadProxyPool()
    const proxy = pool.proxies.find((p) => p.id === profile.proxyId)
    if (!proxy) throw new Error(`assigned proxy ${profile.proxyId} is no longer in the pool`)
    if (!proxy.lastVerification?.ok) {
      throw new Error(`${proxy.id} has not passed verification — verify it before opening a profile`)
    }

    // Fail-closed pre-flight. If this throws, nothing launches — the browser
    // must never fall back to the real IP.
    try {
      egressIp = await resolveEgressIp(proxy)
    } catch (err) {
      throw new Error(`proxy pre-flight failed, refusing to open: ${(err as Error).message}`)
    }

    const expected = proxy.lastVerification.egressIp
    if (expected && egressIp !== expected) {
      throw new Error(
        `IP changed: verified as ${expected}, now ${egressIp}. The vendor has reassigned it — re-verify and decide whether to accept or replace it before opening.`
      )
    }

    proxyArg = `http://${proxy.host}:${proxy.port}`
  } else if (!profile.allowDirect) {
    throw new Error(
      'no proxy assigned. Assign one, or explicitly enable direct connection on this profile if you accept exposing your real IP.'
    )
  }

  const userDataDir = chromeDir(profile.personaSlug, profile.id)
  await mkdir(userDataDir, { recursive: true })

  const args = [
    `--user-data-dir=${userDataDir}`,
    // A real monitor-shaped window. Playwright's 1280x720 default is not one.
    `--window-size=${profile.fingerprint.windowWidth},${profile.fingerprint.windowHeight}`,
    `--lang=${profile.fingerprint.locale}`,
    // Reopen whatever was open when the profile was last closed. Harmless on a
    // profile's first ever launch, when there is no previous session.
    '--restore-last-session',
    '--no-first-run',
    '--no-default-browser-check',
    // Warmup sessions run off-screen so they do not take over the operator's
    // display. Manual "Open" never does — that window is meant to be used.
    ...(opts.background ? BACKGROUND_ARGS : []),
    // Deliberately absent: --user-agent. It does not update
    // navigator.userAgentData or the Sec-CH-UA headers, and that desync is the
    // canonical detection.
    ...(proxyArg
      ? [
          `--proxy-server=${proxyArg}`,
          // STUN runs over UDP outside the HTTP stack, so --proxy-server does
          // not carry it. Without this the real IP leaks straight past.
          '--webrtc-ip-handling-policy=disable_non_proxied_udp',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
        ]
      : [])
  ]

  const child = spawn(chrome, args, {
    detached: false,
    stdio: 'ignore',
    // TZ is process-level, so Date and Intl agree with the proxy's country
    // without anything being injected into the page.
    env: { ...process.env, TZ: profile.fingerprint.timezone }
  })

  running.set(profile.id, { child, userDataDir })
  child.on('exit', () => running.delete(profile.id))

  await saveProfile({ ...profile, lastUsedAt: new Date().toISOString() })
  return { egressIp, direct: !proxyArg }
}

/**
 * Ask Chrome to close rather than terminating it.
 *
 * Node's child.kill() calls TerminateProcess on Windows, which is a hard kill:
 * Chrome never runs its shutdown path, so the open tabs are not written to the
 * session file and the next launch shows "Chrome didn't shut down correctly".
 * `taskkill` without /F posts WM_CLOSE instead, which is the same thing that
 * happens when the operator clicks the window's X.
 */
export function stopProfile(profileId: string): void {
  const entry = running.get(profileId)
  if (!entry) return
  const { child, userDataDir } = entry

  if (process.platform !== 'win32') {
    child.kill('SIGTERM')
    return
  }

  // CloseMainWindow posts WM_CLOSE to the browser window — exactly what the
  // operator clicking the X does, so Chrome saves its open tabs and records a
  // clean exit. A hard kill (TerminateProcess, which child.kill() uses on
  // Windows, or `taskkill /F`) skips the shutdown path: tabs are lost and the
  // next launch reports that Chrome didn't shut down correctly.
  //
  // Targeted by --user-data-dir rather than by our child's pid: that directory
  // is unique to this profile, and Chrome's launcher does not always remain the
  // process that owns the window.
  const dir = userDataDir.replace(/'/g, "''")
  spawn(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |` +
        ` Where-Object { $_.CommandLine -like '*${dir}*' } |` +
        ` ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue;` +
        ` if ($p -and $p.MainWindowHandle -ne 0) { $null = $p.CloseMainWindow() } }`
    ],
    { stdio: 'ignore' }
  )

  // Only if it is genuinely wedged.
  const pid = child.pid
  setTimeout(() => {
    if (running.has(profileId) && pid) {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    }
  }, 10_000)
}

export function stopAll(): void {
  for (const id of [...running.keys()]) stopProfile(id)
}
