/**
 * Stories and membership.
 *
 * Membership records WHICH CARRIER joined an item to a story — a fact anybody can
 * re-check from the item itself. The number that persuaded us is not here; it is in
 * the group stage's row in the decision log, with the whole feature vector beside
 * it. Splitting it that way is what makes "why is this post in this story"
 * answerable six months later, instead of being a float nobody can reconstruct.
 *
 * Members are read back with their author and source attached, because every
 * qualify gate is about breadth — distinct authors, distinct sources — and making
 * callers re-join to get them invites somebody to approximate it.
 */

import type { Millis } from '@insidor/contracts';
import type { Story, StoryMember } from '@insidor/contracts/story.ts';
import type { ItemId, SourceId, StoryId } from '@insidor/contracts/ids.ts';
import type { StoryRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { NotImplemented } from '../not-implemented.ts';
import { reBrand, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface StoryRow {
  story_id: string;
  earliest_post_at: TimestampColumn;
  promoted_at: TimestampColumn;
  last_member_at: TimestampColumn;
  state: Story['state'];
  display_title: string | null;
  thumb_uri: string | null;
  merged_into: string | null;
  member_count: number;
  author_count: number;
  source_count: number;
}

interface MemberRow {
  story_id: string;
  item_id: string;
  author_key: string;
  source: string;
  joined_at: TimestampColumn;
  joined_by: StoryMember['joinedBy'];
  carrier_key: string | null;
  is_seed: boolean;
}

const SELECT_STORY = `
  select story_id, earliest_post_at, promoted_at, last_member_at, state,
         display_title, thumb_uri, merged_into, member_count, author_count, source_count
    from public.story
`;

export class PgStoryRepo implements StoryRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async upsert(story: Story): Promise<void> {
    await this.#db.query(
      `insert into public.story (
         story_id, earliest_post_at, promoted_at, last_member_at, state,
         display_title, thumb_uri, member_count, author_count, source_count
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (story_id) do update set
         earliest_post_at = least(public.story.earliest_post_at, excluded.earliest_post_at),
         last_member_at   = greatest(public.story.last_member_at, excluded.last_member_at),
         state            = excluded.state,
         display_title    = excluded.display_title,
         thumb_uri        = excluded.thumb_uri,
         member_count     = excluded.member_count,
         author_count     = excluded.author_count,
         source_count     = excluded.source_count`,
      [
        story.storyId,
        toTimestamp(story.earliestPostAt),
        toTimestamp(story.promotedAt),
        toTimestamp(story.lastMemberAt),
        story.state,
        story.displayTitle,
        story.thumbUri,
        story.memberCount,
        story.authorCount,
        story.sourceCount,
      ],
    );
  }

  async byId(id: StoryId): Promise<Story | null> {
    const rows = await this.#db.query<StoryRow>(`${SELECT_STORY} where story_id = $1`, [id]);
    const row = rows[0];
    return row ? toStory(row) : null;
  }

  /**
   * Add an item to a story and refresh the story's breadth counters in the same
   * statement, so the counters cannot drift from the membership they summarise.
   */
  async addMember(member: StoryMember): Promise<void> {
    await this.#db.query(
      `insert into public.story_member (story_id, item_id, joined_at, joined_by, carrier_key, is_seed)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (story_id, item_id) do nothing`,
      [
        member.storyId,
        member.itemId,
        toTimestamp(member.joinedAt),
        member.joinedBy,
        member.carrierKey ?? null,
        member.isSeed,
      ],
    );
    await this.refreshCounters(member.storyId);
  }

  async membersOf(id: StoryId): Promise<StoryMember[]> {
    const rows = await this.#db.query<MemberRow>(
      `select m.story_id, m.item_id, i.author_key, i.source,
              m.joined_at, m.joined_by, m.carrier_key, m.is_seed
         from public.story_member m
         join public.item i using (item_id)
        where m.story_id = $1
        order by m.joined_at asc`,
      [id],
    );
    return rows.map(toMember);
  }

  /**
   * Stories still accepting members. The grouper scores an arriving item against
   * this set, so it is bounded by recency rather than by state alone — an open
   * story nobody has added to in days is not a candidate, it is history.
   */
  async openSince(sinceMs: Millis, limit: number): Promise<Story[]> {
    const rows = await this.#db.query<StoryRow>(
      `${SELECT_STORY}
        where merged_into is null and state = 'promoted' and last_member_at >= $1
        order by last_member_at desc
        limit $2`,
      [toTimestamp(sinceMs), limit],
    );
    return rows.map(toStory);
  }

  /**
   * Point the loser at the winner. Both ids stay alive: decisions have already been
   * logged against the loser's id, and the decision log must never acquire a
   * dangling subject.
   */
  async merge(loser: StoryId, winner: StoryId): Promise<void> {
    if (loser === winner) throw new TypeError('a story cannot be merged into itself');
    await this.#db.query(
      `update public.story set merged_into = $2, state = 'retired' where story_id = $1`,
      [loser, winner],
    );
    await this.#db.query(
      `insert into public.story_member (story_id, item_id, joined_at, joined_by, carrier_key, is_seed)
       select $2, item_id, joined_at, joined_by, carrier_key, false
         from public.story_member where story_id = $1
       on conflict (story_id, item_id) do nothing`,
      [loser, winner],
    );
    await this.refreshCounters(winner);
  }

  /** Recount breadth from membership. Cheap, and it makes the counters derivable rather than remembered. */
  async refreshCounters(id: StoryId): Promise<void> {
    await this.#db.query(
      `update public.story s set
         member_count   = agg.members,
         author_count   = agg.authors,
         source_count   = agg.sources,
         earliest_post_at = least(s.earliest_post_at, agg.earliest_post),
         last_member_at = greatest(s.last_member_at, agg.last_join)
       from (
         select count(*)                        as members,
                count(distinct i.author_key)    as authors,
                count(distinct i.source)        as sources,
                min(i.posted_at)                as earliest_post,
                max(m.joined_at)                as last_join
           from public.story_member m
           join public.item i using (item_id)
          where m.story_id = $1
       ) agg
       where s.story_id = $1`,
      [id],
    );
  }

  /**
   * Tier 1 carrier neighbours: items sharing an exact or near-exact carrier with
   * the given item, as candidate story members.
   *
   * Left unimplemented deliberately. The Hamming radii (31/256 on the image hash,
   * 3/64 on the text hash) are policy numbers and belong to core, and whether HNSW
   * recall holds at a radius that loose is an open measurement — the fallback is
   * permutation blocking, which changes this query's shape entirely. Writing a
   * guess here would bury a threshold in SQL, which is exactly where the previous
   * build's thresholds went to hide.
   */
  async carrierNeighbours(): Promise<never> {
    throw new NotImplemented(
      'StoryRepo.carrierNeighbours',
      'the Hamming radii are policy and the HNSW-versus-blocking choice is unmeasured',
    );
  }
}

function toStory(row: StoryRow): Story {
  return {
    storyId: reBrand<StoryId>(row.story_id),
    earliestPostAt: toMillis(row.earliest_post_at),
    promotedAt: toMillisRequired(row.promoted_at, 'promoted_at'),
    lastMemberAt: toMillisRequired(row.last_member_at, 'last_member_at'),
    state: row.state,
    displayTitle: row.display_title,
    thumbUri: row.thumb_uri,
    mergedInto: row.merged_into === null ? null : reBrand<StoryId>(row.merged_into),
    memberCount: row.member_count,
    authorCount: row.author_count,
    sourceCount: row.source_count,
  };
}

function toMember(row: MemberRow): StoryMember {
  return {
    storyId: reBrand<StoryId>(row.story_id),
    itemId: reBrand<ItemId>(row.item_id),
    authorKey: reBrand(row.author_key),
    source: reBrand<SourceId>(row.source),
    joinedAt: toMillisRequired(row.joined_at, 'joined_at'),
    joinedBy: row.joined_by,
    carrierKey: row.carrier_key,
    isSeed: row.is_seed,
  };
}
