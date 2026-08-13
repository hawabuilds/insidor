/**
 * Stories and membership.
 *
 * Membership records WHY an item joined a story — a fact anybody can re-check from
 * the item itself. The number that persuaded us is not here; it is in the group
 * stage's row in the decision log, with the whole feature vector beside it.
 * Splitting it that way is what makes "why is this post in this story" answerable
 * six months later, instead of being a float nobody can reconstruct.
 *
 * The reason is a DISCRIMINATED UNION — MatchEvidence — and a database row is flat,
 * so this file owns the flattening in both directions. It is done by switching on
 * the kind, never by reading a column that only one variant sets: a `carrier_key`
 * on a lineage row would be a silent lie about how the item got here, and the mix
 * of evidence kinds is the number that decides whether the paid tier earns its bill.
 *
 * Members are read back with their author, source and post time attached, because
 * every qualify gate is about breadth — distinct authors, distinct sources — and
 * making callers re-join to get them invites somebody to approximate it.
 *
 * ★ NOTHING HERE IS A TITLE OR A THUMBNAIL. `display_title` and `thumb_uri` are
 * real columns and they are not fields on `Story`: presentation is produced later,
 * by the qualify stage, and is written through setPresentation(). The table being
 * richer than the type is fine and deliberate. The type growing a field because the
 * table has a column is how a shared vocabulary rots.
 */

