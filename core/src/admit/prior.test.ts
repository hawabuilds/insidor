/**
 * The author prior, as the two properties its own doc says it must have.
 *
 * ★ THIS STUB SHIPPED WITH NO `todo` TEST — the only one of its cohort that had no
 * written acceptance criterion anywhere. The two bullets in `rosterTier`'s doc comment
 * ARE the specification, so they are the first two tests below, in the doc's own words.
 * The other four are the properties the surrounding code silently depends on: the
 * range `admit/stage.ts` wraps in clamp01, the absence-is-not-zero rule the rest of the
 * system runs on, and the two bounds that make this feature not worth farming.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, sourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_DAY } from '../math.ts';
import { rosterTier, type AuthorHistory } from './prior.ts';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const P = DEFAULT_POLICY;
const MEAN = P.admit.roster.populationMean;

/** A history whose evidence is dated to yesterday, so decay is negligible by default. */
function history(over: Partial<AuthorHistory> = {}): AuthorHistory {
  return {
    authorKey: authorKey(sourceId('testsrc'), 'a1'),
    observedFrom: NOW - 2 * DAY,
    observedTo: NOW,
    itemsAdmitted: 0,
    itemsJoinedStory: 0,
    storiesQualified: 0,
    storiesResolved: 0,
    ...over,
  };
}

/* ── the two properties the doc comment demands ───────────────────────── */

test('one lucky item does not outrank forty good ones', () => {
  // A perfect raw hit rate over one trial: admitted once, and that one item went all
  // the way to a resolved story. Raw score 1.0.
  const lucky = rosterTier(
    history({ itemsAdmitted: 1, itemsJoinedStory: 1, storiesQualified: 1, storiesResolved: 1 }),
    NOW,
    P,
  );

  // A worse raw rate over forty trials — 30 joined, 20 qualified, 12 resolved, so a
  // raw score of 0.45 — but forty times the evidence.
  const proven = rosterTier(
    history({
      itemsAdmitted: 40,
      itemsJoinedStory: 30,
      storiesQualified: 20,
      storiesResolved: 12,
    }),
    NOW,
    P,
  );

  assert.ok(
    proven > lucky,
    `forty good ones (${proven}) must outrank one lucky item (${lucky}) despite the worse rate`,
  );

  // And the lucky account sits near the population mean rather than near the top: the
  // shrinkage weight over one trial is 1/11, so nine tenths of its tier is the prior.
  assert.ok(lucky < MEAN + 0.1, `one trial must not buy a high tier, got ${lucky}`);
});

test('a roster that never forgets becomes a list of who was early to the last regime', () => {
  const counts = {
    itemsAdmitted: 40,
    itemsJoinedStory: 30,
    storiesQualified: 20,
    storiesResolved: 12,
  };

  const recent = rosterTier(
    history({ ...counts, observedFrom: NOW - 12 * DAY, observedTo: NOW }),
    NOW,
    P,
  );
  const ancient = rosterTier(
    history({ ...counts, observedFrom: NOW - 372 * DAY, observedTo: NOW - 360 * DAY }),
    NOW,
    P,
  );

  assert.ok(
    recent > ancient,
    `identical histories must not score the same at six days and a year (${recent} vs ${ancient})`,
  );

  // ★ And the forgetting is TOWARD THE POPULATION MEAN, never toward zero. An account
  // that was good two years ago and has been quiet since must land back at "we do not
  // know", not below an account we have never seen — which would be a claim we have no
  // evidence for and a second, stranger thing for an attacker to exploit.
  const forgotten = rosterTier(
    history({ ...counts, observedFrom: NOW - 800 * DAY, observedTo: NOW - 730 * DAY }),
    NOW,
    P,
  );
  assert.ok(Math.abs(forgotten - MEAN) < 0.01, `expected the mean, got ${forgotten}`);
  assert.ok(forgotten >= MEAN - 1e-9, 'decay must never take an account BELOW an unknown one');
});

/* ── the properties the surrounding code depends on ───────────────────── */

test('an empty history is the population mean exactly, not zero', () => {
  // A zero here would be a CLAIM that the account is bad, and we have not looked. The
  // same rule kinetics/rate.ts enforces for a censored counter and group/stage.ts for
  // a missing similarity — an absence is not a claim about anything.
  assert.equal(rosterTier(history(), NOW, P), MEAN);
  assert.notEqual(rosterTier(history(), NOW, P), 0);

  // Never-seen and seen-and-failed must be different numbers, or the feature cannot
  // distinguish the two populations it exists to distinguish.
  const failed = rosterTier(history({ itemsAdmitted: 40 }), NOW, P);
  assert.ok(failed < MEAN, `an account that produced nothing must score below unknown, got ${failed}`);
});

