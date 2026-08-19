/**
 * The wide candidate vector, as the absence rule it exists under.
 *
 * These rows are the training set. RESOLVE abstains whenever it is unsure, the vector
 * it abstained on is frozen, and a human adjudicating it later produces a label
 * against that frozen vector — which is how a venue clears its cold start without a
 * single confident wrong answer. Every null in here is therefore a null a human will
 * one day be asked to interpret, and a zero written where a null belonged is a lie
 * told to that human, months in advance, with no way for them to detect it.
 *
 * So the tests below are all one shape: two candidates that a careless builder would
 * make identical, and an assertion that they are two different rows.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Asset, MarketState, TradeQuote } from '@insidor/contracts/asset.ts';
import { assetKey, candidateId, chainId, storyId, venueId } from '@insidor/contracts/ids.ts';
import type { AssetRef } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Story } from '@insidor/contracts/story.ts';

import { GATE_ORDER, runGates, type ResolveCandidate } from '../resolve/gates.ts';
import { candidateScore, type CandidateSignals } from '../resolve/score.ts';
import { candidateFeatures } from './candidate.ts';
import { featureShapeHash } from './registry.ts';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const CHAIN = chainId('testchain');
const VENUE = venueId(CHAIN, 'curve');
const STORY = storyId('7f3a');
const EARLIEST_POST = NOW - 30 * MINUTE;
const P = DEFAULT_POLICY;

const STORY_FIXTURE: Story = {
  storyId: STORY,
  state: 'promoted',
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

function asset(address: string, originAt: number | null, over: Partial<Asset> = {}): Asset {
  return {
    ref: ref(address),
    key: assetKey(ref(address)),
    chain: CHAIN,
    venue: VENUE,
    mintedAt:
      originAt === null
        ? { at: null, source: 'none', confidence: 'unknown', boundS: null }
        : { at: originAt, source: 'chain_rpc', confidence: 'exact', boundS: null },
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

function tradeQuote(allInBps: number): TradeQuote {
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

const ALL_MEASURED: CandidateSignals = {
  symbol: 0.9,
  collisionIdf: 0.8,
  semantic: 0.7,
  image: 0.6,
  declared: 0.5,
};

/**
 * The overrides a test may set, named so this file needs no vocabulary escape beyond
 * the single line that builds the contract's own field. `tradeQuote` carries an
 * allowed stem; the field on `ResolveCandidate` does not, and renaming a contract to
 * suit a test would be the tail wagging the dog.
 */
interface CandidateSpec {
  readonly asset?: Asset;
  readonly market?: MarketState | null;
  readonly tradeQuote?: TradeQuote | null;
  readonly quoteFailed?: boolean;
  readonly signals?: CandidateSignals;
}

function candidate(spec: CandidateSpec = {}): ResolveCandidate {
  const a = spec.asset ?? asset('a', EARLIEST_POST + 4 * MINUTE);
  return {
    candidateId: candidateId(STORY, a.ref),
    asset: a,
    venue: VENUE,
    market: spec.market === undefined ? market() : spec.market,
    quote: spec.tradeQuote === undefined ? tradeQuote(300) : spec.tradeQuote, // vocab-allow: quote — the executable price at the probe size, RESOLVE's sense of the word and the field name on the contract.
    quoteFailed: spec.quoteFailed ?? false,
    signals: spec.signals ?? ALL_MEASURED,
  };
}

/* ── the absence rule ─────────────────────────────────────────────────── */

