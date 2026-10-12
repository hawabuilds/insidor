/**
 * THE SOCIAL RULES AGAINST THE REAL SCHEMA: the people migrations applied to an in-process
 * Postgres, the routes driven with a stand-in sign-in (signed tokens are tested in the identity
 * adapter) and a recorded chain — who holds which coin is fixed data, nothing is fetched.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import { forgetKept, handle, type Chain, type Db } from '@insidor/social';

import { migratedDb } from './db.ts';

const P = DEFAULT_POLICY.social;
const MINT = 'FerryHorn1111111111111111111111111111111pump';
const NOW = Date.UTC(2026, 9, 12, 12);

/* Base58 has no 0: digits are spelled with letters. */
const wallet = (n: number) => `${'A'.repeat(40)}${String(n).padStart(3, '0').replace(/\d/g, (d) => 'abcdefghij'[Number(d)] ?? 'a')}`;
const person = (n: number, handle: string | null = `user${n}`): Person => ({ userId: `did:privy:${n}`, handle, name: `User ${n}`, pictureUrl: null, wallets: [{ address: wallet(n), kind: 'embedded' }] });

/* The recorded chain: who holds FERRY right now. */
function chain(holders: Set<string>): Chain {
  return {
    holds: async (wallets, mint) => mint === MINT && wallets.some((w) => holders.has(w)),
    firstBuyPriceSol: async () => null,
    launchPriceSol: async () => 2.8e-8,
    txTouchesMint: async () => false,
  };
}

async function setup(holders: Set<string>) {
  const db = (await migratedDb()) as unknown as Db;
  const people = new Map<string, Person>();
  const deps = {
    db,
    identity: { verify: async (token: string) => people.get(token) ?? null },
    chain: chain(holders),
    policy: P,
    now: () => NOW,
    pace: () => true,
  };
  const as = (p: Person) => {
    people.set(p.userId, p);
    return async (method: string, url: string, body: unknown = null) => {
      const r = await handle({ method, url, body, token: p.userId, client: 'test' }, deps);
      return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
    };
  };
  return { db, as };
}

beforeEach(() => forgetKept());

test('★ only holders can like, checked when the like is made', async () => {
  const author = person(1);
  const holder = person(2);
  const stranger = person(3);
  const { as } = await setup(new Set([wallet(2)]));
  await as(author)('POST', '/me');
  const posted = await as(author)('POST', '/comments', { subject: `coin:solana:${MINT}`, body: 'FERRY has a horn now' });
  assert.equal(posted.status, 201);
  const id = (posted.body['comment'] as { id: number }).id;
  await as(stranger)('POST', '/me');
  const refused = await as(stranger)('POST', `/comments/${id}/like`);
  assert.equal(refused.status, 403);
  assert.match(String(refused.body['error']), /Only holders/);
  await as(holder)('POST', '/me');
  const liked = await as(holder)('POST', `/comments/${id}/like`);
  assert.equal(liked.status, 200);
  assert.equal(liked.body['earned'], 10, 'an Intern holder: 10 points');
  assert.equal((await as(author)('POST', `/comments/${id}/like`)).status, 400, 'nobody likes their own comment');
});

test('★ a voter earns others rep on twenty likes a day, and no more', async () => {
  const voter = person(9);
  const { as, db } = await setup(new Set([wallet(9)]));
  await as(voter)('POST', '/me');
  const earned: number[] = [];
  for (let n = 0; n < 22; n += 1) {
    const author = person(100 + n);
    await as(author)('POST', '/me');
    const c = await as(author)('POST', '/comments', { subject: `coin:${MINT}`, body: `call ${n}` });
    const r = await as(voter)('POST', `/comments/${(c.body['comment'] as { id: number }).id}/like`);
    earned.push(Number(r.body['earned']));
  }
  assert.equal(earned.filter((e) => e > 0).length, P.dailyVoteCap);
  assert.deepEqual(earned.slice(P.dailyVoteCap), [0, 0], 'the 21st and 22nd likes count as likes, not as rep');
  const [likes] = await db.query<{ n: number }>('select count(*)::int as n from people.comment_like');
  assert.equal(likes?.n, 22);
});

