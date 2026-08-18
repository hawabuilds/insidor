/**
 * THE RETRIEVAL WINDOW, AND THE ONE PROPERTY THAT IS NOT ALLOWED TO ERODE.
 *
 * The bug this file is written against was invisible in every existing test, because it
 * was not a wrong answer — it was a missing bound. A story whose posts carried no time at
 * all matched `o.opens_at is null or …`, which is a predicate that is TRUE FOR EVERY ROW
 * of public.asset, and so retrieved the entire store. Measured before the fix: five
 * stories with post times retrieved 3 to 12 assets each, and the sixth retrieved all 205.
 * Nothing was red. The row even looked right, because the text rule happened to carry it.
 *
 * So the assertions here are about SHAPE, not about a number of rows:
 *
 *   1. Every window is finite. There is no input that produces an unbounded one.
 *   2. A post-anchored window is byte-for-byte what it always was.
 *   3. A first-sight window reaches BACKWARDS past its own anchor — always, by
 *      construction — because that reach is the recorded difference between "this coin
 *      came after the post" and "this is where it was worth looking". A future change that
 *      makes the fallback forward-only turns tests 3 and 5 red, which is the whole reason
 *      they are written as separate assertions from the row counts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { coinWindow, countAnchors, DEFAULT_WINDOW_TUNING, windowIsOrdered } from './window.ts';
import type { CoinWindow, WindowTuning } from './window.ts';

/* Literals, so the arithmetic is checkable by hand. The instants are the ones actually in
   the store: st_rooftop's three members were first seen at 00:27, 00:57 and 01:42 on
   2026-08-17 and not one of them carries a post time, and its one correct coin — SLIDE,
   "roof slide", minted_at_conf 'exact' from chain_rpc — was minted at 20:37 the evening
   before, 3h50m BEFORE we first saw the story that produced it. */
const SIGHT = Date.parse('2026-08-17T00:27:00Z');
const POST = Date.parse('2026-08-16T23:23:00Z');
const SLIDE_MINTED = Date.parse('2026-08-16T20:37:00Z');

const HOUR = 3_600_000;

const within = (window: CoinWindow, atMs: number): boolean =>
  atMs >= window.fromMs && atMs <= window.toMs;

/* ── the ordinary case, which must not have moved ─────────────────────── */

test('a story with a post time gets exactly the window it always got', () => {
  const window = coinWindow({ earliestPostMs: POST, earliestSightMs: SIGHT });
  assert.notEqual(window, null);
  assert.equal(window?.anchor, 'earliest_post');

  /* The pre-change SQL was `minted_at >= opens_at + minLagMs and <= opens_at + maxLagMs`
     with `opens_at = min(item.posted_at)`. Spelled out here as the arithmetic rather than
     as constants, so this stays true when the policy numbers move. */
  assert.equal(window?.anchorMs, POST);
  assert.equal(window?.fromMs, POST + DEFAULT_POLICY.resolve.minLagMs);
  assert.equal(window?.toMs, POST + DEFAULT_POLICY.resolve.maxLagMs);

  /* ★ THE FIRST-SIGHT CLOCK IS PRESENT AND IGNORED. This is the assertion that would catch
     somebody "improving" the anchor by taking the earlier of the two, or by preferring the
     always-non-null column. A story that has a real anchor is never demoted to the weaker
     one, whatever else is available. */
  assert.equal(coinWindow({ earliestPostMs: POST, earliestSightMs: POST - HOUR })?.anchorMs, POST);
});

test('a post-anchored window is an ordering claim, and says so', () => {
  const window = coinWindow({ earliestPostMs: POST, earliestSightMs: SIGHT });
  assert.equal(windowIsOrdered(window as CoinWindow), true);

  /* It never opens before its anchor, which is what makes "the coin predates the post"
     answerable at all: everything inside the window is at or after the post. */
  assert.ok((window as CoinWindow).fromMs >= (window as CoinWindow).anchorMs);
});

/* ── the case that used to retrieve the whole store ───────────────────── */

test('★ a story with no post time gets a BOUNDED window, not everything', () => {
  const window = coinWindow({ earliestPostMs: null, earliestSightMs: SIGHT });
  assert.notEqual(window, null);
  assert.equal(window?.anchor, 'first_sight');

  /* Finite at both ends. The old escape had no ends at all. */
  assert.ok(Number.isFinite(window?.fromMs));
  assert.ok(Number.isFinite(window?.toMs));

  const span = (window as CoinWindow).toMs - (window as CoinWindow).fromMs;
  assert.equal(
    span,
    DEFAULT_POLICY.resolve.maxLagMs -
      DEFAULT_POLICY.resolve.minLagMs +
      DEFAULT_POLICY.resolve.firstSightLookbackMs,
  );
  /* And the bound is a real one at the scale the store operates at: a day and a quarter,
     not a decade. Asserted as an inequality rather than a constant so that moving the
     policy number is a decision about the policy and not a test edit. */
  assert.ok(span < 48 * HOUR, 'the window has grown past the point where it bounds anything');
});