import type { Fingerprint, Millis } from '@insidor/contracts';
import type { MatchEvidence, Story, StoryMember } from '@insidor/contracts/story.ts';
import type { AuthorKey, ItemId, SourceId, StoryId } from '@insidor/contracts/ids.ts';
import type { StoryRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { NotImplemented } from '../not-implemented.ts';
import { reBrand, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface StoryRow {
  story_id: string;
  created_at: TimestampColumn;
  earliest_post_at: TimestampColumn;
  promoted_at: TimestampColumn;
  last_member_at: TimestampColumn;
  state: Story['state'];
  /** jsonb. Written from Story.carriers and read straight back into it. */
  carriers: readonly Fingerprint[];
  merged_into: string | null;
  member_count: number;
  distinct_authors: number;
  distinct_sources: number;
}

/**
 * The flat spelling of a member. `evidence_kind` selects which of the columns below
 * it are meaningful; the migration's constraints make that selection an invariant,
 * so a row that reaches this file is already known to be one whole variant.
 */
interface MemberRow {
  story_id: string;
  item_id: string;
  author_key: string;
  source: string;
  posted_at: TimestampColumn;
  joined_at: TimestampColumn;
  evidence_kind: MatchEvidence['kind'];
  carrier_kind: Fingerprint['kind'] | null;
  carrier_key: string | null;
  carrier_distance: number | null;
  carrier_weight: number | null;
  lineage_via: 'reproduction' | 'rebroadcast' | null;
  lineage_to_item: string | null;
  representation_similarity: number | null;
  representation_space: string | null;
  adjudicated_by: string | null;
  adjudicated_at: TimestampColumn;
}

/** What the qualify stage renders. Not part of the analytical object; see the header. */
export interface StoryPresentation {
  readonly displayTitle: string | null;
  readonly thumbUri: string | null;
}

const SELECT_STORY = `
  select story_id, created_at, earliest_post_at, promoted_at, last_member_at, state,
         carriers, merged_into, member_count, distinct_authors, distinct_sources
    from public.story
`;

const SELECT_MEMBER = `
  select m.story_id, m.item_id, i.author_key, i.source, i.posted_at, m.joined_at,
         m.evidence_kind, m.carrier_kind, m.carrier_key, m.carrier_distance, m.carrier_weight,
         m.lineage_via, m.lineage_to_item,
         m.representation_similarity, m.representation_space,
         m.adjudicated_by, m.adjudicated_at
    from public.story_member m
    join public.item i using (item_id)
`;

export class PgStoryRepo implements StoryRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * `created_at` is never updated and `promoted_at` is never cleared: both are
   * clocks about events that already happened, and moving one backwards would make
   * an old story look new to every age feature downstream.
   */
  async upsert(story: Story): Promise<void> {
    await this.#db.query(
      `insert into public.story (
         story_id, created_at, earliest_post_at, promoted_at, last_member_at, state,
         carriers, merged_into, member_count, distinct_authors, distinct_sources
       ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
       on conflict (story_id) do update set
         earliest_post_at = least(public.story.earliest_post_at, excluded.earliest_post_at),
         last_member_at   = greatest(public.story.last_member_at, excluded.last_member_at),
         promoted_at      = coalesce(public.story.promoted_at, excluded.promoted_at),
         state            = excluded.state,
         carriers         = excluded.carriers,
         merged_into      = coalesce(public.story.merged_into, excluded.merged_into),
         member_count     = excluded.member_count,
         distinct_authors = excluded.distinct_authors,
         distinct_sources = excluded.distinct_sources`,
      [
        story.storyId,
        toTimestamp(story.createdAt),
        toTimestamp(story.earliestPostAt),
        toTimestamp(story.promotedAt),
        toTimestamp(story.lastMemberAt),
        story.state,
        JSON.stringify(story.carriers),
        story.mergedInto,
        story.memberCount,
        story.distinctAuthors,
        story.distinctSources,
      ],
    );
  }

  async byId(id: StoryId): Promise<Story | null> {
    const rows = await this.#db.query<StoryRow>(`${SELECT_STORY} where story_id = $1`, [id]);
    const row = rows[0];
    return row ? toStory(row) : null;
  }

  /**
   * What a person sees, written through its own path.
   *
   * Separate from upsert() because it is produced by a different stage at a
   * different time, and because a grouper refreshing counters must not be able to
   * blank a title it knows nothing about.
   */
  async setPresentation(id: StoryId, presentation: StoryPresentation): Promise<void> {
    await this.#db.query(
      `update public.story set display_title = $2, thumb_uri = $3 where story_id = $1`,
      [id, presentation.displayTitle, presentation.thumbUri],
    );
  }

  /**
   * Add items to a story and refresh the story's breadth counters afterwards, so
   * the counters cannot drift from the membership they summarise.
   *
   * Returns the number of rows actually written; a re-arrival of a member we
   * already have is a no-op rather than an error, because the grouper re-sees the
   * same item constantly and a duplicate must cost nothing.
   */
  async addMembers(members: readonly StoryMember[]): Promise<number> {
    if (members.length === 0) return 0;

    let written = 0;
    const touched = new Set<StoryId>();
    for (const member of members) {
      const evidence = toEvidenceColumns(member.evidence);
      const rows = await this.#db.query<{ item_id: string }>(
        `insert into public.story_member (
           story_id, item_id, joined_at, evidence_kind,
           carrier_kind, carrier_key, carrier_distance, carrier_weight,
           lineage_via, lineage_to_item,
           representation_similarity, representation_space,
           adjudicated_by, adjudicated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (story_id, item_id) do nothing
         returning item_id`,
        [
          member.storyId,
          member.itemId,
          toTimestamp(member.joinedAt),
          evidence.kind,
          evidence.carrierKind,
          evidence.carrierKey,
          evidence.carrierDistance,
          evidence.carrierWeight,
          evidence.lineageVia,
          evidence.lineageToItem,
          evidence.similarity,
          evidence.space,
          evidence.adjudicatedBy,
          toTimestamp(evidence.adjudicatedAt),
        ],
      );
      written += rows.length;
      touched.add(member.storyId);
    }

    for (const storyId of touched) await this.refreshCounters(storyId);
    return written;
  }

  async members(id: StoryId): Promise<readonly StoryMember[]> {
    const rows = await this.#db.query<MemberRow>(
      `${SELECT_MEMBER} where m.story_id = $1 order by m.joined_at asc`,
      [id],
    );
    return rows.map(toMember);
  }

  /**
   * Stories still accepting members. The grouper scores an arriving item against
   * this set, so it is bounded by recency rather than by state alone — an open
   * story nobody has added to in days is not a candidate, it is history.
   *
   * Candidates are in the set as well as promoted stories: promotion decides what
   * downstream stages may look at, not whether membership is still open, and
   * excluding candidates would mean the second version of a moment starts a second
   * story instead of joining the first.
   */
  async openSince(sinceMs: Millis, limit: number): Promise<readonly Story[]> {
    const rows = await this.#db.query<StoryRow>(
      `${SELECT_STORY}
        where merged_into is null
          and state in ('candidate', 'promoted')
          and last_member_at >= $1
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
   *
   * Membership is copied WITH ITS EVIDENCE UNCHANGED. Re-labelling the loser's seed
   * as something else would be inventing a reason it joined; that it seeded a story
   * which was later folded into this one is what actually happened, and `merged_into`
   * on the loser is where that story is told.
   */
  async merge(from: StoryId, into: StoryId, at: Millis): Promise<void> {
    if (from === into) throw new TypeError('a story cannot be merged into itself');
    await this.#db.query(
      `update public.story
          set merged_into = $2, merged_at = $3, state = 'merged'
        where story_id = $1`,
      [from, into, toTimestamp(at)],
    );
    await this.#db.query(
      `insert into public.story_member (
         story_id, item_id, joined_at, evidence_kind,
         carrier_kind, carrier_key, carrier_distance, carrier_weight,
         lineage_via, lineage_to_item,
         representation_similarity, representation_space,
         adjudicated_by, adjudicated_at
       )
       select $2, item_id, joined_at, evidence_kind,
              carrier_kind, carrier_key, carrier_distance, carrier_weight,
              lineage_via, lineage_to_item,
              representation_similarity, representation_space,
              adjudicated_by, adjudicated_at
         from public.story_member where story_id = $1
       on conflict (story_id, item_id) do nothing`,
      [from, into],
    );
    await this.refreshCounters(into);
  }

  /** Recount breadth from membership. Cheap, and it makes the counters derivable rather than remembered. */
  async refreshCounters(id: StoryId): Promise<void> {
    await this.#db.query(
      `update public.story s set
         member_count     = agg.members,
         distinct_authors = agg.authors,
         distinct_sources = agg.sources,
         earliest_post_at = least(s.earliest_post_at, agg.earliest_post),
         last_member_at   = greatest(s.last_member_at, agg.last_join)
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
    state: row.state,
    createdAt: toMillisRequired(row.created_at, 'created_at'),
    promotedAt: toMillis(row.promoted_at),
    earliestPostAt: toMillisRequired(row.earliest_post_at, 'earliest_post_at'),
    lastMemberAt: toMillisRequired(row.last_member_at, 'last_member_at'),
    memberCount: row.member_count,
    distinctAuthors: row.distinct_authors,
    distinctSources: row.distinct_sources,
    carriers: row.carriers,
    mergedInto: row.merged_into === null ? null : reBrand<StoryId>(row.merged_into),
  };
}

