/**
 * The four states, and the six ways the wrong one gets written.
 *
 * Every test here is a pair that a careless implementation collapses into one number:
 * an open window and a bad outcome, a dark window and a small outcome, a vanished
 * subject and a failed one, a re-run and a correction. They are literals in
 * milliseconds against the pure classifier, because the whole point of `outcome.ts`
 * being pure is that these cases can be produced exactly rather than waited for — a
 * coverage gap over a thirty-day window is a thing that takes a month to arrange
 * against a live database and one line here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY, labelVersion, latestRevisionOf, nextRevision } from '@insidor/contracts';
import type { LabelPolicy } from '@insidor/contracts';

import { NO_MARKET, classify, labelWindow, measurePeak, sameOutcome } from './outcome.ts';
import type { CoinEvidence, LabelOutcome } from './outcome.ts';

const P: LabelPolicy = DEFAULT_POLICY.labels;

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2026, 0, 1);
const CLOSES = ORIGIN + P.windowDays * DAY;

/** A window that was watched from end to end. */
const WATCHED = { gapDeclared: false, coveredMs: P.windowDays * DAY };

/**
 * The resolve stage did look for a coin on this subject's behalf.
 *
 * Named rather than written `true` fifteen times because it is the DEFAULT of these
 * tests and not their subject: every case below is about the mint stream, the
 * measurement or the clock, and each one silently assumes somebody asked the coin
 * question. The two cases where that assumption is the point pass `false` inline.
 */
const ASKED = true;

function coin(prices: readonly (number | null)[], startMs = ORIGIN): CoinEvidence {
  return {
    assetKey: 'chain:address',
    originMs: startMs,
    observations: prices.map((priceUsd, i) => ({
      atMs: startMs + i * 3_600_000,
      priceUsd,
      absent: priceUsd === null ? NO_MARKET : null,
    })),
  };
}

/* ── 1. inside the horizon ────────────────────────────────────────────── */

test('a subject still inside its horizon is pending, and pending is not a number', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: ASKED,
      coins: [coin([1, 40])],
      nowMs: CLOSES - 1,
    },
    P,
  );

  assert.equal(outcome.status, 'pending');
  /* The point is not only that it is not resolved. A `pending` outcome carries no value
     and no `y` AT ALL — there is no field on it to accidentally read as zero, which is
     what makes the "everything recent failed" dataset impossible to write from here. */
  assert.deepEqual(outcome, { status: 'pending' });
});

test('one millisecond of horizon left is still pending, and one past it is not', () => {
  const open = classify(
    { window: { originMs: ORIGIN, resolvesAtMs: CLOSES }, coverage: WATCHED, attributionAsked: ASKED, coins: [coin([1, 2, 2])], nowMs: CLOSES - 1 },
    P,
  );
  const closed = classify(
    { window: { originMs: ORIGIN, resolvesAtMs: CLOSES }, coverage: WATCHED, attributionAsked: ASKED, coins: [coin([1, 2, 2])], nowMs: CLOSES },
    P,
  );
  assert.equal(open.status, 'pending');
  assert.equal(closed.status, 'resolved');
});

/* ── 2. past the horizon ──────────────────────────────────────────────── */

test('a closed, watched window with a supported peak resolves, positive above the bar', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: ASKED,
      /* First price 1, peak 40, and the peak is seen twice — so it is a peak and not a
         single print. 40x clears a bar of 5x. */
      coins: [coin([1, 10, 40, 39])],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.equal(outcome.status, 'resolved');
  assert.ok(outcome.status === 'resolved');
  assert.equal(outcome.y, true);
  assert.equal(outcome.value, 40);
  assert.equal(outcome.firstSignalMs, ORIGIN);
});

test('a closed, watched window whose peak never cleared the bar resolves NEGATIVE, not censored', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: ASKED,
      coins: [coin([2, 2.2, 2.4, 2.4])],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.ok(outcome.status === 'resolved');
  assert.equal(outcome.y, false);
  assert.equal(outcome.value, 1.2);
});

