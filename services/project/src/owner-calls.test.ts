/** The owner's call on a post outranks the judge's, in both directions, and no call changes nothing. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { foldCoinCalls } from '@insidor/core';

import { loadOwnerPostCalls, ownCoins, withOwnerCall } from './owner-calls.ts';
import { postStanding, type RisingRow } from './rising.ts';

const ROW: RisingRow = {
  item_id: 'x:1',
  source: 'x',
  source_item_id: '1',
  posted_at: new Date(1_755_079_200_000),
  first_seen_at: new Date(1_755_079_260_000),
  body: 'a post',
  media: [],
  handle: 'someone',
  display_name: null,
  source_author_id: '1001',
  coinable: true,
  confidence: 0.99,
  looked_at: 'text',
  proposed_name: 'MOO',
  picture_similarity: null,
  story_id: null,
};

test('★ "Not a meme" hides a post the judge passed; "Is a meme" passes one it turned down', () => {
  assert.equal(postStanding(ROW), 'passes');
  assert.equal(postStanding({ ...ROW, owner_call: 'not' }), 'owner_not_meme');
  const turnedDown = { ...ROW, coinable: false };
  assert.notEqual(postStanding(turnedDown), 'passes');
  assert.equal(postStanding({ ...turnedDown, owner_call: 'meme' }), 'passes');
});

test('"Is a meme" passes a post the judge has not answered; with no call such a post is not scored', () => {
  const unjudged = { ...ROW, coinable: null, confidence: null, looked_at: null, proposed_name: null };
  assert.equal(postStanding({ ...unjudged, owner_call: 'meme' }), 'passes');
  assert.equal(postStanding(unjudged), 'not_scored');
});

test('no call leaves the judge alone, and an unknown post stays unknown', () => {
  assert.equal(withOwnerCall('judge_unsure', undefined), 'judge_unsure');
  assert.equal(withOwnerCall(undefined, undefined), undefined);
  assert.equal(withOwnerCall(undefined, 'not'), 'owner_not_meme');
});

test('★ the newest call per post is read, and only post calls', async () => {
  const seen: string[] = [];
  const db = {
    query: async (sql: string) => {
      seen.push(sql);
      return [{ item_id: 'x:1', verdict: 'meme' }, { item_id: 'x:2', verdict: 'not' }, { item_id: 'x:3', verdict: 'right' }];
    },
  };
  const calls = await loadOwnerPostCalls(db as never, ['x:1', 'x:2', 'x:3']);
  assert.deepEqual([...calls], [['x:1', 'meme'], ['x:2', 'not']]);
  assert.match(seen[0] ?? '', /subject_kind = 'post'/);
  assert.match(seen[0] ?? '', /order by item_id, created_at desc, id desc/);
  assert.deepEqual(await loadOwnerPostCalls(db as never, []), new Map());
});

test('★ the owner\'s pick after "Wrong coin" is the post\'s coin; taking back a "This is the coin" leaves none (KARL)', () => {
  const calls = foldCoinCalls([
    { itemId: 'x:picked', verdict: 'wrong', coinAddress: null, shownCoin: 'SHOWN', atMs: 1, id: 1 },
    { itemId: 'x:picked', verdict: 'wrong', coinAddress: 'PICKED', shownCoin: 'SHOWN', atMs: 2, id: 2 },
    { itemId: 'x:karl', verdict: 'right', coinAddress: 'KARL', shownCoin: null, atMs: 1, id: 3 },
    { itemId: 'x:karl', verdict: 'wrong', coinAddress: 'KARL', shownCoin: null, atMs: 2, id: 4 },
  ]);
  assert.deepEqual([...ownCoins(calls)], [['x:picked', 'PICKED']]);
});
