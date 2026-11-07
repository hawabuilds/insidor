/**
 * THE POSTS THAT NEVER MADE FOR YOU, SLIMMED A WEEK AFTER WE FOUND THEM (0101, Policy.slim): which
 * posts are kept whole, which are slimmed, and the deletes that slim them, a batch at a time.
 *
 * Its own repository because it is the only code allowed to delete from public.observation, and
 * the keep rule that decides it must live next to the delete, not in a caller that could pass any
 * list of ids. Every delete here re-checks the keep rule in the same transaction, so a post that
 * became kept a second before (the owner called it, a coin named it) is never touched.
 *
 * ★ KEPT WHOLE, FOREVER (`KEEP_SOURCES`): on For You or Popular (the scroll, the frame, the frame's
 * hourly history), on a narrative or its page, coined (a coin's metadata names it, the origin check
 * matched it, the namer learned from it, the older-coin check or a create pick used it), on the gold
 * or missed lists, called, seen or watched by the owner, or labelled by the label job. GROUP's
 * machine clusters (public.story_member) are deliberately not a reason: eight posts in ten are in one.
 *
 * ★ WHAT A SLIMMED POST KEEPS: its item row (link, text, account, platform; the picture link and the
 * cached newest count are emptied), the FIRST reading of each counter (the views when found), its
 * judge answers, every label, its picture vector and fingerprints. What leaves the database: every
 * later reading, its search record (internal.item_found_by), its raw capture, and the emptied fields —
 * ARCHIVED FIRST (`ArchiveSlim`, the owner 2026-11-07): stored and checked before anything is deleted.
 * A row in internal.post_slim says it happened, so anything drawing the post can say "later readings
 * dropped" instead of a flat line.
 *
 * ★ BOUNDED. One transaction per batch of posts (Policy.slim.postsPerBatch), each DELETE at most
 * `rowsPerStatement` rows through the observation primary key, a short lock_timeout, and a
 * transaction-scoped advisory lock so two runs never interleave. The cursor moves only in the batch's
 * own transaction: a run killed halfway redoes at most one batch, and every step is idempotent.
 *
 * What breaks if changed carelessly: the keep rule. A source dropped from `KEEP_SOURCES` silently
 * deletes the readings of every post it held, and nothing can buy them back. A new table that marks
 * a post as worth keeping must be added here the day it is created. `set_config('insidor.slim', 'on',
 * true)` must stay transaction-local: a session-level setting would open 0101's door for whatever
 * borrows the pooled connection next.
 */

import type { SlimPolicy } from '@insidor/contracts/policy.ts';

import type { Db } from '../client.ts';

/** Runs `fn` in one transaction. The store's `withTransaction` bound to a pool; a test passes a fake. */
export type InTransaction = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** Every table whose row for a post keeps that post whole. Checked present before a run. */
export const KEEP_SOURCES: readonly string[] = [
  'public.feed_post',
  'internal.feed_history',
  'public.rising_row',
  'internal.narrative_member',
  'internal.narrative',
  'public.story_post',
  'internal.owner_feedback',
  'internal.owner_seen',
  'people.post_watch',
  'internal.labels',
  'internal.missed_post',
  'internal.gold_addition',
  'internal.coined_video',
  'internal.coin_origin',
  'internal.coin_post_link',
  'internal.name_example',
  'internal.label_embedding',
  'internal.create_pick',
  'internal.name_watch_addition',
  'internal.older_coin',
  'internal.recall_check',
];

/* $1 = the batch's item ids. Returns the kept ones. Each branch is a semi-join on an indexed or a
   small table; coin_origin has no index on post_item_id and is read whole (≈115k rows, tens of ms) —
   ONCE, as an IN list the planner hashes. Written as a correlated EXISTS it was re-read for every post
   of the batch, 500 scans, and the run hit its statement limit before it decided one batch (2026-11-07). */
