import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { gatewayRest, isRateLimit } from './gateway-rest.ts';

test('★ a gateway that answered 429 rests, then is asked again; the others are untouched', () => {
  let t = 1_000;
  const r = gatewayRest(60_000, () => t);
  assert.ok(r.usable('a') && r.usable('b'));
  r.rest('a');
  assert.equal(r.usable('a'), false, 'resting');
  assert.ok(r.usable('b'), 'another gateway is not rested by it');
  t += 59_999;
  assert.equal(r.usable('a'), false);
  t += 1;
  assert.ok(r.usable('a'), 'asked again once the rest is over');
});

test('only the limit rests a gateway: a 404 or a timeout is one coin\'s, not the gateway\'s', () => {
  assert.ok(isRateLimit({ status: 429 }));
  assert.equal(isRateLimit({ status: 404 }), false);
  assert.equal(isRateLimit(new Error('timeout')), false);
  assert.equal(isRateLimit(null), false);
});
