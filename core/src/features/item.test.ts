/**
 * The wide item vector, as the two prohibitions it exists under.
 *
 * Both are stated in the builder's own header and neither is enforceable by a type,
 * which is exactly why they are written down as tests: nothing about a defaulted zero
 * or a leaked counter fails to compile, and both look completely fine in a code
 * review. The first test below is mechanical — it takes the source's numbers, makes
 * them recognisable, and looks for them in the output — because "no absolute counter"
 * is a rule about values and a rule about values needs a test about values.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { censoredRate, measuredRate } from '@insidor/contracts/vocabulary.ts';
import type {
  Counter,
  CounterKind,
  Fidelity,
  Item,
  Observation,
} from '@insidor/contracts/vocabulary.ts';

import { emptyCorpus, itemFeatures, type SourceCorpus } from './item.ts';
import { featureShapeHash } from './registry.ts';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const FEED = sourceId('feed-a');
const ID = itemId(FEED, 'i1');
const P = DEFAULT_POLICY;

/** Recognisable, so the first test can look for them in the output by value. */
const REACH_LEVEL = 987_654;
const REPRODUCTION_LEVEL = 4_321;

function counter(value: number | null, fidelity: Fidelity = { kind: 'exact' }): Counter {
  return { value, fidelity, observedAt: NOW - MINUTE };
}

function item(over: Partial<Item> = {}): Item {
  return {
    itemId: ID,
    source: FEED,
    sourceItemId: 'i1',
    authorKey: authorKey(FEED, 'a1'),
    postedAt: NOW - 30 * MINUTE,
    firstSeenAt: NOW - 28 * MINUTE,
    lang: null,
    text: 'the ferry refuses to dock and the pigeon is unbothered',
    media: [],
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: 'local:test/i1',
    ...over,
  };
}

/** One measured reading of the driving counter, `perMin` over `overMin` minutes. */
function measured(kind: CounterKind, perMin: number, overMin: number, at: number): Observation {
  return {
    itemId: ID,
    capturedAt: at,
    kind,
    counter: counter(perMin * overMin),
    rate: measuredRate(perMin, overMin * MINUTE, perMin * overMin),
  };
}

/** A reading that told us nothing. It must not read as a rate of zero anywhere. */
function censored(kind: CounterKind, at: number): Observation {
  return {
    itemId: ID,
    capturedAt: at,
    kind,
    counter: counter(null, { kind: 'quantized', significantDigits: 2 }),
    rate: censoredRate('below_step', REPRODUCTION_LEVEL),
  };
}

function corpus(over: Partial<SourceCorpus> = {}): SourceCorpus {
  return { ...emptyCorpus(FEED), ...over };
}

/* ── the prohibition, tested by value ─────────────────────────────────── */

test('no number in the vector is a counter the source handed us', () => {
  const f = itemFeatures(
    item({
      counters: {
        reach: counter(REACH_LEVEL),
        reproduction: counter(REPRODUCTION_LEVEL),
      },
    }),
    [],
    NOW,
    corpus(),
    P,
  );

  // `reach` is autoplay on one source, impressions on another, and does not exist on
  // a third. A model fitted while only the first existed is worthless the day the
  // second arrives, and the only way to prevent that is for the level never to leave
  // this function. It leaves as a RATIO — reproductions per reach — and that ratio is
  // the same statement with the units divided out.
  for (const [key, value] of Object.entries(f)) {
    assert.notEqual(value, REACH_LEVEL, `${key} leaked the source's reach level`);
    assert.notEqual(value, REPRODUCTION_LEVEL, `${key} leaked the source's reproduction level`);
  }

  assert.equal(f.reproductionPerReach, REPRODUCTION_LEVEL / REACH_LEVEL);
});

test('a source that cannot count reproductions is not a source where nobody reproduced', () => {
  const cannotCount = itemFeatures(
    item({ counters: { reach: counter(REACH_LEVEL), reproduction: counter(null, { kind: 'absent' }) } }),
    [],
    NOW,
    corpus(),
    P,
  );
  const countedNone = itemFeatures(
    item({ counters: { reach: counter(REACH_LEVEL), reproduction: counter(0) } }),
    [],
    NOW,
    corpus(),
    P,
  );

  // ★ Two different rows, for ever. The first is a fact about a vendor; the second is
  // a fact about an item, and it is the product's entire thesis measured at zero. A
  // defaulted 0 in the first would teach a model that every item on that source
  // failed to spread, which is the most confident possible statement of the one thing
  // we do not know about it.
  assert.equal(cannotCount.reproductionObserved, 0);
  assert.equal(cannotCount.reproductionPerReach, null);

  assert.equal(countedNone.reproductionObserved, 1);
  assert.equal(countedNone.reproductionPerReach, 0);
});

test('a censored reading contributes neither arrivals nor exposure', () => {
  const readings = [
    measured('reproduction', 20, 5, NOW - 20 * MINUTE),
    measured('reproduction', 30, 5, NOW - 10 * MINUTE),
    measured('reproduction', 40, 5, NOW - 5 * MINUTE),
  ];
  const base = item({ counters: { reproduction: counter(REPRODUCTION_LEVEL) } });

  const clean = itemFeatures(base, readings, NOW, corpus(), P);
  const withCensoring = itemFeatures(
    base,
    [
      censored('reproduction', NOW - 22 * MINUTE),
      readings[0] as Observation,
      censored('reproduction', NOW - 15 * MINUTE),
      readings[1] as Observation,
      censored('reproduction', NOW - 7 * MINUTE),
      readings[2] as Observation,
    ],
    NOW,
    corpus(),
    P,
  );

  // ★ Identical, and that is the whole test. Counting a censored interval as zero
  // arrivals over its elapsed time drags the estimate toward zero in proportion to
  // how UNREADABLE a source's counter is — so the items whose counters round hardest
  // look coldest, and they round hardest exactly when they are moving fast enough for
  // the rounding to hide the change. It is the `deltaPerMinute` bug in a new hat.
  assert.equal(clean.rateLcbPerMin, withCensoring.rateLcbPerMin);
  assert.equal(clean.measuredExposureMin, withCensoring.measuredExposureMin);
  assert.equal(clean.burst, withCensoring.burst);

  // And the censoring is recorded rather than discarded, because a rate estimated
  // from half as many usable readings deserves to be trusted half as much.
  assert.equal(clean.censoredReadShare, 0);
  assert.equal(withCensoring.censoredReadShare, 0.5);
});

