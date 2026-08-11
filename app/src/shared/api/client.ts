/**
 * THE ONLY MODULE IN THE APP THAT TOUCHES THE NETWORK.
 *
 * It reads the public tables the store publishes and nothing else. There is no query builder
 * and no column list here, because a column list is how a score gets requested: the read
 * surface is a physical table with no internal column in it, so `select *` is safe and there
 * is no per-call decision to get wrong.
 *
 * Everything returned has been through `decode.ts`. Nothing in this file constructs a wire
 * object by hand.
 *
 * If the read surface later has to become authenticated, this is the file that changes and
 * the only one — about two hundred lines, by design.
 */

import { notImplemented } from '../not-implemented.ts';
import type { BoardTick } from './wire/board.ts';
import type { Story } from './wire/story.ts';
import type { TradeIntent, TradeQuote, TradeResult } from './wire/trade.ts';
import { decodeBoardTick, decodeStory, decodeTradeQuote } from './decode.ts';

/** A failure of the transport, as opposed to a failure of the payload. Callers show these differently. */
export class ReadError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`read failed: ${path} (${status})`);
    this.name = 'ReadError';
    this.status = status;
  }
}

/**
 * The read endpoint, from the build environment. Not a runtime config fetch: a board that
 * cannot start until a config request lands is a board with a slower first paint than the
 * data it shows is old.
 */
const BASE = (import.meta.env?.['VITE_READ_URL'] as string | undefined) ?? '';

async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    /* The board is never cacheable — every number is stale within a tick — so say so once
       here rather than sprinkling cache-busting query parameters through call sites. */
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new ReadError(path, response.status);
  return response.json();
}

/**
 * The authoritative board.
 *
 * Called on first paint, on every reconnect, and on any gap in the tick sequence. The live
 * channel has no replay, so a socket outage silently drops every row that changed while it
 * was down unless something refetches — which is exactly the bug in the build this replaces,
 * where reconnect cancelled the fallback poll and issued no refetch at all.
 */
export async function fetchBoard(viewId: string, signal?: AbortSignal): Promise<BoardTick> {
  return decodeBoardTick(await read(`/board/${encodeURIComponent(viewId)}`, signal));
}

export async function fetchStory(storyId: string, signal?: AbortSignal): Promise<Story> {
  return decodeStory(await read(`/story/${encodeURIComponent(storyId)}`, signal));
}

/**
 * A quote for a specific coin.
 *
 * Quotes are never cached and never reused across a render: the venue changes the moment a
 * coin graduates off its bonding curve, and the blockhash backing the quote expires in about
 * a minute. The trade panel re-requests rather than holding one.
 */
export async function fetchQuote(
  coinId: string,
  inAmountRaw: string,
  signal?: AbortSignal,
): Promise<TradeQuote> {
  const query = `?in=${encodeURIComponent(inAmountRaw)}`;
  return decodeTradeQuote(await read(`/quote/${encodeURIComponent(coinId)}${query}`, signal));
}

/**
 * Execute a trade.
 *
 * Deliberately unimplemented. This is the one path where a bug costs a user money, and it
 * needs the wallet SDK's signing flow, an idempotency key, and a confirmation poll that can
 * distinguish "submitted" from "filled". Writing a plausible-looking stub here would be
 * worse than an explicit hole, because a plausible stub gets wired to a button.
 */
export async function submitTrade(_intent: TradeIntent): Promise<TradeResult> {
  return notImplemented('submitTrade: wallet signing and confirmation polling');
}

/* ── the live channel ─────────────────────────────────────────────────── */

export interface LiveHandlers {
  readonly onTick: (raw: unknown) => void;
  readonly onPatch: (raw: unknown) => void;
  /** Fired on every (re)subscribe, so the caller can refetch authoritatively. */
  readonly onSubscribed: () => void;
  readonly onDropped: () => void;
}

export interface LiveChannel {
  close(): void;
}

/**
 * Open the live channel for one board view.
 *
 * Unimplemented on purpose: the transport is a broadcast channel over the websocket the
 * database already provides, and wiring it means picking up that client SDK. The shape is
 * fixed here first because `onSubscribed` is load-bearing — it is what forces the refetch
 * that the previous build's reconnect path skipped.
 */
export function openLiveChannel(_viewId: string, _handlers: LiveHandlers): LiveChannel {
  return notImplemented('openLiveChannel: broadcast subscription');
}