test('nothing was ever minted from the subject, and we watched: a real negative with no number', () => {
  const outcome = classify(
    { window: { originMs: ORIGIN, resolvesAtMs: CLOSES }, coverage: WATCHED, attributionAsked: ASKED, coins: [], nowMs: CLOSES + DAY },
    P,
  );

  assert.ok(outcome.status === 'resolved');
  assert.equal(outcome.y, false);
  /* ★ NULL AND NOT ZERO. There is no coin, so there is no multiple; the verdict is the
     claim, the number is absent, and an absent number is never a measured floor. */
  assert.equal(outcome.value, null);
});

test('★ nothing ever LOOKED for a coin: censored, because that is our outage and not the world', () => {
  /* The same input as the test above in every respect except the one that matters: the
     mint stream was watched from end to end, nothing was attributed — and the resolve
     stage, the only thing that ever attributes, never examined this subject. The two
     situations arrive as the identical empty coin list and only one of them is a fact
     about the world. Written as a pair with the test above because the pair IS the
     assertion: a classifier that cannot tell them apart passes one and fails the other. */
  const outcome = classify(
    { window: { originMs: ORIGIN, resolvesAtMs: CLOSES }, coverage: WATCHED, attributionAsked: false, coins: [], nowMs: CLOSES + DAY },
    P,
  );

  assert.ok(outcome.status === 'censored');
  assert.equal(outcome.reason, 'never_examined_for_a_coin');
  /* Not a lower bound of zero, and not a bound at all: there is no measurement here to
     be a floor under. A censored row may carry a value; this one has none to carry. */
  assert.equal(outcome.value, null);
});

test('a coin that WAS attributed is graded whatever the flag says — the flag only guards the absence', () => {
  /* The flag exists to stop an empty list becoming a negative. A subject that produced a
     measurable coin has already answered the question the flag asks, so it must not be
     able to censor a real measurement — a guard that fires on evidence it was not written
     for is a guard that quietly deletes the positive class. */
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: false,
      coins: [coin([1, 40, 39])],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.ok(outcome.status === 'resolved');
  assert.equal(outcome.y, true);
});

/* ── 3. the horizon overlapping a coverage gap ────────────────────────── */

test('a declared coverage gap censors, and carries the measurement as a LOWER BOUND', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: { gapDeclared: true, coveredMs: P.windowDays * DAY },
      attributionAsked: ASKED,
      coins: [coin([1, 1.4, 1.4])],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.ok(outcome.status === 'censored');
  assert.equal(outcome.reason, 'coverage_gap_declared');
  /* ★ THE WHOLE TEST. The measured 1.4x is on the row — it is real, and it is a lower
     bound on a peak we may have missed while we were not looking. What is NOT on the row
     is a `y`, because the schema forbids one on a censored row and because 1.4x is not
     an answer to "did this peak", it is an answer to "what did we happen to see". */
  assert.equal(outcome.value, 1.4);
  assert.ok(!('y' in outcome));
});

test('a gap censors even a coin that cleared the bar — the subject may have had a bigger one', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: { gapDeclared: true, coveredMs: P.windowDays * DAY },
      attributionAsked: ASKED,
      coins: [coin([1, 30, 30])],
      nowMs: CLOSES + DAY,
    },
    P,
  );
  assert.equal(outcome.status, 'censored');
});

test('a window nobody declared dark but which coverage only partly tiles is censored too', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      /* Half the window accounted for, and no explicit gap row. `hasCoverageGap` alone
         would answer "no gap" here — this is the blind spot the covered fraction closes. */
      coverage: { gapDeclared: false, coveredMs: (P.windowDays * DAY) / 2 },
      attributionAsked: ASKED,
      coins: [coin([1, 1.1, 1.1])],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.ok(outcome.status === 'censored');
  assert.match(outcome.reason, /^coverage_incomplete:/);
  assert.equal(outcome.value, 1.1);
});

