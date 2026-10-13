/**
 * The older-coins step against fakes: a hit that does not carry the subject's name is never
 * measured, a cut candle reply is not a reading, a source failure is written as one, and the
 * Goliath shape is measured as running.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { DueOlderCoin, OlderCoinReading } from '@insidor/store';

import type { Logger } from '../log.ts';
import { CANDLE_LIMIT, checkOlderCoins, fits, type CandleSource } from './older-coins.ts';

const H = 3_600_000;
const Q = 15 * 60_000;
const POST = 1_791_840_000_000 as Millis;
const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => log };

const pair = (over: Partial<DueOlderCoin> = {}): DueOlderCoin => ({
  itemId: 'x:1',
  address: '4wg6M8RWGjhmXJcBr2v1G2uum2GZyDFk39Dby4bMpump',
  name: 'The Goliath Expedition',
  ticker: 'KARL',
  launchedAt: (POST - 150 * 24 * H) as Millis,
  postedAt: POST,
  names: ['GOLIATH', 'ROLLERDEATH', 'COASTER'],
  outcome: 'waiting',
  ...over,
});

function harness(due: readonly DueOlderCoin[], candles: CandleSource) {
  const readings: { address: string; reading: OlderCoinReading }[] = [];
  const differs: string[] = [];
  const failed: string[] = [];
  return {
    readings,
    differs,
    failed,
    run: () =>
      checkOlderCoins({
        older: {
          due: async () => due,
          recordNameDiffers: async (_i, address) => void differs.push(address),
          recordReading: async (_i, address, reading) => void readings.push({ address, reading }),
          recordFailed: async (_i, address) => void failed.push(address),
        },
        candles,
        log,
        now: () => (POST + 7 * H) as Millis,
      }),
  };
}

/** The Goliath coin's day: about $190 an hour before the post, $1,579 in one bucket after. */
const goliath: CandleSource = {
  history: async () => ({
    pool: {},
    candles: [
      ...Array.from({ length: 24 }, (_, i) => ({ t: POST - (i + 1) * H, c: 0.0000167, v: 190 })),
      { t: POST + 2 * H, c: 0.0000136, v: 1_579 },
      { t: POST + 3 * H, c: 0.0000125, v: 353 },
    ],
  }),
};

test('★ the Goliath coin, named for the subject and eight times its usual hour since, is measured running', async () => {
  const h = harness([pair()], goliath);
  const result = await h.run();
  assert.equal(result.running, 1);
  assert.equal(h.readings[0]?.reading.running, true);
  assert.equal(h.readings[0]?.reading.peakHourUsd, 1_579);
  assert.ok((h.readings[0]?.reading.priceSinceUsd ?? 1) < (h.readings[0]?.reading.priceAtPostUsd ?? 0), 'the price fell, and the reading says so');
});

test('a fuzzy hit that does not carry the subject\'s name is noted and never read', async () => {
  let asked = 0;
  const h = harness([pair({ name: 'Six Flags Flasher', ticker: 'SFF' })], { history: async () => ((asked += 1), { pool: null, candles: [] }) });
  await h.run();
  assert.deepEqual(h.differs, ['4wg6M8RWGjhmXJcBr2v1G2uum2GZyDFk39Dby4bMpump']);
  assert.equal(asked, 0);
  assert.equal(fits(pair()), true);
});

test('★ a full reply that does not reach back to the day before is cut: unread, not running', async () => {
  const cut: CandleSource = { history: async () => ({ pool: {}, candles: Array.from({ length: CANDLE_LIMIT }, (_, i) => ({ t: POST - 2 * H + i * Q, c: 1, v: 5_000 })) }) };
  const h = harness([pair()], cut);
  await h.run();
  assert.equal(h.readings[0]?.reading.running, false);
  assert.equal(h.readings[0]?.reading.hourBeforeUsd, null);
});

test('a source failure is written as a failure, never as a quiet coin', async () => {
  const h = harness([pair()], { history: async () => { throw new Error('responded 429'); } });
  const result = await h.run();
  assert.equal(result.failed, 1);
  assert.deepEqual(h.readings, []);
});
