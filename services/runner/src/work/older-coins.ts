/**
 * OLDER COINS TRADING ON A FEED POST'S SUBJECT: is a coin launched before the post, named for
 * the same thing, trading much more since the post?
 *
 * The post's name search (coin-lookup.ts) notes every coin it returned whose market predates the
 * post (internal.older_coin, 0060). This step, once a pass, takes the pairs owed a measurement:
 *
 *   1. the coin's name or ticker must carry the subject's — core's `nameMatch` against the
 *      judge's proposed and alternate names, the same rule the post's own coin is matched by.
 *      A search is fuzzy; a hit that does not carry the name is noted and never measured;
 *   2. its candles in its primary pool are read from the market source, the day before the post
 *      through `WATCH_MS` after it, in `BUCKET_MINUTES` buckets with their dollar volume;
 *   3. core's `olderCoinRun` applies the bars below and the reading is written.
 *
 * A pair is measured again every `RECHECK_MS` while its post is on a feed, until a reading
 * covers the whole watch. The projector shows the running ones on the card, never as the post's
 * coin (services/project rising.ts `runningOlder`).
 *
 * ★ FREE READS, UNDER THE SOURCE'S OWN LIMIT. The candle source is the lookup's own instance,
 * whose per-minute count covers its searches and these reads together, and at most
 * `CHECKS_PER_PASS` coins (two requests each, the pool and the candles; the pool is kept) are
 * read a pass. A refusal is a failure, written as one and tried again later — never a reading.
 *
 * ★ POLICY NUMBERS, to move into contracts/src/policy.ts (the session owner adds them), chosen
 * on 12-13 October 2026's feed (83 searched posts, 51 older coins whose name fits) and the gold
 * set's 66 searched origin posts; see the report in the commit:
 *   BASELINE_MS     the usual hour is averaged over the day before the post
 *   WATCH_MS        a jump within six hours of the post is "since this post"
 *   VOLUME_MULTIPLE the busiest hour since must be five times the usual hour...
 *   PRICE_MULTIPLE  ...or the price must have doubled since the post...
 *   MIN_HOUR_USD    ...and either way that hour must have traded $1,000. Under it, on the feed
 *                   sample, nothing but dust moved; at $2,500 the Goliath coin (the case this
 *                   exists for: $189 an hour before, $1,579 in its busiest hour after) is missed
 *   BUCKET_MINUTES  fifteen-minute buckets, so the post's own bucket, which is on neither side,
 *                   loses at most fifteen minutes of trading
 *   CANDLE_LIMIT    buckets asked for: the day before and the watch after need 120
 *   RECHECK_MS      a pair is read again every fifteen minutes while its post is on a feed
 *   CHECKS_PER_PASS coins measured per pass
 *   MIN_VARIANT_LENGTH  the projector's (services/project post-match.ts): one name rule
 *
 * What breaks if changed carelessly: the completeness test. A reply of `CANDLE_LIMIT` buckets
 * that does not reach back to the baseline's start was CUT, and reading it as complete would
 * average the usual hour over a stretch that is missing its trades — any trade then looks like
 * a jump. Only a reply shorter than asked, or one reaching back far enough, is complete.
 */

import type { Millis } from '@insidor/contracts';
import { nameMatch, olderCoinRun, type OlderRunBars } from '@insidor/core';
import type { DueOlderCoin, PgOlderCoinRepo } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export const BASELINE_MS = 24 * HOUR_MS;
export const WATCH_MS = 6 * HOUR_MS;
export const VOLUME_MULTIPLE = 5;
export const PRICE_MULTIPLE = 2;
export const MIN_HOUR_USD = 1_000;
export const BUCKET_MINUTES = 15;
export const CANDLE_LIMIT = 200;
export const RECHECK_MS = 15 * MINUTE_MS;
export const CHECKS_PER_PASS = 20;
export const MIN_VARIANT_LENGTH = 4;

export const OLDER_RUN_BARS: OlderRunBars = {
  baselineMs: BASELINE_MS,
  watchMs: WATCH_MS,
  volumeMultiple: VOLUME_MULTIPLE,
  priceMultiple: PRICE_MULTIPLE,
  minHourUsd: MIN_HOUR_USD,
};

/** The candle source, as this step needs it: the market-data adapter's `history`. */
export interface CandleSource {
  history(mint: string, untilMs: number, bucketMinutes: number, limit: number): Promise<{
    readonly pool: unknown;
    readonly candles: readonly { readonly t: number; readonly c: number; readonly v: number | null }[];
  }>;
}

export interface OlderCoinDeps {
  readonly older: Pick<PgOlderCoinRepo, 'due' | 'recordNameDiffers' | 'recordReading' | 'recordFailed'>;
  readonly candles: CandleSource;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface OlderCoinResult {
  readonly read: number;
  readonly running: number;
  readonly nameDiffers: number;
  readonly failed: number;
}

export async function checkOlderCoins(deps: OlderCoinDeps): Promise<OlderCoinResult> {
  const due = await deps.older.due(deps.now(), WATCH_MS, RECHECK_MS, CHECKS_PER_PASS);
  let read = 0;
  let running = 0;
  let nameDiffers = 0;
  let failed = 0;
  for (const pair of due) {
    if (pair.outcome === 'waiting' && !fits(pair)) {
      await deps.older.recordNameDiffers(pair.itemId, pair.address, deps.now());
      nameDiffers += 1;
      continue;
    }
    const now = deps.now();
    try {
      const until = Math.min(now, pair.postedAt + WATCH_MS);
      const { candles } = await deps.candles.history(pair.address, until, BUCKET_MINUTES, CANDLE_LIMIT);
      const from = Math.max(pair.postedAt - BASELINE_MS, pair.launchedAt);
      const earliest = candles.reduce((m, c) => Math.min(m, c.t), Number.POSITIVE_INFINITY);
      const complete = candles.length < CANDLE_LIMIT || earliest <= from;
      const run = olderCoinRun(
        candles.map((c) => ({ t: c.t as Millis, c: c.c, v: c.v })),
        BUCKET_MINUTES * MINUTE_MS,
        pair.postedAt,
        pair.launchedAt,
        complete,
        OLDER_RUN_BARS,
      );
      await deps.older.recordReading(pair.itemId, pair.address, { hourBeforeUsd: run.hourBeforeUsd, peakHourUsd: run.peakHourUsd, priceAtPostUsd: run.priceAtPost, priceSinceUsd: run.priceSince, running: run.running }, now);
      read += 1;
      if (run.running) running += 1;
    } catch (e) {
      await deps.older.recordFailed(pair.itemId, pair.address, errorText(e), now);
      failed += 1;
    }
  }
  if (due.length > 0) deps.log.info('older coins measured against their posts', { read, running, nameDiffers, failed });
  return { read, running, nameDiffers, failed };
}

/** The coin's name or ticker carries the subject's, by the post-coin match's own name rule. */
export function fits(pair: Pick<DueOlderCoin, 'names' | 'name' | 'ticker'>): boolean {
  return nameMatch(pair.names, { name: pair.name, ticker: pair.ticker }, { minVariantLength: MIN_VARIANT_LENGTH }) !== 'none';
}
