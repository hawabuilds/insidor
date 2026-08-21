/**
 * What RESOLVE must be true of.
 *
 * Four of these assert that we said "unsure". That ratio is not an accident of the
 * fixtures — this is the stage where a confident wrong answer costs a user money, so
 * the tests that matter are the ones proving it declines to answer.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Asset, MarketState, TradeQuote } from '@insidor/contracts/asset.ts';
import type { StageContext } from '@insidor/contracts/decision.ts';
import { assetKey, candidateId, chainId, storyId, venueId } from '@insidor/contracts/ids.ts';
import type { AssetRef } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Story } from '@insidor/contracts/story.ts';

import type { ResolveCandidate } from './gates.ts';
import type { CandidateSignals } from './score.ts';
import { resolve, type ResolveInput } from './stage.ts';

const CHAIN = chainId('testchain');
const VENUE = venueId(CHAIN, 'curve');
const STORY = storyId('7f3a');
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const EARLIEST_POST = NOW - 30 * MINUTE;

const CTX: StageContext = { now: NOW, policyHash: 'test-policy-hash', seed: 'story-7f3a' };

/** A venue past its cold start, so the other assertions are about the other rules. */
const LABELLED: Readonly<Record<string, number>> = { [VENUE]: 500 };

const STORY_FIXTURE: Story = {
  storyId: STORY,
  state: 'promoted',
  /* Blind to this field, like every decider in core. 'observed' is the narrow answer. */
  origin: 'observed',
  createdAt: NOW - 40 * MINUTE,
  promotedAt: NOW - 35 * MINUTE,
  earliestPostAt: EARLIEST_POST,
  lastMemberAt: NOW - 2 * MINUTE,
  memberCount: 6,
  distinctAuthors: 5,
  distinctSources: 2,
  carriers: [],
  mergedInto: null,
};

function ref(address: string): AssetRef {
  return { chain: CHAIN, address };
}

function asset(address: string, mintedAtMs: number | null, over: Partial<Asset> = {}): Asset {
  return {
    ref: ref(address),
    key: assetKey(ref(address)),
    chain: CHAIN,
    venue: VENUE,
    /* An asset only reaches a stage through the store's candidate retrieval, which admits
       the origins that are a claim about the world and nothing else. So the representative
       value in a fixture is an observed one; a 'fixture' row is unreachable here by
       construction, and a test that wanted to prove that would have to test the query. */
    origin: 'live_stream',
    mintedAt:
      mintedAtMs === null
        ? { at: null, source: 'none', confidence: 'unknown', boundS: null }
        : { at: mintedAtMs, source: 'chain_rpc', confidence: 'exact', boundS: null },
    symbol: 'HIPPO',
    name: 'small hippo',
    imageUri: null,
    decimals: null,
    creator: null,
    declaredSocial: {},
    firstSeenAt: NOW - 20 * MINUTE,
    ...over,
  };
}

function market(over: Partial<MarketState> = {}): MarketState {
  return {
    asset: ref('a'),
    venue: VENUE,
    observedAt: NOW - MINUTE,
    priceUsd: null,
    marketCapUsd: null,
    marketCapBasis: null,
    // Absent for the same reason as the reserve below: a coin this young has no
    // trailing day behind it. It is not a change of zero, and nothing gates on it
    // either — resolve's gate is quotability.
    priceChange24hPct: null,
    liquidityUsd: null, // a curve has none, and NOTHING gates on it
    depth: { kind: 'bonding-curve', progress: 0.4, slippageBpsAt: { '0.1': 20, '0.5': 60, '1.0': 120 } },
    mintedAt: { at: NOW - 25 * MINUTE, source: 'chain_rpc', confidence: 'exact', boundS: null },
    transferRules: {
      complete: true,
      hasTransferFee: false,
      hasTransferHook: false,
      issuanceRevoked: true,
      freezeRevoked: true,
      requiredChecks: ['issuance', 'freeze'],
      failedChecks: [],
    },
    source: { vendor: 'testvendor', endpoint: '/state', fetchedAt: NOW - MINUTE },
    ...over,
  };
}

function quote(allInBps: number): TradeQuote {
  return {
    asset: ref('a'),
    venue: VENUE,
    side: 'buy',
    inAmount: 25n,
    outExpected: 1000n,
    outMinimum: 990n,
    inDecimals: 9,
    outDecimals: 6,
    slippageBps: 100,
    costs: [],
    allInBps,
    expiresAt: NOW + MINUTE,
    expiryReason: 'ttl',
    route: [{ label: 'direct' }],
  };
}

const STRONG: CandidateSignals = {
  symbol: 1,
  collisionIdf: 1,
  semantic: 0.9,
  image: 0.9,
  declared: 1,
};

