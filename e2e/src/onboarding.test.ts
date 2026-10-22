/**
 * SIGN-UP AGAINST THE REAL SCHEMA (0123, services/social onboarding.ts): a username picked and kept
 * whatever the sign-in says later, a taken name answered with free ones, the end of sign-up with a
 * member number, and the members from before sign-up left where they are — driven through the
 * social routes with a stand-in sign-in.
 */

import { strict as assert } from 'node:assert';
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import { forgetKept, handle, type Db } from '@insidor/social';
import { migrate } from '@insidor/store';

import { dbOf, migratedDb } from './db.ts';

const person = (n: number | string, handle: string | null = null, name: string | null = null, pictureUrl: string | null = null): Person => ({ userId: `did:privy:${n}`, handle, name, pictureUrl, wallets: [] });

type Call = (method: string, url: string, body?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;

/** A stand-in for our storage: keeps what it was given, refuses what is not a JPEG by its first bytes. */
class Refused extends Error {}
const photoStore = () => {
  const kept = new Map<string, Uint8Array>();
  return {
    kept,
    put: async (file: string, bytes: Uint8Array) => {
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Refused('not a photo');
      kept.set(file, bytes);
    },
    urlOf: (file: string) => `https://storage.test/member-pics/${file}`,
    refused: (e: unknown) => e instanceof Refused,
  };
};

function routesOver(db: Db, photos: ReturnType<typeof photoStore> | null = null) {
  const people = new Map<string, Person>();
  const deps = {
    photos,
    db,
    identity: { verify: async (token: string) => people.get(token) ?? null },
    chain: null,
    policy: DEFAULT_POLICY.social,
    owner: { wallets: [], xHandles: [] },
    invites: DEFAULT_POLICY.invites,
    now: () => Date.UTC(2026, 9, 22, 12),
    pace: () => true,
  };
  /* Each call is a fresh sign-in: the profile is brought up to date from the token every time, as after five minutes. */
  const as = (p: Person): Call => {
    people.set(p.userId, p);
    return async (method, url, body = null) => {
      forgetKept();
      const r = await handle({ method, url, body, token: p.userId, client: 'test' }, deps);
      return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
    };
  };
  return { db, as };
}

const letIn = async (db: Db, p: Person) => {
  await db.query('insert into people.profile (user_id) values ($1) on conflict do nothing', [p.userId]);
  await db.query(`insert into people.member_access (user_id, via) values ($1, 'code') on conflict do nothing`, [p.userId]);
};

beforeEach(() => forgetKept());

test('★ an email sign-up: no username, picks one, keeps it, finishes with a number and three invites', async () => {
  const db = (await migratedDb()) as unknown as Db;
  const { as } = routesOver(db);
  const me = person('mail');
  const start = await as(me)('GET', '/onboarding');
  assert.equal(start.body['handle'], null);
  assert.equal(start.body['done'], false);
  assert.equal(start.body['memberNo'], null, 'no number before access');
  assert.equal(start.body['invitesLeft'], null);
  assert.equal((await as(me)('PUT', '/username', { username: 'hawa' })).status, 403, 'a name is taken only once in');

  await letIn(db, me);
  assert.deepEqual((await as(me)('GET', '/username/@Hawa')).body, { name: 'hawa', state: 'free', problem: null, suggestions: [] });
  const picked = await as(me)('PUT', '/username', { username: '@Hawa' });
  assert.equal(picked.status, 200);
  assert.equal(picked.body['handle'], 'hawa');
  assert.equal(picked.body['handleChosen'], true);
  assert.equal((await as(me)('GET', '/username/hawa')).body['state'], 'yours');

  const done = await as(me)('POST', '/onboarding/done');
  assert.equal(done.body['done'], true);
  assert.equal(done.body['memberNo'], 1);
  assert.equal(done.body['invitesLeft'], DEFAULT_POLICY.invites.perMember);
  assert.equal((await as(me)('POST', '/onboarding/done')).body['memberNo'], 1, 'the same number every time');
});

test('★ a taken or reserved name is refused with free ones near it', async () => {
  const db = (await migratedDb()) as unknown as Db;
  const { as } = routesOver(db);
  const first = person(1);
  const second = person(2, null, 'Hawa Hassan');
  await letIn(db, first);
  await letIn(db, second);
  await as(first)('GET', '/onboarding');
  assert.equal((await as(first)('PUT', '/username', { username: 'hawa' })).status, 200);

  const check = await as(second)('GET', '/username/hawa');
  assert.equal(check.body['state'], 'taken');
  assert.deepEqual((check.body['suggestions'] as string[]).slice(0, 2), ['hawa_', 'hawabuilds']);
  const refused = await as(second)('PUT', '/username', { username: 'HAWA' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body['state'], 'taken');

  const reserved = await as(second)('GET', '/username/support');
  assert.equal(reserved.body['state'], 'invalid');
  assert.equal(reserved.body['problem'], "That name isn't available.");
  assert.ok((reserved.body['suggestions'] as string[]).length > 0);
  assert.equal((await as(second)('PUT', '/username', { username: 'ab' })).status, 400);
});

test('★ a chosen username survives every later sign-in, and an X sign-in cannot take it', async () => {
  const db = (await migratedDb()) as unknown as Db;
  const { as } = routesOver(db);
  const viaX = person('x', 'HawaOnX', 'Hawa', 'https://pbs.twimg.com/profile_images/1/a.jpg');
  await letIn(db, viaX);
  const status = await as(viaX)('GET', '/onboarding');
  assert.equal(status.body['start'], 'hawaonx', 'an X sign-up starts the box with the X handle');
  assert.equal(status.body['pictureUrl'], 'https://pbs.twimg.com/profile_images/1/a.jpg');
  assert.equal((await as(viaX)('PUT', '/username', { username: 'hawa' })).status, 200);
  assert.equal((await as(viaX)('GET', '/onboarding')).body['handle'], 'hawa', 'the next sign-in leaves the chosen name');

  /* Someone else's X account is called "hawa": they do not get it. */
  const other = person('other', 'hawa');
  const theirs = await as(other)('GET', '/onboarding');
  assert.equal(theirs.body['handle'], null);
  assert.equal(theirs.body['start'], null, 'their X handle is held, so the box starts empty');
  assert.equal((await as(viaX)('GET', '/onboarding')).body['handle'], 'hawa');
});

test('★ members from before sign-up are done, numbered by when they got in, and keep their handle', async () => {
  const all = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'store', 'migrations');
  const before = await mkdtemp(join(tmpdir(), 'insidor-0122-'));
  for (const f of await readdir(all)) if (/^\d{4}_.*\.sql$/.test(f) && f < '0123') await copyFile(join(all, f), join(before, f));
  const pg = await PGlite.create({ extensions: { vector } });
  const raw = dbOf(pg);
  await migrate(raw, (fn) => pg.transaction((tx) => fn(dbOf(tx))), before);
  await raw.query(`insert into people.profile (user_id, handle, created_at) values ('did:privy:a', 'alpha', now() - interval '2 days'), ('did:privy:b', 'beta', now() - interval '1 day'), ('did:privy:w', 'waiting', now())`);
  await raw.query(`insert into people.member_access (user_id, via, granted_at) values ('did:privy:b', 'before_invites', now() - interval '3 days'), ('did:privy:a', 'code', now() - interval '1 hour')`);
  await migrate(raw, (fn) => pg.transaction((tx) => fn(dbOf(tx))), all);
  const { as } = routesOver(raw as unknown as Db);

  const b = await as(person('b', 'beta'))('GET', '/onboarding');
  assert.deepEqual([b.body['done'], b.body['memberNo'], b.body['handleChosen']], [true, 1, true], 'first in, number 1');
  const a = await as(person('a', 'alpha'))('GET', '/onboarding');
  assert.deepEqual([a.body['done'], a.body['memberNo']], [true, 2]);
  const w = await as(person('w', 'waiting'))('GET', '/onboarding');
  assert.deepEqual([w.body['done'], w.body['memberNo']], [false, null], 'the waitlist signs up when let in');

  await letIn(raw as unknown as Db, person('w'));
  assert.equal((await as(person('w', 'waiting'))('POST', '/onboarding/done')).body['memberNo'], 3, 'the next number, after the backfill');
});

test('★ a photo is kept in our storage, becomes the picture, and no later X sign-in replaces it', async () => {
  const db = (await migratedDb()) as unknown as Db;
  const photos = photoStore();
  const { as } = routesOver(db, photos);
  const me = person('pic', 'hawaonx', 'Hawa', 'https://pbs.twimg.com/profile_images/1/a.jpg');
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64')}`;
  assert.equal((await as(me)('POST', '/onboarding/picture', { image: jpeg })).status, 403, 'members only');
  await letIn(db, me);
  const saved = await as(me)('POST', '/onboarding/picture', { image: jpeg });
  assert.equal(saved.status, 200);
  assert.match(String(saved.body['pictureUrl']), /^https:\/\/storage\.test\/member-pics\/[0-9a-f]{32}$/);
  assert.equal(photos.kept.size, 1);
  const after = await as(me)('GET', '/onboarding');
  assert.equal(after.body['pictureUrl'], saved.body['pictureUrl'], 'the X picture on the next sign-in does not replace it');
  assert.equal(after.body['pictureChosen'], true);

  const gif = `data:image/jpeg;base64,${Buffer.from('GIF89a').toString('base64')}`;
  assert.equal((await as(me)('POST', '/onboarding/picture', { image: gif })).status, 400, 'bytes that are not a photo, whatever the type said');
  assert.equal((await as(me)('POST', '/onboarding/picture', { image: 'not a picture' })).status, 400);
  assert.equal((await routesOver(db).as(me)('POST', '/onboarding/picture', { image: jpeg })).status, 503, 'no storage: said, never faked');
});
