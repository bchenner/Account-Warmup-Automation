import { ipcMain } from 'electron'
import {
  CH,
  type AddAccountInput,
  type AddProxyInput,
  type CreateProfileInput,
  type Result
} from '@shared/ipc'
import {
  ProfileSchema,
  ProxySchema,
  type Account,
  type Profile,
  type ProfileRow,
  type Proxy
} from '@shared/schemas'
import { formatEstimate, nextDueAt } from '@shared/session'
import {
  encryptSecret,
  decryptSecret,
  getDataRoot,
  loadProxyPool,
  loadRegistry,
  mutateProxies,
  nextProxyId,
  saveRegistry
} from './store'
import { loadPlan, runWarmupSession } from './session-run'
import { isAssignable, verifyProxy } from './proxy-verify'
import {
  deleteAccount,
  deleteProfile,
  findChrome,
  getAccount,
  managedHandles,
  isRunning,
  launchProfile,
  listAccounts,
  listPersonas,
  listProfiles,
  nextProfileId,
  saveAccount,
  saveProfile,
  slugify,
  stopProfile,
  upsertPersona
} from './profiles'

/** Never let a rejection cross the IPC boundary — it arrives as an opaque string. */
async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Accepts "1.2.3.4:8080" and the common vendor variants, including the
 * host:port:user:pass form vendors hand out. Credentials found on the line are
 * kept — Chrome cannot use them directly, but the local relay can.
 */
