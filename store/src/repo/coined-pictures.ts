/**
 * Pictures of posts that were actually coined (0052), for the feed's picture boost.
 *
 * Separate from image-embeddings.ts because these are not posts or coins we observed: they are a
 * fixed reference set from the owner's gold sheets, written by a tool and read only by the
 * projector's query. Mixing them into internal.image_embedding would let GROUP join live posts to
 * a gold picture as if it were a post we had seen.
 *
 * What breaks if changed carelessly: the vector is stored as written. It must already be
 * normalised (the embedding adapter does it), or the projector's cosine is a different number.
 */

import type { Db } from '../client.ts';

export class PgCoinedPictureRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async known(): Promise<ReadonlySet<string>> {
    const rows = await this.#db.query<{ uri: string }>('select uri from internal.coined_picture');
    return new Set(rows.map((r) => r.uri));
  }

  async put(uri: string, coinRef: string, space: string, embedding: readonly number[]): Promise<void> {
    await this.#db.query(
      `insert into internal.coined_picture (uri, coin_ref, space, embedding) values ($1, $2, $3, $4::vector)
       on conflict (uri) do nothing`,
      [uri, coinRef, space, `[${embedding.join(',')}]`],
    );
  }
}
