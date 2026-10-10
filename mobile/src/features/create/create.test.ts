import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanTicker, suggestTicker } from './create-form.ts';

test('a short name suggests its last word, a long title its first', () => {
  assert.equal(suggestTicker('Grim Reaper'), 'REAPER');
  assert.equal(suggestTicker('Jimothy'), 'JIMOTHY');
  assert.equal(suggestTicker('Jimothy Heads To DC'), 'JIMOTHY');
});

test('a ticker is capitals and digits, ten at most', () => {
  assert.equal(cleanTicker('$fer-ry 2!'), 'FERRY2');
  assert.equal(cleanTicker('abcdefghijklmnop'), 'ABCDEFGHIJ');
  assert.equal(suggestTicker('  '), '');
});
