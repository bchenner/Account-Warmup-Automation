/**
 * Deciding what a persona engages with.
 *
 * Deliberately the *predictable* half of the system. Timing and motion are
 * randomised so there is no signature; taste is stable, because a person who
 * likes random things looks less human than one with coherent interests — and
 * the platform is building an interest graph out of this either way.
 *
 * Everything here is arithmetic over word lists. No model, no classifier
 * service, no network call.
 */

import { chance, clamp, makeRng, uniform } from './human'

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/**
 * Non-Latin scripts. Presence of these in any quantity rules out English
 * without needing to identify the actual language.
 */
const NON_LATIN =
  /[Ѐ-ӿ؀-ۿऀ-ॿ฀-๿぀-ヿ㐀-鿿가-힯֐-׿]/

/**
 * Function words, which are the highest-signal cheap discriminator: they are
 * frequent, short, and almost never shared across these languages. Content
 * words (nouns, brand names, hashtags) are useless here — "protein" and
 * "fitness" appear in all of them.
 */
const STOPWORDS: Record<string, readonly string[]> = {
  en: ['the','and','is','to','of','in','that','it','you','for','with','on','this','are','was','but','have','not','from','they','what','all','your','just','can','how','when','been','would','there','my','me','we','do','get','more','about','out','if','who','will','one','like','so','some','than','then','now','only','over','also','because','into','after','before','make','made','never','always'],
  es: ['el','la','los','las','de','que','y','en','un','una','por','con','para','como','pero','más','este','esta','todo','todos','muy','sin','sobre','también','hasta','desde','cuando','porque','entre','mientras','aunque','donde','quien','cual','nada','nunca','siempre','ahora','antes','después','hacer','tiene','está'],
  pt: ['de','que','em','para','com','não','uma','os','no','se','na','por','mais','das','dos','como','mas','ao','ele','ela','isso','você','muito','quando','porque','então','sempre','nunca','agora','antes','depois','fazer','está','são','pelo','pela'],
  fr: ['le','la','les','de','des','et','est','un','une','dans','que','pour','qui','pas','sur','avec','plus','ce','au','il','elle','vous','nous','mais','ou','comme','tout','tous','quand','parce','toujours','jamais','maintenant','avant','après','faire','sont'],
  de: ['der','die','das','und','ist','den','von','zu','mit','sich','auf','für','nicht','ein','eine','als','auch','es','an','werden','aus','er','hat','dass','sie','nach','wird','bei','noch','wie','immer','nie','jetzt','vor','über','durch','sind'],
  id: ['yang','dan','di','itu','dengan','untuk','tidak','ini','dari','dalam','akan','pada','juga','saya','kita','bisa','ada','sudah','karena','atau','tapi','kalau','harus','lebih','banyak','semua']
}

export type LanguageVerdict = {
  language: string
  /** 0–1. Low means the text was too short or too ambiguous to call. */
  confidence: number
}

const WORD = /[a-zà-öø-ÿ]+/gi

/** Strip the parts of a caption that carry no language signal. */
export function normalizeCaption(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\w.]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .toLowerCase()
}

/**
 * Returns `unknown` rather than guessing when the text is too short — most
 * captions are, and a wrong guess is worse than an abstention because the
 * caller can fall back to other signals.
 */
export function detectLanguage(text: string): LanguageVerdict {
  if (NON_LATIN.test(text)) return { language: 'non-latin', confidence: 0.95 }

  const words = normalizeCaption(text).match(WORD) ?? []
  if (words.length < 5) return { language: 'unknown', confidence: 0 }

  const scores = Object.entries(STOPWORDS).map(([lang, list]) => {
    const set = new Set(list)
    const hits = words.filter((w) => set.has(w)).length
    return { lang, ratio: hits / words.length }
  })
  scores.sort((a, b) => b.ratio - a.ratio)

  const [best, second] = scores
  // A language needs both an absolute floor of function words and a clear lead
  // over the runner-up. Related languages share too much for a bare argmax.
  if (best.ratio < 0.08) return { language: 'unknown', confidence: 0 }
  const lead = best.ratio - (second?.ratio ?? 0)
  if (lead < 0.03) return { language: 'unknown', confidence: 0.2 }

  return { language: best.lang, confidence: Math.min(1, best.ratio * 3 + lead * 4) }
}

// ---------------------------------------------------------------------------
// Taste
// ---------------------------------------------------------------------------

export type TasteProfile = {
  /** Weighted terms the persona is drawn to. Weight 1 is ordinary interest. */
  interests: Record<string, number>
  /** Terms that make the persona skip an item outright. */
  avoid: readonly string[]
  /** Languages this persona will engage with. */
  languages: readonly string[]
  /**
   * How selective the persona is, 0–1. Higher engages with less. Stable per
   * persona so its behaviour stays recognisable over months.
   */
  selectivity: number
  /**
   * Chance of engaging with something outside the persona's interests anyway.
   * A person who has never once watched something off-topic does not exist,
   * and an account whose behaviour maps perfectly onto a keyword list is a
   * machine. Set per persona by `withPersonality`.
   */
  curiosity?: number
  /**
   * Chance of scrolling past something squarely on-topic. Same reasoning in
   * reverse — nobody watches everything in their own niche.
   */
  fickleness?: number
}

export type ContentItem = {
  caption: string
  hashtags?: readonly string[]
  /**
   * Instagram and Facebook render a "See translation" affordance when a caption
   * is not in the viewer's language. That is the platform's own judgement and
   * beats any heuristic we could run.
   */
  hasTranslationPrompt?: boolean
}

export type EngagementVerdict = {
  engage: boolean
  language: string
  score: number
  reason: string
}

