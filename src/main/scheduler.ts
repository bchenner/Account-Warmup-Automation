import { planRun, nextInRun } from '@shared/schedule'
import { loadPlan } from './session-run'
import { listAccounts, listProfiles, isRunning } from './profiles'

/**
 * Runs due sessions without the operator having to be at the keyboard.
 *
 * Only ever fires for an account with a run started. An account being driven by
 * hand keeps its "Run warmup" button and nothing here touches it.
 *
 * Two things this deliberately does NOT do:
 *
 *  - Catch up. If the machine was off for three days, the sessions that were
 *    due are gone, not run back to back the moment it wakes. A burst of four
 *    sessions in an hour is the exact pattern the schedule exists to avoid, and
 *    it is far worse than a gap. A missed day is just a day the account did not
 *    open the app, which is a thing people do.
 *  - Overlap. One session at a time across the whole fleet, because each one is
 *    a real Chrome and the machine has to stay usable.
 */

export type DueSession = {
  personaSlug: string
  profileId: string
  platform: string
  dueAt: number
}

/**
 * How late a session may be and still run: past this it is skipped, not queued.
 *
 * Wide enough that a fleet draining sequentially does not start dropping
 * sessions. Thirty accounts at roughly six minutes each is three hours of
 * browser time, and scheduled times collide by chance, so a session can wait a
 * while for its turn. Past this it is a session that did not happen.
 */
const GRACE_MS = 4 * 3600_000

export async function findDue(now = Date.now()): Promise<DueSession[]> {
  const out: DueSession[] = []
  const profiles = await listProfiles()

  for (const profile of profiles) {
    // Never take a profile the operator is using, or one already in a session.
    if (isRunning(profile.id)) continue

    for (const account of await listAccounts(profile.personaSlug, profile.id)) {
      if (!account.registered || account.health !== 'ok') continue
      if (!account.runDays || !account.runStartedAt) continue

      const accountId = `${profile.id}:${account.platform}`
      let programmeLength: number
      try {
        programmeLength = (await loadPlan(account.platform, account.level, accountId)).length
      } catch {
        // No programme for this platform and level: nothing to schedule.
        continue
      }

      const entry = nextInRun(
        planRun({
          accountId,
          level: account.level,
          startedAt: new Date(account.runStartedAt).getTime(),
          days: account.runDays,
          programmeLength
        }),
        account.sessionCounter
      )
      if (!entry) continue

      // Due, and not so long ago that running it now would be a burst.
      if (entry.at <= now && now - entry.at <= GRACE_MS) {
        out.push({
          personaSlug: profile.personaSlug,
          profileId: profile.id,
          platform: account.platform,
          dueAt: entry.at
        })
      }
    }
  }

  // Oldest first, so a backlog drains in the order it was scheduled.
  return out.sort((a, b) => a.dueAt - b.dueAt)
}

export type SchedulerHandle = { stop: () => void }

/**
 * Checks every minute. A minute is fine — the schedule has minute resolution
 * and a session takes several, so anything tighter is wasted work.
 */
export function startScheduler(
  runOne: (d: DueSession) => Promise<void>,
  intervalMs = 60_000,
  /**
   * How many sessions may run at once.
   *
   * Measured: one session is about 0.6 GB and 27% of a core. Two is
   * comfortable on any machine that can run this at all, and a fleet of thirty
   * needs the throughput — sequentially that is three hours of browser time a
   * day, and every collision pushes a session closer to being dropped.
   *
   * Kept low deliberately. Beyond a handful it stops being a resource question
   * and starts being a behavioural one: your accounts are on different IPs, but
   * ten of them acting in the same minute every single day is a rhythm they
   * would not share by chance.
   */
  concurrency = 2
): SchedulerHandle {
  const inFlight = new Set<string>()
  let scanning = false

  const tick = async (): Promise<void> => {
    if (scanning || inFlight.size >= concurrency) return
    scanning = true
    try {
      const due = (await findDue()).filter((d) => !inFlight.has(d.profileId))
      for (const next of due.slice(0, concurrency - inFlight.size)) {
        inFlight.add(next.profileId)
        // Deliberately not awaited: the scan returns so the next tick can top
        // the pool back up as sessions finish.
        void runOne(next)
          .catch(() => undefined)
          .finally(() => inFlight.delete(next.profileId))
      }
    } catch {
      // A scheduler that dies on one bad account stops the whole fleet.
    } finally {
      scanning = false
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  void tick()
  return { stop: () => clearInterval(timer) }
}
