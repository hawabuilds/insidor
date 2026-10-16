/**
 * THE RECOMMENDATION FEED FINDER: every `finders.trending.everyMs`, one page of the short-video
 * source's logged-out feed for each region in `finders.trending.regions`, and the videos on it
 * younger than `creditMaxAgeMs` stored and credited to the 'trending' lane (0084), so the judge and
 * the hold decide them like any other found post.
 *
 * The owner, 2026-10-15: find the videos that are taking off before they are coined, above all the
 * ones tagged only #fyp that no word reaches. Every other finder asks a word or a name; this one asks
 * nothing, so it is the only one that can return such a video.
 *
 * Its own file because its clock and its filter are its own: a page carries weeks-old hits beside
 * hours-old ones (measured 2026-10-15, tools/trending-feed-probe.ts), and only the young ones are
 * worth the judge. The old ones are dropped here, not stored: a stored post is tracked and re-read,
 * and a month-old hit we would never show is not worth that.
 *
 * ★ A PASS THAT ASKS NOTHING SAYS WHY, once an hour (`recommendation feed skipped: <reason>`). From the
 * switch-on at 00:16 UTC on 2026-10-16 the source reached this finder without its feed (the runner's
 * health wrapper dropped the method) and every pass returned without a line, for hours.
 *
 * What breaks if changed carelessly: the lane needs migration 0084 applied (the lane check), or the
 * credit throws and the loop logs the step failed every slot; the switch is off until it is. The slot
 * is kept in memory, so a restart may ask one slot twice — one credit a region, no more.
 */

import type { Millis } from '@insidor/contracts';
import type { Author, Item } from '@insidor/contracts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';

const CALL_DEADLINE_MS = 120_000;

export interface TrendingFeedDeps {
  /** The live sources, on the live meter. */
  readonly sources: () => readonly PlatformAdapter[];
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

/** The slot the feed was last asked in, kept by the loop between passes. */
export interface TrendingFeedClock {
  slot: number | null;
  /** The hour each skip reason was last logged in, so a silent pass is said once an hour. */
  skipped?: Map<string, number>;
}

export const trendingFeedClock = (): TrendingFeedClock => ({ slot: null, skipped: new Map() });

const HOUR_MS = 3_600_000;

function skip(deps: TrendingFeedDeps, clock: TrendingFeedClock, reason: string, now: number): TrendingFeedResult {
  const hour = Math.floor(now / HOUR_MS);
  const seen = (clock.skipped ??= new Map());
  if (seen.get(reason) !== hour) {
    seen.set(reason, hour);
    deps.log.info(`recommendation feed skipped: ${reason}`);
  }
  return NONE;
}

export interface TrendingFeedResult {
  /** Videos on the pages, every region, adverts already gone. */
  readonly seen: number;
  /** Of those, the ones young enough to credit. */
  readonly young: number;
  readonly stored: number;
  readonly usd: number;
}

const NONE: TrendingFeedResult = { seen: 0, young: 0, stored: 0, usd: 0 };

/** The videos young enough to credit: a post with no time is not shown to be young, so it is not. */
export function youngOnly(items: readonly Item[], now: Millis, maxAgeMs: number): readonly Item[] {
  return items.filter((item) => item.postedAt !== null && now - item.postedAt <= maxAgeMs);
}

export async function trendingFeedPass(deps: TrendingFeedDeps, clock: TrendingFeedClock): Promise<TrendingFeedResult> {
  const t = deps.policy.finders.trending;
  const now = deps.now();
  if (!t.on) return skip(deps, clock, 'switched off (finders.trending.on)', now);
  const slot = Math.floor(now / t.everyMs);
  /* Already asked this slot: the normal case between asks, not a skip worth a line. */
  if (clock.slot === slot) return NONE;
  const source = deps.sources().find((a) => a.trendingFeed !== undefined && a.estimateTrendingFeed !== undefined);
  if (source === undefined) return skip(deps, clock, 'no source offers the feed (its key unset, or the method not carried through)', now);
  clock.slot = slot;

  const ask = { regions: t.regions };
  const quote = source.estimateTrendingFeed!(ask);
  if (deps.mode === 'dry') {
    deps.log.info('DRY RUN — the recommendation feed priced, not sent', { wouldSpendUsd: quote.usd });
    return NONE;
  }
  if (!deps.meter.mayspend(quote.vendor, quote.usd)) {
    deps.log.info('the recommendation feed waits: the line is spent for today', { wouldSpendUsd: quote.usd });
    return NONE;
  }
  const line = deps.meter.line(quote.vendor);
  let got;
  try {
    got = await source.trendingFeed!(ask, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (now + CALL_DEADLINE_MS) as Millis });
  } catch (e) {
    if (!(e instanceof BudgetRefused)) deps.log.warn('the recommendation feed failed; asked again next slot', { err: errorText(e) });
    return NONE;
  }
  const young = youngOnly(got.value.items, now, t.creditMaxAgeMs);
  const keys = new Set(young.map((i) => i.authorKey));
  const stored = young.length === 0 ? 0 : await deps.store(young, got.value.authors.filter((a) => keys.has(a.authorKey)), 'trending');
  const result = { seen: got.value.items.length, young: young.length, stored, usd: got.spend.usd };
  deps.log.info('recommendation feed pass', result);
  return result;
}
