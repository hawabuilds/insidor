/**
 * Re-reading posters' profiles: nothing while the switch is off; when on, one batched read of the
 * due posters' posts on a cheap source only, the accounts stored from it, a poster not asked again
 * inside the cadence, the day's cap held, a dry run priced and nothing read.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Author } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { Db } from '@insidor/store';

import type { Logger } from '../log.ts';
import { bioRefreshMemory, refreshBios, type BioRefreshDeps } from './bio-refresh.ts';

const NOW = 1_800_000_000_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const meter = {
  mayspend: () => true,
  record: () => undefined,
  spentUsd: () => 0,
  line: () => ({ capUsd: 10, spentUsd: 0, stopAtUsd: 10, remainingUsd: 10, unrecordedUsd: 0 }),
} as unknown as Meter;
const on = (over: Partial<Policy['postCoin']['bio']> = {}): Policy => ({ ...DEFAULT_POLICY, postCoin: { ...DEFAULT_POLICY.postCoin, bio: { ...DEFAULT_POLICY.postCoin.bio, refreshOn: true, ...over } } });

function setup(policy: Policy, mode: 'dry' | 'live' = 'live') {
  const asked: string[][] = [];
  const stored: Author[] = [];
  const adapter = (id: string, usdPerPost: number) =>
    ({
      id,
      capabilities: { observeBatchSize: 10 },
      estimate: (call: { sourceItemIds: readonly string[] }) => ({ vendor: id, endpoint: 'lookup', unit: 'per-item-returned', estUnits: 1, usd: usdPerPost * call.sourceItemIds.length }),
      lookup: async (ids: readonly string[]) => {
        asked.push([...ids]);
        return {
          value: { items: [], authors: [{ authorKey: `${id}:a1`, bio: 'CA AMQ8BusAhpwbt3ufSCTi4k3BEQ7AecX9u12Jnk6Spump' } as unknown as Author, { authorKey: `${id}:other` } as unknown as Author], cursor: null, hasMore: false },
          spend: { vendor: id, endpoint: 'lookup', unit: 'per-item-returned', units: 1, usd: 0.00015, at: NOW },
        };
      },
    }) as unknown as PlatformAdapter;
  const db = {
    query: async (sql: string) => (sql.includes('people.post_watch') ? [] : [{ author_key: 'cheap:a1', source: 'cheap', source_item_id: '1', watched: false }, { author_key: 'dear:a1', source: 'dear', source_item_id: '2', watched: false }]),
  } as unknown as Db;
  const deps: BioRefreshDeps = {
    db,
    platforms: { all: () => [adapter('cheap', 0.00015), adapter('dear', 0.004)] },
    authors: { upsert: async (a: readonly Author[]) => (stored.push(...a), a.length) },
    meter,
    mode,
    policy,
    log: quiet,
    now: () => NOW as never,
  };
  return { deps, asked, stored };
}

test('off by default: no read, no query', async () => {
  const { deps, asked } = setup(DEFAULT_POLICY);
  assert.equal(DEFAULT_POLICY.postCoin.bio.refreshOn, false);
  assert.deepEqual(await refreshBios(deps, bioRefreshMemory()), { due: 0, asked: 0, read: 0, wouldSpendUsd: 0, spentUsd: 0 });
  assert.deepEqual(asked, []);
});

test('★ on: the cheap source is read, its due poster stored with the profile; the source billed above the bar is left out', async () => {
  const { deps, asked, stored } = setup(on());
  const memory = bioRefreshMemory();
  const r = await refreshBios(deps, memory);
  assert.deepEqual(asked, [['1']]);
  assert.deepEqual(stored.map((a) => a.authorKey), ['cheap:a1'], 'only the asked poster, not every account the read carried');
  assert.equal(r.read, 1);
  const again = await refreshBios(deps, memory);
  assert.equal(again.asked, 0, 'not asked again inside the cadence, even when its read brought no new profile row');
});

test('the day cap holds, and a dry run prices without reading', async () => {
  const capped = setup(on({ refreshPerDay: 0 }));
  assert.equal((await refreshBios(capped.deps, bioRefreshMemory())).asked, 0);
  const dry = setup(on(), 'dry');
  const r = await refreshBios(dry.deps, bioRefreshMemory());
  assert.deepEqual(dry.asked, []);
  assert.ok(r.wouldSpendUsd > 0);
});
