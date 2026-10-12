/**
 * THE ONLY MODULE IN THE PHONE APP THAT TOUCHES THE NETWORK.
 *
 * It reads the read service's routes (services/read/src/routes.ts) and nothing else. Everything it returns has been through
 * `decode.ts`; nothing here constructs a wire object by hand. The shape and the reasoning are
 * the desktop app's `app/src/shared/api/client.ts`, cut down to what this app reads.
 *
 * ★ THREE SOURCES OF DATA, AND WHICH ONE IS WHICH IS DECIDED HERE, ONCE:
 *
 *   1. The read service, when `VITE_READ_URL` is set. Real rows, labelled by the provenance
 *      the projector commits with them.
 *   2. Dev fixtures standing in for it, when `VITE_READ_URL` is unset in a dev build. The same
 *      decoder, a permanent "Sample data" notice (`USING_FIXTURES`).
 *   3. Sample screens: the Narratives list and the pages reached from it. There is no
 *      endpoint for them yet, so they are sample data whatever the build points at, and they
 *      say so. ★ In a production build they do not exist at all — `SAMPLE_SCREENS` is a
 *      literal the bundler folds, the fixtures module is dropped, and the screen says it is
 *      coming soon — UNLESS the deploy sets VITE_SAMPLE_DATA=on on purpose, the one switch
 *      that ships sample data, always behind the notice (sample-switch.ts).
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: both flags must stay tied to
 * `import.meta.env.DEV` or the deliberate VITE_SAMPLE_DATA build switch. A runtime switch that could turn sample data on is how a screenshot
 * of invented market caps ends up in front of somebody as if it were the market.
 */

import { notImplemented } from '../not-implemented.ts';
import { decodeBoardTick, decodeCoinMarket, decodeNarratives, decodePortfolio, decodeRisingFeed, decodeSearch, decodeSearchedCoin, decodeStory } from './decode.ts';
import type { Portfolio, PortfolioRange } from './wire/wallet.ts';
import type { SearchedCoin, SearchResults } from './wire/search.ts';
import type { BuildResult, Holding, TradeQuote, TradeVenue } from './wire/trade.ts';
import type { CoinMarket, MarketTimeframe } from './wire/market.ts';
import type { BoardTick } from './wire/board.ts';
import type { RisingFeed, RisingFeedId } from './wire/rising.ts';
import type { NarrativesList, Story } from './wire/story.ts';

/** A failure of the transport, as opposed to a failure of the payload. */
export class ReadError extends Error {
  readonly status: number;
  /** The server's own word for the failure (`{ "error": "slow down" }`), when it sent one. */
  readonly said: string | null;
  constructor(path: string, status: number, said: string | null = null) {
    super(`read failed: ${path} (${status})`);
    this.name = 'ReadError';
    this.status = status;
    this.said = said;
  }
}

async function saidBy(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    const said = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['error'] : null;
    return typeof said === 'string' ? said : null;
  } catch {
    return null;
  }
}

/**
 * The board the projector writes. `services/project/src/main.ts` commits exactly one view and
 * calls it `default`; asking for any other id is a 404 from the read service, not an empty
 * board.
 */
export const BOARD_VIEW = 'default';

const BASE = (import.meta.env?.['VITE_READ_URL'] as string | undefined) ?? '';
const DEV = import.meta.env?.DEV === true;
/* ★ THE PRODUCTION EXCEPTION, AND THE ONLY ONE: a build configured with VITE_SAMPLE_DATA=on
   (sample-switch.ts; vite.config.ts fails the build if it is set beside VITE_READ_URL).
   Kept as a literal comparison so the bundler folds it and drops the fixtures from every
   build that does not set it. */
const SAMPLE = import.meta.env?.VITE_SAMPLE_DATA === 'on';

const USE_FIXTURES = (DEV && BASE === '') || SAMPLE;

/** True when the feed is dev fixtures rather than the read service. The shell must say so. */
export const USING_FIXTURES = USE_FIXTURES;

/** True when the sample-only screens may render at all. False in every production build. */
export const SAMPLE_SCREENS = DEV || SAMPLE;

