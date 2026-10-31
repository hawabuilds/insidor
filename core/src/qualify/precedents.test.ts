/**
 * The owner's labels as precedent: the closest labels, never the post itself; the closest "not a
 * meme" label and the hold bar; the picture a post is embedded with.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { closestNot, embedInput, hasWords, heldAsNotMeme, nearestLabelled, ownSourceFirst, postPicture, precedentsFor, sourceOfItemId, type LabelledVector } from './precedents.ts';

const unit = (x: number, y: number): number[] => {
  const n = Math.hypot(x, y);
  return [x / n, y / n];
};
const label = (itemId: string, kind: 'meme' | 'not', v: number[]): LabelledVector => ({ itemId, label: kind, text: `post ${itemId}`, why: null, values: v });
const labels = [label('a', 'meme', unit(1, 0)), label('b', 'not', unit(1, 0.2)), label('c', 'not', unit(0, 1)), label('self', 'meme', unit(1, 0.1))];
const notSelf = (l: LabelledVector) => l.itemId === 'self';

test('the k closest labels, closest first, never the post itself', () => {
  const near = nearestLabelled(unit(1, 0.1), labels, 2, notSelf);
  assert.deepEqual(near.map((n) => n.label.itemId), ['b', 'a']);
  assert.equal(nearestLabelled(unit(1, 0.1), labels, 0, notSelf).length, 0);
});

test("the post's own source first: up to `reserve` of the k, listed first; 0 is the plain closest k", () => {
  const mixed = [label('t:1', 'meme', unit(1, 0)), label('v:1', 'not', unit(1, 0.5)), label('t:2', 'not', unit(1, 0.05)), label('v:2', 'meme', unit(0, 1))];
  const self = () => false;
  assert.deepEqual(nearestLabelled(unit(1, 0.4), mixed, 2, self).map((n) => n.label.itemId), ['v:1', 't:2']);
  assert.deepEqual(nearestLabelled(unit(1, 0.4), mixed, 2, self, { source: 'v', reserve: 0 }).map((n) => n.label.itemId), ['v:1', 't:2']);
  assert.deepEqual(nearestLabelled(unit(1, 0.4), mixed, 3, self, { source: 'v', reserve: 2 }).map((n) => n.label.itemId), ['v:1', 'v:2', 't:2']);
  /* A source with fewer labels than the reserve leaves the places to the others. */
  assert.deepEqual(ownSourceFirst(['a1', 'b1', 'b2', 'b3'], 3, 2, (x) => x.startsWith('a')), ['a1', 'b1', 'b2']);
  assert.equal(sourceOfItemId('t:123'), 't');
  assert.equal(sourceOfItemId('plain'), '');
});

test('the closest "not a meme" label, and the hold at the bar', () => {
  const n = closestNot(unit(1, 0.1), labels, notSelf);
  assert.equal(n?.label.itemId, 'b');
  const bar = DEFAULT_POLICY.judge.precedents.holdNotSimilarity;
  assert.equal(heldAsNotMeme(bar, DEFAULT_POLICY), true);
  assert.equal(heldAsNotMeme(bar - 0.001, DEFAULT_POLICY), false);
  assert.equal(heldAsNotMeme(null, DEFAULT_POLICY), false, 'no vector holds nothing');
  assert.equal(closestNot(unit(1, 0), [labels[0]!], () => false), null);
});

test('precedents are trimmed as the judge is sent them; a post is embedded from its trimmed words and shown picture', () => {
  const long = { ...labels[0]!, text: 'x'.repeat(DEFAULT_POLICY.judge.precedents.maxChars + 50) };
  assert.equal(precedentsFor([{ label: long, similarity: 1 }], DEFAULT_POLICY)[0]?.text.length, DEFAULT_POLICY.judge.precedents.maxChars);
  assert.equal(embedInput(`  ${'y'.repeat(DEFAULT_POLICY.judge.maxCharsPerText + 9)} `, null, DEFAULT_POLICY).text.length, DEFAULT_POLICY.judge.maxCharsPerText);
  const media = (kind: string, uri: string) => ({ kind, uri, width: null, height: null, durationMs: null });
  assert.equal(postPicture([media('video', 'https://v.example/clip.mp4'), media('image', 'https://p.example/a.jpg')]), 'https://p.example/a.jpg');
  assert.equal(postPicture([media('video', 'https://p.example/still.jpg')]), 'https://p.example/still.jpg');
  assert.equal(postPicture([media('video', 'https://v.example/clip.mp4')]), null);
  assert.equal(postPicture('not media'), null);
});

test('★ a post with no words is held only when its picture is near-identical: two @twaniimals animal posts at 0.891 and 0.924 are not', () => {
  const P = DEFAULT_POLICY;
  assert.equal(hasWords(['https://t.co/UPWrreVRvB']), false);
  assert.equal(hasWords(['🐶🐶 #dogs @someone https://t.co/x']), false);
  assert.equal(hasWords(['So beautiful']), true);
  assert.equal(heldAsNotMeme(0.891, P, false), false);
  assert.equal(heldAsNotMeme(0.924, P, false), false);
  assert.equal(heldAsNotMeme(P.judge.precedents.holdNotSimilarityNoWords, P, false), true, 'a near-copy of the labelled picture is still held');
  assert.equal(heldAsNotMeme(0.891, P, true), heldAsNotMeme(0.891, P), 'posts with words keep the ordinary bar');
});

test('★ the owner\'s own memes first: his missed posts and Meme taps among the closest go first, never one from far away; reserve 0 is the old order', () => {
  const lv = (itemId: string, x: number, kind: string, label: 'meme' | 'not' = 'meme') => ({ itemId, label, text: itemId, why: null, kind, values: [x, Math.sqrt(1 - x * x)] });
  const labels = [lv('x:1', 0.99, 'coined'), lv('x:2', 0.98, 'tap', 'not'), lv('x:3', 0.97, 'gold'), lv('x:4', 0.9, 'missed'), lv('x:5', 0.8, 'tap'), lv('x:6', 0.1, 'missed')];
  const ids = (r: readonly { label: { itemId: string } }[]) => r.map((n) => n.label.itemId);
  const none = () => false;
  assert.deepEqual(ids(nearestLabelled([1, 0], labels, 3, none)), ['x:1', 'x:2', 'x:3']);
  assert.deepEqual(ids(nearestLabelled([1, 0], labels, 3, none, undefined, { reserve: 0, within: 40 })), ['x:1', 'x:2', 'x:3']);
  assert.deepEqual(ids(nearestLabelled([1, 0], labels, 3, none, undefined, { reserve: 2, within: 5 })), ['x:4', 'x:5', 'x:1']);
  /* x:6 is a missed post but far away: outside `within`, so never forced in. */
  assert.deepEqual(ids(nearestLabelled([1, 0], labels, 4, none, undefined, { reserve: 3, within: 5 })), ['x:4', 'x:5', 'x:1', 'x:2']);
});
