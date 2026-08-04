import { z } from 'zod'
import { NICHE_KEYS, coerceNiche } from './niches'

// Data lives in YAML on disk (no database), so these schemas ARE the schema.
// Everything is validated at load; a malformed file fails loudly rather than
// half-loading.

export const PLATFORMS = ['facebook', 'instagram', 'threads'] as const
export type Platform = (typeof PLATFORMS)[number]

/** ISO-3166 alpha-2, upper case. Drives timezone, locale, languages and geolocation. */
export const CountrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'country must be a 2-letter ISO code, e.g. US')

// ---------------------------------------------------------------------------
// Proxy verification
// ---------------------------------------------------------------------------

/**
 * `hosting` is disqualifying for our purposes; `isp` is what we buy.
 * `unknown` means the lookup succeeded but could not classify — not a pass.
 */
export const ClassificationSchema = z.enum(['isp', 'hosting', 'mobile', 'unknown'])
export type Classification = z.infer<typeof ClassificationSchema>

/**
 * Compares this process's TLS ClientHello direct vs through the proxy. Same
 * client both times, so any difference is the proxy re-encrypting — which
 * would replace Chrome's genuine ClientHello and defeat the fingerprint layer.
 */
export const TlsCheckSchema = z.object({
  directJa3: z.string().nullable(),
  proxiedJa3: z.string().nullable(),
  matches: z.boolean().nullable()
})
export type TlsCheck = z.infer<typeof TlsCheckSchema>

export const VerificationSchema = z.object({
  at: z.string(),
  /** All four checks passed and the proxy is safe to assign. */
  ok: z.boolean(),
  egressIp: z.string().nullable(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
  /**
   * IANA zone reported for the egress IP itself, e.g. "America/Phoenix". Taken
   * from the geo lookup rather than derived from the region, because a
   * region-to-zone table gets Arizona wrong — it does not observe DST.
   * A profile bound to this proxy inherits it, so its clock matches its IP.
   */
  timezone: z.string().nullable().default(null),
  asn: z.string().nullable(),
  org: z.string().nullable(),
  classification: ClassificationSchema,
  tls: TlsCheckSchema.nullable(),
  /** Human-readable reasons this verification failed or was inconclusive. */
  problems: z.array(z.string())
})
export type Verification = z.infer<typeof VerificationSchema>

// ---------------------------------------------------------------------------
// Proxy pool — its own entity, not a field on Profile. Proxies are bought in
// batches and exist before the profiles they are later assigned to.
// ---------------------------------------------------------------------------

export const ProxySchema = z.object({
  id: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  label: z.string().default(''),
  /**
   * Chrome cannot authenticate to a proxy, so credentialed upstreams are
   * reached through a local relay that adds the header (see main/relay.ts).
   *
   * This is the one secret the app stores, and it is unavoidable — a proxy
   * with password auth is unusable otherwise. The password is encrypted at
   * rest with Electron safeStorage (DPAPI on Windows), never written in clear.
   * Social account credentials remain deliberately unstored.
   */
  username: z.string().nullable().default(null),
  /** safeStorage ciphertext, base64. Never the password itself. */
  passwordEnc: z.string().nullable().default(null),
  /** What was purchased — compared against what the geo lookup actually reports. */
  country: CountrySchema.default('US'),
  /** Rental expiry: when a silent IP change is most likely. */
  expiresAt: z.string().nullable().default(null),
  /** Exactly one profile, or none. Enforced fleet-wide at load. */
  assignedProfileId: z.string().nullable().default(null),
  lastVerification: VerificationSchema.nullable().default(null)
})
export type Proxy = z.infer<typeof ProxySchema>

export const ProxyPoolSchema = z.object({
  proxies: z.array(ProxySchema).default([])
})
export type ProxyPool = z.infer<typeof ProxyPoolSchema>

// ---------------------------------------------------------------------------
// Persona -> Profile -> Account
// ---------------------------------------------------------------------------

export const PersonaSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
  displayName: z.string().min(1),
  /**
   * One of a fixed list, not free text. It selects the taste profile that
   * decides what the account engages with, so a value outside the list has no
   * meaning — it used to fall through to a fitness profile without saying so.
   * Old free-text records are normalised on read where possible.
   */
  niche: z.preprocess(
    (v) => coerceNiche(v) ?? v,
    z.enum(NICHE_KEYS, {
      errorMap: () => ({ message: `niche must be one of: ${NICHE_KEYS.join(', ')}` })
    })
  ),
  country: CountrySchema.default('US'),
  bio: z.string().default(''),
  avatarPath: z.string().nullable().default(null)
})
export type Persona = z.infer<typeof PersonaSchema>

