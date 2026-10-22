import { test } from 'node:test';
import assert from 'node:assert/strict';

import { baseOf, candidatesFor, cleanUsername, usernameProblem } from './username.ts';

test('★ 3 to 15 letters, numbers or _, stored lower case without the @', () => {
  assert.equal(cleanUsername('  @Hawa_ '), 'hawa_');
  assert.equal(usernameProblem('hawa'), null);
  assert.equal(usernameProblem('abc'), null);
  assert.equal(usernameProblem('a_very_long_nam'), null, '15 is allowed');
  assert.equal(usernameProblem('ab'), 'short');
  assert.equal(usernameProblem('a_very_long_name'), 'long');
  assert.equal(usernameProblem('ha wa'), 'characters');
  assert.equal(usernameProblem('hawa.x'), 'characters');
  assert.equal(usernameProblem('hawä'), 'characters');
  assert.equal(usernameProblem(''), 'short');
});

test('★ names that would speak for Insidor are nobody\'s', () => {
  for (const n of ['admin', 'support', 'insidor', 'insidor_team', 'official', 'settings', 'null']) assert.equal(usernameProblem(n), 'reserved', n);
  assert.equal(usernameProblem('adminfan'), null, 'only the exact word, or an insidor prefix');
});

test('suggestions grow from the name: an underscore, a word, a number, then the person\'s other names', () => {
  assert.deepEqual(candidatesFor('hawa').slice(0, 3), ['hawa_', 'hawabuilds', 'hawa1']);
  const withX = candidatesFor('hawa', ['HawaOnX', 'Hawa Hassan'.replace(/\s+/g, '')]);
  assert.ok(withX.includes('hawaonx') && withX.includes('hawahassan'));
  assert.ok(!candidatesFor('hawa').includes('hawa'), 'never the taken name itself');
});

test('every suggestion fits the rules, a long name is cut to fit, and nothing comes from nothing', () => {
  for (const c of candidatesFor('averylongname15')) assert.equal(usernameProblem(c), null, c);
  assert.ok(candidatesFor('averylongname15').every((c) => c.length <= 15));
  assert.deepEqual(candidatesFor(''), []);
  assert.equal(baseOf('@Some.Name!'), 'somename');
  assert.ok(candidatesFor('admin').every((c) => usernameProblem(c) === null), 'a reserved name still gets free ones near it');
});
