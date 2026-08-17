/**
 * Rendering a discovery query into one request on this source.
 *
 * The query names ONE mode and one term, because discovery verbs do not line up
 * across sources: a uniform `search(query)` returns an empty result on a source
 * that cannot search, and an empty result reads downstream as "nothing is
 * happening" — the exact failure the capability list exists to design out. So a
 * mode this source cannot express is an error here, not an empty page.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ THE ANTI-CONTAMINATION CUTOFF: THIS SOURCE CANNOT HONOUR IT, SO WE REFUSE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `DiscoveryQuery.untilMs` says nothing published at or after that instant may
 * be returned, and that an adapter which cannot enforce it SERVER-SIDE must
 * fail rather than filter client-side, because a result already counted against
 * budget has already leaked. This source cannot enforce it, and the reason is
 * not that its filter is coarse — it is that its filter is the wrong SHAPE.
 *
 * Every time filter this source has is a LOWER bound measured back from now.
 * Its own query builder is explicit about it: the `t` parameter maps to
 * `hour → _date >= timeago('1 hour')`, `day → _date >= timeago('1 day')`, and
 * so on for week, month, year, with `all → None`. Six values, all `>=`, all
 * anchored to the present. There is no upper bound in the construct at all. So
 * `t` can push the FLOOR further into the past and can never put a CEILING at a
 * past instant — which is the only thing `untilMs` asks for.
 *
 * The two workarounds both fail, and in writing:
 *
 *   1. "Page the reverse-chronological listing backwards until you cross the
 *      cutoff and discard the newer ones." That IS client-side filtering: the
 *      newer items were fetched, counted and in-process. It also cannot reach
 *      far anyway — listings on this source stop paginating at roughly a
 *      thousand items no matter how patient you are.
 *
 *   2. "Use the legacy `syntax=cloudsearch` `timestamp:<a>..<b>` range." The
 *      index field genuinely existed and the parameter is still accepted. But
 *      the search backend has been replaced since, and no primary source
 *      confirms the range is still honoured. ★ THAT UNCERTAINTY IS ITSELF
 *      DISQUALIFYING, and the reason is the direction of the failure: if a
 *      deprecated upper bound silently stops being applied, the query still
 *      answers 200 with results, and the contamination is OVER-INCLUSIVE and
 *      INVISIBLE. Every backtest quietly becomes worthless while looking green.
 *      A safety cutoff may not rest on an undocumented parameter whose
 *      withdrawal is undetectable.
 *
 * Refusing is the only honest option, and it is the precedent the other
 * cutoff-less source already set. The consequence is real and intended: a blind
 * historical run cannot be built on this source, so nobody can accidentally
 * produce one that looks blind and is not.
 *
 * ── AND WHY `sinceMs` IS TREATED COMPLETELY DIFFERENTLY ───────────────────
 *
 * `sinceMs` is a lower bound and carries no correctness claim — it has no ★ on
 * it in the port, and the other adapter renders it at DAY granularity without
 * apology. The asymmetry is the whole reason: being too WIDE on a lower bound
 * returns extra OLD items, and old items cannot know about anything that
 * happened later. Being too NARROW would silently hide real posts.
 *
 * So the widest possible rendering — no bound at all — is SAFE here, and it is
 * what this file does. Two facts force it:
 *
 *   - A plain listing takes no time filter. There is no parameter to send.
 *   - ★ On a search, `t` IS SILENTLY IGNORED unless the sort is `top` or
 *     `controversial`; the source's own code gates it on
 *     `time_filtered_sorts = set(('top', 'controversial'))`. We sort by `new`,
 *     because a ranking is this source's opinion and it moves under us. Sending
 *     `t` alongside `sort=new` would put a time bound in the request that is
 *     accepted and dropped — a parameter that looks enforced in the code, in
 *     the logs and in a review, and is not. That is how a source starts lying,
 *     so it is not sent.
 *
 * The cost is recall and a little budget, both of which are visible. The cost
 * of the alternative would be invisible.
 */

