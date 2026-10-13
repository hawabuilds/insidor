import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { orderNarratives, postsLine, stageLabel } from './narrative-order.ts';

const list = sampleNarrativeIds().map((id) => decodeStory(fixtureStory(id)));

test('Popular is most viewed first', () => {
  const amounts = orderNarratives(list, 'popular').map((s) => (s.reach.known ? s.reach.amount : -1));
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
});

test('New is newest first', () => {
  const ats = orderNarratives(list, 'new').map((s) => (s.firstSeenAt.known ? s.firstSeenAt.at : 0));
  assert.deepEqual(ats, [...ats].sort((a, b) => b - a));
});

test('a narrative with no known start goes last, never first', () => {
  const base = list[0];
  assert.ok(base);
  const unknown = { ...base, id: 'u', firstSeenAt: { known: false, pending: 'not_read_yet' } } as const;
  const ordered = orderNarratives([unknown, ...list], 'new');
  assert.equal(ordered[ordered.length - 1]?.id, 'u');
});

test('the posts line counts posts and names each site once', () => {
  const jimothy = list.find((s) => s.id === 'nr_jimothy');
  assert.ok(jimothy);
  assert.equal(postsLine(jimothy), '9 posts on X, TikTok');
});

test('the stage label is the server\'s word, and no label when it sent none', () => {
  const base = list[0];
  assert.ok(base);
  assert.equal(stageLabel({ ...base, stage: 'forming' }), 'Forming');
  assert.equal(stageLabel({ ...base, stage: 'big' }), 'Big');
  assert.equal(stageLabel({ ...base, stage: null }), null);
});