async function readFixture(path: string): Promise<unknown> {
  const { fixtureBoard, fixtureRising, fixtureStory } = await import('./fixtures.ts');
  if (path.startsWith('/board/')) return fixtureBoard();
  if (/^\/wallet\/[^/]+\/history/.test(path)) return { range: '1w', points: [] };
  if (path.startsWith('/wallet/')) {
    const { fixturePortfolio } = await import('./fixture-wallet.ts');
    return fixturePortfolio();
  }
  if (path.startsWith('/search?q=')) {
    const { fixtureSearch } = await import('./fixtures.ts');
    return fixtureSearch(decodeURIComponent(path.slice('/search?q='.length)));
  }
  if (/^\/coin\/[^/?]+$/.test(path)) {
    const { fixtureSearchedCoin } = await import('./fixtures.ts');
    const coin = fixtureSearchedCoin(decodeURIComponent(path.slice('/coin/'.length)));
    if (coin === null) throw new ReadError(path, 404);
    return coin;
  }
  if (path.startsWith('/coin/')) {
    const { fixtureMarket } = await import('./fixtures.ts');
    const [, coinId = '', tf = '1m'] = /^\/coin\/([^/]+)\/market\?tf=(\w+)$/.exec(path) ?? [];
    return fixtureMarket(decodeURIComponent(coinId), tf as MarketTimeframe);
  }
  if (path.startsWith('/narratives/')) {
    const { sampleNarrativeIds } = await import('./fixtures.ts');
    return { tick: 1, stories: sampleNarrativeIds().map((id) => fixtureStory(id)), provenance: { kind: 'observed' } };
  }
  if (path === '/rising/fyp' || path === '/rising/popular') return fixtureRising(path.slice('/rising/'.length) as RisingFeedId);
  if (path.startsWith('/story/')) {
    const story = fixtureStory(decodeURIComponent(path.slice('/story/'.length)));
    /* An id the fixtures do not cover is a 404, not an invented page. */
    if (story === null) throw new ReadError(path, 404);
    return story;
  }
  throw new ReadError(path, 501);
}

async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  if (USE_FIXTURES) return readFixture(path);
  const response = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    /* Every number on the board is stale within a tick; a cached one is worse than none. */
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new ReadError(path, response.status, await saidBy(response));
  return response.json();
}

export async function fetchBoard(viewId: string, signal?: AbortSignal): Promise<BoardTick> {
  return decodeBoardTick(await read(`/board/${encodeURIComponent(viewId)}`, signal));
}

/** One feed of single posts: `fyp` newest first, `popular` most views first. */
export async function fetchRising(feed: RisingFeedId, signal?: AbortSignal): Promise<RisingFeed> {
  return decodeRisingFeed(await read(`/rising/${encodeURIComponent(feed)}`, signal));
}

/** A coin's price history for one view, its latest trades and, on the curve, its progress. */
export async function fetchCoinMarket(coinId: string, timeframe: MarketTimeframe, signal?: AbortSignal): Promise<CoinMarket> {
  return decodeCoinMarket(await read(`/coin/${encodeURIComponent(coinId)}/market?tf=${timeframe}`, signal));
}

/** The Portfolio tab: what this wallet holds and what it is worth. The app asks only for its own. */
export async function fetchPortfolio(address: string, range: PortfolioRange, signal?: AbortSignal): Promise<Portfolio> {
  return decodePortfolio(await read(`/wallet/${encodeURIComponent(address)}?range=${range}`, signal));
}

/** The balance chart's points for a wallet, oldest first. Empty until the wallet has been read over time. */
export async function fetchWalletHistory(address: string, range: '1d' | '1w' | '1m' | 'all', signal?: AbortSignal): Promise<readonly { readonly t: number; readonly value: number }[]> {
  const raw = await read(`/wallet/${encodeURIComponent(address)}/history?range=${range}`, signal);
  const points = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['points'] : null;
  if (!Array.isArray(points)) return [];
  return points.flatMap((p) => {
    const o = typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {};
    return typeof o['t'] === 'number' && typeof o['value'] === 'number' && Number.isFinite(o['value']) && o['value'] >= 0 ? [{ t: o['t'], value: o['value'] }] : [];
  });
}

