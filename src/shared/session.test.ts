import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import {
  formatEstimate,
  materialize,
  nextDueAt,
  planSessions,
  restSessionsFor,
  ScriptSchema,
  type Script
} from './session'
import { makeRng } from './human'

const load = (level: string, platform = 'instagram'): Script =>
  ScriptSchema.parse(
    parse(readFileSync(join(process.cwd(), `warmup/${platform}/${level}.yaml`), 'utf8'))
  )

const script = load('establish')
const PLATFORMS = ['instagram', 'facebook']
const ALL_LEVELS = ['observe', 'reorient', 'light', 'standard', 'establish']

/**
 * A level is a CEILING, not a suggestion. If `observe` is defined as "no
 * writes" then a write action must be absent from the file, because a rare
 * action still happens. These assertions are what make the level names mean
 * something — without them the difference between levels is a comment.
 */
describe('engagement levels are ceilings', () => {
  const actionsIn = (level: string, platform: string): Set<string> =>
    new Set(
      planSessions(load(level, platform), 'maya-x').flatMap((s) => s.steps.map((t) => t.action))
    )

  // Every write the runner can perform. A level that disallows one must not
  // contain it AT ALL — a rare action still happens, so a ceiling expressed as
  // a low skipChance is not a ceiling.
  const WRITES = ['like', 'follow', 'comment', 'profile_mutation', 'accept_friend', 'join_group']

  it('reorient searches and watches, and still writes nothing', () => {
    // A preparation mode, not a rung on the ladder: it acts on the recommender
    // rather than on other people, so it must remain as safe as `observe`.
    for (const platform of PLATFORMS) {
      const actions = actionsIn('reorient', platform)
      expect([...actions], platform).toContain('explore')
      for (const w of WRITES) {
        expect([...actions], `${platform}/reorient contains ${w}`).not.toContain(w)
      }
    }
  })

  for (const platform of PLATFORMS) {
    describe(platform, () => {
      it('observe never writes at all', () => {
        const actions = actionsIn('observe', platform)
        for (const w of WRITES) expect([...actions], `observe contains ${w}`).not.toContain(w)
      })

      it('light never sends friend requests, joins groups, comments or edits the profile', () => {
        const actions = actionsIn('light', platform)
        expect([...actions]).toContain('like')
        for (const w of ['comment', 'profile_mutation', 'accept_friend', 'join_group']) {
          expect([...actions], `light contains ${w}`).not.toContain(w)
        }
      })

      it('standard does everything except touch the profile', () => {
        const actions = actionsIn('standard', platform)
        for (const w of ['like', 'follow', 'comment']) expect([...actions], w).toContain(w)
        // The whole reason this level exists: an aged account already HAS a
        // name, bio and avatar, and rewriting them reads as a stolen account.
        expect([...actions], 'standard must never mutate an aged profile').not.toContain(
          'profile_mutation'
        )
      })

      it('establish is the only level that builds a profile', () => {
        expect([...actionsIn('establish', platform)]).toContain('profile_mutation')
      })

      it('every level is loadable, declares its platform, and covers its sessions', () => {
        for (const level of ALL_LEVELS) {
          const s = load(level, platform)
          expect(s.platform, `${platform}/${level}`).toBe(platform)
          const plan = planSessions(s, 'maya-x')
          expect(plan, `${platform}/${level}`).toHaveLength(s.length)
          for (const session of plan) {
            expect(session.steps.length, `${platform}/${level} #${session.index}`).toBeGreaterThan(0)
          }
        }
      })
    })
  }

  const firstOf = (level: string, action: string, platform = 'instagram'): number =>
    planSessions(load(level, platform), 'maya-x').findIndex((s) =>
      s.steps.some((t) => t.action === action)
    )

  it('comments are the last write to appear, at every level that has them', () => {
    for (const platform of PLATFORMS) {
      for (const level of ['light', 'standard', 'establish']) {
        const comment = firstOf(level, 'comment', platform)
        if (comment < 0) continue // the level never comments, which is allowed
        for (const earlier of ['like', 'follow', 'accept_friend']) {
          const at = firstOf(level, earlier, platform)
          if (at >= 0) {
            expect(at, `${platform}/${level}: ${earlier} before comment`).toBeLessThan(comment)
          }
        }
      }
    }
  })

  it('likes precede follows on an account that already has a feed', () => {
    // But NOT on `establish`. A brand-new account's feed is empty, so it has
    // to follow someone before there is anything to like. On an aged account
    // the feed already exists, so the cheaper action comes first.
    for (const platform of PLATFORMS) {
      for (const level of ['light', 'standard']) {
        const like = firstOf(level, 'like', platform)
        const follow = firstOf(level, 'follow', platform)
        if (like >= 0 && follow >= 0) {
          expect(like, `${platform}/${level}: like before follow`).toBeLessThan(follow)
        }
      }
    }
    expect(firstOf('establish', 'follow')).toBeLessThan(firstOf('establish', 'like'))
  })

  it('NO level, on any platform, ever sends a friend request', () => {
    // The account never initiates. All of the risk in a friend edge sits on the
    // sending side — an outgoing request needs a stranger to accept it, and the
    // unaccepted ones are what get an account limited. There is no step kind
    // for it, and there must be no step for it in any programme.
    for (const platform of PLATFORMS) {
      for (const level of ALL_LEVELS) {
        const actions = planSessions(load(level, platform), 'maya-x').flatMap((s) =>
          s.steps.map((t) => t.action)
        )
        expect(actions, `${platform}/${level}`).not.toContain('friend_request')
        expect(actions, `${platform}/${level}`).not.toContain('add_friend')
      }
    }
  })

  it('no level creates a friend edge at all, in either direction', () => {
    // Sending has no step kind and never will. Accepting is switched off for
    // now — the capability is built and tested, but nothing schedules it, so
    // no programme currently produces a friend.
    for (const platform of PLATFORMS) {
      for (const level of ALL_LEVELS) {
        const actions = planSessions(load(level, platform), 'maya-x').flatMap((s) =>
          s.steps.map((t) => t.action)
        )
        expect(actions, `${platform}/${level}`).not.toContain('accept_friend')
      }
    }
  })

  it('if acceptance is switched back on, it stays late and small', () => {
    // Guards the shape rather than the presence, so re-enabling it cannot
    // quietly reintroduce a burst or put it ahead of the cheaper actions.
    for (const platform of PLATFORMS) {
      for (const level of ALL_LEVELS) {
        const plan = planSessions(load(level, platform), 'maya-x')
        const accept = plan.findIndex((s) => s.steps.some((t) => t.action === 'accept_friend'))
        if (accept < 0) continue
        for (const cheaper of ['like', 'follow']) {
          const at = firstOf(level, cheaper, platform)
          if (at >= 0) {
            expect(at, `${platform}/${level}: ${cheaper} before accept_friend`).toBeLessThan(accept)
          }
        }
        for (const step of plan.flatMap((s) => s.steps).filter((t) => t.action === 'accept_friend')) {
          expect(step.count?.[1] ?? 0, `${platform}/${level}: confirmations per session`).toBeLessThanOrEqual(2)
        }
      }
    }
  })

  it('group joins stay far below the reported daily ceiling', () => {
    for (const level of ALL_LEVELS) {
      const counts = planSessions(load(level, 'facebook'), 'maya-x')
        .flatMap((s) => s.steps)
        .filter((t) => t.action === 'join_group')
        .map((t) => t.count?.[1] ?? 0)
      for (const c of counts) expect(c, `${level}: ${c} groups in one session`).toBeLessThanOrEqual(2)
    }
  })
})

