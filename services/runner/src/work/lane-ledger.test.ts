/**
 * The capped lanes' ledger: keyed by the UTC day, and closed when it cannot be read.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import type { Logger } from '../log.ts';
import { laneLedger, ledgerDay, memoryLaneLedger } from './lane-ledger.ts';

const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;
const AT = Date.parse('2026-10-16T23:59:00Z') as Millis;

test('the day is the UTC day', () => {
  assert.equal(ledgerDay(AT), '2026-10-16');
  assert.equal(ledgerDay((AT + 120_000) as Millis), '2026-10-17');
});

test('★ an unreadable ledger answers null, so the lane asks nothing', async () => {
  const ledger = laneLedger({ spent: async () => { throw new Error('relation "internal.lane_spend" does not exist'); }, add: async () => {} }, quiet);
  assert.equal(await ledger.spent('middle', AT), null);
});

test('a failed write is swallowed and logged, never thrown into the pass', async () => {
  const ledger = laneLedger({ spent: async () => 0, add: async () => { throw new Error('down'); } }, quiet);
  await ledger.add('middle', AT, 0.5);
});

test('what a lane adds is what it reads back that day, and a new day starts at nothing', async () => {
  const ledger = memoryLaneLedger();
  await ledger.add('learned_tag', AT, 0.25);
  await ledger.add('learned_tag', AT, 0.5);
  assert.equal(await ledger.spent('learned_tag', AT), 0.75);
  assert.equal(await ledger.spent('middle', AT), 0, 'lanes are kept apart');
  assert.equal(await ledger.spent('learned_tag', (AT + 120_000) as Millis), 0);
});
