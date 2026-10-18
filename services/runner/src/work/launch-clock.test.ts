/** The page coins' launch from the chain (work/launch-clock.ts): off by default, capped, each coin tried once. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { Logger } from '../log.ts';
import { launchClockPass, type LaunchClockDeps } from './launch-clock.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const ON = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, launchClock: { on: true, perPass: 2 } } };

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
  };
}

test('off by default: no read', async () => {
  const asked: string[] = [];
  await launchClockPass(deps([], asked, DEFAULT_POLICY), new Set());
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
