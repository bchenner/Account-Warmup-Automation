import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises'
// (writeFile is reused by seedPreferences below.)
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { chromium, type Browser, type CDPSession, type Page } from 'patchright'
import { parse, stringify } from 'yaml'
import { ZodError } from 'zod'
import {
  AccountSchema,
  PersonaSchema,
  ProfileSchema,
  type Account,
  type Persona,
  type Profile
} from '@shared/schemas'
import { decryptSecret, getDataRoot, loadProxyPool } from './store'
import { resolveEgressIp } from './proxy-verify'
import { startRelay, type RelayHandle } from './relay'
import { BACKGROUND_ARGS } from '@shared/chrome-args'

export { BACKGROUND_ARGS }

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
    // Still fails rather than half-loading — but an opaque zod error gives the
    // operator nothing to act on, and this is a file they can open and fix.
    try {
      out.push(PersonaSchema.parse(await readYaml(file)))
    } catch (err) {
      const detail =
        err instanceof ZodError
          ? err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
          : (err as Error).message
      throw new Error(`${file} is not a valid persona — ${detail}`)
    }
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
const running = new Map<
  string,
  { child: ChildProcess; userDataDir: string; relay?: RelayHandle; cdp?: Browser }
>()

/**
 * Make the browser's clock agree with the IP it appears from.
 *
 * Chrome has no timezone flag, and the TZ environment variable does NOT work
 * on Windows: measured against a Mesa, Arizona proxy, a child spawned with
 * TZ=America/Phoenix still reported Europe/Berlin, this machine's own zone.
 * Windows ICU reads the OS setting and ignores TZ entirely. A US IP paired
 * with a European clock is precisely the incoherence worth avoiding, and it
 * lands hardest at signup, which happens in this window.
 *
 * CDP's Emulation.setTimezoneOverride does work, so the browser is spawned with
 * a loopback debugging port and the override is applied to every tab, including
 * ones opened later.
 *
 * patchright's connector is used rather than plain Playwright's on purpose: it
 * omits the Runtime.enable call that is itself a well-known detection signal.
 */