const KEPT_SQL = `
  with b as (select item_id, source, source_item_id from public.item where item_id = any($1::text[]))
  select b.item_id from b
   where exists (select 1 from public.feed_post x where x.item_id = b.item_id)
      or exists (select 1 from internal.feed_history x where x.item_id = b.item_id)
      or exists (select 1 from public.rising_row x where x.item_id = b.item_id)
      or exists (select 1 from internal.narrative_member x where x.item_id = b.item_id)
      or exists (select 1 from internal.narrative x where x.anchor_item = b.item_id)
      or exists (select 1 from public.story_post x where x.item_id = b.item_id)
      or exists (select 1 from internal.owner_feedback x
                  where x.item_id = b.item_id or b.item_id = any(x.members) or b.item_id = any(x.other_members))
      or exists (select 1 from internal.owner_seen x where x.item_id = b.item_id)
      or exists (select 1 from people.post_watch x where x.item_id = b.item_id)
      or exists (select 1 from internal.labels x where x.subject_kind = 'item' and x.subject_id = b.item_id)
      or exists (select 1 from internal.missed_post x
                  where x.item_id = b.item_id or (x.source = b.source and x.source_item_id = b.source_item_id))
      or exists (select 1 from internal.gold_addition x where x.item_id = b.item_id)
      or exists (select 1 from internal.coined_video x where x.item_id = b.item_id)
      or b.item_id in (select x.post_item_id from internal.coin_origin x where x.post_item_id is not null)
      or exists (select 1 from internal.coin_post_link x where x.source = b.source and x.source_item_id = b.source_item_id)
      or exists (select 1 from internal.name_example x where x.item_id = b.item_id)
      or exists (select 1 from internal.label_embedding x where x.item_id = b.item_id)
      or exists (select 1 from internal.create_pick x where x.item_id = b.item_id)
      or exists (select 1 from internal.name_watch_addition x where x.item_id = b.item_id)
      or exists (select 1 from internal.older_coin x where x.item_id = b.item_id)
      or exists (select 1 from internal.recall_check x where x.post_platform = b.source and x.post_id = b.source_item_id)`;

/* A reading is "later" when the same post has an earlier reading of the same counter. Through the
   primary key (item_id, kind, captured_at), so a batch never scans the table. */
const LATER_READINGS = `
  from public.observation o
 where o.item_id = any($1::text[])
   and exists (select 1 from public.observation f
                where f.item_id = o.item_id and f.kind = o.kind and f.captured_at < o.captured_at)`;

/** Where the job has got to: the last post decided, in (first_seen_at, item_id) order. */
export interface SlimCursor {
  readonly firstSeenAt: string;
  readonly itemId: string;
}

export interface SlimBatch {
  readonly decided: number;
  readonly kept: number;
  readonly slimmed: number;
  readonly readings: number;
  /** Column bytes of the readings (pg_column_size of the rows; the disk cost adds headers and index entries). */
  readonly readingBytes: number;
  readonly searchRecords: number;
  readonly rawCaptures: number;
  /** Column bytes of the picture links and cached counts emptied on the item rows. */
  readonly itemBytes: number;
  readonly cursor: SlimCursor;
}

export type SlimRunOutcome =
  | { readonly kind: 'ran'; readonly live: boolean; readonly batches: readonly SlimBatch[]; readonly caughtUp: boolean }
  | { readonly kind: 'not_migrated'; readonly missing: readonly string[] }
  | { readonly kind: 'busy' };

const START: SlimCursor = { firstSeenAt: '-infinity', itemId: '' };
const LOCK_KEY = "hashtext('insidor.post_slim')";

/**
 * Tables the job needs that are not there: every keep source, and 0101's own when it is to write
 * (a dry run measures before 0101 is applied). Empty = ready. A missing keep source stops the run:
 * without it the rule cannot tell which posts that table would have kept.
 */
