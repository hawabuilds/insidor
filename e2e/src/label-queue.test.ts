/**
 * The label job's queue (services/label db.ts dueSubjects) on the real schema: a subject with a
 * final label is never picked again, a subject whose window is open is not picked until it is due
 * (with the window anchored on a matched coin's mint exactly as labelWindow anchors it), a subject
 * that can be written now (ungradeable, no origin) is due at once, never-labelled subjects go ahead
 * of censored re-measurements, and with a small cap the queue moves forward from run to run.
 * PGlite, real migrations.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { dueSubjects } from '@insidor/label/src/db.ts';
import type { QueueRule } from '@insidor/label/src/db.ts';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-20T00:00:00Z');
const KINDS = ['item', 'story', 'candidate'] as const;
const rule = (nowMs = NOW): QueueRule => ({ labelName: 'peak_multiple', definition: 'v1', windowDays: 30, nowMs });
const ago = (days: number): Date => new Date(NOW - days * DAY);

async function decide(db: Db, stage: string, kind: string, id: string, verdict: string, origin: Date | null): Promise<void> {
  await db.query(
    `insert into internal.decisions (decided_at, stage, subject_kind, subject_id, feature_asof, subject_origin, verdict, reason, features, feature_set, feature_hash, policy_hash, decider, propensity)
     values ('2026-11-19T12:00:00Z', $1, $2, $3, '2026-11-19T12:00:00Z', $4, $5, 'test', '{}', 'test.v1', 'h', 'p', 'rule:test@1', 1)`,
    [stage, kind, id, origin, verdict],
  );
}

async function item(db: Db, id: string): Promise<void> {
  await db.query(
    `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, media, counters, counters_observed_at, raw_ref, origin)
     values ($1, 'x', $1, 'x:a', now(), now(), 'text', '[]', '{}', now(), 'x/' || $1 || '.json', 'observed')`,
    [id],
  );
}

async function story(db: Db, id: string, mergedInto: string | null = null): Promise<void> {
  await db.query(
    `insert into public.story (story_id, earliest_post_at, state, merged_into, origin) values ($1, now(), $2, $3, 'observed')`,
    [id, mergedInto === null ? 'candidate' : 'merged', mergedInto],
  );
}

async function coin(db: Db, address: string, minted: Date): Promise<void> {
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 5, 'C', 'Coin', '{}'::jsonb, $3, 'live_stream')`,
    [address, `solana:${address}`, minted],
  );
}

async function label(db: Db, kind: string, id: string, version: string, status: string, reason: string | null = null, labelName = 'peak_multiple'): Promise<void> {
  await db.query(
    `insert into internal.labels (subject_kind, subject_id, label_name, label_version, window_days, origin_ts, resolves_at, status, value, y, censor_reason, population, source, computed_at)
     values ($1, $2, $6, $3, 30, $7, $8, $4, null, case when $4 = 'resolved' then false end, $5, 'test population', 'test', now())`,
    [kind, id, version, status, reason, labelName, ago(60), ago(30)],
  );
}

async function base(): Promise<Db> {
  const db = await migratedDb();
  await db.query(`select internal.ensure_decision_partition('2026-11-19'::date)`);
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:a', 'x', 'a', 'poster')`);
  return db;
}

const ids = async (db: Db, limit = 100, nowMs = NOW): Promise<string[]> =>
  (await dueSubjects(db, KINDS, limit, rule(nowMs))).map((s) => `${s.subjectKind} ${s.subjectId}`);

test('an open window is not picked until it closes; a matched coin minted long ago makes it due now', async () => {
  const db = await base();
  await item(db, 'x:young');
  await decide(db, 'admit', 'item', 'x:young', 'pass', ago(10));
  await item(db, 'x:old');
  await decide(db, 'admit', 'item', 'x:old', 'pass', ago(31));

  /* A two-day-old story whose matched coin was minted 40 days ago: its window is the coin's, closed. */
  await story(db, 'story_s');
  await decide(db, 'qualify', 'story', 'story_s', 'abstain', ago(2));
  await coin(db, 'Old1', ago(40));
  await decide(db, 'resolve', 'candidate', 'story_s|solana:Old1', 'pass', ago(2));
  /* An item in that story inherits the coin's window. */
  await item(db, 'x:member');
  await db.query(`insert into public.story_member (story_id, item_id, evidence_kind) values ('story_s', 'x:member', 'seed')`);
  await decide(db, 'admit', 'item', 'x:member', 'pass', ago(2));
  /* An old story whose only coin was minted 5 days ago: the window is the coin's, still open. */
  await story(db, 'story_t');
  await decide(db, 'qualify', 'story', 'story_t', 'abstain', ago(45));
  await coin(db, 'New1', ago(5));
  await decide(db, 'resolve', 'candidate', 'story_t|solana:New1', 'abstain', ago(45));
  /* A dropped candidate is not a matched coin: this story stays on its own clock. */
  await story(db, 'story_u');
  await decide(db, 'qualify', 'story', 'story_u', 'abstain', ago(3));
  await coin(db, 'Old2', ago(50));
  await decide(db, 'resolve', 'candidate', 'story_u|solana:Old2', 'drop', ago(3));

  assert.deepEqual((await ids(db)).sort(), [
    'candidate story_s|solana:Old1',
    'candidate story_u|solana:Old2',
    'item x:member',
    'item x:old',
    'story story_s',
  ]);

  /* Eleven days on, x:young's thirty days are up; story_t's coin is still under thirty days old. */
  const later = await ids(db, 100, NOW + 21 * DAY);
  assert.ok(later.includes('item x:young'));
  assert.ok(!later.includes('story story_t') && !later.includes('candidate story_t|solana:New1'));
  assert.ok((await ids(db, 100, NOW + 26 * DAY)).includes('story story_t'));
});