import type { Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { CAPABILITIES } from './capabilities.ts';
import type { ListingRequest, RedditClient } from './client.ts';
import { toItem } from './to-item.ts';

/** The vendor's own ceiling for one page. Asking for more returns 100. */
const MAX_PAGE = 100;

/** Letters, digits and underscores. The vendor's own rule for these names. */
const COMMUNITY = /^[A-Za-z0-9_]{1,32}$/;

/**
 * Renders a query into one request, or refuses.
 *
 * Exported and pure so the refusals above are unit-testable with no network at
 * all — which matters more than usual here, because the most important thing
 * this function does is throw.
 */
export function toListingRequest(query: DiscoveryQuery): ListingRequest {
  if (!CAPABILITIES.discovery.includes(query.mode)) {
    throw new NotImplemented(`reddit:discover:${query.mode}`, 'this source has no such entry point');
  }

  const term = query.term.trim();
  if (term.length === 0) {
    throw new NotImplemented('reddit:discover', 'this source has no "everything" feed');
  }

  if (query.untilMs !== null) {
    // See the ★ block at the top of this file. This is a refusal, not a gap.
    throw new NotImplemented(
      'reddit:discover:cutoff',
      'this source bounds time only by a coarse bucket measured back from now, so it cannot ' +
        'exclude anything published after a given instant; a blind historical run is not ' +
        'available here',
    );
  }

  // A cap on how much of a page we ask for, not a correctness filter. The
  // vendor silently clamps anything above its own ceiling, and a silent clamp
  // is worth doing ourselves so the request says what we meant.
  const limit = String(Math.min(Math.max(Math.trunc(query.limit), 1), MAX_PAGE));

  /* The cursor is the vendor's own pagination token, round-tripped verbatim.
     It is a fullname, and it goes through `URLSearchParams`, so there is
     nothing to sanitise and nothing that could change which request is made. */
  const paging: Record<string, string> = query.cursor === null ? {} : { after: query.cursor };

  if (query.mode === 'feed') {
    /* One community, newest first. ★ `new` and not `hot`: it is the only
       listing on this source whose ordering is a FACT rather than an opinion.
       A ranked listing re-orders under us between two pages, so an item can be
       seen twice or missed entirely, and the ranking is computed from exactly
       the engagement we are trying to measure. */
    const community = term.replace(/^\/?r\//i, '');
    if (!COMMUNITY.test(community)) {
      // Not encoded, rejected. A name we cannot put in a path is not a name we
      // have — and percent-encoding it would produce a request that is valid,
      // wrong, and answered with a 404 that reads as an empty community.
      throw new NotImplemented(
        'reddit:discover:feed',
        `'${term}' is not a community name on this source`,
      );
    }
    return { path: `/r/${community}/new`, query: { limit, ...paging } };
  }

  /* Keyword search, site-wide. The term is passed through VERBATIM as this
     vendor's own search syntax, exactly as the other keyword-capable source
     does with its own. That is deliberate and it is what makes a
     community-restricted search available without inventing anything: this
     vendor's `q` already understands `subreddit:<name> <words>`. Encoding a
     restriction into a mini-syntax of our own would be a syntax core would end
     up having to know, and core is not allowed to know one. */
  return {
    path: '/search',
    query: {
      q: term,
      // Chronological, for the same reason `new` is chosen above — and note
      // this is also what makes `t` unsendable; see the header.
      sort: 'new',
      // Posts only. Comments and accounts are not items on this source, and a
      // listing child of another kind is dropped by the client anyway; saying
      // so in the request means we do not pay for them.
      type: 'link',
      limit,
      ...paging,
    },
  };
}

/** One page, translated. The client call is the only line that costs anything. */
export async function discoverPage(
  client: RedditClient,
  query: DiscoveryQuery,
  at: Millis,
): Promise<{
  readonly items: readonly Item[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly returned: number;
}> {
  const page = await client.listing(toListingRequest(query));
  return {
    // A client-side slice, which is safe because it caps how much of an
    // already-paid-for page we translate rather than filtering for correctness.
    items: page.items.slice(0, query.limit).map((raw) => toItem(raw, at)),
    cursor: page.cursor,
    // The vendor said so, or it did not. Never inferred from a page size.
    hasMore: page.hasMore,
    // What came back, for the record. This source bills per call rather than
    // per item, so this does not price anything — it is reported so that "the
    // call happened and returned nothing" stays distinguishable from "the call
    // happened", which is the distinction a free source most needs.
    returned: page.items.length,
  };
}