/**
 * A Chrome --user-data-dir plus the one proxy bound to it. This is the unit the
 * one-identity-one-IP rule applies to. A persona has one by default; a
 * high-value account may be split into its own.
 */
export const ProfileSchema = z.object({
  id: z.string().min(1),
  personaSlug: z.string().min(1),
  name: z.string().min(1),
  proxyId: z.string().nullable().default(null),
  /**
   * Launching with no proxy exposes the real IP, which burns a social account.
   * It is refused unless the operator has explicitly opted this profile in —
   * a deliberate choice, never a silent fallback.
   */
  allowDirect: z.boolean().default(false),
  notes: z.string().default(''),
  lastUsedAt: z.string().nullable().default(null),
  /**
   * Varied per profile, but only truthfully — every one of these is set at
   * launch (flag or env var) rather than injected into the page, so it stays
   * coherent down to the headers and the Intl API. Anything that would need
   * injection is deliberately left as the real machine's.
   */
  fingerprint: z
    .object({
      windowWidth: z.number().int().min(800).max(3840).default(1512),
      windowHeight: z.number().int().min(600).max(2160).default(982),
      timezone: z.string().default('America/New_York'),
      locale: z.string().default('en-US')
    })
    .default({})
})
export type Profile = z.infer<typeof ProfileSchema>

/** A profile joined with everything the list view needs to render one row. */
export type ProfileRow = Profile & {
  personaName: string
  proxyLabel: string | null
  proxyVerified: boolean
  running: boolean
  accounts: { platform: Platform; username: string | null; health: Health; level: Level }[]
}

/** Set by in-session detection only. Cleared by the operator, never automatically. */
export const HealthSchema = z.enum([
  'ok',
  'action_blocked',
  'checkpoint',
  'logged_out',
  'captcha',
  'banned',
  'ip_changed'
])
export type Health = z.infer<typeof HealthSchema>

/**
 * How much this account is allowed to do, in ascending order of risk. Each
 * level is a separate programme file; the level IS the ceiling, so an action a
 * level disallows is absent from its file rather than merely rare.
 *
 * observe   — consumption only. No writes at all.
 * light     — consumption plus likes.
 * standard  — the full ramp: likes, then follows, then comments.
 * establish — standard plus building the profile. New accounts ONLY: it edits
 *             the username, bio and avatar, which on an aged account is the
 *             strongest account-takeover signal there is.
 */
export const LEVELS = ['observe', 'light', 'standard', 'establish'] as const
export const LevelSchema = z.enum(LEVELS)
export type Level = z.infer<typeof LevelSchema>

export const AccountSchema = z.object({
  platform: z.enum(PLATFORMS),
  profileId: z.string().min(1),
  /**
   * Defaults to the most cautious level. An account whose level was never
   * chosen should do the least, not the most.
   */
  level: LevelSchema.default('observe'),
  /** Absent until the operator registers the account inside the profile. */
  username: z.string().nullable().default(null),
  registered: z.boolean().default(false),
  /** Which session runs next. Never auto-advanced past an aborted session. */
  sessionCounter: z.number().int().min(0).default(0),
  health: HealthSchema.default('ok'),
  scriptVersion: z.string().nullable().default(null),
  lastSessionAt: z.string().nullable().default(null)
})
export type Account = z.infer<typeof AccountSchema>
