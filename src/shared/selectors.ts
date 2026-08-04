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
  authorAttribute: z.string().default('data-author')
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
  results: z.string().optional()
})

/**
 * People suggestions — Facebook's friend surface.
 *
 * A friend request is not a follow. It is bidirectional and needs the other
 * person to accept, so a pile of pending requests nobody answered is itself
 * the signal that gets an account limited. That makes the SOURCE matter:
 * suggestions ("People you may know") are drawn from mutual connections and
 * get accepted; strangers from search do not.
 */
export const PeopleSelectorsSchema = z.object({
  /** Where suggestions live, e.g. the friends page. */
  url: z.string(),
  /** One suggestion card. */
  card: z.string(),
  /** The "Add friend" control, within a card. */
  addButton: z.string(),
  /** Name shown on the card, used to keep the fleet's graphs disjoint. */
  name: z.string().optional(),
  /** Attribute on `card` holding a stable identifier for that person. */
  idAttribute: z.string().default('data-person-id'),
  /** Optional: mutual-friend text, the best available proxy for plausibility. */
  mutuals: z.string().optional()
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
