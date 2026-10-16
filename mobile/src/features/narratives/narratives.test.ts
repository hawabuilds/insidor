import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import type { Story } from '../../shared/api/index.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { anyLastHour, byLastHour, lastHourLine, postsLine, realNarratives, stageLabel } from './narrative-order.ts';

const list = sampleNarrativeIds().map((id) => decodeStory(fixtureStory(id)));
const base = list[0] as Story;
const gained = (id: string, v: number | null): Story => ({ ...base, id, viewsGained1h: v === null ? null : { known: true, amount: v } });

test('★ fastest-growing first, by views gained in the last hour', () => {
  const ordered = byLastHour([gained('a', 10), gained('b', 900), gained('c', 50)]);
  assert.deepEqual(ordered.map((s) => s.id), ['b', 'c', 'a']);
});

test('★ a narrative whose last hour is unknown goes after every known one, in the order it came, never as zero', () => {
  const unknown = { ...base, id: 'u', viewsGained1h: { known: false, pending: 'not_read_yet' } } as Story;
  const ordered = byLastHour([gained('n', null), unknown, gained('a', -5), gained('b', 3)]);
  assert.deepEqual(ordered.map((s) => s.id), ['b', 'a', 'n', 'u']);
  assert.equal(anyLastHour([gained('n', null), unknown]), false);
});

test('★ only narratives the server says happened, with a post', () => {
  const seeded = { ...base, id: 's', provenance: { kind: 'seeded', connectSourceLabel: 'X' } } as Story;
  const unstated = { ...base, id: 'x', provenance: { kind: 'unstated' } } as Story;
  const empty = { ...base, id: 'e', evidence: [] } as Story;
  const real = { ...base, id: 'r', provenance: { kind: 'observed' } } as Story;
  assert.deepEqual(realNarratives([seeded, unstated, empty, real]).map((s) => s.id), ['r']);
});

test('the last hour line is the server\'s gain, or nothing', () => {
  assert.equal(lastHourLine(gained('a', 12_400)), '+12K last hour');
  assert.equal(lastHourLine(gained('a', null)), null);
});

test('the posts line counts posts and names each site once', () => {
  const jimothy = list.find((s) => s.id === 'nr_jimothy');
  assert.ok(jimothy);
  assert.equal(postsLine(jimothy), '9 posts on X, TikTok');
});

test('the stage label is the server\'s word, and no label when it sent none', () => {
  assert.equal(stageLabel({ ...base, stage: 'forming' }), 'Forming');
  assert.equal(stageLabel({ ...base, stage: 'big' }), 'Big');
  assert.equal(stageLabel({ ...base, stage: null }), null);
});