test('the return is inside [0,1] for every input, including broken ones', () => {
  // admit/stage.ts wraps this in clamp01, so a value outside the range would be
  // silently TRUNCATED there rather than caught. Clamping here means the truncation
  // never has anything to do.
  const cases: AuthorHistory[] = [
    history(),
    history({ itemsAdmitted: 1, itemsJoinedStory: 1, storiesQualified: 1, storiesResolved: 1 }),
    // The funnel broken by a backfill: more resolved stories than admitted items.
    history({ itemsAdmitted: 1, itemsJoinedStory: 900, storiesQualified: 900, storiesResolved: 900 }),
    // Negative counts from a bad repair.
    history({ itemsAdmitted: -5, storiesResolved: -5 }),
    // A window whose end is in the future: a clock skew, or a job that ran early.
    history({ itemsAdmitted: 40, storiesResolved: 40, observedTo: NOW + 400 * DAY }),
    // A zero-width window.
    history({ itemsAdmitted: 10, storiesResolved: 5, observedFrom: NOW, observedTo: NOW }),
  ];

  for (const h of cases) {
    const t = rosterTier(h, NOW, P);
    assert.ok(Number.isFinite(t), `not finite: ${t}`);
    assert.ok(t >= 0 && t <= 1, `outside [0,1]: ${t}`);
  }
});

test('a window ending in the future is treated as brand new, and never as better than new', () => {
  const counts = { itemsAdmitted: 40, itemsJoinedStory: 40, storiesQualified: 40, storiesResolved: 40 };

  // The ceiling: evidence dated to this instant exactly, which gets no decay at all.
  const brandNew = rosterTier(
    history({ ...counts, observedFrom: NOW, observedTo: NOW }),
    NOW,
    P,
  );

  // A clock skew, or a nightly job that ran early, puts the window's midpoint in the
  // future. The age is floored at zero, so the decay saturates at 1 — the skewed
  // account is treated as though its evidence were brand new, and cannot do better.
  const skewed = rosterTier(history({ ...counts, observedTo: NOW + 3650 * DAY }), NOW, P);
  assert.equal(skewed, brandNew);

  // Which matters because the alternative — letting a negative age produce a decay
  // ABOVE one — would multiply the evidence count, and a farm that can post-date its
  // own window would buy weight it never earned.
  assert.ok(skewed <= brandNew + 1e-9, `skew must not amplify: ${skewed} vs ${brandNew}`);
});

/* ── the two bounds that make this feature not worth farming ──────────── */

test('the shrinkage bounds the ramp: there is no fast route to a top tier', () => {
  // A perfect account — every admitted item reached a resolved story — walked up from
  // one item to a hundred. The first ten buy at most half the distance to the top.
  const perfect = (n: number): number =>
    rosterTier(
      history({ itemsAdmitted: n, itemsJoinedStory: n, storiesQualified: n, storiesResolved: n }),
      NOW,
      P,
    );

  const k = P.admit.roster.shrinkageStrength;
  const atK = perfect(k);
  // n/(n+k) at n = k is exactly one half, so the tier is the midpoint of mean and 1.
  assert.ok(Math.abs(atK - (MEAN + 1) / 2) < 0.01, `expected the midpoint, got ${atK}`);

  // Monotone, and it approaches 1 rather than reaching it early: a farm has to keep
  // paying for a long time before the term is worth its full weight.
  assert.ok(perfect(1) < perfect(10));
  assert.ok(perfect(10) < perfect(100));
  assert.ok(perfect(100) < 1);
});

