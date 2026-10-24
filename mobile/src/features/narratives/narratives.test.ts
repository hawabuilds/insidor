import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import type { Story } from '../../shared/api/index.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { speedLine } from '../feed/feed-sort.ts';
import { storyCoinState } from '../narrative/story-coin.ts';
import { DEFAULT_CHOICE, SITES, cardLine, gainedIn, hourGainText, listOf, loadChoice, realNarratives, saveChoice, speedsOf, starredNarratives, viewsText, viralLine, watchLine, type Choice } from './narrative-order.ts';

const list = sampleNarrativeIds().map((id) => decodeStory(fixtureStory(id)));
const base = list[0] as Story;
const measured = (v: number | null) => (v === null ? { known: false as const, pending: 'not_read_yet' as const } : { known: true as const, amount: v });
/** A story with its last hour's gain, as Home's Watchlist reads it. */
const story = (id: string, w: Record<number, [number | null, number, number]>, extra: Partial<Story> = {}): Story => ({
  ...base,
  id,
  inWindow: new Map(Object.entries(w).map(([h, [g, posts, place]]) => [Number(h), { viewsGained: measured(g), newPosts: posts, trendingPlace: place, viralAccounts: null, viralMinViews: null }] as const)),
  ...extra,
});
const ids = (xs: readonly Story[]) => xs.map((s) => s.id);
const pick = (sort: Choice['sort'], span: Choice['span'] = 'today', site: Choice['site'] = 'all', noCoin = false): Choice => ({ sort, span, site, noCoin });

test('★ the sorts are For You\'s, and each choice reads its own server list', () => {
  assert.deepEqual(DEFAULT_CHOICE, { sort: 'new', span: 'today', site: 'all', noCoin: false });
  assert.equal(listOf(pick('new')), 'new');
  assert.equal(listOf(pick('trending', 'week')), 'trending', 'Trending has no window');
  assert.equal(listOf(pick('most_viewed', 'today')), 'today');
  assert.equal(listOf(pick('most_viewed', 'week')), 'week');
  assert.equal(listOf(pick('most_viewed', 'all')), 'viewed');
  assert.deepEqual(SITES.map((x) => x.label), ['All', 'X', 'TikTok'], 'plain words, no logos');
});

test('★ the card says facts: views, the span\'s gain, the speeds in For You\'s words; an unknown is never 0', () => {
  const s: Story = { ...base, viewsTotal: measured(125_000_000), viewsGainedDay: measured(8_100_000), viewsGainedWeek: measured(null), viewsPerMinute: { now: 394, before: 280 } };
  assert.equal(viewsText(s), '125M');
  assert.equal(gainedIn(s, 'today'), 8_100_000);
  assert.equal(gainedIn(s, 'week'), null, 'not said, so no line');
  assert.equal(gainedIn(s, 'all'), null);
  const sp = speedsOf(s);
  assert.ok(sp !== null);
  assert.equal(speedLine(sp).text, '394 views a minute, up 1.4x in the last hour');
  assert.equal(viewsText({ ...base, viewsTotal: measured(null) }), null);
});

test('the card line is the post count, the age and Dead, facts only', () => {
  const s = story('s', { 1: [10, 3, 1] }, { foundAt: { known: true, at: 0 } as Story['foundAt'], postCount: 61 });
  assert.deepEqual(cardLine(s, 3 * 3_600_000), ['61 posts', '3h old']);
  assert.deepEqual(cardLine({ ...s, dead: true, foundAt: null, firstSeenAt: { known: false, pending: 'not_read_yet' } as Story['firstSeenAt'], postCount: 4 }, 0), ['4 posts', 'Dead']);
});

test('the Watchlist card keeps the last hour\'s gain', () => {
  assert.equal(hourGainText(story('a', { 1: [12_000, 0, 1] })), '+12K');
  assert.equal(hourGainText(story('b', { 1: [null, 0, 1] })), null);
});

test('★ the choice is remembered, a phone that cannot keep it gets the defaults, and an old choice keeps its sort', () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  assert.deepEqual(loadChoice(store), DEFAULT_CHOICE);
  saveChoice(store, pick('most_viewed', 'week', 'tiktok'));
  assert.deepEqual(loadChoice(store), pick('most_viewed', 'week', 'tiktok'));
  saveChoice(store, pick('trending', 'today', 'tiktok', true));
  assert.deepEqual(loadChoice(store), pick('trending', 'today', 'tiktok', true), 'No coin yet is remembered with the site');
  assert.deepEqual(loadChoice({ getItem: () => { throw new Error('private window'); } }), DEFAULT_CHOICE);
  assert.deepEqual(loadChoice({ getItem: () => '{"sort":"nonsense","span":7,"site":"facebook"}' }), DEFAULT_CHOICE);
  /* Stored before this design: { order, windows }. */
  assert.deepEqual(loadChoice({ getItem: () => '{"order":"trending","windows":{"trending":6,"viewed":24}}' }), pick('trending'));
  assert.deepEqual(loadChoice({ getItem: () => '{"order":"viewed","windows":{"trending":1,"viewed":"all"}}' }), pick('most_viewed', 'all'));
  assert.deepEqual(loadChoice({ getItem: () => '{"order":"viewed","windows":{"trending":1,"viewed":1}}' }), pick('most_viewed', 'today'));
  assert.deepEqual(loadChoice({ getItem: () => '{"order":"nonsense"}' }), DEFAULT_CHOICE);
  assert.doesNotThrow(() => saveChoice({ setItem: () => { throw new Error('full'); } }, DEFAULT_CHOICE));
});

test('★ the decoder takes the speeds and the gains, and refuses speeds that are not two numbers', () => {
  const raw = fixtureStory(sampleNarrativeIds()[0] as string) as Record<string, unknown>;
  const s = decodeStory({ ...raw, viewsPerMinute: { now: 12.5, before: 3, posts: 2, nowBySource: { x: 12.5 } }, viewsGainedDay: { v: 900 }, viewsGainedWeek: { v: null, why: 'not_read_yet' } });
  assert.deepEqual(s.viewsPerMinute, { now: 12.5, before: 3 });
  assert.equal(gainedIn(s, 'today'), 900);
  assert.equal(gainedIn(s, 'week'), null);
  assert.equal(decodeStory(raw).viewsPerMinute, null, 'absent: none');
  assert.throws(() => decodeStory({ ...raw, viewsPerMinute: { now: 'fast', before: 1 } }));
  assert.throws(() => decodeStory({ ...raw, viewsPerMinute: { now: 1, before: -1 } }));
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

test('★ Trending says the viral posts a story is listed by, added up under the meme-war card; an unsaid count is no line', () => {
  const viral = (id: string, n: number | null): Story => ({ ...base, id, inWindow: new Map([[24, { viewsGained: measured(1), newPosts: 1, trendingPlace: 1, viralAccounts: n, viralMinViews: n === null ? null : 40_000 }]]) });
  assert.equal(viralLine([viral('fj', 8)]), 'Posts over 40K views from 8 accounts today');
  assert.equal(viralLine([viral('fj', 8), viral('ct', 1)]), 'Posts over 40K views from 9 accounts today');
  assert.equal(viralLine([viral('ct', 1)]), 'Posts over 40K views from 1 account today');
  assert.equal(viralLine([viral('x', 0)]), null);
  assert.equal(viralLine([viral('x', null)]), null);
  assert.equal(viralLine([{ ...base, inWindow: null }]), null);
});

