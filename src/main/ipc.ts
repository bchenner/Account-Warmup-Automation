import { ipcMain } from 'electron'
import { CH, type AddProxyInput, type CreateProfileInput, type Result } from '@shared/ipc'
import { ProfileSchema, ProxySchema, type Profile, type ProfileRow, type Proxy } from '@shared/schemas'
import { getDataRoot, loadProxyPool, mutateProxies, nextProxyId } from './store'
import { isAssignable, verifyProxy } from './proxy-verify'
import {
  deleteProfile,
  findChrome,
  isRunning,
  launchProfile,
  listAccounts,
  listPersonas,
  listProfiles,
  nextProfileId,
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

/** Accepts "1.2.3.4:8080" and the common vendor variants around it. */
export function parseProxyLine(line: string): { host: string; port: number } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const withoutScheme = trimmed.replace(/^\w+:\/\//, '')
  // Vendors also ship host:port:user:pass — we use IP-whitelist auth, so any
  // credentials are dropped rather than silently relied on (Chrome ignores them).
  const parts = withoutScheme.split(':')
  if (parts.length < 2) return null
  const host = parts[0]
  const port = Number(parts[1])
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port }
}

function makeProxy(existing: Proxy[], input: AddProxyInput): Proxy {
  return ProxySchema.parse({
    id: nextProxyId(existing),
    host: input.host,
    port: input.port,
    label: input.label ?? '',
    country: (input.country ?? 'US').toUpperCase(),
    expiresAt: input.expiresAt ?? null,
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
    (_e, text: string, defaults: { country?: string; expiresAt?: string | null }) =>
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
      const verification = await verifyProxy(proxy)

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
