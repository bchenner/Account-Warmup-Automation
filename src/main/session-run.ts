import { chromium, type BrowserContext } from 'patchright'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { app } from 'electron'
import { ScriptSchema, planSessions, type PlannedSession, type Script } from '@shared/session'
import { SelectorSetSchema } from '@shared/selectors'
import { withPersonality } from '@shared/content'
import { NICHES, NICHE_KEYS, coerceNiche, searchTermsFor } from '@shared/niches'
import { emojiHabitFor } from '@shared/emoji'
import type { Account, Level, Persona, Profile } from '@shared/schemas'
import { runSession, type SessionReport } from './runner'
import { BACKGROUND_ARGS, chromeDir, findChrome } from './profiles'
import { decryptSecret, loadProxyPool } from './store'
import { resolveEgressIp } from './proxy-verify'
import { startRelay, type RelayHandle } from './relay'

/**
 * Orchestrates one warmup session: resolve the script and selectors, launch the
 * profile with its proxy, hand off to the runner, and tear everything down.
 *
 * The session counter is advanced by the CALLER, and only on a completed
 * session. An aborted session must leave the counter alone, or the account's
 * recorded progress runs ahead of what actually happened to it.
 */

/**
 * Warmup programmes and selectors ship with the app as data, not as code —
 * the operator never runs them, and never sees them. They are files rather
 * than constants so a retune or a selector fix is an edit, not a rebuild.
 */
function assetDir(): string {
  const packaged = join(process.resourcesPath ?? '', 'warmup')
  return existsSync(packaged) ? packaged : join(app.getAppPath(), 'warmup')
}

async function readYaml(path: string): Promise<unknown> {
  return parse(await readFile(path, 'utf8'))
}

/**
 * Parsed programmes, keyed by file and invalidated on mtime.
 *
 * The scheduler asks for a plan for every account on every tick. At thirty
 * accounts and a one-minute tick that is around 43,000 YAML reads and zod
 * validations a day, for files that change when someone edits them and never
 * otherwise. Editing a programme still takes effect without a restart, because
 * the mtime moves.
 */
const scriptCache = new Map<string, { mtimeMs: number; script: Script }>()

async function loadScript(platform: string, level: Level): Promise<Script> {
  const file = join(assetDir(), platform, `${level}.yaml`)
  if (!existsSync(file)) {
    throw new Error(`no "${level}" warmup programme for ${platform} (expected ${file})`)
  }
  const { mtimeMs } = await stat(file)
  const hit = scriptCache.get(file)
  if (hit && hit.mtimeMs === mtimeMs) return hit.script

  const script = ScriptSchema.parse(await readYaml(file))
  if (script.platform !== platform) {
    throw new Error(`${file} declares platform "${script.platform}" but sits under ${platform}`)
  }
  scriptCache.set(file, { mtimeMs, script })
  return script
}

export async function loadPlan(
  platform: string,
  level: Level,
  accountId: string
): Promise<PlannedSession[]> {
  return planSessions(await loadScript(platform, level), accountId)
}

export type SessionOutcome = SessionReport & {
  sessionIndex: number
  egressIp: string | null
}

