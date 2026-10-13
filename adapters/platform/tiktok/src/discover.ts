/**
 * Rendering a discovery query into this source's actor input, or refusing.
 *
 * The query names ONE mode and one term, because discovery verbs do not line up
 * across sources: a uniform `search(query)` returns an empty result on a source that
 * cannot search, and an empty result reads downstream as "nothing is happening" —
 * the exact failure the capability list exists to design out. So a mode this source
 * cannot express is an error here, not an empty page.
 *
 * WHY THIS IS ITS OWN FILE, given it used to sit in `index.ts`. The most important
 * thing in it is a REFUSAL, and a refusal is only worth anything if it has a test.
 * The other two sources split their query rendering out for exactly this reason, and
 * the refusal below was the one thing in this package with no test at all.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ THE ANTI-CONTAMINATION CUTOFF: REFUSED, AND THE REASON IS NOT THE OBVIOUS ONE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `DiscoveryQuery.untilMs` says nothing published at or after that instant may be
 * returned, and that an adapter which cannot enforce it SERVER-SIDE must fail rather
 * than filter client-side. This source refuses it. The wording of that refusal used
 * to be "this source cannot bound discovery by time", and THAT IS NOT TRUE — a
 * reader holding the scraper's input schema will find `newestPostDate` ("only videos
 * uploaded before or on this date will be scraped"), conclude the refusal is a stale
 * mistake, and remove it. So the true reasons, all four, in the order that matters:
 *
 *   1. ★ IT IS THE SCRAPER'S FILTER, NOT THE PLATFORM'S, AND THAT IS DECISIVE ON ITS
 *      OWN. The candidate set is whatever the hashtag or profile feed shows AT RUN
 *      TIME — a ranking computed from all engagement to date, including everything
 *      that happened after the cutoff. Filtering that set by upload date afterwards
 *      does not make the run blind. It makes a contaminated selection LOOK blind,
 *      which is strictly worse than an obviously contaminated one, because nobody
 *      goes looking for the flaw in a run that appears clean.
 *
 *   2. ★ WHICH ACTOR IS CONFIGURED IS NOT KNOWABLE TO THIS CODE. The actor id is a
 *      swappable environment variable with no default, on purpose. `newestPostDate`
 *      is ONE actor family's input key; an actor that does not declare it typically
 *      IGNORES the unknown key and answers 200 with unfiltered results. That is the
 *      same disqualification the other cutoff-less source wrote down — a safety
 *      cutoff may not rest on a parameter whose withdrawal is undetectable — except
 *      worse, because here the parameter's support depends on an unvalidated
 *      environment variable rather than on a vendor's changelog.
 *
 *   3. GRANULARITY. The documented form is an ISO date, optionally with a time, or a
 *      relative expression in days. The other source rejected day granularity in
 *      writing: a coin minted at 09:02 would still see everything else posted that
 *      day. Nothing available here is better than what was already rejected there.
 *
 *   4. FAILURE DIRECTION. If the filter is silently not applied, the run answers 200
 *      with results, the contamination is over-inclusive and INVISIBLE, and every
 *      backtest quietly becomes worthless while looking green.
 *
 * The consequence is real and intended: a blind historical run cannot be built on
 * this source, so nobody can accidentally produce one that looks blind and is not.
 *
 * ── ★ AND WHY `resultsPerPage` IS SENT ANYWAY, WHICH LOOKS LIKE THE OPPOSITE ──
 *
 * It is the same kind of parameter — one actor family's key, unverifiable, silently
 * ignorable — and it is sent, because the FAILURE DIRECTION is the reverse. If a
 * cutoff is ignored, the result is over-inclusive and contaminates a decision. If a
 * size bound is ignored, the result is over-inclusive and costs a little more
 * scraping, and the caller slices it to `limit` regardless. One is a correctness
 * claim we would be unable to keep; the other is a hint about how much work to do.
 * That asymmetry — not the parameter's provenance — is what decides whether an
 * unverifiable bound may be relied on. It is also capped (`DISCOVER_RESULTS_CAP`): the
 * vendor charges per post returned, and the run's quoted price is only a bound because
 * the size is.
 *
 * ── ★ KEYWORD SEARCH, OVER THE PAST DAY, IN TWO ORDERS BY TURNS ──
 *
 * The scraper's video search (`searchQueries`, the `/video` section) is the first entry
 * point because the owner asked for it over hashtags when it exists, and it matches a word
 * in a caption as well as a tag. It is sent over the past day (`videoSearchDateFilter:
 * PAST_24_HOURS`) and, ★ SINCE THE AFTERNOON OF 2026-10-13, IN TWO ORDERS BY TURNS
 * (`SearchOrder`): most liked first, which finds the day's big videos — but at 12 to 22 hours
 * old, with their growth behind them — and newest first, which finds videos under an hour old
 * with a few thousand views, the only ones the growth paths and the fast re-reads can still
 * act on. Measured on "meme" at 14:05 and 14:12 UTC: newest first, ten videos 0.6 to 1.0 hours
 * old at 1.4k to 26k views; most liked, ten at 0.8 to 22 hours old, 28k to 3.2M views. Both
 * are charged filters ($0.001 a post each) and both go through the scraper's mobile route.
 *
 * ★ THAT ROUTE FAILS FOR STRETCHES AND SAYS IT SUCCEEDED. From 13:20 to 13:56 UTC on
 * 2026-10-13 every run spent its minutes failing device registration and ended SUCCEEDED,
 * "Scraped 0/1 search queries", with nothing or one stale post in it — the newest-first sort
 * did the same earlier that day. A run that did not finish its search is therefore an outage
 * here, not a quiet word (`client.ts`, `requireSearchFinished`). There is no shorter window:
 * the scraper's `oldestPostDateUnified` ("6 hours") is ignored by search (a run with it returned videos up to 22 hours old).
 *
 * The date filter is a hint here in the same sense as the size bound below, not a correctness
 * claim this package makes: the runner checks each post's own time and credits only posts from
 * the last day to the feed (services/runner/src/work/arrivals.ts, Policy.feed.watchMaxAgeMs), so
 * a filter the vendor ignored costs a little money and never puts an old post on screen.
 *
 * ★ SINCE 16:30 UTC ON 2026-10-13 A KEYWORD ASK GOES TO A SECOND ACTOR WHEN ONE IS CONFIGURED
 * (`TIKTOK_SEARCH_ACTOR_ID`, search-actor.ts): newest first over the past day, several watch words
 * a run, a median 1.35 hours old when measured, at about a tenth of this scraper's price a video.
 * Every video it returns is kept, not sliced to `limit`: each was billed, and its floor is 30 a
 * word whatever is asked. Without that variable keyword asks stay here, with every word in
 * `searchQueries`, and the rule above still makes a partly scraped run an outage.
 *
 * Keyword search is still not a catch-all. It needs words, and there is no trending or
 * explore feed on this scraper to stand in for "whatever is moving"; the caller supplies
 * the words (the owner's watch list in policy).
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented, rec, str } from '@insidor/vendor-kit';

import { CAPABILITIES, DISCOVER_RESULTS_CAP } from './capabilities.ts';
import type { TikTokClient } from './client.ts';
import { fromSearchActor, SEARCH_ACTOR_RESULTS_PER_WORD, toSearchActorInput } from './search-actor.ts';
import { toAuthor, toItem } from './to-item.ts';

/** Which order a keyword search asks for. The adapter alternates them (index.ts `nextOrder`). */
export type SearchOrder = 'most_liked' | 'newest';
export const SEARCH_ORDERS: readonly SearchOrder[] = ['newest', 'most_liked'];

