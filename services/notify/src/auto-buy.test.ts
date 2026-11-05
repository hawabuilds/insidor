/**
 * Auto buy's routes: owner only, every number checked against the policy, and the wallet always
 * the person's own embedded one, never the request's.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';

import { allowedWallet, autoBuyRoute, feeLamports, isOwner, readSettings } from './auto-buy.ts';

const P = DEFAULT_POLICY.notify.autoBuy;
const OWNER = { wallets: ['OwnerWallet111'], xHandles: ['hawabuilds'] };
const person = (wallets: Person['wallets'], handle: string | null = null): Person => ({ userId: 'u1', handle, name: null, pictureUrl: null, wallets });
const me = person([{ address: 'OwnerWallet111', kind: 'embedded' }]);
const stranger = person([{ address: 'Someone222', kind: 'embedded' }]);
const NOW = 1_700_000_000_000;
const good = { lamports: 100_000_000, maxCapUsd: 50_000, pvpCoins: 2, speed: 'fast', slippageBps: 1_000, activeMs: 259_200_000 };

test('★ only the owner, by wallet or X handle in any case, may set one while it is owner-only', () => {
  assert.equal(isOwner(me, OWNER), true);
  assert.equal(isOwner(person([], 'HawaBuilds'), OWNER), true);
  assert.equal(isOwner(stranger, OWNER), false);
  assert.equal(allowedWallet(stranger, P, OWNER), null);
  assert.equal(allowedWallet(me, { ...P, on: false }, OWNER), null, 'switched off: nobody');
  assert.equal(allowedWallet(stranger, { ...P, ownerOnly: false }, OWNER), 'Someone222', 'open to all: their own wallet');
});

test('★ the wallet is the sign-in\'s embedded wallet, never a linked one', () => {
  const both = person([{ address: 'Linked999', kind: 'linked' }, { address: 'OwnerWallet111', kind: 'embedded' }]);
  assert.equal(allowedWallet(both, P, OWNER), 'OwnerWallet111');
  assert.equal(allowedWallet(person([{ address: 'OwnerWallet111', kind: 'linked' }]), P, OWNER), null, 'owner with only a linked wallet: nothing to buy from');
});

test('★ every number is checked against the policy: the amount cap, the choices, PvP', () => {
  assert.ok('settings' in readSettings(good, P, NOW));
  const r = readSettings(good, P, NOW);
  assert.ok('settings' in r && r.settings.activeUntil === NOW + 259_200_000);
  assert.ok('refused' in readSettings({ ...good, lamports: 500_000_001 }, P, NOW), 'over the test cap');
  assert.ok('refused' in readSettings({ ...good, lamports: 0.5 }, P, NOW), 'not whole lamports');
  assert.ok('refused' in readSettings({ ...good, slippageBps: 4_000 }, P, NOW), 'slippage not a choice');
  assert.ok('refused' in readSettings({ ...good, pvpCoins: 9 }, P, NOW));
  assert.ok('refused' in readSettings({ ...good, speed: 'ludicrous' }, P, NOW));
  assert.ok('refused' in readSettings({ ...good, activeMs: 1 }, P, NOW));
  assert.ok('refused' in readSettings({ ...good, maxCapUsd: -5 }, P, NOW));
  assert.ok('settings' in readSettings({ ...good, maxCapUsd: 33_000 }, P, NOW), 'a custom cap');
});

test('★ a stranger is refused; the owner saves with their own wallet, whatever the body says', async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const db = { query: async (sql: string, params: readonly unknown[] = []) => { calls.push({ sql, params }); return [] as never[]; } };
  const deps = { policy: P, owner: OWNER, now: () => NOW };
  const refused = await autoBuyRoute(db as never, 'PUT', ['auto-buy', 'x:1'], stranger, good, deps);
  assert.equal(refused?.status, 403);
  assert.equal(calls.length, 0, 'nothing written for a stranger');
  const cfg = await autoBuyRoute(db as never, 'GET', ['auto-buy', 'config'], stranger, null, deps);
  assert.equal(JSON.parse(cfg?.body ?? '{}').allowed, false);
  const saved = await autoBuyRoute(db as never, 'PUT', ['auto-buy', 'x:1'], me, { ...good, wallet: 'Someone222' }, deps);
  assert.equal(saved?.status, 200);
  const insert = calls.find((c) => c.sql.includes('insert into people.auto_buy'));
  assert.equal(insert?.params[2], 'OwnerWallet111');
});

test('the fee estimate is the base fee plus the priority fee over the buy\'s compute units', () => {
  assert.equal(feeLamports(P, 'normal'), 5_000 + 25_000);
  assert.equal(feeLamports(P, 'fast'), 5_000 + 250_000);
  assert.equal(feeLamports(P, 'turbo'), 5_000 + 1_250_000);
});