export async function runWarmupSession(args: {
  profile: Profile
  persona: Persona
  account: Account
  /** Handles belonging to the fleet, so its own accounts are never followed. */
  managedHandles: ReadonlySet<string>
  followedTargets: Set<string>
  friendedTargets: Set<string>
  joinedGroups: Set<string>
  usedComments: string[]
  usedSources: Set<string>
  claimedPosts: Set<string>
}): Promise<SessionOutcome> {
  const { profile, persona, account } = args
  const accountId = `${profile.id}:${account.platform}`

  const plan = await loadPlan(account.platform, account.level, accountId)
  // The ceiling is the union of everything the programme declares across all
  // of its sessions — not just today's — so a level that never likes cannot
  // like on the one day watch_videos decides to.
  const permitted = new Set(plan.flatMap((s) => s.steps.map((t) => t.action)))
  const session = plan[account.sessionCounter]
  if (!session) {
    throw new Error(
      `this account has finished the "${account.level}" programme (${plan.length} sessions) — move it to the next level to continue`
    )
  }

  const selectorFile = join(assetDir(), account.platform, 'selectors.yaml')
  if (!existsSync(selectorFile)) throw new Error(`no selector set for ${account.platform}`)
  const selectors = SelectorSetSchema.parse(await readYaml(selectorFile))

  const chrome = findChrome()
  if (!chrome) throw new Error('Google Chrome not found')

  // --- proxy, with the same fail-closed pre-flight a manual open uses --------
  let relay: RelayHandle | undefined
  let proxyServer: string | undefined
  let egressIp: string | null = null

  if (profile.proxyId) {
    const proxy = (await loadProxyPool()).proxies.find((p) => p.id === profile.proxyId)
    if (!proxy) throw new Error(`assigned proxy ${profile.proxyId} is no longer in the pool`)
    if (!proxy.lastVerification?.ok) throw new Error(`${proxy.id} has not passed verification`)

    const password = decryptSecret(proxy.passwordEnc)
    egressIp = await resolveEgressIp(proxy, { username: proxy.username, password })
    const expected = proxy.lastVerification.egressIp
    if (expected && egressIp !== expected) {
      throw new Error(
        `IP changed: verified as ${expected}, now ${egressIp}. Re-verify before running a session.`
      )
    }

    if (proxy.username && password) {
      relay = await startRelay({ host: proxy.host, port: proxy.port, username: proxy.username, password })
      proxyServer = `http://127.0.0.1:${relay.port}`
    } else {
      proxyServer = `http://${proxy.host}:${proxy.port}`
    }
  } else if (!profile.allowDirect) {
    throw new Error('no proxy assigned — refusing to run a session on your real IP')
  }

  // No fallback. The niche selects the taste profile that decides what this
  // account engages with, so quietly substituting one would have the account
  // build an interest graph nobody chose. PersonaSchema already constrains
  // this; if it is still wrong, the persona file is wrong and should say so.
  const nicheKey = coerceNiche(persona.niche)
  if (!nicheKey) {
    throw new Error(
      `persona "${persona.slug}" has niche "${persona.niche}", which is not one of: ${NICHE_KEYS.join(', ')}`
    )
  }

  let ctx: BrowserContext | undefined

  try {
    ctx = await chromium.launchPersistentContext(chromeDir(profile.personaSlug, profile.id), {
      executablePath: chrome,
      headless: false,
      // Sessions run off-screen. Input goes over CDP, so this never takes focus
      // or moves the operator's cursor.
      args: [
        `--window-size=${profile.fingerprint.windowWidth},${profile.fingerprint.windowHeight}`,
        `--lang=${profile.fingerprint.locale}`,
        '--restore-last-session',
        '--no-first-run',
        '--no-default-browser-check',
        ...BACKGROUND_ARGS,
        ...(proxyServer
          ? [
              '--webrtc-ip-handling-policy=disable_non_proxied_udp',
              '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'
            ]
          : [])
      ],
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
      // Applied through CDP, not the TZ environment variable — Windows ignores
      // TZ, so a process-level setting leaves the browser reporting the
      // operator's own zone while the IP says otherwise. This is kept in step
      // with the proxy automatically; see syncTimezoneFromProxy.
      timezoneId: profile.fingerprint.timezone,
      locale: profile.fingerprint.locale,
      viewport: null
    })

    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(selectors.feed.url, { waitUntil: 'domcontentloaded' })

    const report = await runSession(page, session, {
      accountId,
      taste: withPersonality(NICHES[nicheKey].taste, persona.slug),
      emoji: emojiHabitFor(persona.slug),
      niche: nicheKey,
      permitted,
      // Confirm friend requests only from where this persona says it lives.
      requireCountry: persona.country,
      selectors,
      // The niche KEY is not a search query — typing "home-fitness" into
      // Instagram finds nothing. Search the niche's own weighted interests.
      searchTerms: searchTermsFor(nicheKey),
      corpus: [],
      usedComments: args.usedComments,
      usedSources: args.usedSources,
      claimedPosts: args.claimedPosts,
      followedTargets: args.followedTargets,
      friendedTargets: args.friendedTargets,
      joinedGroups: args.joinedGroups,
      managedHandles: args.managedHandles,
      profileValues: {
        username: account.username ?? '',
        display_name: persona.displayName,
        bio: persona.bio
      }
    })

    return { ...report, sessionIndex: session.index, egressIp }
  } finally {
    await ctx?.close().catch(() => undefined)
    await relay?.close()
  }
}
