/**
 * "Add missed posts" at the service edge: only the owner may paste or read, a paste is cut to https
 * links and refused past the per-paste limit, and each row goes out as words, never our fields.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Person } from '@insidor/contracts/ports/people.ts';

import { describe, linksIn, missedRoute, span, type MissedDb } from './missed.ts';

const OWNER = { wallets: ['OwnerWallet111'], xHandles: ['boss'] };
const person = (wallet: string, handle: string | null = null): Person => ({ userId: 'u1', handle, name: null, pictureUrl: null, wallets: [{ address: wallet, kind: 'embedded' }] });

function fakeDb(): { db: MissedDb; inserted: unknown[][] } {
  const inserted: unknown[][] = [];
  const db: MissedDb = {
    query: async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('insert into internal.missed_post')) inserted.push([...(params ?? [])]);
      return [] as never[];
    },
  };
  return { db, inserted };
}

test('★ only the owner: signed out is 401, anyone else 403 and nothing written; the owner by wallet or handle', async () => {
  const { db, inserted } = fakeDb();
  const deps = { db, owner: OWNER, learning: { maxMissedPerPaste: 10 } };
  assert.equal((await missedRoute('GET', null, null, deps)).status, 401);
  assert.equal((await missedRoute('POST', { text: 'https://x.com/a/status/1' }, person('Someone222'), deps)).status, 403);
  assert.equal(inserted.length, 0);
  assert.equal((await missedRoute('GET', null, person('OwnerWallet111'), deps)).status, 200);
  assert.equal((await missedRoute('GET', null, person('Other', 'Boss'), deps)).status, 200);
  assert.equal((await missedRoute('GET', null, person('OwnerWallet111'), { ...deps, owner: undefined })).status, 403, 'no owner listed must be nobody');
});

test('a paste is its https links, each once; more than the limit is refused; the owner ref is stored', async () => {
  assert.deepEqual(linksIn('https://a.example/1\nhttp://b.example/2  https://a.example/1 junk https://c.example/3'), ['https://a.example/1', 'https://c.example/3']);
  const { db, inserted } = fakeDb();
  const deps = { db, owner: OWNER, learning: { maxMissedPerPaste: 2 } };
  const me = person('OwnerWallet111');
  assert.equal((await missedRoute('POST', { text: 'https://a.example/1 https://a.example/2 https://a.example/3' }, me, deps)).status, 400);
  assert.equal((await missedRoute('POST', { text: 'nothing here' }, me, deps)).status, 400);
  assert.equal((await missedRoute('POST', { text: 'https://a.example/1' }, me, deps)).status, 200);
  assert.deepEqual(inserted, [[['https://a.example/1'], 'wallet:OwnerWallet111']]);
});

test('before 0055 is applied the owner gets 503, not a server error', async () => {
  const db: MissedDb = { query: async () => Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' })) };
  assert.equal((await missedRoute('GET', null, person('OwnerWallet111'), { db, owner: OWNER, learning: { maxMissedPerPaste: 10 } })).status, 503);
});

test('each diagnosis reads as words, with the facts behind it', () => {
  const never = describe({ status: 'done', diagnosis: 'never_found', diagnosis_detail: { why: 'not_in_search', filter: 'language', lang: 'es' }, last_error: null });
  assert.equal(never.headline, 'Never found');
  assert.match(never.lines.join(' '), /language.*\(es\)/);
  const late = describe({ status: 'done', diagnosis: 'shown_late', diagnosis_detail: { shownMinutes: 200, crossedBarMinutes: 30, afterCoinMinutes: 45 }, last_error: null });
  assert.equal(late.tone, 'late');
  assert.match(late.lines.join(' '), /3 h 20 min after posting.*45 min before we showed it/);
  const turned = describe({ status: 'done', diagnosis: 'rejected', diagnosis_detail: { foundMinutes: 8, judge: { said: 'not_memeable', name: null } }, last_error: null });
  assert.match(turned.lines.join(' '), /said it is not a meme/);
  assert.equal(describe({ status: 'queued', diagnosis: null, diagnosis_detail: {}, last_error: null }).headline, 'Checking');
  assert.equal(span(1_500), '1 day');
});
