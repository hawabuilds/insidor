/**
 * GET /coin/:id/theses — what fomo's traders wrote about a coin, for the token chart's bubbles (the
 * owner, 2026-11-06: "on token charts on gmgn you can see … fomo's thesis' … i want us to have these").
 * fomo is a social trading app: a trader posts a short "thesis" with a trade, and fomo shows their
 * position beside it. Each one here is the trader's handle, name and picture, their words, when they
 * posted, and their position as fomo reports it — facts about the world, shown with fomo's name on
 * them. The fomo team said Insidor may read these (2026-11-06) as long as fomo is credited.
 *
 * Its own file because it is a vendor edge: one outside service, one login, its own failure modes.
 *
 * ★ THE LOGIN IS THE OWNER'S TO SET, NEVER OURS. fomo has no API key; its feed answers a signed-in
 * browser's cookies. `FOMO_COOKIE` (read config) is that cookie, copied by the owner from a fomo
 * account he chose and set on Railway by him. Without it nothing is asked and the answer says so.
 *
 * ★ MISSING IS A REASON, NEVER "NO THESES". Not configured, the login expired (fomo answers 401),
 * fomo unreachable or answering something else, or our own call cap reached: each is `theses: null`
 * with `why`, so the chart can say the bubbles are unavailable instead of drawing an empty chart that
 * reads as "nobody wrote anything".
 *
 * ★ LIGHT ON FOMO. One call per coin per `keepMs`, shared by every viewer, and at most `perMinute`
 * calls a minute across all coins; a coin past the cap is answered from what is kept, or `busy`.
 *
 * What breaks if changed carelessly: the position numbers are fomo's, as fomo reports them at the
 * moment we read them; nothing here computes a profit or says the trader was right. And the cookie
 * must never reach a log line or a reply.
 */

import type { Logger } from './log.ts';

/** fomo's id for Solana (its token pages' `networkId`). */
export const FOMO_SOLANA_NETWORK = 1399811149;
const FEED_URL = 'https://prod-api.fomo.family/feed/token/thesis';
/** fomo's own feed asks with this: theses by traders holding at least this many dollars of the coin. */
const FEED_MIN_POSITION_USD = 1000;
const TIMEOUT_MS = 8_000;
const TEXT_MAX_CHARS = 400;
/**
 * ★ THE HEADERS FOMO'S OWN APP SENDS (read from a live request, 2026-11-07). Without `app-build` and
 * `x-supported-chains` fomo's API refuses the call (a custom 432); `app-build` is fomo's web build id,
 * which its API takes leniently, and the chain list names the networks the app understands. A
 * browser-shaped User-Agent keeps Cloudflare from turning away a bare server client. `FOMO_APP_BUILD`
 * and `FOMO_SUPPORTED_CHAINS` override the defaults if fomo ever changes them.
 */
export const APP_HEADERS = (env: Readonly<Record<string, string | undefined>>): Record<string, string> => ({
  'app-build': env['FOMO_APP_BUILD']?.trim() || '0e38742',
  'app-language': 'en',
  'x-supported-chains': env['FOMO_SUPPORTED_CHAINS']?.trim() || '1,56,143,4663,5042,8453,1399811149',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  origin: 'https://fomo.family',
  referer: 'https://fomo.family/',
});

export type ThesesWhy = 'not_configured' | 'login_expired' | 'unavailable' | 'busy';

export interface Thesis {
  readonly id: string;
  /** When the trader posted it, ms. */
  readonly at: number;
  /** The trader's fomo handle, without @. */
  readonly handle: string;
  readonly name: string | null;
  /** https only; anything else is no picture. */
  readonly pictureUrl: string | null;
  readonly text: string;
  /** The coin's market cap when it was posted, as fomo recorded it. */
  readonly marketCapUsd: number | null;
  readonly likes: number | null;
  /** The trader's position in the coin as fomo reports it now; null when fomo sent none. */
  readonly position: { readonly valueUsd: number | null; readonly pnlUsd: number | null; readonly pnlPct: number | null; readonly closed: boolean } | null;
  /** The coin on fomo, where the thesis is read in full. */
  readonly url: string;
}

export type ThesesReply = { readonly theses: readonly Thesis[] } | { readonly theses: null; readonly why: ThesesWhy };

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const https = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && s.startsWith('https://') ? s : null;
};

/** The coin's page on fomo. */
export const fomoCoinUrl = (address: string): string => `https://fomo.family/tokens/solana/${address}`;

/**
 * fomo's feed reply as theses, oldest first. Anything that is not a thesis, or lacks an id, a time,
 * a handle or words, is left out rather than shown half-made. Pure.
 */
