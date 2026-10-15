/**
 * The TikTok adapter, assembled.
 *
 * Read `capabilities.ts` before changing anything here. The one behaviour this
 * package exists to guarantee is that no Item it produces carries a reproduction
 * counter, in any form, ever.
 *
 * WHAT MOVED OUT OF THIS FILE AND WHY. The query rendering and the observe batching
 * used to be inlined here; they now live in `discover.ts` and `observe.ts`, matching
 * the other two sources. The reason is not tidiness: the most important lines in
 * both are REFUSALS — the cutoff that cannot be honoured, and the ids that cannot be
 * addressed — and a refusal inlined in an adapter method cannot be tested without
 * standing up a meter and a clock. What is left below is assembly and metering.
 *
 * ★ EVERY PAID CALL GOES THROUGH `metered`, AND THE UNIT IS THE RUN. The vendor charges a
 * start fee plus a fee per post returned, and the posts in a run are capped, so each run is
 * checked against the budget at its full bill (`PRICES`) — a re-read at the bill of the posts
 * it asks about — and recorded, once it is back, at what the vendor billed for the posts it
 * returned (`runCostUsd`). A run that throws is recorded at the quote. The Budget is handed in
 * and never read from a global: the adapter reports, the meter refuses, and what to give up
 * when money runs short is a product judgement that lives in core.
 *
 * ★ TWO PIECES OF STATE, BOTH IN MEMORY AND BOTH SAFE TO LOSE. Which search order the next ask
 * uses (`nextOrder`: newest and most liked by turns, see discover.ts), started from the clock so
 * a restart does not always begin on the same one; and the handle of every post this adapter has
 * itself read (`learned`), so a post it found can be re-read by URL even when the caller's handle
 * lookup has nothing — before 2026-10-13 15:00 UTC the runner's had nothing for every post, and
 * no short video was ever re-read. A restart forgets both; the caller's lookup still answers.
 */

import type { Author, CounterSet, Item, Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered, CostEstimate } from '@insidor/contracts/ports/meter.ts';
import type {
  DiscoveryQuery,
  Discovered,
  FeedAsk,
  PlannedCall,
  PlatformAdapter,
  TrendAsk,
  TrendWord,
} from '@insidor/contracts/ports/platform.ts';
import { mergeSpend, metered, estimateFor } from '@insidor/meter';
import type { PriceBook } from '@insidor/meter';
import { discovered } from '@insidor/vendor-kit';
import { parseLink as parseLinkOf, postTimeFromId as postTimeOf } from './post-time.ts';

import { CAPABILITIES, DISCOVER, OBSERVE, PRICES, READ_POST_USD, runCostUsd, searchActorCostUsd, searchActorQuoteUsd, SEARCH_POST_USD, SOURCE, TRENDS, VENDOR } from './capabilities.ts';
import { FEED_ENDPOINT, FEED_PRICES, FEED_VENDOR, feedRegions, fromTrendingFeed, type TrendingFeedClient } from './trending-feed.ts';
import { fromTrendsRows, toTrendsInput, trendRegions, trendsRunUsd, TRENDS_MAX_PER_REGION } from './trends.ts';
import type { TikTokClient } from './client.ts';
import { discoverRun, SEARCH_ORDERS, wordsOf, type SearchOrder } from './discover.ts';
import { SEARCH_ACTOR_RESULTS_PER_WORD } from './search-actor.ts';
import { addressable, chunk, observeBatch } from './observe.ts';
import { toAuthor, toItem } from './to-item.ts';

export interface TikTokAdapterDeps {
  readonly client: TikTokClient;
  readonly meter: Meter;
  /** Injected so a recorded run replays to the same Items. Never `Date.now`. */
  readonly now: () => Millis;
  /**
   * Observation addresses posts by URL, so the caller must supply the handle for each
   * id. An absent handle is skipped rather than guessed — a wrong URL costs a run and
   * returns nothing, which then reads downstream as a deleted post.
   */
  readonly handleOf: (sourceItemId: string) => string | null;
  readonly prices?: PriceBook;
  /** The second vendor's recommendation feed (trending-feed.ts); absent or null for none. */
  readonly feed?: TrendingFeedClient | null;
}

const HOUR_MS = 3_600_000;
/* Posts whose handle the adapter keeps: about two days of watch-list asks. */
const LEARNED_HANDLES_MAX = 5_000;

