/**
 * The behaviour under test is the one from the build order: "a deliberately
 * induced gap produces a coverage row, and the labeller marks that window
 * unmeasurable instead of negative."
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCoverage, observedSegments } from './coverage.ts';

const TOLERANCE = 60_000;

test('the first read ever produces no gap', () => {
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: null });
  assert.equal(c.observed(1_000_000), null);
  assert.equal(c.watermark(), 1_000_000);
});

test('reads inside the tolerance are clean', () => {
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: 1_000_000 });
  assert.equal(c.observed(1_020_000), null);
  assert.equal(c.observed(1_040_000), null);
  assert.equal(c.observed(1_100_000), null, 'exactly at tolerance is still covered');
});

test('a silence longer than the tolerance is recorded, with its exact bounds', () => {
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: 1_000_000 });
  const gap = c.observed(1_400_000);

  assert.ok(gap !== null, 'a 400s silence must not read as a clean run');
  assert.equal(gap.kind, 'not_watching');
  assert.equal(gap.fromMs, 1_000_000);
  assert.equal(gap.toMs, 1_400_000);
});

test('a restart across a deploy is a gap, because the watermark survives it', () => {
  // The previous process last read successfully at t=1_000_000 and was killed.
  // The new one comes up and reads at t=1_300_000.
  const resumed = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: 1_000_000 });
  const gap = resumed.observed(1_300_000);

  assert.ok(gap !== null, 'a restart mid-cursor is exactly the case this exists for');
  assert.equal(gap.toMs - gap.fromMs, 300_000);
});

test('one gap is recorded once; the next read starts a fresh window', () => {
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: 1_000_000 });
  const first = c.observed(1_400_000);
  const second = c.observed(1_410_000);

  assert.ok(first !== null);
  assert.equal(second, null, 'the same hole must not be counted twice');
});

test('a full page is a gap even though we were connected the whole time', () => {
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: 1_000_000 });
  const gap = c.pageOverflow(1_000_000, 1_020_000, 500);

  assert.equal(gap.kind, 'page_overflow');
  assert.match(gap.detail, /500/);
});

test('a read that could not be stored is a gap, and does not move the watermark', () => {
  // The failure this exists for: the cycle read [1_000_000, 1_003_000] and threw
  // on the way to the database. Three seconds is nowhere near the 60s tolerance,
  // so `observed()` will never mention it — and for a stream those mints have
  // already left the buffer.
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: 1_000_000 });
  const gap = c.readNotStored(1_000_000, 1_003_000, 'sink threw');

  assert.equal(gap.kind, 'read_not_stored');
  assert.equal(gap.fromMs, 1_000_000);
  assert.equal(gap.toMs, 1_003_000);
  assert.match(gap.detail, /sink threw/);
  assert.equal(
    c.watermark(),
    1_000_000,
    'the read did not land, so it must not count as one — the next window still starts here',
  );
});

test('the clean row that used to swallow a failed cycle is now flagged', () => {
  // The exact shape of the run that found this: read at t+3s fails after
  // answering, read at t+6s succeeds. Both are inside the tolerance, so
  // `observed()` reports nothing on either, and the only thing standing between
  // the destroyed mints and a coverage row claiming that window is the gap the
  // failing cycle declares for itself.
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: 1_000_000 });

  const declared = c.readNotStored(1_000_000, 1_003_000, 'sink threw');
  assert.equal(c.observed(1_006_000), null, 'a 6s silence is jitter, not a hole');

  // Both rows key on (chain, window_from) and merge; `recordCoverage` never
  // clears `gap`, so the flag this one carries is what survives.
  assert.equal(declared.fromMs, 1_000_000, 'and it must key onto that same row');
});

test('a cursor reset with no known position does not invent one', () => {
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: null });
  const gap = c.cursorReset(null, 2_000_000);

  assert.equal(gap.kind, 'cursor_reset');
  assert.equal(gap.fromMs, 2_000_000);
  assert.equal(gap.toMs, 2_000_000);
  assert.equal(c.watermark(), 2_000_000, 'the reset re-anchors the watermark');
});

/* ── what a cycle may claim it watched ───────────────────────────────────── */

test('★ a hole inside a window is carved out of it, not laid over it', () => {
  // The shape a severed socket produces: both reads either side succeeded, so
  // there is no silence to measure, and the only record of the 612ms in the
  // middle is the outage the transport reported. Before this, the cycle wrote
  // ONE row over the whole window with gap = false — on top of the gap row it
  // had just written for the same 612ms.
  const segments = observedSegments(1_000_000, 1_003_000, [
    { fromMs: 1_000_023, toMs: 1_000_635 },
  ]);

  assert.deepEqual(segments, [
    { fromMs: 1_000_000, toMs: 1_000_023 },
    { fromMs: 1_000_635, toMs: 1_003_000 },
  ]);
});

test('★ the pieces abut the hole exactly: nothing unclaimed, nothing claimed twice', () => {
  // The failure this rules out is the quieter half. A window that is in NEITHER
  // an observed row nor a gap row is not visibly wrong — nothing contradicts
  // anything — and `hasCoverageGap` treats a window it has no row for as a gap,
  // so it degrades to censoring time we did watch. Both edges are checked
  // because only one of them is loud.
  const from = 500_000;
  const to = 560_000;
  const hole = { fromMs: 510_000, toMs: 530_000 };
  const segments = observedSegments(from, to, [hole]);

  const covered = [...segments, hole].sort((a, b) => a.fromMs - b.fromMs);
  let at = from;
  for (const window of covered) {
    assert.equal(window.fromMs, at, 'every window begins where the last one ended');
    at = window.toMs;
  }
  assert.equal(at, to, 'and together they reach the end of the read');
});

test('overlapping and nested holes are one hole, and never re-open a window', () => {
  // Two mechanisms describing one outage is the NORMAL case, not an error: the
  // transport reports the socket window and `observed()` reports the silence
  // around it. Taking them in turn without a running mark would treat the second
  // as a fresh hole and re-open the window between them.
  const segments = observedSegments(0, 100, [
    { fromMs: 40, toMs: 80 },
    { fromMs: 45, toMs: 60 }, // nested
    { fromMs: 10, toMs: 50 }, // overlapping, and out of order
  ]);

  assert.deepEqual(segments, [
    { fromMs: 0, toMs: 10 },
    { fromMs: 80, toMs: 100 },
  ]);
});

test('★ a window that was entirely dark claims nothing at all', () => {
  // The empty array is the answer, and the caller has to handle it. The
  // temptation it removes is the fallback — "no segments, so write the whole
  // window" — which is the original bug with an extra step.
  assert.deepEqual(observedSegments(1_000, 2_000, [{ fromMs: 500, toMs: 5_000 }]), []);
});

test('a hole belonging to another window is not subtracted from this one', () => {
  // Holes accumulate across failed cycles, so the list handed in outlives any
  // one window. One that clips to nothing here is still a true row; it is just
  // not this cycle's to carve.
  assert.deepEqual(observedSegments(1_000, 2_000, [{ fromMs: 100, toMs: 900 }]), [
    { fromMs: 1_000, toMs: 2_000 },
  ]);
});

test('a window with no width claims nothing, rather than a backwards row', () => {
  // `internal.mint_coverage` carries `check (window_to > window_from)`, so a
  // zero-width or reversed segment is a failed INSERT — which fails the cycle,
  // which is a gap we invented out of a fast clock.
  assert.deepEqual(observedSegments(1_000, 1_000, []), []);
  assert.deepEqual(observedSegments(2_000, 1_000, []), []);
});
