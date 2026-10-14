/**
 * "Add missed posts" at the service edge: only the owner may paste or read, a paste is cut to post
 * links and refused past the per-paste limit, an address beside a post is saved as its coin the
 * way "Which coin?" saves one, and each row goes out as words, never our fields.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Person } from '@insidor/contracts/ports/people.ts';

import type { CoinCheck } from './coin-check.ts';
import { describe, missedRoute, span, type MissedDb } from './missed.ts';

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

const A = 'https://x.com/a/status/2110053432371376381';
const B = 'https://x.com/b/status/2110053432371376382';
const C = 'https://x.com/c/status/2110053432371376383';

test('a paste is its post links, each once; more than the limit is refused; the owner ref is stored', async () => {
  const { db, inserted } = fakeDb();
  const deps = { db, owner: OWNER, learning: { maxMissedPerPaste: 2 } };
  const me = person('OwnerWallet111');
  assert.equal((await missedRoute('POST', { text: `${A} ${B} ${C}` }, me, deps)).status, 400);
  assert.equal((await missedRoute('POST', { text: 'nothing here' }, me, deps)).status, 400);
  assert.equal((await missedRoute('POST', { text: `${A}\nhttp://x.com/a/status/2110053432371376381 junk` }, me, deps)).status, 200);
  assert.deepEqual(inserted, [[[A], 'wallet:OwnerWallet111']]);
});

test('a profile link is refused up front with what to paste, and nothing is queued', async () => {
  const { db, inserted } = fakeDb();
  const r = await missedRoute('POST', { text: 'https://www.tiktok.com/@givefromtheheart2?_r=1' }, person('OwnerWallet111'), { db, owner: OWNER, learning: { maxMissedPerPaste: 10 } });
  assert.equal(r.status, 400);
  assert.equal(JSON.parse(r.body).error, "This is a profile link, not a post. Paste the video's link.");
  assert.equal(inserted.length, 0);
});

const PUMP = 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump';
const UNKNOWN = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const LEFT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';

function labelDb() {
  const writes: { sql: string; params: readonly unknown[] }[] = [];
  const db: MissedDb = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      if (sql.startsWith('insert') || sql.includes('insert into')) writes.push({ sql, params });
      if (sql.includes('owner_feedback')) return [{ kind: 'coin_match', itemId: params[2], call: 'right', coin: params[3], at: 1 }] as never[];
      return [] as never[];
    },
  };
  return { db, writes };
}
const knowsPump: CoinCheck = { read: async (m) => (m === PUMP ? { address: m, name: 'Cat', ticker: 'CAT', logoUrl: null, marketCapUsd: 1, highestMarketCapUsd: null, highestWhy: 'no price history yet', launchedAt: null } : null) };

test('the preview reads each post with its address and the left-over ones, and writes nothing', async () => {
  const { db, writes } = labelDb();
  const r = await missedRoute('POST', { text: `${A} ${PUMP}\n${B}\n${LEFT} ${LEFT}`, preview: true }, person('OwnerWallet111'), { db, owner: OWNER, learning: { maxMissedPerPaste: 10 }, coinCheck: knowsPump });
  assert.equal(r.status, 200);
  const b = JSON.parse(r.body);
  assert.deepEqual(b.read.posts.map((p: { address: string | null }) => p.address), [PUMP, LEFT]);
  assert.deepEqual(b.read.loose, [LEFT]);
  assert.equal(b.problem, null);
  assert.equal(writes.length, 0);
});

test('★ each address is saved as its post\'s right coin, as "Which coin?" saves it; an unknown one saves nothing and says so', async () => {
  const { db, writes } = labelDb();
  const r = await missedRoute('POST', { text: `${A} ${PUMP}\n${B} ${UNKNOWN}\n${C}` }, person('OwnerWallet111'), { db, owner: OWNER, learning: { maxMissedPerPaste: 10 }, coinCheck: knowsPump });
  assert.equal(r.status, 200);
  const b = JSON.parse(r.body);
  assert.deepEqual(writes[0]?.params, [[A, B, C], 'wallet:OwnerWallet111'], 'every post joins the missed list');
  const labels = writes.filter((w) => w.sql.includes('owner_feedback'));
  assert.equal(labels.length, 1, 'only the coin a source knows is saved');
  assert.match(labels[0]?.sql ?? '', /'right'/);
  assert.deepEqual(labels[0]?.params.slice(0, 4), ['wallet:OwnerWallet111', 'u1', 'x:2110053432371376381', PUMP]);
  assert.deepEqual(b.saved.map((s: { ok: boolean; said: string }) => [s.ok, s.said]), [[true, 'Saved $CAT as its coin.'], [false, "Can't find this coin, so nothing was saved for it."]]);
});

test('anyone but the owner pasting addresses writes nothing and checks no coin', async () => {
  const { db, writes } = labelDb();
  let reads = 0;
  const counting: CoinCheck = { read: async (m) => { reads += 1; return knowsPump.read(m); } };
  assert.equal((await missedRoute('POST', { text: `${A} ${PUMP}` }, person('Someone222'), { db, owner: OWNER, learning: { maxMissedPerPaste: 10 }, coinCheck: counting })).status, 403);
  assert.equal(writes.length + reads, 0);
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
  const down = describe({ status: 'done', diagnosis: 'never_found', diagnosis_detail: { why: 'discovery_down', notRunningYet: false, downToMs: Date.parse('2026-10-13T02:04:15Z') }, last_error: null });
  assert.equal(down.headline, 'Never found: search was down');
  assert.match(down.lines.join(' '), /down when it was posted, until 02:04 UTC/);
  assert.match(describe({ status: 'done', diagnosis: 'never_found', diagnosis_detail: { why: 'discovery_down', notRunningYet: true }, last_error: null }).lines.join(' '), /not running yet/);
});