/** A sample wallet, recorded from a public one, for a build with no read service. Never the network. */
export async function loadSamplePortfolio(): Promise<Portfolio> {
  if (!SAMPLE_SCREENS) return notImplemented('loadSamplePortfolio: sample screens are off in this build');
  const { fixturePortfolio } = await import('./fixture-wallet.ts');
  return decodePortfolio(fixturePortfolio());
}

/** The Search tab: narratives, posts and coins matching a term. A 429 means slow down. */
export async function fetchSearch(term: string, signal?: AbortSignal): Promise<SearchResults> {
  return decodeSearch(await read(`/search?q=${encodeURIComponent(term)}`, signal));
}

/** A coin opened from search: what the search said about it. */
export async function fetchSearchedCoin(coinId: string, signal?: AbortSignal): Promise<SearchedCoin> {
  return decodeSearchedCoin(await read(`/coin/${encodeURIComponent(coinId)}`, signal));
}

/** The Narratives list: the board's stories as whole pages, in the board's order. */
export async function fetchNarratives(viewId: string, signal?: AbortSignal): Promise<NarrativesList> {
  return decodeNarratives(await read(`/narratives/${encodeURIComponent(viewId)}`, signal));
}

export async function fetchStory(storyId: string, signal?: AbortSignal): Promise<Story> {
  return decodeStory(await read(`/story/${encodeURIComponent(storyId)}`, signal));
}

/** A sample coin's market, for a sample page. Never touches the network. */
export async function loadSampleMarket(coinId: string, timeframe: MarketTimeframe): Promise<CoinMarket> {
  if (!SAMPLE_SCREENS) return notImplemented('loadSampleMarket: sample pages are off in this build');
  const { fixtureMarket } = await import('./fixtures.ts');
  return decodeCoinMarket(fixtureMarket(coinId, timeframe));
}

/** One page reached from the Narratives list. Never touches the network. */
export async function loadSampleStory(storyId: string): Promise<Story> {
  if (!SAMPLE_SCREENS) return notImplemented('loadSampleStory: no read route for narratives yet');
  const { fixtureStory } = await import('./fixtures.ts');
  const raw = fixtureStory(storyId);
  if (raw === null) throw new ReadError(`/sample/story/${storyId}`, 404);
  return decodeStory(raw);
}

/* ── trading (services/trade) ──────────────────────────────────────────
   A separate service, at VITE_TRADE_URL. Unset, every call below says trading is unavailable
   and none touches the network. The service itself refuses everything unless TRADING is on. */

const TRADE = (import.meta.env?.['VITE_TRADE_URL'] as string | undefined) ?? '';

