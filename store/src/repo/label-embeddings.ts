/**
 * The owner's labelled posts with their vectors (0069): what the feed's judge is shown as
 * precedent, and what the not-a-meme hold compares against (Policy.judge.precedents).
 *
 * Separate from image-embeddings.ts and coined-pictures.ts because these vectors are of a post's
 * words AND picture together, in a space of their own, and each row carries the owner's label —
 * a picture-only bar or a GROUP join must never read them.
 *
 * ★ ONE LABEL PER POST, THE STRONGEST SOURCE WINS (`mergeLabels`, LABEL_RANK): the owner's newest
 * tap over gold over a coined post over a missed post over the hand-labelled file. The same rank
 * decides here and in tools/label-embeddings.ts, so the runner's refresh never undoes the tool.
 *
 * ★ NOT YET MIGRATED IS EMPTY, NOT AN ERROR. Before 0069 is applied every read is empty and every
 * write is skipped: the judge is asked with no precedents and nothing is held, as before.
 *
 * What breaks if changed carelessly: the vector is stored as written and must already be unit
 * length (the embedding adapter does it); the similarity read from it is a dot product.
 */

import type { Db } from '../client.ts';
import { CURRENT_COIN_CALLS } from './owner-coin-calls.ts';

/** Where a label came from, weakest first in LABEL_RANK. */
export type LabelKind = 'tap' | 'gold' | 'coined' | 'missed' | 'labels';
export const LABEL_RANK: Readonly<Record<LabelKind, number>> = { labels: 1, missed: 2, coined: 3, gold: 4, tap: 5 };

/** One labelled post as its source says it. `media` is the stored post's media, when held. */
export interface LabelledPost {
  readonly itemId: string;
  readonly label: 'meme' | 'not';
  readonly kind: LabelKind;
  readonly text: string;
  readonly why: string | null;
  /** The picture to embed with the words, when the source names one directly. */
  readonly picture: string | null;
  readonly media?: unknown;
}

export interface StoredLabel {
  readonly itemId: string;
  readonly label: 'meme' | 'not';
  readonly kind: LabelKind;
  readonly text: string;
  readonly why: string | null;
  readonly picture: string | null;
  readonly values: Float32Array;
}

/** One label per post: the highest LABEL_RANK; between equals, the later in the list. */
export function mergeLabels(posts: readonly LabelledPost[]): readonly LabelledPost[] {
  const out = new Map<string, LabelledPost>();
  for (const p of posts) {
    const have = out.get(p.itemId);
    if (have === undefined || LABEL_RANK[p.kind] >= LABEL_RANK[have.kind]) out.set(p.itemId, p);
  }
  return [...out.values()];
}

const UNDEFINED_TABLE = '42P01';
const missingTable = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === UNDEFINED_TABLE;

/** pgvector's text form, `[0.1,0.2,…]`, as numbers. */
const parseVector = (v: unknown): Float32Array => {
  if (Array.isArray(v)) return Float32Array.from(v as number[]);
  const s = String(v ?? '').replace(/^\[|\]$/g, '');
  return s === '' ? new Float32Array() : Float32Array.from(s.split(',').map(Number));
};