export function tiktokPlatform(deps: TikTokAdapterDeps): PlatformAdapter {
  const prices = deps.prices ?? PRICES;
  const batchSize = CAPABILITIES.observeBatchSize ?? 1;

  /* Search orders by turns, from the hour at start so a restart does not always begin on one. */
  let turn = Math.floor(deps.now() / HOUR_MS);
  const nextOrder = (): SearchOrder => SEARCH_ORDERS[turn++ % SEARCH_ORDERS.length] ?? 'most_liked';

  /* The handle of each post this adapter read, newest kept: a post is addressed by URL. */
  const learned = new Map<string, string>();
  const learn = (items: readonly Item[], authors: readonly Author[]): void => {
    const handleOfAuthor = new Map(authors.flatMap((a) => (a.handle === null || a.handle === undefined ? [] : [[a.authorKey, a.handle] as const])));
    for (const item of items) {
      const handle = item.authorKey === null ? undefined : handleOfAuthor.get(item.authorKey);
      if (handle === undefined) continue;
      learned.delete(item.sourceItemId);
      learned.set(item.sourceItemId, handle);
    }
    while (learned.size > LEARNED_HANDLES_MAX) {
      const oldest = learned.keys().next().value;
      if (oldest === undefined) break;
      learned.delete(oldest);
    }
  };
  const handleOf = (sourceItemId: string): string | null => deps.handleOf(sourceItemId) ?? learned.get(sourceItemId) ?? null;

  /* What the vendor billed for a run that returned `posts`; a custom book (tests) prices units. */
  const billed = (posts: number, perPostUsd: number): { usdActual?: number } =>
    deps.prices === undefined ? { usdActual: runCostUsd(posts, perPostUsd) } : {};

  /* A re-read run is quoted at the posts it asks about; a custom book (tests) keeps its own price. */
  const observeBook = (posts: number): PriceBook =>
    deps.prices !== undefined
      ? prices
      : { ...prices, [`${VENDOR}:${OBSERVE}`]: { ...PRICES[`${VENDOR}:${OBSERVE}`]!, usdPerUnit: runCostUsd(posts, READ_POST_USD) } };

  /* ★ A KEYWORD ASK ON THE NEWEST-FIRST ACTOR is quoted by its words (capabilities.ts
     `searchActorQuoteUsd`); every other discovery run keeps the flat quote of a full run. */
  const onSearchActor = (query: DiscoveryQuery): boolean => query.mode === 'keyword' && deps.client.runSearch !== undefined;
  const discoverBook = (query: DiscoveryQuery): PriceBook =>
    deps.prices !== undefined || !onSearchActor(query)
      ? prices
      : { ...prices, [`${VENDOR}:${DISCOVER}`]: { ...PRICES[`${VENDOR}:${DISCOVER}`]!, usdPerUnit: searchActorQuoteUsd(wordsOf(query).length, SEARCH_ACTOR_RESULTS_PER_WORD) } };

  return {
    id: SOURCE,
    capabilities: CAPABILITIES,

    async discover(query: DiscoveryQuery, _budget: Budget): Promise<Metered<Discovered>> {
      const at = deps.now();

      const result = await metered(
        deps.meter,
        discoverBook(query),
        // One run is one unit. Counting returned items here would price a per-run
        // vendor with per-item arithmetic.
        { vendor: VENDOR, endpoint: DISCOVER, unit: 'per-run', estUnits: 1, at },
        async () => {
          const keyword = query.mode === 'keyword';
          const run = await discoverRun(deps.client, query, at, keyword ? nextOrder() : 'most_liked');
          /* What the vendor billed: the start fee and each post returned, with the two search
             filters on a keyword ask. Recorded instead of the full-run quote. */
          if (run.searchWords !== null) {
            return { value: run, units: 1, ...(deps.prices === undefined ? { usdActual: searchActorCostUsd(run.searchWords, run.billedPosts) } : {}) };
          }
          return { value: run, units: 1, ...billed(run.billedPosts, keyword ? SEARCH_POST_USD : READ_POST_USD) };
        },
      );
      learn(result.value.items, result.value.authors);

      // The actor has no cursor: a run returns what it returns, and it never tells us
      // whether there was more. `false` is what the vendor supports saying, not a
      // guess about the feed.
      return { value: discovered(result.value.items, result.value.authors, null, false), spend: result.spend };
    },

    /**
     * What a call would cost, without making it.
     *
     * ★ THE UNIT IS THE RUN, AND THAT MAKES THIS SOURCE'S ESTIMATE THE MOST DIFFERENT OF
     * THE THREE. A discovery run is quoted at its full capped bill whatever `query.limit`
     * says — `discover.ts` never asks for more than the cap — so the estimate is one run,
     * flat. Quoting it per item would price a per-run vendor with per-item
     * arithmetic, which is the exact leak `BillingMismatch` exists to make impossible
     * on the live path, and a dry run is where it would otherwise sneak back in.
     *
     * ★ AND UNADDRESSABLE IDS ARE EXCLUDED BEFORE COUNTING. Re-reading here needs the
     * author's handle, and ids we hold no handle for are skipped rather than guessed —
     * so they start no run and cost nothing. An estimate that counted them would report a
     * bill for work that will not happen, and on a source where every run is a fixed
     * charge that overstatement is the whole number.
     */
    estimate(call: PlannedCall): CostEstimate {
      if (call.kind === 'discover') return estimateFor(discoverBook(call.query), VENDOR, DISCOVER, 1);
      const batches = chunk(addressable(call.sourceItemIds, handleOf), batchSize);
      if (deps.prices !== undefined) return estimateFor(prices, VENDOR, OBSERVE, batches.length);
      const usd = batches.reduce((sum, batch) => sum + runCostUsd(batch.length, READ_POST_USD), 0);
      return { ...estimateFor(prices, VENDOR, OBSERVE, batches.length), usd };
    },

    async observe(
      sourceItemIds: readonly string[],
      _budget: Budget,
    ): Promise<Metered<ReadonlyMap<string, CounterSet>>> {
      const at = deps.now();
      const out = new Map<string, CounterSet>();
      const spends = [];

      for (const batch of chunk(addressable(sourceItemIds, handleOf), batchSize)) {
        const result = await metered(
          deps.meter,
          observeBook(batch.length),
          { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at },
          async () => {
            const read = await observeBatch(deps.client, batch, at);
            return { value: read, units: 1, ...billed(read.billedPosts, READ_POST_USD) };
          },
        );
        for (const [id, counters] of result.value.counters) out.set(id, counters);
        spends.push(result.spend);
      }

      return {
        value: out,
        /* ★ ZERO BATCHES IS ZERO SPEND, AND IT REACHES THE LEDGER AS A REAL ROW OF
           ZEROS RATHER THAN AS NOTHING. Every id being unaddressable is a legitimate
           outcome — see `addressable` — and it means no run happened, so nothing was
           billed. `mergeSpend` over an empty list produces exactly that. */
        spend: mergeSpend(spends, { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at }, 'per-run'),
      };
    },

    /**
     * ★ WHOLE POSTS BY ID: the same run as `observe`, read into Items and accounts — the owner's
     * pasted missed posts are read this way. Addressed by URL like `observe`, so an id with no
     * handle starts no run and costs nothing; billed and quoted as `observe`, one full run each
     * batch. An entry the run returned without an id is skipped, never keyed by a guess.
     */
    async lookup(sourceItemIds: readonly string[], _budget: Budget): Promise<Metered<Discovered>> {
      const at = deps.now();
      const items: Item[] = [];
      const authors: Author[] = [];
      const spends = [];
      for (const batch of chunk(addressable(sourceItemIds, handleOf), batchSize)) {
        const result = await metered(
          deps.meter,
          observeBook(batch.length),
          { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at },
          async () => {
            const run = await deps.client.runObserve(batch.map((entry) => entry.url));
            return { value: run, units: 1, ...billed(run.items.length, READ_POST_USD) };
          },
        );
        for (const raw of result.value.items) {
          let item: Item;
          try {
            item = toItem(raw, at);
          } catch {
            continue;
          }
          items.push(item);
          const author = toAuthor(raw, at);
          if (author !== null) authors.push(author);
        }
        spends.push(result.spend);
      }
      learn(items, authors);
      return {
        value: discovered(items, authors, null, false),
        spend: mergeSpend(spends, { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at }, 'per-run'),
      };
    },

    /* ★ THE TREND LIST (trends.ts): one run a region the ranking covers, each metered at its own
       bill. Present only when the client has the trend actor; a region it does not cover is not asked. */
    ...(deps.client.runTrends === undefined
      ? {}
      : {
          estimateTrendWords(ask: TrendAsk): CostEstimate {
            const regions = trendRegions(ask).length;
            return { ...estimateFor(prices, VENDOR, TRENDS, regions), usd: regions * trendsRunUsd(Math.min(TRENDS_MAX_PER_REGION, ask.perRegion)) };
          },
          async trendWords(ask: TrendAsk, _budget: Budget): Promise<Metered<readonly TrendWord[]>> {
            const runTrends = deps.client.runTrends;
            const at = deps.now();
            const words: TrendWord[] = [];
            const spends = [];
            for (const region of trendRegions(ask)) {
              const result = await metered(
                deps.meter,
                { ...prices, [`${VENDOR}:${TRENDS}`]: { ...PRICES[`${VENDOR}:${TRENDS}`]!, usdPerUnit: trendsRunUsd(Math.min(TRENDS_MAX_PER_REGION, ask.perRegion)) } },
                { vendor: VENDOR, endpoint: TRENDS, unit: 'per-run', estUnits: 1, at },
                async () => {
                  const run = await runTrends!(toTrendsInput(region, ask.perRegion));
                  return { value: run, units: 1, ...(deps.prices === undefined ? { usdActual: trendsRunUsd(run.items.length) } : {}) };
                },
              );
              words.push(...fromTrendsRows(result.value.items, region));
              spends.push(result.spend);
            }
            return { value: words, spend: mergeSpend(spends, { vendor: VENDOR, endpoint: TRENDS, unit: 'per-run', estUnits: 1, at }, 'per-run') };
          },
        }),

    /* ★ THE RECOMMENDATION FEED (trending-feed.ts): one request a region, each metered at one
       credit on its own vendor's line and recorded at what the vendor said it charged. Present only
       when the feed's key is set. */
    ...(deps.feed === undefined || deps.feed === null
      ? {}
      : {
          estimateTrendingFeed(ask: FeedAsk): CostEstimate {
            return estimateFor(FEED_PRICES, FEED_VENDOR, FEED_ENDPOINT, feedRegions(ask.regions).length);
          },
          async trendingFeed(ask: FeedAsk, _budget: Budget): Promise<Metered<Discovered>> {
            const feed = deps.feed!;
            const at = deps.now();
            const items: Item[] = [];
            const authors: Author[] = [];
            const seen = new Set<string>();
            const spends = [];
            for (const region of feedRegions(ask.regions)) {
              const result = await metered(
                deps.meter,
                FEED_PRICES,
                { vendor: FEED_VENDOR, endpoint: FEED_ENDPOINT, unit: 'per-call', estUnits: 1, at },
                async () => {
                  const page = await feed.feed(region);
                  return { value: page, units: page.creditsCharged ?? 1 };
                },
              );
              spends.push(result.spend);
              for (const raw of result.value.items) {
                const mapped = fromTrendingFeed(raw);
                let item: Item;
                try {
                  item = toItem(mapped, at);
                } catch {
                  continue;
                }
                /* Two regions often return the same video; one Item each. */
                if (seen.has(item.sourceItemId)) continue;
                seen.add(item.sourceItemId);
                items.push(item);
                const author = toAuthor(mapped, at);
                if (author !== null) authors.push(author);
              }
            }
            learn(items, authors);
            return {
              value: discovered(items, authors, null, false),
              spend: mergeSpend(spends, { vendor: FEED_VENDOR, endpoint: FEED_ENDPOINT, unit: 'per-call', estUnits: 1, at }, 'per-call'),
            };
          },
        }),

    parseLink: (url: string) => parseLinkOf(url),
    postTimeFromId: (id: string) => postTimeOf(id) as Millis | null,

    toItem(raw: unknown, at: Millis): Item {
      return toItem(raw, at);
    },

    /**
     * The cohort. Reach on this source is autoplay-driven and moves with the sound as
     * much as with the poster, so the shared sound is part of what makes two numbers
     * comparable. The key is a label; the thresholds are core's.
     */
    baselineKey(item: Item, _at: Millis): string {
      const sound = item.formatIds.find((f) => f.startsWith(`${SOURCE}:sound:`)) ?? 'nosound';
      return `${SOURCE}|${item.lang ?? 'und'}|${sound}`;
    },
  };
}

