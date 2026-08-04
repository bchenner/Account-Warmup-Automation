import { makeRng, uniform, type Rng } from './human'

/**
 * A small, deliberately boring emoji vocabulary.
 *
 * Two rules shape it:
 *
 *  - **Only high-frequency emoji.** Rare or unusual ones are memorable and
 *    narrow the pool of people a comment could plausibly have come from. The
 *    entries here all sit in the widely-published most-used tier.
 *  - **Weighted by how common they are**, so selection lands on 😂 and ❤️ far
 *    more often than on 🙌 — matching how real usage is distributed rather
 *    than picking uniformly from a list.
 *
 * ⚠️ Weights are ordinal, from published global frequency rankings. They are
 * approximate, and global frequency is not the same as frequency *in comments
 * on a given topic* — 🔥 and 💪 outrank 😭 under a workout post. Treat them as
 * a sane prior, not measurement.
 *
 * Emoji are intentionally invisible to the comment de-duplication registry
 * (`fingerprint` strips them), so swapping an emoji can never be a way to
 * sneak a near-duplicate past our own checks.
 */

export type Mood =
  | 'joy'
  | 'love'
  | 'approval'
  | 'hype'
  | 'gratitude'
  | 'effort'
  | 'sad'
  | 'surprise'

export type EmojiEntry = {
  char: string
  /** Higher is more common. Ordinal, from global frequency rankings. */
  weight: number
  /** Emoji routinely carry more than one register. */
  moods: readonly Mood[]
}

export const EMOJI: readonly EmojiEntry[] = [
  { char: '😂', weight: 100, moods: ['joy'] },
  { char: '❤️', weight: 92, moods: ['love', 'approval'] },
  { char: '🤣', weight: 84, moods: ['joy'] },
  { char: '👍', weight: 78, moods: ['approval'] },
  { char: '😭', weight: 72, moods: ['sad', 'joy'] },
  { char: '🙏', weight: 68, moods: ['gratitude'] },
  { char: '😘', weight: 62, moods: ['love'] },
  { char: '🥰', weight: 58, moods: ['love', 'joy'] },
  { char: '😍', weight: 56, moods: ['love', 'approval'] },
  { char: '😊', weight: 54, moods: ['joy', 'gratitude'] },
  { char: '🔥', weight: 52, moods: ['hype', 'approval'] },
  { char: '🙌', weight: 44, moods: ['hype', 'approval', 'gratitude'] },
  { char: '💪', weight: 40, moods: ['effort', 'hype'] },
  { char: '👏', weight: 38, moods: ['approval', 'hype'] },
  { char: '💯', weight: 36, moods: ['approval', 'hype'] },
  { char: '😅', weight: 34, moods: ['joy', 'effort'] },
  { char: '🥺', weight: 32, moods: ['sad', 'love'] },
  { char: '😳', weight: 28, moods: ['surprise'] },
  { char: '😮', weight: 24, moods: ['surprise'] },
  { char: '🤩', weight: 22, moods: ['hype', 'approval', 'surprise'] },
  { char: '👌', weight: 20, moods: ['approval'] },
  { char: '✨', weight: 18, moods: ['hype', 'love'] },
  { char: '😋', weight: 16, moods: ['joy', 'approval'] }
]

/**
 * Which emoji a niche reaches for. 🔥 and 💪 dominate under a workout post;
 * 😋 and ❤️ under a recipe. Global frequency alone would put 😭 and 😘 in
 * places they are rarely seen, so the niche multiplies the base weight rather
 * than replacing it — common emoji stay common, topical ones rise.
 */
export const NICHE_EMOJI: Record<string, Record<string, number>> = {
  'home-fitness': { '💪': 6, '🔥': 5, '👏': 2, '💯': 2.5, '🙌': 2 },
  cooking: { '😋': 8, '🔥': 3, '❤️': 2, '👌': 3, '🙌': 1.5 },
  travel: { '😍': 4, '✨': 4, '🔥': 2, '🤩': 3 },
  tech: { '🔥': 3, '💯': 3, '👏': 2, '🤩': 2 },
  fashion: { '😍': 5, '✨': 4, '🔥': 3, '👌': 2 },
  gaming: { '🔥': 4, '😂': 3, '💯': 3, '😅': 2 },
  pets: { '🥰': 8, '😍': 5, '❤️': 4, '🥺': 3 },
  'home-diy': { '👏': 4, '💯': 3, '🙌': 3, '🔥': 2 }
}

/**
 * The `topN` emoji this niche actually uses, base frequency scaled by topical
 * fit. Anything the niche does not boost keeps its ordinary weight, so the pool
 * never collapses to a handful of predictable choices.
 */
