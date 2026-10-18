/**
 * ★ A PROFILE'S PORTFOLIO, ON THE REAL SCHEMA, AS TRADOR'S: someone else's profile carries their
 * wallet while "Show my trades to followers" is on (Trador's `portfolio_public`, on by default); off, the
 * wallet is withheld and `portfolio` says `private`; your own is always yours to see; a profile
 * with no wallet yet says `no_wallet`. Through the social routes themselves, on every migration.
 *
 * Why it is its own file: the Feed's tests (people-feed.test.ts) hold the switch's other half,
 * and this is the half that decides what a profile shows.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import { forgetKept, handle, type Db } from '@insidor/social';

import { migratedDb } from './db.ts';

const NOW = Date.UTC(2026, 9, 18, 12);
const WALLET = 'Fo11owMe1111111111111111111111111111111111';
const person = (n: number, wallet: string | null): Person => ({ userId: `did:privy:${n}`, handle: `user${n}`, name: `User ${n}`, pictureUrl: null, wallets: wallet === null ? [] : [{ address: wallet, kind: 'embedded' }] });

beforeEach(() => forgetKept());

async function setup() {
  const db = (await migratedDb()) as unknown as Db;
  const people = new Map<string, Person>();
  const deps = { db, identity: { verify: async (token: string) => people.get(token) ?? null }, chain: null, policy: DEFAULT_POLICY.social, now: () => NOW, pace: () => true };
  return (p: Person) => {
    people.set(p.userId, p);
    return async (method: string, url: string, body: unknown = null) => {
      const r = await handle({ method, url, body, token: p.userId, client: 'test' }, deps);
      return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
    };
  };
}

type Card = { wallet: string | null; portfolio: string };

test('★ another person\'s wallet shows only while they share; theirs is always theirs to see', async () => {
  const as = await setup();
  const owner = person(1, WALLET);
  const visitor = person(2, null);
  await as(owner)('POST', '/me');
  await as(visitor)('POST', '/me');

  const byDefault = (await as(visitor)('GET', '/profile/user1')).body['profile'] as Card;
  assert.deepEqual([byDefault.portfolio, byDefault.wallet], ['shown', WALLET], 'on by default, as Trador\'s portfolio_public');

  await as(owner)('PUT', '/me', { tradesPublic: false });
  const hidden = (await as(visitor)('GET', '/profile/user1')).body['profile'] as Card;
  assert.deepEqual([hidden.portfolio, hidden.wallet], ['private', null], 'off: the wallet is withheld, not just the list');

  const own = (await as(owner)('GET', '/profile/user1')).body['profile'] as Card;
  assert.deepEqual([own.portfolio, own.wallet], ['shown', WALLET], 'your own is always shown to you');
  const me = (await as(owner)('GET', '/me')).body as Card;
  assert.equal(me.wallet, WALLET);

  await as(owner)('PUT', '/me', { tradesPublic: true });
  const shared = (await as(visitor)('GET', '/profile/user1')).body['profile'] as Card;
  assert.deepEqual([shared.portfolio, shared.wallet], ['shown', WALLET]);

  await as(owner)('PUT', '/me', { tradesPublic: false });
  const again = (await as(visitor)('GET', '/profile/user1')).body['profile'] as Card;
  assert.deepEqual([again.portfolio, again.wallet], ['private', null], 'turning it off hides it again at once');

  const none = (await as(owner)('GET', '/profile/user2')).body['profile'] as Card;
  assert.deepEqual([none.portfolio, none.wallet], ['no_wallet', null], 'no wallet yet is said as that, not as private');
});