function candidate(
  address: string,
  mintedAtMs: number | null,
  signals: CandidateSignals,
  over: Partial<ResolveCandidate> = {},
): ResolveCandidate {
  return {
    candidateId: candidateId(STORY, ref(address)),
    asset: asset(address, mintedAtMs),
    venue: VENUE,
    market: market(),
    quote: quote(200),
    quoteFailed: false,
    signals,
    ...over,
  };
}

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    story: STORY_FIXTURE,
    candidates: [candidate('a1', EARLIEST_POST + 4 * MINUTE, STRONG)],
    venueLabelCounts: LABELLED,
    costUsd: 0.002,
    ...over,
  };
}

test('an asset minted before the earliest post cannot have come from it', () => {
  const d = resolve(
    input({ candidates: [candidate('a1', EARLIEST_POST - MINUTE, STRONG)] }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'drop');
  // Adopted by the story, not minted from it. A different claim, not a mismatch.
  assert.equal(d.reason, 'V5_adopted');
});

test('the temporal gate runs before anything that costs money', () => {
  // No market read, no quote — the reads that would have cost money were never made.
  // The gate still fires, and it fires on time, not on the missing reads.
  const d = resolve(
    input({
      candidates: [
        candidate('a1', EARLIEST_POST - MINUTE, STRONG, { market: null, quote: null }),
      ],
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.reason, 'V5_adopted');
});

test('an unknown origin time is not a candidate at any similarity', () => {
  const d = resolve(input({ candidates: [candidate('a1', null, STRONG)] }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'G1_mint_time_unknown');
});

test('our quote vendor failing is distinguishable from an untradeable asset', () => {
  const down = resolve(
    input({
      candidates: [
        candidate('a1', EARLIEST_POST + 4 * MINUTE, STRONG, { quote: null, quoteFailed: true }),
      ],
    }),
    DEFAULT_POLICY,
    CTX,
  );
  const untradeable = resolve(
    input({
      candidates: [
        candidate('a1', EARLIEST_POST + 4 * MINUTE, STRONG, { quote: null, quoteFailed: false }),
      ],
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(down.reason, 'G7_vendor_unavailable');
  assert.equal(untradeable.reason, 'G7_unquotable');
});

test('nothing gates on liquidity: a curve with no reserve still resolves', () => {
  const d = resolve(input(), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'V0_confirmed');
});

test('two candidates the score cannot separate produce UNSURE, not a coin flip', () => {
  const d = resolve(
    input({
      candidates: [
        candidate('a1', EARLIEST_POST + 4 * MINUTE, STRONG),
        candidate('a2', EARLIEST_POST + 5 * MINUTE, STRONG),
      ],
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'V1_unsure_margin');
  assert.ok((d.features.margin ?? 1) < DEFAULT_POLICY.resolve.deltaMargin);
});

test('a weak best candidate is unsure on the bar, not on the margin', () => {
  const weak: CandidateSignals = {
    symbol: 0.2,
    collisionIdf: 0.2,
    semantic: 0.1,
    image: null,
    declared: null,
  };
  const d = resolve(
    input({ candidates: [candidate('a1', EARLIEST_POST + 4 * MINUTE, weak)] }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'V2_unsure_score');
});

test('a venue below its label floor may say unsure at most, never confirmed', () => {
  const d = resolve(input({ venueLabelCounts: {} }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'V4_venue_cold_start');
  assert.equal(d.features.venueLabels, 0);
});

test('an empty candidate set is its own reason, not a low score', () => {
  const d = resolve(input({ candidates: [] }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'V3_no_candidates');
  assert.equal(d.subjectKind, 'story');
});

test('a confirmed decision is about the pair, and names it', () => {
  const d = resolve(input(), DEFAULT_POLICY, CTX);

  assert.equal(d.subjectKind, 'candidate');
  assert.equal(d.subjectId, `${STORY}|${assetKey(ref('a1'))}`);
  assert.ok(d.featureAsOf <= d.decidedAt, 'no lookahead');
});

test('a second-hand origin time whose bound is wider than the lag is not usable', () => {
  const vague = candidate('a1', EARLIEST_POST + 4 * MINUTE, STRONG);
  const d = resolve(
    input({
      candidates: [
        {
          ...vague,
          asset: {
            ...vague.asset,
            mintedAt: {
              at: EARLIEST_POST + 4 * MINUTE,
              source: 'vendor_field',
              confidence: 'bounded',
              boundS: 1800, // half an hour of slop on a four-minute lag
            },
          },
        },
      ],
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.reason, 'G1_mint_time_unknown');
});

test('the policy the decision was judged against is on the decision', () => {
  const strict: Policy = {
    ...DEFAULT_POLICY,
    resolve: { ...DEFAULT_POLICY.resolve, maxAllInBps: 100 },
  };
  const d = resolve(input(), strict, CTX);

  assert.equal(d.reason, 'G8_cost_absurd');
  assert.equal(d.policyHash, 'test-policy-hash');
});
