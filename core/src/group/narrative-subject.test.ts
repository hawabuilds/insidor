/**
 * THE SUBJECT RULE (policy.v242 `narrative.subject`): the owner, 2026-11-14 — "loads of posts are
 * grouped into the same narrative where they don't share the same exact character or meme". Two posts
 * link, two parts join, two narratives merge as one story and a loose post joins only on the same
 * distinctive subject name or the same picture. The cases are the live board's of that day: the
 * "Cute Cat Photos" cats, the "don't ignore this cat / dog / Punch" posts, Starship told as LIFTOFF
 * and STARSHIP, and the crypto-chatter blob that took Moo Deng and the Jensen story.
 *
 * The rules before it (topic words, merges across names) stay tested in narrative.test.ts,
 * narrative-early.test.ts and narrative-origin.test.ts, which pin the rule off.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { withMeasuredBars } from '@insidor/contracts/policy-measured-bars.ts';

import { detailOf, foldNarrativeCalls, groupNarratives, narrativeCoin, sharedDetail, type NarrativeMemberCoin, type NarrativePair, type NarrativePost } from './narrative.ts';
import { traceStories, type OriginInput } from './narrative-origin.ts';

const P: Policy = withMeasuredBars(DEFAULT_POLICY);
const OFF: Policy = { ...P, narrative: { ...P.narrative, subject: { ...P.narrative.subject, on: false } } };
const H = 3_600_000;
const NO_CALLS = foldNarrativeCalls([]);

const post = (itemId: string, text: string, names: readonly string[] = [], atMs = 0, hasPicture = true): NarrativePost => ({ itemId, atMs, text, names, hasPicture });
const d = (text: string, names: readonly string[] = [], pic = true) => detailOf(post('p', text, names, 0, pic), P);

test('the rule is on in the live policy', () => {
  assert.equal(DEFAULT_POLICY.narrative.subject.on, true);
  assert.ok(DEFAULT_POLICY.narrative.subject.pictureLikely > DEFAULT_POLICY.group.image.likely, 'a picture link needs a nearer picture than "likely the same"');
});

test('★ a shared topic word or a generic name is not the same character; the same distinctive name is', () => {
  /* Two different cats, both named the kind: no subject, so no link however alike the words. */
  const cat1 = d('this little kitten will bring you thirteen years of luck', ['KITTEN']);
  const cat2 = d('ignore this little kitten and get seven years of bad luck', ['CAT']);
  assert.equal(sharedDetail(cat1, cat2, false, OFF), 'name', 'before: the kind was a name');
  assert.equal(sharedDetail(cat1, cat2, false, P), null);
  /* The dog and the monkey Punch in the same format share words, not a character. */
  const punch = d('seven years of bad luck for whoever ignores Punch the monkey', ['PUNCH']);
  const dog = d('the worst year of your life if you ignore this puppy and his luck', ['PUPPY']);
  assert.equal(sharedDetail(punch, dog, false, P), null);
  /* Two Punch posts are one character. */
  assert.equal(sharedDetail(punch, d('Punch grew up and now takes care of a baby monkey', ['PUNCH']), false, P), 'name');
});

test('★ one subject under two judge names still links: a family, or the name said in the other post', () => {
  /* "Liftoff of Starship!" named LIFTOFF beside a post named STARSHIP. */
  assert.equal(sharedDetail(d('Liftoff of Starship! What a flight from the team', ['LIFTOFF']), d('Super heavy booster caught again', ['STARSHIP']), false, P), 'name');
  /* JENSEN and JENSENHUANG are one family. */
  assert.equal(sharedDetail(d('he resigned this morning from the company', ['JENSEN']), d('stock plunges after the news broke today', ['JENSENHUANG']), false, P), 'name');
});

test('★ the same picture links only when it is near-identical, not two pictures that look alike', () => {
  const a = d('my cat', []);
  const b = d('our cat today', []);
  /* The caller makes `samePicture` at `subject.pictureLikely`; given it, the link stands whatever the names. */
  assert.equal(sharedDetail(a, b, true, P), 'picture');
  assert.equal(sharedDetail(d('pepe with a hat', ['PEPEHAT']), d('new pepe dropped', ['HATPEPE']), true, P), 'picture');
  assert.equal(sharedDetail(a, b, false, P), null);
});

test('★ the regroup: different cats close in meaning stay apart, one character told twice joins', () => {
  const posts = [
    post('c1', 'look at this kitten sleeping so peacefully', ['KITTEN'], 0),
    post('c2', 'look at this kitten yawning so peacefully', ['KITTEN'], H),
    post('m1', 'Moo Deng becomes an aunt as the zoo welcomes a baby hippo', ['MOODENG'], 0),
    post('m2', 'Moo Deng meets her new nephew at the zoo this morning', ['MOODENG'], H),
  ];
  const pairs: NarrativePair[] = [
    { a: 'c1', b: 'c2', meaning: 0.95, samePicture: false },
    { a: 'm1', b: 'm2', meaning: 0.9, samePicture: false },
    { a: 'c1', b: 'm1', meaning: 0.9, samePicture: false },
  ];
  const run = (p: Policy) => groupNarratives({ posts, pairs, calls: NO_CALLS, previous: new Map(), single: new Set() }, p).narratives.map((n) => [...n.members].sort());
  assert.deepEqual(run(P), [['m1', 'm2']]);
});

