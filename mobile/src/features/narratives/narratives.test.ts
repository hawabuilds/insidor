import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import type { Story } from '../../shared/api/index.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { storyCoinState } from '../narrative/story-coin.ts';
import { DEFAULT_CHOICE, allTimeOf, cardLine, gainText, loadChoice, ordered, realNarratives, saveChoice, starredNarratives, watchLine, windowsOf, type Choice } from './narrative-order.ts';

const list = sampleNarrativeIds().map((id) => decodeStory(fixtureStory(id)));
const base = list[0] as Story;
const measured = (v: number | null) => (v === null ? { known: false as const, pending: 'not_read_yet' as const } : { known: true as const, amount: v });
/** A story with its 1h and 24h windows: views gained, posts found, trending place. */
const story = (id: string, w: Record<number, [number | null, number, number]>, extra: Partial<Story> = {}): Story => ({
  ...base,
  id,
  inWindow: new Map(Object.entries(w).map(([h, [g, posts, place]]) => [Number(h), { viewsGained: measured(g), newPosts: posts, trendingPlace: place }] as const)),
  ...extra,
});
const ids = (xs: readonly Story[]) => xs.map((s) => s.id);
const pick = (order: Choice['order'], trending: 1 | 6 | 24 = 1, viewed: 1 | 6 | 24 = 24): Choice => ({ order, windows: { trending, viewed } });

test('★ Trending is the server\'s place for the window, not the biggest gain', () => {
  const big = story('big', { 1: [900_000, 0, 3], 24: [9_000_000, 4, 1] });
  const rising = story('rising', { 1: [40_000, 6, 1], 24: [60_000, 6, 2] });
  const quiet = story('quiet', { 1: [1_000, 1, 2], 24: [2_000, 1, 3] });
  assert.deepEqual(ids(ordered([big, quiet, rising], DEFAULT_CHOICE)), ['rising', 'quiet', 'big']);
  assert.deepEqual(ids(ordered([big, quiet, rising], pick('trending', 24))), ['big', 'rising', 'quiet']);
});

test('★ Most viewed is views GAINED in the window; an unknown goes after every known one, never as zero', () => {
  const a = story('a', { 1: [5, 0, 1], 24: [50, 0, 1] });
  const b = story('b', { 1: [9, 0, 2], 24: [10, 0, 2] });
  const dark = story('dark', { 1: [null, 0, 3], 24: [null, 0, 3] });
  assert.deepEqual(ids(ordered([dark, b, a], pick('viewed'))), ['a', 'b', 'dark']);
  assert.deepEqual(ids(ordered([dark, b, a], pick('viewed', 1, 1))), ['b', 'a', 'dark']);
  assert.equal(gainText(dark, 24), null);
  assert.equal(gainText(a, 24), '+50');
});

test('★ New is newest found first', () => {
  const found = (id: string, at: number): Story => ({ ...base, id, foundAt: { known: true, at } as Story['foundAt'] }) as Story;
  assert.deepEqual(ids(ordered([found('old', 1), found('new', 9)], pick('new'))), ['new', 'old']);
});

test('the card says new posts in the window and the story\'s age, facts only', () => {
  const s = story('s', { 1: [10, 3, 1], 24: [10, 0, 1] }, { foundAt: { known: true, at: 0 } as Story['foundAt'], postCount: 61 });
  assert.deepEqual(cardLine(s, 1, 28 * 60_000), ['3 new posts', '28m old']);
  assert.deepEqual(cardLine(s, 24, 28 * 60_000), ['No new posts', '28m old']);
  assert.deepEqual(cardLine(s, null, 3 * 3_600_000), ['61 posts', '3h old']);
});

test('★ the choice is remembered, and a phone that cannot keep it gets the defaults', () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  assert.deepEqual(loadChoice(store), DEFAULT_CHOICE);
  assert.deepEqual(DEFAULT_CHOICE, { order: 'trending', windows: { trending: 1, viewed: 24 } });
  saveChoice(store, pick('viewed', 6, 1));
  assert.deepEqual(loadChoice(store), pick('viewed', 6, 1));
  assert.deepEqual(loadChoice({ getItem: () => { throw new Error('private window'); } }), DEFAULT_CHOICE);
  assert.deepEqual(loadChoice({ getItem: () => '{"order":"nonsense","windows":{"trending":7}}' }), DEFAULT_CHOICE);
  assert.doesNotThrow(() => saveChoice({ setItem: () => { throw new Error('full'); } }, DEFAULT_CHOICE));
});