async function trade(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<{ readonly ok: boolean; readonly status: number; readonly body: Record<string, unknown> }> {
  if (TRADE === '') return { ok: false, status: 503, body: { error: 'Trading is not connected.' } };
  const response = await fetch(`${TRADE}${path}`, {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { ok: response.ok, status: response.status, body };
}

const said = (body: Record<string, unknown>, fallback: string): string => (typeof body['error'] === 'string' ? body['error'] : fallback);

/** Where a coin can be traded now: its curve, its pool, nowhere, or "could not tell". */
export async function fetchTradeVenue(mint: string, signal?: AbortSignal): Promise<TradeVenue> {
  const r = await trade(`/venue/${encodeURIComponent(mint)}`, {}, signal);
  const kind = r.body['kind'];
  return r.ok && (kind === 'curve' || kind === 'pool' || kind === 'none') ? kind : 'unavailable';
}

/** A quote, or the server's reason there is none. */
export async function fetchTradeQuote(
  q: { readonly mint: string; readonly side: 'buy' | 'sell'; readonly amount: string; readonly wallet: string; readonly slippageBps: number },
  signal?: AbortSignal,
): Promise<{ readonly kind: 'quote'; readonly quote: TradeQuote } | { readonly kind: 'refused'; readonly why: string }> {
  const params = new URLSearchParams({ mint: q.mint, side: q.side, amount: q.amount, wallet: q.wallet, slippageBps: String(q.slippageBps) });
  const r = await trade(`/quote?${params}`, {}, signal);
  const raw = r.body['quote'];
  if (!r.ok || typeof raw !== 'object' || raw === null) return { kind: 'refused', why: said(r.body, 'No price could be read just now.') };
  const o = raw as Record<string, unknown>;
  const text = (k: string) => (typeof o[k] === 'string' && /^\d+$/.test(o[k] as string) ? (o[k] as string) : null);
  const [inAmount, outAmount, bound] = [text('inAmount'), text('outAmount'), text('bound')];
  if ((o['venue'] !== 'curve' && o['venue'] !== 'pool') || inAmount === null || outAmount === null || bound === null) {
    return { kind: 'refused', why: 'The price came back unreadable.' };
  }
  const impact = typeof o['priceImpactPct'] === 'number' && Number.isFinite(o['priceImpactPct']) ? o['priceImpactPct'] : null;
  return { kind: 'quote', quote: { venue: o['venue'], side: q.side, inAmount, outAmount, bound, slippageBps: typeof o['slippageBps'] === 'number' ? o['slippageBps'] : q.slippageBps, priceImpactPct: impact, sent: raw } };
}

/** The quote as an unsigned, simulated transaction — or the reason it would fail, and nothing to sign. */
export async function buildTrade(quote: TradeQuote, wallet: string): Promise<BuildResult> {
  const r = await trade('/build', { method: 'POST', body: JSON.stringify({ quote: quote.sent, wallet }) });
  const tx = r.body['transaction'];
  return r.ok && typeof tx === 'string' && tx !== '' ? { kind: 'ready', transaction: tx } : { kind: 'blocked', why: said(r.body, 'This trade could not be prepared just now.') };
}

/** Send: SOL (mint null) or a coin, as an unsigned, simulated transaction — or why it would fail. */
export async function buildTransfer(t: { readonly wallet: string; readonly to: string; readonly mint: string | null; readonly amount: string }): Promise<BuildResult> {
  const r = await trade('/transfer', { method: 'POST', body: JSON.stringify(t) });
  const tx = r.body['transaction'];
  return r.ok && typeof tx === 'string' && tx !== '' ? { kind: 'ready', transaction: tx } : { kind: 'blocked', why: said(r.body, 'This could not be prepared just now.') };
}

/* ── creating a coin (services/trade /launch, services/read /ticker) ───── */

export interface LaunchRules {
  readonly open: boolean;
  readonly creatorFeeBps: number;
  readonly protocolFeeBps: number;
  readonly maxDevBuyLamports: string;
}

export interface LaunchPreview {
  readonly costs: readonly { readonly key: 'network' | 'rent' | 'launchpad'; readonly lamports: number }[];
  readonly totalLamports: number;
  readonly balanceLamports: number;
  readonly devBuy: { readonly lamports: number; readonly tokensOut: string; readonly supplyBps: number } | null;
  readonly creatorFeeBps: number;
}

/** The launchpad's rules now, read from the chain by the trade service; null when they could not be read. */
export async function fetchLaunchRules(signal?: AbortSignal): Promise<LaunchRules | null> {
  const r = await trade('/launch/rules', {}, signal);
  const b = r.body;
  return r.ok && typeof b['open'] === 'boolean' && typeof b['creatorFeeBps'] === 'number' && typeof b['protocolFeeBps'] === 'number' && typeof b['maxDevBuyLamports'] === 'string'
    ? { open: b['open'], creatorFeeBps: b['creatorFeeBps'], protocolFeeBps: b['protocolFeeBps'], maxDevBuyLamports: b['maxDevBuyLamports'] }
    : null;
}

/** What this launch would cost, measured on the chain; or why it cannot be made. */
export async function previewLaunch(p: { readonly wallet: string; readonly name: string; readonly symbol: string; readonly devBuyLamports: string }, signal?: AbortSignal): Promise<{ readonly kind: 'preview'; readonly preview: LaunchPreview } | { readonly kind: 'refused'; readonly why: string }> {
  const r = await trade('/launch/preview', { method: 'POST', body: JSON.stringify(p) }, signal);
  const costs = r.body['costs'];
  if (!r.ok || !Array.isArray(costs)) return { kind: 'refused', why: said(r.body, 'The launch could not be priced just now.') };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const dev = r.body['devBuy'];
  return {
    kind: 'preview',
    preview: {
      costs: costs.flatMap((c) => {
        const o = typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {};
        return o['key'] === 'network' || o['key'] === 'rent' || o['key'] === 'launchpad' ? [{ key: o['key'], lamports: num(o['lamports']) }] : [];
      }),
      totalLamports: num(r.body['totalLamports']),
      balanceLamports: num(r.body['balanceLamports']),
      devBuy: typeof dev === 'object' && dev !== null ? { lamports: num((dev as Record<string, unknown>)['lamports']), tokensOut: String((dev as Record<string, unknown>)['tokensOut'] ?? '0'), supplyBps: num((dev as Record<string, unknown>)['supplyBps']) } : null,
      creatorFeeBps: num(r.body['creatorFeeBps']),
    },
  };
}

/** The launch, its metadata stored and its transaction built and simulated — or why not, with nothing to sign. */
export async function buildLaunchTx(p: { readonly wallet: string; readonly name: string; readonly symbol: string; readonly description: string; readonly imageDataUrl: string; readonly devBuyLamports: string }): Promise<{ readonly kind: 'ready'; readonly transaction: string; readonly mint: string } | { readonly kind: 'blocked'; readonly why: string }> {
  const r = await trade('/launch/build', { method: 'POST', body: JSON.stringify({ ...p, links: {} }) });
  const tx = r.body['transaction'];
  const mint = r.body['mint'];
  return r.ok && typeof tx === 'string' && typeof mint === 'string' ? { kind: 'ready', transaction: tx, mint } : { kind: 'blocked', why: said(r.body, 'The launch could not be prepared just now.') };
}

/** After the create landed: record it against its narrative, so it shows "Created on Insidor". */
export async function confirmLaunch(p: { readonly wallet: string; readonly signature: string; readonly mint: string; readonly storyId: string | null }): Promise<boolean> {
  const r = await trade('/launch/confirm', { method: 'POST', body: JSON.stringify(p) });
  return r.ok && r.body['recorded'] === true;
}

/** How many coins Insidor has seen with this ticker; null when it could not be read. */
export async function fetchTickerSeen(ticker: string, signal?: AbortSignal): Promise<number | null> {
  if (USE_FIXTURES) return null;
  try {
    const raw = await read(`/ticker/${encodeURIComponent(ticker)}`, signal);
    const seen = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['seen'] : null;
    return typeof seen === 'number' ? seen : null;
  } catch {
    return null;
  }
}

/** A picture by its address, as a data URL to upload; null when it cannot be read (a host may refuse). */
export async function imageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Send what the person signed. */
export async function sendSigned(signedBase64: string): Promise<{ readonly ok: true; readonly ref: string } | { readonly ok: false; readonly why: string }> {
  const r = await trade('/send', { method: 'POST', body: JSON.stringify({ transaction: signedBase64 }) });
  const sig = r.body['signature'];
  return r.ok && typeof sig === 'string' ? { ok: true, ref: sig } : { ok: false, why: said(r.body, 'The network did not take it. Nothing was spent; try again.') };
}

/** How much of a coin the wallet holds, for Sell. Null when it could not be read. */
export async function fetchHolding(mint: string, wallet: string, signal?: AbortSignal): Promise<Holding | null> {
  const r = await trade(`/balance?${new URLSearchParams({ mint, wallet })}`, {}, signal);
  const amount = r.body['amount'];
  const decimals = r.body['decimals'];
  return r.ok && typeof amount === 'string' && /^\d+$/.test(amount) && typeof decimals === 'number' ? { amount, decimals } : null;
}

/**
 * Execute a trade.
 *
 * Deliberately unimplemented, exactly as on the desktop. This is the one path where a bug
 * costs a person money, and a plausible stub gets wired to a button. Nothing in this app
 * calls it: Buy, Sell and Create say "Coming soon" and do nothing.
 */
export async function submitTrade(_coinId: string, _side: 'buy' | 'sell'): Promise<never> {
  return notImplemented('submitTrade: wallet signing and confirmation polling');
}