export function parseProxyLine(
  line: string
): { host: string; port: number; username?: string; password?: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const withoutScheme = trimmed.replace(/^\w+:\/\//, '')

  // user:pass@host:port
  const at = withoutScheme.lastIndexOf('@')
  if (at !== -1) {
    const [username, ...pw] = withoutScheme.slice(0, at).split(':')
    const rest = parseProxyLine(withoutScheme.slice(at + 1))
    return rest ? { ...rest, username, password: pw.join(':') } : null
  }

  const parts = withoutScheme.split(':')
  if (parts.length < 2) return null
  const host = parts[0]
  const port = Number(parts[1])
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  // host:port:user:pass
  return parts.length >= 4
    ? { host, port, username: parts[2], password: parts.slice(3).join(':') }
    : { host, port }
}

function makeProxy(existing: Proxy[], input: AddProxyInput): Proxy {
  return ProxySchema.parse({
    id: nextProxyId(existing),
    host: input.host,
    port: input.port,
    label: input.label ?? '',
    country: (input.country ?? 'US').toUpperCase(),
    expiresAt: input.expiresAt ?? null,
    username: input.username?.trim() || null,
    // Encrypted immediately; the clear password never reaches disk.
    passwordEnc: input.password ? encryptSecret(input.password) : null,
    assignedProfileId: null,
    lastVerification: null
  })
}

/** Joins a profile with the persona, proxy and account facts a row needs. */
async function toRow(profile: Profile): Promise<ProfileRow> {
  const [personas, pool, accounts] = await Promise.all([
    listPersonas(),
    loadProxyPool(),
    listAccounts(profile.personaSlug, profile.id)
  ])
  const persona = personas.find((p) => p.slug === profile.personaSlug)
  const proxy = pool.proxies.find((p) => p.id === profile.proxyId)
  return {
    ...profile,
    personaName: persona?.displayName ?? profile.personaSlug,
    proxyLabel: proxy ? `${proxy.host}:${proxy.port}` : null,
    proxyVerified: proxy?.lastVerification?.ok === true,
    running: isRunning(profile.id),
    accounts: accounts.map((a) => ({
      platform: a.platform,
      username: a.username,
      health: a.health
    }))
  }
}

export function registerIpc(): void {
  ipcMain.handle(CH.dataDir, () => guard(async () => getDataRoot()))
  ipcMain.handle(CH.chromePath, () => guard(async () => findChrome()))

  // -- profiles -------------------------------------------------------------

  ipcMain.handle(CH.personaList, () => guard(async () => listPersonas()))

  ipcMain.handle(CH.profileList, () =>
    guard(async () => {
      const profiles = await listProfiles()
      return Promise.all(profiles.map(toRow))
    })
  )

  ipcMain.handle(CH.profileCreate, (_e, input: CreateProfileInput) =>
    guard(async () => {
      const slug = slugify(input.personaName)
      if (!slug) throw new Error('persona name must contain at least one letter or digit')

      const personas = await listPersonas()
      if (!personas.some((p) => p.slug === slug)) {
        await upsertPersona({
          slug,
          displayName: input.personaName,
          niche: input.niche,
          country: input.country.toUpperCase(),
          bio: '',
          avatarPath: null
        })
      }

      if (input.proxyId) {
        const pool = await loadProxyPool()
        const proxy = pool.proxies.find((p) => p.id === input.proxyId)
        if (!proxy) throw new Error(`no such proxy: ${input.proxyId}`)
        if (proxy.assignedProfileId) {
          throw new Error(`${proxy.id} is already assigned to ${proxy.assignedProfileId}`)
        }
      }

      const id = await nextProfileId(slug)
      const profile = await saveProfile(
        ProfileSchema.parse({
          id,
          personaSlug: slug,
          name: input.name,
          proxyId: input.proxyId,
          allowDirect: input.allowDirect,
          notes: input.notes,
          lastUsedAt: null,
          fingerprint: {
            windowWidth: input.windowWidth,
            windowHeight: input.windowHeight,
            timezone: input.timezone,
            locale: input.locale
          }
        })
      )

      // Binding is written on the proxy side too, so the one-proxy-one-profile
      // invariant is checked by the pool's own save path.
      if (input.proxyId) {
        await mutateProxies((proxies) =>
          proxies.map((p) => (p.id === input.proxyId ? { ...p, assignedProfileId: id } : p))
        )
      }
      return profile
    })
  )

  ipcMain.handle(CH.profileUpdate, (_e, profile: Profile) =>
    guard(async () => {
      const parsed = ProfileSchema.parse(profile)
      const existing = (await listProfiles()).find((p) => p.id === parsed.id)
      if (!existing) throw new Error(`no such profile: ${parsed.id}`)

      if (existing.proxyId !== parsed.proxyId) {
        await mutateProxies((proxies) =>
          proxies.map((p) => {
            if (p.id === existing.proxyId) return { ...p, assignedProfileId: null }
            if (p.id === parsed.proxyId) return { ...p, assignedProfileId: parsed.id }
            return p
          })
        )
      }
      return saveProfile(parsed)
    })
  )

  ipcMain.handle(CH.profileDelete, (_e, personaSlug: string, id: string) =>
    guard(async () => {
      await deleteProfile(personaSlug, id)
      await mutateProxies((proxies) =>
        proxies.map((p) => (p.assignedProfileId === id ? { ...p, assignedProfileId: null } : p))
      )
      return null
    })
  )

  ipcMain.handle(CH.profileLaunch, (_e, id: string) =>
    guard(async () => {
      const profile = (await listProfiles()).find((p) => p.id === id)
      if (!profile) throw new Error(`no such profile: ${id}`)
      return launchProfile(profile)
    })
  )

  // -- accounts -------------------------------------------------------------

  ipcMain.handle(CH.accountAdd, (_e, input: AddAccountInput) =>
    guard(async () => {
      const existing = await getAccount(input.personaSlug, input.profileId, input.platform)
      if (existing) throw new Error(`${input.platform} is already on this profile`)

      // Threads has no independent existence — it inherits Instagram's age and
      // trust and dies with it, so it cannot be added on its own.
      if (input.platform === 'threads') {
        const ig = await getAccount(input.personaSlug, input.profileId, 'instagram')
        if (!ig?.registered) {
          throw new Error(
            'Threads inherits its Instagram account — register Instagram on this profile first'
          )
        }
      }

      await saveAccount(input.personaSlug, input.profileId, {
        platform: input.platform,
        profileId: input.profileId,
        username: null,
        registered: false,
        sessionCounter: 0,
        health: 'ok',
        scriptVersion: null,
        lastSessionAt: null
      })
      return null
    })
  )

  ipcMain.handle(
    CH.accountUpdate,
    (
      _e,
      personaSlug: string,
      profileId: string,
      platform: string,
      patch: { username?: string | null; registered?: boolean; health?: string }
    ) =>
      guard(async () => {
        const account = await getAccount(personaSlug, profileId, platform)
        if (!account) throw new Error(`no ${platform} account on this profile`)
        if (patch.registered && !(patch.username ?? account.username)) {
          throw new Error('enter the username you registered before marking it registered')
        }
        await saveAccount(personaSlug, profileId, {
          ...account,
          username: patch.username !== undefined ? patch.username : account.username,
          registered: patch.registered ?? account.registered,
          health: (patch.health as Account['health']) ?? account.health
        })
        return null
      })
  )

  ipcMain.handle(CH.accountRemove, (_e, personaSlug: string, profileId: string, platform: string) =>
    guard(async () => {
      await deleteAccount(personaSlug, profileId, platform)
      return null
    })
  )

  // -- sessions -------------------------------------------------------------

  ipcMain.handle(CH.sessionPlan, (_e, personaSlug: string, profileId: string, platform: string) =>
    guard(async () => {
      const account = await getAccount(personaSlug, profileId, platform)
      if (!account) throw new Error(`no ${platform} account on this profile`)
      const accountId = `${profileId}:${platform}`
      const plan = await loadPlan(platform, accountId)
      const next = plan[account.sessionCounter]
      return {
        total: plan.length,
        next: next?.index ?? null,
        label: next?.label ?? 'warmed — the script is finished',
        kind: next?.kind ?? 'active',
        estimate: next ? formatEstimate(next.estimateMs) : '',
        dueAt: nextDueAt(account.lastSessionAt, accountId, account.sessionCounter + 1)
      }
    })
  )

  ipcMain.handle(CH.sessionRun, (_e, personaSlug: string, profileId: string, platform: string) =>
    guard(async () => {
      const [profile] = (await listProfiles()).filter((p) => p.id === profileId)
      if (!profile) throw new Error(`no such profile: ${profileId}`)
      if (isRunning(profileId)) {
        throw new Error('this profile is open — close it before running a session')
      }
      const persona = (await listPersonas()).find((p) => p.slug === personaSlug)
      if (!persona) throw new Error(`no such persona: ${personaSlug}`)
      const account = await getAccount(personaSlug, profileId, platform)
      if (!account) throw new Error(`no ${platform} account on this profile`)
      if (!account.registered) {
        throw new Error('register the account inside its profile before running a session')
      }
      if (account.health !== 'ok') {
        throw new Error(
          `this account is marked "${account.health}" — clear it before running another session`
        )
      }

      const registry = await loadRegistry()
      const followedTargets = new Set(registry.followedTargets)
      const usedSources = new Set(registry.usedSourceFingerprints)
      const claimedPosts = new Set(registry.claimedPosts)
      const usedComments = [...registry.usedComments]

      const outcome = await runWarmupSession({
        profile,
        persona,
        account,
        managedHandles: await managedHandles(),
        followedTargets,
        usedComments,
        usedSources,
        claimedPosts
      })

      // The fleet registry records what actually happened, whether or not the
      // session finished — a follow that landed is in the graph regardless.
      await saveRegistry({
        followedTargets: [...followedTargets],
        usedComments,
        usedSourceFingerprints: [...usedSources],
        claimedPosts: [...claimedPosts]
      })

      // The counter only advances on a COMPLETED session. Advancing after an
      // abort would put the account's recorded progress ahead of its real state.
      if (outcome.completed) {
        await saveAccount(personaSlug, profileId, {
          ...account,
          sessionCounter: account.sessionCounter + 1,
          lastSessionAt: new Date().toISOString()
        })
      }

      return {
        completed: outcome.completed,
        sessionIndex: outcome.sessionIndex,
        egressIp: outcome.egressIp,
        steps: outcome.steps,
        error: outcome.error
      }
    })
  )

  ipcMain.handle(CH.profileStop, (_e, id: string) =>
    guard(async () => {
      stopProfile(id)
      return null
    })
  )

  // -- proxies --------------------------------------------------------------

  ipcMain.handle(CH.proxyList, () => guard(async () => (await loadProxyPool()).proxies))

  ipcMain.handle(CH.proxyAdd, (_e, input: AddProxyInput) =>
    guard(async () => {
      let created: Proxy | null = null
      await mutateProxies((proxies) => {
        if (proxies.some((p) => p.host === input.host && p.port === input.port)) {
          throw new Error(`${input.host}:${input.port} is already in the pool`)
        }
        created = makeProxy(proxies, input)
        return [...proxies, created]
      })
      return created!
    })
  )

  ipcMain.handle(
    CH.proxyAddBatch,
    (
      _e,
      text: string,
      defaults: {
        country?: string
        expiresAt?: string | null
        username?: string | null
        password?: string | null
      }
    ) =>
      guard(async () => {
        const added: Proxy[] = []
        const skipped: string[] = []
        await mutateProxies((proxies) => {
          const next = [...proxies]
          for (const line of text.split(/\r?\n/)) {
            if (!line.trim()) continue
            const parsed = parseProxyLine(line)
            if (!parsed) {
              skipped.push(`${line.trim()} (unparseable)`)
              continue
            }
            if (next.some((p) => p.host === parsed.host && p.port === parsed.port)) {
              skipped.push(`${parsed.host}:${parsed.port} (duplicate)`)
              continue
            }
            const proxy = makeProxy(next, { ...parsed, ...defaults })
            next.push(proxy)
            added.push(proxy)
          }
          return next
        })
        return { added, skipped }
      })
  )

  ipcMain.handle(CH.proxyRemove, (_e, id: string) =>
    guard(async () => {
      await mutateProxies((proxies) => {
        const target = proxies.find((p) => p.id === id)
        if (target?.assignedProfileId) {
          throw new Error(`${id} is assigned to profile ${target.assignedProfileId}; unassign first`)
        }
        return proxies.filter((p) => p.id !== id)
      })
      return null
    })
  )

  ipcMain.handle(CH.proxyVerify, (_e, id: string) =>
    guard(async () => {
      const pool = await loadProxyPool()
      const proxy = pool.proxies.find((p) => p.id === id)
      if (!proxy) throw new Error(`no such proxy: ${id}`)

      // Runs outside the mutation so a slow probe never holds the pool open.
      const verification = await verifyProxy(proxy, {
        username: proxy.username,
        password: decryptSecret(proxy.passwordEnc)
      })

      await mutateProxies((proxies) =>
        proxies.map((p) => (p.id === id ? { ...p, lastVerification: verification } : p))
      )
      return verification
    })
  )

  ipcMain.handle(CH.proxyAssign, (_e, id: string, profileId: string | null) =>
    guard(async () => {
      let updated: Proxy | null = null
      await mutateProxies((proxies) => {
        const target = proxies.find((p) => p.id === id)
        if (!target) throw new Error(`no such proxy: ${id}`)
        if (profileId && !isAssignable(target)) {
          throw new Error(`${id} has not passed verification — verify it before assigning`)
        }
        // saveProxyPool re-checks the fleet-wide invariant on write.
        return proxies.map((p) => {
          if (p.id !== id) return p
          updated = { ...p, assignedProfileId: profileId }
          return updated
        })
      })
      return updated!
    })
  )
}
