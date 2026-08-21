/**
 * THE ONE RULE IN THIS FILE'S VOCABULARY THAT IS A FUNCTION, AND IT IS ASYMMETRIC.
 *
 * `coinOriginsVisibleTo` decides which coins a story may even be compared against, and the
 * direction is its whole content — so the direction is what these pin. The two mistakes it
 * stands between are not each other's mirror image: a demonstration story seeing a real coin
 * is a demonstration either way, while a real story seeing an invented coin is a fiction
 * presented as a finding, on a row that offers a Buy affordance behind it.
 *
 * These are three assertions about a two-line function on purpose. The rule is applied in
 * SQL, in another package, as a bound parameter — and a test that could only reach it there
 * would be testing the shape of a statement rather than the rule inside it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { OBSERVED_ASSET_ORIGINS } from './asset.ts';
import { coinOriginsVisibleTo, STORY_ORIGINS } from './story.ts';

test('★ an observed story sees observed coins and nothing else, ever', () => {
  const visible = coinOriginsVisibleTo('observed');

  assert.equal(visible.includes('fixture'), false, '★ an invented coin could reach a real story');
  assert.deepEqual([...visible].sort(), [...OBSERVED_ASSET_ORIGINS].sort());

  /* `unrecorded` is out too, and not by a clause of its own: it falls out of building this
     list from the observed allowlist rather than by subtracting values from ASSET_ORIGINS.
     A row nobody can place is a row no story may name. */
  assert.equal(visible.length, OBSERVED_ASSET_ORIGINS.length);
});

test('★ a fixture story sees fixture coins AND observed ones — the harmless direction', () => {
  const visible = coinOriginsVisibleTo('fixture');

  assert.equal(visible.includes('fixture'), true, 'a seeded story cannot see its own coins');
  for (const observed of OBSERVED_ASSET_ORIGINS) {
    assert.equal(visible.includes(observed), true, `a fixture story lost sight of ${observed}`);
  }

  /* ★ AND THAT IS WHY THE RULE IS NOT "SAME ORIGIN". Same-origin is the spelling that looks
     obviously right: it would forbid this line — a demo matching a real coin, which harms
     nobody — and buy exactly nothing for the direction that does harm. */
  assert.equal(visible.length, OBSERVED_ASSET_ORIGINS.length + 1);
});

test('★ only a fixture story is ever told about a fixture coin', () => {
  /* Over the whole closed list rather than over the two values that exist today. The
     fall-through in `coinOriginsVisibleTo` is written to run the NARROW way, so a third
     story origin added next year is excluded by default and has to be named on that line to
     see invented rows — this is the assertion that notices if someone adds the value and
     forgets the line. */
  for (const origin of STORY_ORIGINS) {
    assert.equal(
      coinOriginsVisibleTo(origin).includes('fixture'),
      origin === 'fixture',
      `a ${origin} story has the wrong answer about invented coins`,
    );
  }
});
