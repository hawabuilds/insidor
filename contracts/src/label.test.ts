/**
 * The revision encoding, and the two ways it silently stops working.
 *
 * Both failures produce rows that look fine one at a time: a supersession that parses as
 * a fresh measurement double-counts through any view that does not filter the version,
 * and a definition that swallows a revision marker makes two different measurements share
 * a name forever. Neither is visible without a test that tries it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIRST_REVISION, labelVersion, latestRevisionOf, nextRevision, parseLabelVersion } from './label.ts';

test('the first revision is spelled as the bare definition', () => {
  assert.equal(labelVersion('v1', FIRST_REVISION), 'v1');
  assert.deepEqual(parseLabelVersion('v1'), { definition: 'v1', revision: 1 });
});

test('a supersession round-trips', () => {
  const version = labelVersion('v1', 7);
  assert.equal(version, 'v1.r7');
  assert.deepEqual(parseLabelVersion(version), { definition: 'v1', revision: 7 });
});

test('a definition carrying the marker is refused rather than written ambiguously', () => {
  assert.throws(() => labelVersion('peak.r2', 1), TypeError);
});

test('a revision below the first, or not whole, is refused', () => {
  assert.throws(() => labelVersion('v1', 0), TypeError);
  assert.throws(() => labelVersion('v1', 1.5), TypeError);
  assert.throws(() => labelVersion('', 1), TypeError);
});

test('a version string we did not write parses as itself, never as a revision of something else', () => {
  /* The danger is the other direction: folding an unknown string into a revision chain it
     is not part of would make one measurement supersede a different one. */
  assert.deepEqual(parseLabelVersion('dune:peak@abc'), { definition: 'dune:peak@abc', revision: 1 });
  assert.deepEqual(parseLabelVersion('v1.rx'), { definition: 'v1.rx', revision: 1 });
  assert.deepEqual(parseLabelVersion('v1.r0'), { definition: 'v1.r0', revision: 1 });
  assert.deepEqual(parseLabelVersion('.r2'), { definition: '.r2', revision: 1 });
});

test('the latest revision wins, whatever order the rows arrive in', () => {
  const rows = [{ labelVersion: 'v1.r2' }, { labelVersion: 'v1' }, { labelVersion: 'v1.r10' }];
  assert.equal(latestRevisionOf(rows, 'v1')?.labelVersion, 'v1.r10');
  assert.equal(latestRevisionOf([...rows].reverse(), 'v1')?.labelVersion, 'v1.r10');
});

test('r10 is later than r9, which a string comparison would get wrong', () => {
  assert.equal(nextRevision('v1.r9'), 10);
  assert.equal(
    latestRevisionOf([{ labelVersion: 'v1.r9' }, { labelVersion: 'v1.r10' }], 'v1')?.labelVersion,
    'v1.r10',
  );
});

test('an empty set is null, which is not the same answer as a graded subject with nothing to say', () => {
  assert.equal(latestRevisionOf([], 'v1'), null);
});
