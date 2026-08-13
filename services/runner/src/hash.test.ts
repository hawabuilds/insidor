/**
 * The policy hash is the field that makes a past decision auditable, so the
 * property worth pinning is not "it hashes" but "it hashes the MEANING": the
 * same policy written in a different key order is the same policy, and a changed
 * threshold is a different one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { advisoryLockKey, canonicalJson, policyHash } from './hash.ts';

test('key order does not change the canonical form', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } }),
    canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }),
  );
});

test('array order does change it — order is meaning in a list', () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('the default policy hashes stably, and a moved threshold moves the hash', () => {
  const before = policyHash(DEFAULT_POLICY);
  assert.equal(before, policyHash(DEFAULT_POLICY));
  assert.match(before, /^[0-9a-f]{64}$/);

  const nudged = {
    ...DEFAULT_POLICY,
    explore: { ...DEFAULT_POLICY.explore, holdoutRate: 0.5 },
  };
  assert.notEqual(policyHash(nudged), before);
});

test('a lock name maps to one stable unsigned key', () => {
  const key = advisoryLockKey('insidor.runner');
  assert.equal(key, advisoryLockKey('insidor.runner'));
  assert.notEqual(key, advisoryLockKey('insidor.chainwatch'));
  assert.ok(Number.isInteger(key) && key >= 0 && key <= 0xffff_ffff);
});
