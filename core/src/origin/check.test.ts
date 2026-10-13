/**
 * The origin rules on the cases the brief names: a promo link and a profile link are never
 * an origin; a coin with no link matches its post on picture plus name plus timing; a coin
 * with the same name and a different picture stays unlinked. And the founders' own rule: a
 * post made after the coin is never its origin.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { checkCreatorLink, decideOrigin, earliestByReproduction, earliestBySamePicture, matchCandidates, namesCoin, type Candidate, type PostFacts } from './check.ts';

const P = DEFAULT_POLICY;
const H = 3_600_000;
const LAUNCH = 1_800_000_000_000 as Millis;
const coin = { address: 'Trout1111111111111111111111111111111111pump', ticker: 'BIGTROUT', name: 'Big Trout', launchedAt: LAUNCH };

const post = (over: Partial<PostFacts> = {}): PostFacts => ({
  postId: 'p1',
  postedAt: (LAUNCH - 2 * H) as Millis,
  text: 'look at the size of this trout',
  authorFollowers: 1_000,
  reach: 400_000,
  judged: { coinable: true, proposedName: 'Big Trout' },
  ...over,
});
const candidate = (over: Partial<Candidate> = {}): Candidate => ({ postId: 'c1', postedAt: (LAUNCH - 3 * H) as Millis, text: 'BIG TROUT spotted', picture: 'likely', ...over });

test('★ a promo link is never an origin: posted after the coin, or naming it by ticker or address', () => {
  assert.deepEqual(checkCreatorLink({ kind: 'post', post: post({ postedAt: (LAUNCH + H) as Millis }) }, coin, P), { kind: 'notOrigin', status: 'promo_only', why: 'posted after the coin' });
  assert.equal(checkCreatorLink({ kind: 'post', post: post({ text: 'buy $BIGTROUT now' }) }, coin, P).kind, 'notOrigin');
  assert.equal(checkCreatorLink({ kind: 'post', post: post({ text: `ca: ${coin.address}` }) }, coin, P).kind, 'notOrigin');
});

test('★ a profile link is never an origin', () => {
  assert.deepEqual(checkCreatorLink({ kind: 'account' }, coin, P), { kind: 'notOrigin', status: 'account_only', why: 'the link is an account, not a post' });
  assert.equal(decideOrigin(checkCreatorLink({ kind: 'account' }, coin, P), { kind: 'none', why: '' }).status, 'account_only');
});

test('a creator\'s link is the origin when it shows a nameable subject with real reach; a big account\'s statement is an influencer\'s', () => {
  assert.deepEqual(checkCreatorLink({ kind: 'post', post: post() }, coin, P), { kind: 'origin', status: 'linked_by_creator', postId: 'p1' });
  const statement = post({ judged: { coinable: false, proposedName: null }, authorFollowers: 2_000_000 });
  assert.deepEqual(checkCreatorLink({ kind: 'post', post: statement }, coin, P), { kind: 'origin', status: 'influencer_origin', postId: 'p1' });
  assert.equal(checkCreatorLink({ kind: 'post', post: post({ reach: 900 }) }, coin, P).kind, 'fallThrough', 'a subject nobody saw is not the viral post');
  assert.equal(checkCreatorLink({ kind: 'post', post: post({ postedAt: (LAUNCH + 60_000) as Millis }) }, coin, P).kind, 'origin', 'inside the ten-minute allowance');
});

test('★ a coin with no link matches its post on picture plus name plus timing — the earliest that passes', () => {
  const found = matchCandidates([candidate({ postId: 'later', postedAt: (LAUNCH - H) as Millis }), candidate({ postId: 'first' })], coin, P);
  assert.deepEqual(found, { kind: 'matched', postId: 'first' });
  assert.deepEqual(decideOrigin({ kind: 'fallThrough', why: 'no link' }, found), { status: 'matched_by_insidor', postId: 'first' });
});

test('★ a same-name coin with a different picture stays unlinked: never a link on a name alone', () => {
  const result = matchCandidates([candidate({ picture: null }), candidate({ postId: 'c2', picture: null, text: 'big trout energy' })], coin, P);
  assert.deepEqual(result, { kind: 'none', why: 'posts name it, but none shows the same subject' });
  assert.equal(decideOrigin({ kind: 'fallThrough', why: 'no link' }, result).status, 'unlinked');
});

test('★ a matched post leads back to the earliest post with its own picture, named or not', () => {
  const named = { postId: 'named', postedAt: (LAUNCH - H) as Millis };
  const same = [
    { postId: 'oct11', postedAt: (LAUNCH - 2 * 24 * H) as Millis },
    { postId: 'sept', postedAt: (LAUNCH - 22 * 24 * H) as Millis },
    { postId: 'after', postedAt: (LAUNCH - H / 2) as Millis },
  ];
  assert.equal(earliestBySamePicture(named, same).postId, 'sept');
  assert.equal(earliestBySamePicture(named, []).postId, 'named');
  assert.equal(earliestBySamePicture(named, [{ postId: 'undated', postedAt: null }]).postId, 'named', 'a post with no time cannot be shown to come first');
});

test('★ a matching post made after the coin is viral after launch, never the origin', () => {
  const result = matchCandidates([candidate({ postedAt: (LAUNCH + 5 * H) as Millis })], coin, P);
  assert.deepEqual(result, { kind: 'afterLaunch', postId: 'c1', afterLaunchMs: 5 * H });
  assert.deepEqual(decideOrigin({ kind: 'fallThrough', why: '' }, result), { status: 'viral_after_launch', postId: 'c1' });
});

test('a post names a coin by whole words, ignoring case and accents', () => {
  assert.equal(namesCoin('Schrödinger strikes again', { ticker: 'SCHRO', name: 'Schrodinger' }), true);
  assert.equal(namesCoin('troutish behaviour', coin), false);
});

test('the earliest post is found by following quotes back, while each is known and earlier', () => {
  const at = (h: number) => (LAUNCH - h * H) as Millis;
  const posts = new Map([
    ['matched', { postedAt: at(1), reproduces: 'middle' }],
    ['middle', { postedAt: at(2), reproduces: 'root' }],
    ['root', { postedAt: at(5), reproduces: 'unknown' }],
  ]);
  assert.equal(earliestByReproduction('matched', posts), 'root');
  assert.equal(earliestByReproduction('matched', new Map([['matched', { postedAt: at(1), reproduces: 'later' }], ['later', { postedAt: at(0), reproduces: null }]])), 'matched', 'a quoted post made later is not where it started');
});
