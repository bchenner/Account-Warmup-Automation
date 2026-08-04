import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
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
async function writeAtomic(path: string, contents: string): Promise<void> {
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
