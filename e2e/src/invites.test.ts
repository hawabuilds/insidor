/**
 * INVITE-ONLY ACCESS AGAINST THE REAL SCHEMA (0120, services/social invites.ts): codes spent in the
 * database, one person one code, partner caps, the waitlist's places, and the owner's controls,
 * driven through the social routes with a stand-in sign-in.
 *
 * PGlite is one connection, so "at once" here is many requests in flight that the database takes
 * in turn; the lock in people.redeem_invite is what makes the same true on a pooled Postgres, and
 * these tests hold what it must decide either way: never more uses than the code allows.
 */

import { strict as assert } from 'node:assert';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import { forgetKept, handle, type Db } from '@insidor/social';
import { migrate } from '@insidor/store';

import { dbOf, migratedDb } from './db.ts';

const P = DEFAULT_POLICY.social;
const OWNER_HANDLE = 'boss';
const person = (n: number | string, handle: string | null = `user${n}`): Person => ({ userId: `did:privy:${n}`, handle, name: `User ${n}`, pictureUrl: null, wallets: [] });
const OWNER = person('owner', OWNER_HANDLE);

type Call = (method: string, url: string, body?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;

function routesOver(db: Db) {
  const people = new Map<string, Person>();
  const deps = {
    db,
    identity: { verify: async (token: string) => people.get(token) ?? null },
    chain: null,
    policy: P,
    owner: { wallets: [], xHandles: [OWNER_HANDLE] },
    invites: DEFAULT_POLICY.invites,
    now: () => Date.UTC(2026, 9, 21, 12),
    pace: () => true,
  };
  const as = (p: Person | null): Call => {
    if (p !== null) people.set(p.userId, p);
    return async (method, url, body = null) => {
      const r = await handle({ method, url, body, token: p?.userId ?? null, client: 'test' }, deps);
      return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
    };
  };
  return { db, as };
}

const setup = async () => routesOver((await migratedDb()) as unknown as Db);

/** A member with their codes made. */
async function memberWithCodes(as: (p: Person) => Call, db: Db, p: Person): Promise<string[]> {
  await as(p)('POST', '/me');
  await db.query(`insert into people.member_access (user_id, via) values ($1, 'code') on conflict do nothing`, [p.userId]);
  const mine = await as(p)('GET', '/invites/mine');
  assert.equal(mine.status, 200);
  return (mine.body['codes'] as { code: string }[]).map((c) => c.code);
}

beforeEach(() => forgetKept());

test('★ everyone signed in before invites keeps access; someone new does not', async () => {
  /* The migrations up to 0119, a profile, then 0120: the profile is let in by the migration itself. */
  const all = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'store', 'migrations');
  const before = await mkdtemp(join(tmpdir(), 'insidor-0119-'));
  for (const f of await readdir(all)) if (/^\d{4}_.*\.sql$/.test(f) && f < '0120') await copyFile(join(all, f), join(before, f));
  const pg = await PGlite.create({ extensions: { vector, pg_trgm } });
  /* Supabase keeps extensions in their own schema; 0160 installs pg_trgm there. */
  await pg.exec('create schema if not exists extensions');
  const raw = dbOf(pg);
  await migrate(raw, (fn) => pg.transaction((tx) => fn(dbOf(tx))), before);
  await raw.query(`insert into people.profile (user_id, handle) values ('did:privy:old', 'old')`);
  await migrate(raw, (fn) => pg.transaction((tx) => fn(dbOf(tx))), all);
  const { as } = routesOver(raw as unknown as Db);
  assert.deepEqual((await as(person('old', 'old'))('GET', '/access')).body, { access: true, waitlist: null });
  assert.deepEqual((await as(person('new'))('GET', '/access')).body, { access: false, waitlist: null });
});