async function overrideTimezone(
  userDataDir: string,
  timezoneId: string
): Promise<Browser> {
  // Chrome writes the port it actually bound on the first line of this file.
  //
  // The caller deletes it before spawning, which is not optional: Chrome leaves
  // the file behind on exit, so the second launch of a profile would otherwise
  // read the PREVIOUS run's port and connect to nothing (measured: ECONNREFUSED
  // on relaunch, with a port from the run before).
  const portFile = join(userDataDir, 'DevToolsActivePort')
  let port: string | undefined
  for (let i = 0; i < 150 && !port; i++) {
    try {
      const [line] = (await readFile(portFile, 'utf8')).split('\n')
      if (line?.trim()) port = line.trim()
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  if (!port) throw new Error('Chrome never reported a debugging port')

  // The file appears a moment before the endpoint accepts connections.
  let browser: Browser | undefined
  for (let i = 0; i < 40 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch (err) {
      if (i === 39) throw err
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!browser) throw new Error(`could not attach to Chrome on port ${port}`)
  const context = browser.contexts()[0]
  if (!context) throw new Error('Chrome exposed no browsing context')

  // An Emulation override lives only as long as the CDP session that set it —
  // detaching reverts it, measured as a new tab falling back to the host zone.
  // The sessions are therefore held for the tab's lifetime, and released with
  // it so a long-lived window does not accumulate them.
  const sessions = new Set<CDPSession>()
  const apply = async (page: Page): Promise<void> => {
    const session = await context.newCDPSession(page)
    await session.send('Emulation.setTimezoneOverride', { timezoneId })
    sessions.add(session)
    page.once('close', () => {
      sessions.delete(session)
      void session.detach().catch(() => undefined)
    })
  }

  // Tabs restored from the last session exist before this runs; tabs the
  // operator opens later do not, and an un-overridden tab would report the
  // host's zone.
  await Promise.all(context.pages().map((p) => apply(p).catch(() => undefined)))
  context.on('page', (p) => void apply(p).catch(() => undefined))
  return browser
}

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
  let relay: RelayHandle | undefined

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
      egressIp = await resolveEgressIp(proxy, {
        username: proxy.username,
        password: decryptSecret(proxy.passwordEnc)
      })
    } catch (err) {
      throw new Error(`proxy pre-flight failed, refusing to open: ${(err as Error).message}`)
    }

    const expected = proxy.lastVerification.egressIp
    if (expected && egressIp !== expected) {
      throw new Error(
        `IP changed: verified as ${expected}, now ${egressIp}. The vendor has reassigned it — re-verify and decide whether to accept or replace it before opening.`
      )
    }

    // Chrome cannot authenticate to a proxy, so a credentialed upstream is
    // reached through a loopback relay that adds the header. Verified against
    // a live proxy: the TLS fingerprint is identical through the relay, so the
    // genuine ClientHello survives.
    const password = decryptSecret(proxy.passwordEnc)
    if (proxy.username && !password) {
      throw new Error(
        `${proxy.id} has a username but its stored password could not be decrypted — re-enter it`
      )
    }
    if (proxy.username && password) {
      relay = await startRelay({
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password
      })
      proxyArg = `http://127.0.0.1:${relay.port}`
    } else {
      proxyArg = `http://${proxy.host}:${proxy.port}`
    }
  } else if (!profile.allowDirect) {
    throw new Error(
      'no proxy assigned. Assign one, or explicitly enable direct connection on this profile if you accept exposing your real IP.'
    )
  }

  const userDataDir = chromeDir(profile.personaSlug, profile.id)
  await mkdir(userDataDir, { recursive: true })

  // Chrome does not clean this up on exit, so a leftover from the last run
  // would be read as if it belonged to this one. Removing it first makes the
  // file's reappearance the signal that THIS browser is listening.
  await rm(join(userDataDir, 'DevToolsActivePort'), { force: true })

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
    // Loopback only, and port 0 so it never collides with a second profile.
    // This exists solely to carry the timezone override; see overrideTimezone.
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
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
    // TZ is set for the sake of anything outside the renderer that reads it,
    // but it does NOT reach the page on Windows — overrideTimezone is what
    // actually makes Date and Intl agree with the proxy.
    env: { ...process.env, TZ: profile.fingerprint.timezone }
  })

  running.set(profile.id, { child, userDataDir, relay })
  child.on('exit', () => {
    // The relay exists only for this browser; leaving it listening would keep
    // an authenticated proxy open on loopback.
    void running.get(profile.id)?.relay?.close()
    void running.get(profile.id)?.cdp?.close().catch(() => undefined)
    running.delete(profile.id)
  })

  // Fail closed, as with the proxy pre-flight. Opening on a US IP while the
  // browser reports the operator's own European clock is the exact mismatch
  // this profile exists to avoid, so a failure here closes the browser rather
  // than leaving it open and quietly incoherent.
  try {
    const cdp = await overrideTimezone(userDataDir, profile.fingerprint.timezone)
    const entry = running.get(profile.id)
    if (entry) entry.cdp = cdp
  } catch (err) {
    stopProfile(profile.id)
    throw new Error(
      `could not set the browser timezone to ${profile.fingerprint.timezone}, closing: ${(err as Error).message}`
    )
  }

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

// ---------------------------------------------------------------------------
// Accounts, written
// ---------------------------------------------------------------------------

const accountFile = (slug: string, id: string, platform: string): string =>
  join(profileDir(slug, id), 'accounts', `${platform}.yaml`)

export async function saveAccount(
  personaSlug: string,
  profileId: string,
  account: Account
): Promise<Account> {
  const parsed = AccountSchema.parse(account)
  await writeAtomic(
    accountFile(personaSlug, profileId, parsed.platform),
    stringify(parsed)
  )
  return parsed
}

export async function getAccount(
  personaSlug: string,
  profileId: string,
  platform: string
): Promise<Account | null> {
  const file = accountFile(personaSlug, profileId, platform)
  if (!existsSync(file)) return null
  return AccountSchema.parse(await readYaml(file))
}

export async function deleteAccount(
  personaSlug: string,
  profileId: string,
  platform: string
): Promise<void> {
  await rm(accountFile(personaSlug, profileId, platform), { force: true })
}

/** Every handle the fleet owns — never followed by any of our own accounts. */
export async function managedHandles(): Promise<Set<string>> {
  const out = new Set<string>()
  for (const profile of await listProfiles()) {
    for (const a of await listAccounts(profile.personaSlug, profile.id)) {
      if (a.username) out.add(a.username.startsWith('@') ? a.username : `@${a.username}`)
    }
  }
  return out
}
