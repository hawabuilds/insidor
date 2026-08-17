/**
 * THE ONE PLACE A POST ON THIS SOURCE BECOMES A LINK A PERSON CAN OPEN.
 *
 * This file closes a hole that has been open since the seed was written. Three
 * story members are posts from this source, `projectEvidence` refuses to show a
 * member it cannot link to, and no package owned this URL shape — so those
 * three cited nothing. That was the right answer while it lasted: evidence is
 * the only place a user checks our work, and the projector's own header says a
 * citation that 404s is strictly worse than an absent one. It was also an
 * argument for writing this file rather than for guessing a URL there.
 *
 * WHY THE SHAPE LIVES IN AN ADAPTER AT ALL. `Item` carries `source` and
 * `sourceItemId` and deliberately has no `url`; `public.item` has no such
 * column. A URL shape is per-platform knowledge and the vocabulary gate forbids
 * a platform's name in contracts/ or core/, so a stored link would either
 * smuggle that knowledge into the shared vocabulary or freeze one host's
 * spelling into every row we ever wrote. Deriving it means the day this
 * platform moves its paths, it moves on the line below and every citation the
 * product has ever made moves with it.
 *
 * ── ★ PREFER THE PATH THE API RETURNS, WHEN THERE IS ONE ──────────────────
 *
 * This vendor hands back a `permalink` field on every post — the fully
 * qualified, community-and-slug path it would use itself. That string is better
 * than anything we assemble, for the ordinary reason: it is the vendor's own
 * answer, so it survives the vendor changing its mind about slugs, and it is
 * the form a human recognises. `postUrlFromPath` below is that route and it is
 * the one to use ANY TIME A PAYLOAD IS IN HAND.
 *
 * It cannot be the route the projector uses, and the reason is structural
 * rather than an oversight. The shared builder type is
 * `(authorHandle, sourceItemId) => string`: the projector holds a handle and an
 * id read from two database columns and has no payload, by design — it must not
 * know a vendor's field names any more than core must. And a handle is no help
 * here even though it is offered, because this source's canonical path is
 * qualified by the COMMUNITY a post was made in, which is not the author and is
 * not anywhere in the two facts the seam carries.
 *
 * So `postUrl` builds the id-only form, which needs neither. That is not a
 * degraded fallback: it is the URL every other spelling redirects TO.
 * `https://redd.it/<id>` answers `301` with `location:
 * https://www.reddit.com/comments/<id>` — verified live rather than assumed —
 * and the community-qualified path 301s toward the same place. We cite the
 * destination and not the redirect, for the same reason the other adapter does:
 * a permalink is where a user checks our work, so it is worth one fewer hop
 * that somebody who is not us can withdraw, and a redirect that quietly stops
 * redirecting turns every citation we have ever published into a dead link at
 * once.
 */

/**
 * ★ THE ONE CONCRETE TRAP, AND IT IS ALREADY IN OUR DATA.
 *
 * `sourceItemId` on this source is the FULLNAME — `t3_1a2b3c` — because that is
 * what the batch lookup endpoint takes and what a listing returns as `name`.
 * The URL takes the BARE base-36 id. `https://www.reddit.com/comments/t3_1a2b3c`
 * is not the post.
 *
 * Nothing upstream catches this. The projector's gate is
 * `/^[A-Za-z0-9._~-]+$/`, which admits the underscore, so the wrong URL would
 * be built, shipped and rendered without a single complaint — precisely the
 * "citation that goes somewhere wrong" the seam exists to prevent. The three
 * seeded members already store fullnames, so this is not a hypothetical: it is
 * the first thing that would have broken.
 */
const FULLNAME_PREFIX = /^t3_([0-9a-z]+)$/i;

/** The canonical host. Not the short domain, which redirects here. */
const HOST = 'https://www.reddit.com';

/**
 * The public link to a post, from the two facts the projector holds.
 *
 * `authorHandle` is accepted and DELIBERATELY UNUSED — it is part of the shared
 * builder signature, and on this source the author is not in the path at all.
 * Naming it rather than dropping it keeps the shape of the seam visible at the
 * one place a reader would go looking for it.
 *
 * The id may arrive as a fullname or already bare; both are accepted, because
 * which one a row holds is a property of when it was written and not of this
 * source. An id in neither shape is passed through unchanged: this function is
 * total by contract — the builder type has no way to say "I cannot address
 * that" and a throw here would take down the whole projection frame — and an id
 * we did not mint is not one we can repair by guessing. The projector's shape
 * gate and this package's own id minting are what keep that branch unreachable
 * in practice.
 */
export const postUrl = (authorHandle: string, sourceItemId: string): string => {
  void authorHandle;
  const bare = FULLNAME_PREFIX.exec(sourceItemId)?.[1] ?? sourceItemId;
  return `${HOST}/comments/${bare}`;
};

/**
 * What a post's own `permalink` field means as a URL, or null when it is not a
 * post path we recognise.
 *
 * ★ NULL RATHER THAN A PREFIXED STRING, BECAUSE THIS INPUT IS VENDOR-CONTROLLED.
 * Concatenating a fixed origin with a string somebody else chose is how an
 * on-host link stops being on-host: a value beginning `//` or `/\` re-parses as
 * an authority in some clients, and the resulting citation points at a host we
 * have never heard of while looking exactly like ours. So the shape is checked
 * against what this vendor's post paths actually are — `/r/<community>/comments/
 * <id36>/<slug>/` — and anything else is an absence, which the caller is already
 * built to handle.
 *
 * Returns `string | null` rather than being total, unlike `postUrl`, because
 * nothing forces it into the shared builder type: it is called where a payload
 * is in hand, and there the honest answer to a path we cannot read is nothing.
 */
const POST_PATH = /^\/r\/[A-Za-z0-9_]{1,25}\/comments\/[0-9a-z]+(\/[A-Za-z0-9_%-]*)?\/?$/i;

/**
 * The slug segment is unbounded in the shape above, and a shape check that
 * admits an arbitrarily long string is only half a check on an input somebody
 * else chose: this vendor's own slugs are short, and a five-thousand-character
 * one is not a title, it is a payload aimed at whatever renders the citation.
 * Generous against any real path and far below the length at which a URL starts
 * being truncated by something downstream that will not tell us it did.
 */
const MAX_PATH_CHARS = 512;

export const postUrlFromPath = (permalinkPath: string): string | null =>
  permalinkPath.length <= MAX_PATH_CHARS && POST_PATH.test(permalinkPath)
    ? `${HOST}${permalinkPath}`
    : null;
