import { describe, expect, it } from 'vitest'
import {
  detectLanguage,
  interestScore,
  shouldEngage,
  tasteFromNiche,
  watchPlan,
  withPersonality,
  type TasteProfile
} from './content'
import { NICHES, NICHE_KEYS, coerceNiche, otherNiches, searchTermsFor, type NicheKey } from './niches'
import { makeRng } from './human'

const maya: TasteProfile = {
  ...tasteFromNiche('home fitness workout'),
  interests: { workout: 2, fitness: 2, home: 1, gym: 1.5, protein: 1, training: 1.5 },
  avoid: ['crypto', 'casino'],
  languages: ['en'],
  selectivity: 0.3
}

describe('language detection', () => {
  it('identifies English from function words', () => {
    const v = detectLanguage(
      'This is the routine that I do at home when I have no time for the gym, and it works'
    )
    expect(v.language).toBe('en')
    expect(v.confidence).toBeGreaterThan(0.3)
  })

  it('identifies Spanish rather than mistaking it for English', () => {
    expect(
      detectLanguage('Esta es la rutina que hago en casa cuando no tengo tiempo para el gimnasio')
        .language
    ).toBe('es')
  })

  it('identifies German and French', () => {
    expect(
      detectLanguage('Das ist die Routine die ich zu Hause mache wenn ich keine Zeit habe').language
    ).toBe('de')
    expect(
      detectLanguage("C'est la routine que je fais à la maison quand je n'ai pas le temps").language
    ).toBe('fr')
  })

  it('flags non-Latin scripts without needing to name the language', () => {
    expect(detectLanguage('这是我在家做的routine').language).toBe('non-latin')
    expect(detectLanguage('Это моя тренировка дома').language).toBe('non-latin')
    expect(detectLanguage('これは私のトレーニングです').language).toBe('non-latin')
  })

  it('abstains on short captions instead of guessing', () => {
    expect(detectLanguage('leg day').language).toBe('unknown')
    expect(detectLanguage('').language).toBe('unknown')
  })

  it('abstains on captions that are only hashtags and emoji', () => {
    expect(detectLanguage('#fitness #gym #workout 💪🔥').language).toBe('unknown')
  })
})

describe('interest scoring', () => {
  it('scores on-topic content above off-topic', () => {
    const on = interestScore({ caption: 'quick home workout for busy mornings' }, maya)
    const off = interestScore({ caption: 'my thoughts on the new season of the show' }, maya)
    expect(on).toBeGreaterThan(off)
  })

  it('reads hashtags as well as the caption', () => {
    expect(
      interestScore({ caption: 'morning routine', hashtags: ['#workout', '#fitness'] }, maya)
    ).toBeGreaterThan(interestScore({ caption: 'morning routine' }, maya))
  })

  it('matches word variants via substring', () => {
    expect(interestScore({ caption: 'three workouts I keep coming back to' }, maya)).toBeGreaterThan(0)
  })

  it('does not let a long caption win on length alone', () => {
    const padded = 'lorem ipsum '.repeat(40) + 'workout'
    expect(interestScore({ caption: padded }, maya)).toBeLessThanOrEqual(
      interestScore({ caption: 'workout workout workout' }, maya)
    )
  })
})

