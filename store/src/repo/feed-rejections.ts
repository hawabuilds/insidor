/**
 * What the feeds hid, and why (0049): written by the projector when a post leaves For You or
 * Popular, a narrative leaves the board, or a narrative's post is dropped from its list.
 *
 * Separate from every feed's own repo because a rejection outlives the frame that made it: the
 * rows are kept as the feed's "no" examples for tuning, long after the frame is gone.
 *
 * What breaks if changed carelessly: `record` keeps `first_rejected_at` on conflict. Overwriting
 * it would make a post hidden a week ago look hidden a minute ago on every frame.
 */

import type { Db } from '../client.ts';

export const FEED_REJECTION_REASONS = [
  'not_scored',
  'not_memeable',
  'judge_unsure',
  'name_test',
  'under_reach_bar',
  'reach_unread',
  'too_few_passing_posts',
] as const;
export type FeedRejectionReason = (typeof FEED_REJECTION_REASONS)[number];

export interface FeedRejection {
  readonly kind: 'post' | 'narrative';
  readonly id: string;
  readonly reason: FeedRejectionReason;
  readonly detail: string | null;
}

export class PgFeedRejectionRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** One statement for the batch; nothing written when there is nothing to say. */
  async record(rows: readonly FeedRejection[]): Promise<number> {
    if (rows.length === 0) return 0;
    await this.#db.query(
      `insert into public.feed_rejection (subject_kind, subject_id, reason, detail)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[])
       on conflict (subject_kind, subject_id) do update
         set reason = excluded.reason, detail = excluded.detail, rejected_at = now()`,
      [rows.map((r) => r.kind), rows.map((r) => r.id), rows.map((r) => r.reason), rows.map((r) => r.detail)],
    );
    return rows.length;
  }
}
