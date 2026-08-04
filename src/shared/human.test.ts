import { describe, expect, it } from 'vitest'
import {
  countFor,
  dwellMs,
  logNormal,
  makeRng,
  mousePath,
  scrollPlan,
  sessionMood,
  shuffle,
  traitsFor,
  typingDelays
} from './human'

// These assert statistical properties, not exact values. The point of the
// module is that its output is hard to predict, so a test pinning exact
// numbers would be testing the opposite of what matters.

const A = traitsFor('maya-instagram')
const B = traitsFor('luis-instagram')

describe('per-account traits', () => {
  it('are stable across calls for the same account', () => {
    expect(traitsFor('maya-instagram')).toEqual(A)
  })

  it('differ between accounts, so the fleet has no shared timing signature', () => {
    expect(A.tempo).not.toBeCloseTo(B.tempo, 3)
    expect(A.dwellMedian).not.toBeCloseTo(B.dwellMedian, 1)
    expect(A.keyDelay).not.toBeCloseTo(B.keyDelay, 1)
  })

  it('spreads tempo across the fleet rather than clustering', () => {
    const tempos = Array.from({ length: 200 }, (_, i) => traitsFor(`acct-${i}`).tempo)
    const min = Math.min(...tempos)
    const max = Math.max(...tempos)
    expect(max - min).toBeGreaterThan(0.4)
  })
})

describe('dwell time', () => {
  const samples = Array.from({ length: 4000 }, () => dwellMs(A, 1))

  it('has no dominant value — nothing to pattern-match on', () => {
    // Not a uniqueness count: values are integer ms in a few-thousand-wide
    // band, so collisions are the birthday paradox, not a signature. What
    // matters is that no single value spikes.
    const counts = new Map<number, number>()
    for (const v of samples) counts.set(v, (counts.get(v) ?? 0) + 1)
    const modeShare = Math.max(...counts.values()) / samples.length
    expect(modeShare).toBeLessThan(0.01)
    expect(counts.size).toBeGreaterThan(samples.length * 0.5)
  })

  it('is right-skewed like real attention, not uniform', () => {
    const sorted = [...samples].sort((a, b) => a - b)
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length
    const median = sorted[Math.floor(sorted.length / 2)]
    // Log-normal: a cluster of short glances, a long tail of real attention.
    expect(mean).toBeGreaterThan(median)
    expect(sorted[sorted.length - 1]).toBeGreaterThan(median * 3)
  })

  it('stays inside sane bounds', () => {
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(400)
    expect(Math.max(...samples)).toBeLessThanOrEqual(45_000)
  })
})

describe('session mood', () => {
  it('is stable per session but differs between sessions', () => {
    expect(sessionMood('maya', 3)).toBe(sessionMood('maya', 3))
    expect(sessionMood('maya', 3)).not.toBe(sessionMood('maya', 4))
  })

  it('differs between accounts on the same session number', () => {
    expect(sessionMood('maya', 3)).not.toBe(sessionMood('luis', 3))
  })
})

describe('scroll plan', () => {
  it('breaks travel into bursts with pauses, never one smooth sweep', () => {
    const plan = scrollPlan(A, 1, 6000)
    expect(plan.length).toBeGreaterThan(5)
    expect(new Set(plan.map((s) => s.deltaY)).size).toBeGreaterThan(3)
    expect(plan.every((s) => s.pauseMs > 0)).toBe(true)
  })

  it('sometimes scrolls back up, as someone re-reading does', () => {
    const anyBacktrack = Array.from({ length: 40 }, () => scrollPlan(A, 1, 8000)).some((p) =>
      p.some((s) => s.deltaY < 0)
    )
    expect(anyBacktrack).toBe(true)
  })

  it('produces a different plan every run', () => {
    const a = JSON.stringify(scrollPlan(A, 1, 4000))
    const b = JSON.stringify(scrollPlan(A, 1, 4000))
    expect(a).not.toBe(b)
  })
})

describe('typing', () => {
  it('pauses longer at word boundaries than within words', () => {
    const text = 'home workout routine'
    const delays = typingDelays(text, A)
    const spaceIdx = [...text].map((c, i) => (c === ' ' ? i : -1)).filter((i) => i >= 0)
    const spaceMean = spaceIdx.reduce((s, i) => s + delays[i], 0) / spaceIdx.length
    const letterMean =
      delays.filter((_, i) => !spaceIdx.includes(i)).reduce((s, v) => s + v, 0) /
      (delays.length - spaceIdx.length)
    expect(spaceMean).toBeGreaterThan(letterMean)
  })

  it('gives one delay per character and never a constant cadence', () => {
    const delays = typingDelays('instagram fitness', A)
    expect(delays).toHaveLength('instagram fitness'.length)
    expect(new Set(delays).size).toBeGreaterThan(delays.length * 0.6)
  })
})

describe('mouse path', () => {
  const path = mousePath({ x: 100, y: 100 }, { x: 700, y: 420 })

  it('lands exactly on the target', () => {
    expect(path.at(-1)).toEqual({ x: 700, y: 420 })
  })

  it('curves rather than travelling in a straight line', () => {
    const maxDeviation = Math.max(
      ...path.map((p) => {
        // Distance from the straight line between the endpoints.
        const t =
          ((p.x - 100) * 600 + (p.y - 100) * 320) / (600 * 600 + 320 * 320)
        return Math.hypot(p.x - (100 + 600 * t), p.y - (100 + 320 * t))
      })
    )
    expect(maxDeviation).toBeGreaterThan(5)
  })

  it('varies speed along the path instead of moving at constant velocity', () => {
    const gaps = path
      .slice(1)
      .map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y))
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeGreaterThan(2)
  })
})

describe('counts', () => {
  it('respects the configured range', () => {
    const samples = Array.from({ length: 500 }, () => countFor([5, 9], sessionMood('maya', 8)))
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(5)
    expect(Math.max(...samples)).toBeLessThanOrEqual(9)
  })

  it('actually spreads across the range rather than sitting on one value', () => {
    const samples = Array.from({ length: 500 }, () => countFor([5, 9], 1))
    expect(new Set(samples).size).toBeGreaterThan(2)
  })
})

describe('shuffle', () => {
  it('gives two accounts different orderings of the same candidate list', () => {
    const list = Array.from({ length: 30 }, (_, i) => `target-${i}`)
    const a = shuffle(list, makeRng('maya'))
    const b = shuffle(list, makeRng('luis'))
    expect(a).not.toEqual(b)
    expect([...a].sort()).toEqual([...list].sort())
  })
})

describe('logNormal', () => {
  it('is reproducible under a seeded rng, so runs can be replayed', () => {
    expect(logNormal(2000, 0.5, makeRng('x'))).toBe(logNormal(2000, 0.5, makeRng('x')))
  })
})
