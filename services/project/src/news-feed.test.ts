/**
 * FOR YOU IS FRESH MEMES; NEWS IS NEWS WITH A COIN IN IT.
 *
 * Two rules from 2026-10-13, tested where they meet: the six-hour freshness rule
 * (fyp-freshness.ts) and the News feed (news.ts), both applied in rising.ts `buildRising`. The
 * database is a fake that answers each statement by what it reads, as db.test.ts does: the claim
 * here is what the projector does with the rows, not what Postgres returns.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { Db } from '@insidor/store';

import { newsPasses } from './news.ts';
import { buildRising } from './rising.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 1_760_000_000_000;

/* ── news, alone ──────────────────────────────────────────────────────── */

const NEWS: Parameters<typeof newsPasses>[0] & Record<string, unknown> = {
  item_id: 'x:2',
  source: 'x',
  source_item_id: '2',
  posted_at: new Date(NOW - HOUR),
  first_seen_at: new Date(NOW - HOUR),
  body: 'the goalkeeper scored from his own box',
  media: null,
  handle: 'clips',
  display_name: null,
  source_author_id: '2',
  coinable: true,
  confidence: 0.9,
  looked_at: 'text',
  proposed_name: 'KEEPERGOAL',
  picture_similarity: null,
  story_id: null,
  owner_call: null,
  kind: 'SPORT',
};

test('★ a news post is News when the first answer passed, or its coin is confident', () => {
  assert.equal(newsPasses(NEWS, { kind: 'pending' }), true);
  const notCoinable = { ...NEWS, coinable: false, proposed_name: null };
  assert.equal(newsPasses(notCoinable, { kind: 'pending' }), false);
  assert.equal(newsPasses(notCoinable, { kind: 'unsure', claimCount: 3 }), false, 'an unsure list is not a coin');
  assert.equal(newsPasses(notCoinable, { kind: 'matched', coin: {} as never, evidence: {} as never }), true);
});

test('an ad, a fan post or a tragedy is never News; the owner\'s call takes a post off it', () => {
  for (const kind of ['AD', 'FANDOM', 'TRAGEDY', 'OTHER']) assert.equal(newsPasses({ ...NEWS, kind }, { kind: 'pending' }), false, kind);
  assert.equal(newsPasses({ ...NEWS, kind: ' corp_news ' }, { kind: 'pending' }), true, 'read as the runner reads it');
  assert.equal(newsPasses({ ...NEWS, owner_call: 'not' }, { kind: 'pending' }), false);
});

/* ── the projector, with both ─────────────────────────────────────────── */

function row(id: string, postedAgoMs: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    item_id: id, source: 'x', source_item_id: id.slice(2), posted_at: new Date(NOW - postedAgoMs), first_seen_at: new Date(NOW - postedAgoMs),
    body: `post ${id}`, media: null, handle: 'someone', display_name: null, source_author_id: '1',
    coinable: true, confidence: 0.95, looked_at: 'text', proposed_name: 'MOODENG', picture_similarity: null, story_id: null, owner_call: null,
    ...extra,
  };
}

function reading(id: string, agoMs: number, level: number): Record<string, unknown> {
  return { item_id: id, captured_at: new Date(NOW - agoMs), fidelity_kind: 'quantized', rate_per_min: 1, censored: null, rate_over_ms: MIN, rate_level: level, rate_last_level: null };
}

/** Answers each statement by what it reads; anything else is empty. */
function fakeDb(memes: Record<string, unknown>[], news: Record<string, unknown>[], readings: Record<string, unknown>[]): Db {
  return {
    query: async (sql: string) => {
      if (sql.includes('k.prompt_id like')) return news;
      if (sql.includes('internal.item_found_by')) return memes;
      if (sql.includes('from public.observation')) return readings;
      return [];
    },
  } as unknown as Db;
}

test('★ For You drops a slow post over six hours old and keeps it on Popular; News takes the news post', async () => {
  const memes = [
    row('x:1', 1 * HOUR), // young
    row('x:3', 10 * HOUR), // old and stalled, big enough for Popular
    row('x:4', 10 * HOUR), // old and still climbing fast
    /* The news post as For You's load sees it: the first answer, held by its kind label. */
    row('x:2', 2 * HOUR, { kind_label: 'SPORT' }),
  ];
  const news = [row('x:2', 2 * HOUR, { kind: 'SPORT' }), row('x:5', 3 * HOUR, { kind: 'POLITICS', coinable: false, proposed_name: null })];
  const readings = [
    reading('x:1', 30 * MIN, 50_000),
    reading('x:3', 50 * MIN, 400_000), reading('x:3', 5 * MIN, 401_000),
    reading('x:4', 50 * MIN, 400_000), reading('x:4', 5 * MIN, 500_000),
    reading('x:2', 30 * MIN, 90_000),
    reading('x:5', 30 * MIN, 90_000),
  ];
  const frame = await buildRising(fakeDb(memes, news, readings), NOW as Millis, new Map(), 30 * MIN);
  assert.deepEqual(frame.fyp.map((p) => p.id), ['x:1', 'x:4'], 'the stalled old post left For You, the climbing one stayed');
  assert.deepEqual(frame.popular.map((p) => p.id), ['x:4', 'x:3'], 'Popular keeps old posts, and holds no news');
  assert.deepEqual(frame.news.map((p) => p.id), ['x:2'], 'the coinable news post, not the one with no coin in it');
  assert.equal(frame.whyNot.has('x:3'), false, 'going stale is not a rejection');
});

test('a news post must clear For You\'s views bar too', async () => {
  const news = [row('x:2', 2 * HOUR, { kind: 'SPORT' })];
  const frame = await buildRising(fakeDb([], news, [reading('x:2', 30 * MIN, 5_000)]), NOW as Millis, new Map(), 30 * MIN);
  assert.deepEqual(frame.news, []);
});
