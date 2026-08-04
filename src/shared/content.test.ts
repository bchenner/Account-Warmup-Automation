import { describe, expect, it } from 'vitest'
import { detectLanguage, interestScore, shouldEngage, tasteFromNiche, type TasteProfile } from './content'
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