describe('the shipped Instagram script', () => {
  it('validates against the schema', () => {
    expect(script.platform).toBe('instagram')
    expect(script.length).toBe(18)
  })

  it('covers every session index with a definition or a rest day', () => {
    const plan = planSessions(script, 'maya-instagram')
    expect(plan).toHaveLength(18)
    for (const s of plan) {
      expect(s.steps.length, `session ${s.index}`).toBeGreaterThan(0)
    }
  })

  it('starts read-only — no engagement before the profile is built', () => {
    const plan = planSessions(script, 'maya-instagram')
    const early = plan.slice(0, 4).flatMap((s) => s.steps.map((st) => st.action))
    expect(early).not.toContain('follow')
    expect(early).not.toContain('like')
    expect(early).not.toContain('comment')
  })

  it('spreads profile mutations across separate sessions', () => {
    const plan = planSessions(script, 'maya-instagram')
    const mutationSessions = plan
      .filter((s) => s.steps.some((st) => st.action === 'profile_mutation'))
      .map((s) => s.index)
    // Username, display name and bio-link land on their own days rather than
    // all changing at once, which is what the reference schedule does.
    expect(mutationSessions.length).toBeGreaterThan(2)
    expect(new Set(mutationSessions).size).toBe(mutationSessions.length)
  })
})

