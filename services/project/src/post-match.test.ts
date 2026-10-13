/**
 * The Create sheet's name ideas as the projector writes them: brands dropped, including a brand
 * split over two words, and the subject's own one-word name first. The cases are the judge's
 * real answers from 12–13 October that reached the sheet with a brand or a filler ticker.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isBrand, postNameIdeas } from './post-match.ts';

test('a brand is caught as a word, run together, or split over neighbouring words', () => {
  assert.equal(isBrand('SIXFLAGS COASTER'), true);
  assert.equal(isBrand('SIX FLAGS GOLIATH'), true);
  assert.equal(isBrand('Coasters at Six Flags'), true);
  assert.equal(isBrand('Burger King Crown'), true);
  assert.equal(isBrand('GOLIATH'), false);
  assert.equal(isBrand('COASTER FALL'), false);
});

test('the sheet never offers a brand or a filler ticker', () => {
  assert.deepEqual(postNameIdeas('SIXFLAGS COASTER', ['COASTER FALL', 'SIXFLAGS MEME']), [{ name: 'COASTER FALL', ticker: 'COASTER' }]);
  assert.deepEqual(postNameIdeas('GOLIATH', ['ROLLCOASTER DEATH', 'SIXFLAGS TRAGEDY']), [
    { name: 'GOLIATH', ticker: 'GOLIATH' },
    { name: 'ROLLCOASTER DEATH', ticker: 'ROLLCOASTR' },
  ]);
  assert.deepEqual(postNameIdeas('Buck Me', ['the Buck Me ad']), [
    { name: 'Buck Me', ticker: 'BUCKME' },
    { name: 'the Buck Me ad', ticker: 'BUCKMEAD' },
  ]);
});