test('coverage is tested BEFORE the no-coin negative, so darkness never resolves negative', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: { gapDeclared: true, coveredMs: 0 },
      attributionAsked: ASKED,
      coins: [],
      nowMs: CLOSES + DAY,
    },
    P,
  );
  /* If this ever returns `resolved`, every dark period in the history of the pipeline
     has silently become a negative training example. */
  assert.equal(outcome.status, 'censored');
});

test('a seam smaller than the policy bar does not censor a healthy window', () => {
  const windowMs = P.windowDays * DAY;
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: { gapDeclared: false, coveredMs: Math.ceil(windowMs * P.minCoveredFraction) },
      attributionAsked: ASKED,
      coins: [coin([1, 2, 2])],
      nowMs: CLOSES + DAY,
    },
    P,
  );
  assert.equal(outcome.status, 'resolved');
});

/* ── 4. a subject that vanished ───────────────────────────────────────── */

test('a merged-away subject is unresolvable, which is neither censored nor a bad outcome', () => {
  const window = labelWindow(
    { subjectOriginMs: ORIGIN, coinOriginMs: null, ungradeableReason: 'merged_into:story_other' },
    P,
  );

  assert.ok(window.kind === 'ungradeable');
  assert.equal(window.reason, 'merged_into:story_other');
});

test('a subject nothing ever recorded an origin for is unresolvable, not graded from now', () => {
  const window = labelWindow({ subjectOriginMs: null, coinOriginMs: null, ungradeableReason: null }, P);
  assert.ok(window.kind === 'ungradeable');
  assert.equal(window.reason, 'no_origin_recorded');
});

test('unobservable and censored are different states with different consequences', () => {
  const vanished: LabelOutcome = { status: 'unresolvable', reason: 'item_no_longer_exists' };
  const dark: LabelOutcome = {
    status: 'censored',
    reason: 'coverage_gap_declared',
    value: 1.4,
    firstSignalMs: ORIGIN,
  };
  assert.notEqual(vanished.status, dark.status);
  /* The censored row keeps a number and can be superseded when the gap is backfilled.
     The unresolvable one has no number and never will — nothing can un-delete a post. */
  assert.ok(!('value' in vanished));
});

/* ── the window's own clock ───────────────────────────────────────────── */

test('the window is anchored on the coin when there is one, and on the subject when there is not', () => {
  const coinOriginMs = ORIGIN + 5 * DAY;
  const withCoin = labelWindow({ subjectOriginMs: ORIGIN, coinOriginMs, ungradeableReason: null }, P);
  const withoutCoin = labelWindow({ subjectOriginMs: ORIGIN, coinOriginMs: null, ungradeableReason: null }, P);

  assert.ok(withCoin.kind === 'window');
  assert.equal(withCoin.originMs, coinOriginMs);
  assert.equal(withCoin.resolvesAtMs, coinOriginMs + P.windowDays * DAY);

  assert.ok(withoutCoin.kind === 'window');
  assert.equal(withoutCoin.originMs, ORIGIN);
});

/* ── measurement: the wash-trade guard and the two empty answers ───────── */

test('a peak supported by a single print is censored as a lower bound, not resolved', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: ASKED,
      coins: [coin([1, 1.05, 90, 1.02])],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.ok(outcome.status === 'censored');
  assert.equal(outcome.reason, 'peak_unsupported:1');
  /* The 90x is not discarded. It is recorded as what it is: a number we saw and do not
     believe is a market, kept so that a later look can supersede it. */
  assert.equal(outcome.value, 90);
});

test('we asked and the venue said there is no market: resolved negative, no number', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: ASKED,
      coins: [coin([null, null, null])],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.ok(outcome.status === 'resolved');
  assert.equal(outcome.y, false);
  assert.equal(outcome.value, null);
});

test('we never asked at all: censored, because an outage is not a claim', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: ASKED,
      coins: [{ assetKey: 'chain:address', originMs: ORIGIN, observations: [] }],
      nowMs: CLOSES + DAY,
    },
    P,
  );

  assert.ok(outcome.status === 'censored');
  assert.equal(outcome.reason, 'no_readings_over_window');
  assert.equal(outcome.value, null);
});

