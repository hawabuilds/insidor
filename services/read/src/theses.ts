/**
 * GET /coin/:id/theses — what fomo's traders wrote about a coin, for the token chart's bubbles.
 * fomo is a social trading app: a trader posts a short "thesis" with a trade, and fomo shows
 * their position beside it. Each one here is the trader's handle, name and picture, their words,
 * when they posted, and their position size and profit as fomo reports them — facts about the
 * world, shown with fomo's name on them.
 *
 * Data comes from fomoapi.io, an independent FOMO data API (not affiliated with fomo.family).
 * One `FOMOAPI_KEY` on Railway is all the auth needed: a plain Bearer key, no session management.
 *
 * ★ ONLY THESES BACKED BY $250+. `threshold=250` is passed on every call; the API skips theses
 * on positions under that size, so low-conviction dust trades never reach the chart.
 *
 * ★ THE POSITION COMES FROM THE THESIS ROW ITSELF. Each row carries the trade's size
 * (`tradeUsd`) and its realized and unrealized profit, so no per-trade lookup is needed.
 * `equity` is read first but fomoapi sends it as 0 on open positions, so it cannot be the only
 * source: reading equity alone dropped every position and the card showed none.
 *
 * ★ MISSING IS A REASON, NEVER "NO THESES". Not configured, the key refused, the API unreachable,
 * or the per-minute cap reached: each is `theses: null` with `why`, so the chart can say the
 * bubbles are unavailable instead of drawing an empty chart that reads as "nobody wrote anything".
 *
 * ★ TWO SPEEDS, SAME CREDITS. fomoapi returns one page (about 25 theses) unless asked for more,
 * and on a busy coin 25 reach back only an hour or two. So the newest page is read every 15
 * minutes and four pages of history every 2 hours, and the two are merged. Per viewed coin that is
 * about 7,500 credits an hour, what one page every 10 minutes cost before. Old theses do not change,
 * so reading them slowly loses nothing; a new one shows at most 15 minutes late. The history's
 * profit figures can be up to 2 hours old for theses past the newest page. Shared by every viewer;
 * at most 20 calls a minute across all coins (the free tier's HTTP limit).
 *
 * What breaks if changed carelessly: the position numbers are fomo's, as fomoapi reports them;
 * nothing here computes a profit or says the trader was right. The API key must never reach a
 * log line or a reply.
 */

import type { Logger } from './log.ts';

const BASE_URL = 'https://api.fomoapi.io/v2/thesis/token';
/** Default minimum position when the caller does not specify a threshold. */
const DEFAULT_THRESHOLD_USD = 250;
const TIMEOUT_MS = 8_000;
/** The deeper read walks several upstream pages, so it is given longer. */
const HISTORY_TIMEOUT_MS = 20_000;
/** Pages of history read on the slow cadence (fomoapi: about 25 theses a page, 1,250 credits a page). */
const HISTORY_PAGES = 4;
const TEXT_MAX_CHARS = 400;

export type ThesesWhy = 'not_configured' | 'login_failed' | 'upstream_error' | 'busy';

export interface Thesis {
  readonly id: string;
  /** When the trader posted it, ms. */
  readonly at: number;
  readonly handle: string;
  readonly name: string | null;
  /** https only; anything else is no picture. */
  readonly pictureUrl: string | null;
  readonly text: string;
  readonly likes: number | null;
  /** Position in the coin as fomoapi reports it; null when not supplied. */
  readonly position: { readonly valueUsd: number | null; readonly pnlUsd: number | null; readonly pnlPct: null; readonly closed: boolean } | null;
  /** The coin on fomo, where the thesis is read in full. */
  readonly url: string;
}

export type ThesesReply = { readonly theses: readonly Thesis[] } | { readonly theses: null; readonly why: ThesesWhy };

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const https = (v: unknown): string | null => { const s = str(v); return s !== null && s.startsWith('https://') ? s : null; };
const positive = (v: unknown): number | null => { const n = num(v); return n !== null && n > 0 ? n : null; };

export const fomoCoinUrl = (address: string): string => `https://fomo.family/tokens/solana/${address}`;

/** Size from equity, else the trade's size; profit is realized plus unrealized, absent when fomo sent neither. */
function positionOf(it: Record<string, unknown>): Thesis['position'] {
  const valueUsd = positive(it['equity']) ?? positive(it['tradeUsd']);
  if (valueUsd === null) return null;
  const realized = num(it['realizedPnlUsd']);
  const unrealized = num(it['unrealizedPnlUsd']);
  const pnlUsd = realized === null && unrealized === null ? null : (realized ?? 0) + (unrealized ?? 0);
  return { valueUsd, pnlUsd, pnlPct: null, closed: false };
}

/**
 * Decodes the fomoapi.io /v2/thesis/token response into our Thesis list, oldest first.
 * A thesis missing an id, a parseable timestamp, a handle, or any text is dropped.
 */
