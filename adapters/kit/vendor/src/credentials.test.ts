/**
 * The property under test is not "it reads variables". It is that the THREE answers
 * stay three answers — because the whole feature above this file is a screen that
 * has to say which of them is true, and every collapse between two of them is
 * invisible until somebody is paying for a source that has been dark for a month.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { credentialVariables, readCredentials, type CredentialSpec } from './credentials.ts';

const SPEC: CredentialSpec = {
  source: 'example',
  requires: [
    { variable: 'EXAMPLE_KEY', note: 'the key', fallback: null },
    { variable: 'EXAMPLE_SECRET', note: 'the secret', fallback: null },
    { variable: 'EXAMPLE_BASE', note: 'the public host', fallback: 'https://host.invalid' },
  ],
};

test('nothing set at all is dormant, and names what turning it on would take', () => {
  const check = readCredentials(SPEC, {});
  assert.equal(check.kind, 'dormant');
  if (check.kind !== 'dormant') return;
  assert.deepEqual([...check.missing].sort(), ['EXAMPLE_KEY', 'EXAMPLE_SECRET']);
});

test('a blank or whitespace-only value is not a value', () => {
  // The shape a .env.example produces on a fresh clone: the line exists, empty.
  const check = readCredentials(SPEC, { EXAMPLE_KEY: '', EXAMPLE_SECRET: '   ' });
  assert.equal(check.kind, 'dormant');
});

test('half the secrets is misconfigured, NOT dormant', () => {
  // The distinction this whole file exists for: somebody turned it on and got it
  // wrong. Reporting that as "nobody turned this on" agrees with the person who
  // believes it is running.
  const check = readCredentials(SPEC, { EXAMPLE_KEY: 'k' });
  assert.equal(check.kind, 'misconfigured');
  if (check.kind !== 'misconfigured') return;
  assert.equal(check.problems.length, 1);
  assert.match(check.problems[0] ?? '', /EXAMPLE_SECRET/);
});

test('every secret set is ready, and the fallback fills the non-credential', () => {
  const check = readCredentials(SPEC, { EXAMPLE_KEY: 'k', EXAMPLE_SECRET: 's' });
  assert.equal(check.kind, 'ready');
  if (check.kind !== 'ready') return;
  assert.equal(check.values('EXAMPLE_KEY'), 'k');
  assert.equal(check.values('EXAMPLE_BASE'), 'https://host.invalid');
});

test('an unset non-credential cannot make a source look half-configured', () => {
  // EXAMPLE_BASE has a fallback, so it is not a credential and must not enrol in the
  // dormant/misconfigured judgement. Getting this wrong would report every correctly
  // configured source as broken.
  const check = readCredentials(SPEC, { EXAMPLE_KEY: 'k', EXAMPLE_SECRET: 's', EXAMPLE_BASE: '' });
  assert.equal(check.kind, 'ready');
});

test('values are trimmed, because a trailing newline is what a secret store returns', () => {
  const check = readCredentials(SPEC, { EXAMPLE_KEY: ' k\n', EXAMPLE_SECRET: 's' });
  assert.equal(check.kind, 'ready');
  if (check.kind !== 'ready') return;
  assert.equal(check.values('EXAMPLE_KEY'), 'k');
});

test('asking for a variable the spec never declared throws rather than returning empty', () => {
  const check = readCredentials(SPEC, { EXAMPLE_KEY: 'k', EXAMPLE_SECRET: 's' });
  assert.equal(check.kind, 'ready');
  if (check.kind !== 'ready') return;
  // A typo in an adapter's own config builder must be a crash at construction, not
  // an empty string that becomes an authentication failure four layers away.
  assert.throws(() => check.values('EXAMPLE_TYPO'), RangeError);
});

test('reading the environment never throws, whatever is in it', () => {
  // The caller is a boot path that must survive any environment, including a hostile
  // or half-written one. There is no input for which this function is allowed to
  // take the process down.
  for (const env of [{}, { EXAMPLE_KEY: 'k' }, { EXAMPLE_BASE: 'x' }, { UNRELATED: 'y' }]) {
    assert.doesNotThrow(() => readCredentials(SPEC, env));
  }
});

test('credentialVariables lists the secrets and not the defaulted host', () => {
  assert.deepEqual(credentialVariables(SPEC), ['EXAMPLE_KEY', 'EXAMPLE_SECRET']);
});
