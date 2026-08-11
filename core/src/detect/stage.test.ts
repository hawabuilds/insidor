/**
 * DETECT is not built yet. The claims below are the ones the previous build got
 * wrong, so they are written down before the code exists rather than after.
 */

import { test } from 'node:test';

test('a censored reading abstains; it never reads as cooling', { todo: 'detect/stage.ts' });

test('the self baseline alone can never open the gate', { todo: 'detect/stage.ts' });

test('burst is available at the second reading, not the third', { todo: 'detect/burst.ts' });

test('an irregular read grid does not inflate the frequently-read item', {
  todo: 'kinetics/ewma.ts',
});

test('eta is comparable across sources without a per-source constant', {
  todo: 'detect/poisson.ts',
});
