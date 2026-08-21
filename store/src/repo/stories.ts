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
  /** The closed list of contracts' STORY_ORIGINS, spelled the same way by 0016's CHECK. */
  origin: Story['origin'];
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
  select story_id, origin, created_at, earliest_post_at, promoted_at, last_member_at, state,
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
   *
   * ★ `origin` IS IN THE INSERT AND DELIBERATELY NOT IN THE UPDATE, and it belongs on
   * that same list. It is a fact about how the row came to EXIST, so the row that exists
   * already has the only true answer and this call is not in a position to correct it.
   * Leaving it out of the SET is also the safe direction under a collision: an upsert
   * carrying 'observed' cannot re-stamp a seeded story, and one carrying 'fixture' cannot
   * turn a real story into one that may see invented coins. See coinOriginsVisibleTo —
   * only the second of those is a live danger, and neither is reachable from here.
   *
   * Nothing coalesces it either. `origin` is NOT NULL with no default in 0016, so there is
   * no null to fill in: a story either has an origin or was never written.
   */
  async upsert(story: Story): Promise<void> {
    await this.#db.query(
      `insert into public.story (
         story_id, origin, created_at, earliest_post_at, promoted_at, last_member_at, state,
         carriers, merged_into, member_count, distinct_authors, distinct_sources
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
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
        story.origin,
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
   * The members of several stories in one round trip, keyed by story.
   *
   * The same argument as `ObservationRepo.seriesForItems`: QUALIFY is handed a batch
   * of stories and every one of its gates is a count over that story's members, so
   * the per-story shape is one query per subject and a loop that cannot hold its
   * cadence. A story with no members is an absent key, not an empty array — those
   * are different facts and only one of them is possible.
   */
  async membersForStories(
    ids: readonly StoryId[],
  ): Promise<ReadonlyMap<StoryId, readonly StoryMember[]>> {
    const found = new Map<StoryId, StoryMember[]>();
    if (ids.length === 0) return found;

    const rows = await this.#db.query<MemberRow>(
      `${SELECT_MEMBER}
        where m.story_id = any($1::text[])
        order by m.story_id, m.joined_at asc`,
      [[...ids]],
    );
    for (const row of rows) {
      const key = reBrand<StoryId>(row.story_id);
      const list = found.get(key);
      if (list === undefined) found.set(key, [toMember(row)]);
      else list.push(toMember(row));
    }
    return found;
  }

  /**
   * Which story each of these items already belongs to.
   *
   * ★ THIS IS HOW `GroupInput.lineage` GETS RESOLVED, and the reason it is a store
   * query rather than something the stage does for itself is stated on the field:
   * "`Item.reproductionOf` names an ITEM and `Story` carries no member list, so
   * turning 'points at item X' into 'points into story S' is a store lookup. A stage
   * that could do a lookup could do a fetch."
   *
   * Merged stories are followed exactly once, to the story that absorbed them. An
   * item whose story was folded into another belongs to the survivor — pointing a
   * new member at a merged shell would create a story nothing else can reach.
   */
  async storiesOfItems(ids: readonly ItemId[]): Promise<ReadonlyMap<ItemId, StoryId>> {
    const found = new Map<ItemId, StoryId>();
    if (ids.length === 0) return found;

    const rows = await this.#db.query<{ item_id: string; story_id: string }>(
      `select m.item_id, coalesce(s.merged_into, m.story_id) as story_id
         from public.story_member m
         join public.story s on s.story_id = m.story_id
        where m.item_id = any($1::text[])
        order by m.joined_at asc`,
      [[...ids]],
    );
    // Oldest join wins: an item that seeded a story belongs to that story, and a
    // later membership row is a merge artefact rather than a second home.
    for (const row of rows) {
      const key = reBrand<ItemId>(row.item_id);
      if (!found.has(key)) found.set(key, reBrand<StoryId>(row.story_id));
    }
    return found;
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

    /* ★ THE ONE PATH BY WHICH OBSERVED ITEMS COULD END UP UNDER A FIXTURE STORY'S
       ALLOWLIST, closed here because there is nowhere downstream that could close it.
       `origin` is a fact about how a row came to exist, so nothing updates it — the upsert
       above leaves it alone on purpose. That immutability is right, and it is exactly what
       makes this call dangerous: merging an observed story INTO a fixture one moves real
       members under a row whose origin still says 'fixture', and `coinOriginsVisibleTo`
       then lets that row name invented coins beside posts people actually wrote. The
       survivor would be a fiction's provenance wrapped around observed content, which is
       the pairing every origin rule in this repository exists to make unsayable.

       ★ A THROW AND NOT A SILENT NARROWING. Re-stamping the survivor 'observed' would fix
       the visibility and lie about the row: a story assembled by a seed did not become
       something the world produced because another story was folded into it. And it would
       be the first write in the system that moves an origin, which is the property 0016
       and the asset upsert both spend their comments defending. So the merge is refused and
       the caller decides — the two candidates for that decision are merging the other way
       round, or not merging at all, and both are judgements above this layer.

       THE OTHER DIRECTION IS ALLOWED AND IS NOT AN OVERSIGHT. A fixture merged into an
       observed story leaves the survivor 'observed', so it sees observed coins only — the
       demonstration members lose their demonstration coins. That is a demo showing less
       than it meant to, which is the direction this vocabulary is built to fail in.

       Nothing calls this yet. That is not a reason to leave it: `chains()` in the asset repo
       makes the same argument about a read whose hole today's data happens not to walk
       through, and the day a merge is wired is the day nobody is thinking about provenance. */
    const origins = await this.#db.query<{ story_id: string; origin: Story['origin'] }>(
      `select story_id, origin from public.story where story_id = any($1::text[])`,
      [[from, into]],
    );
    const originOf = new Map(origins.map((row) => [row.story_id, row.origin]));
    const fromOrigin = originOf.get(from);
    const intoOrigin = originOf.get(into);
    /* An absent row is a throw rather than a skipped check. A merge naming a story that is
       not there is already wrong, and the version of this guard that shrugs at a missing
       origin is the version that passes when the read failed. */
    if (fromOrigin === undefined) throw new TypeError(`story ${from} does not exist to be merged`);
    if (intoOrigin === undefined) throw new TypeError(`story ${into} does not exist to merge into`);
    if (intoOrigin === 'fixture' && fromOrigin !== 'fixture') {
      throw new TypeError(
        `refusing to merge ${fromOrigin} story ${from} into fixture story ${into}: ` +
          'the survivor keeps its fixture origin, which would let invented coins be named ' +
          'beside observed posts. Merge the other way round, or not at all.',
      );
    }

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
    origin: row.origin,
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