test('the decay bounds the hold: a farmed tier is a subscription, not an asset', () => {
  const counts = {
    itemsAdmitted: 100,
    itemsJoinedStory: 100,
    storiesQualified: 100,
    storiesResolved: 100,
  };
  const at = (daysAgo: number): number =>
    rosterTier(
      history({ ...counts, observedFrom: NOW - daysAgo * DAY, observedTo: NOW - daysAgo * DAY }),
      NOW,
      P,
    );

  const half = P.admit.roster.halfLifeDays;

  // Monotone: stopping means sliding back toward the mean, always.
  assert.ok(at(0) > at(half));
  assert.ok(at(half) > at(half * 4));

  /*
   * ★ THE TIER DOES NOT HALVE WITH THE WEIGHT, AND EXPECTING IT TO IS THE MISTAKE THIS
   * TEST EXISTS TO DOCUMENT. The half-life is on the evidence COUNT, and the count
   * enters through `n/(n+k)`, which is concave and saturated at n = 100. So the first
   * half-life removes only about a tenth of the account's excess over the mean, and the
   * decay looks disappointingly slow to anyone reading the policy field alone.
   *
   * It bites later and it bites hard: the weight is 0.91 fresh, 0.38 after four
   * half-lives, and 0.04 after eight. Two years at a ninety-day half-life is roughly
   * those eight, which is what the policy field means by "correctly, gone".
   */
  assert.ok(at(half) - MEAN > (at(0) - MEAN) * 0.8, 'one half-life is deliberately gentle');
  assert.ok(
    at(half * 8) - MEAN < (at(0) - MEAN) * 0.05,
    'after eight half-lives a perfect farmed history must be worth essentially nothing',
  );
});

test('the arithmetic bounds the prize: a perfect tier cannot admit anything alone', () => {
  // "A prior and not a gate", as a number rather than as a principle. The largest
  // possible contribution of this term to the admission score is its weight, and the
  // bar is a high quantile of the day's arrivals — so the roster can move an item up
  // the ranking and can never, on its own, put one over the line.
  const best = rosterTier(
    history({
      itemsAdmitted: 10_000,
      itemsJoinedStory: 10_000,
      storiesQualified: 10_000,
      storiesResolved: 10_000,
    }),
    NOW,
    P,
  );
  assert.ok(best <= 1);

  const contribution = P.admit.weights.authorRosterTier * best;
  assert.ok(
    contribution < P.admit.quantileFloor,
    `a perfect roster contributes ${contribution}, which must sit under the floor the bar can take`,
  );
});

test('the funnel weights are ordered by scarcity, so volume cannot substitute for depth', () => {
  const w = P.admit.roster.weights;
  assert.ok(w.storiesResolved > w.storiesQualified);
  assert.ok(w.storiesQualified > w.itemsJoinedStory);
  assert.ok(
    Math.abs(w.itemsJoinedStory + w.storiesQualified + w.storiesResolved - 1) < 1e-9,
    'the weights must sum to 1, or a perfect account does not score 1 before shrinkage',
  );

  // Forty joins and nothing beyond them scores below twelve resolutions, which is the
  // property that stops a farm from buying the cheap end of the funnel in bulk.
  const shallow = rosterTier(history({ itemsAdmitted: 40, itemsJoinedStory: 40 }), NOW, P);
  const deep = rosterTier(
    history({ itemsAdmitted: 40, itemsJoinedStory: 30, storiesQualified: 20, storiesResolved: 12 }),
    NOW,
    P,
  );
  assert.ok(deep > shallow, `${deep} vs ${shallow}`);
});

test('the policy is the only source of every constant here', () => {
  // A policy edit must move the answer, or a number is hiding in the file. Each of the
  // three roster constants is perturbed alone and must change the result.
  const h = history({
    itemsAdmitted: 20,
    itemsJoinedStory: 15,
    storiesQualified: 10,
    storiesResolved: 5,
    observedFrom: NOW - 60 * DAY,
    observedTo: NOW - 30 * DAY,
  });
  const base = rosterTier(h, NOW, P);

  const withPolicy = (over: Partial<Policy['admit']['roster']>): number =>
    rosterTier(h, NOW, {
      ...P,
      admit: { ...P.admit, roster: { ...P.admit.roster, ...over } },
    });

  assert.notEqual(withPolicy({ shrinkageStrength: 500 }), base);
  assert.notEqual(withPolicy({ halfLifeDays: 1 }), base);
  assert.notEqual(withPolicy({ populationMean: 0.9 }), base);
  assert.notEqual(
    withPolicy({ weights: { itemsJoinedStory: 1, storiesQualified: 0, storiesResolved: 0 } }),
    base,
  );

  // And MS_PER_DAY is the unit the half-life is read in, so the test states it rather
  // than leaving the reader to infer it from a magic number in the fixtures.
  assert.equal(MS_PER_DAY, DAY);
});
