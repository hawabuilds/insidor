/**
 * The post slimming job (0101, store post-slim.ts) on the real schema: a week-old post that never
 * made For You keeps its item row, its first reading of each counter and its judge answer, and loses
 * its later readings, search record, picture link and cached count; every kept post and every
 * younger post is left exactly as it was; a dry run writes nothing; the readings stay append-only
 * for everyone else. PGlite, real migrations.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Db } from '@insidor/store';
import { runSlim, type ArchiveSlim, type InTransaction, type SlimArchive } from '@insidor/store/repo/post-slim.ts';

import { migratedDb } from './db.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const OLD = new Date(NOW - 8 * DAY);
const YOUNG = new Date(NOW - 2 * DAY);
/* Tiny batches and statements, so the loops and the cursor are exercised on a handful of rows. */
const POLICY = { ...DEFAULT_POLICY.slim, on: true, postsPerBatch: 2, rowsPerStatement: 2 };

const tx = (db: Db): InTransaction => async (fn) => {
  await db.query('begin');
  try {
    const out = await fn(db);
    await db.query('commit');
    return out;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
};

async function seed(db: Db): Promise<void> {
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:a', 'x', 'a', 'poster')`);
  const posts: [string, Date][] = [['plain', OLD], ['fyp', OLD], ['coined', OLD], ['called', OLD], ['young', YOUNG]];
  for (const [id, at] of posts) {
    await db.query(
      `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, media, counters, counters_observed_at, raw_ref, origin)
       values ($1, 'x', $2, 'x:a', $3, $3, 'text of ' || $2, '[{"uri":"https://pictures.example/p.jpg","kind":"image"}]', '{"reach":{"value":9}}', $3, 'x/' || $2 || '.json', 'observed')`,
      [`x:${id}`, id, at],
    );
    for (const kind of ['reach', 'approval']) {
      for (let i = 0; i < 4; i += 1) {
        await db.query(
          `insert into public.observation (item_id, kind, captured_at, value, fidelity_kind, observed_at, censored) values ($1, $2, $3, $4, 'exact', $3, 'below_step')`,
          [`x:${id}`, kind, new Date(at.getTime() + i * 600_000), 100 * (i + 1)],
        );
      }
    }
    await db.query(`insert into internal.item_found_by (item_id, lane, found_at) values ($1, 'all', $2)`, [`x:${id}`, at]);
  }
  await db.query(`insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at) values ('fyp', 'x:fyp', $1, $1)`, [OLD]);
  await db.query(
    `insert into internal.coin_post_link (asset_key, address, source, source_item_id, link, minted_at, found_at) values ('k', 'addr', 'x', 'coined', 'https://x.com/a/status/coined', $1, $1)`,
    [OLD],
  );
  await db.query(`insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict) values ('wallet:me', 'did:privy:owner', 'post', 'x:called', 'not')`);
}

const readings = async (db: Db, id: string) =>
  (await db.query<{ kind: string; value: number }>(`select kind, value from public.observation where item_id = $1 order by kind, captured_at`, [id])).map((r) => `${r.kind}:${r.value}`);

test('a week-old post nobody kept is slimmed to its first readings; kept and young posts are untouched', async () => {
  const db = await migratedDb();
  await seed(db);

  const dry = await runSlim(db, tx(db), POLICY, NOW, false);
  assert.equal(dry.kind, 'ran');
  if (dry.kind === 'ran') {
    assert.equal(dry.live, false);
    assert.equal(dry.batches.reduce((s, b) => s + b.slimmed, 0), 1, 'only the plain old post would slim');
    assert.equal(dry.batches.reduce((s, b) => s + b.readings, 0), 6);
  }
  assert.equal((await readings(db, 'x:plain')).length, 8, 'a dry run deletes nothing');
  assert.equal((await db.query(`select 1 from internal.post_slim_cursor`)).length, 0, 'nor moves the cursor');

  const archived: SlimArchive[] = [];
  const archive: ArchiveSlim = async (b) => { archived.push(b); };
  const live = await runSlim(db, tx(db), POLICY, NOW, true, { archive });
  assert.equal(live.kind, 'ran');
  if (live.kind === 'ran') {
    assert.equal(live.live, true);
    assert.equal(live.caughtUp, true);
    assert.equal(live.batches.reduce((s, b) => s + b.readings, 0), 6);
  }

  assert.deepEqual(await readings(db, 'x:plain'), ['approval:100', 'reach:100'], 'the first reading of each counter stays');
  const [item] = await db.query<{ body: string; media: unknown; counters: unknown; counters_observed_at: unknown }>(
    `select body, media, counters, counters_observed_at from public.item where item_id = 'x:plain'`,
  );
  assert.deepEqual(item, { body: 'text of plain', media: [], counters: {}, counters_observed_at: null });
  assert.equal((await db.query(`select 1 from internal.item_found_by where item_id = 'x:plain'`)).length, 0);
  assert.deepEqual(
    await db.query(`select item_id, readings_dropped, search_dropped from internal.post_slim`),
    [{ item_id: 'x:plain', readings_dropped: 6, search_dropped: 1 }],
  );
  /* ★ Archived first: every removed row, and the emptied fields, went to the archive as they were. */
  assert.equal(archived.reduce((s, b) => s + b.readings.length, 0), 6);
  assert.equal(archived.reduce((s, b) => s + b.searchRecords.length, 0), 1);
  assert.deepEqual(archived.flatMap((b) => b.itemFields.map((r) => r['item_id'])), ['x:plain']);
  assert.ok(archived.flatMap((b) => b.readings).every((r) => r['item_id'] === 'x:plain'), 'only the slimmed post');

  for (const id of ['x:fyp', 'x:coined', 'x:called', 'x:young']) {
    assert.equal((await readings(db, id)).length, 8, `${id} keeps every reading`);
    assert.equal((await db.query(`select 1 from internal.item_found_by where item_id = $1`, [id])).length, 1, `${id} keeps its search record`);
    const [row] = await db.query<{ n: number }>(`select jsonb_array_length(media) as n from public.item where item_id = $1`, [id]);
    assert.equal(row?.n, 1, `${id} keeps its picture link`);
  }

  const again = await runSlim(db, tx(db), POLICY, NOW, true, { archive });
  assert.equal(again.kind === 'ran' && again.batches.length, 0, 'the cursor is past every decided post');
});

test('readings stay append-only outside the job, and the job does nothing while off', async () => {
  const db = await migratedDb();
  await seed(db);
  await assert.rejects(db.query(`delete from public.observation where item_id = 'x:plain'`), /append-only/);
  await assert.rejects(db.query(`update public.observation set value = 1 where item_id = 'x:plain'`), /append-only/);
  const off = await runSlim(db, tx(db), { ...POLICY, on: false }, NOW, true);
  assert.equal(off.kind === 'ran' && off.live, false);
  assert.equal((await readings(db, 'x:plain')).length, 8);
});