export { CAPABILITIES, FIDELITY, PRICES, SOURCE, VENDOR } from './capabilities.ts';
export { httpClient, isActorId, isPathSegment, postUrl } from './client.ts';
/* The typed "we were never configured to call this source". Exported so a caller
   failing closed can tell it from an outage without parsing a message — the registry
   already turns it into `misconfigured`, and this is how anything else checks. */
export { TikTokNotConfigured } from './client.ts';
/* What this source needs from the environment, declared beside the client that
   consumes it. The registry reads it; nothing central holds a copy to drift from. */
export { CREDENTIALS, clientConfig, FEED_KEY, feedClient } from './credentials.ts';
export { FEED_VENDOR, trendingFeedClient, fromTrendingFeed } from './trending-feed.ts';
export type { TrendingFeedClient } from './trending-feed.ts';
export type { TikTokClient, TikTokClientConfig } from './client.ts';
/* The refusal, exported so it is reachable from a test that never builds an adapter.
   It is the single most important line in this package after `capabilities.absent`. */
export { toActorInput } from './discover.ts';
export { toItem, toCounters, formatIds } from './to-item.ts';
/* Share links expanded to the video they name — for links people paste, such as a gold
   sheet's origin column. */
export { expandShortLink, isShortLink } from './short-link.ts';
export { parseLink, postTimeFromId } from './post-time.ts';
