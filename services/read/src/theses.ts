/**
 * GET /coin/:id/theses — what fomo's traders wrote about a coin, for the token chart's bubbles.
 * fomo is a social trading app: a trader posts a short "thesis" with a trade, and fomo shows
 * their position beside it. Each one here is the trader's handle, name and picture, their words,
 * when they posted, and their position size as fomo reports it — facts about the world, shown
 * with fomo's name on them.
 *
 * Data comes from fomoapi.io, an independent FOMO data API (not affiliated with fomo.family).
 * One `FOMOAPI_KEY` on Railway is all the auth needed: a plain Bearer key, no session management.
 *
 * ★ ONLY THESES BACKED BY $250+. `threshold=250` is passed on every call; the API skips theses
 * on positions under that size, so low-conviction dust trades never reach the chart.
 *
 * ★ MISSING IS A REASON, NEVER "NO THESES". Not configured, the key refused, the API unreachable,
 * or the per-minute cap reached: each is `theses: null` with `why`, so the chart can say the
 * bubbles are unavailable instead of drawing an empty chart that reads as "nobody wrote anything".
 *
 * ★ LIGHT ON FOMOAPI. One call per coin per 10 minutes, shared by every viewer, and at most 20
 * calls a minute across all coins (matches the free tier's HTTP limit).
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
  readonly position: { readonly valueUsd: number | null; readonly pnlUsd: null; readonly pnlPct: null; readonly closed: boolean } | null;
  /** The coin on fomo, where the thesis is read in full. */
  readonly url: string;
}

export type ThesesReply = { readonly theses: readonly Thesis[] } | { readonly theses: null; readonly why: ThesesWhy };

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const https = (v: unknown): string | null => { const s = str(v); return s !== null && s.startsWith('https://') ? s : null; };

export const fomoCoinUrl = (address: string): string => `https://fomo.family/tokens/solana/${address}`;

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
    const equityRaw = num(it['equity']);
    out.push({
      id,
      at,
      handle,
      name: str(it['name']),
      pictureUrl: https(it['avatar']),
      text: Array.from(text).length > TEXT_MAX_CHARS ? `${Array.from(text).slice(0, TEXT_MAX_CHARS - 1).join('').trimEnd()}…` : text,
      likes: num(it['likes']),
      position: equityRaw !== null && equityRaw > 0 ? { valueUsd: equityRaw, pnlUsd: null, pnlPct: null, closed: false } : null,
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
  readonly keepMs: number;
  readonly perMinute: number;
}

export function createTheses(deps: ThesesDeps): (address: string, threshold?: number) => Promise<ThesesReply> {
  if (deps.apiKey === null) return async () => ({ theses: null, why: 'not_configured' });

  const kept = new Map<string, { readonly at: number; readonly reply: ThesesReply }>();
  const asked: number[] = [];
  const KEPT_MAX = 500;

  return async (address, threshold = DEFAULT_THRESHOLD_USD) => {
    const cacheKey = `${address}:${threshold}`;
    const now = deps.now();
    const hit = kept.get(cacheKey);
    if (hit !== undefined && now - hit.at < deps.keepMs) return hit.reply;

    while (asked.length > 0 && now - (asked[0] ?? 0) >= 60_000) asked.shift();
    if (asked.length >= deps.perMinute) return hit?.reply ?? { theses: null, why: 'busy' };
    asked.push(now);

    let reply: ThesesReply;
    try {
      const url = `${BASE_URL}/${encodeURIComponent(address)}?threshold=${threshold}&sort=recent&limit=50`;
      const res = await deps.fetch(url, {
        headers: { authorization: `Bearer ${deps.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        deps.log.info('fomoapi theses: key refused', { status: res.status });
        reply = { theses: null, why: 'login_failed' };
      } else if (!res.ok) {
        deps.log.info('fomoapi theses unavailable', { status: res.status });
        reply = { theses: null, why: 'upstream_error' };
      } else {
        const body: unknown = await res.json();
        reply = { theses: decodeThesesResponse(body, address) };
      }
    } catch (e) {
      deps.log.info('fomoapi theses unavailable', { err: e instanceof Error ? e.message : String(e) });
      reply = { theses: null, why: 'upstream_error' };
    }

    if (kept.size >= KEPT_MAX) kept.delete(kept.keys().next().value ?? '');
    kept.set(cacheKey, { at: now, reply });
    return reply;
  };
}