test('★ the window reaches BACKWARDS past a first-sight anchor, and that is the record', () => {
  const window = coinWindow({ earliestPostMs: null, earliestSightMs: SIGHT }) as CoinWindow;

  /* ★ THE ONE ASSERTION THIS FILE EXISTS FOR. Our reader can only ever be LATE, never
     early, so the true post is at or before the moment we looked and a coin minted from it
     can be before that moment too. A forward-only window on this anchor would encode "we
     looked at 00:27, therefore nothing before 00:27 counts", which is the "we saw it late,
     so it was posted late" conversion. */
  assert.ok(window.fromMs < window.anchorMs, 'a first-sight window must reach before its anchor');
  assert.equal(window.anchorMs - window.fromMs, DEFAULT_POLICY.resolve.firstSightLookbackMs);

  /* ★ AND IT IS MARKED AS NOT AN ORDERING. The shape says it and the predicate says it, and
     the predicate reads the numbers rather than the tag so that a third anchor, or a
     widened fallback, cannot arrive claiming to be ordered. */
  assert.equal(windowIsOrdered(window), false);

  /* What that reach buys, on the real instants: the coin this story actually produced. A
     forward-only window loses it, and losing it is not a smaller row — it is `none`, which
     puts CREATE on a row whose coin exists and is currently NAMED on it. */
  assert.equal(within(window, SLIDE_MINTED), true, 'SLIDE must be inside the window');
  const forwardOnly = { ...window, fromMs: window.anchorMs };
  assert.equal(within(forwardOnly, SLIDE_MINTED), false, 'the forward-only version is the bug');
});

test('★ the forward end is sound rather than generous, and is the same number in both cases', () => {
  /* minted ≤ posted + maxLag, and posted ≤ sight, therefore minted ≤ sight + maxLag. The
     forward end needs no new bound because that inequality already holds — only the
     backward end needed a number the resolve window never had to know. */
  const posted = coinWindow({ earliestPostMs: POST, earliestSightMs: SIGHT }) as CoinWindow;
  const sighted = coinWindow({ earliestPostMs: null, earliestSightMs: SIGHT }) as CoinWindow;

  assert.equal(posted.toMs - posted.anchorMs, DEFAULT_POLICY.resolve.maxLagMs);
  assert.equal(sighted.toMs - sighted.anchorMs, DEFAULT_POLICY.resolve.maxLagMs);
});

/* ── the bounds come from the policy, and only from there ─────────────── */

test('every bound is read off DEFAULT_POLICY.resolve', () => {
  assert.deepEqual(DEFAULT_WINDOW_TUNING, {
    minLagMs: DEFAULT_POLICY.resolve.minLagMs,
    maxLagMs: DEFAULT_POLICY.resolve.maxLagMs,
    firstSightLookbackMs: DEFAULT_POLICY.resolve.firstSightLookbackMs,
  });

  /* Swept with a literal rather than by mutating the frozen policy — the same shape
     CandidateTuning has in coins.ts, and for the same reason: a policy edited mid-run makes
     its own hash a lie. */
  const tuning: WindowTuning = { minLagMs: 0, maxLagMs: 60_000, firstSightLookbackMs: 120_000 };
  const window = coinWindow({ earliestPostMs: null, earliestSightMs: 1_000_000 }, tuning);
  assert.deepEqual(window, {
    anchor: 'first_sight',
    anchorMs: 1_000_000,
    fromMs: 880_000,
    toMs: 1_060_000,
  });
});

test('a lookback narrower than the real lag is what loses the coin — swept, not asserted blind', () => {
  /* The measured sweep on the field's own comment, reproduced as arithmetic. SLIDE sits
     3h50m before the anchor, so every lookback under that loses it and every lookback over
     it keeps it. This is the test that fails if someone tightens the bound to "6 hours,
     same as maxLagMs" without noticing that the two numbers measure different things. */
  const keeps = (lookbackHours: number): boolean => {
    const window = coinWindow(
      { earliestPostMs: null, earliestSightMs: SIGHT },
      { ...DEFAULT_WINDOW_TUNING, firstSightLookbackMs: lookbackHours * HOUR },
    ) as CoinWindow;
    return within(window, SLIDE_MINTED);
  };

  assert.equal(keeps(1), false);
  assert.equal(keeps(3), false);
  assert.equal(keeps(4), true);
  assert.equal(keeps(24), true);
  /* And the shipped value is inside the safe half, with room. */
  assert.ok(DEFAULT_POLICY.resolve.firstSightLookbackMs >= 4 * HOUR);
});

/* ── the degenerate case ──────────────────────────────────────────────── */

test('a story with no clock at all gets no window, rather than one anchored on nothing', () => {
  /* Reachable only for a story with no members, which has no entitySpan fingerprints
     either and therefore links to nothing whatever retrieval returns. Returning null is
     what keeps it out of the query entirely; a sentinel instant here would put a window on
     a story that has no time in it at all. */
  assert.equal(coinWindow({ earliestPostMs: null, earliestSightMs: null }), null);
});

/* ── the count the projector prints ───────────────────────────────────── */

test('the anchor counts always report both clocks, including the zero', () => {
  const posted = coinWindow({ earliestPostMs: POST, earliestSightMs: SIGHT }) as CoinWindow;
  const sighted = coinWindow({ earliestPostMs: null, earliestSightMs: SIGHT }) as CoinWindow;

  assert.deepEqual(countAnchors([]), { earliest_post: 0, first_sight: 0 });
  assert.deepEqual(countAnchors([posted, posted, sighted]), { earliest_post: 2, first_sight: 1 });
});
