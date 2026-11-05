/**
 * The reskinned-account check: the two zoos the owner found are held, the real accounts that
 * came closest on the week's feed are not, and a history the source did not give holds nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY, type Millis } from '@insidor/contracts';

import { reskinned } from './reskin.ts';

const NOW = Date.parse('2026-11-04T23:00:00Z') as Millis;
const P = DEFAULT_POLICY.ingest.reskin;
const made = (iso: string) => Date.parse(iso) as Millis;

test('★ the larp zoos are held (2026-11-04)', () => {
  assert.equal(reskinned({ createdAt: made('2009-03-17T23:24:23Z'), postsEver: 60, approvalsGiven: 0 }, NOW, { ...P, on: true }), true, '@honolulu_zoo');
  assert.equal(reskinned({ createdAt: made('2008-11-19T18:02:40Z'), postsEver: 30, approvalsGiven: 64 }, NOW, { ...P, on: true }), true, '@ThailandZoo');
});

test('real accounts the feed showed nearest the bars are not held', () => {
  assert.equal(reskinned({ createdAt: made('2010-08-01T00:00:00Z'), postsEver: 95, approvalsGiven: 4938 }, NOW, P), false, 'posts little, likes a lot');
  assert.equal(reskinned({ createdAt: made('2023-07-22T04:37:53Z'), postsEver: 126, approvalsGiven: 38 }, NOW, P), false, 'a meme page posting 38 a year');
  assert.equal(reskinned({ createdAt: made('2013-02-01T00:00:00Z'), postsEver: 21_639, approvalsGiven: 16 }, NOW, P), false, 'a real zoo: thousands of posts');
  assert.equal(reskinned({ createdAt: made('2026-10-30T00:00:00Z'), postsEver: 3, approvalsGiven: 0 }, NOW, P), false, 'a new account is not an old one emptied');
});

test('★ a history the source did not give holds nothing; off holds nothing', () => {
  assert.equal(reskinned(undefined, NOW, P), false);
  assert.equal(reskinned({ createdAt: made('2009-03-17T00:00:00Z'), postsEver: null, approvalsGiven: 0 }, NOW, P), false);
  assert.equal(reskinned({ createdAt: null, postsEver: 60, approvalsGiven: 0 }, NOW, P), false);
  assert.equal(reskinned({ createdAt: made('2009-03-17T00:00:00Z'), postsEver: 60, approvalsGiven: 0 }, NOW, { ...P, on: false }), false);
});