export async function missingTables(db: Db, writing: boolean): Promise<readonly string[]> {
  const want = ['raw.capture', ...(writing ? ['internal.post_slim', 'internal.post_slim_cursor'] : []), ...KEEP_SOURCES];
  const rows = await db.query<{ name: string; present: string | null }>(
    `select name, to_regclass(name)::text as present from unnest($1::text[]) as name`,
    [want],
  );
  return rows.filter((r) => r.present === null).map((r) => r.name);
}

export async function readCursor(db: Db): Promise<SlimCursor> {
  const rows = await db.query<{ first_seen_at: string; item_id: string }>(
    `select first_seen_at::text, item_id from internal.post_slim_cursor where id`,
  );
  const row = rows[0];
  return row === undefined ? START : { firstSeenAt: row.first_seen_at, itemId: row.item_id };
}

/** The next posts to decide: after the cursor, first seen before the cutoff, oldest first. */
export async function nextPosts(db: Db, after: SlimCursor, cutoffIso: string, limit: number): Promise<readonly { itemId: string; firstSeenAt: string }[]> {
  /* Ordered by the column, not by the text it is returned as; the row comparison rides the
     first_seen_at index as its lower bound. */
  const rows = await db.query<{ item_id: string; seen: string }>(
    `select i.item_id, i.first_seen_at::text as seen from public.item i
      where (i.first_seen_at, i.item_id) > ($1::timestamptz, $2::text) and i.first_seen_at < $3::timestamptz
      order by i.first_seen_at, i.item_id
      limit $4`,
    [after.firstSeenAt, after.itemId, cutoffIso, limit],
  );
  return rows.map((r) => ({ itemId: r.item_id, firstSeenAt: r.seen }));
}

export async function keptAmong(db: Db, ids: readonly string[]): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.query<{ item_id: string }>(KEPT_SQL, [ids]);
  return new Set(rows.map((r) => r.item_id));
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** What slimming `ids` would remove, counted without writing. */
async function measure(db: Db, ids: readonly string[]): Promise<Omit<SlimBatch, 'decided' | 'kept' | 'slimmed' | 'cursor'>> {
  if (ids.length === 0) return { readings: 0, readingBytes: 0, searchRecords: 0, rawCaptures: 0, itemBytes: 0 };
  const [r] = await db.query<Record<string, unknown>>(
    `select (select count(*) ${LATER_READINGS}) as readings,
            (select coalesce(sum(pg_column_size(o.*)), 0) ${LATER_READINGS}) as reading_bytes,
            (select count(*) from internal.item_found_by f where f.item_id = any($1::text[])) as search_records,
            (select count(*) from raw.capture c join public.item i on i.raw_ref = c.raw_ref where i.item_id = any($1::text[])) as raw_captures,
            (select coalesce(sum(pg_column_size(i.media) + pg_column_size(i.counters)), 0) from public.item i
              where i.item_id = any($1::text[]) and (i.media <> '[]'::jsonb or i.counters <> '{}'::jsonb)) as item_bytes`,
    [ids],
  );
  return {
    readings: num(r?.['readings']),
    readingBytes: num(r?.['reading_bytes']),
    searchRecords: num(r?.['search_records']),
    rawCaptures: num(r?.['raw_captures']),
    itemBytes: num(r?.['item_bytes']),
  };
}

/** Everything a batch removes, each row as stored (`to_jsonb`), handed to the archive before any of it goes. */
export interface SlimArchive {
  readonly readings: readonly Record<string, unknown>[];
  readonly searchRecords: readonly Record<string, unknown>[];
  readonly rawCaptures: readonly Record<string, unknown>[];
  /** Each emptied post's picture link and cached counts, as they were. */
  readonly itemFields: readonly Record<string, unknown>[];
}

/**
 * ★ ARCHIVED FIRST (the owner, 2026-11-07: "archive first"). Stores a batch and resolves only once it
 * is read back and checked; any failure must throw, which rolls the batch back with nothing removed.
 */
