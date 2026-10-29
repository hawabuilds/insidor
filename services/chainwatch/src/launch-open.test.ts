import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LaunchOpens, OPEN_WINDOW_MS } from './launch-open.ts';

const T0 = 1_800_000_000_000;
const buy = (maker: string, atMs: number, usd: number | null = 10) => ({ coin: 'C', side: 'buy' as const, maker, usd, atMs });

test('★ a launch\'s first second: buys, distinct buyers and the creator\'s opening buy, one row when it closes', () => {
  const o = new LaunchOpens();
  o.launched('C', T0, T0);
  o.trade(buy('dev', T0, 400));
  o.trade(buy('w1', T0 + 100));
  o.trade(buy('w1', T0 + 200));
  o.trade(buy('w2', T0 + OPEN_WINDOW_MS));
  o.trade({ coin: 'C', side: 'sell', maker: 'w3', usd: 5, atMs: T0 + 300 });
  assert.deepEqual(o.take(T0 + 500), [], 'still open');
  o.trade(buy('late', T0 + OPEN_WINDOW_MS + 1));
  assert.deepEqual(o.take(T0 + 2_000), [{ address: 'C', launchedAtMs: T0, buyers: 3, buys: 4, devBuyUsd: 400 }]);
  assert.deepEqual(o.take(T0 + 3_000), [], 'one row a launch');
});

test('a launch nobody bought after still closes, by wall time; a coin whose launch was not seen is not counted', () => {
  const o = new LaunchOpens();
  o.launched('C', T0, T0);
  o.trade(buy('dev', T0, null));
  o.trade({ coin: 'OTHER', side: 'buy', maker: 'x', usd: 1, atMs: T0 });
  assert.deepEqual(o.take(T0 + 10_000), [{ address: 'C', launchedAtMs: T0, buyers: 1, buys: 1, devBuyUsd: null }]);
});
