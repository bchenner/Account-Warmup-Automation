import { describe, expect, it } from 'vitest'
import { allPossibleQueries, isPlainEnglish, reorientQueries } from './queries'
import { NICHE_KEYS } from './niches'
import { detectLanguage } from './content'

describe('reorientation queries', () => {
  it('every query any niche can produce is plain English', () => {
    // The entire point is to feed a recommender English. A query carrying
    // non-Latin characters would teach it the opposite.
    for (const q of allPossibleQueries('maya-instagram')) {
      expect(isPlainEnglish(q), q).toBe(true)
    }
  })

  it('is never CONFIDENTLY detected as a language other than English', () => {
    for (const q of allPossibleQueries('maya-instagram')) {
      const { language, confidence } = detectLanguage(q)
      // A query is a few words, so the detector abstains on most of them with a
      // low confidence — that is expected and fine. What must never happen is a
      // confident call of something that is not English, which would mean the
      // reorientation is teaching the recommender the wrong language.
      if (confidence >= 0.5) {
        expect(language, `${q} -> ${language} @${confidence}`).toBe('en')
      }
      expect(language, `${q} is non-latin`).not.toBe('non-latin')
    }
  })

  it('gives every account a different rotation', () => {
    const a = reorientQueries('home-fitness', 'maya-instagram', 0, 8)
    const b = reorientQueries('home-fitness', 'luis-instagram', 0, 8)
    expect(a).not.toEqual(b)
  })

  it('does not repeat itself between sessions', () => {
    const day1 = reorientQueries('cooking', 'maya-instagram', 1, 6)
    const day5 = reorientQueries('cooking', 'maya-instagram', 5, 6)
    expect(day1).not.toEqual(day5)
  })

  it('never repeats a query within one session', () => {
    for (const niche of NICHE_KEYS) {
      const qs = reorientQueries(niche, 'maya-instagram', 0, 12)
      expect(new Set(qs).size, niche).toBe(qs.length)
    }
  })

  it('is deterministic for the same account and round', () => {
    // Seeded, not random: the same session re-run produces the same searches,
    // which is what makes a failure reproducible.
    expect(reorientQueries('travel', 'maya-instagram', 3, 6)).toEqual(
      reorientQueries('travel', 'maya-instagram', 3, 6)
    )
  })

  it('stays on-niche', () => {
    // A reorientation that dragged the feed to English but off the persona's
    // niche would trade one wrong feed for another.
    const qs = reorientQueries('cooking', 'maya-instagram', 0, 12).join(' ')
    expect(/recipe|cook|kitchen|bak|meal|food|dinner|sauce|ingredient/i.test(qs), qs).toBe(true)
  })

  it('anchors only a minority of queries to a place', () => {
    // Every query carrying a city name is a template. Language is doing the
    // work; the place is a hint.
    const qs = allPossibleQueries('maya-instagram')
    const anchored = qs.filter((q) =>
      /\b(usa|america|new york|los angeles|chicago|texas|florida|california|atlanta|seattle)\b/.test(q)
    )
    expect(anchored.length / qs.length).toBeLessThan(0.45)
    expect(anchored.length).toBeGreaterThan(0)
  })

  it('asks for no more than it can produce', () => {
    expect(reorientQueries('pets', 'maya-instagram', 0, 5)).toHaveLength(5)
    expect(reorientQueries('pets', 'maya-instagram', 0, 0)).toHaveLength(0)
  })
})
