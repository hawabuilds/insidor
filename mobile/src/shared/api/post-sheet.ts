/**
 * ONE FEED POST AS ITS POST SHEET SHOWS IT (services/read/src/post-sheet.ts, `GET /post/:id/sheet`):
 * the post itself, who posted it, when we found it, its media, its narrative, the sheet's own
 * facts (view readings, views a minute, $tickers in replies) and every coin with its name.
 *
 * Its own file beside decode.ts, the way about.ts and missed.ts sit beside it: the shape and its
 * decoder together, run through the same censor first (`assertNoInternalVocabulary`), and the post
 * inside it through the feed's own decoder, so the sheet and the card can never read one post two
 * ways.
 *
 * ★ AN ABSENT NUMBER IS PENDING WITH ITS REASON, never zero. ★ A LINK IS https OR IT IS DROPPED:
 * a picture or a video file that is not https never reaches an element. ★ A COIN'S `bonded` IS
 * NULL WHEN NO MARKET LISTS IT: neither "bonded" nor "not bonded" is said then.
 */

import { instant, known, pending, pendingInstant, type Instant, type Measured, type PendingReason } from '../format/measure.ts';
import { assertNoInternalVocabulary, decodeRisingPost, WireShapeError } from './decode.ts';
import { postPicFile } from '../post-pic.ts';
import { posterPicFile } from '../poster-pic.ts';
import type { RisingPost } from './wire/rising.ts';

/** One view reading: null when the source rounded it away (censored), which breaks the chart's line. */
export interface ViewReading {
  readonly atMs: number;
  readonly value: number | null;
}

export interface SheetMedia {
  readonly kind: 'video' | 'image';
  /** The picture, or the video's still. */
  readonly posterUrl: string;
  /** Our storage's copy of it, by file name (the sheet's size is loaded first); null when there is none yet. */
  readonly posterFile: string | null;
  /** The video's own file, when the source serves one that plays in the app; null otherwise. */
  readonly playUrl: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
}

export type LaunchClock = { readonly kind: 'chain' } | { readonly kind: 'within'; readonly withinS: number } | { readonly kind: 'unknown' };

export interface SheetCoin {
  readonly coinId: string;
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  readonly launchedAt: Instant;
  /**
   * Whose clock `launchedAt` is (services/read post-sheet.ts `launchClock`): the chain's own time,
   * a live notice that bounds it to `withinS` seconds either side, or not known. Screens print a
   * launch to the minute only from the first two.
   */
  readonly launchClock: LaunchClock;
  readonly marketCapUsd: Measured;
  /** The price's move over the last day, in percent (12 is up 12%). */
  readonly changePct24h: Measured;
  readonly bonded: boolean | null;
  /** The post's own coin, settled by evidence or named by its narrative. */
  readonly proven: boolean;
}

export interface PostSheetData {
  readonly post: RisingPost;
  readonly author: { readonly name: string | null; readonly pictureUrl: string | null; readonly pictureFile: string | null; readonly followers: Measured };
  readonly foundAt: Instant;
  readonly media: SheetMedia | null;
  /** The narrative the post is in, with how many posts its page lists (null from an older server). */
  readonly narrative: { readonly storyId: string; readonly title: string | null; readonly posts: number | null } | null;
  /** The "Part of a story" card: only for a narrative the board lists now, with its picture. Null otherwise. */
  readonly storyCard: { readonly storyId: string; readonly title: string | null; readonly posts: number | null; readonly thumbUrl: string | null; readonly thumbFile: string | null } | null;
  /** The name the coins share, for "Top Goliath coin by MC" and "Goliath coins". */
  readonly coinName: string | null;
  readonly sourcesMissing: number;
  /** Highest market cap first; a coin with no cap after every coin with one. */
  readonly coins: readonly SheetCoin[];
  readonly views: readonly ViewReading[];
  readonly perMinute: Measured;
  readonly tickersInReplies: Measured;
}

const REASONS: readonly PendingReason[] = ['not_minted', 'no_market', 'not_read_yet', 'not_reported', 'unreadable'];

