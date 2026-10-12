/**
 * THE ONLY MODULE IN THE PHONE APP THAT TOUCHES THE NETWORK.
 *
 * It reads two routes of the read service — `GET /board/:viewId` and `GET /story/:storyId`
 * (services/read/src/routes.ts) — and nothing else. Everything it returns has been through
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
import { decodeBoardTick, decodeNarratives, decodeRisingFeed, decodeStory } from './decode.ts';
import type { BoardTick } from './wire/board.ts';
import type { RisingFeed, RisingFeedId } from './wire/rising.ts';
import type { NarrativesList, Story } from './wire/story.ts';

/** A failure of the transport, as opposed to a failure of the payload. */
export class ReadError extends Error {
  readonly status: number;
  constructor(path: string, status: number) {
    super(`read failed: ${path} (${status})`);
    this.name = 'ReadError';
    this.status = status;
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
  if (!response.ok) throw new ReadError(path, response.status);
  return response.json();
}

export async function fetchBoard(viewId: string, signal?: AbortSignal): Promise<BoardTick> {
  return decodeBoardTick(await read(`/board/${encodeURIComponent(viewId)}`, signal));
}

/** One feed of single posts: `fyp` newest first, `popular` most views first. */
export async function fetchRising(feed: RisingFeedId, signal?: AbortSignal): Promise<RisingFeed> {
  return decodeRisingFeed(await read(`/rising/${encodeURIComponent(feed)}`, signal));
}

/** The Narratives list: the board's stories as whole pages, in the board's order. */
export async function fetchNarratives(viewId: string, signal?: AbortSignal): Promise<NarrativesList> {
  return decodeNarratives(await read(`/narratives/${encodeURIComponent(viewId)}`, signal));
}

export async function fetchStory(storyId: string, signal?: AbortSignal): Promise<Story> {
  return decodeStory(await read(`/story/${encodeURIComponent(storyId)}`, signal));
}

/** One page reached from the Narratives list. Never touches the network. */
export async function loadSampleStory(storyId: string): Promise<Story> {
  if (!SAMPLE_SCREENS) return notImplemented('loadSampleStory: no read route for narratives yet');
  const { fixtureStory } = await import('./fixtures.ts');
  const raw = fixtureStory(storyId);
  if (raw === null) throw new ReadError(`/sample/story/${storyId}`, 404);
  return decodeStory(raw);
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
