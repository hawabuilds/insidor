/**
 * The owner's labels as precedent: the closest labels, never the post itself; the closest "not a
 * meme" label and the hold bar; the picture a post is embedded with.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { closestNot, embedInput, heldAsNotMeme, nearestLabelled, ownSourceFirst, postPicture, precedentsFor, sourceOfItemId, type LabelledVector } from './precedents.ts';

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
