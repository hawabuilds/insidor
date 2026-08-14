/**
 * The one place a post on this source becomes a link a person can open.
 *
 * WHY THE URL SHAPE LIVES IN AN ADAPTER AT ALL. `Item` carries `source` and
 * `sourceItemId` and deliberately has NO `url` field, and public.item has no such
 * column. A URL shape is per-platform knowledge — tools/check-vocabulary.mjs
 * forbids a platform name anywhere in contracts/ or core/ — so a stored link would
 * either smuggle that knowledge into the shared vocabulary or freeze one host's
 * spelling into every row we ever wrote. Deriving it instead means the day this
 * platform changes its path, it changes on the line below and every citation the
 * product has ever made changes with it.
 *
 * WHY IT IS NOT IN client.ts, unlike the TikTok adapter's `postUrl`. That is a fact
 * about the two vendors rather than a filing preference: TikTok's observe actor is
 * ADDRESSED by URL, so building one there is part of talking to it. This vendor
 * takes ids at both endpoints, so nothing in this package's HTTP surface needs this
 * function. Its only caller is citation.
 */

/**
 * The canonical post URL for a handle and an id.
 *
 * ★ x.com AND NOT twitter.com. Both resolve today — the old host answers with a
 * 301 to this one — and we take the destination rather than the redirect for two
 * reasons. A permalink is the only place a user can check our work, so it is worth
 * one fewer hop that can be withdrawn by someone who is not us; and a redirect that
 * quietly stops redirecting turns every citation we have ever published into a dead
 * link at once, which is the failure mode the evidence list exists to prevent.
 *
 * `authorHandle` is the bare handle, WITHOUT the leading '@'. Whether a stored
 * handle carries the sigil is a property of the row it came from, not of this
 * source, so stripping it is the caller's job and is done once where handles are
 * read rather than guessed at in each adapter.
 */
export const postUrl = (authorHandle: string, id: string): string =>
  `https://x.com/${authorHandle}/status/${id}`;