test('★ every member holds three single-use codes; a code lets exactly one person in', async () => {
  const { as, db } = await setup();
  const inviter = person(1);
  const codes = await memberWithCodes(as, db, inviter);
  assert.equal(codes.length, DEFAULT_POLICY.invites.perMember);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.deepEqual(await memberWithCodes(as, db, inviter), codes, 'asking again makes no more');

  const code = codes[0]!;
  const checked = await as(null)('GET', `/invites/code/${code.toLowerCase()}`);
  assert.equal(checked.body['state'], 'valid', 'checked before sign-in, typed in lower case');
  assert.equal((checked.body['from'] as { handle: string }).handle, 'user1');

  const a = person(2);
  await as(a)('POST', '/me');
  assert.deepEqual((await as(a)('POST', '/invites/redeem', { code })).body, { access: true, result: 'joined' });
  assert.equal((await as(a)('GET', '/access')).body['access'], true);
  assert.equal((await as(a)('POST', '/invites/redeem', { code: codes[1] })).body['result'], 'member', 'already in: nothing spent');

  const b = person(3);
  await as(b)('POST', '/me');
  const refused = await as(b)('POST', '/invites/redeem', { code });
  assert.equal(refused.status, 409);
  assert.equal(refused.body['state'], 'used_up');
  assert.equal((await as(b)('GET', '/access')).body['access'], false);
  assert.equal((await as(null)('GET', `/invites/code/${code}`)).body['state'], 'used_up');
  assert.equal((await as(b)('POST', '/invites/redeem', { code: 'NOSUCHCODE' })).body['state'], 'unknown');

  const mine = await as(inviter)('GET', '/invites/mine');
  assert.deepEqual((mine.body['joined'] as { handle: string }[]).map((j) => j.handle), ['user2'], 'who joined with my codes');
  assert.deepEqual((mine.body['codes'] as { code: string; used: boolean }[]).map((c) => c.used), [false, false, true], 'unused first');
  const [spent] = await db.query<{ uses: number }>('select uses from people.invite_code where code = $1', [codes[1]]);
  assert.equal(spent?.uses, 0);
});

test('★ ten people racing for one single-use code: one gets in', async () => {
  const { as, db } = await setup();
  const [code] = await memberWithCodes(as, db, person(1));
  const racers = Array.from({ length: 10 }, (_, i) => person(100 + i));
  for (const r of racers) await as(r)('POST', '/me');
  const results = await Promise.all(racers.map((r) => as(r)('POST', '/invites/redeem', { code })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.body['state'] === 'used_up').length, 9);
  const [n] = await db.query<{ uses: number; redeemed: number }>('select uses, (select count(*)::int from people.invite_redemption where code = $1) as redeemed from people.invite_code where code = $1', [code]);
  assert.deepEqual(n, { uses: 1, redeemed: 1 });
});

test('★ one person racing two codes spends one', async () => {
  const { as, db } = await setup();
  const codes = await memberWithCodes(as, db, person(1));
  const me = person(2);
  await as(me)('POST', '/me');
  const results = await Promise.all([as(me)('POST', '/invites/redeem', { code: codes[0] }), as(me)('POST', '/invites/redeem', { code: codes[1] })]);
  assert.deepEqual(results.map((r) => r.body['result']).sort(), ['joined', 'member']);
  const [n] = await db.query<{ used: number }>(`select coalesce(sum(uses), 0)::int as used from people.invite_code`);
  assert.equal(n?.used, 1);
});

