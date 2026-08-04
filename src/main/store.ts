import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { safeStorage } from 'electron'
import { parse, stringify } from 'yaml'
import { ProxyPoolSchema, type Proxy, type ProxyPool } from '@shared/schemas'

/**
 * All state is YAML on disk. There is exactly one writer (one operator, one
 * session at a time), which is what makes file-level uniqueness checks reliable
 * without a database.
 */

let dataRoot = ''

export function setDataRoot(root: string): void {
  dataRoot = root
}

export function getDataRoot(): string {
  if (!dataRoot) throw new Error('data root not configured')
  return dataRoot
}

const proxiesPath = (): string => join(getDataRoot(), 'proxies.yaml')

/** Write to a temp file then rename, so a crash mid-write cannot truncate state. */
export async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, contents, 'utf8')
  await rename(tmp, path)
}

export async function loadProxyPool(): Promise<ProxyPool> {
  const path = proxiesPath()
  if (!existsSync(path)) return { proxies: [] }
  const raw = await readFile(path, 'utf8')
  const parsed = parse(raw) ?? {}
  // Fail loudly: a malformed pool must not half-load and silently drop entries.
  return ProxyPoolSchema.parse(parsed)
}

export async function saveProxyPool(pool: ProxyPool): Promise<void> {
  assertOneProxyPerProfile(pool.proxies)
  await writeAtomic(proxiesPath(), stringify(ProxyPoolSchema.parse(pool)))
}

/**
 * The one-profile-one-IP rule, enforced as an invariant rather than a
 * convention. Two accounts sharing an egress IP is the failure the whole design
 * exists to avoid, so it is checked on every write.
 */
export function assertOneProxyPerProfile(proxies: Proxy[]): void {
  const seen = new Map<string, string>()
  for (const p of proxies) {
    if (!p.assignedProfileId) continue
    const existing = seen.get(p.assignedProfileId)
    if (existing) {
      throw new Error(
        `profile ${p.assignedProfileId} is assigned to two proxies (${existing} and ${p.id})`
      )
    }
    seen.set(p.assignedProfileId, p.id)
  }
}

export async function mutateProxies(
  fn: (proxies: Proxy[]) => Proxy[] | Promise<Proxy[]>
): Promise<Proxy[]> {
  const pool = await loadProxyPool()
  const next = await fn(pool.proxies)
  await saveProxyPool({ proxies: next })
  return next
}

/** Stable, sortable, and readable in a filename or a log line. */
export function nextProxyId(existing: Proxy[]): string {
  let max = 0
  for (const p of existing) {
    const m = /^px-(\d+)$/.exec(p.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `px-${String(max + 1).padStart(3, '0')}`
}

// ---------------------------------------------------------------------------
// Proxy credentials
// ---------------------------------------------------------------------------

/**
 * Proxy passwords are the only secret this app holds, and only because a
 * password-auth proxy is otherwise unusable (Chrome cannot authenticate to
 * one). Encrypted at rest with the OS keystore — DPAPI on Windows — so
 * proxies.yaml never contains a readable password.
 *
 * Social account credentials remain deliberately unstored.
 */
export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption unavailable — refusing to store a proxy password in clear')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(enc: string | null): string | null {
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    // Typically means the OS keystore changed under us (different user or
    // machine). Better to fail the launch than to send a garbled password.
    return null
  }
}

// ---------------------------------------------------------------------------
// Fleet registry
// ---------------------------------------------------------------------------

/**
 * Cross-account state that only means anything if it outlives a session.
 *
 * The follow graph and comment history are fleet-wide by definition — the whole
 * point is that no two managed accounts follow the same target or reuse the
 * same phrasing, and that cannot be enforced from within a single run.
 */
export type Registry = {
  followedTargets: string[]
  /**
   * Facebook's friend graph and group memberships, kept disjoint across the
   * fleet for the same reason as the follow graph — but it matters more here.
   * A shared friend is a mutual connection visible from both accounts, and
   * co-membership of a niche group is visible directly.
   */
  friendedTargets: string[]
  joinedGroups: string[]
  usedComments: string[]
  usedSourceFingerprints: string[]
  claimedPosts: string[]
}

const EMPTY: Registry = {
  followedTargets: [],
  friendedTargets: [],
  joinedGroups: [],
  usedComments: [],
  usedSourceFingerprints: [],
  claimedPosts: []
}

const registryPath = (): string => join(getDataRoot(), 'registry.yaml')

export async function loadRegistry(): Promise<Registry> {
  const path = registryPath()
  if (!existsSync(path)) return { ...EMPTY }
  const parsed = (parse(await readFile(path, 'utf8')) ?? {}) as Partial<Registry>
  return {
    followedTargets: parsed.followedTargets ?? [],
    friendedTargets: parsed.friendedTargets ?? [],
    joinedGroups: parsed.joinedGroups ?? [],
    usedComments: parsed.usedComments ?? [],
    usedSourceFingerprints: parsed.usedSourceFingerprints ?? [],
    claimedPosts: parsed.claimedPosts ?? []
  }
}

/**
 * How many entries each fleet-wide list keeps.
 *
 * These lists are loaded and rewritten on EVERY session, and they only ever
 * grow. At thirty accounts running daily they would reach tens of thousands of
 * entries within weeks — a file rewritten in full each time, and a corpus the
 * comment picker scans linearly.
 *
 * The invariants they protect are all about RECENT overlap: do not comment on
 * a post another account just commented on, do not reuse a phrasing that is
 * still visible. A post from three months ago is not in anyone's feed. Follow
 * and friend edges are the exception — those are permanent and visible from
 * both ends, so they keep a far larger budget.
 */
const CAPS: Record<keyof Registry, number> = {
  followedTargets: 50_000,
  friendedTargets: 50_000,
  joinedGroups: 50_000,
  usedComments: 4_000,
  usedSourceFingerprints: 4_000,
  claimedPosts: 20_000
}

/** Keeps the most recent entries, which are the ones the invariants are about. */
function cap<T>(items: T[], limit: number): T[] {
  return items.length <= limit ? items : items.slice(items.length - limit)
}

export async function saveRegistry(r: Registry): Promise<void> {
  await writeAtomic(
    registryPath(),
    stringify({
      followedTargets: cap(r.followedTargets, CAPS.followedTargets),
      friendedTargets: cap(r.friendedTargets, CAPS.friendedTargets),
      joinedGroups: cap(r.joinedGroups, CAPS.joinedGroups),
      usedComments: cap(r.usedComments, CAPS.usedComments),
      usedSourceFingerprints: cap(r.usedSourceFingerprints, CAPS.usedSourceFingerprints),
      claimedPosts: cap(r.claimedPosts, CAPS.claimedPosts)
    })
  )
}
