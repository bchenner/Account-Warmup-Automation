/**
 * Human-like timing and motion.
 *
 * Two kinds of variation, and the distinction matters:
 *
 *  - **Per-account traits** are stable and seeded from the account id. One
 *    account is a fast scroller who skims, another dwells. They persist for the
 *    life of the account, because a person's habits do. Without this every
 *    account in the fleet shares one timing distribution, which is itself a
 *    correlation signal across the fleet.
 *
 *  - **Per-sample noise** is fresh every time. Counts, delays and distances are
 *    drawn per action, never reused.
 *
 * Nothing here is AI-driven — it is arithmetic over a seeded PRNG. "Deterministic
 * script" means no model in the loop, not no randomness.
 */

export type Rng = () => number

/** xmur3 string hash — spreads a short id across the full 32-bit space. */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return (h ^= h >>> 16) >>> 0
}

/** mulberry32 — small, fast, good enough distribution for behavioural timing. */
export function makeRng(seed: string | number): Rng {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Unseeded, for per-sample noise that should never repeat. */
export const liveRng: Rng = () => Math.random()

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

export function uniform(min: number, max: number, rng: Rng = liveRng): number {
  return min + rng() * (max - min)
}

export function int(min: number, max: number, rng: Rng = liveRng): number {
  return Math.floor(uniform(min, max + 1, rng))
}

/** Box–Muller. Used as the basis for log-normal below. */
function gaussian(rng: Rng): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Log-normal, which is what human dwell time actually looks like: a cluster of
 * short glances with a long tail of occasional real attention. A uniform range
 * produces the opposite — an implausibly flat spread with a hard ceiling.
 */
export function logNormal(medianMs: number, sigma = 0.55, rng: Rng = liveRng): number {
  return Math.round(medianMs * Math.exp(sigma * gaussian(rng)))
}

/** Clamp without collapsing the tail to a spike at the boundary. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** `true` with probability p. */
export function chance(p: number, rng: Rng = liveRng): boolean {
  return rng() < p
}

/** Draw one element, uniformly. */
export function pick<T>(items: readonly T[], rng: Rng = liveRng): T {
  return items[Math.floor(rng() * items.length)]
}

/** Fisher–Yates. Used so two accounts never traverse a candidate list alike. */
export function shuffle<T>(items: readonly T[], rng: Rng = liveRng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ---------------------------------------------------------------------------
// Per-account traits
// ---------------------------------------------------------------------------

export type Traits = {
  /** Global multiplier on every delay. <1 is a brisk user, >1 a slow one. */
  tempo: number
  /** Median ms of attention on a single item. */
  dwellMedian: number
  /** How much dwell varies for this person. */
  dwellSigma: number
  /** Pixels of scroll per wheel burst. */
  scrollBurst: [number, number]
  /** Probability of scrolling back up to re-read something. */
  backtrack: number
  /** Probability of stalling mid-session, as a person glancing away does. */
  distraction: number
  /** Mean ms between keystrokes. */
  keyDelay: number
}

/**
 * Stable for the life of the account. Derived from the id, so it survives
 * restarts and never needs storing, and two accounts never coincide.
 */
export function traitsFor(accountId: string): Traits {
  const rng = makeRng(`traits:${accountId}`)
  return {
    tempo: uniform(0.75, 1.35, rng),
    dwellMedian: uniform(1900, 4200, rng),
    dwellSigma: uniform(0.45, 0.8, rng),
    scrollBurst: [uniform(240, 420, rng), uniform(520, 900, rng)],
    backtrack: uniform(0.04, 0.16, rng),
    distraction: uniform(0.05, 0.14, rng),
    keyDelay: uniform(90, 210, rng)
  }
}

/**
 * A per-session multiplier. The same person is quicker some evenings than
 * others; without this, every session for an account has an identical
 * signature even though individual samples differ.
 */
export function sessionMood(accountId: string, sessionIndex: number): number {
  return uniform(0.8, 1.25, makeRng(`mood:${accountId}:${sessionIndex}`))
}

// ---------------------------------------------------------------------------
// Derived behaviours
// ---------------------------------------------------------------------------

/** How long to linger on one item. */
export function dwellMs(t: Traits, mood: number, rng: Rng = liveRng): number {
  return clamp(Math.round(logNormal(t.dwellMedian, t.dwellSigma, rng) * t.tempo * mood), 400, 45_000)
}

export type ScrollStep = { deltaY: number; pauseMs: number }

/**
 * A scroll broken into bursts with pauses, occasionally reversing.
 * A single smooth scroll to a target offset is one of the easiest bot tells
 * there is — people move in fits, stop to read, and sometimes go back.
 */
export function scrollPlan(
  t: Traits,
  mood: number,
  totalPx: number,
  rng: Rng = liveRng
): ScrollStep[] {
  const steps: ScrollStep[] = []
  let travelled = 0
  while (travelled < totalPx) {
    const burst = Math.round(uniform(t.scrollBurst[0], t.scrollBurst[1], rng))
    if (chance(t.backtrack, rng) && travelled > 0) {
      // Went past something interesting.
      const back = Math.round(burst * uniform(0.3, 0.7, rng))
      steps.push({ deltaY: -back, pauseMs: dwellMs(t, mood, rng) })
      travelled -= back
      continue
    }
    steps.push({
      deltaY: burst,
      pauseMs: chance(t.distraction, rng)
        ? Math.round(uniform(4000, 20_000, rng) * mood)
        : Math.round(uniform(280, 1400, rng) * t.tempo * mood)
    })
    travelled += burst
  }
  return steps
}

/**
 * Inter-key delays. Real typing is bursty: fast within a word, with longer
 * gaps at spaces where the next word is being thought of.
 */
export function typingDelays(text: string, t: Traits, rng: Rng = liveRng): number[] {
  return [...text].map((ch) => {
    const base = logNormal(t.keyDelay, 0.4, rng) * t.tempo
    const pause = ch === ' ' ? uniform(1.4, 3.2, rng) : 1
    return clamp(Math.round(base * pause), 25, 2500)
  })
}

export type Point = { x: number; y: number }

/**
 * A curved mouse path with a slight overshoot, sampled unevenly so speed
 * varies along it. Straight-line, constant-velocity movement between two
 * points does not occur in human input.
 */
export function mousePath(from: Point, to: Point, rng: Rng = liveRng, steps = 0): Point[] {
  const n = steps || int(18, 34, rng)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy) || 1

  // Control points offset perpendicular to the line, so the path bows.
  const bow = uniform(0.06, 0.22, rng) * dist * (chance(0.5, rng) ? 1 : -1)
  const nx = -dy / dist
  const ny = dx / dist
  const c1 = { x: from.x + dx * 0.3 + nx * bow, y: from.y + dy * 0.3 + ny * bow }
  const c2 = { x: from.x + dx * 0.7 + nx * bow * 0.6, y: from.y + dy * 0.7 + ny * bow * 0.6 }
  // Overshoot slightly past the target, as a hand does, then settle.
  const over = { x: to.x + uniform(-6, 6, rng), y: to.y + uniform(-6, 6, rng) }

  const out: Point[] = []
  for (let i = 1; i <= n; i++) {
    // Ease-in-out so the pointer accelerates then slows near the target.
    const u = i / n
    const s = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
    const m = 1 - s
    out.push({
      x: m ** 3 * from.x + 3 * m ** 2 * s * c1.x + 3 * m * s ** 2 * c2.x + s ** 3 * over.x,
      y: m ** 3 * from.y + 3 * m ** 2 * s * c1.y + 3 * m * s ** 2 * c2.y + s ** 3 * over.y
    })
  }
  out.push(to)
  return out
}

/**
 * Turn a configured [min, max] into an actual count for this run. Ranges in the
 * scripts are never used directly — a session that always does exactly the
 * midpoint, or always the max, is a signature.
 */
export function countFor(range: [number, number], mood: number, rng: Rng = liveRng): number {
  const raw = uniform(range[0], range[1] + 1, rng) * clamp(mood, 0.85, 1.15)
  return clamp(Math.floor(raw), range[0], range[1])
}
