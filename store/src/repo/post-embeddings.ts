/**
 * Each judged post's words-and-picture vector (0074), kept from the runner's precedents so the
 * projector can match a feed post to a story the owner confirmed a coin for.
 *
 * Its own repository, apart from label-embeddings.ts, because these posts carry no label: a vector
 * here says what a post is about and nothing about whether it is a meme. Mixing them into the
 * label table would put unlabelled posts in front of the judge as precedent.
 *
 * ★ BEFORE 0074 NOTHING IS KEPT AND NOTHING FAILS. `putMany` answers false on a missing table and
 * the runner judges exactly as before; the projector reads no vectors and shows no story coins.
 *
 * What breaks if changed carelessly: the vector is written as the adapter returned it — already
 * unit length — so the projector's cosine is the precedents' cosine and the measured bar holds.
 */

import type { Db } from '../client.ts';

const UNDEFINED_TABLE = '42P01';
const missingTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === UNDEFINED_TABLE;

export class PgPostEmbeddingRepo {
  readonly #db: Db;
  constructor(db: Db) {
    this.#db = db;
  }

  /** Writes (or replaces) these posts' vectors in one statement. False before 0074. */
  async putMany(rows: readonly { readonly itemId: string; readonly values: ArrayLike<number> }[], space: string): Promise<boolean> {
    /* One row per post: a statement may not update the same row twice. */
    const one = [...new Map(rows.map((r) => [r.itemId, r] as const)).values()];
    if (one.length === 0) return true;
    try {
      await this.#db.query(
        `insert into internal.post_embedding (item_id, space, embedding)
         select u.item_id, $2, u.v::vector from unnest($1::text[], $3::text[]) as u(item_id, v)
         on conflict (item_id, space) do update set embedding = excluded.embedding, embedded_at = now()`,
        [one.map((r) => r.itemId), space, one.map((r) => `[${Array.from(r.values).join(',')}]`)],
      );
      return true;
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
  }
}
