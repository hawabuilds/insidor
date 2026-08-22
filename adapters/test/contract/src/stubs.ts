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

/**
 * ★ EVERY SOURCE IS SUPPLIED `configured`, DELIBERATELY, AND THAT IS WHAT THIS
 * SUITE IS FOR.
 *
 * `PlatformDeps` can now say a source is dormant or misconfigured, and the
 * registry's own tests exercise those. Here every source is present, because the
 * conformance suite's question is "does this adapter honour its declaration" and
 * an adapter that was never built cannot answer it. A source quietly supplied as
 * dormant here would drop out of `platforms.all()` and its whole contract would
 * stop running, silently, with a green tick — which is the failure mode the
 * registered-but-no-samples test at the top of all.test.ts exists to prevent,
 * arriving through the other door.
 */
export function platformDeps(): PlatformDeps {
  const m = meter();
  return {
    x: {
      kind: 'configured',
      deps: {
        client: { search: refuse('x:search'), lookup: refuse('x:lookup') },
        meter: m,
        now,
      },
    },
    tiktok: {
      kind: 'configured',
      deps: {
        client: { runDiscovery: refuse('tiktok:discover'), runObserve: refuse('tiktok:observe') },
        meter: m,
        now,
        handleOf: () => null,
      },
    },
    /* This source is the first whose real client has an HTTP body rather than a
       `NotImplemented`, which makes the rule above matter more, not less: the
       suite must exercise its capability declaration and its translation with
       the network half replaced entirely. If a contract test ever needs these
       to answer, whatever it is testing has leaked across that line. */
    reddit: {
      kind: 'configured',
      deps: {
        client: { listing: refuse('reddit:listing'), info: refuse('reddit:info') },
        meter: m,
        now,
      },
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