test('an unmeasured channel stays null in the vector even though the score reads it as zero', () => {
  const unmeasured: CandidateSignals = { ...ALL_MEASURED, image: null, semantic: null };
  const measuredZero: CandidateSignals = { ...ALL_MEASURED, image: 0, semantic: 0 };

  const absent = candidateFeatures(candidate({ signals: unmeasured }), STORY_FIXTURE, P);
  const zero = candidateFeatures(candidate({ signals: measuredZero }), STORY_FIXTURE, P);

  // ★ The SCORE is allowed to read both as zero, and does, deliberately — a candidate
  // with one measurable channel must not look as convincing as one with five, so
  // score.ts does not renormalise. That is a decision, and a decision has to be made
  // with what it has.
  const lag = 4 * MINUTE;
  assert.equal(candidateScore(unmeasured, lag, P), candidateScore(measuredZero, lag, P));

  // The VECTOR is not a decision, and its rule is the opposite. "We looked at the
  // image and it did not match" and "the image pipeline was down" are two different
  // rows, and a human adjudicating this one in three months has no other way to tell.
  assert.equal(absent.image, null);
  assert.equal(absent.semantic, null);
  assert.equal(zero.image, 0);
  assert.equal(zero.semantic, 0);
  assert.equal(absent.measuredChannels, 3);
  assert.equal(zero.measuredChannels, 5);
});

test('a symbol nobody could measure is not a symbol that disagreed', () => {
  const noSymbol = candidateFeatures(
    candidate({ signals: { ...ALL_MEASURED, symbol: null } }),
    STORY_FIXTURE,
    P,
  );
  const common = candidateFeatures(
    candidate({ signals: { ...ALL_MEASURED, collisionIdf: 0 } }),
    STORY_FIXTURE,
    P,
  );

  // A symbol is an observation about an asset and never an identifier. Agreeing on
  // one that everything carries is worth nothing — which is the second row here, an
  // honest zero — while the first row is a channel we never got to look at.
  assert.equal(noSymbol.symbolChannel, null);
  assert.equal(common.symbolChannel, 0);
});

test('a vendor outage and an unquotable asset are two different rows', () => {
  const ourOutage = candidate({ tradeQuote: null, quoteFailed: true });
  const theirIlliquidity = candidate({ tradeQuote: null, quoteFailed: false });

  const outage = candidateFeatures(ourOutage, STORY_FIXTURE, P);
  const illiquid = candidateFeatures(theirIlliquidity, STORY_FIXTURE, P);

  // Both have no price, so both look identical on the obvious field.
  assert.equal(outage.costKnown, 0);
  assert.equal(illiquid.costKnown, 0);

  // ★ And they are still distinguishable, in the vector and in the gate. During an
  // incident the first shape arrives for the WHOLE population at once, which reads as
  // every asset in the market turning illiquid in the same minute — a market event
  // that did not happen. Failing to tell these apart is what made the last outage
  // invisible.
  assert.equal(outage.quoteFailed, 1);
  assert.equal(illiquid.quoteFailed, 0);
  assert.equal(runGates(ourOutage, STORY_FIXTURE, P), 'G7_vendor_unavailable');
  assert.equal(runGates(theirIlliquidity, STORY_FIXTURE, P), 'G7_unquotable');
  assert.notEqual(outage.gateDepth, illiquid.gateDepth);
});

test('unread transfer rules are null, because an unread rule is not a passed rule', () => {
  const unread = candidateFeatures(candidate({ market: null }), STORY_FIXTURE, P);
  const readAndClean = candidateFeatures(candidate(), STORY_FIXTURE, P);

  assert.equal(unread.marketRead, 0);
  assert.equal(unread.hasTransferFee, null);
  assert.equal(unread.hasTransferHook, null);
  assert.equal(unread.transferRulesComplete, null);
  assert.equal(unread.failedCheckShare, null);

  assert.equal(readAndClean.marketRead, 1);
  assert.equal(readAndClean.hasTransferFee, 0);
  assert.equal(readAndClean.failedCheckShare, 0);
});

/* ── the two arguments the stub could not have been written without ───── */

