/** The iPhone's zoom on focus is stopped, and only there (viewport.ts). */

import test from 'node:test';
import assert from 'node:assert/strict';

import { shortBy, withoutFocusZoom, zoomsOnFocus } from './viewport.ts';

const LINE = 'width=device-width, initial-scale=1, viewport-fit=cover';

test('the limit is added and the rest of the line is kept', () => {
  assert.equal(withoutFocusZoom(LINE), `${LINE}, maximum-scale=1`);
  assert.equal(withoutFocusZoom(`${LINE}, maximum-scale=1`), `${LINE}, maximum-scale=1`);
  assert.equal(withoutFocusZoom(''), 'maximum-scale=1');
});

test('only iPhones and iPads', () => {
  assert.equal(zoomsOnFocus('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15', true), true);
  assert.equal(zoomsOnFocus('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0', true), true);
  assert.equal(zoomsOnFocus('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', true), true);
  assert.equal(zoomsOnFocus('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', false), false);
  assert.equal(zoomsOnFocus('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile', true), false);
});

test('a page short of the screen by the status bar is stretched by exactly that', () => {
  /* The owner's iPhone, 2026-11-12: an 844pt screen, a 797pt page, a 47pt status bar. */
  assert.equal(shortBy(844, 797, 47), 47);
  assert.equal(shortBy(844, 797.5, 47), 46.5);
});

test('any other shortfall is not this bug and is left alone', () => {
  assert.equal(shortBy(844, 844, 47), 0, 'no shortfall');
  assert.equal(shortBy(844, 508, 47), 0, 'a keyboard');
  assert.equal(shortBy(844, 760, 47), 0, 'a toolbar');
  assert.equal(shortBy(844, 797, 0), 0, 'no status bar, as in landscape');
  assert.equal(shortBy(797, 844, 47), 0, 'a page taller than the screen');
});