describe('engagement decisions', () => {
  const rng = makeRng('fixed')

  it('engages with on-topic English', () => {
    const v = shouldEngage(
      { caption: 'This is the home workout that I do when I have no time for the gym' },
      maya,
      rng
    )
    expect(v.engage).toBe(true)
    expect(v.language).toBe('en')
  })

  it('skips Spanish even when the topic is a perfect match', () => {
    const v = shouldEngage(
      { caption: 'Esta es la rutina de gimnasio que hago en casa para entrenar sin tiempo' },
      maya,
      rng
    )
    expect(v.engage).toBe(false)
    expect(v.reason).toContain('es')
  })

  it("trusts the platform's translation prompt over its own guess", () => {
    const v = shouldEngage(
      { caption: 'home workout gym training protein', hasTranslationPrompt: true },
      maya,
      rng
    )
    expect(v.engage).toBe(false)
    expect(v.reason).toContain('translation')
  })

  it('skips avoided topics outright, however well they score', () => {
    const v = shouldEngage(
      { caption: 'the gym workout routine that funded my crypto portfolio' },
      maya,
      rng
    )
    expect(v.engage).toBe(false)
    expect(v.reason).toContain('crypto')
  })

  it('skips English that is off-topic for this persona', () => {
    const v = shouldEngage(
      { caption: 'This is the sourdough starter that I have been feeding for the last month' },
      maya,
      rng
    )
    expect(v.engage).toBe(false)
  })

  it('holds unidentifiable captions to a higher bar', () => {
    const weak = { caption: 'leg day' }
    const strong = { caption: 'leg day', hashtags: ['#workout', '#fitness', '#gym', '#training'] }
    expect(shouldEngage(weak, maya, makeRng('a')).engage).toBe(false)
    expect(shouldEngage(strong, maya, makeRng('a')).engage).toBe(true)
  })

  it('is consistent in direction across many items, not coin-flipping', () => {
    const caption = 'This is the home workout that I do when I have no time for the gym'
    const results = Array.from({ length: 200 }, (_, i) =>
      shouldEngage({ caption }, maya, makeRng(`r${i}`)).engage
    )
    // Clearly on-topic content should essentially always be engaged with;
    // the jitter is meant to move borderline calls, not reverse obvious ones.
    expect(results.filter(Boolean).length).toBeGreaterThan(190)
  })

  it('gives two personas different verdicts on the same item', () => {
    const baker: TasteProfile = {
      interests: { sourdough: 2, bread: 2, baking: 2 },
      avoid: [],
      languages: ['en'],
      selectivity: 0.3
    }
    const item = { caption: 'This is the sourdough starter that I have been feeding all month' }
    expect(shouldEngage(item, baker, makeRng('x')).engage).toBe(true)
    expect(shouldEngage(item, maya, makeRng('x')).engage).toBe(false)
  })
})

describe('tasteFromNiche', () => {
  it('derives interests from the persona niche with no extra configuration', () => {
    const t = tasteFromNiche('home fitness workout')
    expect(Object.keys(t.interests).sort()).toEqual(['fitness', 'home', 'workout'])
    expect(t.languages).toEqual(['en'])
  })
})

// --- niches, curiosity, fickleness, watch plans -----------------------------


describe('niche presets', () => {
  it('every niche has interests, avoid terms and English', () => {
    for (const key of NICHE_KEYS) {
      const { taste, label } = NICHES[key]
      expect(label.length, key).toBeGreaterThan(0)
      expect(Object.keys(taste.interests).length, key).toBeGreaterThan(8)
      expect(taste.avoid.length, key).toBeGreaterThan(0)
      expect(taste.languages).toContain('en')
    }
  })

  it('niches actually discriminate — each scores its own content highest', () => {
    const probes: Partial<Record<NicheKey, string>> = {
      'home-fitness': 'full body workout at the gym, strength training and mobility',
      cooking: 'a slow roast dinner recipe from my kitchen, sauce and all',
      travel: 'my itinerary for this trip, hostel and flight tips for the destination',
      gaming: 'gameplay clip from my stream, boss fight loadout after the patch',
      pets: 'my rescue puppy meeting the cat, vet said the breed is fine'
    }
    for (const [k, caption] of Object.entries(probes)) {
      const key = k as NicheKey
      const own = interestScore({ caption }, NICHES[key].taste)
      for (const other of otherNiches(key)) {
        expect(own, `${key} vs ${other}`).toBeGreaterThan(
          interestScore({ caption }, NICHES[other].taste)
        )
      }
    }
  })

  it('rejects the scam bait that saturates these hashtags', () => {
    const v = shouldEngage(
      { caption: 'the workout routine that funded my crypto casino betting run' },
      NICHES['home-fitness'].taste,
      makeRng('z')
    )
    expect(v.engage).toBe(false)
  })
})

