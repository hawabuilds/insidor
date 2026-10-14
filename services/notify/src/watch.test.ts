/** A watched post's coin: names match whole and long enough, a link is the post's own id, never a part of a longer number. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { carriesPost, nameMatches, normName, postIdOf } from './watch.ts';

const GUESSES = [
  { name: 'Goliath', ticker: 'GOLIATH' },
  { name: 'Six Flags Goliath', ticker: 'SIXFLAG' },
];

test('a new coin matches a watched post by a guessed name or ticker, whole, whatever its case and marks', () => {
  assert.equal(nameMatches({ symbol: '$goliath', name: 'whatever' }, GUESSES, 4), true);
  assert.equal(nameMatches({ symbol: 'GOL', name: 'Six Flags Goliath!' }, GUESSES, 4), true);
  assert.equal(nameMatches({ symbol: 'GOLIATHS', name: 'Goliath 2' }, GUESSES, 4), false, 'a longer name is another name');
  assert.equal(nameMatches({ symbol: null, name: null }, GUESSES, 4), false);
});

test('★ a guess shorter than the floor never matches on its own', () => {
  assert.equal(nameMatches({ symbol: 'CAT', name: 'cat' }, [{ name: 'Cat', ticker: 'CAT' }], 4), false);
  assert.equal(nameMatches({ symbol: 'CATS', name: 'cats' }, [{ name: 'Cats', ticker: 'CATS' }], 4), true);
});

test("a post's link is its own id, as a whole number", () => {
  assert.equal(postIdOf('x:2110370022296080596'), '2110370022296080596');
  assert.equal(postIdOf('tiktok:7550001112223334445'), '7550001112223334445');
  assert.equal(postIdOf('sheet:bt2:1'), null);
  const doc = '{"twitter":"https://x.com/ryanbuilding_/status/2110370022296080596","website":""}';
  assert.equal(carriesPost(doc, '2110370022296080596'), true);
  assert.equal(carriesPost('{"x":"status/92110370022296080596"}', '2110370022296080596'), false, 'part of a longer number is not the post');
});

test('names are compared as letters and digits only', () => {
  assert.equal(normName('  Six-Flags  GOLIATH! '), 'sixflagsgoliath');
  assert.equal(normName(null), '');
});
