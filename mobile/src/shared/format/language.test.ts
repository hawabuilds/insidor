import assert from 'node:assert/strict';
import test from 'node:test';

import { languageName } from './language.ts';

test('a code is named in English', () => {
  assert.equal(languageName('pt'), 'Portuguese');
  assert.equal(languageName('ja'), 'Japanese');
  assert.equal(languageName('bn'), 'Bangla');
});

test('a code nobody can name is null, never printed bare', () => {
  assert.equal(languageName('qqq'), null);
});
