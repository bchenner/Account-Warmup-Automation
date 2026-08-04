import { z } from 'zod'
import { clamp, int, makeRng, shuffle, traitsFor, uniform, type Rng } from './human'

/**
 * A warmup programme, and how it becomes a concrete plan for one account.
 *
 * Scripts are data (YAML on disk), never code — every published schedule is
 * practitioner guidance that contradicts other practitioner guidance, so these
 * will be retuned constantly and a retune must be a file edit.
 *
 * One session per day. The script declares *rules* for rest rather than fixed
 * rest days: rest placement is seeded per account, so two accounts running the
 * same programme rest on different days. Fixed rest days would put an identical
 * activity pattern across the entire fleet.
 */

export const STEP_KINDS = [
  'feed_scroll',
  'story_views',
  'watch_videos',
  'search',
  'visit_profiles',
  'follow',
  'like',
  'comment',
  'profile_mutation',
  // Facebook-only. Instagram has no equivalent of either, and Facebook warmup
  // without them optimises the wrong variable: Meta's own published entity
  // classifier weights WHO an account is connected to over how fast it acts,
  // and on Facebook that means the friend graph, not follows.
  'friend_request',
  'join_group',
  'idle'
] as const
export type StepKind = (typeof STEP_KINDS)[number]

const Range = z.tuple([z.number(), z.number()])

export const StepSchema = z.object({
  action: z.enum(STEP_KINDS),
  /** How many items. Sampled per run; never used as a literal. */
  count: Range.optional(),
  /** Wall-clock budget in seconds. Sampled per run. */
  seconds: Range.optional(),
  /** For profile_mutation: which field to change this session. */
  field: z.enum(['username', 'display_name', 'bio', 'avatar', 'first_photo', 'bio_link']).optional(),
  /** For search: drawn from the persona's niche terms when absent. */
  query: z.string().optional(),
  /** Skip this step entirely with this probability, so sessions differ. */
  skipChance: z.number().min(0).max(1).default(0)
})
export type Step = z.infer<typeof StepSchema>

export const SessionDefSchema = z.object({
  /** Inclusive 1-based session range this definition covers, e.g. [1, 4]. */
  sessions: Range,
  label: z.string().default(''),
  steps: z.array(StepSchema)
})

export const RestRuleSchema = z.object({
  /** How many rest sessions to place. */
  count: Range,
  /** The window of session indices they may fall in, inclusive. */
  window: Range,
  /** Never place two rest sessions closer together than this. */
  minGap: z.number().int().min(1).default(1)
})

export const ScriptSchema = z.object({
  platform: z.enum(['facebook', 'instagram', 'threads']),
  version: z.string(),
  /** Total sessions, one per day. */
  length: z.number().int().min(1),
  rest: RestRuleSchema.optional(),
  sessions: z.array(SessionDefSchema)
})
export type Script = z.infer<typeof ScriptSchema>

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type SessionKind = 'active' | 'rest'

export type PlannedSession = {
  index: number
  kind: SessionKind
  label: string
  steps: Step[]
  /** Shown to the operator before they start. Milliseconds, low to high. */
  estimateMs: [number, number]
}

/**
 * Where this account's rest days fall. Seeded from the account id, so the
 * placement is stable for the account and different for every account.
 */
export function restSessionsFor(
  script: Script,
  accountId: string
): Set<number> {
  const out = new Set<number>()
  if (!script.rest) return out

  const rng = makeRng(`rest:${accountId}:${script.version}`)
  const { count, window, minGap } = script.rest
  const wanted = int(count[0], count[1], rng)

  const candidates = shuffle(
    Array.from({ length: window[1] - window[0] + 1 }, (_, i) => window[0] + i),
    rng
  )
  for (const c of candidates) {
    if (out.size >= wanted) break
    // Rest days clumped together read as an abandoned account rather than a
    // person taking a day off.
    if ([...out].some((r) => Math.abs(r - c) < minGap)) continue
    out.add(c)
  }
  return out
}

/** The definition covering a given session index. */
function defFor(script: Script, index: number) {
  return script.sessions.find((s) => index >= s.sessions[0] && index <= s.sessions[1])
}

/**
 * Rough wall-clock estimate, scaled by the account's own tempo so the number
 * shown matches how this particular account actually behaves.
 */
function estimate(steps: Step[], tempo: number): [number, number] {
  let lo = 0
  let hi = 0
  for (const step of steps) {
    if (step.seconds) {
      lo += step.seconds[0] * 1000
      hi += step.seconds[1] * 1000
      continue
    }
    if (step.count) {
      // Per-item cost, deliberately wide: dwell is log-normal with a long tail.
      const perItem = step.action === 'watch_videos' ? [6000, 30_000] : [2500, 9000]
      lo += step.count[0] * perItem[0]
      hi += step.count[1] * perItem[1]
      continue
    }
    lo += 4000
    hi += 15_000
  }
  // Navigation, page loads, and the pauses between steps.
  const overhead = 20_000
  return [Math.round((lo + overhead) * tempo), Math.round((hi + overhead * 2) * tempo)]
}

/** Turn a script into this account's concrete, ordered plan. */
export function planSessions(script: Script, accountId: string): PlannedSession[] {
  const rest = restSessionsFor(script, accountId)
  const { tempo } = traitsFor(accountId)

  return Array.from({ length: script.length }, (_, i) => {
    const index = i + 1
    if (rest.has(index)) {
      // Not a no-op: a brief passive look is what "keep the session alive with
      // passive browsing" means, and it gives the operator something to run.
      const steps: Step[] = [{ action: 'feed_scroll', seconds: [40, 150], skipChance: 0 }]
      return {
        index,
        kind: 'rest' as const,
        label: 'Rest — brief look, no engagement',
        steps,
        estimateMs: estimate(steps, tempo)
      }
    }
    const def = defFor(script, index)
    const steps = def?.steps ?? []
    return {
      index,
      kind: 'active' as const,
      label: def?.label ?? '',
      steps,
      estimateMs: estimate(steps, tempo)
    }
  })
}

/** Resolve the ranges in a plan into the actual counts for one run. */
export function materialize(session: PlannedSession, rng: Rng): Step[] {
  return session.steps.filter((s) => rng() >= s.skipChance)
}

/** "about 6–11 min" — what the operator sees before starting. */
export function formatEstimate([lo, hi]: [number, number]): string {
  const m = (ms: number): number => Math.max(1, Math.round(ms / 60_000))
  const a = m(lo)
  const b = m(hi)
  return a === b ? `about ${a} min` : `about ${a}–${b} min`
}

/**
 * How long until the next session is due. One session per day, with the
 * boundary jittered per session so it is not the same clock time every day.
 */
export function nextDueAt(lastSessionAt: string | null, accountId: string, nextIndex: number): number | null {
  if (!lastSessionAt) return null
  const rng = makeRng(`due:${accountId}:${nextIndex}`)
  const hours = clamp(uniform(20, 30, rng), 18, 32)
  return new Date(lastSessionAt).getTime() + hours * 3600_000
}
