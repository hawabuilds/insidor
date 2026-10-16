/**
 * A NARRATIVE'S POSTS AND COINS, AS ITS PAGE SHOWS THEM (services/read/src/story-sheet.ts,
 * `GET /story/:id/sheet`): each post the page lists, with the feed's own card for it when a feed
 * holds it, its view readings and when it went up; and the narrative's coins, its own coin first.
 *
 * Its own file beside post-sheet.ts, as about.ts and missed.ts sit beside decode.ts: the shape and its
 * decoder together, run through the censor first, each card through the feed's own decoder and each
 * coin through the post sheet's, so a post and a coin read the same here as on For You and the sheet.
 *
 * ★ A POST WITH NO READINGS STAYS IN THE LIST. Its `views` is empty and its total is unknown; the
 * page's chart says so (features/narrative/story-views.ts). Dropping it here would make a total that
 * misses it look whole. ★ A CARD THAT DOES NOT DECODE IS DROPPED, NOT THE POST: the post keeps its
 * place and its readings, and the page shows it from the narrative's own listing.
 */

import { instant, pendingInstant, type Instant } from '../format/measure.ts';
import { assertNoInternalVocabulary, decodeRisingPost, WireShapeError } from './decode.ts';
import { coinOf, type SheetCoin, type ViewReading } from './post-sheet.ts';
import type { RisingPost } from './wire/rising.ts';

export interface StoryMember {
  /** The post's id, as the narrative's listing and the feed both name it. */
  readonly id: string;
  readonly postedAt: Instant;
  /** The feed's card for the post; null when no feed holds it. */
  readonly post: RisingPost | null;
  readonly views: readonly ViewReading[];
}

export interface StorySheet {
  /** When we found the narrative (first grouped): the chart's Found marker. */
  readonly foundAt: Instant;
  readonly members: readonly StoryMember[];
  /** The page lists more posts than the sheet carries. */
  readonly more: boolean;
  /** The narrative's own coin first (`proven`), then the others by market cap. */
  readonly coins: readonly SheetCoin[];
  /** A market source could not be read: caps are dashes with that reason. */
  readonly sourcesMissing: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function decodeStorySheet(raw: unknown, path = '$'): StorySheet {
  assertNoInternalVocabulary(raw, path);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new WireShapeError(path, raw);
  const o = raw as Record<string, unknown>;
  const members = (Array.isArray(o['members']) ? o['members'] : []).flatMap((m, i): StoryMember[] => {
    if (typeof m !== 'object' || m === null) return [];
    const r = m as Record<string, unknown>;
    const id = typeof r['itemId'] === 'string' && r['itemId'] !== '' ? r['itemId'] : null;
    if (id === null) return [];
    const at = typeof r['postedAt'] === 'object' && r['postedAt'] !== null ? num((r['postedAt'] as Record<string, unknown>)['at']) : null;
    let post: RisingPost | null = null;
    try {
      post = r['post'] === null || r['post'] === undefined ? null : decodeRisingPost(r['post'], `${path}.members[${i}].post`);
    } catch {
      post = null;
    }
    const views = (Array.isArray(r['views']) ? r['views'] : []).flatMap((p): ViewReading[] => {
      if (typeof p !== 'object' || p === null) return [];
      const q = p as Record<string, unknown>;
      const atMs = num(q['atMs']);
      return atMs === null ? [] : [{ atMs, value: num(q['value']) }];
    });
    return [{ id, postedAt: at === null ? pendingInstant('not_reported') : instant(at), post, views: views.sort((a, b) => a.atMs - b.atMs) }];
  });
  return {
    foundAt: (() => {
      const f = typeof o['foundAt'] === 'object' && o['foundAt'] !== null ? num((o['foundAt'] as Record<string, unknown>)['at']) : null;
      return f === null ? pendingInstant('not_reported') : instant(f);
    })(),
    members,
    more: o['more'] === true,
    coins: (Array.isArray(o['coins']) ? o['coins'] : []).flatMap((c) => coinOf(c) ?? []),
    sourcesMissing: num(o['sourcesMissing']) ?? 0,
  };
}