/** What the actor is asked to do. Keys are this scraper family's; nothing else knows them. */
export interface ActorInput {
  readonly searchQueries?: readonly string[];
  /** `/video`: posts only, not the accounts a word also matches. */
  readonly searchSection?: '/video';
  readonly hashtags?: readonly string[];
  readonly profiles?: readonly string[];
  /** A hint, not a guarantee — see the header's last section for why that is fine. */
  readonly resultsPerPage?: number;
  /** The video search's order: most liked or newest first (a charged filter either way). */
  readonly videoSearchSorting?: 'MOST_LIKED' | 'LATEST';
  /** The video search's window: the past day (a charged filter). */
  readonly videoSearchDateFilter?: 'PAST_24_HOURS';
}

/**
 * Renders a query into actor input, or refuses.
 *
 * Exported and pure so every refusal above is unit-testable with no network at all —
 * which matters more than usual here, because the most important thing this function
 * does is throw.
 */
export function toActorInput(query: DiscoveryQuery, order: SearchOrder = 'most_liked'): ActorInput {
  if (!CAPABILITIES.discovery.includes(query.mode)) {
    throw new NotImplemented(`tiktok:discover:${query.mode}`, 'this source has no such entry point');
  }

  const term = query.term.trim();
  if (term.length === 0) throw new NotImplemented('tiktok:discover', 'no hashtag or account to enter by');
  const words = wordsOf(query);

  if (query.untilMs !== null) {
    // See the ★ block at the top of this file. This is a refusal, not a gap, and the
    // message states the reason that survives somebody reading the scraper's schema.
    throw new NotImplemented(
      'tiktok:discover:cutoff',
      'no cutoff reachable here can make a run blind: the candidate set is chosen by a ' +
        'present-day ranking before any date filter is applied, and which actor is ' +
        'configured — hence whether such a filter is honoured at all — is not knowable to ' +
        'this code. A blind historical run is not available on this source',
    );
  }

  // A cap on how much of a feed we ask the actor to scrape, not a correctness filter —
  // and never above the cap the run's price is quoted at.
  const resultsPerPage = Math.min(DISCOVER_RESULTS_CAP, Math.max(1, Math.trunc(query.limit)));

  if (query.mode === 'keyword') {
    return {
      searchQueries: words,
      searchSection: '/video',
      resultsPerPage,
      videoSearchSorting: order === 'newest' ? 'LATEST' : 'MOST_LIKED',
      videoSearchDateFilter: 'PAST_24_HOURS',
    };
  }
  return query.mode === 'account'
    ? { profiles: [term], resultsPerPage }
    : { hashtags: [term], resultsPerPage };
}

