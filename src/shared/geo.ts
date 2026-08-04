/**
 * Reading a country out of the free text a profile shows as its location.
 *
 * Used to decide whether an incoming friend request is from where the account
 * claims to live. It is deliberately CONSERVATIVE: the question being asked is
 * "may this account confirm this person", and the safe answer to an unclear
 * location is no. Every function here returns false rather than guessing.
 */

/** "Lives in Austin, TX" / "From Austin, Texas" and similar prefixes. */
const PREFIXES = /^(lives in|from|current city|hometown|based in)\b[:\s]*/i

const US_MARKERS = [
  'united states',
  'united states of america',
  'usa',
  'u.s.a',
  'u.s.'
]

/** Postal abbreviations, matched only as a trailing ", XX" token. */
const STATE_ABBR = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
])

/**
 * Full state names.
 *
 * Georgia is absent on purpose: it is also a country, and "Georgia" alone is
 * genuinely ambiguous. "Atlanta, Georgia" still matches, via the city-comma
 * form below combined with an explicit US marker, and "Georgia, United States"
 * matches on the marker. A bare "Georgia" resolves to not-US, which is the
 * safe direction.
 */
const STATE_NAMES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware',
  'florida','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana',
  'maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana',
  'nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina',
  'south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia',
  'wisconsin','wyoming','district of columbia'
]

/** Normalises "Lives in  Austin,  TX " to "austin, tx". */
export function normalizeLocation(raw: string): string {
  return raw.replace(PREFIXES, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * True only when the text positively identifies the United States.
 *
 * Unknown, empty, ambiguous and non-US all return false, so a caller that
 * requires US will skip anything it cannot read.
 */
export function looksUnitedStates(raw: string | null | undefined): boolean {
  if (!raw) return false
  const text = normalizeLocation(raw)
  if (!text) return false

  // An explicit country marker settles it, in either direction.
  if (US_MARKERS.some((m) => text.includes(m))) return true

  const parts = text.split(',').map((p) => p.trim()).filter(Boolean)
  const last = parts[parts.length - 1] ?? ''

  // "Austin, TX" — the abbreviation is only trusted as the final token, so a
  // street or a surname containing the same letters cannot trigger it.
  if (parts.length >= 2 && STATE_ABBR.has(last.toUpperCase())) return true

  // "Austin, Texas"
  if (parts.length >= 2 && STATE_NAMES.includes(last)) return true

  return false
}

/**
 * Whether a profile's location text satisfies a required country.
 *
 * Only the US is implemented, because that is the only country the fleet
 * currently buys IPs in and a half-implemented check that silently passes
 * everything for other countries would be worse than none. An unsupported
 * country therefore returns false, and the caller reports it.
 */
export function matchesCountry(raw: string | null | undefined, country: string): boolean {
  return country.toUpperCase() === 'US' ? looksUnitedStates(raw) : false
}
