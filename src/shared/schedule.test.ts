import { describe, expect, it } from 'vitest'
import {
  activeWindowFor,
  formatWhen,
  nextInRun,
  planRun,
  restDaysFor,
  runAnchor
} from './schedule'

const START = new Date('2026-08-10T09:00:00').getTime()
const run = (accountId: string, days: number, level = 'observe', programmeLength = 14) =>
  planRun({ accountId, level, startedAt: START, days, programmeLength })

describe('run scheduling', () => {
  it('produces one entry per day of the requested run', () => {
    for (const days of [1, 7, 14, 30, 60]) {
      expect(run('maya-instagram', days), String(days)).toHaveLength(days)
    }
  })

  it('is a pure function of the account, level and start — recomputable forever', () => {
    // Nothing is stored but those inputs, so a restart must reproduce the same
    // schedule exactly or the account's history stops matching its plan.
    expect(run('maya-instagram', 21)).toEqual(run('maya-instagram', 21))
  })

  it('gives every account its own rhythm', () => {
    const a = run('maya-instagram', 14).map((s) => new Date(s.at).getHours())
    const b = run('luis-instagram', 14).map((s) => new Date(s.at).getHours())
    expect(a).not.toEqual(b)
  })

  it('never runs at the same clock time two days running', () => {
    const times = run('maya-instagram', 30).map((s) => {
      const d = new Date(s.at)
      return d.getHours() * 60 + d.getMinutes()
    })
    for (let i = 1; i < times.length; i++) {
      expect(times[i], `day ${i + 1} matched day ${i}`).not.toBe(times[i - 1])
    }
  })

  it('keeps every session inside the account’s waking window', () => {
    // An account that acts at 04:00 has no daily rhythm, which is the thing
    // this exists to produce.
    for (const id of ['maya-instagram', 'luis-facebook', 'ren-instagram', 'ada-facebook']) {
      const w = activeWindowFor(id)
      expect(w.from, id).toBeGreaterThanOrEqual(7)
      expect(w.to, id).toBeLessThanOrEqual(23)
      expect(w.to, id).toBeGreaterThan(w.from)
      for (const s of run(id, 30)) {
        const h = new Date(s.at).getHours()
        expect(h, `${id} day ${s.day} at ${h}:00`).toBeGreaterThanOrEqual(w.from)
        expect(h, `${id} day ${s.day} at ${h}:00`).toBeLessThanOrEqual(w.to)
      }
    }
  })

  it('never schedules two sessions closer than 14 hours apart', () => {
    // Two sessions in one evening is a burst, and it is exactly what jittering
    // within a day produces if nothing guards the gap.
    for (const id of ['maya-instagram', 'luis-facebook', 'ren-instagram']) {
      const s = run(id, 40)
      for (let i = 1; i < s.length; i++) {
        const gapH = (s[i].at - s[i - 1].at) / 3600_000
        expect(gapH, `${id} day ${i} -> ${i + 1}: ${gapH.toFixed(1)}h`).toBeGreaterThanOrEqual(14)
      }
    }
  })

  it('rests, but never on the first two days', () => {
    // A run that opens with a rest day looks like an account that was set up
    // and then abandoned.
    for (const id of ['maya-instagram', 'luis-facebook', 'ren-instagram', 'ada-facebook']) {
      const rest = restDaysFor(id, 'observe', 21)
      expect(rest.size, id).toBeGreaterThan(0)
      expect(rest.has(1), id).toBe(false)
      expect(rest.has(2), id).toBe(false)
    }
  })

  it('a short run never rests, so every session of it actually runs', () => {
    // Regression. Rest days are placed from day 3 onward, and the old floor of
    // "at least one" meant a 3-day run ALWAYS rested on day 3 — turning it into
    // a 2-day run and silently dropping the programme's last session. `quick`
    // is a 3-day programme whose final session is the only one that writes.
    for (const id of ['maya-facebook', 'luis-facebook', 'ren-facebook', 'ada-facebook']) {
      for (const days of [1, 2, 3, 4, 5, 6]) {
        expect(restDaysFor(id, 'quick', days).size, `${id} ${days}d`).toBe(0)
        const plan = planRun({
          accountId: id,
          level: 'quick',
          startedAt: START,
          days,
          programmeLength: days
        })
        expect(plan.filter((e) => e.kind === 'active'), `${id} ${days}d`).toHaveLength(days)
      }
    }
  })

  it('never rests two days back to back', () => {
    for (const id of ['maya-instagram', 'luis-facebook', 'ren-instagram', 'ada-facebook']) {
      const rest = [...restDaysFor(id, 'observe', 40)].sort((a, b) => a - b)
      for (let i = 1; i < rest.length; i++) {
        expect(rest[i] - rest[i - 1], `${id}: ${rest.join(',')}`).toBeGreaterThan(1)
      }
    }
  })

  it('rests at a believable rate, and differently per account', () => {
    const rates = ['maya-instagram', 'luis-facebook', 'ren-instagram', 'ada-facebook'].map(
      (id) => restDaysFor(id, 'observe', 40).size / 40
    )
    for (const r of rates) {
      expect(r).toBeGreaterThan(0.05)
      expect(r).toBeLessThan(0.35)
    }
    expect(new Set(rates).size).toBeGreaterThan(1)
  })

  it('rest days do not consume a session of the programme', () => {
    // A 20-day run of a 14-session programme still has to get through all 14.
    const s = run('maya-instagram', 20, 'observe', 14)
    const active = s.filter((e) => e.kind === 'active')
    expect(active[active.length - 1].sessionIndex).toBe(14)
  })

  it('holds at the last session when a run outlasts its programme', () => {
    // `observe` is a holding pattern; running it for 40 days must not run out.
    const s = run('maya-instagram', 40, 'observe', 14).filter((e) => e.kind === 'active')
    expect(s.length).toBeGreaterThan(14)
    for (const e of s) expect(e.sessionIndex).toBeLessThanOrEqual(14)
    expect(s[s.length - 1].sessionIndex).toBe(14)
  })

  it('finds the next unrun session, skipping rest days', () => {
    const s = run('maya-instagram', 14)
    expect(nextInRun(s, 0)?.kind).toBe('active')
    const third = nextInRun(s, 2)
    expect(third?.kind).toBe('active')
    expect(third?.sessionIndex).toBe(3)
    expect(nextInRun(s, 999)).toBeNull()
  })

  describe('anchoring day 1 against sessions already run', () => {
    const now = new Date('2026-08-10T20:00:00')
    const day = (iso: string): number => new Date(iso).getDate()

    it('starts today when the account has never run', () => {
      expect(day(runAnchor(null, now))).toBe(10)
    })

    it('starts today when the last session was long enough ago', () => {
      expect(day(runAnchor('2026-08-09T04:00:00', now))).toBe(10)
    })

    it('starts tomorrow when the account already ran today', () => {
      // The normal operator flow is: sign in, run one session by hand to check
      // it works, then start the run. planRun's 14h minimum only applies
      // between entries OF the run, so without this the first scheduled
      // session can land hours after the manual one.
      expect(day(runAnchor('2026-08-10T09:02:54.077Z', now))).toBe(11)
      expect(day(runAnchor('2026-08-10T19:30:00', now))).toBe(11)
    })

    it('treats an unparseable timestamp as "start now" rather than throwing', () => {
      expect(day(runAnchor('not a date', now))).toBe(10)
    })

    it('rolls the month over correctly', () => {
      const eom = new Date('2026-08-31T20:00:00')
      const next = new Date(runAnchor('2026-08-31T19:00:00', eom))
      expect(next.getMonth()).toBe(8)
      expect(next.getDate()).toBe(1)
    })
  })

  it('formats the wait in units a person reads', () => {
    const now = START
    expect(formatWhen(now - 1000, now)).toBe('due now')
    expect(formatWhen(now + 25 * 60_000, now)).toBe('in 25m')
    expect(formatWhen(now + 3.5 * 3600_000, now)).toBe('in 3h 30m')
    expect(formatWhen(now + 26 * 3600_000, now)).toBe('tomorrow')
    expect(formatWhen(now + 72 * 3600_000, now)).toBe('in 3 days')
  })
})