export function decodeTheses(body: unknown, address: string): readonly Thesis[] {
  const items = rec(rec(body)['responseObject'])['items'];
  if (!Array.isArray(items)) return [];
  const out: Thesis[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const it = rec(raw);
    if (it['type'] !== 'thesis') continue;
    const c = rec(it['comment']);
    const id = str(it['id']) ?? str(c['id']);
    const at = Date.parse(String(c['createdAt'] ?? it['createdAt'] ?? ''));
    const handle = str(it['userHandle']);
    const text = str(c['comment']);
    if (id === null || !Number.isFinite(at) || handle === null || text === null || seen.has(id)) continue;
    seen.add(id);
    const trade = it['authorTrade'] === null || it['authorTrade'] === undefined ? null : rec(it['authorTrade']);
    out.push({
      id,
      at,
      handle,
      name: str(it['displayName']),
      pictureUrl: https(it['profilePictureLink']),
      text: Array.from(text).length > TEXT_MAX_CHARS ? `${Array.from(text).slice(0, TEXT_MAX_CHARS - 1).join('').trimEnd()}…` : text,
      marketCapUsd: num(c['marketCapAtCreation']),
      likes: num(rec(rec(c['reactions'])['counts'])['likeCount']) ?? num(c['numLikes']),
      position: trade === null ? null : {
        valueUsd: num(trade['usdValue']),
        pnlUsd: num(trade['unrealizedPnlUsd']),
        pnlPct: num(trade['percentageUnrealizedPnl']),
        closed: trade['closedAt'] !== null && trade['closedAt'] !== undefined,
      },
      url: fomoCoinUrl(address),
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface ThesesDeps {
  /** The live fomo login (fomo-session.ts): a fresh cookie, or a typed reason there is none. */
  readonly cookie: () => Promise<{ readonly cookie: string } | { readonly cookie: null; readonly why: 'not_configured' | 'login_expired' | 'unavailable' }>;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly log: Pick<Logger, 'info'>;
  /** How long one coin's answer is kept and shared. */
  readonly keepMs: number;
  /** Calls to fomo a minute, across every coin. */
  readonly perMinute: number;
  /** The headers fomo's own app sends (APP_HEADERS); without them fomo's API refuses the call. */
  readonly appHeaders: Record<string, string>;
  /**
   * ★ AN UPSTREAM THAT RETURNS FOMO'S THESIS JSON ITSELF (`FOMO_THESES_PROXY`). Set, every read goes
   * to `<proxy>?mint=<address>` and the fomo login here is skipped — that upstream owns the fetch and
   * auth, and hands back fomo's raw `{success, responseObject:{items}}`, which we parse as usual. Null:
   * we call fomo directly with the renewed login above. The two are interchangeable to everything
   * downstream (the bubbles, the cache, the cap).
   */
  readonly proxyUrl: string | null;
}

/** A coin's theses by its Solana address, kept `keepMs`, at most `perMinute` calls to fomo a minute. */
export function createTheses(deps: ThesesDeps): (address: string) => Promise<ThesesReply> {
  const kept = new Map<string, { readonly at: number; readonly reply: ThesesReply }>();
  const asked: number[] = [];
  const KEPT_MAX = 500;
  /** One coin's raw fomo JSON through the upstream proxy: no login, the proxy owns the fetch. */
  async function viaProxy(proxy: string, address: string): Promise<ThesesReply> {
    try {
      const url = `${proxy}${proxy.includes('?') ? '&' : '?'}mint=${encodeURIComponent(address)}`;
      const res = await deps.fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        deps.log.info('fomo theses upstream unavailable', { status: res.status });
        return { theses: null, why: 'unavailable' };
      }
      const body: unknown = await res.json();
      return rec(body)['success'] === false ? { theses: null, why: 'unavailable' } : { theses: decodeTheses(body, address) };
    } catch (e) {
      deps.log.info('fomo theses upstream unavailable', { err: e instanceof Error ? e.message : String(e) });
      return { theses: null, why: 'unavailable' };
    }
  }

  /** One coin's raw fomo JSON straight from fomo, with the renewed login and fomo's own app headers. */
  async function direct(cookie: string, address: string): Promise<ThesesReply> {
    try {
      const url = `${FEED_URL}?tokenAddress=${encodeURIComponent(address)}&networkId=${FOMO_SOLANA_NETWORK}&threshold=${FEED_MIN_POSITION_USD}`;
      const res = await deps.fetch(url, { headers: { ...deps.appHeaders, cookie, 'content-type': 'application/json', accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 401 || res.status === 403) {
        deps.log.info('fomo theses: the login was refused by fomo', { status: res.status });
        return { theses: null, why: 'login_expired' };
      }
      if (!res.ok) {
        deps.log.info('fomo theses unavailable', { status: res.status });
        return { theses: null, why: 'unavailable' };
      }
      const body: unknown = await res.json();
      return rec(body)['success'] === false ? { theses: null, why: 'unavailable' } : { theses: decodeTheses(body, address) };
    } catch (e) {
      deps.log.info('fomo theses unavailable', { err: e instanceof Error ? e.message : String(e) });
      return { theses: null, why: 'unavailable' };
    }
  }

  return async (address) => {
    const now = deps.now();
    const hit = kept.get(address);
    if (hit !== undefined && now - hit.at < deps.keepMs) return hit.reply;
    /* With an upstream, the proxy owns the login; without one, we need our own renewed cookie first.
       Either way no cookie is a reason of its own (not configured, expired, down), never a blind call. */
    let cookie: string | null = null;
    if (deps.proxyUrl === null) {
      const login = await deps.cookie();
      if (login.cookie === null) return { theses: null, why: login.why };
      cookie = login.cookie;
    }
    while (asked.length > 0 && now - (asked[0] ?? 0) >= 60_000) asked.shift();
    if (asked.length >= deps.perMinute) return hit?.reply ?? { theses: null, why: 'busy' };
    asked.push(now);
    const reply = deps.proxyUrl !== null ? await viaProxy(deps.proxyUrl, address) : await direct(cookie as string, address);
    /* A refused login is kept too, so an expired cookie is not asked again by every viewer. */
    if (kept.size >= KEPT_MAX) kept.delete(kept.keys().next().value ?? '');
    kept.set(address, { at: now, reply });
    return reply;
  };
}