export function decodeThesesResponse(body: unknown, address: string): readonly Thesis[] {
  const items = rec(body)['theses'];
  if (!Array.isArray(items)) return [];
  const out: Thesis[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const it = rec(raw);
    const id = str(it['id']);
    const at = Date.parse(String(it['ts'] ?? ''));
    const handle = str(it['handle']);
    const text = str(it['text']);
    if (id === null || !Number.isFinite(at) || handle === null || text === null || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      at,
      handle,
      name: str(it['name']),
      pictureUrl: https(it['avatar']),
      text: Array.from(text).length > TEXT_MAX_CHARS ? `${Array.from(text).slice(0, TEXT_MAX_CHARS - 1).join('').trimEnd()}…` : text,
      likes: num(it['likes']),
      position: positionOf(it),
      url: fomoCoinUrl(address),
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface ThesesDeps {
  /** fomoapi.io Bearer key (FOMOAPI_KEY). Null: not configured. Never logged. */
  readonly apiKey: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly log: Pick<Logger, 'info'>;
  /** How long the newest page is kept before it is read again. */
  readonly recentKeepMs: number;
  /** How long the deeper history (HISTORY_PAGES pages) is kept before it is read again. */
  readonly historyKeepMs: number;
  /** Calls to fomoapi per minute across every coin, a history call counting once. */
  readonly perMinute: number;
}

type Read = { readonly at: number; readonly theses: readonly Thesis[] };
type Fetched = { readonly theses: readonly Thesis[] } | { readonly theses: null; readonly why: ThesesWhy };

/** Newest first wins: the same thesis in both reads keeps the fresher read's position. */
export function mergeTheses(history: readonly Thesis[], recent: readonly Thesis[]): readonly Thesis[] {
  const byId = new Map<string, Thesis>();
  for (const t of history) byId.set(t.id, t);
  for (const t of recent) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

export function createTheses(deps: ThesesDeps): (address: string, threshold?: number) => Promise<ThesesReply> {
  if (deps.apiKey === null) return async () => ({ theses: null, why: 'not_configured' });

  const recent = new Map<string, Read>();
  const history = new Map<string, Read>();
  const failed = new Map<string, { readonly at: number; readonly why: ThesesWhy }>();
  const asked: number[] = [];
  const KEPT_MAX = 500;

  const keep = (m: Map<string, Read>, k: string, v: Read) => {
    if (m.size >= KEPT_MAX && !m.has(k)) m.delete(m.keys().next().value ?? '');
    m.set(k, v);
  };

  const fetchPages = async (address: string, threshold: number, pages: number): Promise<Fetched> => {
    try {
      const limit = pages === 1 ? 50 : 200;
      const url = `${BASE_URL}/${encodeURIComponent(address)}?threshold=${threshold}&sort=recent&limit=${limit}&pages=${pages}`;
      const res = await deps.fetch(url, {
        headers: { authorization: `Bearer ${deps.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(pages === 1 ? TIMEOUT_MS : HISTORY_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        deps.log.info('fomoapi theses: key refused', { status: res.status });
        return { theses: null, why: 'login_failed' };
      }
      if (!res.ok) {
        deps.log.info('fomoapi theses unavailable', { status: res.status, pages });
        return { theses: null, why: 'upstream_error' };
      }
      return { theses: decodeThesesResponse(await res.json(), address) };
    } catch (e) {
      deps.log.info('fomoapi theses unavailable', { err: e instanceof Error ? e.message : String(e), pages });
      return { theses: null, why: 'upstream_error' };
    }
  };

  const room = (now: number): boolean => {
    while (asked.length > 0 && now - (asked[0] ?? 0) >= 60_000) asked.shift();
    if (asked.length >= deps.perMinute) return false;
    asked.push(now);
    return true;
  };

  return async (address, threshold = DEFAULT_THRESHOLD_USD) => {
    const k = `${address}:${threshold}`;
    const now = deps.now();
    const h = history.get(k);
    const r = recent.get(k);
    const historyStale = h === undefined || now - h.at >= deps.historyKeepMs;
    const recentStale = r === undefined || now - r.at >= deps.recentKeepMs;
    const lastFail = failed.get(k);
    /* A failure is kept as long as a newest page would be, so a coin fomoapi refuses is not asked on every view. */
    const coolingOff = lastFail !== undefined && now - lastFail.at < deps.recentKeepMs;

    if ((historyStale || recentStale) && !coolingOff && room(now)) {
      /* The history read includes the newest page, so when it is due it stands in for both. */
      const got = await fetchPages(address, threshold, historyStale ? HISTORY_PAGES : 1);
      if (got.theses === null) {
        failed.set(k, { at: now, why: got.why });
      } else {
        failed.delete(k);
        keep(recent, k, { at: now, theses: got.theses });
        if (historyStale) keep(history, k, { at: now, theses: got.theses });
      }
    }

    const hNow = history.get(k);
    const rNow = recent.get(k);
    if (hNow === undefined && rNow === undefined) {
      const f = failed.get(k);
      return { theses: null, why: f?.why ?? 'busy' };
    }
    return { theses: mergeTheses(hNow?.theses ?? [], rNow?.theses ?? []) };
  };
}
