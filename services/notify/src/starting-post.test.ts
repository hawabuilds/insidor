/** The started-a-narrative wording is said only for the narrative's starting post, with a public title, had before the coin. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { startedTitle, type StartRow } from './starting-post.ts';

const HAD = 1_792_500_000_000;
const row = (over: Partial<StartRow> = {}): StartRow => ({ itemId: 'x:1', startItem: 'x:1', title: 'Dogzilla', posts: 5, hadPostMs: HAD, ...over });

test('★ the starting post, had before the coin, on a public narrative: its title', () => {
  assert.equal(startedTitle(row(), HAD + 60_000), 'Dogzilla');
  assert.equal(startedTitle(row({ title: '  Dogzilla ' }), HAD), 'Dogzilla');
});

test('★ a later post of the narrative (the chatter, not the start) keeps the normal wording', () => {
  assert.equal(startedTitle(row({ itemId: 'x:2' }), HAD + 60_000), null);
  assert.equal(startedTitle(row({ startItem: null }), HAD + 60_000), null);
});

test('a post in no narrative, a one-post narrative, or one with no public page keeps the normal wording', () => {
  assert.equal(startedTitle(undefined, HAD), null);
  assert.equal(startedTitle(row({ posts: 1 }), HAD + 1), null);
  assert.equal(startedTitle(row({ title: null }), HAD + 1), null);
  assert.equal(startedTitle(row({ title: ' ' }), HAD + 1), null);
});

test('★ a coin launched before we had the post, or of unknown launch, keeps the normal wording', () => {
  assert.equal(startedTitle(row(), HAD - 1), null);
  assert.equal(startedTitle(row(), null), null);
  assert.equal(startedTitle(row({ hadPostMs: null }), HAD), null);
});
