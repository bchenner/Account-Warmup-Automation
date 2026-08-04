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
  /** Attribute on `post` holding a stable id, used for the comment registry. */
  postIdAttribute: z.string().default('data-post-id')
})

export const SearchSelectorsSchema = z.object({
  url: z.string(),
  input: z.string(),
  /** Optional results container to wait for. */
  results: z.string().optional()
})

export const SelectorSetSchema = z.object({
  platform: z.string(),
  version: z.string(),
  feed: FeedSelectorsSchema,
  search: SearchSelectorsSchema.optional()
})

export type SelectorSet = z.infer<typeof SelectorSetSchema>
export type FeedSelectors = z.infer<typeof FeedSelectorsSchema>