function toMember(row: MemberRow): StoryMember {
  return {
    storyId: reBrand<StoryId>(row.story_id),
    itemId: reBrand<ItemId>(row.item_id),
    authorKey: reBrand<AuthorKey>(row.author_key),
    source: reBrand<SourceId>(row.source),
    postedAt: toMillis(row.posted_at),
    joinedAt: toMillisRequired(row.joined_at, 'joined_at'),
    evidence: toEvidence(row),
  };
}

/* ── the union, in both directions ────────────────────────────────────── */

interface EvidenceColumns {
  readonly kind: MatchEvidence['kind'];
  readonly carrierKind: Fingerprint['kind'] | null;
  readonly carrierKey: string | null;
  readonly carrierDistance: number | null;
  readonly carrierWeight: number | null;
  readonly lineageVia: 'reproduction' | 'rebroadcast' | null;
  readonly lineageToItem: ItemId | null;
  readonly similarity: number | null;
  readonly space: string | null;
  readonly adjudicatedBy: string | null;
  readonly adjudicatedAt: Millis | null;
}

const NO_EVIDENCE_COLUMNS = {
  carrierKind: null,
  carrierKey: null,
  carrierDistance: null,
  carrierWeight: null,
  lineageVia: null,
  lineageToItem: null,
  similarity: null,
  space: null,
  adjudicatedBy: null,
  adjudicatedAt: null,
} as const;

/**
 * Domain → columns. A switch, so adding a sixth kind of evidence to the vocabulary
 * is a compile error here rather than a column that silently stays null.
 */
function toEvidenceColumns(evidence: MatchEvidence): EvidenceColumns {
  switch (evidence.kind) {
    case 'seed':
      return { ...NO_EVIDENCE_COLUMNS, kind: 'seed' };
    case 'carrier':
      return {
        ...NO_EVIDENCE_COLUMNS,
        kind: 'carrier',
        carrierKind: evidence.carrier,
        carrierKey: evidence.key,
        carrierDistance: evidence.distance,
        carrierWeight: evidence.weight,
      };
    case 'lineage':
      return {
        ...NO_EVIDENCE_COLUMNS,
        kind: 'lineage',
        lineageVia: evidence.via,
        lineageToItem: evidence.toItem,
      };
    case 'representation':
      return {
        ...NO_EVIDENCE_COLUMNS,
        kind: 'representation',
        similarity: evidence.similarity,
        space: evidence.space,
      };
    case 'adjudicated':
      return {
        ...NO_EVIDENCE_COLUMNS,
        kind: 'adjudicated',
        adjudicatedBy: evidence.by,
        adjudicatedAt: evidence.at,
      };
  }
}

/**
 * Columns → domain. The migration's constraints guarantee a whole variant, so a
 * null in a column this kind requires means the row was written around them —
 * which throws here rather than producing a half-built reason.
 */
function toEvidence(row: MemberRow): MatchEvidence {
  switch (row.evidence_kind) {
    case 'seed':
      return { kind: 'seed' };
    case 'carrier':
      return {
        kind: 'carrier',
        carrier: present(row.carrier_kind, 'carrier_kind'),
        key: present(row.carrier_key, 'carrier_key'),
        distance: row.carrier_distance,
        weight: present(row.carrier_weight, 'carrier_weight'),
      };
    case 'lineage':
      return {
        kind: 'lineage',
        via: present(row.lineage_via, 'lineage_via'),
        toItem: reBrand<ItemId>(present(row.lineage_to_item, 'lineage_to_item')),
      };
    case 'representation':
      return {
        kind: 'representation',
        similarity: present(row.representation_similarity, 'representation_similarity'),
        space: present(row.representation_space, 'representation_space'),
      };
    case 'adjudicated':
      return {
        kind: 'adjudicated',
        by: present(row.adjudicated_by, 'adjudicated_by'),
        at: toMillisRequired(row.adjudicated_at, 'adjudicated_at'),
      };
  }
}

function present<T>(value: T | null, column: string): T {
  if (value === null) {
    throw new TypeError(`story_member.${column} is required by this evidence kind but arrived null`);
  }
  return value;
}