test('an absence we could not explain is censored, not read as "no market"', () => {
  const outcome = classify(
    {
      window: { originMs: ORIGIN, resolvesAtMs: CLOSES },
      coverage: WATCHED,
      attributionAsked: ASKED,
      coins: [
        {
          assetKey: 'chain:address',
          originMs: ORIGIN,
          observations: [{ atMs: ORIGIN, priceUsd: null, absent: 'unreadable' }],
        },
      ],
      nowMs: CLOSES + DAY,
    },
    P,
  );
  assert.ok(outcome.status === 'censored');
  assert.equal(outcome.reason, 'no_usable_price_in_window');
});

test('the subject is graded on its best coin, not its first or its average', () => {
  const measured = measurePeak([coin([1, 1.1, 1.1]), coin([1, 20, 20])], P);
  assert.equal(measured.multiple, 20);
  assert.equal(measured.observations, 6);
});

/* ── 5. idempotence ───────────────────────────────────────────────────── */

test('re-measuring an unchanged subject appends nothing', () => {
  const onDisk = { status: 'censored', value: 1.4, y: null, censorReason: 'coverage_gap_declared' };
  const recomputed: LabelOutcome = {
    status: 'censored',
    reason: 'coverage_gap_declared',
    value: 1.4,
    firstSignalMs: ORIGIN,
  };
  assert.equal(sameOutcome(onDisk, recomputed), true);
});

test('a run that only moved the clock is not a correction', () => {
  const onDisk = { status: 'resolved', value: 12, y: true, censorReason: null };
  const recomputed: LabelOutcome = { status: 'resolved', value: 12, y: true, firstSignalMs: ORIGIN + 99 };
  assert.equal(sameOutcome(onDisk, recomputed), true);
});

test('a changed censor reason IS a correction, because the reason is the finding', () => {
  const onDisk = { status: 'censored', value: null, y: null, censorReason: 'no_readings_over_window' };
  const recomputed: LabelOutcome = {
    status: 'censored',
    reason: 'coverage_gap_declared',
    value: null,
    firstSignalMs: null,
  };
  assert.equal(sameOutcome(onDisk, recomputed), false);
});

/* ── 6. a censored row upgraded by a later run ────────────────────────── */

test('a censored label that becomes measurable is a NEW row at the next revision', () => {
  const first = labelVersion(P.definition, 1);
  assert.equal(first, P.definition);

  const onDisk = [{ labelVersion: first, status: 'censored' as const }];
  const latest = latestRevisionOf(onDisk, P.definition);
  assert.ok(latest !== null);

  const upgraded: LabelOutcome = { status: 'resolved', value: 18, y: true, firstSignalMs: ORIGIN };
  assert.equal(sameOutcome({ ...latest, value: 1.4, y: null, censorReason: 'coverage_gap_declared' }, upgraded), false);

  const next = labelVersion(P.definition, nextRevision(latest.labelVersion));
  assert.notEqual(next, first);

  /* ★ AND THE OLD ROW STAYS. The reader takes the latest revision; both are on disk, so
     "we could not tell, and then we could" remains answerable. */
  const both = [...onDisk, { labelVersion: next, status: 'resolved' as const }];
  assert.equal(latestRevisionOf(both, P.definition)?.labelVersion, next);
  assert.equal(both.length, 2);
});

test('revisions of one definition do not shadow another definition', () => {
  const rows = [
    { labelVersion: 'v1' },
    { labelVersion: 'v1.r4' },
    { labelVersion: 'v2' },
    { labelVersion: 'v2.r2' },
  ];
  assert.equal(latestRevisionOf(rows, 'v1')?.labelVersion, 'v1.r4');
  assert.equal(latestRevisionOf(rows, 'v2')?.labelVersion, 'v2.r2');
  assert.equal(latestRevisionOf(rows, 'v3'), null);
});
