/**
 * THE ONLY MODULE IN THE PHONE APP THAT TOUCHES THE NETWORK.
 *
 * It reads the read service's routes (services/read/src/routes.ts) and nothing else. Everything it returns has been through
 * `decode.ts`; nothing here constructs a wire object by hand. The shape and the reasoning are
 * the desktop app's `app/src/shared/api/client.ts`, cut down to what this app reads.
 *
 * ★ ONE SOURCE OF DATA: THE SERVICES. There is no sample data in the app, in any build. Every
 * read goes to the read service; an empty answer is an honest empty state on the screen, and a
 * failure says it could not read. Recorded data lives with the tests only, and
 * src/no-sample-data.test.ts fails if anything the app imports can reach it.
 *
 * ★ SAME-ORIGIN BY DEFAULT. With no VITE_*_URL set, each service is at `/api/<name>` on the
 * app's own origin: the local dev server and the Vercel deploy both forward those paths to the
 * services (mobile/vite.config.ts, mobile/api/proxy.js), so one https origin serves everything
 * and the phone needs no CORS.
 */

import { notImplemented } from '../not-implemented.ts';
import { decodeCoinAbout, type CoinAbout } from './about.ts';
import { decodePostSheet, type PostSheetData } from './post-sheet.ts';
import { decodeBoardTick, decodeCoinMarket, decodeNameIdeas, decodeNarratives, decodePortfolio, decodeRisingFeed, decodeRisingPage, decodeSameNameCoins, decodeSearch, decodeSearchedCoin, decodeStory, decodeTickerCoins } from './decode.ts';
import type { Portfolio, PortfolioRange } from './wire/wallet.ts';
import type { NameIdea, SameNameCoins, SearchedCoin, SearchResults } from './wire/search.ts';
import type { BuildResult, Holding, TradeLimits, TradeQuote, TradeVenue } from './wire/trade.ts';
import type { CoinMarket, MarketTimeframe } from './wire/market.ts';
import type { BoardTick } from './wire/board.ts';
import type { RisingFeed, RisingFeedId, RisingPage } from './wire/rising.ts';
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

const BASE = (import.meta.env?.['VITE_READ_URL'] as string | undefined) || '/api/read';