export function forNiche(niche: string, topN = 10): EmojiEntry[] {
  const boosts = NICHE_EMOJI[niche] ?? {}
  return EMOJI.map((e) => ({ ...e, weight: e.weight * (boosts[e.char] ?? 1) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, topN)
}

/** Anything in the vocabulary, for matching against text. */
const BY_CHAR = new Map(EMOJI.map((e) => [e.char, e]))

/** Matches any emoji, not just ours — used to find what is already in a text. */
const ANY_EMOJI = /\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu

export function moodsOf(char: string): readonly Mood[] {
  return BY_CHAR.get(char)?.moods ?? []
}

/**
 * The `topN` most common entries carrying a mood. Capped rather than
 * exhaustive: the long tail is where the unusual, memorable choices live.
 */
export function forMood(mood: Mood, topN = 10): EmojiEntry[] {
  return EMOJI.filter((e) => e.moods.includes(mood))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, topN)
}

/** Weighted draw, so common emoji come up as often as they do in real use. */
export function weightedPick(pool: readonly EmojiEntry[], rng: Rng): EmojiEntry | null {
  if (pool.length === 0) return null
  const total = pool.reduce((s, e) => s + e.weight, 0)
  let r = rng() * total
  for (const e of pool) {
    r -= e.weight
    if (r <= 0) return e
  }
  return pool[pool.length - 1]
}

export function pickForMood(mood: Mood, rng: Rng, topN = 10): string | null {
  return weightedPick(forMood(mood, topN), rng)?.char ?? null
}

/**
 * Replace an emoji with a different one carrying a mood in common. Returns the
 * original when it is outside our vocabulary or has no alternative — leaving an
 * unknown emoji alone is safer than substituting something with a different
 * register.
 */
export function swapEmoji(char: string, rng: Rng, topN = 10): string {
  const moods = moodsOf(char)
  if (moods.length === 0) return char

  // Draw from a mood it actually carries, so the register survives the swap.
  const mood = moods[Math.floor(rng() * moods.length)]
  const alternatives = forMood(mood, topN).filter((e) => e.char !== char)
  return weightedPick(alternatives, rng)?.char ?? char
}

/** Swap every emoji in a text for a same-mood alternative. */
export function swapEmojisIn(text: string, rng: Rng, topN = 10): string {
  return text.replace(ANY_EMOJI, (m) => swapEmoji(m, rng, topN))
}

export function countEmoji(text: string): number {
  return text.match(ANY_EMOJI)?.length ?? 0
}

// ---------------------------------------------------------------------------
// Per-persona habit
// ---------------------------------------------------------------------------

export type EmojiHabit = {
  /** Chance of adding emoji to a comment that has none. */
  rate: number
  /** Moods this persona reaches for. */
  favourites: readonly Mood[]
  /** Some people simply never use them. */
  never: boolean
  /**
   * How many this persona will use at once. Volume is as personal as rate —
   * some people end every comment with a single 👍, others string two or three
   * together — and a fleet that always uses exactly one is uniform in a way
   * real users are not.
   */
  maxCount: number
}

const MOOD_POOL: readonly Mood[] = ['joy', 'love', 'approval', 'hype', 'gratitude', 'effort']

/**
 * Stable per persona. A fleet where every account decorates comments at the
 * same rate, in the same volume, from the same moods, is a correlation signal
 * in itself.
 */
export function emojiHabitFor(personaSlug: string): EmojiHabit {
  const rng = makeRng(`emoji:${personaSlug}`)
  const never = rng() < 0.18
  const favourites = MOOD_POOL.filter(() => rng() < 0.45)
  // Most people are one-emoji people; a minority routinely use two or three.
  const r = rng()
  return {
    never,
    rate: never ? 0 : uniform(0.15, 0.6, rng),
    favourites: favourites.length > 0 ? favourites : ['approval'],
    maxCount: r < 0.6 ? 1 : r < 0.9 ? 2 : 3
  }
}

/** How many to use this time — weighted toward the low end of the habit. */
function sampleCount(max: number, rng: Rng): number {
  if (max <= 1) return 1
  const r = rng()
  if (r < 0.62) return 1
  if (r < 0.92 || max < 3) return 2
  return 3
}

/**
 * Apply a persona's emoji habit: swap any already present for same-mood
 * alternatives, and sometimes append one or more drawn from the niche pool.
 *
 * Emoji are always DISTINCT. Repeating one ("🔥🔥🔥") is the single most
 * recognisable low-effort comment pattern there is; using two different ones is
 * ordinary. That distinction is the whole reason a count above one is allowed.
 */
export function decorate(
  text: string,
  habit: EmojiHabit,
  rng: Rng,
  opts: { niche?: string; topN?: number } = {}
): string {
  const topN = opts.topN ?? 10
  const out = swapEmojisIn(text, rng, topN)

  if (habit.never || countEmoji(out) > 0) return out
  if (rng() >= habit.rate) return out

  // Prefer the niche's pool; fall back to the persona's favourite moods.
  const pool = opts.niche
    ? forNiche(opts.niche, topN)
    : forMood(habit.favourites[Math.floor(rng() * habit.favourites.length)], topN)

  const chosen: string[] = []
  const wanted = sampleCount(habit.maxCount, rng)
  for (let attempt = 0; attempt < 12 && chosen.length < wanted; attempt++) {
    const e = weightedPick(
      pool.filter((p) => !chosen.includes(p.char)),
      rng
    )
    if (!e) break
    chosen.push(e.char)
  }
  if (chosen.length === 0) return out

  return `${out.replace(/\s+$/, '')} ${chosen.join('')}`
}
