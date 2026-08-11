/**
 * The behaviour under test is the one from the build order: "a deliberately
 * induced gap produces a coverage row, and the labeller marks that window
 * unmeasurable instead of negative."
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCoverage } from './coverage.ts';

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

test('a cursor reset with no known position does not invent one', () => {
  const c = createCoverage({ toleranceMs: TOLERANCE, resumeFrom: null });
  const gap = c.cursorReset(null, 2_000_000);

  assert.equal(gap.kind, 'cursor_reset');
  assert.equal(gap.fromMs, 2_000_000);
  assert.equal(gap.toMs, 2_000_000);
  assert.equal(c.watermark(), 2_000_000, 'the reset re-anchors the watermark');
});