async function read(path: string, signal?: AbortSignal): Promise<unknown> {
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

/**
 * One page of a feed's infinite scroll, after `before` (null: the first page). Null when the read
 * service has no scroll for this feed (a 404: its table is not there yet), so the list simply ends
 * at the frame instead of claiming there is nothing older.
 */
export async function fetchRisingOlder(feed: RisingFeedId, before: string | null, signal?: AbortSignal): Promise<RisingPage | null> {
  const query = before === null ? '' : `?before=${encodeURIComponent(before)}`;
  try {
    return decodeRisingPage(await read(`/rising/${encodeURIComponent(feed)}/older${query}`, signal));
  } catch (e) {
    if (e instanceof ReadError && e.status === 404) return null;
    throw e;
  }
}

/*
 * FOR YOU'S LIVE LINE (used only by features/feed/useLiveFeed.ts, only while VITE_LIVE_FEED=on):
 * "this feed changed" as it happens, and the feed's number alone for the 30-second backup check.
 *
 * ★ OUR READ SERVICE, NOT THE DATABASE'S OWN REALTIME. The owner asked for Supabase realtime; it
 * needs the database's public key in this bundle, and on this project that key can write and
 * delete every app-facing table (the default grants, with no row rules), so shipping it would hand
 * the feed to anyone who opens the app's source. The read service already holds one LISTEN for the
 * projector's announcements and fans it out over SSE (services/read/src/stream.ts); this is that
 * stream with a small "changed" message.
 *
 * ★ THE STREAM GOES STRAIGHT TO THE READ SERVICE. A deployed build reaches it through the Vercel
 * function at /api/read, which is cut at 60 seconds and billed for every second it is held open,
 * the wrong place for a line that stays open. So: `VITE_LIVE_URL`, else `VITE_READ_URL`, else (local
 * dev only) the dev server's proxy; with none of them there is no stream and the 30-second check
 * alone keeps the feed current. A direct stream needs the app's origin in READ_ALLOWED_ORIGINS.
 */
const LIVE_BASE: string | null =
  ((import.meta.env?.['VITE_LIVE_URL'] as string | undefined) ?? '').trim().replace(/\/+$/, '') ||
  ((import.meta.env?.['VITE_READ_URL'] as string | undefined) ?? '').trim().replace(/\/+$/, '') ||
  (import.meta.env?.DEV === true ? '/api/read' : null);

/** The feed's number alone; it moves with every frame the projector commits. Null when it could not be read. */
export async function fetchRisingTick(feed: RisingFeedId, signal?: AbortSignal): Promise<number | null> {
  try {
    const body = await read(`/rising/${encodeURIComponent(feed)}/tick`, signal);
    const tick = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['tick'] : null;
    return typeof tick === 'number' && Number.isSafeInteger(tick) ? tick : null;
  } catch {
    return null;
  }
}

/**
 * Listen for the feed changing. `onChanged` gets the new number, or null when the line has just
 * (re)connected and frames may have been missed, so read the feed then (the service says `ready`
 * on every reconnect for exactly that). Returns the close, or null when this build has nowhere to
 * stream from.
 */
export function openRisingStream(feed: RisingFeedId, onChanged: (tick: number | null) => void): (() => void) | null {
  if (LIVE_BASE === null || globalThis.EventSource === undefined) return null;
  const source = new EventSource(`${LIVE_BASE}/stream/rising/${encodeURIComponent(feed)}`);
  source.addEventListener('ready', () => onChanged(null));
  source.addEventListener('changed', (e) => {
    try {
      const tick = (JSON.parse((e as MessageEvent<string>).data) as Record<string, unknown>)['tick'];
      onChanged(typeof tick === 'number' && Number.isSafeInteger(tick) ? tick : null);
    } catch {
      onChanged(null);
    }
  });
  return () => source.close();
}

/** A coin's price history for one view, its latest trades and, on the curve, its progress. */
export async function fetchCoinMarket(coinId: string, timeframe: MarketTimeframe, signal?: AbortSignal): Promise<CoinMarket> {
  return decodeCoinMarket(await read(`/coin/${encodeURIComponent(coinId)}/market?tf=${timeframe}`, signal));
}

/** A coin's links, day numbers, holders, creator and the feed posts naming it: the token page's Info tab. */
export async function fetchCoinAbout(coinId: string, signal?: AbortSignal): Promise<CoinAbout> {
  return decodeCoinAbout(await read(`/coin/${encodeURIComponent(coinId)}/about`, signal));
}

/** One feed post as its post sheet shows it: the post, its author, its media and every coin with its name. */
export async function fetchPostSheet(postId: string, signal?: AbortSignal): Promise<PostSheetData> {
  return decodePostSheet(await read(`/post/${encodeURIComponent(postId)}/sheet`, signal));
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

/** The Search tab: narratives, posts and coins matching a term. A 429 means slow down. */
export async function fetchSearch(term: string, signal?: AbortSignal): Promise<SearchResults> {
  return decodeSearch(await read(`/search?q=${encodeURIComponent(term)}`, signal));
}

/**
 * The coins an unsure feed post shares its name with: what "See 3 coins" opens. A 404 means the
 * post is no longer unsure on a feed; a 429 means slow down, as for Search.
 */
export async function fetchPostCoins(postId: string, signal?: AbortSignal): Promise<SameNameCoins> {
  return decodeSameNameCoins(await read(`/post/${encodeURIComponent(postId)}/coins`, signal));
}

/** A feed post's name ideas for Create, free tickers first (GET /post/:id/names). */
export async function fetchPostNames(postId: string, signal?: AbortSignal): Promise<readonly NameIdea[]> {
  return decodeNameIdeas(await read(`/post/${encodeURIComponent(postId)}/names`, signal));
}

/** The coins already using a ticker: what "Taken by 3 coins" opens (GET /ticker/:symbol/coins). */
export async function fetchTickerCoins(ticker: string, signal?: AbortSignal): Promise<SameNameCoins> {
  return decodeTickerCoins(await read(`/ticker/${encodeURIComponent(ticker)}/coins`, signal));
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

/* ── trading (services/trade) ──────────────────────────────────────────
   A separate service, at VITE_TRADE_URL or the same-origin `/api/trade`. The service itself
   refuses everything unless TRADING is on, so an app pointed at it trades nothing until then. */

const TRADE = (import.meta.env?.['VITE_TRADE_URL'] as string | undefined) || '/api/trade';

async function trade(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<{ readonly ok: boolean; readonly status: number; readonly body: Record<string, unknown> }> {
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

/** Where a coin can be traded now (its curve, its pool, nowhere, or "could not tell"), with the limits a ticket sizes against. */
export async function fetchTradeVenue(mint: string, signal?: AbortSignal): Promise<{ readonly venue: TradeVenue; readonly limits: TradeLimits | null }> {
  const r = await trade(`/venue/${encodeURIComponent(mint)}`, {}, signal);
  const kind = r.body['kind'];
  const venue: TradeVenue = r.ok && (kind === 'curve' || kind === 'pool' || kind === 'none') ? kind : 'unavailable';
  const l = typeof r.body['limits'] === 'object' && r.body['limits'] !== null ? (r.body['limits'] as Record<string, unknown>) : null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const max = typeof l?.['maxBuyLamports'] === 'string' && /^\d+$/.test(l['maxBuyLamports']) ? l['maxBuyLamports'] : null;
  const [def, top, fee] = [n(l?.['defaultSlippageBps']), n(l?.['maxSlippageBps']), n(l?.['feeBps'])];
  return { venue, limits: max !== null && def !== null && top !== null && fee !== null ? { maxBuyLamports: max, defaultSlippageBps: def, maxSlippageBps: top, feeBps: fee } : null };
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
export async function buildLaunchTx(p: { readonly wallet: string; readonly name: string; readonly symbol: string; readonly description: string; readonly imageDataUrl: string; readonly devBuyLamports: string; readonly links: { readonly twitter: string; readonly telegram: string; readonly website: string } }): Promise<{ readonly kind: 'ready'; readonly transaction: string; readonly mint: string } | { readonly kind: 'blocked'; readonly why: string }> {
  /* An empty social is left out, so the coin's metadata carries no blank link. */
  const links = Object.fromEntries(Object.entries(p.links).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''));
  const r = await trade('/launch/build', { method: 'POST', body: JSON.stringify({ ...p, links }) });
  const tx = r.body['transaction'];
  const mint = r.body['mint'];
  return r.ok && typeof tx === 'string' && typeof mint === 'string' ? { kind: 'ready', transaction: tx, mint } : { kind: 'blocked', why: said(r.body, 'The launch could not be prepared just now.') };
}

/** After the create landed: record it against its narrative, so it shows "Created on Insidor". */
/**
 * Records a landed launch. From a post, it also says which of the sheet's suggestions was kept
 * (`pick`, its place in `offered`) or null when the name was typed, so the namer learns from it.
 */
export async function confirmLaunch(p: {
  readonly wallet: string; readonly signature: string; readonly mint: string; readonly storyId: string | null;
  readonly postId?: string | null; readonly name?: string; readonly symbol?: string; readonly pick?: number | null;
  readonly offered?: readonly { readonly name: string; readonly ticker: string }[];
}): Promise<boolean> {
  const r = await trade('/launch/confirm', { method: 'POST', body: JSON.stringify(p) });
  return r.ok && r.body['recorded'] === true;
}

/** How many coins Insidor has seen with this ticker; null when it could not be read. */
export async function fetchTickerSeen(ticker: string, signal?: AbortSignal): Promise<number | null> {
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

/**
 * The one way the social and alert services are reached (shared/api/people.ts builds on it):
 * here, because this file is the only one allowed to touch the network. The sign-in token rides
 * as a bearer header and nowhere else. Replies are returned whole, with their status, for
 * people.ts to read.
 */
export async function peopleRequest(url: string, method: string, token: string | null, body?: unknown): Promise<{ readonly ok: boolean; readonly status: number; readonly json: unknown }> {
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ok: response.ok, status: response.status, json: await response.json().catch(() => ({})) };
}
