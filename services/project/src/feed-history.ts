/**
 * The projector's hourly feed history (0063): after the feeds are written, the posts they show
 * are added to the hour's record, in the same transaction, so "shown per hour" can be counted.
 *
 * Its own file so the feed writer (rising.ts) stays about what is on screen now; this is one
 * call after it, and the store repo (store/src/repo/feed-history.ts) holds the SQL.
 *
 * What breaks if changed carelessly: the order. Called before the feeds are written, it would
 * record the previous frame under this frame's hour. And it must never throw into the frame's
 * transaction: a history that cannot be written is a warning, the feed still commits.
 */

import { recordFeedHistory, type Db } from '@insidor/store';

export async function keepFeedHistory(db: Db, nowMs: number): Promise<void> {
  const out = await recordFeedHistory(db, nowMs);
  if (out.kind === 'failed') console.warn(`feed history not recorded: ${out.error}`);
}