describe('personality', () => {
  it('gives each persona its own openness, stably', () => {
    const a = withPersonality(NICHES['home-fitness'].taste, 'maya')
    const b = withPersonality(NICHES['home-fitness'].taste, 'luis')
    expect(a.curiosity).not.toBeCloseTo(b.curiosity!, 3)
    expect(a.fickleness).not.toBeCloseTo(b.fickleness!, 3)
    expect(withPersonality(NICHES['home-fitness'].taste, 'maya')).toEqual(a)
  })

  it('sometimes watches off-topic content, and sometimes skips on-topic', () => {
    const taste = { ...withPersonality(NICHES['home-fitness'].taste, 'maya'), curiosity: 0.2, fickleness: 0.2 }
    const onTopic = 'This is the home gym workout that I do when I have no time for training'
    const offTopic = 'This is the sourdough starter that I have been feeding for the last month'

    const onResults = Array.from({ length: 400 }, (_, i) =>
      shouldEngage({ caption: onTopic }, taste, makeRng(`on${i}`)).engage
    )
    const offResults = Array.from({ length: 400 }, (_, i) =>
      shouldEngage({ caption: offTopic }, taste, makeRng(`off${i}`)).engage
    )

    // Directionally consistent...
    expect(onResults.filter(Boolean).length).toBeGreaterThan(offResults.filter(Boolean).length)
    // ...but never absolute, which is the point.
    expect(onResults.filter((r) => !r).length).toBeGreaterThan(0)
    expect(offResults.filter(Boolean).length).toBeGreaterThan(0)
  })
})

describe('watch plans', () => {
  const taste = withPersonality(NICHES['home-fitness'].taste, 'maya')
  const onTopic = { caption: 'This is the home gym workout that I do when I have no time to train' }
  const offTopic = { caption: 'This is the sourdough starter that I have been feeding all month' }

  it('watches more of on-topic than off-topic content', () => {
    const mean = (item: typeof onTopic, tag: string) =>
      Array.from({ length: 300 }, (_, i) => watchPlan(item, taste, { likeRate: 0.2 }, makeRng(`${tag}${i}`)).fraction)
        .reduce((s, v) => s + v, 0) / 300
    expect(mean(onTopic, 'on')).toBeGreaterThan(mean(offTopic, 'off') * 2)
  })

  it('finishes some videos completely rather than always stopping short', () => {
    const fractions = Array.from({ length: 300 }, (_, i) =>
      watchPlan(onTopic, taste, { likeRate: 0.2 }, makeRng(`f${i}`)).fraction
    )
    expect(fractions.filter((f) => f === 1).length).toBeGreaterThan(50)
    expect(fractions.filter((f) => f < 1).length).toBeGreaterThan(20)
  })

  it('never likes something it did not engage with', () => {
    const plans = Array.from({ length: 300 }, (_, i) =>
      watchPlan(offTopic, taste, { likeRate: 1 }, makeRng(`l${i}`))
    )
    const skipped = plans.filter((p) => p.reason.includes('too far'))
    expect(skipped.length).toBeGreaterThan(0)
    expect(skipped.every((p) => !p.like)).toBe(true)
  })

  it('respects the like rate as a propensity', () => {
    const rate = (r: number) =>
      Array.from({ length: 400 }, (_, i) => watchPlan(onTopic, taste, { likeRate: r }, makeRng(`k${r}${i}`)))
        .filter((p) => p.like).length / 400
    expect(rate(0.1)).toBeLessThan(rate(0.6))
  })
})

describe('niche coercion', () => {
  it('accepts every key unchanged', () => {
    for (const k of NICHE_KEYS) expect(coerceNiche(k), k).toBe(k)
  })

  it('normalises the shapes free text actually produced', () => {
    // These are real values that were sitting in persona files: a spaced
    // label, a synonym, and the display label as typed.
    expect(coerceNiche('home fitness')).toBe('home-fitness')
    expect(coerceNiche('fitness')).toBe('home-fitness')
    expect(coerceNiche('Home fitness')).toBe('home-fitness')
    expect(coerceNiche('  COOKING  ')).toBe('cooking')
    expect(coerceNiche('home_diy')).toBe('home-diy')
  })

  it('returns null rather than guessing, so the caller can fail loudly', () => {
    // The old behaviour silently ran a fitness profile for all of these.
    for (const junk of ['234', 'wadwa', '', 'crypto', null, undefined, 42]) {
      expect(coerceNiche(junk), String(junk)).toBeNull()
    }
  })

  it('gives search terms a person would type', () => {
    for (const k of NICHE_KEYS) {
      const terms = searchTermsFor(k)
      expect(terms.length, k).toBeGreaterThan(2)
      for (const t of terms) {
        // The niche KEY is not a query — "home-fitness" typed into Instagram
        // finds nothing. A term that happens to equal a single-word key, like
        // "cooking", is fine; a kebab-case compound is not.
        expect(t, `${k}: "${t}" is a key, not a query`).not.toContain('-')
        expect(t.trim(), `${k}: empty term`).not.toBe('')
      }
    }
  })
})
