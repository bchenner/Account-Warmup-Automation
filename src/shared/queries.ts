import { makeRng, shuffle, type Rng } from './human'
import { NICHES, searchTermsFor, type NicheKey } from './niches'

/**
 * Search queries for reorienting an account's recommendation graph.
 *
 * The problem this exists for is concrete: an account registered in one
 * country has a feed entirely in that country's language, and a warmup that
 * filters FOR English content in a feed containing none does nothing at all —
 * measured, on a live account whose feed was wholly Arabic. Consumption is
 * what the recommender learns from, and the only way to consume content the
 * feed is not offering is to go and find it.
 *
 * The queries are ENGLISH first and US-anchored second, because language is
 * the stronger and more reliable signal. A US city name in a query is a weak
 * hint; an entire session of English-language searches, watched through, is
 * not.
 *
 * No AI anywhere: queries are composed from the niche's own weighted interest
 * terms and a fixed anchor list, seeded per account so no two accounts search
 * the same phrases in the same order.
 */

/** Plain English phrasings that read as a person searching, not a template. */
const SHAPES = [
  '{t}',
  '{t}',
  '{t}',
  'best {t}',
  '{t} tips',
  '{t} for beginners',
  'how to {t}',
  '{t} ideas',
  'daily {t}',
  '{t} routine'
]

/**
 * US anchors, used on a minority of queries.
 *
 * Deliberately sparse. Every query carrying a city name is a template, and the
 * language of the query is doing most of the work regardless.
 */
const US_ANCHORS = [
  'usa',
  'america',
  'new york',
  'los angeles',
  'chicago',
  'texas',
  'florida',
  'california',
  'atlanta',
  'seattle'
]

/** Roughly one query in four carries a place. */
const ANCHOR_RATE = 0.25

/**
 * Builds a rotation of queries for one account.
 *
 * Seeded by account and by round, so the same account searching on two
 * different days does not repeat itself and two accounts on the same niche do
 * not share an order.
 */
export function reorientQueries(
  niche: NicheKey,
  accountId: string,
  round: number,
  count: number
): string[] {
  const rng: Rng = makeRng(`reorient:${accountId}:${round}`)
  const terms = shuffle(searchTermsFor(niche, 12), rng)
  const shapes = shuffle([...SHAPES], rng)
  const anchors = shuffle([...US_ANCHORS], rng)

  const out: string[] = []
  const seen = new Set<string>()
  for (let i = 0; out.length < count && i < terms.length * SHAPES.length; i++) {
    const term = terms[i % terms.length]
    const shape = shapes[i % shapes.length]
    let q = shape.replace('{t}', term)
    if (rng() < ANCHOR_RATE) q = `${q} ${anchors[i % anchors.length]}`
    // Two identical searches in one session is the kind of repetition a person
    // does not produce.
    if (seen.has(q)) continue
    seen.add(q)
    out.push(q)
  }
  return out
}

/**
 * True if a query is plausibly English.
 *
 * Not a language detector — everything here is composed from an English term
 * list, so this exists to catch a niche file that has had non-Latin terms added
 * to it rather than to classify arbitrary text.
 */
export function isPlainEnglish(query: string): boolean {
  return /^[a-z0-9 '&-]+$/i.test(query.trim())
}

/** Every query any niche can produce. Used by tests to assert the whole space. */
export function allPossibleQueries(accountId: string, round = 0): string[] {
  return (Object.keys(NICHES) as NicheKey[]).flatMap((n) =>
    reorientQueries(n, accountId, round, 40)
  )
}