test('★ only narratives the server says happened, with a post', () => {
  const seeded = { ...base, id: 's', provenance: { kind: 'seeded', connectSourceLabel: 'X' } } as Story;
  const unstated = { ...base, id: 'x', provenance: { kind: 'unstated' } } as Story;
  const empty = { ...base, id: 'e', evidence: [] } as Story;
  const real = { ...base, id: 'r', provenance: { kind: 'observed' } } as Story;
  assert.deepEqual(realNarratives([seeded, unstated, empty, real]).map((s) => s.id), ['r']);
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

test('★ Watchlist keeps starred narratives in starred order and leaves out ids the list does not hold', () => {
  const a = story('n-a', { 1: [10, 1, 1] });
  const b = story('n-b', { 1: [20, 1, 2] });
  const seeded = story('n-seeded', { 1: [30, 1, 3] }, { provenance: { kind: 'seeded' } as unknown as Story['provenance'] });
  /* An old story id from before the rebuild resolves to nothing, as does a seeded narrative. */
  assert.deepEqual(ids(starredNarratives([a, b, seeded], ['old-story-17', 'n-b', 'n-seeded', 'n-a'])), ['n-b', 'n-a']);
  assert.deepEqual(starredNarratives([a, b], []), []);
});

test('the Watchlist card line is posts and views, and unknown views are said, never 0', () => {
  const unknown = { known: false as const, pending: 'not_read_yet' as const };
  assert.deepEqual(watchLine({ ...base, postCount: 12, viewsTotal: { known: true, amount: 3_400_000 } }), ['12 posts', '3.4M views']);
  assert.deepEqual(watchLine({ ...base, postCount: 1, viewsTotal: null, reach: { known: true, amount: 900 } }), ['1 post', '900 views']);
  assert.deepEqual(watchLine({ ...base, postCount: 2, viewsTotal: unknown, reach: unknown }), ['2 posts', 'views not reported']);
});

test('★ a dead narrative is never in Trending, and still in Most viewed; the card says Dead', () => {
  const live = story('live', { 1: [5, 1, 1], 24: [5, 1, 1] });
  const dead: Story = { ...base, id: 'dead', dead: true, postCount: 4, inWindow: new Map([[1, { viewsGained: measured(900), newPosts: 0, trendingPlace: null }], [24, { viewsGained: measured(9_000), newPosts: 0, trendingPlace: null }]]) };
  assert.deepEqual(ids(ordered([dead, live], DEFAULT_CHOICE)), ['live']);
  assert.deepEqual(ids(ordered([live, dead], pick('viewed'))), ['dead', 'live']);
  assert.deepEqual(cardLine(dead, null, 0), ['4 posts', 'Dead']);
});

test('★ All time: Most viewed and New read the whole list, ordered by views and by found; the window is remembered', () => {
  const v = (id: string, views: number | null): Story => ({ ...base, id, viewsTotal: views === null ? { known: false, pending: 'not_read_yet' } : { known: true, amount: views } }) as Story;
  const all: Choice = { order: 'viewed', windows: { trending: 1, viewed: 'all' } };
  assert.equal(allTimeOf(all), 'viewed');
  assert.equal(allTimeOf(pick('new')), 'new');
  assert.equal(allTimeOf(DEFAULT_CHOICE), null);
  assert.deepEqual(ids(ordered([v('dark', null), v('small', 10), v('big', 3_000_000)], all)), ['big', 'small', 'dark']);
  assert.equal(gainText(v('big', 3_400_000), 'all'), '3.4M');
  assert.deepEqual(windowsOf('trending'), [1, 6, 24], 'Trending has no All time');
  assert.deepEqual(windowsOf('viewed'), [1, 6, 24, 'all']);
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, val: string) => void kept.set(k, val) };
  saveChoice(store, all);
  assert.deepEqual(loadChoice(store), all);
});
