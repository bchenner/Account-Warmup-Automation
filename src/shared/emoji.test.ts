import { describe, expect, it } from 'vitest'
import {
  countEmoji,
  decorate,
  EMOJI,
  emojiHabitFor,
  forMood,
  forNiche,
  moodsOf,
  NICHE_EMOJI,
  pickForMood,
  swapEmoji,
  swapEmojisIn,
  weightedPick,
  type Mood
} from './emoji'
import { makeRng } from './human'
import { fingerprint, similarity } from './comments'

describe('the vocabulary', () => {
  it('has no duplicates and every entry carries at least one mood', () => {
    expect(new Set(EMOJI.map((e) => e.char)).size).toBe(EMOJI.length)
    for (const e of EMOJI) {
      expect(e.moods.length, e.char).toBeGreaterThan(0)
      expect(e.weight, e.char).toBeGreaterThan(0)
    }
  })

  it('lets an emoji belong to several moods', () => {
    expect(moodsOf('😭').length).toBeGreaterThan(1)
    expect(moodsOf('🙌').length).toBeGreaterThan(1)
    expect(moodsOf('❤️')).toContain('love')
    expect(moodsOf('❤️')).toContain('approval')
  })

  it('returns no moods for anything outside the vocabulary', () => {
    expect(moodsOf('🫠')).toEqual([])
  })
})

describe('mood pools', () => {
  it('caps at the top N most common, so the long tail is never drawn', () => {
    for (const mood of ['joy', 'love', 'approval', 'hype'] as Mood[]) {
      expect(forMood(mood, 10).length).toBeLessThanOrEqual(10)
      expect(forMood(mood, 3).length).toBeLessThanOrEqual(3)
    }
  })

  it('orders by frequency so the cap keeps the commonest', () => {
    const top = forMood('approval', 3)
    expect(top[0].weight).toBeGreaterThanOrEqual(top[1].weight)
    expect(top[1].weight).toBeGreaterThanOrEqual(top[2].weight)
  })

  it('only ever returns emoji that carry the requested mood', () => {
    for (const mood of ['joy', 'love', 'approval', 'hype', 'sad', 'effort'] as Mood[]) {
      for (const e of forMood(mood)) expect(e.moods).toContain(mood)
    }
  })
})

describe('weighting', () => {
  it('draws common emoji far more often than rarer ones', () => {
    const pool = forMood('approval', 10)
    const counts = new Map<string, number>()
    for (let i = 0; i < 4000; i++) {
      const e = weightedPick(pool, makeRng(`w${i}`))!
      counts.set(e.char, (counts.get(e.char) ?? 0) + 1)
    }
    const heaviest = pool[0]
    const lightest = pool[pool.length - 1]
    expect(counts.get(heaviest.char)!).toBeGreaterThan(counts.get(lightest.char) ?? 0)
  })

  it('still reaches the whole pool rather than always the top one', () => {
    const seen = new Set(
      Array.from({ length: 500 }, (_, i) => pickForMood('approval', makeRng(`p${i}`)))
    )
    expect(seen.size).toBeGreaterThan(2)
  })
})

describe('swapping', () => {
  it('replaces an emoji with a different one sharing a mood', () => {
    for (let i = 0; i < 60; i++) {
      const out = swapEmoji('👍', makeRng(`s${i}`))
      if (out === '👍') continue
      // The replacement must share a register with what it replaced.
      expect(moodsOf(out).some((m) => moodsOf('👍').includes(m))).toBe(true)
    }
  })

  it('actually changes the emoji most of the time', () => {
    const outs = Array.from({ length: 60 }, (_, i) => swapEmoji('🔥', makeRng(`f${i}`)))
    expect(outs.filter((o) => o !== '🔥').length).toBeGreaterThan(40)
  })

  it('leaves unknown emoji untouched rather than guessing a register', () => {
    expect(swapEmoji('🫠', makeRng('u'))).toBe('🫠')
  })

  it('swaps every emoji in a sentence', () => {
    const out = swapEmojisIn('great work 👍 really strong 💪', makeRng('t'))
    expect(countEmoji(out)).toBe(2)
  })
})

describe('per-persona habit', () => {
  it('is stable for a persona', () => {
    expect(emojiHabitFor('maya')).toEqual(emojiHabitFor('maya'))
  })

  it('differs between personas, including some who never use them', () => {
    const habits = Array.from({ length: 60 }, (_, i) => emojiHabitFor(`persona-${i}`))
    expect(new Set(habits.map((h) => h.rate.toFixed(3))).size).toBeGreaterThan(20)
    expect(habits.some((h) => h.never)).toBe(true)
    expect(habits.some((h) => !h.never)).toBe(true)
  })
})