export class PgLabelEmbeddingRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Every labelled post in `space`; empty before 0069. */
  async all(space: string): Promise<readonly StoredLabel[]> {
    try {
      const rows = await this.#db.query<{ item_id: string; label: 'meme' | 'not'; label_kind: LabelKind; text: string; why: string | null; picture: string | null; embedding: unknown }>(
        'select item_id, label, label_kind, text, why, picture, embedding::text as embedding from internal.label_embedding where space = $1',
        [space],
      );
      return rows.map((r) => ({ itemId: r.item_id, label: r.label, kind: r.label_kind, text: r.text, why: r.why, picture: r.picture, values: parseVector(r.embedding) }));
    } catch (e) {
      if (missingTable(e)) return [];
      throw e;
    }
  }

  /** What changes whenever a row is written or relabelled: read before `all` to skip an unchanged read. '' before 0069. */
  async version(space: string): Promise<string> {
    try {
      const rows = await this.#db.query<{ n: string; at: Date | null }>('select count(*)::text as n, max(updated_at) as at from internal.label_embedding where space = $1', [space]);
      const r = rows[0];
      return r === undefined ? '' : `${r.n}|${r.at === null ? '' : new Date(r.at).toISOString()}`;
    } catch (e) {
      if (missingTable(e)) return '';
      throw e;
    }
  }

  /** Writes (or replaces) one post's label and vector. False before 0069. */
  async put(post: Omit<StoredLabel, 'values'>, space: string, values: ArrayLike<number>): Promise<boolean> {
    try {
      await this.#db.query(
        `insert into internal.label_embedding (item_id, space, label, label_kind, text, why, picture, embedding)
         values ($1, $2, $3, $4, $5, $6, $7, $8::vector)
         on conflict (item_id, space) do update set label = excluded.label, label_kind = excluded.label_kind, text = excluded.text,
           why = excluded.why, picture = excluded.picture, embedding = excluded.embedding, updated_at = now()`,
        [post.itemId, space, post.label, post.kind, post.text, post.why, post.picture, `[${Array.from(values).join(',')}]`],
      );
      return true;
    } catch (e) {
      if (missingTable(e)) return false;
      throw e;
    }
  }

  /** A post's label changed and its words did not: the label alone, no new vector. */
  async relabel(itemId: string, space: string, label: 'meme' | 'not', kind: LabelKind, why: string | null): Promise<void> {
    try {
      await this.#db.query(
        'update internal.label_embedding set label = $3, label_kind = $4, why = $5, updated_at = now() where item_id = $1 and space = $2',
        [itemId, space, label, kind, why],
      );
    } catch (e) {
      if (!missingTable(e)) throw e;
    }
  }

  /**
   * The labels the database holds: the owner's newest tap on each post, "this is the coin" on a
   * post, gold additions, and missed posts that were read. Each with the stored post's words and
   * media when we hold it (a tap falls back to the card the owner saw).
   */
  async fromDatabase(): Promise<readonly LabelledPost[]> {
    const soft = async <T>(read: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await read();
      } catch (e) {
        if (missingTable(e)) return [];
        throw e;
      }
    };
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
    const taps = await soft(() =>
      this.#db.query<{ item_id: string; verdict: 'meme' | 'not'; note: string | null; body: string | null; media: unknown; shown: Record<string, unknown> | null }>(
        `select f.item_id, f.verdict, f.note, i.body, i.media, f.shown
           from (select distinct on (item_id) item_id, verdict, note, shown
                   from internal.owner_feedback where subject_kind = 'post' and verdict in ('meme', 'not')
                  order by item_id, created_at desc, id desc) f
           left join public.item i on i.item_id = f.item_id`,
      ),
    );
    const coins = await soft(() =>
      this.#db.query<{ item_id: string; body: string | null; media: unknown }>(
        `select f.item_id, i.body, i.media
           from (${CURRENT_COIN_CALLS}) f
           join public.item i on i.item_id = f.item_id
          where f.verdict = 'right' and f.coin_address is not null`,
      ),
    );
    const gold = await soft(() =>
      this.#db.query<{ item_id: string; source: string; post_text: string; image_uri: string | null; coin_name: string | null }>(
        'select item_id, source, post_text, image_uri, coin_name from internal.gold_addition',
      ),
    );
    const missed = await soft(() =>
      this.#db.query<{ item_id: string; body: string; media: unknown }>(
        `select m.item_id, i.body, i.media from internal.missed_post m join public.item i on i.item_id = m.item_id where m.status = 'done'`,
      ),
    );
    return mergeLabels([
      ...missed.map((m): LabelledPost => ({ itemId: m.item_id, label: 'meme', kind: 'missed', text: m.body ?? '', why: 'a post the owner says we missed: people coined or could coin it', picture: null, media: m.media })),
      ...gold.map((g): LabelledPost => ({ itemId: g.item_id, label: 'meme', kind: 'coined', text: g.post_text, why: g.coin_name === null ? 'people made a coin of it' : `people made a coin of it (${g.coin_name})`, picture: g.image_uri })),
      ...coins.map((c): LabelledPost => ({ itemId: c.item_id, label: 'meme', kind: 'coined', text: c.body ?? '', why: 'the owner confirmed the coin made of it', picture: null, media: c.media })),
      ...taps.map((t): LabelledPost => {
        const shown = t.shown ?? null;
        return {
          itemId: t.item_id,
          label: t.verdict,
          kind: 'tap',
          text: t.body ?? str(shown?.['text']) ?? str(shown?.['body']) ?? '',
          why: t.note ?? (t.verdict === 'meme' ? "the owner's call: people could coin this" : "the owner's call: nothing to coin"),
          picture: t.media === null || t.media === undefined ? (str(shown?.['imageUri']) ?? str(shown?.['picture'])) : null,
          media: t.media,
        };
      }),
    ]);
  }
}
