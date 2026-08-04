import { describe, expect, it } from 'vitest'
import { looksUnitedStates, matchesCountry, normalizeLocation } from './geo'

describe('reading a country from a profile location', () => {
  it('accepts the forms a US profile actually uses', () => {
    for (const text of [
      'Lives in Austin, TX',
      'Austin, Texas',
      'From Springfield, Massachusetts',
      'Current City: Brooklyn, NY',
      'Mesa, Arizona, United States',
      'Wilmington, DE',
      'Washington, District of Columbia',
      'lives in  new york,  ny  '
    ]) {
      expect(looksUnitedStates(text), text).toBe(true)
    }
  })

  it('rejects locations that are not US', () => {
    for (const text of [
      'Lives in London, United Kingdom',
      'Toronto, Ontario',
      'Berlin, Germany',
      'Dubai, United Arab Emirates',
      'Cairo, Egypt',
      'Lives in Sydney, Australia',
      'Paris, France'
    ]) {
      expect(looksUnitedStates(text), text).toBe(false)
    }
  })

  it('treats an unreadable location as NOT a match, never as a maybe', () => {
    // The caller uses this to decide whether to confirm a friend request, so
    // the safe answer to "I cannot tell" is no.
    for (const text of ['', '   ', null, undefined, 'Lives in', 'Earth', '—']) {
      expect(looksUnitedStates(text), String(text)).toBe(false)
    }
  })

  it('does not treat a bare "Georgia" as the US state', () => {
    // It is also a country, and guessing wrong here silently builds a friend
    // graph in the wrong hemisphere.
    expect(looksUnitedStates('Georgia')).toBe(false)
    expect(looksUnitedStates('Lives in Georgia')).toBe(false)
    // Unambiguous forms still work.
    expect(looksUnitedStates('Atlanta, Georgia, United States')).toBe(true)
    expect(looksUnitedStates('Atlanta, GA')).toBe(true)
  })

  it('only trusts a state abbreviation as the final token', () => {
    // Otherwise a street or a surname sharing the letters would match.
    expect(looksUnitedStates('OR')).toBe(false)
    expect(looksUnitedStates('Portland, OR')).toBe(true)
    expect(looksUnitedStates('IN')).toBe(false)
  })

  it('strips the prefixes profiles put in front of a location', () => {
    expect(normalizeLocation('Lives in Austin, TX')).toBe('austin, tx')
    expect(normalizeLocation('From   Boston,  MA ')).toBe('boston, ma')
    expect(normalizeLocation('Hometown: Reno, NV')).toBe('reno, nv')
  })

  it('refuses countries it has no check for, rather than passing everything', () => {
    // A half-implemented check that silently accepts everyone outside the US
    // would be worse than no check at all.
    expect(matchesCountry('London, United Kingdom', 'GB')).toBe(false)
    expect(matchesCountry('Austin, TX', 'GB')).toBe(false)
    expect(matchesCountry('Austin, TX', 'US')).toBe(true)
    expect(matchesCountry('Austin, TX', 'us')).toBe(true)
  })
})
