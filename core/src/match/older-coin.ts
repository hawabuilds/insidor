/**
 * AN OLDER COIN TRADING ON A POST'S SUBJECT — whether its trading jumped after the post, as facts.
 *
 * A post's subject can be traded on a coin that was launched long before it: an old coin named
 * for the same thing runs on the news. That coin is NEVER the post's coin (match/post-coin.ts:
 * a coin launched before the post cannot match, and nothing here changes that), so it never
 * gets a Buy on the card. But "people are trading an older coin named this, since this post" is
 * a fact about the world, and the card says it on a line of its own.
 *
 * What is measured, from the coin's own candles (a bucket per `bucketMs`, volume in dollars):
 *
 *   before   the average hour of the `baselineMs` before the post — every bucket that ENDS at
 *            or before the post, so no trade after the post is counted as "usual"
 *   after    the busiest rolling hour among buckets that START at or after the post and end
 *            within `watchMs` of it — so no trade before the post is counted as "since"
 *   price    the last close before the post, and the last close since it
 *
 * RUNNING is: the busiest hour since reached `minHourUsd`, AND either it was `volumeMultiple`
 * times the usual hour (or the day before had no trades at all), or the price since is
 * `priceMultiple` times the price at the post. Two clear bars and a floor, not a weighted sum:
 * the card shows the two numbers that cleared them, and a sum could not say which one did.
 *
 * ★ A BUCKET THE SOURCE DID NOT SEND IS AN HOUR WITH NO TRADES. The candle sources omit empty
 * buckets, so a missing one inside the history we were sent is zero volume — a fact about the
 * world. But the history must reach back to the start of the baseline, or to the coin's launch:
 * a cut history (`complete: false`) is "could not tell", never a quiet day that makes any trade
 * look like a jump.
 *
 * What breaks if changed carelessly: the edges. Letting the post's own bucket count as "after"
 * attributes up to a bucket of pre-post trading to the post; letting it count as "before" lets
 * the post's first minutes raise the usual hour. Both are excluded, and a jump has to show in
 * the buckets that are wholly on one side. Every bar comes in through `OlderRunBars`.
 */

import type { Millis } from '@insidor/contracts';

import { MS_PER_HOUR } from '../math.ts';

/** The bars, from the service; each one is a policy number. */
export interface OlderRunBars {
  /** How far before the post the usual hour is averaged over. */
  readonly baselineMs: number;
  /** How long after the post a jump still counts as "since this post". */
  readonly watchMs: number;
  /** The busiest hour since must be at least this many times the usual hour. */
  readonly volumeMultiple: number;
  /** ...or the price since at least this many times the price at the post. */
  readonly priceMultiple: number;
  /** And either way, the busiest hour since must have traded at least this many dollars. */
  readonly minHourUsd: number;
}

/** One bucket of the coin's trading: its start, its close price and its dollar volume. */
export interface VolumeBucket {
  readonly t: Millis;
  readonly c: number;
  /** Null when the source did not say; such a bucket counts as unread, never as zero. */
  readonly v: number | null;
}

/** What was measured, every number null when it could not be. */
export interface OlderRun {
  /** The usual hour: dollars traded per hour over the baseline before the post. */
  readonly hourBeforeUsd: number | null;
  /** The busiest hour since the post, in dollars. */
  readonly peakHourUsd: number | null;
  /** The last price before the post, and the last price since. */
  readonly priceAtPost: number | null;
  readonly priceSince: number | null;
  /** The bars above, applied. False whenever a number it needs is null. */
  readonly running: boolean;
}

const UNREAD: OlderRun = { hourBeforeUsd: null, peakHourUsd: null, priceAtPost: null, priceSince: null, running: false };

/**
 * The run, measured. `complete` says the history we were sent reaches back to the baseline's
 * start or the coin's launch (the caller knows how many buckets it asked for and got).
 */
export function olderCoinRun(
  buckets: readonly VolumeBucket[],
  bucketMs: number,
  postedAt: Millis,
  launchedAt: Millis,
  complete: boolean,
  bars: OlderRunBars,
): OlderRun {
  if (!complete || bucketMs <= 0 || buckets.some((b) => b.v === null)) return UNREAD;
  const sorted = [...buckets].sort((a, b) => a.t - b.t);
  const from = Math.max(postedAt - bars.baselineMs, launchedAt);
  const before = sorted.filter((b) => b.t >= from && b.t + bucketMs <= postedAt);
  const after = sorted.filter((b) => b.t >= postedAt && b.t + bucketMs <= postedAt + bars.watchMs);
  const spanHours = (postedAt - from) / MS_PER_HOUR;
  const hourBeforeUsd = spanHours > 0 ? before.reduce((s, b) => s + (b.v ?? 0), 0) / spanHours : null;

  /* The busiest hour: every run of buckets whose starts fall inside one hour, from each bucket. */
  let peakHourUsd: number | null = after.length === 0 ? null : 0;
  for (const first of after) {
    const hour = after.filter((b) => b.t >= first.t && b.t < first.t + MS_PER_HOUR).reduce((s, b) => s + (b.v ?? 0), 0);
    peakHourUsd = Math.max(peakHourUsd ?? 0, hour);
  }

  const priceAtPost = before.length === 0 ? null : (before[before.length - 1]?.c ?? null);
  const priceSince = after.length === 0 ? null : (after[after.length - 1]?.c ?? null);
  const peak = peakHourUsd ?? 0;
  const loud = peakHourUsd !== null && peak >= bars.minHourUsd;
  const volumeJump = loud && hourBeforeUsd !== null && (hourBeforeUsd === 0 || peak >= bars.volumeMultiple * hourBeforeUsd);
  const priceJump = loud && priceAtPost !== null && priceAtPost > 0 && priceSince !== null && priceSince >= bars.priceMultiple * priceAtPost;
  return { hourBeforeUsd, peakHourUsd, priceAtPost, priceSince, running: volumeJump || priceJump };
}