describe('decorating a comment', () => {
  const chatty = { rate: 1, favourites: ['approval'] as Mood[], never: false, maxCount: 1 }
  const silent = { rate: 0, favourites: ['approval'] as Mood[], never: true, maxCount: 1 }

  it('respects a one-emoji persona', () => {
    for (let i = 0; i < 40; i++) {
      expect(countEmoji(decorate('This is really useful', chatty, makeRng(`d${i}`)))).toBe(1)
    }
  })

  it('never repeats the same emoji, however many it uses', () => {
    const heavy = { ...chatty, maxCount: 3 }
    for (let i = 0; i < 200; i++) {
      const out = decorate('This is really useful', heavy, makeRng(`r${i}`), { niche: 'home-fitness' })
      const found = out.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu) ?? []
      expect(new Set(found).size, out).toBe(found.length)
      expect(found.length).toBeLessThanOrEqual(3)
    }
  })

  it('uses one most of the time even when the persona allows three', () => {
    const heavy = { ...chatty, maxCount: 3 }
    const counts = Array.from({ length: 400 }, (_, i) =>
      countEmoji(decorate('This is really useful', heavy, makeRng(`c${i}`), { niche: 'pets' }))
    )
    const ones = counts.filter((c) => c === 1).length
    expect(ones / counts.length).toBeGreaterThan(0.5)
    expect(new Set(counts).size).toBeGreaterThan(1)
  })

  it('never adds one for a persona that does not use them', () => {
    expect(decorate('This is really useful', silent, makeRng('n'))).toBe('This is really useful')
  })

  it('swaps existing emoji rather than piling another on', () => {
    const out = decorate('This is really useful 👍', chatty, makeRng('e'))
    expect(countEmoji(out)).toBe(1)
  })

  it('draws from the niche pool, so a workout comment does not get 😘', () => {
    const heavy = { ...chatty, maxCount: 1 }
    const used = new Set(
      Array.from({ length: 300 }, (_, i) =>
        decorate('Solid session', heavy, makeRng(`n${i}`), { niche: 'home-fitness' })
      ).flatMap((t) => t.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu) ?? [])
    )
    const pool = new Set(forNiche('home-fitness', 10).map((e) => e.char))
    for (const u of used) expect(pool.has(u), u).toBe(true)
  })

  it('cannot be used to sneak a near-duplicate past the comment registry', () => {
    // fingerprint() strips emoji, so decoration is invisible to de-duplication.
    // If it were not, swapping an emoji would defeat our own similarity check.
    const base = 'This is really helpful and the tips are great'
    const a = decorate(base, chatty, makeRng('x'))
    const b = decorate(base, chatty, makeRng('y'))
    expect(fingerprint(a)).toBe(fingerprint(b))
    expect(similarity(a, b)).toBeGreaterThan(0.99)
  })
})

describe('niche pools', () => {
  it('puts the niche-appropriate emoji at the top', () => {
    expect(forNiche('home-fitness', 3).map((e) => e.char)).toContain('💪')
    expect(forNiche('pets', 3).map((e) => e.char)).toContain('🥰')
    expect(forNiche('cooking', 3).map((e) => e.char)).toContain('😋')
  })

  it('boosts rather than replaces, so common emoji stay reachable', () => {
    // 😂 is boosted by nothing in home-fitness but is common enough to survive.
    expect(forNiche('home-fitness', 10).map((e) => e.char)).toContain('😂')
  })

  it('caps at topN and never returns duplicates', () => {
    for (const niche of Object.keys(NICHE_EMOJI)) {
      const pool = forNiche(niche, 10)
      expect(pool.length).toBeLessThanOrEqual(10)
      expect(new Set(pool.map((e) => e.char)).size).toBe(pool.length)
    }
  })

  it('falls back gracefully for an unknown niche', () => {
    expect(forNiche('astrology', 5).length).toBe(5)
  })
})

describe('emoji volume as a personal trait', () => {
  it('varies across personas', () => {
    const maxes = Array.from({ length: 80 }, (_, i) => emojiHabitFor(`p-${i}`).maxCount)
    expect(new Set(maxes).size).toBeGreaterThan(1)
    expect(Math.max(...maxes)).toBeLessThanOrEqual(3)
    expect(Math.min(...maxes)).toBeGreaterThanOrEqual(1)
  })
})
