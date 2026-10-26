/**
 * FOR YOU COUNTS A SHARED POST'S AGE FROM THE SHARE (Policy.judge.resurface): a post an account of
 * 10M+ followers just quoted, or posted the same picture or video of, and that the judge was asked
 * about again with that share in view (the runner's work/resurface.ts, internal.resurfacing 0139).
 *
 * What this changes, and only this: the post is loaded whatever its own age while its newest share
 * is inside the frame's window; For You's six hours, its window and its order count from the share's
 * time; and the card carries `sharedBy` — who shared it, how, when, and a link to the share — so the
 * screen says why an older post is on For You with a fact, never with our reasoning. Whether it
 * passes is the post's newest answer, read and held exactly as any post's (rising.ts `postRoute`):
 * the owner's "Not a meme", held kinds, shills, the junk bar, variety and promotions all apply.
 *
 * ★ FOR YOU ONLY. A post whose own time is outside the window is on For You by its share alone and
 * never on Popular, which is "the biggest posts of the day" by their own time.
 *
 * ★ THE CARD'S POST TIME STAYS THE POST'S. `postedAt` is a fact about the post; the share's time
 * travels separately in `sharedBy.at`. Writing the share's time into `postedAt` would tell a reader
 * a 16-day-old video was posted this morning.
 *
 * Its own file because rising.ts's full frame and the quick frame both read it, and because the read
 * fails soft: before 0139 (or with the table unreadable) it returns nothing and every post is counted
 * from its own time, said once a process.
 */

import type { Db } from '@insidor/store';
import { PgResurfacingRepo, type StoredShare } from '@insidor/store';
import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { permalinkFor } from './permalinks.ts';
import type { WireInstant } from './wire.ts';

/** A share on a card: who shared the post, how, when, and a link to the share. Facts only. */
export interface WireSharedBy {
  /** The sharing post's id, for its account's face at read time (services/read quote-faces.ts). */
  readonly id: string;
  /** "@handle". */
  readonly authorLabel: string;
  /** The account's display name; null when the source gave none. */
  readonly authorName: string | null;
  /** 'quoted': a quote of this post; 'samePicture': the same picture or video under its own name. */
  readonly how: 'quoted' | 'samePicture';
  readonly at: WireInstant;
  readonly permalink: string | null;
}

let unreadSaid = false;

/**
 * The newest share of each post inside the frame's window (`rising.windowMs`), only `only`'s when
 * given; nothing while Policy.judge.resurface is off, and nothing (said once) when it cannot be read.
 */
export async function loadShares(db: Db, nowMs: number, policy: Policy, only: readonly string[] | null = null): Promise<ReadonlyMap<string, StoredShare>> {
  if (!policy.judge.resurface.on) return new Map();
  try {
    return await new PgResurfacingRepo(db).recent((nowMs - policy.rising.windowMs) as Millis, only);
  } catch (e: unknown) {
    if (!unreadSaid) console.warn(`shared posts could not be read; every post is counted from its own time until they can: ${e instanceof Error ? e.message : String(e)}`);
    unreadSaid = true;
    return new Map();
  }
}

/**
 * The time For You counts a post from: its share's when it has one later than its own time, else
 * its own (its first sight when the source gave none).
 */
export function forYouTime(ownMs: number, share: Pick<StoredShare, 'sharedAtMs'> | undefined): number {
  return share !== undefined && share.sharedAtMs > ownMs ? share.sharedAtMs : ownMs;
}

/** The card's share field; null when we hold no handle to name the account by (no face, no link: nothing to show). */
export function projectShare(share: StoredShare): WireSharedBy | null {
  const handle = (share.handle ?? '').trim().replace(/^@/, '');
  if (handle === '') return null;
  const name = (share.displayName ?? '').trim();
  return {
    id: share.byItemId,
    authorLabel: `@${handle}`,
    authorName: name === '' ? null : name,
    how: share.how,
    at: Number.isFinite(share.sharedAtMs) ? { at: share.sharedAtMs } : { at: null, why: 'not_reported' },
    permalink: permalinkFor(share.source, handle, share.sourceItemId),
  };
}