test('a reply and a follow queue an alert for the person they are about; a rank-up queues one too', async () => {
  const a = person(1);
  const b = person(2);
  const { as, db } = await setup(new Set([wallet(2)]));
  await as(a)('POST', '/me');
  await as(b)('POST', '/me');
  const c = await as(a)('POST', '/comments', { subject: `coin:${MINT}`, body: 'first' });
  const id = (c.body['comment'] as { id: number }).id;
  await as(b)('POST', '/comments', { subject: `coin:${MINT}`, parentId: id, body: 'agreed' });
  await as(b)('POST', `/follow/${a.userId}`);
  await db.query(`insert into people.rep_event (season, voter_id, comment_id, author_id, points, voter_rank, proof_boost, early_boost) values (1, $1, $2, $3, 245, 'intern', false, false)`, [a.userId, id, b.userId]);
  forgetKept();
    const bComment = await as(b)('POST', '/comments', { subject: `coin:${MINT}`, body: 'second' });
  const holderA = { ...a, wallets: [{ address: wallet(2), kind: 'linked' as const }] };
  await as(holderA)('POST', `/comments/${(bComment.body['comment'] as { id: number }).id}/like`);
  const queued = await db.query<{ userId: string; kind: string; subject: string }>('select user_id as "userId", kind, subject from people.alert_queue order by queue_id');
  assert.deepEqual(queued.map((q) => [q.userId, q.kind]), [[a.userId, 'reply'], [a.userId, 'follow'], [b.userId, 'rank_up']]);
  assert.equal(queued[2]?.subject, 'analyst', 'Intern to Analyst at 250 rep');
});

test('three reports hide a comment from everyone; hide is for me only', async () => {
  const { as } = await setup(new Set());
  const author = person(1);
  await as(author)('POST', '/me');
  const c = await as(author)('POST', '/comments', { subject: `coin:${MINT}`, body: 'spam spam' });
  const id = (c.body['comment'] as { id: number }).id;
  const viewer = person(50);
  await as(viewer)('POST', '/me');
  await as(viewer)('POST', `/comments/${id}/hide`);
  assert.equal(((await as(viewer)('GET', `/comments?subject=coin:${MINT}`)).body['comments'] as unknown[]).length, 0);
  assert.equal(((await as(author)('GET', `/comments?subject=coin:${MINT}`)).body['comments'] as unknown[]).length, 1);
  for (const n of [60, 61, 62]) {
    await as(person(n))('POST', '/me');
    await as(person(n))('POST', `/comments/${id}/report`, { reason: 'spam' });
  }
  assert.equal(((await as(author)('GET', `/comments?subject=coin:${MINT}`)).body['comments'] as unknown[]).length, 0);
});

test('the word filter and the hourly limit refuse a comment, and say why', async () => {
  const { as } = await setup(new Set());
  const a = person(1);
  await as(a)('POST', '/me');
  assert.match(String((await as(a)('POST', '/comments', { subject: `coin:${MINT}`, body: 'you retard' })).body['error']), /isn't allowed/);
  for (let n = 0; n < P.commentsPerWindow; n += 1) await as(a)('POST', '/comments', { subject: `coin:${MINT}`, body: `ok ${n}` });
  assert.equal((await as(a)('POST', '/comments', { subject: `coin:${MINT}`, body: 'one more' })).status, 429);
});

test('a profile carries its rank card, and the leaderboard ranks the season by rep', async () => {
  const { as, db } = await setup(new Set());
  const a = person(1);
  const b = person(2);
  await as(a)('POST', '/me');
  await as(b)('POST', '/me');
  const c = await as(a)('POST', '/comments', { subject: `coin:${MINT}`, body: 'x' });
  await db.query(`insert into people.rep_event (season, voter_id, comment_id, author_id, points, voter_rank, proof_boost, early_boost) values (1, $1, $2, $3, 1200, 'intern', false, false)`, [b.userId, (c.body['comment'] as { id: number }).id, a.userId]);
  forgetKept();
  const card = (await as(b)('GET', '/profile/user1')).body['profile'] as Record<string, unknown>;
  assert.equal(card['rank'], 'quant', '1,200 rep is Quant; GOAT also needs Wolf rep');
  assert.deepEqual(card['next'], { rank: 'wolf', repToGo: 3_800 });
  const board = (await as(b)('GET', '/leaderboard')).body as { rows: { handle: string; rep: number; position: number }[] };
  assert.deepEqual(board.rows.map((r) => [r.position, r.handle, r.rep]), [[1, 'user1', 1_200]], 'only people with rep this season are ranked');
});
