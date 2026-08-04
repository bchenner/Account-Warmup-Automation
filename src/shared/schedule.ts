import { clamp, int, makeRng, shuffle, uniform, type Rng } from './human'

/**
 * A run: "this level, for this many days", turned into concrete clock times.
 *
 * The operator picks a level and a duration. Everything else — which days are
 * rest days, and what time of day each session happens — is derived here,
 * seeded from the account so two accounts on the same programme never share a
 * pattern.
 *
 * The whole schedule is a pure function of (accountId, level, startedAt, days).
 * Nothing is stored but those four values, so the schedule can be recomputed
 * identically at any time, survives a restart, and cannot drift out of step
 * with what was already run.
 */

export type ScheduledSession = {
  /** 1-based day of the run. */
  day: number
  /** Which session of the programme runs on this day. */
  sessionIndex: number
  kind: 'active' | 'rest'
  /** Epoch ms this session is due. */
  at: number
}

/**
 * The hours this account tends to be awake, as a local-time window.
 *
 * Real people are not uniformly active across 24 hours, and an account that
 * acts at 04:12 one day and 14:50 the next has no daily rhythm at all. Each
 * account gets its own window — an early riser, a night owl — and its sessions
 * land inside it.
 */
export type ActiveWindow = {
  /** Local hour the account's day starts, 0-23. */
  from: number
  /** Local hour it ends. Always after `from`; never wraps past midnight. */
  to: number
}

export function activeWindowFor(accountId: string): ActiveWindow {
  const rng = makeRng(`awake:${accountId}`)
  // Earliest start 07:00, latest 12:00 — nobody's first scroll of the day is
  // at 04:00, and an account that acts in the small hours every day stands out.
  const from = int(7, 12, rng)
  // Between 9 and 14 waking hours of possible activity, capped at 23:00.
  const to = clamp(from + int(9, 14, rng), from + 6, 23)
  return { from, to }
}

/**
 * Shortest run that gets a rest day at all.
 *
 * Below this, none. Skipping a day only reads as "busy" once there is a
 * routine to interrupt — a person using an app three days running is entirely
 * ordinary, and there is nothing yet for the gap to be a gap in.
 *
 * The cost of getting this wrong is not cosmetic. Rest days are placed from
 * day 3 onward, so a floor of "at least one rest day" applied to a 3-day run
 * always rested on day 3 — which quietly made it a 2-day run and dropped the
 * final session of the programme entirely. On `quick` that is the only session
 * that likes or follows anything.
 */
const MIN_DAYS_FOR_REST = 7

/**
 * Which days of a run are rest days.
 *
 * Rate is per-account rather than fixed: some people use an app daily, others
 * skip a couple of days a week. Never the first two days of a run — a
 * programme that opens with a rest day looks like an account that was set up
 * and abandoned.
 */
export function restDaysFor(accountId: string, level: string, days: number): Set<number> {
  if (days < MIN_DAYS_FOR_REST) return new Set()

  const rng = makeRng(`restdays:${accountId}:${level}:${days}`)
  const rate = uniform(0.12, 0.26, rng)
  const wanted = Math.min(Math.max(1, Math.round(days * rate)), Math.max(0, days - 2))

  const out = new Set<number>()
  const candidates = shuffle(
    Array.from({ length: Math.max(0, days - 2) }, (_, i) => i + 3),
    rng
  )
  for (const day of candidates) {
    if (out.size >= wanted) break
    // Two rest days back to back reads as an abandoned account rather than a
    // person who was busy.
    if (out.has(day - 1) || out.has(day + 1)) continue
    out.add(day)
  }
  return out
}

/**
 * A local-time hour and minute on a given date, as epoch ms.
 *
 * Local, not UTC, on purpose: the account's rhythm has to make sense in the
 * timezone it presents, and that timezone is already matched to its proxy.
 */
function atLocal(dayStart: Date, hour: number, minute: number): number {
  const d = new Date(dayStart)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/**
 * Builds the whole run.
 *
 * `days` may exceed the programme's length. When it does, the extra days keep
 * running the programme's LAST session definition — which for a holding
 * pattern like `observe` or `reorient` is exactly the settled behaviour that
 * block describes. The alternative would be inventing content the programme
 * does not define.
 */
export function planRun(args: {
  accountId: string
  level: string
  /** Epoch ms. The first session lands on this day, inside the active window. */
  startedAt: number
  days: number
  /** How many sessions the programme actually defines. */
  programmeLength: number
}): ScheduledSession[] {
  const { accountId, level, startedAt, days, programmeLength } = args
  const window = activeWindowFor(accountId)
  const rest = restDaysFor(accountId, level, days)

  const out: ScheduledSession[] = []
  let sessionIndex = 0

  for (let day = 1; day <= days; day++) {
    const rng = makeRng(`when:${accountId}:${level}:${day}`)

    const dayStart = new Date(startedAt)
    dayStart.setDate(dayStart.getDate() + (day - 1))

    // A different time every day, inside this account's own waking window.
    const hour = int(window.from, Math.max(window.from, window.to - 1), rng)
    const minute = int(0, 59, rng)
    let at = atLocal(dayStart, hour, minute)

    // Sessions never land closer than 14 hours apart. Two in one evening is a
    // burst no daily rhythm produces, and it is the shape a scheduler falls
    // into when it only jitters within a day.
    const previous = out[out.length - 1]
    if (previous && at - previous.at < 14 * 3600_000) {
      at = previous.at + Math.round(uniform(14, 20, rng) * 3600_000)
    }

    const isRest = rest.has(day)
    if (!isRest) sessionIndex++

    out.push({
      day,
      // Rest days do not consume a session, so a 20-day run of a 14-session
      // programme still gets through the programme.
      sessionIndex: isRest ? sessionIndex : Math.min(sessionIndex, programmeLength),
      kind: isRest ? 'rest' : 'active',
      at
    })
  }

  return out
}

/** The next entry that has not been run yet, or null when the run is over. */
export function nextInRun(
  schedule: ScheduledSession[],
  completedSessions: number
): ScheduledSession | null {
  let active = 0
  for (const entry of schedule) {
    if (entry.kind === 'rest') continue
    if (active === completedSessions) return entry
    active++
  }
  return null
}

/** "in 3h 20m" / "due now" / "in 2 days". */
export function formatWhen(at: number, now: number): string {
  const ms = at - now
  if (ms <= 0) return 'due now'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h ${mins % 60}m`
  const d = Math.floor(hours / 24)
  return d === 1 ? 'tomorrow' : `in ${d} days`
}
