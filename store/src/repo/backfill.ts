/**
 * The backfill's two records: which posts were fetched because of a story, and when each
 * story was last backfilled.
 *
 * Separate from the item and story repos because both tables are about why WE fetched
 * something, not about the post or the story — the projector never reads them for display,
 * and GROUP reads only `ofItems`.
 *
 * What breaks if changed carelessly: `due` is what keeps a story from being backfilled
 * twice. It returns a promoted story only when it has never been backfilled or has more
 * members now than at its last backfill; loosen that and every pass pays again for the
 * same quotes.
 */

import type { ItemId, Millis, StoryId } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { reBrand, toMillisRequired, toTimestamp } from '../rows.ts';

export type BackfillVia = 'quote' | 'search';

export interface BackfilledPost {
  readonly storyId: StoryId;
  readonly via: BackfillVia;
  /** The post that quoted this one; null when that post has since been deleted. */
  readonly reachedFrom: ItemId | null;
}

export interface BackfillRun {
  readonly storyId: StoryId;
  readonly at: Millis;
  readonly membersAt: number;
  readonly quotedPosts: number;
  /** What was searched for, and how many posts came back — or, with no search, why not. */
  readonly search:
    | { readonly name: string; readonly returned: number }
    | { readonly name: null; readonly note: 'no_name' | 'not_supported' };
  readonly costUsd: number;
}

export class PgBackfillRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Promoted stories never backfilled, or with members added since — oldest promotion first. */
  async due(limit: number): Promise<readonly StoryId[]> {
    const rows = await this.#db.query<{ story_id: string }>(
      `select s.story_id
         from public.story s
         left join internal.story_backfill b using (story_id)
        where s.state = 'promoted'
          and (b.story_id is null or s.member_count > b.members_at)
        order by s.promoted_at asc nulls last
        limit $1`,
      [limit],
    );
    return rows.map((row) => reBrand<StoryId>(row.story_id));
  }

  /** Backfills run since an instant — the day's count for the cap. */
  async countSince(at: Millis): Promise<number> {
    const rows = await this.#db.query<{ n: string | number }>(
      `select count(*) as n from internal.story_backfill where ran_at >= $1`,
      [toTimestamp(at)],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Note posts fetched because of a story. The first story to fetch a post keeps it. */
  async markPosts(posts: readonly { readonly itemId: ItemId; readonly reachedFrom: ItemId | null }[], storyId: StoryId, via: BackfillVia, at: Millis): Promise<void> {
    for (const post of posts) {
      await this.#db.query(
        `insert into internal.item_backfill (item_id, story_id, via, reached_from, found_at)
         values ($1, $2, $3, $4, $5)
         on conflict (item_id) do nothing`,
        [post.itemId, storyId, via, post.reachedFrom, toTimestamp(at)],
      );
    }
  }

  async ofItems(ids: readonly ItemId[]): Promise<ReadonlyMap<ItemId, BackfilledPost>> {
    const out = new Map<ItemId, BackfilledPost>();
    if (ids.length === 0) return out;
    const rows = await this.#db.query<{ item_id: string; story_id: string; via: BackfillVia; reached_from: string | null }>(
      `select item_id, story_id, via, reached_from from internal.item_backfill where item_id = any($1::text[])`,
      [[...ids]],
    );
    for (const row of rows) {
      out.set(reBrand<ItemId>(row.item_id), {
        storyId: reBrand<StoryId>(row.story_id),
        via: row.via,
        reachedFrom: row.reached_from === null ? null : reBrand<ItemId>(row.reached_from),
      });
    }
    return out;
  }

  async record(run: BackfillRun): Promise<void> {
    await this.#db.query(
      `insert into internal.story_backfill
         (story_id, ran_at, members_at, quoted_posts, search_name, search_returned, search_note, cost_usd)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (story_id) do update set
         ran_at = excluded.ran_at, members_at = excluded.members_at, quoted_posts = excluded.quoted_posts,
         search_name = excluded.search_name, search_returned = excluded.search_returned,
         search_note = excluded.search_note, cost_usd = excluded.cost_usd`,
      [
        run.storyId,
        toTimestamp(run.at),
        run.membersAt,
        run.quotedPosts,
        run.search.name,
        run.search.name === null ? null : run.search.returned,
        run.search.name === null ? run.search.note : null,
        run.costUsd,
      ],
    );
  }

  async last(storyId: StoryId): Promise<BackfillRun | null> {
    const rows = await this.#db.query<{
      ran_at: string | Date;
      members_at: number;
      quoted_posts: number;
      search_name: string | null;
      search_returned: number | null;
      search_note: 'no_name' | 'not_supported' | null;
      cost_usd: string | number;
    }>(
      `select ran_at, members_at, quoted_posts, search_name, search_returned, search_note, cost_usd
         from internal.story_backfill where story_id = $1`,
      [storyId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      storyId,
      at: toMillisRequired(row.ran_at, 'ran_at'),
      membersAt: Number(row.members_at),
      quotedPosts: Number(row.quoted_posts),
      search:
        row.search_name === null
          ? { name: null, note: row.search_note ?? 'not_supported' }
          : { name: row.search_name, returned: Number(row.search_returned ?? 0) },
      costUsd: Number(row.cost_usd),
    };
  }
}
