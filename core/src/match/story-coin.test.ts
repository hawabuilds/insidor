/**
 * "Coin for this story" (story-coin.ts) on the owner's own labels: the similarities below are the
 * measured ones (2026-10-14, the post vectors against the owner's confirmed posts), so the tests
 * pin the bars where the data put them — GTA 6 posts get $GTA, GTA 5 and lookalikes do not.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { storyCoins, type StoryAnchor, type StoryPost } from './story-coin.ts';

const BARS = DEFAULT_POLICY.postCoin.storyCoin;
const GTA = 'BsbsB3WL';
const gta = (itemId: string, atMs: number, stories: readonly string[] = [`seed-${itemId}`]): StoryAnchor => ({ itemId, coin: GTA, atMs, kind: 'right', name: 'GTA6', stories });
const ANCHORS: StoryAnchor[] = [gta('x:4681', 1), gta('x:8387', 2), gta('x:0304', 3), gta('x:8291', 4)];
const post = (itemId: string, name: string | null, stories: readonly string[] = []): StoryPost => ({ itemId, name, stories });
const run = (posts: readonly StoryPost[], sims: Record<string, number>, anchors: readonly StoryAnchor[] = ANCHORS) =>
  storyCoins(posts, anchors, (p, a) => sims[`${p}|${a}`] ?? sims[p], BARS);

test('★ GTA 6 posts get the coin the owner confirmed for the GTA 6 story', () => {
  const out = run(
    [post('x:onpc', 'GTA6'), post('x:shot', 'GTA6'), post('x:pc2027', null)],
    { 'x:onpc': 0.692, 'x:shot': 0.558, 'x:pc2027': 0.952 },
  );
  for (const id of ['x:onpc', 'x:shot', 'x:pc2027']) assert.equal(out.get(id)?.coin?.address, GTA, id);
  /* The newest confirmation of the coin is the one named. */
  assert.equal(out.get('x:onpc')?.coin?.fromItemId, 'x:8291');
});

test('★ GTA 5, GTA memes and a different game never get it, however close the words', () => {
  const out = run(
    [post('x:gta5browser', 'LosSantos', ['seed-5']), post('v:gtamemes', null), post('x:minecraftgta5', 'EnderDragon'), post('x:huggy', 'HUGGY WUGGY')],
    { 'x:gta5browser': 0.451, 'v:gtamemes': 0.426, 'x:minecraftgta5': 0.444, 'x:huggy': 0.573 },
  );
  assert.equal(out.size, 0);
});

test('the narrative carries the coin to its members, and only past `near`', () => {
  /* x:jason met `meaning`; x:countdown shares its story at 0.511, x:leonida shares it at 0.40. */
  const out = run(
    [post('x:jason', null, ['gtavi']), post('x:countdown', null, ['gtavi']), post('x:leonida', null, ['gtavi']), post('x:elsewhere', null, ['other'])],
    { 'x:jason': 0.709, 'x:countdown': 0.511, 'x:leonida': 0.40, 'x:elsewhere': 0.511 },
  );
  assert.equal(out.get('x:countdown')?.coin?.address, GTA);
  assert.equal(out.has('x:leonida'), false);
  assert.equal(out.has('x:elsewhere'), false);
});

test('★ the newest confirmation wins when the owner names another coin for the same story', () => {
  const anchors: StoryAnchor[] = [
    { itemId: 'x:welcome', coin: 'Er4L', atMs: 10, kind: 'right', name: 'HomeView', stories: [] },
    { itemId: 'x:impressions', coin: 'DS8a', atMs: 20, kind: 'right', name: 'HomeView', stories: [] },
  ];
  const out = run([post('x:fr', 'HomeView')], { 'x:fr|x:welcome': 0.786, 'x:fr|x:impressions': 0.556 }, anchors);
  assert.equal(out.get('x:fr')?.coin?.address, 'DS8a');
});

test('★ a coin the owner called wrong on a post of the story is kept off the others (KARL)', () => {
  const anchors: StoryAnchor[] = [{ itemId: 'x:karl', coin: '84NR', atMs: 5, kind: 'wrong', name: null, stories: [] }];
  const out = run([post('x:goliath', null)], { 'x:goliath': 0.83 }, anchors);
  assert.equal(out.get('x:goliath')?.coin, null);
  assert.equal(out.get('x:goliath')?.wrong.has('84NR'), true);
  /* A later confirmation of the same coin on the story stands again. */
  const later = run([post('x:goliath', null)], { 'x:goliath': 0.83 }, [...anchors, { ...anchors[0]!, itemId: 'x:other', kind: 'right', atMs: 6 }]);
  assert.equal(later.get('x:goliath')?.coin?.address, '84NR');
});

test('an anchor\'s own post is decided by the owner\'s own call, never matched to itself', () => {
  assert.equal(run([post('x:4681', 'GTA6')], { 'x:4681': 1 }, [gta('x:4681', 1)]).size, 0);
});
