/**
 * Image vectors: written once per image, read as "how alike is this post's picture to each
 * candidate story's pictures".
 *
 * Its own repository because it is the one read here that is a vector comparison, and that
 * comparison has one rule worth keeping in one place: only vectors of the SAME space meet.
 *
 * What breaks if changed carelessly: similarity is `1 − cosine distance` on vectors that were
 * normalised when written. Comparing across spaces, or against an unnormalised row, would
 * hand GROUP a number its bars were never set against.
 */

import type { Millis } from '@insidor/contracts';
import type { ItemId, StoryId } from '@insidor/contracts/ids.ts';

import type { Db } from '../client.ts';
import { toTimestamp } from '../rows.ts';

/** The best match between a post's picture and one story's pictures. */
export interface ImageMatch {
  readonly similarity: number;
  readonly space: string;
  /** The post's own image, and the story member's image it matched — the pair a confirm would show. */
  readonly itemUri: string;
  readonly memberUri: string;
}

/** A post whose first image has no vector in this space yet. */
export interface UnembeddedImage {
  readonly itemId: ItemId;
  readonly uri: string;
  /** In a promoted story, or fetched by a story's backfill: GROUP reads its picture. */
  readonly inNarrative: boolean;
  /** The judge's newest answer about the post; null when it has none yet. */
  readonly judgement: {
    readonly coinable: boolean;
    readonly confidence: number;
    readonly lookedAt: 'text' | 'picture' | 'videoFrame';
    readonly proposedName: string | null;
  } | null;
}

const toVectorLiteral = (values: Float32Array): string => `[${Array.from(values).join(',')}]`;