export type ArchiveSlim = (batch: SlimArchive, cursor: SlimCursor) => Promise<void>;

/** Removed rows counted against archived ones; a difference rolls the batch back. */
function same(what: string, removed: number, archived: number): void {
  if (removed !== archived) throw new Error(`post slimming: removed ${removed} ${what} but archived ${archived}; the batch is rolled back`);
}

/**
 * Slims `ids` (already re-checked as not kept, in this transaction). Returns what went.
 *
 * ★ ONLY WHAT WAS ARCHIVED, BY ITS OWN KEY. The rows are read, archived and checked, then deleted by
 * their primary keys, never again by the rule: a reading that lands between the read and the delete
 * is not in the archive, so it is not deleted either. Each delete's count must equal the archive's.
 */
async function slim(db: Db, ids: readonly string[], rowsPerStatement: number, archive: ArchiveSlim, cursor: SlimCursor): Promise<Omit<SlimBatch, 'decided' | 'kept' | 'slimmed' | 'cursor' | 'readingBytes' | 'itemBytes'>> {
  if (ids.length === 0) return { readings: 0, searchRecords: 0, rawCaptures: 0 };
  type Keyed = { k1: string; k2: string | null; k3: string | null; row: Record<string, unknown> };
  const readings = await db.query<Keyed>(`select o.item_id as k1, o.kind as k2, o.captured_at::text as k3, to_jsonb(o) as row ${LATER_READINGS}`, [ids]);
  const found = await db.query<Keyed>(`select x.item_id as k1, null as k2, null as k3, to_jsonb(x) as row from internal.item_found_by x where x.item_id = any($1::text[])`, [ids]);
  const raws = await db.query<Keyed>(
    `select distinct on (c.raw_ref) c.raw_ref as k1, null as k2, null as k3, to_jsonb(c) as row
       from raw.capture c join public.item i on i.raw_ref = c.raw_ref where i.item_id = any($1::text[])`,
    [ids],
  );
  const items = await db.query<Keyed>(
    `select item_id as k1, null as k2, null as k3,
            jsonb_build_object('item_id', item_id, 'media', media, 'counters', counters, 'counters_observed_at', counters_observed_at) as row
       from public.item where item_id = any($1::text[]) and (media <> '[]'::jsonb or counters <> '{}'::jsonb or counters_observed_at is not null)`,
    [ids],
  );
  await archive({ readings: readings.map((r) => r.row), searchRecords: found.map((r) => r.row), rawCaptures: raws.map((r) => r.row), itemFields: items.map((r) => r.row) }, cursor);

  /* The ledger, with each post's counts from what was archived. */
  const count = (rows: readonly Keyed[], id: string) => rows.filter((r) => r.k1 === id).length;
  await db.query(
    `insert into internal.post_slim (item_id, readings_dropped, search_dropped)
     select * from unnest($1::text[], $2::bigint[], $3::bigint[])
     on conflict (item_id) do update
        set readings_dropped = internal.post_slim.readings_dropped + excluded.readings_dropped,
            search_dropped = internal.post_slim.search_dropped + excluded.search_dropped`,
    [ids, ids.map((id) => count(readings, id)), ids.map((id) => count(found, id))],
  );
  await db.query(`select set_config('insidor.slim', 'on', true)`);
  let removed = 0;
  for (let i = 0; i < readings.length; i += rowsPerStatement) {
    const part = readings.slice(i, i + rowsPerStatement);
    const [d] = await db.query<{ n: string }>(
      `with gone as (
         delete from public.observation o using unnest($1::text[], $2::text[], $3::timestamptz[]) as k(item_id, kind, captured_at)
          where o.item_id = k.item_id and o.kind = k.kind and o.captured_at = k.captured_at
         returning 1)
       select count(*)::text as n from gone`,
      [part.map((r) => r.k1), part.map((r) => r.k2), part.map((r) => r.k3)],
    );
    removed += num(d?.n);
  }
  await db.query(`select set_config('insidor.slim', 'off', true)`);
  same('readings', removed, readings.length);
  const [f] = await db.query<{ n: string }>(
    `with gone as (delete from internal.item_found_by where item_id = any($1::text[]) returning 1) select count(*)::text as n from gone`,
    [found.map((r) => r.k1)],
  );
  same('search records', num(f?.n), found.length);
  const [c] = await db.query<{ n: string }>(
    `with gone as (delete from raw.capture where raw_ref = any($1::text[]) returning 1) select count(*)::text as n from gone`,
    [raws.map((r) => r.k1)],
  );
  same('raw captures', num(c?.n), raws.length);
  await db.query(
    `update public.item set media = '[]'::jsonb, counters = '{}'::jsonb, counters_observed_at = null where item_id = any($1::text[])`,
    [items.map((r) => r.k1)],
  );
  return { readings: removed, searchRecords: num(f?.n), rawCaptures: num(c?.n) };
}

