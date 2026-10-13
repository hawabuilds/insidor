/**
 * What each feed showed per hour (0063): copied from the frame the projector just wrote to
 * public.rising_row, so the hour's set survives the next frame replacing it.
 *
 * Separate from the feed's own writer (services/project/src/rising.ts) because the frame is
 * "now" and this is "then": the frame is replaced every run, this is only ever added to and
 * pruned by age.
 *
 * ★ A MISSING TABLE IS SKIPPED, NOT AN ERROR. It runs inside the projector's one transaction,
 * where any failed statement aborts the whole frame. So it first asks whether 0063 is applied,
 * and works inside a savepoint: a failure here rolls back only the history, never the feed.
 *
 * What breaks if changed carelessly: the conflict rule. Overwriting `first_seen_at` or
 * `first_position` on every frame would make each hour look as if every post arrived in its
 * last minute.
 */

import type { Db } from '../client.ts';

/** How long an hour's rows are kept. See 0063's header. */
export const FEED_HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export type FeedHistoryOutcome = { readonly kind: 'recorded'; readonly rows: number } | { readonly kind: 'not_migrated' } | { readonly kind: 'failed'; readonly error: string };

export async function recordFeedHistory(db: Db, nowMs: number, retentionMs: number = FEED_HISTORY_RETENTION_MS): Promise<FeedHistoryOutcome> {
  const exists = await db.query<{ t: string | null }>(`select to_regclass('internal.feed_history')::text as t`);
  if ((exists[0]?.t ?? null) === null) return { kind: 'not_migrated' };
  await db.query('savepoint feed_history');
  try {
    const now = new Date(nowMs).toISOString();
    const rows = await db.query<{ n: string }>(
      `with ins as (
         insert into internal.feed_history (hour, feed_id, item_id, first_position, best_position, first_seen_at)
         select date_trunc('hour', $1::timestamptz), r.feed_id, r.item_id, r.position, r.position, $1::timestamptz
           from public.rising_row r
         on conflict (hour, feed_id, item_id) do update
            set best_position = excluded.best_position
          where internal.feed_history.best_position > excluded.best_position
         returning 1)
       select count(*)::text as n from ins`,
      [now],
    );
    await db.query(`delete from internal.feed_history where hour < $1::timestamptz`, [new Date(nowMs - retentionMs).toISOString()]);
    await db.query('release savepoint feed_history');
    return { kind: 'recorded', rows: Number(rows[0]?.n ?? 0) };
  } catch (e) {
    await db.query('rollback to savepoint feed_history');
    return { kind: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' };
  }
}
