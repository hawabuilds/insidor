import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tradingOn } from './trading.ts';

test('★ trading is off unless the build says exactly "on"', () => {
  assert.equal(tradingOn({}), false);
  assert.equal(tradingOn({ VITE_TRADING: 'true' }), false);
  assert.equal(tradingOn({ VITE_TRADING: 'ON' }), false);
  assert.equal(tradingOn({ VITE_TRADING: 'on' }), true);
});
