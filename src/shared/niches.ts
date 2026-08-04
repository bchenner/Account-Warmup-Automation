import type { TasteProfile } from './content'

/**
 * Ready-made taste profiles.
 *
 * Interests are weighted: 2 is a defining term for the niche, 1 is adjacent.
 * `avoid` exists mostly to keep personas away from the scam-adjacent content
 * that saturates these hashtags — engaging with it teaches the platform's
 * interest graph the wrong thing about the account and drags its
 * recommendations somewhere hard to come back from.
 */

const SPAM_BAIT = ['crypto', 'casino', 'betting', 'forex', 'onlyfans', 'giveaway', 'dm me']

export const NICHE_KEYS = [
  'home-fitness',
  'cooking',
  'travel',
  'tech',
  'fashion',
  'gaming',
  'pets',
  'home-diy'
] as const
export type NicheKey = (typeof NICHE_KEYS)[number]

/** What people actually typed when the niche was a free-text box. */
const ALIASES: Record<string, NicheKey> = {
  fitness: 'home-fitness',
  gym: 'home-fitness',
  workout: 'home-fitness',
  'home-gym': 'home-fitness',
  food: 'cooking',
  baking: 'cooking',
  recipes: 'cooking',
  technology: 'tech',
  gadgets: 'tech',
  style: 'fashion',
  clothing: 'fashion',
  gamer: 'gaming',
  animals: 'pets',
  dogs: 'pets',
  cats: 'pets',
  diy: 'home-diy',
  'home-improvement': 'home-diy'
}

/**
 * Coerces a stored niche to a valid key.
 *
 * The niche used to be free text, so records exist carrying "home fitness",
 * "fitness", or the persona's own name. Those silently missed the lookup and
 * ran a fitness taste profile without saying so. Now that the field is a fixed
 * list this only has to migrate old records: near-misses and the obvious
 * synonyms are normalised, and anything genuinely unrecognised returns null so
 * the caller fails loudly rather than guessing on the operator's behalf.
 */
export function coerceNiche(value: unknown): NicheKey | null {
  if (typeof value !== 'string') return null
  const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if ((NICHE_KEYS as readonly string[]).includes(slug)) return slug as NicheKey
  if (slug in ALIASES) return ALIASES[slug]
  // The label as typed, e.g. "Home fitness" -> "home-fitness".
  const byLabel = NICHE_KEYS.find(
    (k) => NICHES[k].label.toLowerCase().replace(/[\s_]+/g, '-') === slug
  )
  return byLabel ?? null
}

/** The terms a scripted search actually types. The key itself is not one. */
export function searchTermsFor(niche: NicheKey, limit = 6): string[] {
  return Object.entries(NICHES[niche].taste.interests)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term)
}

export const NICHES: Record<NicheKey, { label: string; taste: TasteProfile }> = {
  'home-fitness': {
    label: 'Home fitness',
    taste: {
      interests: {
        workout: 2, fitness: 2, gym: 2, training: 2, exercise: 2,
        dumbbell: 1.5, kettlebell: 1.5, mobility: 1.5, stretching: 1.5,
        protein: 1, nutrition: 1, cardio: 1.5, strength: 1.5, calisthenics: 1.5,
        squat: 1, pushup: 1, physique: 1, recovery: 1
      },
      avoid: [...SPAM_BAIT, 'steroid', 'sarms'],
      languages: ['en'],
      selectivity: 0.3
    }
  },
  cooking: {
    label: 'Cooking & recipes',
    taste: {
      interests: {
        recipe: 2, cooking: 2, kitchen: 2, baking: 2, meal: 2,
        dinner: 1.5, breakfast: 1.5, pasta: 1.5, sourdough: 1.5, roast: 1,
        ingredient: 1, sauce: 1, prep: 1, chef: 1.5, dish: 1, flavour: 1, flavor: 1
      },
      avoid: [...SPAM_BAIT, 'detox tea', 'weight loss pill'],
      languages: ['en'],
      selectivity: 0.3
    }
  },
  travel: {
    label: 'Travel',
    taste: {
      interests: {
        travel: 2, trip: 2, flight: 1.5, hotel: 1.5, itinerary: 2,
        backpack: 1.5, hostel: 1.5, destination: 2, roadtrip: 2,
        beach: 1, mountain: 1, city: 1, guide: 1, visa: 1, airport: 1
      },
      avoid: [...SPAM_BAIT, 'timeshare'],
      languages: ['en'],
      selectivity: 0.3
    }
  },
  tech: {
    label: 'Tech & gadgets',
    taste: {
      interests: {
        tech: 2, gadget: 2, laptop: 2, iphone: 1.5, android: 1.5,
        software: 1.5, coding: 1.5, keyboard: 1.5, review: 1, setup: 1.5,
        benchmark: 1, hardware: 1.5, app: 1, ai: 1
      },
      avoid: [...SPAM_BAIT, 'nft', 'trading bot'],
      languages: ['en'],
      selectivity: 0.3
    }
  },
  fashion: {
    label: 'Fashion & style',
    taste: {
      interests: {
        outfit: 2, fashion: 2, style: 2, wardrobe: 2, thrift: 1.5,
        sneaker: 1.5, denim: 1.5, tailoring: 1.5, lookbook: 2,
        vintage: 1, fit: 1, brand: 1, capsule: 1
      },
      avoid: [...SPAM_BAIT, 'replica', 'dhgate'],
      languages: ['en'],
      selectivity: 0.3
    }
  },
  gaming: {
    label: 'Gaming',
    taste: {
      interests: {
        gaming: 2, gameplay: 2, gamer: 2, console: 1.5, playstation: 1.5,
        xbox: 1.5, nintendo: 1.5, speedrun: 1.5, boss: 1, loadout: 1.5,
        patch: 1, update: 1, stream: 1.5, clip: 1
      },
      avoid: [...SPAM_BAIT, 'free robux', 'cheat', 'aimbot'],
      languages: ['en'],
      selectivity: 0.3
    }
  },
  pets: {
    label: 'Pets',
    taste: {
      interests: {
        dog: 2, puppy: 2, cat: 2, kitten: 2, pet: 2,
        rescue: 1.5, adoption: 1.5, training: 1.5, groom: 1, vet: 1.5,
        breed: 1, paw: 1, treat: 1
      },
      avoid: [...SPAM_BAIT, 'puppy mill'],
      languages: ['en'],
      selectivity: 0.3
    }
  },
  'home-diy': {
    label: 'Home & DIY',
    taste: {
      interests: {
        diy: 2, renovation: 2, woodworking: 2, interior: 2, decor: 2,
        furniture: 1.5, workshop: 1.5, tool: 1.5, paint: 1, shelf: 1,
        garden: 1.5, apartment: 1, makeover: 2
      },
      avoid: [...SPAM_BAIT],
      languages: ['en'],
      selectivity: 0.3
    }
  }
}

/** Niches other than this one — the pool a persona's curiosity draws from. */
export function otherNiches(key: NicheKey): NicheKey[] {
  return NICHE_KEYS.filter((k) => k !== key)
}