export class PgImageEmbeddingRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Observed posts seen since `sinceMs` whose FIRST image has no vector in `space`, newest
   * first, with what decides whether the picture is worth paying for. The first image only: it
   * is the picture a post is shown with, and embedding every image of every post would spend
   * the line on the third photo of a carousel.
   *
   * Only posts that might use a vector come back (the runner's embed-images.ts holds the rest
   * to core's per-post rule):
   *   - a post the judge has answered, unless the answer is a firm "no" — confidence above
   *     `firmNoAbove`, the picture boost's own ceiling, so no picture can ever lift it;
   *   - a member of a promoted, unmerged story, or a post a story's backfill fetched: GROUP
   *     compares a post joining a narrative with these pictures, judged or not.
   * A post not judged yet waits: the scorer runs before this step in every pass, so a post is
   * embedded in the pass that judges it.
   */
  async unembedded(space: string, sinceMs: Millis, limit: number, firmNoAbove: number): Promise<readonly UnembeddedImage[]> {
    const rows = await this.#db.query<{
      item_id: string;
      uri: string;
      in_narrative: boolean;
      coinable: boolean | null;
      confidence: number | null;
      looked_at: 'text' | 'picture' | 'videoFrame' | null;
      proposed_name: string | null;
    }>(
      `select i.item_id, first_image.uri, j.coinable, j.confidence, j.looked_at, j.proposed_name,
              (exists (select 1 from public.story_member m
                         join public.story s on s.story_id = m.story_id
                        where m.item_id = i.item_id and s.state = 'promoted' and s.merged_into is null)
               or exists (select 1 from internal.item_backfill b where b.item_id = i.item_id)) as in_narrative
         from public.item i
         cross join lateral (
           select m ->> 'uri' as uri
             from jsonb_array_elements(i.media) with ordinality as t(m, n)
            where m ->> 'kind' = 'image' and coalesce(m ->> 'uri', '') <> ''
            order by n
            limit 1
         ) first_image
         left join lateral (
           select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name
             from internal.post_judgement pj
            where pj.item_id = i.item_id
            order by pj.judged_at desc, pj.id desc
            limit 1
         ) j on true
        where i.origin = 'observed'
          and i.first_seen_at >= $2
          and not exists (
                select 1 from internal.image_embedding e
                 where e.subject_kind = 'item' and e.subject_id = i.item_id
                   and e.uri = first_image.uri and e.space = $1)
          and ((j.coinable is not null and not (j.coinable = false and j.confidence > $4))
               or exists (select 1 from public.story_member m
                            join public.story s on s.story_id = m.story_id
                           where m.item_id = i.item_id and s.state = 'promoted' and s.merged_into is null)
               or exists (select 1 from internal.item_backfill b where b.item_id = i.item_id))
        order by i.first_seen_at desc
        limit $3`,
      [space, toTimestamp(sinceMs), limit, firmNoAbove],
    );
    return rows.map((row) => ({
      itemId: row.item_id as ItemId,
      uri: row.uri,
      inNarrative: row.in_narrative,
      judgement:
        row.coinable === null || row.confidence === null || row.looked_at === null
          ? null
          : { coinable: row.coinable, confidence: Number(row.confidence), lookedAt: row.looked_at, proposedName: row.proposed_name },
    }));
  }

  async record(subjectKind: 'item' | 'asset', subjectId: string, uri: string, space: string, values: Float32Array, at: Millis): Promise<void> {
    await this.#db.query(
      `insert into internal.image_embedding (subject_kind, subject_id, uri, space, embedding, embedded_at)
       values ($1, $2, $3, $4, $5::vector, $6)
       on conflict (subject_kind, subject_id, uri, space) do nothing`,
      [subjectKind, subjectId, uri, space, toVectorLiteral(values), toTimestamp(at)],
    );
  }

  /** Whether this subject already has a vector for this picture in this space. */
  async has(subjectKind: 'item' | 'asset', subjectId: string, uri: string, space: string): Promise<boolean> {
    const rows = await this.#db.query<{ n: number }>(
      `select 1 as n from internal.image_embedding where subject_kind = $1 and subject_id = $2 and uri = $3 and space = $4`,
      [subjectKind, subjectId, uri, space],
    );
    return rows.length > 0;
  }

  /**
   * A coin's picture against each of these posts' pictures, in one space. A post with no
   * vector is absent — not compared, never zero.
   */
  async coinSimilarity(assetKey: string, itemIds: readonly ItemId[], space: string): Promise<ReadonlyMap<ItemId, { readonly similarity: number; readonly coinUri: string; readonly postUri: string }>> {
    const found = new Map<ItemId, { similarity: number; coinUri: string; postUri: string }>();
    if (itemIds.length === 0) return found;
    const rows = await this.#db.query<{ item_id: string; similarity: number; coin_uri: string; post_uri: string }>(
      `select distinct on (b.subject_id)
              b.subject_id as item_id, 1 - (a.embedding <=> b.embedding) as similarity, a.uri as coin_uri, b.uri as post_uri
         from internal.image_embedding a
         join internal.image_embedding b on b.subject_kind = 'item' and b.space = a.space
        where a.subject_kind = 'asset' and a.subject_id = $1 and a.space = $3
          and b.subject_id = any($2::text[])
        order by b.subject_id, similarity desc`,
      [assetKey, [...itemIds], space],
    );
    for (const row of rows) found.set(row.item_id as ItemId, { similarity: Number(row.similarity), coinUri: row.coin_uri, postUri: row.post_uri });
    return found;
  }

  /**
   * For one post, its best image similarity against each candidate story's member images,
   * in one space. A story whose posts have no vectors is absent — not compared, never zero.
   */
  async bestMatches(itemId: ItemId, storyIds: readonly StoryId[], space: string): Promise<ReadonlyMap<StoryId, ImageMatch>> {
    const found = new Map<StoryId, ImageMatch>();
    if (storyIds.length === 0) return found;
    const rows = await this.#db.query<{ story_id: string; similarity: number; item_uri: string; member_uri: string }>(
      `select distinct on (m.story_id)
              m.story_id, 1 - (a.embedding <=> b.embedding) as similarity, a.uri as item_uri, b.uri as member_uri
         from internal.image_embedding a
         join internal.image_embedding b
           on b.subject_kind = 'item' and b.space = a.space and b.subject_id <> a.subject_id
         join public.story_member m on m.item_id = b.subject_id
        where a.subject_kind = 'item' and a.subject_id = $1 and a.space = $3
          and m.story_id = any($2::text[])
        order by m.story_id, similarity desc`,
      [itemId, [...storyIds], space],
    );
    for (const row of rows) {
      found.set(row.story_id as StoryId, {
        similarity: Number(row.similarity),
        space,
        itemUri: row.item_uri,
        memberUri: row.member_uri,
      });
    }
    return found;
  }
}
