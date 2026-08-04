import type { Level, Persona, Profile, ProfileRow, Proxy, Verification } from './schemas'

/** Channel names shared by main and preload so neither drifts from the other. */
export const CH = {
  proxyList: 'proxy:list',
  proxyAdd: 'proxy:add',
  proxyAddBatch: 'proxy:addBatch',
  proxyRemove: 'proxy:remove',
  proxyVerify: 'proxy:verify',
  proxyAssign: 'proxy:assign',
  profileList: 'profile:list',
  profileCreate: 'profile:create',
  profileUpdate: 'profile:update',
  profileDelete: 'profile:delete',
  profileReclaim: 'profile:reclaim',
  profileLaunch: 'profile:launch',
  profileStop: 'profile:stop',
  personaList: 'persona:list',
  accountAdd: 'account:add',
  accountUpdate: 'account:update',
  accountRemove: 'account:remove',
  sessionPlan: 'session:plan',
  sessionRun: 'session:run',
  chromePath: 'app:chromePath',
  dataDir: 'app:dataDir'
} as const

export type AddProxyInput = {
  host: string
  port: number
  label?: string
  country?: string
  expiresAt?: string | null
  /** Chrome cannot authenticate to a proxy; a local relay adds these upstream. */
  username?: string | null
  /** Clear only in transit — encrypted with the OS keystore before it is stored. */
  password?: string | null
}

/**
 * Every IPC call returns this shape rather than throwing across the boundary —
 * an unhandled main-process rejection surfaces in the renderer as a useless
 * "Error invoking remote method".
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export type CreateProfileInput = {
  /** Free text; the persona is created on first use if it does not exist. */
  personaName: string
  name: string
  niche: string
  country: string
  proxyId: string | null
  allowDirect: boolean
  notes: string
  timezone: string
  locale: string
  windowWidth: number
  windowHeight: number
}

export type LaunchResult = { egressIp: string | null; direct: boolean }

export type AddAccountInput = {
  personaSlug: string
  profileId: string
  platform: 'facebook' | 'instagram' | 'threads'
  /** Omitted means the most cautious level, never the most permissive one. */
  level?: Level
}

/** What the UI shows for an account's warmup progress. */
export type SessionPlanView = {
  total: number
  /** Which programme the totals and labels below belong to. */
  level: Level
  /** The run in progress, if the operator has started one. */
  run: {
    days: number
    /** 1-based day of the run the next session falls on. */
    nextDay: number
    /** Days that are scheduled rest, so the UI can say why nothing is due. */
    restDays: number[]
    /** Local hours this account tends to be active between. */
    activeFrom: number
    activeTo: number
    /** Epoch ms of the next few entries, for showing the schedule ahead. */
    upcoming: { day: number; at: number; kind: 'active' | 'rest' }[]
  } | null
  /** 1-based index of the session that runs next, or null when finished. */
  next: number | null
  label: string
  kind: 'active' | 'rest'
  estimate: string
  /** Epoch ms when the next session is due, or null if none has run yet. */
  dueAt: number | null
}

export type SessionRunResult = {
  completed: boolean
  sessionIndex: number
  egressIp: string | null
  steps: { action: string; seen: number; engaged: number; detail: string }[]
  error?: string
}

export type BoilerApi = {
  dataDir: () => Promise<Result<string>>
  chromePath: () => Promise<Result<string | null>>
  listPersonas: () => Promise<Result<Persona[]>>
  listProfiles: () => Promise<Result<ProfileRow[]>>
  createProfile: (input: CreateProfileInput) => Promise<Result<Profile>>
  updateProfile: (profile: Profile) => Promise<Result<Profile>>
  deleteProfile: (personaSlug: string, id: string) => Promise<Result<null>>
  reclaimDisk: (personaSlug: string, id: string) => Promise<Result<{ freedBytes: number }>>
  launchProfile: (id: string) => Promise<Result<LaunchResult>>
  addAccount: (input: AddAccountInput) => Promise<Result<null>>
  updateAccount: (
    personaSlug: string,
    profileId: string,
    platform: string,
    patch: {
      username?: string | null
      registered?: boolean
      health?: string
      level?: Level
      /** Starting a run: this level, for this many days, from now. */
      runDays?: number | null
    }
  ) => Promise<Result<null>>
  removeAccount: (personaSlug: string, profileId: string, platform: string) => Promise<Result<null>>
  sessionPlan: (
    personaSlug: string,
    profileId: string,
    platform: string
  ) => Promise<Result<SessionPlanView>>
  runSession: (
    personaSlug: string,
    profileId: string,
    platform: string
  ) => Promise<Result<SessionRunResult>>
  stopProfile: (id: string) => Promise<Result<null>>
  listProxies: () => Promise<Result<Proxy[]>>
  addProxy: (input: AddProxyInput) => Promise<Result<Proxy>>
  /** Vendors deliver lists; accepts pasted "host:port" lines. */
  addProxyBatch: (
    text: string,
    defaults: {
      country?: string
      expiresAt?: string | null
      username?: string | null
      password?: string | null
    }
  ) => Promise<Result<{ added: Proxy[]; skipped: string[] }>>
  removeProxy: (id: string) => Promise<Result<null>>
  verifyProxy: (id: string) => Promise<Result<Verification>>
  assignProxy: (id: string, profileId: string | null) => Promise<Result<Proxy>>
}
