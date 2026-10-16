/**
 * The second vendor's (ScrapeCreators) search and re-read endpoints for the short-video source: the
 * newest-first keyword search, a sound's videos, a creator's latest videos and one video by link.
 * The recommendation feed on the same vendor keeps its own client (trending-feed.ts).
 *
 * WHY THIS VENDOR, AND WHY A FILE OF ITS OWN. The owner approved moving the source's search and
 * re-reads here on 2026-10-15 ("newest-first, by keyword and by sound"). It bills one credit a request,
 * whatever comes back, from a prepaid pack that never expires — there is no run to start, poll and
 * read as on the first scraper (client.ts), so nothing of that client's machinery applies, and a
 * search page that came back with fewer videos costs the same as a full one. Every entry is the
 * platform's app shape, the same one the newest-first actor and the feed return, so the adapter turns
 * it into Items with `fromSearchActor` and `to-item.ts` stays the one place that decides an Item.
 *
 * WHAT EACH ENDPOINT IS (the vendor's docs, read 2026-10-16; measured in tools/sc-search-probe.ts):
 *   - keyword search `GET /v1/tiktok/search/keyword?query&sort_by=date-posted&date_posted=yesterday`,
 *     a page of entries wrapped in `search_item_list[].aweme_info`, a numeric `cursor` for the next;
 *   - a sound's videos `GET /v1/tiktok/song/videos?clipId`, `aweme_list` and `cursor`;
 *   - a creator's videos `GET /v3/tiktok/profile/videos?handle&sort_by=latest`, `aweme_list`;
 *   - one video `GET /v2/tiktok/video?url`, `aweme_detail`.
 *
 * What breaks if changed carelessly:
 *   - `cache_max_age` is never sent. With it the vendor answers from a copy up to days old for no
 *     credit, and a re-read would record yesterday's views as today's — a reading that is a fiction.
 *   - the key rides only the `x-api-key` header, never a URL a log could print.
 *   - a 402 throws the shared billing error (the owner is told, the meter records the quote, the
 *     caller logs an outage), and a 5xx is asked once more: those were not charged (2026-10-15).
 *   - an empty page is returned as empty, never thrown: whether two empty pages in a row mean the
 *     vendor is broken is the router's call (route.ts), not this file's.
 */

import { arr, outOfCredit, rec, str, vendorAnswered } from '@insidor/vendor-kit';
import type { Price, PriceBook } from '@insidor/meter';

import { creditsSeen } from './route.ts';
import { FEED_USD_PER_CREDIT, FEED_VENDOR } from './trending-feed.ts';

export const SC_VENDOR = FEED_VENDOR;
export const SC_SEARCH = 'search';
export const SC_SOUND = 'sound';
export const SC_PROFILE = 'profile';
export const SC_VIDEO = 'video';

const PATHS = {
  [SC_SEARCH]: '/v1/tiktok/search/keyword',
  [SC_SOUND]: '/v1/tiktok/song/videos',
  [SC_PROFILE]: '/v3/tiktok/profile/videos',
  [SC_VIDEO]: '/v2/tiktok/video',
} as const;
type ScEndpoint = keyof typeof PATHS;

const DEFAULT_TIMEOUT_MS = 30_000;

/** One credit a request on every endpoint here, at the dearer pack (trending-feed.ts). */
const price = (endpoint: ScEndpoint, unitName: string): Price => ({
  vendor: SC_VENDOR,
  endpoint,
  unit: 'per-call',
  usdPerUnit: FEED_USD_PER_CREDIT,
  unitName,
  measuredAt: '2026-10-16',
});
export const SC_PRICES: PriceBook = {
  [`${SC_VENDOR}:${SC_SEARCH}`]: price(SC_SEARCH, 'search page (one credit)'),
  [`${SC_VENDOR}:${SC_SOUND}`]: price(SC_SOUND, 'sound page (one credit)'),
  [`${SC_VENDOR}:${SC_PROFILE}`]: price(SC_PROFILE, 'profile page (one credit)'),
  [`${SC_VENDOR}:${SC_VIDEO}`]: price(SC_VIDEO, 'video (one credit)'),
};

export interface ScPage {
  /** Entries in the platform's app shape, adverts dropped. */
  readonly items: readonly unknown[];
  /** The value to ask the next page with; null when the vendor gave none or said there is no more. */
  readonly cursor: string | null;
  /** What the vendor said this request cost; null when it did not say. */
  readonly creditsCharged: number | null;
}

export interface ScVideo {
  /** The video in the app shape, or null when the vendor answered without one (deleted, private). */
  readonly item: unknown | null;
  readonly creditsCharged: number | null;
}

export interface ScClient {
  /** Newest first over the past day. */
  search(word: string, cursor?: string | null): Promise<ScPage>;
  sound(clipId: string, cursor?: string | null): Promise<ScPage>;
  /** The creator's latest videos, newest first. */
  profile(handle: string): Promise<ScPage>;
  video(url: string): Promise<ScVideo>;
}

export interface ScConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const notAd = (v: unknown): boolean => rec(v).is_ad !== true;
const cursorOf = (body: Record<string, unknown>, key: string): string | null => {
  if (body.has_more === false || body.has_more === 0) return null;
  const c = body[key];
  return typeof c === 'number' || (typeof c === 'string' && c !== '') ? String(c) : null;
};
const charged = (body: Record<string, unknown>): number | null => (typeof body.credits_charged === 'number' ? body.credits_charged : null);

/** A client, or null when no key is set: without the key the source runs on the first scraper alone. */
export function scClient(config: ScConfig): ScClient | null {
  const key = config.apiKey.trim();
  if (key === '') return null;
  const base = config.baseUrl.replace(/\/+$/, '');

  async function get(endpoint: ScEndpoint, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = `${base}${PATHS[endpoint]}?${new URLSearchParams(params).toString()}`;
    const ask = () => config.fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    let res = await ask();
    if (res.status >= 500) res = await ask();
    if (res.status === 402) throw outOfCredit(SC_VENDOR, endpoint, 'credits spent', 402);
    if (!res.ok) throw new Error(`${SC_VENDOR} ${endpoint}: HTTP ${res.status}`);
    const body = rec(await res.json());
    if (body.success === false) throw new Error(`${SC_VENDOR} ${endpoint}: the vendor reported failure`);
    vendorAnswered(SC_VENDOR);
    creditsSeen(body, Date.now());
    return body;
  }

  return {
    async search(word, cursor = null) {
      const body = await get(SC_SEARCH, { query: word, sort_by: 'date-posted', date_posted: 'yesterday', ...(cursor === null ? {} : { cursor }) });
      const items = arr(body.search_item_list).map((e) => rec(e).aweme_info ?? e).filter(notAd);
      return { items, cursor: cursorOf(body, 'cursor'), creditsCharged: charged(body) };
    },
    async sound(clipId, cursor = null) {
      const body = await get(SC_SOUND, { clipId, ...(cursor === null ? {} : { cursor }) });
      return { items: arr(body.aweme_list).filter(notAd), cursor: cursorOf(body, 'cursor'), creditsCharged: charged(body) };
    },
    async profile(handle) {
      const body = await get(SC_PROFILE, { handle, sort_by: 'latest' });
      return { items: arr(body.aweme_list).filter(notAd), cursor: cursorOf(body, 'max_cursor'), creditsCharged: charged(body) };
    },
    async video(url) {
      const body = await get(SC_VIDEO, { url });
      const detail = body.aweme_detail;
      return { item: detail !== null && typeof detail === 'object' && str(rec(detail).aweme_id) !== null ? detail : null, creditsCharged: charged(body) };
    },
  };
}
