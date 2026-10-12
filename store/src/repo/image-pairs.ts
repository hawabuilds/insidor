/**
 * The same-subject answers about pairs of pictures: read before asking, written after, and
 * counted for the per-day cap.
 *
 * What breaks if changed carelessly: a pair is stored in one order (`uri_a < uri_b`). Looking
 * it up in the other order would miss the stored answer and pay for the same question again.
 */

import type { Millis } from '@insidor/contracts';
import type { SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

const ordered = (a: string, b: string): readonly [string, string] => (a < b ? [a, b] : [b, a]);

export class PgImagePairRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async answer(a: string, b: string, promptId: string): Promise<SameSubjectAnswer | null> {
    const [x, y] = ordered(a, b);
    const rows = await this.#db.query<{ answer: SameSubjectAnswer }>(
      `select answer from internal.image_pair_check where uri_a = $1 and uri_b = $2 and prompt_id = $3`,
      [x, y, promptId],
    );
    return rows[0]?.answer ?? null;
  }

  async record(a: string, b: string, promptId: string, answer: SameSubjectAnswer, judgeId: string, at: Millis, costUsd: number): Promise<void> {
    const [x, y] = ordered(a, b);
    await this.#db.query(
      `insert into internal.image_pair_check (uri_a, uri_b, prompt_id, answer, judge_id, checked_at, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (uri_a, uri_b, prompt_id) do nothing`,
      [x, y, promptId, answer, judgeId, toTimestamp(at), costUsd],
    );
  }

  /** Pairs checked since an instant — the day's count for the cap. */
  async countSince(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(
      `select count(*) as n from internal.image_pair_check where checked_at >= $1`,
      [toTimestamp(at)],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
