import { detectLanguage, normalizeCaption } from './content'
import { chance, int, pick, shuffle, type Rng } from './human'

/**
 * Comments, without a language model.
 *
 * Harvest real comments from posts the account browses, then reuse phrasing
 * from a DIFFERENT post with one or two words swapped for synonyms. That keeps
 * genuine human phrasing and an unbounded source, which a fixed bank cannot.
 *
 * Two rules do the heavy lifting, and both exist because near-duplicate
 * detection (shingling) is cheap and standard:
 *
 *  1. Never post a phrase back to the post it came from. A near-duplicate
 *     sitting beside its source in the same thread is detectable without any
 *     cross-account correlation at all.
 *  2. Nothing is ever reused by any account in the fleet, checked by trigram
 *     similarity rather than exact match — synonym swaps produce near-dupes,
 *     which an exact-hash registry would happily wave through.
 */

export type HarvestedComment = {
  text: string
  /** Post it came from, so it is never returned to its own thread. */
  sourcePostId: string
  platform: string
  harvestedAt: string
}

// ---------------------------------------------------------------------------
// Harvest filtering
// ---------------------------------------------------------------------------

const SPAM_MARKERS = [
  'follow me', 'follow back', 'f4f', 'l4l', 'dm me', 'check my', 'check out my',
  'link in bio', 'promo', 'discount code', 'click the link', 'giveaway', 'winner',
  'invest', 'crypto', 'binary', 'whatsapp', 'telegram', 'cash app'
]

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu

export type RejectReason =
  | 'too-short' | 'too-long' | 'too-few-words' | 'emoji-only'
  | 'mentions-someone' | 'contains-link' | 'spam-marker' | 'not-english'
  | 'all-caps' | 'ok'

/**
 * Whether a harvested comment is safe to reuse. Deliberately strict: the
 * corpus is cheap to refill, and one bad entry gets posted under a real
 * account.
 */
export function assessComment(text: string): RejectReason {
  const trimmed = text.trim()
  if (trimmed.length < 15) return 'too-short'
  // Long comments carry personal detail and are far more identifiable as
  // copied — someone can search the exact phrase and find the original.
  if (trimmed.length > 120) return 'too-long'

  const withoutEmoji = trimmed.replace(EMOJI, '').trim()
  if (withoutEmoji.length < 12) return 'emoji-only'
  if (/@\w/.test(trimmed)) return 'mentions-someone'
  if (/https?:\/\/|www\.|\.com\b/i.test(trimmed)) return 'contains-link'

  const lower = trimmed.toLowerCase()
  if (SPAM_MARKERS.some((m) => lower.includes(m))) return 'spam-marker'

  const words = withoutEmoji.split(/\s+/).filter(Boolean)
  if (words.length < 4) return 'too-few-words'

  const letters = withoutEmoji.replace(/[^a-z]/gi, '')
  if (letters.length > 8 && letters === letters.toUpperCase()) return 'all-caps'

  if (detectLanguage(trimmed).language !== 'en') return 'not-english'

  return 'ok'
}

export function isUsable(text: string): boolean {
  return assessComment(text) === 'ok'
}

// ---------------------------------------------------------------------------
// Synonym swapping
// ---------------------------------------------------------------------------

/**
 * Drop-in replacements only: same part of speech, same number, no article or
 * agreement changes. A swap that produces slightly-off grammar is worse than
 * no swap, because awkward phrasing is itself noticeable.
 */
const SYNONYMS: Record<string, readonly string[]> = {
  great: ['excellent', 'fantastic', 'brilliant'],
  good: ['solid', 'decent', 'strong'],
  nice: ['lovely', 'neat'],
  awesome: ['amazing', 'incredible'],
  amazing: ['incredible', 'awesome'],
  helpful: ['useful', 'handy'],
  useful: ['helpful', 'handy'],
  really: ['genuinely', 'honestly', 'truly'],
  very: ['really', 'genuinely'],
  totally: ['completely', 'absolutely'],
  definitely: ['certainly', 'absolutely'],
  perfect: ['ideal', 'spot on'],
  easy: ['simple', 'straightforward'],
  simple: ['easy', 'straightforward'],
  hard: ['tough', 'difficult'],
  tough: ['hard', 'difficult'],
  quick: ['fast', 'speedy'],
  huge: ['massive', 'enormous'],
  tiny: ['small', 'little'],
  beautiful: ['gorgeous', 'stunning'],
  favourite: ['favorite', 'go-to'],
  favorite: ['favourite', 'go-to'],
  need: ['have'],
  trying: ['attempting'],
  love: ['adore'],
  thanks: ['thank you'],
  tips: ['pointers', 'advice'],
  idea: ['approach'],
  works: ['holds up']
}