function terms(item: ContentItem): string[] {
  const tags = (item.hashtags ?? []).map((t) => t.replace(/^#/, '').toLowerCase())
  const words = normalizeCaption(item.caption).match(WORD) ?? []
  return [...words, ...tags]
}

/**
 * How well an item matches the persona, normalised so a long caption cannot
 * outscore a tight one just by containing more words.
 */
export function interestScore(item: ContentItem, taste: TasteProfile): number {
  const t = terms(item)
  if (t.length === 0) return 0

  let score = 0
  for (const word of t) {
    for (const [term, weight] of Object.entries(taste.interests)) {
      // Substring match so "workouts" hits the interest "workout".
      if (word.includes(term)) score += weight
    }
  }
  // Diminishing returns: ten mentions of one interest is not ten times the pull.
  return Math.min(1, Math.sqrt(score) / 3)
}

/**
 * The decision. `rng` supplies a small amount of jitter around the threshold so
 * the persona is consistent in direction without being mechanically repeatable
 * on borderline items.
 */
export function shouldEngage(
  item: ContentItem,
  taste: TasteProfile,
  rng: () => number = Math.random
): EngagementVerdict {
  const lang = detectLanguage(item.caption)
  const score = interestScore(item, taste)
  const base = { language: lang.language, score }

  const t = terms(item)
  const blocked = taste.avoid.find((a) => t.some((w) => w.includes(a.toLowerCase())))
  if (blocked) return { ...base, engage: false, reason: `avoids "${blocked}"` }

  // The platform telling us it is not in our language is stronger evidence than
  // our own stopword count.
  if (item.hasTranslationPrompt) {
    return { ...base, engage: false, reason: 'platform offers a translation, so not our language' }
  }

  if (lang.language === 'non-latin') {
    return { ...base, engage: false, reason: 'non-Latin script' }
  }

  if (lang.language !== 'unknown' && !taste.languages.includes(lang.language)) {
    return { ...base, engage: false, reason: `detected ${lang.language}` }
  }

  // An unidentifiable caption is common and not itself disqualifying — but it
  // has to earn engagement on interest alone, with no benefit of the doubt.
  const threshold = taste.selectivity * (lang.language === 'unknown' ? 1.35 : 1)
  const jittered = threshold * (0.85 + rng() * 0.3)

  const onTopic = score >= jittered

  // Deliberate inconsistency. Without these two, behaviour maps exactly onto a
  // keyword list — which is a cleaner signature than no filtering at all.
  if (onTopic && rng() < (taste.fickleness ?? 0)) {
    return { ...base, engage: false, reason: 'scrolled past despite matching — fickleness' }
  }
  if (!onTopic && rng() < (taste.curiosity ?? 0)) {
    return { ...base, engage: true, reason: 'off-topic but watched anyway — curiosity' }
  }

  return onTopic
    ? { ...base, engage: true, reason: `matches interests (${score.toFixed(2)})` }
    : { ...base, engage: false, reason: `too far from interests (${score.toFixed(2)})` }
}

/**
 * Give a taste profile a stable personality. Seeded from the persona slug, so
 * one persona is open-minded and another narrow, and both stay that way.
 */
export function withPersonality(taste: TasteProfile, personaSlug: string): TasteProfile {
  const rng = makeRng(`taste:${personaSlug}`)
  return {
    ...taste,
    selectivity: clamp(taste.selectivity * uniform(0.75, 1.3, rng), 0.15, 0.55),
    curiosity: uniform(0.04, 0.14, rng),
    fickleness: uniform(0.08, 0.22, rng)
  }
}

export type WatchPlan = {
  /** Fraction of the video to watch, 0–1. */
  fraction: number
  /** Whether to like it. Only ever true for something actually watched. */
  like: boolean
  reason: string
}

/**
 * How much of a video to watch, and whether to like it.
 *
 * Watch-to-completion is a strong positive signal to the recommender, so it is
 * reserved for content the persona actually cares about — but not exclusively,
 * because "always finishes on-topic videos, always bails on others" is itself a
 * pattern. Off-topic content usually gets a glance and a scroll.
 */
export function watchPlan(
  item: ContentItem,
  taste: TasteProfile,
  opts: { likeRate: number },
  rng: () => number = Math.random
): WatchPlan {
  const verdict = shouldEngage(item, taste, rng)

  if (!verdict.engage) {
    // A glance. Long enough to have registered the video, short enough to read
    // as disinterest.
    return { fraction: uniform(0.04, 0.3, rng), like: false, reason: verdict.reason }
  }

  // Interested: most of it, often all of it, occasionally interrupted.
  const fraction = chance(0.55, rng) ? 1 : uniform(0.5, 0.98, rng)

  // Likes are rationed by the schedule's per-session budget, so this is a
  // propensity rather than a decision — the runner still enforces the cap.
  const like = chance(opts.likeRate, rng)

  return {
    fraction,
    like,
    reason: `${verdict.reason}${fraction === 1 ? ', watched fully' : ''}`
  }
}

/**
 * Build a stable taste profile from the persona's niche. Deterministic, so the
 * same persona always behaves the same way, and two personas with different
 * niches diverge without any per-account configuration.
 */
export function tasteFromNiche(
  niche: string,
  opts: { languages?: readonly string[]; avoid?: readonly string[]; selectivity?: number } = {}
): TasteProfile {
  const core = (normalizeCaption(niche).match(WORD) ?? []).filter((w) => w.length > 2)
  const interests: Record<string, number> = {}
  for (const w of core) interests[w] = 2
  return {
    interests,
    avoid: opts.avoid ?? [],
    languages: opts.languages ?? ['en'],
    selectivity: opts.selectivity ?? 0.3
  }
}
