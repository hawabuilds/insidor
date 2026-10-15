/**
 * The short-video source's trend list: its rising hashtags by country, read through a third-party
 * actor over the platform's own "creative center" ranking (data_xplorer~tiktok-trends).
 *
 * Its own file because it is a different actor with a different input family and a different
 * bill from the scraper the rest of this package runs. Chosen 2026-10-15 from the actor store:
 * pay per event with no rental (measured $0.025 a run start, $0.001 an item listed on our tier),
 * 16,000 successful runs in 30 days and none failed. What the ranking does and does not offer,
 * as measured that day, decides the shape of everything above it:
 *
 *   - hashtags only. The ranking's song and creator charts are discontinued; two sound actors
 *     returned nothing. Sounds are learned from coined posts instead (runner work/search-words.ts).
 *   - countries only, 27 of them (US and GB among them). There is no worldwide list, and a
 *     region we are asked for that is not two capitals is refused here, never sent.
 *   - its shortest period is 7 days, and the data is daily and about two days behind, so the
 *     runner reads it once a day: an hourly read buys the same list 24 times.
 *
 * What breaks if changed carelessly: `rising` is the ranking's own "up", never inferred from the
 * rank. A word ranked first that is falling is still a word the ranking calls falling.
 */

import type { TrendAsk, TrendWord } from '@insidor/contracts/ports/platform.ts';
import { num, rec, str } from '@insidor/vendor-kit';

/** The actor run for the trend list (credentials.ts hands it to the client). */
export const DEFAULT_TRENDS_ACTOR_ID = 'data_xplorer~tiktok-trends';
/** The ranking's shortest period, in days, as the actor takes it. */
const PERIOD_DAYS = '7';
/** The most words one region's run may list; also what its quote is priced at. */
export const TRENDS_MAX_PER_REGION = 50;
const REGION = /^[A-Z]{2}$/;

export const TRENDS_START_USD = 0.025;
export const TRENDS_PER_ITEM_USD = 0.001;
/** One region's run, at `items` listed. */
export const trendsRunUsd = (items: number): number => TRENDS_START_USD + Math.max(0, items) * TRENDS_PER_ITEM_USD;

/** The regions asked that the ranking covers: two capitals each. */
export function trendRegions(ask: TrendAsk): readonly string[] {
  return [...new Set(ask.regions.map((r) => r.trim().toUpperCase()).filter((r) => REGION.test(r)))];
}

export function toTrendsInput(region: string, perRegion: number): Record<string, unknown> {
  return {
    trendType: 'hashtags',
    maxItems: Math.min(TRENDS_MAX_PER_REGION, Math.max(1, Math.trunc(perRegion))),
    countryCode: region,
    hashtagPeriod: PERIOD_DAYS,
    industryId: '',
    saveMedia: false,
  };
}

/** One run's rows as words; a row with no tag is skipped, never guessed. */
export function fromTrendsRows(rows: readonly unknown[], region: string): readonly TrendWord[] {
  const out: TrendWord[] = [];
  for (const raw of rows) {
    const r = rec(raw);
    const tag = str(r['Hashtag'])?.replace(/^#/, '').trim() ?? '';
    if (tag === '') continue;
    const direction = str(r['Trend Direction']);
    out.push({
      kind: 'tag',
      value: tag,
      region,
      rank: num(r['Rank']),
      rising: direction === 'up' ? true : direction === 'down' || direction === 'stable' ? false : null,
      facts: { views: num(r['Video Views']), posts: num(r['Posts']), direction: direction ?? null, period: str(r['Period']) },
    });
  }
  return out;
}
