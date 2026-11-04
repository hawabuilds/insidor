/**
 * How a discovery page is stored: the accounts first, then the posts, with each post's text
 * phrases folded into one hash.
 *
 * Its own file so the runner's wiring and the end-to-end test store a page the same way;
 * a copy in the test would prove a sequence production does not run.
 *
 * What breaks if the order changes: a post stored before its author would create a bare
 * author row with no handle, and a story page could not cite that post until the next read.
 *
 * ★ A RESKINNED ACCOUNT'S POSTS STOP HERE (core admit/reskin.ts, the owner 2026-11-04: larp zoo
 * accounts). Every read of every lane passes through this one function, so a post from an old
 * account emptied and dressed up as someone else is never stored: it reaches no feed, narrative
 * or alert, and costs no database work. The account row is still written as before. The hold is
 * logged with the account, so it can be checked; nothing already stored is touched.
 */

import type { Author, Item, Millis, Policy } from '@insidor/contracts';
import type { FeedLane } from '@insidor/contracts/ports/platform.ts';
import { latestCounters, observationsFrom, reskinned, withTextHash } from '@insidor/core';
import type { PgAuthorRepo, PgItemRepo, PgObservationRepo } from '@insidor/store';

const MS_PER_HOUR = 3_600_000;

/** Every lane a stored post can be credited to (0025, 0030, 0061, 0083, 0084, 0088, 0097, 0115). */
export type FoundLane = FeedLane | 'watch' | 'trend' | 'creator' | 'coin_link' | 'x_repost' | 'trending' | 'middle' | 'learned_tag' | 'narrative_name' | 'quote' | 'account';

export function storeArrivals(
  repos: { readonly authors: PgAuthorRepo; readonly items: PgItemRepo; readonly observations: PgObservationRepo },
  policy: Policy,
  now: () => Millis,
  log?: { readonly info: (msg: string, fields?: Record<string, unknown>) => void },
): (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number> {
  return async (all, authors, lane = null) => {
    await repos.authors.upsert(authors);
    const held = new Set(authors.filter((a) => reskinned(a.history, now(), policy.ingest.reskin)).map((a) => a.authorKey));
    const items = held.size === 0 ? all : all.filter((item) => !held.has(item.authorKey));
    if (items.length < all.length) {
      for (const a of authors.filter((x) => held.has(x.authorKey))) {
        log?.info('reskinned account: its posts not stored', { author: a.authorKey, handle: a.handle, lane, posts: all.filter((i) => i.authorKey === a.authorKey).map((i) => i.itemId) });
      }
    }
    const stored = await repos.items.upsert(items.map((item) => withTextHash(item, policy)));
    /* Which catch-all lane found these, for the per-post score and the For You feed (0025).
       A keyword search writes nothing here, and that is what keeps its posts off the feed.
       ★ THE WATCH LANE (0061) is the owner's watch list on a source with no catch-all. Only its
       posts from the last `feed.watchMaxAgeMs` are credited: older ones the vendor sends anyway
       are stored and never judged. A post with no time is not shown to be fresh, so it is not. */
    /* The finders' word and creator asks (work/search-words.ts, 0083) and the learned-tag lane (0088)
       are the same kind of ask as the watch list's and are held to the same age. */
    const credited =
      lane === 'watch' || lane === 'trend' || lane === 'creator' || lane === 'learned_tag'
        ? items.filter((item) => item.postedAt !== null && now() - item.postedAt <= policy.feed.watchMaxAgeMs)
        : items;
    if (lane !== null) await repos.items.markFoundBy(credited.map((item) => item.itemId), lane, now());

    /* ★ THE READING DISCOVERY ALREADY PAID FOR. A search result carries each post's counts,
       and they are a real reading taken the moment we fetched it. Saved as observations
       here, every post has its views from the first minute — and the one reading a post
       off screen ever gets — without a single extra call. A post found again on a later
       pass gets a second reading the same way, against the first. */
    const ids = items.map((item) => item.itemId);
    const earlier = await repos.observations.seriesForItems(ids, (now() - policy.track.maxTrackedHours * MS_PER_HOUR) as Millis);
    /* All posts' readings in one append (one statement a thousand readings, store observations.ts),
       not one call a post: the same rows, ~660 round trips fewer a pass (2026-11-03). */
    const readings = items.flatMap((item) => {
      const counters = Object.values(item.counters).filter((c) => c !== undefined);
      if (counters.length === 0) return [];
      const capturedAt = Math.max(...counters.map((c) => c.observedAt)) as Millis;
      return observationsFrom(item.itemId, item.counters, latestCounters(earlier.get(item.itemId) ?? []), capturedAt, policy.kinetics);
    });
    if (readings.length > 0) await repos.observations.append(readings);
    return stored;
  };
}
