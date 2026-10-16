/**
 * The short-video source's own For You feed, logged out, read through a second vendor
 * (ScrapeCreators, `GET /v1/tiktok/get-trending-feed`): what the app shows a stranger in a region
 * right now, whatever it is tagged.
 *
 * WHY IT EXISTS. Every other way this package finds a video is a word: a watch word, a trend tag, a
 * learned tag, a creator. A video tagged only #fyp, or not at all, is reached by none of them (the
 * owner's missed @dikshithardik cooking video, 2026-10-14). The feed takes no word, so it is the one
 * finder that can return such a video before anybody names it.
 *
 * WHY ITS OWN FILE AND ITS OWN CLIENT. It is a different vendor from the scraper the rest of this
 * package runs, billed differently: one credit a request, whatever the request returns, from a
 * prepaid pack that never expires. Nothing here starts a run or polls; one GET is one call.
 *
 * WHAT WAS MEASURED, 2026-10-15 (19 pages, US and GB every 15 minutes; tools/trending-feed-probe.ts):
 *   - 11 to 20 videos a request, 11 to 14 of them new on each page; a region is only where the
 *     vendor's proxy sits, not a filter. 2 of 10 US requests answered 500 and were not charged.
 *   - a median 35 days old: 12 of 199 under six hours, most of them on the US pages. So the runner
 *     credits only the young ones (Policy.finders.trending.creditMaxAgeMs).
 *   - the entries are the platform's app shape, the same one the newest-first search actor returns,
 *     so `fromSearchActor` turns them into the first scraper's field names and `to-item.ts` stays
 *     the one place that decides what an Item is. Only the tags differ: this feed sends no
 *     `text_extra`, so they are read from the caption here.
 *
 * What breaks if changed carelessly: an advert (`is_ad`) is dropped here, never stored as a post;
 * the key is sent only in the `x-api-key` header, never in a URL a log could print; and a 402 (the
 * pack is spent) throws the shared billing error, so the owner is told, the meter records the quote,
 * and the caller logs an outage instead of an empty feed that would read as "nothing is moving".
 */

import { arr, outOfCredit, rec, str, vendorAnswered } from '@insidor/vendor-kit';
import type { Price, PriceBook } from '@insidor/meter';

import { creditsSeen } from './route.ts';
import { fromSearchActor } from './search-actor.ts';

export const FEED_VENDOR = 'scrapecreators';
export const FEED_ENDPOINT = 'trending-feed';
/** The vendor's public host. Not a credential. */
export const DEFAULT_FEED_BASE_URL = 'https://api.scrapecreators.com';
const FEED_PATH = '/v1/tiktok/get-trending-feed';
const REGION = /^[A-Z]{2}$/;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * One credit a request. The pay-as-you-go pack of 25,000 credits is $47 ($0.00188 a credit); the
 * 500,000 pack is $0.00099. Quoted at the dearer pack, so the line is never under-counted; read off
 * the vendor's pricing page 2026-10-15, and every response says what it charged (`credits_charged`).
 */
export const FEED_USD_PER_CREDIT = 0.00188;

const FEED_PRICE: Price = {
  vendor: FEED_VENDOR,
  endpoint: FEED_ENDPOINT,
  unit: 'per-call',
  usdPerUnit: FEED_USD_PER_CREDIT,
  unitName: 'request (one credit)',
  measuredAt: '2026-10-15',
};
export const FEED_PRICES: PriceBook = { [`${FEED_VENDOR}:${FEED_ENDPOINT}`]: FEED_PRICE };

export interface FeedPage {
  /** The feed's entries in the app shape, adverts already dropped. */
  readonly items: readonly unknown[];
  /** What the vendor said this request cost; null when it did not say. */
  readonly creditsCharged: number | null;
}

export interface TrendingFeedClient {
  feed(region: string): Promise<FeedPage>;
}

export interface TrendingFeedConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

/** The regions asked that are two capitals; anything else is refused, never sent. */
export function feedRegions(regions: readonly string[]): readonly string[] {
  return [...new Set(regions.map((r) => r.trim().toUpperCase()).filter((r) => REGION.test(r)))];
}

/** A client, or null when no key is set: the feed is optional and its absence is not a fault. */
export function trendingFeedClient(config: TrendingFeedConfig): TrendingFeedClient | null {
  const key = config.apiKey.trim();
  if (key === '') return null;
  const base = config.baseUrl.replace(/\/+$/, '');
  return {
    async feed(region: string): Promise<FeedPage> {
      if (!REGION.test(region)) throw new RangeError(`trending feed: region must be two capitals, got ${JSON.stringify(region)}`);
      const ask = () =>
        config.fetch(`${base}${FEED_PATH}?region=${region}`, {
          headers: { 'x-api-key': key, accept: 'application/json' },
          signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      /* ★ ONE RETRY ON A 5xx. 2 of 5 US asks on 2026-10-15 came back 500 and were not charged (the
         balance did not move); the same ask a moment later answers. Once only: a vendor that is down
         stays an outage. */
      let res = await ask();
      if (res.status >= 500) res = await ask();
      /* The vendor's 402 is "need more credits": the owner is told through the billing hook. */
      if (res.status === 402) throw outOfCredit(FEED_VENDOR, FEED_ENDPOINT, 'credits spent', 402);
      if (!res.ok) throw new Error(`trending feed: HTTP ${res.status}`);
      const body = rec(await res.json());
      if (body.success === false) throw new Error('trending feed: the vendor reported failure');
      vendorAnswered(FEED_VENDOR);
      creditsSeen(body, Date.now());
      const charged = body.credits_charged;
      return {
        items: arr(body.aweme_list).filter((v) => rec(v).is_ad !== true),
        creditsCharged: typeof charged === 'number' ? charged : null,
      };
    },
  };
}

const TAG = /#([\p{L}\p{N}_]+)/gu;

/**
 * One feed entry in the first scraper's field names (via `fromSearchActor`), with its tags read
 * from the caption, since this feed sends none of its own. An entry with no id comes back as it
 * was, and `toItem` refuses it.
 */
export function fromTrendingFeed(raw: unknown): unknown {
  const mapped = fromSearchActor(raw);
  if (mapped === raw) return raw;
  const m = rec(mapped);
  if (arr(m.textExtra).length > 0) return mapped;
  const caption = str(rec(raw).desc) ?? '';
  const tags = [...new Set([...caption.matchAll(TAG)].map((t) => t[1] ?? '').filter((t) => t !== ''))];
  return { ...m, textExtra: tags.map((hashtagName) => ({ hashtagName })) };
}
