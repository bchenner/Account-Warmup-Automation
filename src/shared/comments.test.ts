import { describe, expect, it } from 'vitest'
import {
  assessComment,
  fingerprint,
  isUsable,
  pickComment,
  similarity,
  SIMILARITY_LIMIT,
  synonymSwap,
  type HarvestedComment
} from './comments'
import { makeRng } from './human'

const harvest = (text: string, sourcePostId: string): HarvestedComment => ({
  text,
  sourcePostId,
  platform: 'instagram',
  harvestedAt: '2026-08-04T00:00:00.000Z'
})

describe('harvest filtering', () => {
  it('accepts ordinary substantive English comments', () => {
    expect(assessComment('This is really helpful, I have been doing it wrong for years')).toBe('ok')
    expect(assessComment('Great breakdown, the third one is the part I always skip')).toBe('ok')
  })

  it('rejects emoji-only praise, which is the classic bot comment', () => {
    expect(assessComment('🔥🔥🔥🔥')).toBe('too-short')
    expect(assessComment('😍😍 amazing 🔥🔥🔥🔥🔥')).toBe('emoji-only')
  })

  it('rejects anything too short to be substantive', () => {
    expect(assessComment('nice one')).toBe('too-short')
    expect(assessComment('love this')).toBe('too-short')
  })

  it('rejects long comments, which are identifiable if searched', () => {
    expect(assessComment('a'.repeat(200))).toBe('too-long')
  })

  it('rejects mentions and links, which drag other people in', () => {
    expect(assessComment('You should really see this one @someone it is great')).toBe(
      'mentions-someone'
    )
    expect(assessComment('I found the full guide over at example.com and it helped')).toBe(
      'contains-link'
    )
  })

  it('rejects spam bait', () => {
    expect(assessComment('Great stuff here, check my page for the same thing')).toBe('spam-marker')
    expect(assessComment('This is solid advice, link in bio for more of it')).toBe('spam-marker')
  })

  it('rejects non-English so the persona stays consistent', () => {
    expect(assessComment('Esto es muy util, lo he estado haciendo mal durante years')).toBe(
      'not-english'
    )
  })

  it('rejects shouting', () => {
    expect(assessComment('THIS IS THE BEST THING I HAVE SEEN ALL WEEK')).toBe('all-caps')
  })
})

describe('synonym swap', () => {
  it('changes wording while leaving the sentence intact', () => {
    const r = synonymSwap('This is really helpful and the tips are great', makeRng('a'))
    expect(r.swapped.length).toBeGreaterThan(0)
    expect(r.text).not.toBe('This is really helpful and the tips are great')
    // Word count is preserved unless a multi-word synonym is drawn.
    expect(r.text.split(/\s+/).length).toBeGreaterThanOrEqual(9)
  })

  it('preserves capitalisation and trailing punctuation', () => {
    const r = synonymSwap('Great tips, really useful.', makeRng('b'))
    expect(r.text).toMatch(/^[A-Z]/)
    expect(r.text.endsWith('.')).toBe(true)
  })

  it('produces different results on different runs', () => {
    const src = 'This is really helpful and the tips are great, very simple to follow'
    const outs = new Set(
      Array.from({ length: 30 }, (_, i) => synonymSwap(src, makeRng(`s${i}`)).text)
    )
    expect(outs.size).toBeGreaterThan(3)
  })

  it('leaves text untouched when nothing is swappable', () => {
    const src = 'I tried this yesterday morning before breakfast'
    expect(synonymSwap(src, makeRng('c')).text).toBe(src)
  })

  it('swaps at most two words, so the sentence stays coherent', () => {
    const src = 'really great and very nice, totally useful, definitely helpful and easy'
    for (let i = 0; i < 20; i++) {
      expect(synonymSwap(src, makeRng(`m${i}`)).swapped.length).toBeLessThanOrEqual(2)
    }
  })
})

