/**
 * ★ ONE DISTINCTIVE NAME PAIRS TWO POSTS WHATEVER THEIR WORDS (narratives.ts `narrativePairs`,
 * Policy.narrative.rareName, 2026-11-04): Elon's "Prophetic" over a Tolkien page and the Education
 * Department's Aragorn clip, both judged ARAGORN, share no picture and no words. A name a handful of
 * posts carry pairs them; a name many carry (a kind of thing) does not, nor does an unsure answer,
 * nor a generic name. And core's grouping links such a pair into one group.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { groupNarratives } from '@insidor/core';
import type { NarrativePostRow } from '@insidor/store';

import { asNarrativePost, narrativePairs } from './narratives.ts';

const T = Date.UTC(2026, 10, 3, 16);
const row = (id: string, name: string | null, confidence = 0.9, body = 'some words here about it', minutes = 0): NarrativePostRow => ({
  itemId: id, source: 'x', body, media: [], atMs: T + minutes * 60_000, coinable: true, confidence, lookedAt: 'text',
  proposedName: name, alternateNames: [], judgeId: 'j', kindLabel: 'OTHER', ownerCall: null, ownTalk: false, authorKey: `x:${id}`,
});
const named = (pairs: ReturnType<typeof narrativePairs>) => pairs.filter((x) => x.sameName === true).map((x) => [x.a, x.b].sort().join('+'));

test('★ two sure posts with the same distinctive name pair, though their words and pictures share nothing', () => {
  const posts = [row('elon', 'ARAGORN', 0.9, 'Prophetic'), row('gov', 'ARAGORN', 0.9, 'Get up, patriots.', 50), row('other', 'PNUT')];
  assert.deepEqual(named(narrativePairs(posts, new Map(), new Map(), DEFAULT_POLICY)), ['elon+gov']);
});

test('★ a name many posts carry, an unsure answer, a generic name or a two-day gap pairs nothing by name', () => {
  const many = Array.from({ length: DEFAULT_POLICY.narrative.rareName.maxPosts + 1 }, (_, i) => row(`m${i}`, 'GOLDEN'));
  assert.deepEqual(named(narrativePairs(many, new Map(), new Map(), DEFAULT_POLICY)), []);
  assert.deepEqual(named(narrativePairs([row('a', 'ARAGORN', 0.9), row('b', 'ARAGORN', 0.5)], new Map(), new Map(), DEFAULT_POLICY)), [], 'unsure');
  assert.deepEqual(named(narrativePairs([row('a', 'CAT'), row('b', 'CAT')], new Map(), new Map(), DEFAULT_POLICY)), [], 'generic');
  assert.deepEqual(named(narrativePairs([row('a', 'ARAGORN'), row('b', 'ARAGORN', 0.9, 'x y z w', 3 * 24 * 60)], new Map(), new Map(), DEFAULT_POLICY)), [], 'too far apart');
});

test('★ the grouping links a same-name pair into one narrative, and an owner\'s "keep apart" still holds', async () => {
  const { pairKey } = await import('@insidor/core');
  const posts = [row('elon', 'ARAGORN', 0.9, 'Prophetic'), row('gov', 'ARAGORN', 0.9, 'Get up, patriots.', 50)];
  const pairs = narrativePairs(posts, new Map(), new Map(), DEFAULT_POLICY);
  const run = (apart: ReadonlySet<string>) =>
    groupNarratives({ posts: posts.map(asNarrativePost), pairs, calls: { apart, removed: new Map(), together: [], hidden: [] } as never, previous: new Map(), single: new Set() }, DEFAULT_POLICY);
  const together = run(new Set());
  assert.equal(together.links.name, 1);
  assert.ok(together.narratives.some((x) => JSON.stringify(x).includes('elon') && JSON.stringify(x).includes('gov')), 'one narrative holds both');
  const apart = run(new Set([pairKey('elon', 'gov')]));
  assert.equal(apart.links.name, 0, 'the owner kept them apart');
});

test('★ two same-name posts with nothing in common in meaning (under the floor) do not pair by name', () => {
  const unit = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);
  const posts = [row('a', 'ARAGORN'), row('b', 'ARAGORN')];
  assert.deepEqual(named(narrativePairs(posts, new Map([['a', unit(0)], ['b', unit(1.5)]]), new Map(), DEFAULT_POLICY)), [], 'cos 0.07: nothing in common');
  assert.deepEqual(named(narrativePairs(posts, new Map([['a', unit(0)], ['b', unit(0.85)]]), new Map(), DEFAULT_POLICY)), ['a+b'], 'cos 0.66, the Aragorn pair\'s 0.647: pairs');
});
