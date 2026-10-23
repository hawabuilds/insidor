/** The iPhone's zoom on focus is stopped, and only there (viewport.ts). */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bottomDrift, shortAfterKeyboard, withoutFocusZoom, zoomsOnFocus } from './viewport.ts';

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

test('the bottom bars move only when the visible screen has drifted from the page box', () => {
  assert.equal(bottomDrift(852, 852, 0), 0);
  assert.equal(bottomDrift(852, 852.4, 0), 0);
  assert.equal(bottomDrift(852, 852, 40), 40);
  assert.equal(bottomDrift(852, 800, 0), -52);
});

test('a page box left short after the keyboard moves the bars only by a keyboard-sized gap', () => {
  assert.equal(shortAfterKeyboard(852, 852, false, 150), 0);
  assert.equal(shortAfterKeyboard(852, 793, false, 150), 0, 'a status bar\'s worth is not moved for');
  assert.equal(shortAfterKeyboard(852, 552, false, 150), 300);
  assert.equal(shortAfterKeyboard(852, 552, true, 150), 0, 'never while typing');
});
