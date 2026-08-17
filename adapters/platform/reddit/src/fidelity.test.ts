/**
 * ★ THE FILE THAT CHECKS THE CLAIM THIS PACKAGE IS ABOUT: that two successive
 * reads of a vote count on this source produce NO RATE rather than a rate of
 * zero.
 *
 * ── WHY THIS TEST RESTATES A RULE IT CANNOT IMPORT ────────────────────────
 *
 * The censoring rule lives in `core/src/kinetics/rate.ts` and adapters may not
 * import core — the boundary check forbids it, and the reason it forbids it is
 * exactly the reason this package exists: if an adapter can reach core it will
 * eventually make a product decision. So this file cannot call `emitRate` and
 * assert `censored`. What it CAN do, and does, is assert the property the rule
 * keys on, at the precise place the rule reads it. The rule's first branch is:
 *
 *     if (curr.fidelity.kind === 'absent' || curr.fidelity.kind === 'fuzzed') {
 *       return censoredRate('unusable_fidelity', null);
 *     }
 *
 * It runs BEFORE every other check — before no-prior, before elapsed time,
 * before the below-step test — so a counter whose fidelity is `fuzzed` cannot
 * produce a rate at any interval, at any magnitude, ever. Asserting that this
 * adapter hands that branch a `fuzzed` fidelity is asserting the whole outcome,
 * and it is the strongest thing that can honestly be asserted from this side of
 * the boundary. `CENSOR_REASONS` is imported from contracts so that the reason
 * code named above is a real one and not a string in a comment.
 *
 * ── WHAT WE DELIBERATELY DID NOT CLAIM ────────────────────────────────────
 *
 * `{ kind: 'quantized', significantDigits: n }` would be nicer downstream: it
 * censors only sub-step wobble, so large real moves still yield rates, and it
 * carries the level forward. It is not available to us, because `n` would be
 * invented. The magnitude of this source's vote fuzzing is undocumented, the
 * only fuzzing routine it ever open-sourced is for a different counter and
 * DECAYS with magnitude rather than growing with it, and that routine's own
 * comments say the perturbed value is cached so repeated reads cannot reveal
 * the range. So the size is not merely unpublished — it is deliberately
 * unmeasurable, and `fuzzed` is the variant that takes no parameter for exactly
 * this situation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CENSOR_REASONS, COUNTER_KINDS } from '@insidor/contracts';

import { PLAIN } from './__fixtures__/posts.ts';
import { CAPABILITIES, FIDELITY, PRICES } from './capabilities.ts';
import { toCounters } from './to-item.ts';

const FIRST = 1_800_000_000_000;
const SECOND = FIRST + 5 * 60_000;

/** The two branches of the rule that make a reading unusable for a difference. */
const UNUSABLE = ['absent', 'fuzzed'];

test('two reads of the vote count cannot support a rate — at any interval, at any size', () => {
  // A six-point move on eight thousand: smaller than any plausible fuzz, and
  // the case the brief describes. It is censored, and so is a six-THOUSAND
  // point move, because the branch never looks at the numbers at all.
  const small = toCounters({ ...(PLAIN as object), score: 8_437 }, SECOND);
  const large = toCounters({ ...(PLAIN as object), score: 88_431 }, SECOND);
  const prev = toCounters(PLAIN, FIRST);

  for (const curr of [small, large]) {
    assert.ok(
      UNUSABLE.includes(curr.approval?.fidelity.kind ?? ''),
      'the rule censors on this branch before it reaches any arithmetic',
    );
  }
  assert.ok(UNUSABLE.includes(prev.approval?.fidelity.kind ?? ''));

  // And the values ARE different, so the pair would otherwise have produced a
  // perfectly plausible non-zero rate. That is the point: the number moved and
  // we still decline to say by how much, because we did not measure a move.
  assert.notEqual(prev.approval?.value, small.approval?.value);
  assert.ok(CENSOR_REASONS.includes('unusable_fidelity'));
});

test('the fuzzed reading carries no level forward either, which is a stronger claim than it looks', () => {
  // The rule returns `censoredRate('unusable_fidelity', null)` on this branch —
  // `null`, not the level. A perturbed number is not a trustworthy answer to
  // "how big is this" any more than to "how fast is it growing". Recorded here
  // because it is the surprising half of choosing `fuzzed`, and the reason the
  // comment counter below matters so much on this source.
  assert.deepEqual(FIDELITY.approval, { kind: 'fuzzed' });
});

test('the comment counter IS rate-bearing, so this source is not kinetically blind', () => {
  const prev = toCounters(PLAIN, FIRST);
  const curr = toCounters({ ...(PLAIN as object), num_comments: 244 }, SECOND);

  assert.equal(prev.conversation?.fidelity.kind, 'exact');
  assert.equal(curr.conversation?.fidelity.kind, 'exact');
  assert.equal(UNUSABLE.includes(curr.conversation?.fidelity.kind ?? ''), false);

  // Both readings present, positive elapsed time, a positive difference: none
  // of the rule's censoring branches applies, so this pair yields a measured
  // rate. Everything kinetic this source will ever contribute rides on it.
  assert.equal(curr.conversation?.value, 244);
  assert.equal(prev.conversation?.value, 219);
  assert.ok((curr.conversation?.observedAt ?? 0) - (prev.conversation?.observedAt ?? 0) > 0);
});

/* ── the capability declaration itself ────────────────────────────────── */

test('four of the six counter kinds are declared absent, and the two halves are disjoint', () => {
  assert.deepEqual([...CAPABILITIES.counters].sort(), ['approval', 'conversation']);
  assert.deepEqual([...CAPABILITIES.absent].sort(), ['reach', 'rebroadcast', 'reproduction', 'retention']);
  for (const kind of CAPABILITIES.absent) {
    assert.equal(CAPABILITIES.counters.includes(kind), false, `${kind} is declared both present and absent`);
  }
  // Every kind is accounted for one way or the other on this source, which is
  // unusual and worth pinning: nothing here is merely unmeasured.
  assert.equal(CAPABILITIES.counters.length + CAPABILITIES.absent.length, COUNTER_KINDS.length);
});

test('every counter kind has a declared fidelity, including the four never attached to a Counter', () => {
  for (const kind of COUNTER_KINDS) {
    assert.ok(FIDELITY[kind] !== undefined, `${kind} has no declared fidelity`);
  }
  for (const kind of CAPABILITIES.absent) {
    // Declared for documentation only: the point is that someone reaching for a
    // reach fidelity finds the argument instead of inventing a number.
    assert.deepEqual(FIDELITY[kind], { kind: 'absent' });
  }
});

test('this source is billed per call, which is the unit it actually rations', () => {
  assert.equal(CAPABILITIES.billing, 'per-call');
  for (const price of Object.values(PRICES)) {
    // A declared unit that disagrees with the price book makes the meter throw
    // BEFORE the request, which is the only place that mismatch is catchable.
    assert.equal(price.unit, CAPABILITIES.billing);
    assert.equal(price.usdPerUnit, 0, 'free — and still a row in the ledger, because the call happened');
    assert.ok(price.measuredAt.length > 0, 'a price with no date on it is a guess wearing a number');
  }
});
