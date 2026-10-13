/**
 * Items and their authors.
 *
 * Nothing in this file knows a platform's field names. By the time an Item reaches
 * here it is already in our vocabulary; the adapter did the translating and is the
 * only code permitted to have done it. If a vendor word ever appears in this file,
 * the boundary has already been crossed somewhere upstream.
 *
 * The `counters` column is written here as a convenience cache of the newest
 * reading. It is NOT the record — public.observation is — and nothing that
 * differences counters may read it, because a cache that is one pass stale
 * produces a rate that is silently wrong rather than absent.
 */

import type { Item, CounterSet, Fingerprint, MediaRef, Millis } from '@insidor/contracts';
import type { ItemId, SourceId } from '@insidor/contracts/ids.ts';
import type { ItemRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { NotImplemented } from '../not-implemented.ts';
import { reBrand, toBitLiteral, toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

interface ItemRow {
  item_id: string;
  source: string;
  source_item_id: string;
  origin: Item['origin'];
  author_key: string;
  posted_at: TimestampColumn;
  first_seen_at: TimestampColumn;
  lang: string | null;
  body: string;
  media: MediaRef[];
  counters: CounterSet;
  rebroadcast_of: string | null;
  reproduction_of: string | null;
  format_ids: string[];
  raw_ref: string;
}

interface FingerprintRow {
  item_id: string;
  kind: Fingerprint['kind'];
  key: string;
}

/** The judge's newest answer about one post, as much of it as the per-post rule reads. */
export interface TrackingJudgement {
  readonly coinable: boolean;
  readonly confidence: number;
  readonly lookedAt: 'text' | 'picture' | 'videoFrame';
  readonly proposedName: string | null;
}

/** See `PgItemRepo.trackingFacts`. Keyed by item id and story id as strings. */
export interface TrackingFacts {
  readonly onFeed: ReadonlySet<string>;
  readonly catchAll: ReadonlySet<string>;
  /** The promoted, unmerged stories each post is in. A post in none is absent. */
  readonly storiesOf: ReadonlyMap<string, readonly string[]>;
  /** Every member of those stories. */
  readonly membersOf: ReadonlyMap<string, readonly string[]>;
  /** The newest judgement per post and per member. A post never judged is absent, never a "no". */
  readonly judged: ReadonlyMap<string, TrackingJudgement>;
}

const SELECT_ITEM = `
  select item_id, source, source_item_id, origin, author_key, posted_at, first_seen_at,
         lang, body, media, counters, rebroadcast_of, reproduction_of,
         format_ids, raw_ref
    from public.item
`;

export class PgItemRepo implements ItemRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Insert or refresh items. Idempotent on (source, source_item_id), because the
   * discovery path re-sees the same post constantly and a duplicate arrival must
   * cost nothing.
   *
   * `first_seen_at` is never overwritten: it is the clock the tracking schedule and
   * every age feature are computed from, and moving it forward would quietly make
   * old items look new.
   *
   * `origin` is never overwritten either: it is a fact about how the row came to exist, and
   * a refresh of the same post from the same source cannot change it.
   */
  async upsert(items: readonly Item[]): Promise<number> {
    if (items.length === 0) return 0;

    for (const item of items) {
      await this.#ensureAuthor(item);
      await this.#db.query(
        `insert into public.item (
           item_id, source, source_item_id, author_key, posted_at, first_seen_at,
           lang, body, media, counters, counters_observed_at,
           rebroadcast_of, reproduction_of, format_ids, raw_ref, origin
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16)
         on conflict (item_id) do update set
           lang            = excluded.lang,
           body            = excluded.body,
           media           = excluded.media,
           counters        = excluded.counters,
           counters_observed_at = excluded.counters_observed_at,
           rebroadcast_of  = excluded.rebroadcast_of,
           reproduction_of = excluded.reproduction_of,
           format_ids      = excluded.format_ids`,
        [
          item.itemId,
          item.source,
          item.sourceItemId,
          item.authorKey,
          toTimestamp(item.postedAt),
          toTimestamp(item.firstSeenAt),
          item.lang,
          item.text,
          JSON.stringify(item.media),
          JSON.stringify(item.counters),
          toTimestamp(item.firstSeenAt),
          item.rebroadcastOf,
          item.reproductionOf,
          item.formatIds,
          item.rawRef,
          item.origin,
        ],
      );
      await this.#writeFingerprints(item);
    }
    return items.length;
  }

  /**
   * Note which catch-all lane found these posts (0025). The first lane to find a post
   * keeps it: a post the media lane found again later was still found by the first one.
   */
  async markFoundBy(itemIds: readonly ItemId[], lane: string, at: Millis): Promise<void> {
    if (itemIds.length === 0) return;
    await this.#db.query(
      `insert into internal.item_found_by (item_id, lane, found_at)
       select id, $2, $3 from unnest($1::text[]) as id
       on conflict (item_id) do nothing`,
      [[...itemIds], lane, toTimestamp(at)],
    );
  }

  /**
   * Catch-all posts the judge has not scored yet, newest first — the queue the per-post
   * score works through. Observed posts only: a seeded post is never sent to a paid judge.
   *
   * Posts the backfill fetched for a story are scored too (0032): the judge's name for a
   * post is half of GROUP's name-plus-picture join, and without it a backfilled copy could
   * only join on a near-identical picture. Scoring one does not put it on the For You feed;
   * only a catch-all lane does that.
   */
  async catchAllUnscored(at: Millis, limit: number, minReach: number | null = null, lane: string | null = null): Promise<readonly Item[]> {
    /* With `minReach`, a catch-all post waits until some reading of its reach has reached it —
       the free check before the paid judge. A backfilled post is never held back: it is scored
       for GROUP's name join, not for the feed.
       With `lane`, only that lane's posts (and no backfill): the short-video watch lane is read
       on its own, because newest-first over every lane it never makes the page — the text lanes
       add hundreds of unscored posts an hour (2026-10-13: 233 videos stored, none judged). */
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM}
        where origin = 'observed'
          and first_seen_at >= $1
          and ((exists (select 1 from internal.item_found_by f where f.item_id = public.item.item_id and ($4::text is null or f.lane = $4))
                and ($3::double precision is null
                     or exists (select 1 from public.observation o
                                 where o.item_id = public.item.item_id and o.kind = 'reach' and o.value >= $3)))
               or ($4::text is null and exists (select 1 from internal.item_backfill b where b.item_id = public.item.item_id)))
          and not exists (select 1 from internal.post_judgement j where j.item_id = public.item.item_id)
        order by first_seen_at desc
        limit $2`,
      [toTimestamp(at), limit, minReach, lane],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => this.#toItem(row, fingerprints));
  }

  /**
   * Catch-all posts whose newest answer to the post question came from ANOTHER version of it than
   * `promptId` — the queue the scorer re-judges after a prompt change, newest first, with the same
   * window, lane and reach floor as `catchAllUnscored`. Kind answers (prompt ids starting
   * `kindPrefix`) are not answers to the post question and are skipped when finding the newest;
   * a post with only kind answers is not here. Observed posts only.
   */
  async catchAllStale(at: Millis, limit: number, promptId: string, kindPrefix: string, minReach: number | null = null): Promise<readonly Item[]> {
    if (limit <= 0) return [];
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM}
        where origin = 'observed'
          and first_seen_at >= $1
          and exists (select 1 from internal.item_found_by f where f.item_id = public.item.item_id)
          and ($4::double precision is null
               or exists (select 1 from public.observation o
                           where o.item_id = public.item.item_id and o.kind = 'reach' and o.value >= $4))
          and (select j.prompt_id from internal.post_judgement j
                where j.item_id = public.item.item_id and j.prompt_id not like $5
                order by j.judged_at desc, j.id desc limit 1) <> $3
        order by first_seen_at desc
        limit $2`,
      [toTimestamp(at), limit, promptId, minReach, `${kindPrefix}%`],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => this.#toItem(row, fingerprints));
  }

  /** Every reach reading of these posts since `at`, oldest first: the counter as read, null when unreadable. */
  async reachReadings(itemIds: readonly ItemId[], at: Millis): Promise<ReadonlyMap<string, readonly { atMs: number; reach: number | null }[]>> {
    const out = new Map<string, { atMs: number; reach: number | null }[]>();
    if (itemIds.length === 0) return out;
    const rows = await this.#db.query<{ item_id: string; captured_at: Date; value: number | null; fidelity_kind: string }>(
      `select item_id, captured_at, value, fidelity_kind from public.observation
        where item_id = any($1::text[]) and kind = 'reach' and captured_at >= $2
        order by item_id, captured_at`,
      [[...itemIds], toTimestamp(at)],
    );
    for (const r of rows) {
      const list = out.get(r.item_id) ?? [];
      list.push({ atMs: new Date(r.captured_at).getTime(), reach: r.fidelity_kind === 'absent' || r.value === null ? null : Number(r.value) });
      out.set(r.item_id, list);
    }
    return out;
  }

  /** Which of these posts a story's backfill fetched. */
  async backfilled(itemIds: readonly ItemId[]): Promise<ReadonlySet<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await this.#db.query<{ item_id: string }>('select item_id from internal.item_backfill where item_id = any($1::text[])', [[...itemIds]]);
    return new Set(rows.map((r) => r.item_id));
  }

  async byId(id: ItemId): Promise<Item | null> {
    const rows = await this.#db.query<ItemRow>(`${SELECT_ITEM} where item_id = $1`, [id]);
    const row = rows[0];
    if (!row) return null;
    return this.#toItem(row, await this.#fingerprintsFor([row.item_id]));
  }

  /**
   * A map rather than an array, and the difference is not cosmetic: a caller that
   * zips a returned array against the ids it asked for is silently wrong the first
   * time one of them is missing, and an item disappearing between two stages is
   * normal rather than exceptional. A map makes the absence something the caller
   * has to meet.
   */
  async byIds(ids: readonly ItemId[]): Promise<ReadonlyMap<ItemId, Item>> {
    const found = new Map<ItemId, Item>();
    if (ids.length === 0) return found;

    const rows = await this.#db.query<ItemRow>(`${SELECT_ITEM} where item_id = any($1)`, [[...ids]]);
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    for (const row of rows) {
      const item = this.#toItem(row, fingerprints);
      found.set(item.itemId, item);
    }
    return found;
  }

  /**
   * The posts TRACK may spend a read on, NEWEST FIRST: the posts that are on screen.
   *
   *   - in a promoted story — the narratives, whose cards and pages show their views;
   *   - a row on the For You or Popular feed as the projector last committed it
   *     (`public.rising_row`, `rising.maxRows` per feed).
   *
   * Everything else keeps the readings discovery already paid for and no more. A post that
   * clears the score but has fallen off both feeds is no longer on screen and is no longer
   * re-read. Re-reads are the expensive part of the day; a post nobody can see is not
   * worth one.
   *
   * ★ NEWEST FIRST because reads are budgeted and views move fastest in a post's first
   * hours. Oldest first would spend a tight budget on posts that are days old.
   *
   * What this no longer includes, said so it is not rediscovered as a bug: posts ADMIT
   * passed, and with them ADMIT's holdout lane. Tracking every admitted post cost several
   * times the daily budget.
   *
   * Two more, because the feeds are fed by re-reads and the list above only re-reads what is
   * already on them — so a new post kept the one reading discovery paid for, never cleared a
   * reach bar, and the For You feed starved (2026-10-13):
   *
   *   - a catch-all post the judge has answered, posted since `watch.judgedSince` or already at
   *     `watch.judgedMinReach` — TRACK's gate keeps only the answers that can still pass, so this
   *     is a few dozen at a time. Not every answered post of the tracked day, because that was
   *     about $5 of reads; but an older one close to the bar is still worth reading, or a post
   *     at 38k after four hours could never be seen crossing 40k;
   *   - a catch-all post nobody has judged, posted within `watch.sinceMs` and averaging at least
   *     `watch.minPerMinute` reach a minute at its latest reading. Its reach decides whether it
   *     is judged at all; a slow one keeps its one reading.
   *
   *   - ★ and a post of `watch.longer.source` nobody has judged, posted within `watch.longer.since`
   *     and averaging `watch.longer.minPerMinute` — the short-video source, found 30 minutes to
   *     6 hours after posting, which the half-hour window above never holds (its growth paths run
   *     to four hours, `rising.shortVideoFastWindowMs`). Its re-reads are paid runs, capped by the
   *     runner's work/paid-reads.ts, so a wider window here costs nothing it has not budgeted.
   *
   * On-screen and judged posts sort first, so the unjudged watch list can never crowd them out
   * of the page TRACK pulls.
   *
   * TRACK narrows this further with `trackingFacts` (the runner's work/track-gate.ts): a story
   * member that can never be shown — a firm "no", a failed name test — is not re-read.
   */
  async trackable(
    at: Millis,
    limit: number,
    watch: {
      readonly now: Millis;
      readonly since: Millis;
      readonly minPerMinute: number;
      readonly judgedSince: Millis;
      readonly judgedMinReach: number;
      readonly longer?: { readonly source: string; readonly since: Millis; readonly minPerMinute: number };
    },
  ): Promise<readonly Item[]> {
    const rows = await this.#db.query<ItemRow>(
      `with recent as (
         select i.item_id, i.source, i.posted_at, i.first_seen_at,
                (exists (select 1 from public.story_member m
                           join public.story s on s.story_id = m.story_id
                          where m.item_id = i.item_id and s.state = 'promoted' and s.merged_into is null)
                 or exists (select 1 from public.rising_row r where r.item_id = i.item_id)
                 or (exists (select 1 from internal.item_found_by f where f.item_id = i.item_id)
                     and exists (select 1 from internal.post_judgement j where j.item_id = i.item_id)
                     and (i.posted_at >= $6
                          or (select o.value from public.observation o
                               where o.item_id = i.item_id and o.kind = 'reach' and o.value is not null
                               order by o.captured_at desc limit 1) >= $7))
                ) as kept
           from public.item i
          where i.first_seen_at >= $1
       ), picked as (
         select r.item_id, r.kept, r.first_seen_at from recent r
          where r.kept
             or (r.posted_at >= (case when r.source = $8 then $9::timestamptz else $3::timestamptz end)
                 and exists (select 1 from internal.item_found_by f where f.item_id = r.item_id)
                 and not exists (select 1 from internal.post_judgement j where j.item_id = r.item_id)
                 and (select o.value from public.observation o
                       where o.item_id = r.item_id and o.kind = 'reach' and o.value is not null
                       order by o.captured_at desc limit 1)
                     >= (case when r.source = $8 then $10::float8 else $4::float8 end) * greatest(extract(epoch from ($5::timestamptz - r.posted_at)) / 60, 1))
          order by r.kept desc, r.first_seen_at desc
          limit $2
       )
       select item.item_id, item.source, item.source_item_id, item.origin, item.author_key,
              item.posted_at, item.first_seen_at, item.lang, item.body, item.media, item.counters,
              item.rebroadcast_of, item.reproduction_of, item.format_ids, item.raw_ref
         from picked p
         join public.item item on item.item_id = p.item_id
        order by p.kept desc, p.first_seen_at desc`,
      [
        toTimestamp(at), limit, toTimestamp(watch.since), watch.minPerMinute, toTimestamp(watch.now), toTimestamp(watch.judgedSince), watch.judgedMinReach,
        /* No longer window: a source name nothing has, so every post takes the half-hour one. */
        watch.longer?.source ?? '', toTimestamp(watch.longer?.since ?? watch.since), watch.longer?.minPerMinute ?? watch.minPerMinute,
      ],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => this.#toItem(row, fingerprints));
  }

  /**
   * What TRACK needs to know before it pays to re-read these posts: which are on a feed now,
   * which a catch-all lane found, the promoted stories each is in, every member of those
   * stories, and the newest per-post judgement of each post and each member.
   *
   * Facts only — what the judge said and where the post sits. Whether that is worth a read is
   * the runner's call (work/track-gate.ts), held to core's own per-post rule, because the rule
   * has thresholds and a word count that do not belong in SQL.
   */
  async trackingFacts(itemIds: readonly ItemId[]): Promise<TrackingFacts> {
    const onFeed = new Set<string>();
    const catchAll = new Set<string>();
    const storiesOf = new Map<string, string[]>();
    const membersOf = new Map<string, string[]>();
    const judged = new Map<string, TrackingJudgement>();
    if (itemIds.length === 0) return { onFeed, catchAll, storiesOf, membersOf, judged };
    const ids = [...itemIds];

    const where = await this.#db.query<{ item_id: string; on_feed: boolean; catch_all: boolean }>(
      `select i.id as item_id,
              exists (select 1 from public.rising_row r where r.item_id = i.id) as on_feed,
              exists (select 1 from internal.item_found_by f where f.item_id = i.id) as catch_all
         from unnest($1::text[]) as i(id)`,
      [ids],
    );
    for (const row of where) {
      if (row.on_feed) onFeed.add(row.item_id);
      if (row.catch_all) catchAll.add(row.item_id);
    }

    const members = await this.#db.query<{ story_id: string; item_id: string; member_id: string }>(
      `select m.story_id, m.item_id, all_m.item_id as member_id
         from public.story_member m
         join public.story s on s.story_id = m.story_id
         join public.story_member all_m on all_m.story_id = m.story_id
        where m.item_id = any($1::text[]) and s.state = 'promoted' and s.merged_into is null`,
      [ids],
    );
    for (const row of members) {
      const stories = storiesOf.get(row.item_id) ?? [];
      if (!stories.includes(row.story_id)) storiesOf.set(row.item_id, [...stories, row.story_id]);
      const list = membersOf.get(row.story_id) ?? [];
      if (!list.includes(row.member_id)) membersOf.set(row.story_id, [...list, row.member_id]);
    }

    const everyone = [...new Set([...ids, ...members.map((m) => m.member_id)])];
    const answers = await this.#db.query<{ item_id: string; coinable: boolean; confidence: number; looked_at: TrackingJudgement['lookedAt']; proposed_name: string | null }>(
      `select distinct on (item_id) item_id, coinable, confidence, looked_at, proposed_name
         from internal.post_judgement
        where item_id = any($1::text[])
        order by item_id, judged_at desc, id desc`,
      [everyone],
    );
    for (const a of answers) {
      judged.set(a.item_id, { coinable: a.coinable, confidence: Number(a.confidence), lookedAt: a.looked_at, proposedName: a.proposed_name });
    }
    return { onFeed, catchAll, storiesOf, membersOf, judged };
  }

  /**
   * Items admitted since an instant, NEWEST first — the query ADMIT, DETECT and GROUP pull from.
   *
   * ★ NEWEST FIRST SINCE 2026-10-13. It was oldest first, with a limit: once two days of
   * discovery held more posts than one page, every page was the same oldest few thousand posts,
   * all already decided, and no stage ever reached a new one — GROUP placed nothing from 23:04
   * UTC on 2026-10-12 and the board emptied. Newest first, a stage that cannot keep up drops its
   * oldest work instead of all its new work. A stage that needs order inside a page (GROUP: an
   * original before its copies) sorts the page itself.
   *
   * `first_seen_at` IS the admission clock: an item is in this table because the
   * admit stage put it there, and the column is never moved forward on a re-arrival
   * (see upsert). It is not `posted_at`, which is the source's claim about the
   * world and is null whenever the source omits it or is known to lie.
   */
  async admittedSince(at: Millis, limit: number): Promise<readonly Item[]> {
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM} where first_seen_at >= $1 order by first_seen_at desc limit $2`,
      [toTimestamp(at), limit],
    );
    const fingerprints = await this.#fingerprintsFor(rows.map((row) => row.item_id));
    return rows.map((row) => this.#toItem(row, fingerprints));
  }

  /**
   * Items due a re-read, newest tier first.
   *
   * Left unimplemented deliberately, and throwing rather than returning `[]`. The
   * re-read cadence is the tracking policy — which tier an item is in at what age,
   * and how long a tier waits — and policy does not belong in SQL, which is exactly
   * where the previous build's schedule went to hide. There is also no column to
   * schedule against yet: `counters_observed_at` records when we last read, not when
   * we next should, and deriving the second from the first here would bury the
   * cadence in this file.
   *
   * A tracking loop that calls this gets a loud, named gap in
   * `internal.stage_runs.err`. One that got an empty array would look exactly like a
   * loop with nothing to do, which is the failure this whole package is a reaction to.
   */
  async dueForObservation(_now: Millis, _limit: number): Promise<readonly Item[]> {
    throw new NotImplemented(
      'ItemRepo.dueForObservation',
      'the re-read cadence is tracking policy and there is no next_read_at column to schedule against',
    );
  }

  async bySourceItemId(source: SourceId, sourceItemId: string): Promise<Item | null> {
    const rows = await this.#db.query<ItemRow>(
      `${SELECT_ITEM} where source = $1 and source_item_id = $2`,
      [source, sourceItemId],
    );
    const row = rows[0];
    if (!row) return null;
    return this.#toItem(row, await this.#fingerprintsFor([row.item_id]));
  }

  /**
   * The author row exists so the item's foreign key resolves and so follower counts
   * have somewhere to live. The key's shape — `<source>:<stable id>` — is assigned
   * by the adapter; splitting on the first colon is the store's only assumption
   * about it, and it is asserted rather than assumed.
   */
  async #ensureAuthor(item: Item): Promise<void> {
    const separator = item.authorKey.indexOf(':');
    if (separator <= 0) {
      throw new TypeError(
        `authorKey '${item.authorKey}' is not '<source>:<stable id>'; the adapter must namespace it`,
      );
    }
    await this.#db.query(
      `insert into public.author (author_key, source, source_author_id, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $4)
       on conflict (author_key) do update set last_seen_at = greatest(public.author.last_seen_at, excluded.last_seen_at)`,
      [
        item.authorKey,
        item.source,
        item.authorKey.slice(separator + 1),
        toTimestamp(item.firstSeenAt),
      ],
    );
  }

  /**
   * Carriers are append-only in practice: a fingerprint that once matched must keep
   * matching, or a story's membership stops being reproducible. Hence
   * `do nothing` rather than an update, and no delete path.
   */
  async #writeFingerprints(item: Item): Promise<void> {
    for (const fingerprint of item.fingerprints) {
      const width = fingerprint.bits;
      const imageBits =
        width !== undefined && fingerprint.kind === 'imageHash'
          ? toBitLiteral(fingerprint.key, width)
          : null;
      const textBits =
        width !== undefined && fingerprint.kind === 'textShingle'
          ? toBitLiteral(fingerprint.key, width)
          : null;

      await this.#db.query(
        `insert into public.item_fingerprint (item_id, kind, key, image_bits, text_bits)
         values ($1, $2, $3, $4::bit varying, $5::bit varying)
         on conflict (item_id, kind, key) do nothing`,
        [item.itemId, fingerprint.kind, fingerprint.key, imageBits, textBits],
      );
    }
  }

  async #fingerprintsFor(itemIds: readonly string[]): Promise<Map<string, Fingerprint[]>> {
    const byItem = new Map<string, Fingerprint[]>();
    if (itemIds.length === 0) return byItem;

    const rows = await this.#db.query<FingerprintRow>(
      `select item_id, kind, key from public.item_fingerprint where item_id = any($1)`,
      [[...itemIds]],
    );
    for (const row of rows) {
      const existing = byItem.get(row.item_id);
      const fingerprint: Fingerprint = { kind: row.kind, key: row.key };
      if (existing) existing.push(fingerprint);
      else byItem.set(row.item_id, [fingerprint]);
    }
    return byItem;
  }

  #toItem(row: ItemRow, fingerprints: Map<string, Fingerprint[]>): Item {
    return {
      itemId: reBrand<ItemId>(row.item_id),
      source: reBrand<SourceId>(row.source),
      sourceItemId: row.source_item_id,
      origin: row.origin,
      authorKey: reBrand(row.author_key),
      postedAt: toMillis(row.posted_at),
      firstSeenAt: toMillisRequired(row.first_seen_at, 'first_seen_at'),
      lang: row.lang,
      text: row.body,
      media: row.media,
      counters: row.counters,
      fingerprints: fingerprints.get(row.item_id) ?? [],
      rebroadcastOf: row.rebroadcast_of === null ? null : reBrand<ItemId>(row.rebroadcast_of),
      reproductionOf: row.reproduction_of === null ? null : reBrand<ItemId>(row.reproduction_of),
      formatIds: row.format_ids,
      rawRef: row.raw_ref,
    };
  }
}