/** The words an ask carries: `terms` when given, else `term`; trimmed, empty ones dropped, no repeats. */
export function wordsOf(query: DiscoveryQuery): readonly string[] {
  const all = (query.terms ?? [query.term]).map((w) => w.trim()).filter((w) => w.length > 0);
  return [...new Set(all.length > 0 ? all : [query.term.trim()])];
}

/**
 * One run, translated. The client call is the only line that costs anything: a start
 * fee, plus a fee per post that `resultsPerPage` bounds.
 */
export async function discoverRun(
  client: TikTokClient,
  query: DiscoveryQuery,
  at: Millis,
  order: SearchOrder = 'most_liked',
): Promise<{ readonly items: readonly Item[]; readonly authors: readonly Author[]; readonly runId: string | null; readonly billedPosts: number; readonly searchWords: number | null }> {
  if (query.mode === 'keyword' && client.runSearch !== undefined) {
    /* The cutoff and the mode are refused here exactly as for the first actor. */
    toActorInput(query, order);
    const words = wordsOf(query);
    const runSearch = client.runSearch.bind(client);
    /* ★ ONE RUN PER WORD, ALL AT ONCE. The actor's limit is for the whole run and it stops taking
       words when it is reached, so four words in one run searched three, one of them twice over
       (16:22 UTC: 72, 29, 16 and none). A run's start fee is $0.00022, so a run a word costs
       almost nothing more and every word gets its 30. A word whose run fails loses only its own
       videos; the others' are kept, and only when every word failed is the ask an outage. */
    const runs = await Promise.allSettled(words.map((word) => runSearch(toSearchActorInput([word]))));
    const done = runs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (done.length === 0) {
      const first = runs.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      throw first?.reason ?? new Error('tiktok:discover: no word was searched');
    }
    const failed = runs.length - done.length;
    /* An entry with no id is skipped, never keyed by a guess; it was still billed. */
    const seen = new Set<string>();
    /* A video two words both found is one video. */
    const raws = done.flatMap((run) => run.items).map(fromSearchActor).filter((raw) => {
      const id = str(rec(raw).id);
      if (id === null || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return {
      items: raws.map((raw) => toItem(raw, at)),
      authors: raws.flatMap((raw) => toAuthor(raw, at) ?? []),
      runId: done[0]?.runId ?? null,
      /* What each run returned, and a failed word's run at its full quote: what it was billed is not known. */
      billedPosts: done.reduce((n, run) => n + run.items.length, 0) + failed * SEARCH_ACTOR_RESULTS_PER_WORD,
      searchWords: words.length,
    };
  }
  const run = await client.runDiscovery(toActorInput(query, order));
  // A client-side slice, which is safe because it caps how much of an
  // already-paid-for run we translate rather than filtering for correctness.
  const raws = run.items.slice(0, query.limit);
  return {
    items: raws.map((raw) => toItem(raw, at)),
    authors: raws.flatMap((raw) => toAuthor(raw, at) ?? []),
    runId: run.runId,
    /* Every post the run returned was billed, including any past `limit`. */
    billedPosts: run.items.length,
    searchWords: null,
  };
}
