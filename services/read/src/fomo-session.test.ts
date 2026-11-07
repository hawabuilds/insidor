/**
 * The fomo login keeps itself fresh: it renews before the access token expires, rotates the refresh
 * token, asks Privy only when it must, and turns every failure into a typed reason. No real secret
 * is used — the tokens below are shaped like Privy's but made up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { createFomoSession, jwtExpiryMs, readFomoSessionConfig, type FomoSessionConfig } from './fomo-session.ts';

/** A JWT whose payload has this `exp` (seconds). Header and signature are filler; nothing verifies them. */
const jwtWithExp = (expSec: number): string => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ aud: 'app', exp: expSec })}.sig`;
};

const cfg = (refreshToken: string | null): FomoSessionConfig => ({ refreshToken, appId: 'app', privyUrl: 'https://privy/sessions', origin: 'https://fomo.family' });

test('jwtExpiryMs reads exp in ms, or null when there is none', () => {
  assert.equal(jwtExpiryMs(jwtWithExp(1_700_000_000)), 1_700_000_000_000);
  assert.equal(jwtExpiryMs('not.a.jwt'), null);
  assert.equal(jwtExpiryMs('one-part'), null);
});

test('no refresh token: not configured, and Privy is never called', async () => {
  let called = 0;
  const s = createFomoSession({ cfg: cfg(null), fetch: (async () => { called += 1; return new Response('{}'); }) as never, now: () => 0, log: SILENT });
  assert.deepEqual(await s.cookie(), { cookie: null, why: 'not_configured' });
  assert.equal(called, 0);
});

test('★ renews before expiry, sends the access token as a privy-token cookie, and rotates the refresh token', async () => {
  let now = 1_000_000;
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    const n = bodies.length;
    return new Response(JSON.stringify({ token: jwtWithExp(Math.floor(now / 1000) + 3600), refresh_token: `refresh-${n}` }));
  }) as unknown as typeof globalThis.fetch;
  const s = createFomoSession({ cfg: cfg('refresh-0'), fetch: fetchImpl, now: () => now, log: SILENT });

  const first = await s.cookie();
  assert.equal('cookie' in first && first.cookie?.startsWith('privy-token='), true);
  assert.match((first as { cookie: string }).cookie, /privy-session=privy\.fomo\.family/);
  assert.equal(JSON.parse(bodies[0] ?? '{}').refresh_token, 'refresh-0', 'the env refresh token is used first');

  await s.cookie();
  assert.equal(bodies.length, 1, 'still fresh: no second call to Privy');

  now += 3_600_000; // past the renew-before window
  await s.cookie();
  assert.equal(bodies.length, 2, 'renewed near expiry');
  assert.equal(JSON.parse(bodies[1] ?? '{}').refresh_token, 'refresh-1', 'the rotated refresh token is used next');
});

test('a refused refresh is login_expired; Privy down or an unreadable reply is unavailable', async () => {
  const at = (status: number, body: unknown) => createFomoSession({ cfg: cfg('r'), fetch: (async () => new Response(JSON.stringify(body), { status })) as never, now: () => 0, log: SILENT });
  assert.deepEqual(await at(401, {}).cookie(), { cookie: null, why: 'login_expired' });
  assert.deepEqual(await at(403, {}).cookie(), { cookie: null, why: 'login_expired' });
  assert.deepEqual(await at(500, {}).cookie(), { cookie: null, why: 'unavailable' });
  assert.deepEqual(await at(200, { nothing: 'useful' }).cookie(), { cookie: null, why: 'unavailable' });
  const thrown = createFomoSession({ cfg: cfg('r'), fetch: (async () => { throw new Error('down'); }) as never, now: () => 0, log: SILENT });
  assert.deepEqual(await thrown.cookie(), { cookie: null, why: 'unavailable' });
});

test('the config reads the env, with fomo\'s Privy app id as the default', () => {
  assert.deepEqual(readFomoSessionConfig({ FOMO_REFRESH_TOKEN: ' tok ' }), { refreshToken: 'tok', appId: 'cm6h485o300n3zj9yl6vpedq7', privyUrl: 'https://auth.privy.io/api/v1/sessions', origin: 'https://fomo.family' });
  assert.equal(readFomoSessionConfig({}).refreshToken, null);
  assert.equal(readFomoSessionConfig({ FOMO_REFRESH_TOKEN: 'x', FOMO_PRIVY_APP_ID: 'other' }).appId, 'other');
});
