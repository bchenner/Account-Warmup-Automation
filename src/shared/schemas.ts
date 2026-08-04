import { z } from 'zod'

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
  /** IP-whitelist auth is the working combination; Chrome ignores proxy credentials. */
  label: z.string().default(''),
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
  /** Drives follow-target search. Deterministic input to a scripted search. */
  niche: z.string().min(1),
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
  accounts: { platform: Platform; username: string | null; health: Health }[]
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

export const AccountSchema = z.object({
  platform: z.enum(PLATFORMS),
  profileId: z.string().min(1),
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
