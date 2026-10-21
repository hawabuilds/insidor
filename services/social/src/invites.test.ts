import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CODE_ALPHABET, codeOf, countOf, newCode, partnerLabelOf } from './invites.ts';

test('★ a code is cleaned the one way it is stored: upper case, no spaces or dashes', () => {
  assert.equal(codeOf(' superteam-uk '), 'SUPERTEAMUK');
  assert.equal(codeOf('ab c9'), 'ABC9');
  assert.equal(codeOf('abc'), null, 'four at least');
  assert.equal(codeOf('A'.repeat(33)), null);
  assert.equal(codeOf('AB$CD'), null);
  assert.equal(codeOf(null), null);
});

test('a member code is drawn from an alphabet with no look-alikes', () => {
  for (const ch of '0O1IL') assert.ok(!CODE_ALPHABET.includes(ch), ch);
  let i = 0;
  assert.equal(newCode(8, () => i++), 'ABCDEFGH');
  assert.equal(newCode(8).length, 8);
});

test("the owner's numbers and names are bounded", () => {
  assert.equal(countOf(5, 10), 5);
  assert.equal(countOf(0, 10), null);
  assert.equal(countOf(11, 10), null);
  assert.equal(countOf(1.5, 10), null);
  assert.equal(partnerLabelOf('  Superteam   UK '), 'Superteam UK');
  assert.equal(partnerLabelOf(''), null);
  assert.equal(partnerLabelOf('x'.repeat(61)), null);
});