test('★ a partner code works up to its cap and shows the partner on the door', async () => {
  const { as, db } = await setup();
  await as(OWNER)('POST', '/me');
  assert.equal((await as(person(9))('POST', '/owner/invites', { action: 'partner', code: 'X', label: 'Y' })).status, 403, 'the owner only');
  const made = await as(OWNER)('POST', '/owner/invites', { action: 'partner', code: 'superteam-uk', label: 'Superteam UK', maxUses: 3 });
  assert.equal(made.status, 201);
  assert.equal(made.body['code'], 'SUPERTEAMUK');
  assert.equal((await as(OWNER)('POST', '/owner/invites', { action: 'partner', code: 'SUPERTEAMUK', label: 'Again' })).status, 409, 'a code is made once');
  assert.deepEqual((await as(null)('GET', '/invites/code/SuperteamUK')).body['from'], { kind: 'partner', label: 'Superteam UK' });

  const joiners = Array.from({ length: 5 }, (_, i) => person(200 + i));
  for (const j of joiners) await as(j)('POST', '/me');
  const results = await Promise.all(joiners.map((j) => as(j)('POST', '/invites/redeem', { code: 'superteamuk' })));
  assert.equal(results.filter((r) => r.status === 200).length, 3, 'three uses, three people');
  const [c] = await db.query<{ uses: number }>(`select uses from people.invite_code where code = 'SUPERTEAMUK'`);
  assert.equal(c?.uses, 3);
  assert.equal((await as(null)('GET', '/invites/code/SUPERTEAMUK')).body['state'], 'used_up');

  const stats = (await as(OWNER)('GET', '/owner/invites')).body;
  assert.deepEqual(stats['partners'], [{ code: 'SUPERTEAMUK', label: 'Superteam UK', uses: 3, maxUses: 3, createdAt: (stats['partners'] as { createdAt: number }[])[0]!.createdAt }]);
  assert.equal(stats['joinedWithCode'], 3);
});

test('★ the waitlist keeps places in order; the owner lets the next in and gives everyone more codes', async () => {
  const { as, db } = await setup();
  await as(OWNER)('POST', '/me');
  const waiting = [person(31), person(32), person(33)];
  for (const w of waiting) {
    await as(w)('POST', '/me');
    await as(w)('POST', '/waitlist');
  }
  assert.deepEqual(((await as(waiting[2]!)('GET', '/access')).body['waitlist'] as { position: number }).position, 3);
  assert.equal(((await as(waiting[0]!)('POST', '/waitlist')).body['waitlist'] as { position: number }).position, 1, 'asking twice keeps the first place');

  /* The second brings a code: the third moves up. */
  const [code] = await memberWithCodes(as, db, person(1));
  await as(waiting[1]!)('POST', '/invites/redeem', { code });
  assert.equal(((await as(waiting[2]!)('GET', '/access')).body['waitlist'] as { position: number }).position, 2);

  assert.equal((await as(waiting[0]!)('POST', '/owner/invites', { action: 'let_in', count: 1 })).status, 403);
  const let1 = await as(OWNER)('POST', '/owner/invites', { action: 'let_in', count: 1 });
  assert.equal(let1.body['letIn'], 1);
  assert.equal((await as(waiting[0]!)('GET', '/access')).body['access'], true, 'the longest waiting first');
  assert.equal((await as(waiting[2]!)('GET', '/access')).body['access'], false);
  assert.equal(((await as(waiting[2]!)('GET', '/access')).body['waitlist'] as { position: number }).position, 1);
  assert.equal((await as(OWNER)('POST', '/owner/invites', { action: 'let_in', count: DEFAULT_POLICY.invites.maxLetIn + 1 })).status, 400);

  const before = (await as(waiting[0]!)('GET', '/invites/mine')).body['codes'] as unknown[];
  assert.equal(before.length, DEFAULT_POLICY.invites.perMember);
  await as(OWNER)('POST', '/owner/invites', { action: 'give', count: 2 });
  const after = (await as(waiting[0]!)('GET', '/invites/mine')).body['codes'] as unknown[];
  assert.equal(after.length, DEFAULT_POLICY.invites.perMember + 2);

  const stats = (await as(OWNER)('GET', '/owner/invites')).body;
  assert.equal(stats['waiting'], 1);
  assert.equal(stats['letInFromWaitlist'], 1);
  assert.deepEqual((stats['topInviters'] as { handle: string; joined: number }[]).map((t) => [t.handle, t.joined]), [['user1', 1]]);
});

test('the owner is always in; signed out, only the code check answers', async () => {
  const { as } = await setup();
  assert.equal((await as(OWNER)('GET', '/access')).body['access'], true);
  assert.equal((await as(null)('GET', '/access')).status, 401);
  assert.equal((await as(null)('POST', '/waitlist')).status, 401);
  assert.equal((await as(null)('GET', '/invites/mine')).status, 401);
  assert.equal((await as(person(5))('GET', '/invites/mine')).status, 403, 'codes are for members');
});