/**
 * One run: up to `batchesPerRun` batches from the cursor. Live only when `live` and Policy.slim.on
 * are both true; otherwise every batch is measured, nothing is written, and the cursor is walked in
 * memory — so a dry run's first batches are exactly what the live run's would be.
 */
export async function runSlim(
  db: Db,
  inTransaction: InTransaction,
  policy: SlimPolicy,
  nowMs: number,
  live: boolean,
  options: { readonly from?: SlimCursor; readonly archive?: ArchiveSlim } = {},
): Promise<SlimRunOutcome> {
  const writing = live && policy.on;
  const archive = options.archive;
  if (writing && archive === undefined) throw new Error('post slimming removes only what it has archived, and no archive was given');
  const missing = await missingTables(db, writing);
  if (missing.length > 0) return { kind: 'not_migrated', missing };
  const cutoffIso = new Date(nowMs - policy.afterMs).toISOString();
  let cursor = options.from ?? (await readCursor(db));
  const batches: SlimBatch[] = [];
  let caughtUp = false;
  for (let i = 0; i < policy.batchesPerRun; i += 1) {
    const posts = await nextPosts(db, cursor, cutoffIso, policy.postsPerBatch);
    if (posts.length === 0) {
      caughtUp = true;
      break;
    }
    const last = posts[posts.length - 1]!;
    const next: SlimCursor = { firstSeenAt: last.firstSeenAt, itemId: last.itemId };
    const ids = posts.map((p) => p.itemId);
    const batch = await inTransaction(async (tx) => {
      await tx.query(
        `select set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)`,
        [`${policy.lockTimeoutMs}ms`, `${policy.statementTimeoutMs}ms`],
      );
      const [lock] = await tx.query<{ ok: boolean }>(`select pg_try_advisory_xact_lock(${LOCK_KEY}) as ok`);
      if (lock?.ok !== true) return null;
      const kept = await keptAmong(tx, ids);
      const slimIds = ids.filter((id) => !kept.has(id));
      let counted = await measure(tx, slimIds);
      if (writing && archive !== undefined) {
        counted = { ...counted, ...(await slim(tx, slimIds, policy.rowsPerStatement, archive, next)) };
        await tx.query(
          `insert into internal.post_slim_cursor (id, first_seen_at, item_id, updated_at) values (true, $1::timestamptz, $2, now())
           on conflict (id) do update set first_seen_at = excluded.first_seen_at, item_id = excluded.item_id, updated_at = now()`,
          [next.firstSeenAt, next.itemId],
        );
      }
      return { decided: ids.length, kept: kept.size, slimmed: slimIds.length, ...counted, cursor: next } satisfies SlimBatch;
    });
    if (batch === null) return { kind: 'busy' };
    batches.push(batch);
    cursor = next;
  }
  return { kind: 'ran', live: writing, batches, caughtUp };
}
