/**
 * Search's people strip: the term the social service searches people by (routes.ts peopleTerm,
 * likeEscaped). An @ is how people write a handle, handles are stored lower case, and LIKE's own
 * characters must match themselves, or "a_b" would find every a?b.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { likeEscaped, peopleTerm } from './routes.ts';

test('★ a people search drops the @, lower-cases, and refuses a term under 2 or over 40', () => {
  assert.equal(peopleTerm('@PepeHunter'), 'pepehunter');
  assert.equal(peopleTerm('  @@ab '), 'ab');
  assert.equal(peopleTerm('a'), null);
  assert.equal(peopleTerm('@'), null);
  assert.equal(peopleTerm(null), null);
  assert.equal(peopleTerm('x'.repeat(41)), null);
});

test("★ LIKE's own characters match themselves", () => {
  assert.equal(likeEscaped('a_b'), 'a\\_b');
  assert.equal(likeEscaped('50%'), '50\\%');
  assert.equal(likeEscaped('a\\b'), 'a\\\\b');
  assert.equal(likeEscaped('pepe'), 'pepe');
});