describe('rest placement', () => {
  it('is stable for an account', () => {
    expect([...restSessionsFor(script, 'maya')]).toEqual([...restSessionsFor(script, 'maya')])
  })

  it('spreads rest patterns across the fleet rather than concentrating', () => {
    // A weaker "more than one distinct pattern" assertion passes even when
    // nearly every account collides, so measure the distribution instead.
    const N = 200
    const counts = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const k = [...restSessionsFor(script, `acct-${i}`)].sort((x, y) => x - y).join(',')
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    expect(counts.size).toBeGreaterThan(35)
    // No single pattern should dominate the fleet.
    expect(Math.max(...counts.values()) / N).toBeLessThan(0.06)
  })

  it('respects the declared window and count', () => {
    for (let i = 0; i < 50; i++) {
      const rest = [...restSessionsFor(script, `acct-${i}`)]
      expect(rest.length).toBeGreaterThanOrEqual(2)
      expect(rest.length).toBeLessThanOrEqual(3)
      for (const r of rest) {
        expect(r).toBeGreaterThanOrEqual(8)
        expect(r).toBeLessThanOrEqual(17)
      }
    }
  })

  it('never clumps rest days together — that reads as abandonment', () => {
    for (let i = 0; i < 50; i++) {
      const rest = [...restSessionsFor(script, `acct-${i}`)].sort((a, b) => a - b)
      for (let j = 1; j < rest.length; j++) {
        expect(rest[j] - rest[j - 1], `acct-${i}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('marks rest sessions as rest, with something to actually run', () => {
    const plan = planSessions(script, 'maya-instagram')
    const rests = plan.filter((s) => s.kind === 'rest')
    expect(rests.length).toBeGreaterThan(0)
    for (const r of rests) {
      expect(r.label.toLowerCase()).toContain('rest')
      expect(r.steps.every((s) => s.action === 'feed_scroll')).toBe(true)
    }
  })
})

describe('duration estimates', () => {
  const plan = planSessions(script, 'maya-instagram')

  it('gives every session a sane, ordered range', () => {
    for (const s of plan) {
      expect(s.estimateMs[0], `session ${s.index}`).toBeLessThan(s.estimateMs[1])
      expect(s.estimateMs[0]).toBeGreaterThan(20_000)
      expect(s.estimateMs[1]).toBeLessThan(60 * 60_000)
    }
  })

  it('estimates rest sessions as much shorter than active ones', () => {
    const rest = plan.find((s) => s.kind === 'rest')!
    const active = plan.find((s) => s.index >= 10 && s.kind === 'active')!
    expect(rest.estimateMs[1]).toBeLessThan(active.estimateMs[0])
  })

  it('scales with the account tempo, so the number matches the account', () => {
    const a = planSessions(script, 'fast-one')[0].estimateMs[1]
    const b = planSessions(script, 'slow-one')[0].estimateMs[1]
    expect(a).not.toBe(b)
  })

  it('formats readably', () => {
    expect(formatEstimate([300_000, 660_000])).toBe('about 5–11 min')
    expect(formatEstimate([300_000, 320_000])).toBe('about 5 min')
  })
})

describe('materialize', () => {
  it('drops steps according to their skip chance, so sessions vary', () => {
    const session = planSessions(script, 'maya-instagram').find((s) => s.index === 12)!
    const lengths = Array.from({ length: 60 }, (_, i) =>
      materialize(session, makeRng(`m${i}`)).length
    )
    expect(new Set(lengths).size).toBeGreaterThan(1)
    expect(Math.max(...lengths)).toBeLessThanOrEqual(session.steps.length)
  })
})

describe('next-session timing', () => {
  it('is unknown until a session has been run', () => {
    expect(nextDueAt(null, 'maya', 1)).toBeNull()
  })

  it('lands roughly a day later, jittered so it is not the same clock time', () => {
    const last = '2026-08-01T09:00:00.000Z'
    const hours = [1, 2, 3, 4, 5].map(
      (i) => (nextDueAt(last, 'maya', i)! - Date.parse(last)) / 3600_000
    )
    for (const h of hours) {
      expect(h).toBeGreaterThanOrEqual(18)
      expect(h).toBeLessThanOrEqual(32)
    }
    expect(new Set(hours.map((h) => Math.round(h))).size).toBeGreaterThan(1)
  })
})
