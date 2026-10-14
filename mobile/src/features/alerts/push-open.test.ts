/** A tapped notification's screen gets For You under it, so back lands there; a post's sheet is For You's own. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { launchSteps } from './push-open.ts';

test('★ a coin opens over For You; a post opens as For You with its sheet; For You is For You', () => {
  assert.deepEqual(launchSteps('#/token/solana%3AAbc123pump'), ['#/', '#/token/solana%3AAbc123pump']);
  assert.deepEqual(launchSteps('#/feed/notifications'), ['#/', '#/feed/notifications']);
  assert.deepEqual(launchSteps('#/post/x%3A2110370022296080596'), ['#/post/x%3A2110370022296080596']);
  assert.deepEqual(launchSteps('#/'), ['#/']);
});