test('★ the parts of a story join only when their main subjects are one', () => {
  const unit = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);
  const posts = [
    post('a1', 'we are in a cat meta and this coin is the most memeable', ['MINI'], 0),
    post('a2', 'new cat meme with a million views in a day lets go', ['MINI'], H),
    post('b1', 'Moo Deng becomes an aunt as the zoo welcomes a baby hippo', ['MOODENG'], 0),
    post('b2', 'Moo Deng meets her new nephew at the zoo this morning', ['MOODENG'], H),
  ];
  /* Both pairs link inside, and every vector is alike (a blob's average reads like the feed's). */
  const pairs: NarrativePair[] = [
    { a: 'a1', b: 'a2', meaning: 0.95, samePicture: false },
    { a: 'b1', b: 'b2', meaning: 0.95, samePicture: false },
  ];
  const vectors = new Map(['a1', 'a2', 'b1', 'b2'].map((id) => [id, unit(0)] as const));
  const run = (p: Policy) => groupNarratives({ posts, pairs, calls: NO_CALLS, previous: new Map(), single: new Set(), vectors }, p).narratives.length;
  assert.equal(run(P), 2, 'MINI and MOODENG stay two');
});

/* Two narratives of different subjects, quoting each other through three posts and alike in meaning. */
function blob(names: readonly [string, string]): OriginInput {
  const unit = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);
  const T0 = 100 * 24 * H;
  const posts = [
    post('a1', 'a1', [names[0]], T0),
    post('a2', 'a2', [names[0]], T0 + H),
    post('b1', 'b1', [names[1]], T0 + 2 * H),
    post('b2', 'b2', [names[1]], T0 + 3 * H),
  ].map((x) => ({ ...x, hasPicture: false }));
  const narratives = [
    { id: 'n-a', members: ['a1', 'a2'], formedAtMs: T0 + H },
    { id: 'n-b', members: ['b1', 'b2'], formedAtMs: T0 + 3 * H },
  ];
  return {
    narratives,
    posts: new Map(posts.map((x) => [x.itemId, x] as const)),
    narrativeOf: new Map(narratives.flatMap((x) => x.members.map((m) => [m, x.id] as const))),
    refs: new Map([['b1', ['a1']], ['b2', ['a2']]]),
    eligible: new Set(),
    shortlist: new Map(),
    vectors: new Map(['a1', 'a2', 'b1', 'b2'].map((id) => [id, unit(0)] as const)),
    pictures: new Map(),
    calls: NO_CALLS,
    untouchable: new Set(),
  };
}

test('★ the same-story merge: quotes and closeness never merge two subjects; the same subject still merges', () => {
  assert.equal(traceStories(blob(['ANSEM', 'MOODENG']), OFF).merges.length, 1, 'before: crypto chatter quoting a hippo post merged it');
  assert.equal(traceStories(blob(['ANSEM', 'MOODENG']), P).merges.length, 0);
  assert.equal(traceStories(blob(['JENSEN', 'JENSENHUANG']), P).merges.length, 1);
  assert.equal(traceStories(blob(['KITTEN', 'CAT']), P).merges.length, 0, 'a generic kind is no subject to merge on');
});

/* ── the narrative's coin (policy.v242 `narrative.coin`) ─────────────────── */

const member = (itemId: string, coin: string | null, owner = false): NarrativeMemberCoin => ({
  itemId,
  confirmed: coin === null ? null : { address: coin, atMs: 0, owner },
  proven: null,
  listed: [],
});
const many = (n: number, coin: string | null, owner = false) => Array.from({ length: n }, (_, i) => member(`${coin ?? 'x'}${i}`, coin, owner));

test('★ one story-coin post of many is not the narrative\'s coin: Starship 1 of 21, the cats 1 of 14', () => {
  const share = P.narrative.coin;
  assert.equal(narrativeCoin([...many(1, 'LIFTOFF'), ...many(20, null)], null, 3, share).kind, 'none');
  assert.equal(narrativeCoin([...many(1, 'HIMMEL'), ...many(13, null)], null, 3, share).kind, 'none');
  assert.equal(narrativeCoin([...many(3, 'PAWS'), ...many(11, null)], null, 3, share).kind, 'none');
  assert.deepEqual(narrativeCoin([...many(1, 'LIFTOFF'), ...many(20, null)], null, 3), { kind: 'confirmed', address: 'LIFTOFF' }, 'without the share: as before');
});

test('★ a coin most of the posts carry is the narrative\'s; one post alone needs the owner\'s own word', () => {
  const share = P.narrative.coin;
  assert.deepEqual(narrativeCoin([...many(8, 'GTA'), ...many(2, 'LUCKY'), ...many(5, null)], null, 3, share), { kind: 'confirmed', address: 'GTA' });
  /* Two posts, one carrying a story coin: not enough. The owner's own "This is the coin" on it is. */
  assert.equal(narrativeCoin([member('a', 'LUCKY'), member('b', null)], null, 3, share).kind, 'none');
  assert.deepEqual(narrativeCoin([member('a', 'LUCKY', true), member('b', null)], null, 3, share), { kind: 'confirmed', address: 'LUCKY' });
});

test('the owner\'s call on the narrative itself is never held to the share', () => {
  const call = { right: { address: 'JENSEN', atMs: 1 }, wrong: new Map<string, number>(), members: [] };
  assert.deepEqual(narrativeCoin(many(20, null), call, 3, P.narrative.coin), { kind: 'confirmed', address: 'JENSEN' });
});