test('a final label is never picked again; censored and no-origin stay in the queue, behind the unlabelled', async () => {
  const db = await base();
  for (const id of ['x:resolved', 'x:revised', 'x:censored', 'x:noorigin', 'x:fresh', 'x:olddef']) {
    await item(db, id);
    await decide(db, 'admit', 'item', id, 'pass', id === 'x:noorigin' ? null : ago(id === 'x:fresh' ? 35 : 40));
  }
  await story(db, 'story_live');
  await story(db, 'story_gone', 'story_live');
  await decide(db, 'qualify', 'story', 'story_gone', 'abstain', ago(40));

  await label(db, 'item', 'x:resolved', 'v1', 'resolved');
  await label(db, 'item', 'x:revised', 'v1', 'censored', 'coverage_gap_declared');
  await label(db, 'item', 'x:revised', 'v1.r2', 'resolved');
  await label(db, 'item', 'x:censored', 'v1', 'censored', 'coverage_gap_declared');
  await label(db, 'item', 'x:noorigin', 'v1', 'unresolvable', 'no_origin_recorded');
  await label(db, 'story', 'story_gone', 'v1', 'unresolvable', 'merged_into:story_live');
  /* A resolved row under another definition or another label says nothing about this one. */
  await label(db, 'item', 'x:olddef', 'v0', 'resolved');
  await label(db, 'item', 'x:olddef', 'v1', 'resolved', null, 'reproducers_6h');

  /* Unlabelled first (x:olddef, origin 40 days, then x:fresh, 35), then the re-measurements, oldest first. */
  assert.deepEqual(await ids(db), ['item x:olddef', 'item x:fresh', 'item x:censored', 'item x:noorigin']);
});

test('a subject that can be written now is due at once, whatever its origin', async () => {
  const db = await base();
  await decide(db, 'admit', 'item', 'x:deleted', 'pass', ago(1));
  await decide(db, 'qualify', 'story', 'story_missing', 'abstain', ago(1));
  await decide(db, 'resolve', 'candidate', 'no-separator', 'pass', ago(1));
  await item(db, 'x:clockless');
  await decide(db, 'admit', 'item', 'x:clockless', 'pass', null);
  await item(db, 'x:open');
  await decide(db, 'admit', 'item', 'x:open', 'pass', ago(1));
  assert.deepEqual((await ids(db)).sort(), ['candidate no-separator', 'item x:clockless', 'item x:deleted', 'story story_missing']);
});

test('with a small cap the queue moves forward from run to run, oldest first', async () => {
  const db = await base();
  for (let i = 1; i <= 5; i += 1) {
    await item(db, `x:${i}`);
    await decide(db, 'admit', 'item', `x:${i}`, 'pass', ago(60 - i));
  }
  const seen: string[][] = [];
  for (let run = 0; run < 3; run += 1) {
    const batch = await ids(db, 2);
    seen.push(batch);
    /* What main.ts does with a closed window it watched: a resolved row, terminal. */
    for (const key of batch) await label(db, 'item', key.slice('item '.length), 'v1', 'resolved');
  }
  assert.deepEqual(seen, [['item x:1', 'item x:2'], ['item x:3', 'item x:4'], ['item x:5']]);
  assert.deepEqual(await ids(db, 2), []);
});
