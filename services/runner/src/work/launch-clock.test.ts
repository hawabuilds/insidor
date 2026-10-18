/** The page coins' launch from the chain (work/launch-clock.ts): on, capped a pass and a day, each coin tried once. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { Logger } from '../log.ts';
import { launchClockPass, type LaunchClockDeps } from './launch-clock.ts';

const NOW = 1_792_300_000_000;
const OFF = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, launchClock: { ...DEFAULT_POLICY.narrative.launchClock, on: false } } };
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const ON = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, launchClock: { on: true, perPass: 2, perDay: 3 } } };

function deps(kept: [string, number][], asked: string[], policy = ON): LaunchClockDeps {
  return {
    due: async () => ['a', 'b', 'c'],
    oldestBlockTime: async (address) => {
      asked.push(address);
      if (address === 'b') throw new Error('rpc down');
      return 1_792_029_568;
    },
    keep: async (address, atMs) => void kept.push([address, atMs]),
    mode: 'live',
    policy,
    log: quiet,
    now: () => NOW,
  };
}

test('off: no read', async () => {
  const asked: string[] = [];
  await launchClockPass(deps([], asked, OFF), new Set());
  assert.deepEqual(asked, []);
});

test('★ the block time is kept in milliseconds, at most perPass a pass, and a coin is never asked twice', async () => {
  const kept: [string, number][] = [];
  const asked: string[] = [];
  const tried = new Set<string>();
  const r = await launchClockPass(deps(kept, asked), tried);
  assert.deepEqual(r, { read: 2, kept: 1, failed: 1 });
  assert.deepEqual(kept, [['a', 1_792_029_568_000]]);
  await launchClockPass(deps(kept, asked), tried);
  assert.deepEqual(asked, ['a', 'b', 'c'], 'the failed one is not asked again; the third is asked next pass');
});

test('★ on in the default policy, and at most perDay reads a UTC day however many passes run', async () => {
  assert.equal(DEFAULT_POLICY.narrative.launchClock.on, true);
  const asked: string[] = [];
  const many = { ...deps([], asked), due: async (limit: number) => ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, limit) };
  const tried = new Set<string>();
  const today = { day: '', read: 0 };
  for (let i = 0; i < 4; i += 1) await launchClockPass(many, tried, today);
  assert.deepEqual(asked, ['a', 'b', 'c'], 'three a day, then nothing until the next day');
  await launchClockPass({ ...many, now: () => NOW + 86_400_000 }, tried, today);
  assert.deepEqual(asked, ['a', 'b', 'c', 'd', 'e']);
});
