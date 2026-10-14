/**
 * "Coin for this story" (story-coin.ts) on the owner's own labels: the similarities below are the
 * measured ones (2026-10-14, the post vectors against the owner's confirmed posts), so the tests
 * pin the bars where the data put them. GTA 6 and the tiger are examples of one rule: GTA 6 posts
 * get $GTA and GTA 5 does not; tiger posts get $Altai and other viral animal posts do not.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { storyCoins, type StoryAnchor, type StoryPost } from './story-coin.ts';

const BARS = DEFAULT_POLICY.postCoin.storyCoin;
const GTA = 'BsbsB3WL';
const gta = (itemId: string, atMs: number, stories: readonly string[] = [`seed-${itemId}`]): StoryAnchor => ({ itemId, coin: GTA, atMs, kind: 'right', names: ['GTA6', 'GTA', 'GTA memes'], stories });
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

test('★ GTA 5, GTA memes and a different game never get it, however close the words; "GTA" alone is too short a name', () => {
  const out = run(
    [post('x:gta5browser', 'LosSantos', ['seed-5']), post('v:gtamemes', null), post('x:minecraftgta5', 'EnderDragon'), post('x:huggy', 'HUGGY WUGGY'), post('x:gtashop', 'GTA')],
    { 'x:gta5browser': 0.451, 'v:gtamemes': 0.426, 'x:minecraftgta5': 0.444, 'x:huggy': 0.573, 'x:gtashop': 0.465 },
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
    { itemId: 'x:welcome', coin: 'Er4L', atMs: 10, kind: 'right', names: ['HomeView'], stories: [] },
    { itemId: 'x:impressions', coin: 'DS8a', atMs: 20, kind: 'right', names: ['HomeView'], stories: [] },
  ];
  const out = run([post('x:fr', 'HomeView')], { 'x:fr|x:welcome': 0.786, 'x:fr|x:impressions': 0.556 }, anchors);
  assert.equal(out.get('x:fr')?.coin?.address, 'DS8a');
});

test('★ a coin the owner called wrong on a post of the story is kept off the others (KARL)', () => {
  const anchors: StoryAnchor[] = [{ itemId: 'x:karl', coin: '84NR', atMs: 5, kind: 'wrong', names: [], stories: [] }];
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

/* The tiger story: four posts the owner gave $Altai (two of the mauling, two of the President's video). */
const ALTAI = 'Gyk9';
const tiger = (itemId: string, atMs: number): StoryAnchor => ({ itemId, coin: ALTAI, atMs, kind: 'right', names: ['Tiger', 'Altai', 'Altai the Tiger'], stories: [] });
const TIGERS = [tiger('t:enclosure', 1), tiger('t:everytime', 2), tiger('t:trump1', 3), tiger('t:trump2', 4)];
const four = (id: string, s: readonly number[]): Record<string, number> => Object.fromEntries(TIGERS.map((a, i) => [`${id}|${a.itemId}`, s[i] ?? 0]));

test('★ the tiger posts get $Altai: alone, together with two confirmations, or by the coin\'s own name', () => {
  const out = run(
    [post('x:friggin', null), post('x:childactor', null), post('x:altainamed', 'ALTAI')],
    { ...four('x:friggin', [0.907, 0.775, 0.765, 0.5]), ...four('x:childactor', [0.669, 0.661, 0.5, 0.4]), ...four('x:altainamed', [0.512, 0.511, 0.494, 0.4]) },
    TIGERS,
  );
  for (const id of ['x:friggin', 'x:childactor', 'x:altainamed']) assert.equal(out.get(id)?.coin?.address, ALTAI, id);
});

test('★ other viral animal posts close to one confirmed post, or loosely to several, do not', () => {
  const out = run(
    [post('x:whiskers', 'WHISKERS'), post('x:gorilla', 'Harambe'), post('x:putinu', null), post('x:onitsuka', 'ONITSUKA TIGER')],
    { ...four('x:whiskers', [0.65, 0.548, 0.539, 0.4]), ...four('x:gorilla', [0.686, 0.584, 0.556, 0.4]), ...four('x:putinu', [0.585, 0.574, 0.569, 0.4]), ...four('x:onitsuka', [0.435, 0.4, 0.4, 0.4]) },
    TIGERS,
  );
  assert.equal(out.size, 0);
});

test('one confirmation alone needs more than two together: the same 0.66 passes with a second post and not without', () => {
  const one = [tiger('t:a', 1)];
  assert.equal(run([post('x:p', null)], { 'x:p|t:a': 0.66 }, one).size, 0);
  assert.equal(run([post('x:p', null)], { 'x:p|t:a': 0.66, 'x:p|t:b': 0.61 }, [...one, tiger('t:b', 2)]).get('x:p')?.coin?.address, ALTAI);
});
