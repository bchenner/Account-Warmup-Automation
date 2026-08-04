import { z } from 'zod'

/**
 * Selectors live in data, not code.
 *
 * With no AI in the loop there is no intelligent fallback when a selector
 * breaks — a miss aborts the session. Meta ships obfuscated, build-hashed class
 * names that change weekly, so the only sustainable answer is that fixing drift
 * is a file edit rather than a code change and a deploy.
 *
 * Preference order when writing these: ARIA role and accessible name first,
 * stable data-* attributes second, visible text third, CSS classes last and
 * only when nothing else exists.
 */

export const FeedSelectorsSchema = z.object({
  /** Where the feed lives. */
  url: z.string(),
  /** One post/card. Everything else is queried within this. */
  post: z.string(),
  caption: z.string(),
  /** Optional: many layouts fold hashtags into the caption. */
  hashtags: z.string().optional(),
  video: z.string().optional(),
  /**
   * The platform's own "See translation" affordance. Its presence is a
   * stronger language signal than any heuristic we could run.
   */
  translationPrompt: z.string().optional(),
  likeButton: z.string().optional(),
  /** Where a comment is typed, within a post. */
  commentInput: z.string().optional(),
  /** Existing comments on a post — the corpus is harvested from these. */
  commentText: z.string().optional(),
  /** Follow control shown on a post. */
  followButton: z.string().optional(),
  /** Link to the author's profile, within a post. */
  authorLink: z.string().optional(),
  /** Attribute on `post` holding a stable id, used for the comment registry. */
  postIdAttribute: z.string().default('data-post-id'),
  /** Attribute on `post` holding the author's handle, for the follow registry. */
  authorAttribute: z.string().default('data-author'),
  /**
   * Where the author's name lives when it is NOT an attribute on the post.
   *
   * Facebook puts no author attribute on a feed unit, and its author LINK is
   * indistinguishable from a mention or a photo link. What it does expose,
   * reliably, is a menu button labelled "Actions for this post by NAME" — so
   * the name is read from an attribute on a nested element, with the fixed
   * prefix stripped.
   */
  author: z.string().optional(),
  /** Attribute to read on `author`. Its text content is used when absent. */
  authorAttr: z.string().optional(),
  /** Leading text to strip from that value, e.g. "Actions for this post by ". */
  authorStrip: z.string().optional()
})

/** Stories are a distinct surface: a tray, then a full-screen viewer. */
export const StorySelectorsSchema = z.object({
  /** A story in the tray. Clicking it opens the viewer. */
  trayItem: z.string(),
  /** Advance to the next story. */
  next: z.string(),
  /** Leave the viewer. */
  close: z.string()
})

/** The account's own profile-editing surface. */
export const ProfileEditSelectorsSchema = z.object({
  url: z.string(),
  save: z.string(),
  /** One selector per editable field the schedule can mutate. */
  fields: z.record(z.string())
})

export const SearchSelectorsSchema = z.object({
  url: z.string(),
  input: z.string(),
  /** Optional results container to wait for. */
  results: z.string().optional(),
  /**
   * One result worth opening.
   *
   * Required by `explore`, which is the step that reorients an account's
   * recommendation graph. Typing a query teaches the recommender almost
   * nothing; watching what comes back is the whole signal, so a result has to
   * be openable.
   */
  resultItem: z.string().optional(),
  /** Optional tab that narrows results to video, where the platform has one. */
  videoTab: z.string().optional()
})

/**
 * INCOMING friend requests — Facebook's friend surface, read-only in one
 * direction.
 *
 * There is deliberately no "Add friend" selector here. The account never sends
 * a request: an outgoing request needs a stranger to accept it, and the
 * unaccepted ones are what get an account limited. Accepting one that arrived
 * carries none of that, so this surface is only ever the pending-requests list.
 */
export const PeopleSelectorsSchema = z.object({
  /** Where incoming friend requests are listed. */
  url: z.string(),
  /**
   * An element present on that page whether or not any requests are pending.
   *
   * Without it, "nobody has sent a request" and "the selector broke" look
   * identical — and for a warming account the first is the normal case, so
   * treating an empty list as a failure would abort almost every session.
   */
  container: z.string(),
  /** One pending-request card. Zero of these is a normal, expected state. */
  card: z.string(),
  /** The "Confirm" control, within a card. */
  acceptButton: z.string(),
  /** Name shown on the card, used to keep the fleet's graphs disjoint. */
  name: z.string().optional(),
  /** Attribute on `card` holding a stable identifier for that person. */
  idAttribute: z.string().default('data-person-id'),
  /** Optional: mutual-friend text, the best available proxy for plausibility. */
  mutuals: z.string().optional(),
  /**
   * Link to the requester's profile, within a card.
   *
   * Needed because the request card does NOT show a country. Confirming only
   * people from the account's own country means opening the profile to read
   * one — which is also what a person does before confirming a stranger.
   */
  profileLink: z.string().optional(),
  /** The location line on that profile, e.g. "Lives in Austin, Texas". */
  profileLocation: z.string().optional()
})

/** Groups — a Facebook surface with no Instagram equivalent. */
export const GroupSelectorsSchema = z.object({
  url: z.string(),
  card: z.string(),
  joinButton: z.string(),
  name: z.string().optional(),
  idAttribute: z.string().default('data-group-id')
})

export const SelectorSetSchema = z.object({
  platform: z.string(),
  version: z.string(),
  feed: FeedSelectorsSchema,
  search: SearchSelectorsSchema.optional(),
  stories: StorySelectorsSchema.optional(),
  profileEdit: ProfileEditSelectorsSchema.optional(),
  people: PeopleSelectorsSchema.optional(),
  groups: GroupSelectorsSchema.optional()
})

export type SelectorSet = z.infer<typeof SelectorSetSchema>
export type FeedSelectors = z.infer<typeof FeedSelectorsSchema>
