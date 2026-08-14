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
import type { LaunchFeed } from './wire/launch.ts';
import type { Story } from './wire/story.ts';
import type { TradeIntent, TradeQuote, TradeResult } from './wire/trade.ts';
import { decodeBoardTick, decodeLaunchFeed, decodeStory, decodeTradeQuote } from './decode.ts';

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

/**
 * No endpoint configured, in a dev build: serve the sample payloads instead of failing.
 *
 * Both halves of that condition matter. `import.meta.env.DEV` is a literal the bundler
 * replaces, so in a production build this is `false && ...` and the whole branch — plus the
 * dynamic import of `fixtures.ts`, plus the fixtures themselves — is dropped from the output.
 * There is no runtime flag that can turn sample data on in front of a user.
 *
 * The payloads still go through `read`'s caller and therefore through `decode.ts`, exactly
 * like a network response. Fixtures that bypassed the decoder could hold shapes the server
 * can never send, and every screen designed against them would be designed against a wire
 * format that does not exist.
 */
const USE_FIXTURES = import.meta.env?.DEV === true && BASE === '';

/**
 * Exported so the shell can SAY it is showing sample data.
 *
 * Non-negotiable: numbers that look like measurements have to be labelled as not being
 * measurements, on screen, every second they are up. An unlabelled fixture is how a
 * screenshot of invented market caps ends up in a pitch deck.
 */
export const USING_FIXTURES = USE_FIXTURES;

async function readFixture(path: string): Promise<unknown> {
  const { fixtureBoard, fixtureLaunches, fixtureStory } = await import('./fixtures.ts');
  if (path.startsWith('/board/')) return fixtureBoard();
  /* The launches rail gets a branch rather than the 501 below, because without one the
     default dev experience — no VITE_READ_URL — would show the rail's ERROR state on every
     load, and an error state that is always on is an error state nobody reads. What comes
     back is a raw wire payload and goes through `decodeLaunchFeed` like anything off the
     network, so a fixture cannot hold a shape the server could never send. */
  if (path.startsWith('/launches/')) return fixtureLaunches();
  if (path.startsWith('/story/')) {
    const id = decodeURIComponent(path.slice('/story/'.length));
    const story = fixtureStory(id);
    /* An id the fixtures do not cover is a 404, not an invented page. Fabricating a story
       for every id would hide the fact that this endpoint does not exist yet. */
    if (story === null) throw new ReadError(path, 404);
    return story;
  }
  /* Quotes are a live-market call. There is no honest sample of one, because a stale quote
     is not a quote — so this reports missing rather than returning a plausible number. */
  throw new ReadError(path, 501);
}

async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  if (USE_FIXTURES) return readFixture(path);


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
 * One frame of the launches rail.
 *
 * Polled, because there is no live channel for it — `openLiveChannel` covers the board and
 * is unimplemented besides. The caller owns the interval and says on screen when it last
 * succeeded, so a rail that has stopped updating looks different from a market that has
 * gone quiet. `read` already sets `cache: 'no-store'`; every row here is stale within a
 * minute, so a cached one would be worse than no row.
 */
export async function fetchLaunches(feedId: string, signal?: AbortSignal): Promise<LaunchFeed> {
  return decodeLaunchFeed(await read(`/launches/${encodeURIComponent(feedId)}`, signal));
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
