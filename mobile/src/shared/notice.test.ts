import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardNotice, storyNotice } from './notice.ts';

const seeded = { kind: 'seeded', seededStories: 6, totalStories: 6, connectSourceLabel: 'Reddit' } as const;

test('rows the server says were written by hand carry the notice and name the free source', () => {
  const n = boardNotice(seeded);
  assert.equal(n?.headline, 'Sample data');
  assert.match(n?.detail ?? '', /All 6 stories/);
  assert.match(n?.detail ?? '', /Reddit/);
});

test('the notice removes itself only when the server says the rows were observed', () => {
  assert.equal(boardNotice({ kind: 'observed' }), null);
  assert.equal(storyNotice({ kind: 'observed' }), null);
});

test('a frame that did not say is not treated as observed', () => {
  assert.notEqual(boardNotice({ kind: 'unstated' }), null);
  assert.notEqual(storyNotice({ kind: 'unstated' }), null);
});

test('before the first frame there is nothing to warn about yet', () => {
  assert.equal(boardNotice(null), null);
});
