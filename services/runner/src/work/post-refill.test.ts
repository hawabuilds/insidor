/**
 * Filling in older feed posts' videos: one batched read, the media stored only where the re-read
 * has a playable file, each post asked at most a few times and not again straight away, the day's
 * cap held, a dry run priced and nothing read.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, MediaRef, Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { RefillDue } from '@insidor/store';

import type { Logger } from '../log.ts';
import { refillMemory, refillPosts, type RefillDeps } from './post-refill.ts';

const NOW = 1_800_000_000_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const meter = {
  mayspend: () => true,
  record: () => undefined,
  spentUsd: () => 0,
  line: () => ({ capUsd: 10, spentUsd: 0, stopAtUsd: 10, remainingUsd: 10, unrecordedUsd: 0 }),
} as unknown as Meter;

const video = (playUri?: string): MediaRef => ({ kind: 'video', uri: 'https://pbs/still.jpg', width: null, height: null, durationMs: null, ...(playUri === undefined ? {} : { playUri }) });

function setup(mode: 'dry' | 'live' = 'live', policy = DEFAULT_POLICY) {
  const written: { id: string; media: readonly MediaRef[] }[] = [];
  const asked: string[][] = [];
  let clock = NOW;
  const due: RefillDue[] = [
    { itemId: 'x:1', source: 'x', sourceItemId: '1' },
    { itemId: 'x:2', source: 'x', sourceItemId: '2' },
  ];
  const x = {
    id: 'x',
    estimate: () => ({ vendor: 'v', endpoint: 'lookup', unit: 'per-item-returned', estUnits: 2, usd: 0.0003 }),
    lookup: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return {
        value: {
          items: [
            { sourceItemId: '1', media: [video('https://video/1.mp4')] } as unknown as Item,
            { sourceItemId: '2', media: [video()] } as unknown as Item,
          ],
          authors: [],
          cursor: null,
          hasMore: false,
        },
        spend: { vendor: 'v', endpoint: 'lookup', unit: 'per-item-returned', units: 2, usd: 0.0003, at: NOW },
      };
    },
  } as unknown as PlatformAdapter;
  const deps: RefillDeps = {
    platforms: { all: () => [x] },
    refill: { due: async () => due, setMedia: async (id, m) => (written.push({ id, media: m }), true) },
    meter,
    mode,
    policy,
    log: quiet,
    now: () => clock as Millis,
  };
  return { deps, written, asked, tick: (ms: number) => void (clock += ms) };
}

test('★ one read: the media stored only where the re-read has a playable file', async () => {
  const { deps, written, asked } = setup();
  const out = await refillPosts(deps, refillMemory());
  assert.deepEqual(asked, [['1', '2']]);
  assert.deepEqual(written.map((m) => m.id), ['x:1'], 'post 2 came back with no mp4: its media is left alone');
  assert.equal(out.filled, 1);
  assert.equal(out.spentUsd, 0.0003);
});

test('a post is not asked again straight away, and at most refillMaxTries times', async () => {
  const { deps, asked, tick } = setup();
  const memory = refillMemory();
  await refillPosts(deps, memory);
  await refillPosts(deps, memory);
  assert.equal(asked.length, 1, 'half a minute later: not again yet');
  for (let i = 0; i < DEFAULT_POLICY.rising.refillMaxTries + 2; i += 1) {
    tick(3_600_000);
    await refillPosts(deps, memory);
  }
  assert.equal(asked.length, DEFAULT_POLICY.rising.refillMaxTries);
});

test("the day's cap holds", async () => {
  const policy = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, refillPerDay: 1 } };
  const { deps, asked } = setup('live', policy);
  await refillPosts(deps, refillMemory());
  assert.deepEqual(asked, [['1']]);
});

test('a dry run prices the read and reads nothing', async () => {
  const { deps, asked, written } = setup('dry');
  const out = await refillPosts(deps, refillMemory());
  assert.equal(asked.length, 0);
  assert.equal(written.length, 0);
  assert.equal(out.wouldSpendUsd, 0.0003);
});
