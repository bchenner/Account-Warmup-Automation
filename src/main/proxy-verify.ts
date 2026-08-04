import { fetch, ProxyAgent, Agent } from 'undici'
import type { Classification, Proxy, TlsCheck, Verification } from '@shared/schemas'

/**
 * The four checks the operator runs when adding a proxy, and again on every
 * renewal. A check that runs once stops being true the moment an IP silently
 * changes, so all of this lives in the product rather than in a setup script.
 */

const TIMEOUT_MS = 15_000

/** Reports the caller's egress IP plus geo and ASN — fetched THROUGH the proxy. */
const IPINFO_URL = 'https://ipinfo.io/json'
/** Classifies an IP as hosting/mobile/etc. Looked up directly, about the proxy's IP. */
const IPAPI_URL = (ip: string): string =>
  `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,isp,org,as,hosting,proxy,mobile`
/** Echoes back the TLS ClientHello fingerprint of whoever connected. */
const TLS_URL = 'https://tls.peet.ws/api/all'

type Json = Record<string, unknown>

function proxyDispatcher(p: Pick<Proxy, 'host' | 'port'>): ProxyAgent {
  // HTTP CONNECT tunnelling — the proxy forwards encrypted bytes without
  // opening them, which is exactly what preserves the genuine ClientHello.
  return new ProxyAgent({ uri: `http://${p.host}:${p.port}` })
}

async function getJson(url: string, dispatcher?: ProxyAgent | Agent): Promise<Json> {
  const res = await fetch(url, {
    dispatcher,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
  return (await res.json()) as Json
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** ipinfo returns org as "AS7922 Comcast Cable Communications, LLC". */
function splitOrg(org: string | null): { asn: string | null; org: string | null } {
  if (!org) return { asn: null, org: null }
  const m = /^(AS\d+)\s+(.*)$/.exec(org)
  return m ? { asn: m[1], org: m[2] } : { asn: null, org }
}

/**
 * The pre-flight assertion. Run before every launch: if the proxy's egress IP
 * is not the one verification recorded, the vendor has silently reassigned it
 * (renewal is when this happens) and the profile must not open on a stranger's
 * IP. Returns the observed IP so the caller can compare and report both.
 */
export async function resolveEgressIp(p: Pick<Proxy, 'host' | 'port'>): Promise<string> {
  const info = await getJson(IPINFO_URL, proxyDispatcher(p))
  const ip = str(info.ip)
  if (!ip) throw new Error('proxy responded but reported no egress IP')
  return ip
}

async function checkTls(p: Proxy): Promise<TlsCheck> {
  // Same client both times, so any difference in the reported fingerprint is
  // the proxy re-encrypting rather than tunnelling.
  const read = async (dispatcher?: ProxyAgent): Promise<string | null> => {
    const j = await getJson(TLS_URL, dispatcher)
    const tls = j.tls as Json | undefined
    return str(tls?.ja3_hash) ?? str(tls?.ja3) ?? null
  }

  const [direct, proxied] = await Promise.allSettled([read(), read(proxyDispatcher(p))])
  const directJa3 = direct.status === 'fulfilled' ? direct.value : null
  const proxiedJa3 = proxied.status === 'fulfilled' ? proxied.value : null

  return {
    directJa3,
    proxiedJa3,
    // null means inconclusive, which is not a pass.
    matches: directJa3 && proxiedJa3 ? directJa3 === proxiedJa3 : null
  }
}

export async function verifyProxy(p: Proxy): Promise<Verification> {
  const problems: string[] = []
  let egressIp: string | null = null
  let country: string | null = null
  let region: string | null = null
  let city: string | null = null
  let asn: string | null = null
  let org: string | null = null
  let classification: Classification = 'unknown'
  let tls: TlsCheck | null = null

  // 1. Egress IP + 2. geo, in one call through the proxy.
  try {
    const info = await getJson(IPINFO_URL, proxyDispatcher(p))
    egressIp = str(info.ip)
    country = str(info.country)
    region = str(info.region)
    city = str(info.city)
    const parts = splitOrg(str(info.org))
    asn = parts.asn
    org = parts.org
    if (!egressIp) problems.push('proxy responded but reported no egress IP')
  } catch (err) {
    problems.push(`egress IP lookup failed: ${(err as Error).message}`)
  }

  // Geo must match what was purchased — vendor-claimed geo and what the geo
  // databases report do not always agree.
  if (country && country.toUpperCase() !== p.country.toUpperCase()) {
    problems.push(`geo mismatch: purchased ${p.country}, reports ${country.toUpperCase()}`)
  }

  // 3. Classification. Looked up directly about the proxy's IP, since the free
  // classification endpoint is HTTP-only and we want no secrets on that path.
  if (egressIp) {
    try {
      const c = await getJson(IPAPI_URL(egressIp))
      if (str(c.status) === 'success') {
        if (c.hosting === true) classification = 'hosting'
        else if (c.mobile === true) classification = 'mobile'
        else classification = 'isp'
        if (!org) org = str(c.isp) ?? str(c.org)
        if (!asn) asn = str(c.as)
      } else {
        problems.push('classification lookup returned no result')
      }
    } catch (err) {
      problems.push(`classification lookup failed: ${(err as Error).message}`)
    }
  }

  if (classification === 'hosting') {
    problems.push('classified as hosting/datacenter — this is not the ISP product')
  } else if (classification === 'unknown') {
    problems.push('could not classify the IP — treat as unverified, not as a pass')
  }

  // 4. TLS — the check that decides whether the whole fingerprint layer works.
  try {
    tls = await checkTls(p)
    if (tls.matches === false) {
      problems.push(
        'TLS fingerprint differs through this proxy — it is decrypting and re-encrypting (MITM). Do not assign it.'
      )
    } else if (tls.matches === null) {
      problems.push('TLS comparison inconclusive — one of the two probes failed')
    }
  } catch (err) {
    problems.push(`TLS check failed: ${(err as Error).message}`)
  }

  return {
    at: new Date().toISOString(),
    ok: problems.length === 0,
    egressIp,
    country,
    region,
    city,
    asn,
    org,
    classification,
    tls,
    problems
  }
}

/** A proxy that fails verification is blocked from assignment, not merely flagged. */
export function isAssignable(p: Proxy): boolean {
  return p.lastVerification?.ok === true
}
