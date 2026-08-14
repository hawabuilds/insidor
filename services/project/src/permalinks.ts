/**
 * A SOURCE ID, AND THE FUNCTION THAT CAN BUILD A LINK TO ONE OF ITS POSTS.
 *
 * This module exists because of a hole with a shape. Evidence is the only place a
 * user can check our work, projectEvidence drops any member it cannot link to, and
 * nothing anywhere produced a link — so the list was empty on every story page. The
 * drop is correct and stays; what was missing is this.
 *
 * WHY A MAP HERE RATHER THAN A COLUMN IN THE DATABASE. `Item` has no `url` field and
 * public.item has no such column, deliberately: a URL shape is per-platform
 * knowledge and check-vocabulary forbids a platform name in contracts/ or core/. A
 * stored link would also be a string an adapter should be able to change — the day a
 * host moves, every row ever written is stale and there is no single line to fix. So
 * the link is DERIVED, at projection time, from (source, handle, sourceItemId),
 * which we already hold, by the package that owns that platform.
 *
 * The projector is allowed to name platforms; contracts and core are not. This file
 * is the seam, and it is deliberately three lines long: it knows which package owns
 * which source and NOTHING about what any of them produces.
 *
 * ★ AN UNKNOWN SOURCE YIELDS NOTHING, AND THERE IS NO FALLBACK HOST. Not a guessed
 * path, not a search URL, not the platform's home page. A citation that 404s is
 * strictly worse than an absent one: a missing row is a visible hole, whereas a user
 * who clicks a link and lands nowhere has learned that we make things up, and that
 * is not a lesson one working link later undoes. Reddit is in the seed and has no
 * adapter package yet, so reddit members cite nothing — which is the right answer
 * until somebody writes the adapter, and it is an argument for writing it rather
 * than for inventing a URL here.
 */

import { SOURCE as TIKTOK, postUrl as tiktokPostUrl } from '@insidor/platform-tiktok';
import { SOURCE as X, postUrl as xPostUrl } from '@insidor/platform-x';

/** Every builder takes the same two facts, which is what makes the map a map. */
type PermalinkBuilder = (authorHandle: string, sourceItemId: string) => string;

/**
 * Keyed by the adapter's own SOURCE constant rather than by a string literal typed
 * here. The registry does the same, and for the same reason: a literal is a second
 * spelling of the source's id, and the day the two disagree the link silently stops
 * being built for a platform that still has an adapter.
 *
 * ★ A Map AND NOT AN OBJECT LITERAL, and this is not a style preference. `source`
 * arrives from a database column, and an object literal answers for the whole
 * prototype chain as well as for its own keys: `{...}['toString']` is a function, not
 * undefined. Indexing one would mean a row whose source is `toString` builds the
 * string `[object Undefined]` and ships it as a citation — a RELATIVE href, so the
 * browser resolves it against our own origin and the "open" link lands back on us —
 * while a source of `valueOf` throws inside the projection and takes the whole frame
 * down with it. A Map has no inherited keys, so an unknown source is unknown, which
 * is the one thing the ★ at the top of this file promises. The registry resolves
 * through a Map for exactly this reason; this now genuinely does the same.
 */
const BUILDERS: ReadonlyMap<string, PermalinkBuilder> = new Map<string, PermalinkBuilder>([
  [X, xPostUrl],
  [TIKTOK, tiktokPostUrl],
]);

/**
 * What a handle or a source id may contain if we are going to put it in a URL.
 *
 * RFC 3986's unreserved set, and nothing else. This is a fact about URLs rather than
 * about any platform, which is what lets it live in the seam: every character outside
 * this set either CHANGES WHICH URL THE STRING IS — `/` `?` `#` `%` `\` `:` `@` all
 * re-parse the path — or is invisible, ambiguous, or a homograph, which is worse
 * because it looks right.
 *
 * ★ WHY REJECT RATHER THAN PERCENT-ENCODE. Escaping produces a link that is valid and
 * wrong: `x.com/good%20bad/status/1` resolves, renders, and 404s. This file's whole
 * argument is that a citation which 404s is worse than an absent one, so a handle we
 * cannot address becomes an absence — the member is dropped and the hole is visible.
 *
 * The input is not trusted and never was. public.author.handle is unconstrained `text`
 * holding whatever a vendor's payload called the account — 0002_items.sql calls it an
 * "Observed display handle" and warns it is never a join key. A stored handle of
 * `victim/status/1770000000000000009?` spliced into the path produced a URL whose path
 * is `/victim/status/1770000000000000009`, with our own `/status/1` demoted into the
 * query string. That platform serves it: a REAL post, by a different account, opening
 * cleanly under a claim we made about somebody else. A citation that goes nowhere is
 * bad; a citation that goes somewhere wrong is the worst thing this list can do.
 */
const ADDRESSABLE = /^[A-Za-z0-9._~-]+$/;

/**
 * The public link to a post, or null when we cannot honestly produce one.
 *
 * Four ways to get null, and all four are the same judgement: we do not link to a
 * post we cannot address. No adapter for the source; no handle to put in the path;
 * no id to point at; or a handle or an id that is not the kind of thing a path
 * segment can hold. Each of those is a fact we lack, and the honest projection of a
 * fact we lack is an absence — the caller drops the member, and the evidence list is
 * shorter and true instead of longer and broken.
 *
 * ★ THE '@' IS STRIPPED HERE AND NOWHERE ELSE. public.author.handle stores the
 * handle as it is DISPLAYED, which on some sources includes the sigil and on others
 * does not — that is a property of the row, not of the platform, so the adapters
 * stay dumb and take a bare handle. Doing it per-adapter would mean every future
 * adapter has to remember, and the one that forgets emits `x.com/@name/status/1`,
 * which is a 404 that reads as a real link.
 *
 * ★ THE SHAPE CHECK IS HERE FOR THE SAME REASON THE STRIP IS. Every builder splices
 * these two strings into a path, and a builder cannot defend itself against a string
 * it is handed. One gate in front of all of them is a gate a new adapter cannot
 * forget to write.
 */
export function permalinkFor(
  source: string,
  authorHandle: string | null,
  sourceItemId: string | null,
): string | null {
  const build = BUILDERS.get(source);
  if (build === undefined) return null;

  /* The trim is before the sigil and NOT after it, which is the difference between
     tidying a stored value and rewriting one. `'  @name  '` is `@name` with storage
     whitespace around it. `'@ name'` is a handle that genuinely begins with a space —
     trimming that one would cite `x.com/name`, an account we have no evidence the
     author owns. The shape check below rejects it instead. */
  const handle = (authorHandle ?? '').trim().replace(/^@+/, '');
  if (!ADDRESSABLE.test(handle)) return null;

  const id = (sourceItemId ?? '').trim();
  if (!ADDRESSABLE.test(id)) return null;

  return build(handle, id);
}