test('an hour of evidence outranks a lucky minute at the same raw rate', () => {
  const lucky = itemFeatures(
    item({ counters: { reproduction: counter(REPRODUCTION_LEVEL) } }),
    [measured('reproduction', 50, 1, NOW - MINUTE)],
    NOW,
    corpus(),
    P,
  );

  const sustained = itemFeatures(
    item({ counters: { reproduction: counter(REPRODUCTION_LEVEL) } }),
    Array.from({ length: 60 }, (_, i) => measured('reproduction', 50, 1, NOW - (60 - i) * MINUTE)),
    NOW,
    corpus(),
    P,
  );

  // Same raw rate, to the digit. A ranker fed this number directly would call the two
  // identical, and the first is one reading.
  assert.equal(lucky.driverRatePerMin, sustained.driverRatePerMin);

  // ★ The shrunk bound is what tells them apart, and it is why rank/heat.ts refuses a
  // raw rate: "a brand-new item with one lucky reading outranks an item with an hour
  // of evidence" is the failure, and this is the repair.
  assert.ok((lucky.rateLcbPerMin ?? 0) < (sustained.rateLcbPerMin ?? 0));
  assert.ok((lucky.rateShrinkage ?? 0) > (sustained.rateShrinkage ?? 1));
});

test('an empty corpus produces nulls with a reason, never a fabricated median', () => {
  const readings = [measured('reproduction', 20, 5, NOW - 5 * MINUTE)];
  const day_one = itemFeatures(
    item({ counters: { reproduction: counter(REPRODUCTION_LEVEL) } }),
    readings,
    NOW,
    corpus(),
    P,
  );

  // A percentile against a distribution that does not exist is not a percentile. A
  // 0.5 here would put every item on a brand-new source at the median of nothing,
  // which is the most plausible-looking wrong number available.
  assert.equal(day_one.corpusUsable, 0);
  assert.equal(day_one.corpusItems, 0);
  assert.equal(day_one.rateLcbNorm, null);
  assert.equal(day_one.driverRatePct, null);
  assert.equal(day_one.textLenPct, null);
  // The rate itself is still there: it needs no corpus, only readings.
  assert.ok((day_one.rateLcbPerMin ?? 0) > 0);

  const withHistory = itemFeatures(
    item({ counters: { reproduction: counter(REPRODUCTION_LEVEL) } }),
    readings,
    NOW,
    corpus({
      items: P.features.minCorpusItems,
      ratePerMin: { reproduction: [1, 2, 3, 4] },
      rateLcbPerMin: { reproduction: [0.1, 0.2, 0.3, 0.4] },
      textLen: [10, 20, 30, 40],
    }),
    P,
  );
  assert.equal(withHistory.corpusUsable, 1);
  assert.equal(withHistory.rateLcbNorm, 1);
});

test('no measured exposure is an absence, and the prior alone is never reported as a rate', () => {
  const neverMeasured = itemFeatures(
    item({ counters: { reproduction: counter(REPRODUCTION_LEVEL) } }),
    [censored('reproduction', NOW - 5 * MINUTE), censored('reproduction', NOW - MINUTE)],
    NOW,
    corpus(),
    P,
  );

  // The prior is a claim about how fast an item is moving, made without having
  // successfully measured it once. Returning it here would give every unmeasurable
  // item the same confident small number and no way to tell it apart from a measured
  // one, which is the shape of every absence bug in this system.
  assert.equal(neverMeasured.rateLcbPerMin, null);
  assert.equal(neverMeasured.driverRatePerMin, null);
  assert.equal(neverMeasured.measuredExposureMin, 0);
  assert.equal(neverMeasured.censoredReadShare, 1);
});

test('the item set has one shape, and changing it is a version bump rather than a diff', () => {
  const f = itemFeatures(item(), [], NOW, corpus(), P);

  // ★ Two rows carrying the same `featureSet` string and different key sets is the
  // most expensive silent bug a training pipeline has, because nothing looks wrong
  // until the model is worse and nobody can say when it started. This assertion is
  // what makes adding, removing or renaming a key a deliberate act: it fails here,
  // and the fix is `item.wide.v2`, not a new hash.
  assert.equal(featureShapeHash(Object.keys(f)), '45772ef9');
  assert.equal(Object.keys(f).length, 46);

  // And the shape does not depend on the input. An item with every counter and an
  // hour of readings emits the same keys as an item with nothing — the values differ,
  // the SHAPE does not — because a builder that emits a key only when it has a value
  // makes "absent" and "not built yet" the same row, which is the failure this hash
  // exists to catch and would then be unable to see.
  const rich = itemFeatures(
    item({ counters: { reach: counter(REACH_LEVEL), reproduction: counter(REPRODUCTION_LEVEL) } }),
    [measured('reproduction', 20, 5, NOW - 5 * MINUTE)],
    NOW,
    corpus({ items: P.features.minCorpusItems, textLen: [1, 2, 3] }),
    P,
  );
  assert.equal(featureShapeHash(Object.keys(rich)), featureShapeHash(Object.keys(f)));
});
