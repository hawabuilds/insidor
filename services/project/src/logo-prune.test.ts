/**
 * The logo removal's rules without a bucket: only coin-logos/<address> and coin-logos/64/<address>
 * can be listed, never a launch file or a poster's face; a shown coin and a fresh file are kept.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertLogoPath, logoCoin, planRemoval, removalCsv, type StoredFile } from './logo-prune.ts';

const SHOWN = 'Aaaa111111111111111111111111111111111pump';
const HELD = 'Bbbb111111111111111111111111111111111pump';
const GONE = 'Cccc111111111111111111111111111111111pump';
const DAY = 86_400_000;
const NOW = 10 * DAY;
const f = (path: string, writtenMs: number | null = 0, bytes = 100): StoredFile => ({ path, bytes, writtenMs });

test('★ only the two logo path shapes are logos', () => {
  assert.equal(logoCoin(`coin-logos/${SHOWN}`), SHOWN);
  assert.equal(logoCoin(`coin-logos/64/${SHOWN}`), SHOWN);
  for (const p of [
    '145e66b1-3efd-4523-af35-33926573a136.jpg',
    '145e66b1-3efd-4523-af35-33926573a136.json',
    'author-pics/x_123.jpg',
    `author-pics/${SHOWN}`,
    `coin-logos/${SHOWN}.png`,
    `coin-logos/../${SHOWN}`,
    `coin-logos/128/${SHOWN}`,
    `coin-logos/64/64/${SHOWN}`,
    'coin-logos/64',
    `/coin-logos/${SHOWN}`,
    `x/coin-logos/${SHOWN}`,
  ]) {
    assert.equal(logoCoin(p), null, p);
    assert.throws(() => assertLogoPath(p));
  }
});

test('★ a shown coin\'s logos are kept, both sizes; a coin no one shows is removed, with why', () => {
  const plan = planRemoval(
    [f(`coin-logos/${SHOWN}`), f(`coin-logos/64/${SHOWN}`), f(`coin-logos/${HELD}`), f(`coin-logos/64/${GONE}`), f('145e66b1-3efd-4523-af35-33926573a136.json')],
    new Set([SHOWN]),
    new Set([SHOWN, HELD]),
    NOW,
    DAY,
  );
  assert.deepEqual(plan.keptShown, { files: 2, bytes: 200 });
  assert.deepEqual(plan.remove, [
    { path: `coin-logos/${HELD}`, coin: HELD, bytes: 100, reason: 'not shown' },
    { path: `coin-logos/64/${GONE}`, coin: GONE, bytes: 100, reason: 'not shown; coin no longer held' },
  ]);
  assert.deepEqual(plan.skipped, ['145e66b1-3efd-4523-af35-33926573a136.json']);
});

test('a file written inside the age guard, or of unknown age, is kept: the next frame may show its coin', () => {
  const plan = planRemoval([f(`coin-logos/${HELD}`, NOW - 1_000), f(`coin-logos/${GONE}`, null)], new Set(), new Set(), NOW, DAY);
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.keptYoung.files, 2);
});

test('the list as CSV', () => {
  assert.equal(removalCsv([{ path: `coin-logos/${HELD}`, coin: HELD, bytes: 7, reason: 'not shown' }]), `path,coin,bytes,reason\ncoin-logos/${HELD},${HELD},7,"not shown"\n`);
});
