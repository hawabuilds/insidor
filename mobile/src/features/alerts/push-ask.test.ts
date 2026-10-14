/** The sign-in ask for notifications: when it shows, which one, and how long "Not now" holds. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { declinedAt, markDeclined, pushAsk, type KeyValue } from './push-ask.ts';

const DAY = 86_400_000;
const BASE = { signedIn: true, place: 'ready', permission: 'default', serverPush: true, declinedAt: null, now: 100 * DAY } as const;

test('★ signed in, never asked, on a phone that can take pushes: the Allow pop-up', () => {
  assert.equal(pushAsk(BASE), 'allow');
});

test('signed out, or a server that sends no pushes: nothing', () => {
  assert.equal(pushAsk({ ...BASE, signedIn: false }), 'none');
  assert.equal(pushAsk({ ...BASE, serverPush: false }), 'none');
});

test('★ a phone that already answered is never asked again, allowed or blocked', () => {
  assert.equal(pushAsk({ ...BASE, permission: 'granted' }), 'none');
  assert.equal(pushAsk({ ...BASE, permission: 'denied' }), 'none');
});

test('★ iPhone Safari in a tab gets the Add to Home Screen guide; a browser with no push gets nothing', () => {
  assert.equal(pushAsk({ ...BASE, place: 'needs-home-screen' }), 'home-screen');
  assert.equal(pushAsk({ ...BASE, place: 'unsupported' }), 'none');
});

test('Not now holds for thirty days on this device, then it may ask again', () => {
  assert.equal(pushAsk({ ...BASE, declinedAt: BASE.now - 29 * DAY }), 'none');
  assert.equal(pushAsk({ ...BASE, place: 'needs-home-screen', declinedAt: BASE.now - 29 * DAY }), 'none');
  assert.equal(pushAsk({ ...BASE, declinedAt: BASE.now - 31 * DAY }), 'allow');
});

test('Not now is kept per device, and a broken store never blocks the ask for good', () => {
  const data = new Map<string, string>();
  const store: KeyValue = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  assert.equal(declinedAt(store), null);
  markDeclined(store, 5);
  assert.equal(declinedAt(store), 5);
  assert.equal(declinedAt({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} }), null);
  assert.equal(declinedAt(null), null);
});
