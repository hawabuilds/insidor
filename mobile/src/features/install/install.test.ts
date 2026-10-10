import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dismissedRecently, installWay, isIosSafari, markDismissed, type KeyValue } from './install.ts';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

test('iPhone Safari gets the Home Screen guide; Chrome on iPhone does not', () => {
  assert.equal(isIosSafari(IPHONE_SAFARI, true), true);
  assert.equal(isIosSafari(IPHONE_CHROME, true), false);
});

test('an iPad posing as a Mac is caught by its touch screen; a real Mac is not', () => {
  assert.equal(isIosSafari(MAC_SAFARI, true), true);
  assert.equal(isIosSafari(MAC_SAFARI, false), false);
});

test('an installed app is never asked to install itself', () => {
  assert.equal(installWay({ standalone: true, iosSafari: true, canPrompt: true }), 'none');
});

test('a browser with an install prompt gets the button; one with neither gets nothing', () => {
  assert.equal(installWay({ standalone: false, iosSafari: false, canPrompt: true }), 'prompt');
  assert.equal(installWay({ standalone: false, iosSafari: false, canPrompt: false }), 'none');
});

test('not now lasts thirty days, and a broken store never blocks the guide forever', () => {
  const data = new Map<string, string>();
  const store: KeyValue = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  markDismissed(store, 0);
  assert.equal(dismissedRecently(store, 29 * 86_400_000), true);
  assert.equal(dismissedRecently(store, 31 * 86_400_000), false);
  assert.equal(dismissedRecently({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} }, 0), false);
  assert.equal(dismissedRecently(null, 0), false);
});
