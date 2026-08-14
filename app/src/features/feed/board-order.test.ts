/**
 * RULE 4, PINNED: the board's "#" column is the array index at render time, and a position
 * never arrives on the wire.
 *
 * `Feed.tsx` renders `order.map((id, i) => <FeedRow rank={i + 1}/>)`. That is the only place a
 * position exists, and it exists for the length of that call. The failure this guards against
 * is not a styling mistake — it is somebody adding `rank` to the row so the column has
 * something convenient to read. The moment that lands, two things claim to know the ordering:
 * the committed `order` array and a number on each row, and they disagree the first time a
 * patch moves one without the other.
 *
 * There is no rendering test here because there is no DOM in this test runner. What is
 * testable, and what actually breaks the rule, is the allowlist: a field that is not in
 * `BOARD_ROW_FIELDS` is dropped by `pick` before a component can see it, so keeping a position
 * out of that array is what makes the rule enforceable rather than advisory.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BOARD_ROW_FIELDS, FORBIDDEN_KEYS } from '../../shared/api/wire/fields.ts';

/** Every name a board position could plausibly be smuggled in under. */
const POSITIONAL = [
  'rank',
  'position',
  'pos',
  'index',
  'idx',
  'place',
  'slot',
  'ordinal',
  'seq',
  'sequence',
  'no',
  'number',
  'row',
  'line',
];

test('a board row carries no position field: # is the index of the committed order', () => {
  for (const field of BOARD_ROW_FIELDS) {
    assert.ok(
      !POSITIONAL.includes(field.toLowerCase()),
      `BOARD_ROW_FIELDS contains "${field}", which reads as a board position. The # column is ` +
        `order.map((id, i) => i + 1) at render time and must stay that way — see Feed.tsx.`,
    );
  }
});

test('a payload that carries a rank is rejected, not quietly dropped', () => {
  /* `pick` would drop an unlisted field silently, which loses the evidence that a server
     started sending one. `rank` is on the exact-match ban list, so `assertNoInternalVocabulary`
     throws instead — the leak shows up as a failure rather than as a field nobody notices. */
  assert.ok(
    FORBIDDEN_KEYS.includes('rank'),
    'FORBIDDEN_KEYS must keep "rank": a ranked board that accepts a rank on the wire has ' +
      'given the client a second opinion about its own ordering.',
  );
});
