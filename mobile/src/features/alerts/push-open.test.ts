/** A tapped notification's screen gets For You under it, so back lands there; a post's sheet is For You's own. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { parseRoute } from '../../shared/route.ts';
import { freshOpen, isRepeat, launchSteps } from './push-open.ts';

test('★ a coin opens over For You; a post opens as For You with its sheet; For You is For You', () => {
  assert.deepEqual(launchSteps('#/token/solana%3AAbc123pump'), ['#/', '#/token/solana%3AAbc123pump']);
  assert.deepEqual(launchSteps('#/feed/notifications'), ['#/', '#/feed/notifications']);
  assert.deepEqual(launchSteps('#/post/x%3A2110370022296080596'), ['#/post/x%3A2110370022296080596']);
  assert.deepEqual(launchSteps('#/'), ['#/']);
});

test('★ the links pushes carry open their screens: a post its sheet, a coin launch its chart', () => {
  /* As services/notify writes them (people.alert.href, 2026-10-23), and as the worker cuts them at the `#`. */
  const hashOf = (url: string) => url.slice(url.indexOf('#'));
  assert.deepEqual(parseRoute(hashOf('/#/post/x%3A2113437949748785214')), { screen: 'post', postId: 'x:2113437949748785214' });
  assert.deepEqual(parseRoute(hashOf('/#/token/solana%3AGhCkyzX8ngPeC4Anq66khJb2jaSPf13T2DSE4bdkpump')), { screen: 'token', coinId: 'solana:GhCkyzX8ngPeC4Anq66khJb2jaSPf13T2DSE4bdkpump' });
});

test('★ a pending open is taken while fresh, and only as an in-app screen', () => {
  const now = 1_792_500_000_000;
  assert.equal(freshOpen({ hash: '#/post/x%3A1', at: now - 2_000 }, now), '#/post/x%3A1');
  assert.equal(freshOpen({ hash: '#/post/x%3A1', at: now - 61_000 }, now), null, 'a tap from long ago is not the one that launched us');
  assert.equal(freshOpen({ hash: 'https://elsewhere.example/', at: now }, now), null);
  assert.equal(freshOpen({ hash: '#/post/x%3A1' }, now), null);
  assert.equal(freshOpen(null, now), null);
});

test('one tap heard as both the message and the cache opens once; a later tap opens again', () => {
  const now = 1_792_500_000_000;
  const last = { hash: '#/token/solana%3AAbc', at: now };
  assert.equal(isRepeat(last, '#/token/solana%3AAbc', now + 300), true);
  assert.equal(isRepeat(last, '#/post/x%3A1', now + 300), false);
  assert.equal(isRepeat(last, '#/token/solana%3AAbc', now + 60_000), false);
  assert.equal(isRepeat(null, '#/token/solana%3AAbc', now), false);
});