test('the temporal channel is a fact about the pair, so it needs the story', () => {
  const prompt = candidateFeatures(
    candidate({ asset: asset('a', EARLIEST_POST + 2 * MINUTE) }),
    STORY_FIXTURE,
    P,
  );
  const late = candidateFeatures(
    candidate({ asset: asset('a', EARLIEST_POST + 5 * 60 * MINUTE) }),
    STORY_FIXTURE,
    P,
  );

  // The lag is measured against the STORY's earliest post. A candidate does not know
  // which story it is a candidate for, which is the entire question RESOLVE asks —
  // so neither this channel nor any gate below it is reachable from a candidate alone.
  assert.equal(prompt.lagMin, 2);
  assert.ok((prompt.temporal ?? 0) > (late.temporal ?? 0));

  // And an origin time nobody knows is a null lag with a flag beside it, never a
  // lag of zero — which would place an unknown asset at the top of the channel.
  const unknown = candidateFeatures(candidate({ asset: asset('a', null) }), STORY_FIXTURE, P);
  assert.equal(unknown.lagKnown, 0);
  assert.equal(unknown.lagMin, null);
  assert.equal(unknown.mintTimeExact, 0);
  assert.equal(unknown.gateDepth, GATE_ORDER.indexOf('G1_mint_time_unknown'));
});

test('a bounded origin time records the bound as a share of the lag it is ordering', () => {
  const lagMin = 4;
  const tight = candidateFeatures(
    candidate({
      asset: asset('a', EARLIEST_POST + lagMin * MINUTE, {
        mintedAt: {
          at: EARLIEST_POST + lagMin * MINUTE,
          source: 'vendor_field',
          confidence: 'bounded',
          boundS: 60,
        },
      }),
    }),
    STORY_FIXTURE,
    P,
  );

  // A minute of uncertainty about a four-minute lag: the bound is a quarter of the
  // thing it is being used to order, and G1's rule is exactly that comparison. A
  // confident wrong number does not blur the ordering, it REVERSES it, and no null
  // check catches that — so the ratio is a feature rather than an inference.
  assert.equal(tight.mintTimeBounded, 1);
  assert.equal(tight.mintTimeBoundS, 60);
  assert.equal(tight.mintTimeBoundShare, 60 / (lagMin * 60));

  // Unbounded times have no half-width. Null, not a large number.
  assert.equal(
    candidateFeatures(candidate(), STORY_FIXTURE, P).mintTimeBoundShare,
    null,
  );
});

test('nothing gates on depth, and the curve population is the one this product serves', () => {
  const onCurve = candidateFeatures(candidate(), STORY_FIXTURE, P);

  // A curve has no two-sided reserve, so `liquidityUsd` is null and the vector records
  // progress instead. The build this replaces coerced that absence to 0 and rejected
  // anything at 0, which removed essentially the entire pre-graduation population.
  assert.equal(onCurve.depthRead, 1);
  assert.equal(onCurve.depthIsPool, 0);
  assert.equal(onCurve.curveProgress, 0.4);
  assert.equal(onCurve.gatePassed, 1);

  const pooled = candidateFeatures(
    candidate({ market: market({ depth: { kind: 'pool', liquidityUsd: 50_000, poolCount: 2 } }) }),
    STORY_FIXTURE,
    P,
  );
  assert.equal(pooled.depthIsPool, 1);
  // A pool has no curve position. Null rather than 0, which would read as "at the
  // very start of a curve" — a specific and wrong claim about a market of a
  // different shape entirely.
  assert.equal(pooled.curveProgress, null);
  assert.equal(pooled.gatePassed, 1);
});

test('the candidate set has one shape, and changing it is a version bump rather than a diff', () => {
  const full = candidateFeatures(candidate(), STORY_FIXTURE, P);
  const empty = candidateFeatures(
    candidate({
      asset: asset('a', null),
      market: null,
      tradeQuote: null,
      quoteFailed: true,
      signals: { symbol: null, collisionIdf: null, semantic: null, image: null, declared: null },
    }),
    STORY_FIXTURE,
    P,
  );

  assert.equal(featureShapeHash(Object.keys(full)), 'c7428f53');
  assert.equal(Object.keys(full).length, 39);
  // The candidate with nothing measured emits the same keys carrying nulls. A builder
  // that dropped keys instead would make "not measured" and "this row is from an older
  // builder" the same thing, which is the one confusion a frozen training set cannot
  // survive.
  assert.equal(featureShapeHash(Object.keys(empty)), featureShapeHash(Object.keys(full)));
});