const rec = (v: unknown, path: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WireShapeError(path, v);
  return v as Record<string, unknown>;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const reason = (v: unknown): PendingReason => REASONS.find((r) => r === v) ?? 'unreadable';
const https = (v: unknown): string | null => {
  const s = text(v);
  if (s === null) return null;
  try {
    return new URL(s).protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
};

function measuredOf(v: unknown): Measured {
  if (typeof v !== 'object' || v === null) return pending('not_reported');
  const o = v as Record<string, unknown>;
  return typeof o['v'] === 'number' ? known(o['v']) : pending(reason(o['why']));
}

function instantOf(v: unknown): Instant {
  if (typeof v !== 'object' || v === null) return pendingInstant('not_reported');
  const o = v as Record<string, unknown>;
  return typeof o['at'] === 'number' ? instant(o['at']) : pendingInstant(reason(o['why']));
}

function mediaOf(v: unknown): SheetMedia | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const posterUrl = https(o['posterUrl']);
  if (posterUrl === null) return null;
  return {
    kind: o['kind'] === 'video' ? 'video' : 'image',
    posterUrl,
    posterFile: postPicFile(o['posterFile']),
    playUrl: https(o['playUrl']),
    width: num(o['width']),
    height: num(o['height']),
    durationMs: num(o['durationMs']),
  };
}

/** An older server sends no clock: not known, so no launch is printed as the chain's. */
function launchClockOf(v: unknown): LaunchClock {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  if (o['kind'] === 'chain') return { kind: 'chain' };
  if (o['kind'] === 'within' && typeof o['withinS'] === 'number' && Number.isFinite(o['withinS']) && o['withinS'] >= 0) return { kind: 'within', withinS: o['withinS'] };
  return { kind: 'unknown' };
}

export function coinOf(v: unknown): SheetCoin | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const address = text(o['address']);
  const coinId = text(o['coinId']);
  if (address === null || coinId === null) return null;
  return {
    coinId,
    address,
    name: text(o['name']),
    ticker: text(o['ticker']),
    imageUrl: https(o['imageUrl']),
    launchedAt: instantOf(o['launchedAt']),
    launchClock: launchClockOf(o['launchClock']),
    marketCapUsd: measuredOf(o['marketCapUsd']),
    changePct24h: measuredOf(o['changePct24h']),
    bonded: typeof o['bonded'] === 'boolean' ? o['bonded'] : null,
    proven: o['proven'] === true,
  };
}

export function decodePostSheet(raw: unknown, path = '$'): PostSheetData {
  assertNoInternalVocabulary(raw, path);
  const o = rec(raw, path);
  const post = decodeRisingPost(o['post'], `${path}.post`);
  const sheet = typeof o['post'] === 'object' && o['post'] !== null ? (o['post'] as Record<string, unknown>)['sheet'] : undefined;
  const s = typeof sheet === 'object' && sheet !== null ? (sheet as Record<string, unknown>) : null;
  const author = typeof o['author'] === 'object' && o['author'] !== null ? (o['author'] as Record<string, unknown>) : {};
  /* `story` on the wire: the word the screen uses is not a key the censor lets through. */
  const narrative = typeof o['story'] === 'object' && o['story'] !== null ? (o['story'] as Record<string, unknown>) : null;
  const storyId = text(narrative?.['storyId']);
  const views = (Array.isArray(s?.['views']) ? (s['views'] as unknown[]) : []).flatMap((p): ViewReading[] => {
    if (typeof p !== 'object' || p === null) return [];
    const q = p as Record<string, unknown>;
    const atMs = num(q['atMs']);
    return atMs === null ? [] : [{ atMs, value: num(q['value']) }];
  });
  return {
    post,
    author: { name: text(author['name']), pictureUrl: https(author['pictureUrl']), pictureFile: posterPicFile(author['pictureFile']), followers: measuredOf(author['followers']) },
    foundAt: instantOf(o['foundAt']),
    media: mediaOf(o['media']),
    narrative: storyId === null ? null : { storyId, title: text(narrative?.['title']), posts: num(narrative?.['posts']) },
    storyCard: (() => {
      const c = typeof o['storyCard'] === 'object' && o['storyCard'] !== null ? (o['storyCard'] as Record<string, unknown>) : null;
      const id = text(c?.['storyId']);
      return id === null ? null : { storyId: id, title: text(c?.['title']), posts: num(c?.['posts']), thumbUrl: https(c?.['thumbUrl']), thumbFile: postPicFile(c?.['thumbFile']) };
    })(),
    coinName: text(o['coinName']),
    sourcesMissing: num(o['sourcesMissing']) ?? 0,
    coins: (Array.isArray(o['coins']) ? o['coins'] : []).flatMap((c) => coinOf(c) ?? []),
    views: views.sort((a, b) => a.atMs - b.atMs),
    /* Absent on a row projected before the sheet's facts existed: not read, never zero. */
    perMinute: s === null ? pending('not_read_yet') : num(s['perMinute']) === null ? pending('not_read_yet') : known(num(s['perMinute']) ?? 0),
    tickersInReplies: s === null ? pending('not_read_yet') : num(s['tickersInReplies']) === null ? pending('not_read_yet') : known(num(s['tickersInReplies']) ?? 0),
  };
}
