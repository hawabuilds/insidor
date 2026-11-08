/**
 * fomo theses (theses.ts): the two-speed read (newest page every 15 minutes, four pages of history
 * every 2 hours) merged into one list, positions read from the thesis row, and failures turned into
 * reasons without losing what was already read. Against a fake fetch; no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTheses, decodeThesesResponse, mergeTheses } from './theses.ts';
import { SILENT } from './log.ts';

const MINT = 'BQn2Wz514RzRoMSg32wAa8YZa4xDvNSzh127SmYYpump';
const MIN = 60_000;

const row = (id: string, minsAgo: number, extra: Record<string, unknown> = {}) => ({
  id, ts: new Date(1_800_000_000_000 - minsAgo * MIN).toISOString(), handle: `h${id}`, text: 'up only', equity: 0, tradeUsd: 500, realizedPnlUsd: 0, unrealizedPnlUsd: 100, ...extra,
});

function harness(answer: (pages: number) => { status: number; body: unknown }) {
  let now = 1_800_000_000_000;
  const pagesAsked: number[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const pages = Number(new URL(String(input)).searchParams.get('pages'));
    pagesAsked.push(pages);
    const a = answer(pages);
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as typeof globalThis.fetch;
  const theses = createTheses({ apiKey: 'k', fetch, now: () => now, log: SILENT, recentKeepMs: 15 * MIN, historyKeepMs: 120 * MIN, perMinute: 20 });
  return { theses, pagesAsked, advance: (ms: number) => { now += ms; } };
}

test('first view reads four pages; the newest page alone every 15 minutes; history again after 2 hours', async () => {
  const h = harness((pages) => ({ status: 200, body: { theses: pages === 4 ? [row('old', 600), row('a', 5)] : [row('a', 5), row('new', 1)] } }));
  const first = await h.theses(MINT, 250);
  assert.deepEqual(first.theses?.map((t) => t.id), ['old', 'a']);
  h.advance(10 * MIN);
  await h.theses(MINT, 250);
  assert.deepEqual(h.pagesAsked, [4]);
  h.advance(6 * MIN);
  const merged = await h.theses(MINT, 250);
  assert.deepEqual(h.pagesAsked, [4, 1]);
  assert.deepEqual(merged.theses?.map((t) => t.id), ['old', 'a', 'new']);
  h.advance(105 * MIN);
  await h.theses(MINT, 250);
  assert.deepEqual(h.pagesAsked, [4, 1, 4]);
});

test('per hour of steady viewing, about 6 pages are read: what one page every 10 minutes cost', async () => {
  const h = harness(() => ({ status: 200, body: { theses: [row('a', 5)] } }));
  for (let m = 0; m < 240; m += 1) { await h.theses(MINT, 250); h.advance(MIN); }
  const pages = h.pagesAsked.reduce((a, b) => a + b, 0);
  assert.ok(pages <= 4 * 6, `read ${pages} pages in 4 hours`);
});

test('the same thesis in both reads keeps the newer read, so its profit is the fresher one', () => {
  const old = decodeThesesResponse({ theses: [row('a', 5, { unrealizedPnlUsd: 10 })] }, MINT);
  const fresh = decodeThesesResponse({ theses: [row('a', 5, { unrealizedPnlUsd: 99 })] }, MINT);
  assert.equal(mergeTheses(old, fresh)[0]?.position?.pnlUsd, 99);
});

test('a failed refresh keeps what was already read; with nothing read, the reason is the answer', async () => {
  let up = true;
  const h = harness(() => (up ? { status: 200, body: { theses: [row('a', 5)] } } : { status: 503, body: {} }));
  assert.equal((await h.theses(MINT, 250)).theses?.length, 1);
  up = false;
  h.advance(16 * MIN);
  assert.equal((await h.theses(MINT, 250)).theses?.length, 1);
  const other = await h.theses('So11111111111111111111111111111111111111112', 250);
  assert.deepEqual(other, { theses: null, why: 'upstream_error' });
});

test('a refusing coin is not asked again on every view', async () => {
  const h = harness(() => ({ status: 503, body: {} }));
  await h.theses(MINT, 250);
  h.advance(MIN);
  await h.theses(MINT, 250);
  assert.equal(h.pagesAsked.length, 1);
});
