import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import type { Story } from '../../shared/api/index.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { storyCoinState } from '../narrative/story-coin.ts';
import { anyLastHour, byLastHour, lastHourGain, ordered, postsLine, realNarratives } from './narrative-order.ts';

const list = sampleNarrativeIds().map((id) => decodeStory(fixtureStory(id)));
const base = list[0] as Story;
const gained = (id: string, v: number | null): Story => ({ ...base, id, viewsGained1h: v === null ? null : { known: true, amount: v } });

test('★ fastest-growing first, by views gained in the last hour', () => {
  const sorted = byLastHour([gained('a', 10), gained('b', 900), gained('c', 50)]);
  assert.deepEqual(sorted.map((s) => s.id), ['b', 'c', 'a']);
});

test('★ a narrative whose number is unknown goes after every known one, in the order it came, never as zero', () => {
  const unknown = { ...base, id: 'u', viewsGained1h: { known: false, pending: 'not_read_yet' } } as Story;
  const sorted = byLastHour([gained('n', null), unknown, gained('a', -5), gained('b', 3)]);
  assert.deepEqual(sorted.map((s) => s.id), ['b', 'a', 'n', 'u']);
  assert.equal(anyLastHour([gained('n', null), unknown]), false);
  const total = (id: string, v: number | null): Story => ({ ...base, id, viewsTotal: v === null ? null : { known: true, amount: v } });
  assert.deepEqual(ordered([total('x', null), total('y', 5), total('z', 50)], 'views').map((s) => s.id), ['z', 'y', 'x']);
  const found = (id: string, at: number): Story => ({ ...base, id, foundAt: { known: true, at } });
  assert.deepEqual(ordered([found('old', 1), found('new', 9)], 'newest').map((s) => s.id), ['new', 'old']);
});

test('★ only narratives the server says happened, with a post', () => {
  const seeded = { ...base, id: 's', provenance: { kind: 'seeded', connectSourceLabel: 'X' } } as Story;
  const unstated = { ...base, id: 'x', provenance: { kind: 'unstated' } } as Story;
  const empty = { ...base, id: 'e', evidence: [] } as Story;
  const real = { ...base, id: 'r', provenance: { kind: 'observed' } } as Story;
  assert.deepEqual(realNarratives([seeded, unstated, empty, real]).map((s) => s.id), ['r']);
});

test('the last hour is the server\'s gain, or nothing', () => {
  assert.equal(lastHourGain(gained('a', 12_400)), '+12K');
  assert.equal(lastHourGain(gained('a', null)), null);
});

test('the posts line counts the posts and adds the views when the server sent them', () => {
  assert.deepEqual(postsLine({ ...base, postCount: 12, viewsTotal: { known: true, amount: 4_200_000 } }), ['12 posts', '4.2M views']);
  assert.deepEqual(postsLine({ ...base, postCount: 1, viewsTotal: null }), ['1 post']);
});

test('★ the coin line: a settled coin is checked, a top coin is never shown as its coin, none is Create', () => {
  const one = list.find((s) => s.coins.kind === 'one');
  assert.ok(one);
  assert.equal(storyCoinState(one).kind, 'checked');
  const coin = one.coins.kind === 'one' ? one.coins.coin : null;
  assert.ok(coin);
  assert.equal(storyCoinState({ ...one, coins: { kind: 'unsure', claimCount: 3 }, topCoin: coin }).kind, 'top');
  assert.equal(storyCoinState({ ...one, coins: { kind: 'none' }, topCoin: null }).kind, 'none');
  assert.equal(storyCoinState({ ...one, coins: { kind: 'pending' }, topCoin: null }).kind, 'line');
});
