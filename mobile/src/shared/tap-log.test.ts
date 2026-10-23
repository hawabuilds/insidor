/** A tapped notification's trail is sent only when it holds a tap, merged in time order (tap-log.ts). */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { deviceOf, trailToSend, type TapRow } from './tap-log.ts';

const row = (at: number, by: string, step: string): TapRow => ({ at, by, step });

test('★ the worker\'s and the page\'s rows are sent as one trail, in time order', () => {
  const page = [row(1, 'page', 'boot'), row(5, 'page', 'stash'), row(6, 'page', 'open')];
  const worker = [row(2, 'sw', 'click'), row(3, 'sw', 'windows'), row(4, 'sw', 'opened')];
  assert.deepEqual(trailToSend(page, worker).map((r) => r.step), ['boot', 'click', 'windows', 'opened', 'stash', 'open']);
});

test('★ a start with no tap in its trail sends nothing', () => {
  assert.deepEqual(trailToSend([row(1, 'page', 'boot'), row(2, 'page', 'look'), row(3, 'page', 'gate')], []), []);
  assert.equal(trailToSend([row(1, 'page', 'boot')], [row(2, 'sw', 'click')]).length, 2, 'a tap the page never heard is exactly what must be sent');
});

test('the phone is named by kind and system version, nothing more', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  assert.equal(deviceOf(ua, true), 'iPhone iOS 18_2 home-screen app');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14)', false), 'Android browser tab');
});