describe('near-duplicate detection', () => {
  it('scores a synonym-swapped comment as highly similar to its source', () => {
    const src = 'This is really helpful and the tips are great'
    const swapped = synonymSwap(src, makeRng('d')).text
    // The whole reason exact-hash de-duplication is not enough.
    expect(fingerprint(src)).not.toBe(fingerprint(swapped))
    expect(similarity(src, swapped)).toBeGreaterThan(SIMILARITY_LIMIT)
  })

  it('scores unrelated comments as dissimilar', () => {
    expect(
      similarity(
        'This is really helpful and the tips are great',
        'I tried the second one yesterday and my knees complained'
      )
    ).toBeLessThan(0.3)
  })

  it('ignores punctuation and casing', () => {
    expect(similarity('Great tips, very useful!', 'great tips very useful')).toBeGreaterThan(0.9)
  })
})

describe('picking a comment', () => {
  const corpus = [
    harvest('This is really helpful, I have been doing it wrong for years', 'post-1'),
    harvest('Great breakdown, the third one is the part I always skip', 'post-2'),
    harvest('I tried this yesterday and it was harder than it looks honestly', 'post-3'),
    harvest('The form cues here are very useful, thanks for spelling them out', 'post-4')
  ]

  it('never returns a comment to the post it was harvested from', () => {
    for (let i = 0; i < 40; i++) {
      const picked = pickComment(corpus, { targetPostId: 'post-2', usedTexts: [] }, makeRng(`p${i}`))
      expect(picked?.sourcePostId).not.toBe('post-2')
    }
  })

  it('refuses to reuse phrasing already posted by any account in the fleet', () => {
    const used = corpus.map((c) => c.text)
    expect(pickComment(corpus, { targetPostId: 'post-9', usedTexts: used }, makeRng('x'))).toBeNull()
  })

  it('refuses to draw twice from the same harvested original, fleet-wide', () => {
    const first = pickComment(corpus, { targetPostId: 'post-9', usedTexts: [] }, makeRng('s1'))!
    const picked = pickComment(
      [corpus.find((c) => fingerprint(c.text) === first.sourceFingerprint)!],
      {
        targetPostId: 'post-9',
        usedTexts: [],
        usedSourceFingerprints: new Set([first.sourceFingerprint])
      },
      makeRng('s2')
    )
    expect(picked).toBeNull()
  })

  it('rejects a near-duplicate of something used, not just an exact match', () => {
    const swapped = synonymSwap(corpus[0].text, makeRng('y')).text
    const picked = pickComment(
      [corpus[0]],
      { targetPostId: 'post-9', usedTexts: [swapped] },
      makeRng('y2')
    )
    expect(picked).toBeNull()
  })

  it('skips posts another managed account has already commented on', () => {
    const picked = pickComment(
      corpus,
      { targetPostId: 'post-9', usedTexts: [], claimedPostIds: new Set(['post-9']) },
      makeRng('z')
    )
    expect(picked).toBeNull()
  })

  it('returns null rather than falling back to something generic', () => {
    expect(pickComment([], { targetPostId: 'post-9', usedTexts: [] }, makeRng('w'))).toBeNull()
    expect(
      pickComment([harvest('🔥🔥🔥', 'post-1')], { targetPostId: 'post-9', usedTexts: [] }, makeRng('v'))
    ).toBeNull()
  })

  it('produces something usable in the ordinary case', () => {
    const picked = pickComment(corpus, { targetPostId: 'post-9', usedTexts: [] }, makeRng('ok'))
    expect(picked).not.toBeNull()
    expect(isUsable(picked!.text)).toBe(true)
  })

  it('spreads across the corpus rather than always choosing the same entry', () => {
    const sources = new Set(
      Array.from(
        { length: 40 },
        (_, i) => pickComment(corpus, { targetPostId: 'post-9', usedTexts: [] }, makeRng(`d${i}`))?.sourcePostId
      )
    )
    expect(sources.size).toBeGreaterThan(1)
  })
})