export type SwapResult = { text: string; swapped: string[] }

/**
 * Swap one or two words. Case and trailing punctuation are preserved so the
 * result reads as naturally as the original.
 */
export function synonymSwap(text: string, rng: Rng, max = 2): SwapResult {
  const tokens = text.split(/(\s+)/)
  const candidates = tokens
    .map((tok, i) => ({ i, key: tok.toLowerCase().replace(/[^a-z']/g, '') }))
    .filter((c) => SYNONYMS[c.key])

  if (candidates.length === 0) return { text, swapped: [] }

  const chosen = shuffle(candidates, rng).slice(0, Math.min(max, int(1, max, rng)))
  const swapped: string[] = []

  for (const c of chosen) {
    const original = tokens[c.i]
    const replacement = pick(SYNONYMS[c.key], rng)
    const leading = original.match(/^[^a-zA-Z']*/)?.[0] ?? ''
    const trailing = original.match(/[^a-zA-Z']*$/)?.[0] ?? ''
    const isCapitalised = /^[A-Z]/.test(original.replace(/^[^a-zA-Z]*/, ''))
    const cased = isCapitalised
      ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
      : replacement
    tokens[c.i] = `${leading}${cased}${trailing}`
    swapped.push(`${c.key}->${replacement}`)
  }

  return { text: tokens.join(''), swapped }
}

// ---------------------------------------------------------------------------
// Near-duplicate detection
// ---------------------------------------------------------------------------

/** Normalised form used for both exact and fuzzy comparison. */
export function fingerprint(text: string): string {
  return normalizeCaption(text).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  const padded = ` ${s} `
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
  return out
}

/**
 * Trigram Jaccard. Exact-hash de-duplication is not enough here: a synonym swap
 * changes the hash completely while leaving the text obviously derivative.
 */
export function similarity(a: string, b: string): number {
  const A = trigrams(fingerprint(a))
  const B = trigrams(fingerprint(b))
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  return shared / (A.size + B.size - shared)
}

/**
 * Above this, two comments are close enough that both should not exist.
 *
 * Chosen from measurement, not intuition. Over a sample of sources:
 *   a swapped comment vs its own source — min 0.60, median 0.78
 *   two genuinely different comments   — max 0.13
 * A wide empty band sits between them. An earlier value of 0.6 sat on the
 * *edge* of the swap distribution and let sub-median swaps through, which is
 * precisely the case this check exists to catch.
 */
export const SIMILARITY_LIMIT = 0.35

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type PickOptions = {
  /** Post about to be commented on. Its own harvested comments are excluded. */
  targetPostId: string
  /** Everything any account in the fleet has already posted. */
  usedTexts: readonly string[]
  /**
   * Fingerprints of harvested comments already drawn from, fleet-wide. An
   * exact check on the SOURCE, which does not depend on tuning a similarity
   * threshold: each harvested comment is spent after one use, so two accounts
   * can never produce two swaps of the same original.
   */
  usedSourceFingerprints?: ReadonlySet<string>
  /** Fleet-wide: posts another managed account has already commented on. */
  claimedPostIds?: ReadonlySet<string>
}

export type PickedComment = {
  text: string
  sourcePostId: string
  /** Register this so the source is never drawn from again. */
  sourceFingerprint: string
  swapped: string[]
} | null

/**
 * Choose a comment to post, or null when nothing in the corpus is safe —
 * which is a normal outcome and must leave the session doing nothing rather
 * than falling back to something generic.
 */
export function pickComment(
  corpus: readonly HarvestedComment[],
  opts: PickOptions,
  rng: Rng
): PickedComment {
  if (opts.claimedPostIds?.has(opts.targetPostId)) return null

  const pool = shuffle(
    corpus.filter((c) => c.sourcePostId !== opts.targetPostId && isUsable(c.text)),
    rng
  )

  for (const candidate of pool) {
    // Cheap exact check first: has this original already been spent?
    const sourceFingerprint = fingerprint(candidate.text)
    if (opts.usedSourceFingerprints?.has(sourceFingerprint)) continue

    // Swap, then compare what will actually be posted.
    const swapped = synonymSwap(candidate.text, rng)
    const tooClose = opts.usedTexts.some((u) => similarity(u, swapped.text) >= SIMILARITY_LIMIT)
    if (tooClose) continue

    return {
      text: swapped.text,
      sourcePostId: candidate.sourcePostId,
      sourceFingerprint,
      swapped: swapped.swapped
    }
  }
  return null
}

/**
 * Whether to comment at all on this item. Commenting on everything engaged
 * with is a pattern; most people mostly lurk.
 */
export function shouldComment(rate: number, rng: Rng): boolean {
  return chance(rate, rng)
}
