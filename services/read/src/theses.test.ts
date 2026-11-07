/**
 * fomo's theses: what is kept from fomo's reply, and that every way of not having them is a reason,
 * never an empty list. The reply below has fomo's shape as its feed sent it on 2026-11-06, with the
 * traders, ids and words made up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { createTheses, decodeTheses, fomoCoinUrl } from './theses.ts';

const ADDR = '7SL2VnfYsChvog5oQY9Nmtqu1wceaMiQzWoqoLQpump';

const item = (id: string, at: string, handle: string, text: string, extra: Record<string, unknown> = {}) => ({
  type: 'thesis',
  id,
  createdAt: at,
  displayName: `${handle} name`,
  userHandle: handle,
  profilePictureLink: 'https://prod-fomo-profile-pics.s3.amazonaws.com/abc_small.jpg?k=1',
  comment: { id, comment: text, marketCapAtCreation: 1_420_275.11, createdAt: at, numLikes: 2, reactions: { counts: { likeCount: 2 } } },
  authorTrade: { usdValue: 1190.95, unrealizedPnlUsd: -137.797, percentageUnrealizedPnl: -10.37, closedAt: null },
  ...extra,
});

const REPLY = {
  success: true,
  responseObject: {
    items: [
      item('t-2', '2026-11-06T22:29:35.112Z', 'traderb', 'there is no way we cannot hold 1.4M'),
      item('t-1', '2026-11-06T22:02:32.611Z', 'tradera', 'we send higher', { profilePictureLink: null, authorTrade: null }),
      { type: 'repost', id: 'r-1', createdAt: '2026-11-06T22:10:00Z', userHandle: 'x', comment: { comment: 'not a thesis' } },
      item('t-3', 'not a time', 'traderc', 'broken'),
    ],
  },
};

test('★ a thesis keeps who, when, the words, the cap then and the position as fomo reports it, oldest first', () => {
  const out = decodeTheses(REPLY, ADDR);
  assert.deepEqual(out.map((t) => t.id), ['t-1', 't-2'], 'not a thesis and an unreadable time are left out');
  assert.deepEqual(out[1], {
    id: 't-2', at: Date.parse('2026-11-06T22:29:35.112Z'), handle: 'traderb', name: 'traderb name',
    pictureUrl: 'https://prod-fomo-profile-pics.s3.amazonaws.com/abc_small.jpg?k=1', text: 'there is no way we cannot hold 1.4M',
    marketCapUsd: 1_420_275.11, likes: 2, position: { valueUsd: 1190.95, pnlUsd: -137.797, pnlPct: -10.37, closed: false }, url: fomoCoinUrl(ADDR),
  });
  assert.equal(out[0]?.pictureUrl, null);
  assert.equal(out[0]?.position, null, 'no trade sent: no position, never a zero one');
});

type Login = { readonly cookie: string } | { readonly cookie: null; readonly why: 'not_configured' | 'login_expired' | 'unavailable' };
const deps = (fetchImpl: typeof globalThis.fetch, login: Login = { cookie: 'privy-token=abc' }, proxyUrl: string | null = null) => {
  let t = 1_000_000;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  }) as typeof globalThis.fetch;
  return { calls, tick: (ms: number) => (t += ms), get: createTheses({ cookie: async () => login, proxyUrl, appHeaders: { 'app-build': 'test' }, fetch: f, now: () => t, log: SILENT, keepMs: 120_000, perMinute: 2 }) };
};
const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;

test('★ every way of not having them is a reason: no login, fomo refused, fomo down', async () => {
  assert.deepEqual(await deps(ok(REPLY), { cookie: null, why: 'not_configured' }).get(ADDR), { theses: null, why: 'not_configured' });
  assert.deepEqual(await deps(ok(REPLY), { cookie: null, why: 'login_expired' }).get(ADDR), { theses: null, why: 'login_expired' });
  assert.deepEqual(await deps(ok({}, 401)).get(ADDR), { theses: null, why: 'login_expired' });
  assert.deepEqual(await deps(ok({}, 500)).get(ADDR), { theses: null, why: 'unavailable' });
  assert.deepEqual(await deps(ok({ success: false })).get(ADDR), { theses: null, why: 'unavailable' });
  assert.deepEqual(await deps((async () => { throw new Error('down'); }) as never).get(ADDR), { theses: null, why: 'unavailable' });
});

test('no login means fomo is never called', async () => {
  const d = deps(ok(REPLY), { cookie: null, why: 'not_configured' });
  await d.get(ADDR);
  assert.equal(d.calls.length, 0);
});

test('★ with an upstream, it is asked for the coin by mint with no fomo login, and its fomo JSON is read as usual', async () => {
  const d = deps(ok(REPLY), { cookie: null, why: 'not_configured' }, 'https://theses.example/fomo');
  assert.equal(((await d.get(ADDR)) as { theses: readonly unknown[] }).theses.length, 2);
  assert.equal(d.calls[0]?.url, `https://theses.example/fomo?mint=${ADDR}`);
  assert.equal((d.calls[0]?.init?.headers as Record<string, string>)['cookie'], undefined, 'no fomo login goes to the upstream');
  assert.deepEqual(await deps(ok({}, 502), { cookie: 'x' }, 'https://theses.example/fomo').get(ADDR), { theses: null, why: 'unavailable' });
});

test('one coin is asked once while kept; the minute cap answers from what is kept, or busy', async () => {
  const d = deps(ok(REPLY));
  assert.equal(((await d.get(ADDR)) as { theses: readonly unknown[] }).theses.length, 2);
  await d.get(ADDR);
  assert.equal(d.calls.length, 1, 'kept');
  assert.match(d.calls[0]?.url ?? '', /tokenAddress=7SL2Vnf.*networkId=1399811149/);
  assert.equal((d.calls[0]?.init?.headers as Record<string, string>)['cookie'], 'privy-token=abc', 'the owner\'s login is sent to fomo');
  assert.equal((d.calls[0]?.init?.headers as Record<string, string>)['app-build'], 'test', 'and fomo\'s own app headers');
  await d.get('So11111111111111111111111111111111111111112');
  assert.deepEqual(await d.get('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'), { theses: null, why: 'busy' }, 'two calls a minute in this test');
  d.tick(61_000);
  assert.notEqual((await d.get('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')).theses, null, 'a minute later it asks');
});
