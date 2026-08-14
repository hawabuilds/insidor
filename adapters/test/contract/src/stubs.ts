/**
 * Dependencies for building every adapter without a network, a key, or a clock.
 *
 * Every client here throws. That is the point: the conformance suite exercises
 * the capability declarations and the translation layer, both of which must be
 * complete and correct before a single request is made. If a contract test ever
 * needs a client that does not throw, the thing it is testing has leaked into
 * the network half of the adapter and belongs on the other side of the line.
 */

import type { Budget } from '@insidor/contracts/ports/meter.ts';
import { inMemoryMeter } from '@insidor/meter';
import type { InMemoryMeter } from '@insidor/meter';
import { NotImplemented } from '@insidor/vendor-kit';
import type { PlatformDeps } from '@insidor/platform-registry';
import type { VenueDeps } from '@insidor/venue-registry';

const FROZEN_NOW = 1_800_000_000_000;
export const now = (): number => FROZEN_NOW;

/** A budget that is handed in, like the real one. Never read from a global. */
export const budget: Budget = {
  capUsd: Number.MAX_SAFE_INTEGER,
  spentUsd: 0,
  maxCalls: null,
  deadline: FROZEN_NOW + 60_000,
};

export const meter = (): InMemoryMeter =>
  inMemoryMeter({ dailyCapUsd: Number.MAX_SAFE_INTEGER, softStop: 1, now });

const refuse = (endpoint: string) => async (): Promise<never> => {
  throw new NotImplemented(endpoint, 'the conformance suite never reaches a vendor');
};

export function platformDeps(): PlatformDeps {
  const m = meter();
  return {
    x: {
      client: { search: refuse('x:search'), lookup: refuse('x:lookup') },
      meter: m,
      now,
    },
    tiktok: {
      client: { runDiscovery: refuse('tiktok:discover'), runObserve: refuse('tiktok:observe') },
      meter: m,
      now,
      handleOf: () => null,
    },
  };
}

export function venueDeps(): VenueDeps {
  const m = meter();
  return {
    pumpfun: {
      issuer: { listNewCoins: refuse('pumpfun:list'), getCoin: refuse('pumpfun:coin') },
      chain: { oldestSignatureBlockTime: refuse('rpc:signatures'), tokenAccountState: refuse('rpc:account') },
      meter: m,
      now,
      mintTimeOptions: { agreementToleranceMs: 60_000, observationLagS: 10 },
      platformFeeBps: 50,
      baseUsd: () => null,
      networkLamports: 5_000n,
      priorityLamports: 200_000n,
      adjudicatedLabels: 0,
      pageSize: 50,
    },
    pool: {
      client: { pairsForToken: refuse('dexscreener:pairs'), pairsForTokens: refuse('dexscreener:pairs') },
      meter: m,
      now,
      adjudicatedLabels: 0,
    },
  };
}
