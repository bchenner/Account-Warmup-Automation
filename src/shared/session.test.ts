import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  formatEstimate,
  materialize,
  nextDueAt,
  planSessions,
  restSessionsFor,
  ScriptSchema
} from './session'
import { makeRng } from './human'

const script = ScriptSchema.parse(
  parse(readFileSync(join(process.cwd(), 'scripts/instagram.yaml'), 'utf8'))
)

describe('the shipped Instagram script', () => {
  it('validates against the schema', () => {
    expect(script.platform).toBe('instagram')
    expect(script.length).toBe(18)
  })

  it('covers every session index with a definition or a rest day', () => {
    const plan = planSessions(script, 'maya-instagram')
    expect(plan).toHaveLength(18)
    for (const s of plan) {
      expect(s.steps.length, `session ${s.index}`).toBeGreaterThan(0)
    }
  })

  it('starts read-only — no engagement before the profile is built', () => {
    const plan = planSessions(script, 'maya-instagram')
    const early = plan.slice(0, 4).flatMap((s) => s.steps.map((st) => st.action))
    expect(early).not.toContain('follow')
    expect(early).not.toContain('like')
    expect(early).not.toContain('comment')
  })

  it('spreads profile mutations across separate sessions', () => {
    const plan = planSessions(script, 'maya-instagram')
    const mutationSessions = plan
      .filter((s) => s.steps.some((st) => st.action === 'profile_mutation'))
      .map((s) => s.index)
    // Username, display name and bio-link land on their own days rather than
    // all changing at once, which is what the reference schedule does.
    expect(mutationSessions.length).toBeGreaterThan(2)
    expect(new Set(mutationSessions).size).toBe(mutationSessions.length)
  })
})

describe('rest placement', () => {
  it('is stable for an account', () => {
    expect([...restSessionsFor(script, 'maya')]).toEqual([...restSessionsFor(script, 'maya')])
  })

  it('spreads rest patterns across the fleet rather than concentrating', () => {
    // A weaker "more than one distinct pattern" assertion passes even when
    // nearly every account collides, so measure the distribution instead.
    const N = 200
    const counts = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const k = [...restSessionsFor(script, `acct-${i}`)].sort((x, y) => x - y).join(',')
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    expect(counts.size).toBeGreaterThan(35)
    // No single pattern should dominate the fleet.
    expect(Math.max(...counts.values()) / N).toBeLessThan(0.06)
  })

  it('respects the declared window and count', () => {
    for (let i = 0; i < 50; i++) {
      const rest = [...restSessionsFor(script, `acct-${i}`)]
      expect(rest.length).toBeGreaterThanOrEqual(2)
      expect(rest.length).toBeLessThanOrEqual(3)
      for (const r of rest) {
        expect(r).toBeGreaterThanOrEqual(8)
        expect(r).toBeLessThanOrEqual(17)
      }
    }
  })

  it('never clumps rest days together — that reads as abandonment', () => {
    for (let i = 0; i < 50; i++) {
      const rest = [...restSessionsFor(script, `acct-${i}`)].sort((a, b) => a - b)
      for (let j = 1; j < rest.length; j++) {
        expect(rest[j] - rest[j - 1], `acct-${i}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('marks rest sessions as rest, with something to actually run', () => {
    const plan = planSessions(script, 'maya-instagram')
    const rests = plan.filter((s) => s.kind === 'rest')
    expect(rests.length).toBeGreaterThan(0)
    for (const r of rests) {
      expect(r.label.toLowerCase()).toContain('rest')
      expect(r.steps.every((s) => s.action === 'feed_scroll')).toBe(true)
    }
  })
})

describe('duration estimates', () => {
  const plan = planSessions(script, 'maya-instagram')

  it('gives every session a sane, ordered range', () => {
    for (const s of plan) {
      expect(s.estimateMs[0], `session ${s.index}`).toBeLessThan(s.estimateMs[1])
      expect(s.estimateMs[0]).toBeGreaterThan(20_000)
      expect(s.estimateMs[1]).toBeLessThan(60 * 60_000)
    }
  })

  it('estimates rest sessions as much shorter than active ones', () => {
    const rest = plan.find((s) => s.kind === 'rest')!
    const active = plan.find((s) => s.index >= 10 && s.kind === 'active')!
    expect(rest.estimateMs[1]).toBeLessThan(active.estimateMs[0])
  })

  it('scales with the account tempo, so the number matches the account', () => {
    const a = planSessions(script, 'fast-one')[0].estimateMs[1]
    const b = planSessions(script, 'slow-one')[0].estimateMs[1]
    expect(a).not.toBe(b)
  })

  it('formats readably', () => {
    expect(formatEstimate([300_000, 660_000])).toBe('about 5–11 min')
    expect(formatEstimate([300_000, 320_000])).toBe('about 5 min')
  })
})

describe('materialize', () => {
  it('drops steps according to their skip chance, so sessions vary', () => {
    const session = planSessions(script, 'maya-instagram').find((s) => s.index === 12)!
    const lengths = Array.from({ length: 60 }, (_, i) =>
      materialize(session, makeRng(`m${i}`)).length
    )
    expect(new Set(lengths).size).toBeGreaterThan(1)
    expect(Math.max(...lengths)).toBeLessThanOrEqual(session.steps.length)
  })
})

describe('next-session timing', () => {
  it('is unknown until a session has been run', () => {
    expect(nextDueAt(null, 'maya', 1)).toBeNull()
  })

  it('lands roughly a day later, jittered so it is not the same clock time', () => {
    const last = '2026-08-01T09:00:00.000Z'
    const hours = [1, 2, 3, 4, 5].map(
      (i) => (nextDueAt(last, 'maya', i)! - Date.parse(last)) / 3600_000
    )
    for (const h of hours) {
      expect(h).toBeGreaterThanOrEqual(18)
      expect(h).toBeLessThanOrEqual(32)
    }
    expect(new Set(hours.map((h) => Math.round(h))).size).toBeGreaterThan(1)
  })
})
