/**
 * The infinite scroll's page (feed-page.ts): the cursor, the market numbers dashed on an old card,
 * and the route's answers — a page, a 400 for a cursor we cannot read, a 404 before 0075.
 * Against a fake query function; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { FEED_PAGE_SIZE, FEED_PAGE_SQL, FIRST_PAGE, cursorText, feedPage, parseCursor, withCurrentMarket } from './feed-page.ts';
import type { Row } from './queries.ts';
import { handle, type Deps } from './routes.ts';

const coin = { address: 'A', ticker: 'X', priceUsd: { v: 1 }, marketCapUsd: { v: 5000 }, liquidityUsd: { v: 10 }, priceChange24h: { v: 3 }, marketCapBasis: 'supply' };
const card = (id: string) => ({ id, excerpt: 'hi', coins: { kind: 'matched', coin, evidence: {} } });

test('a cursor reads back as written, an empty one is the first page, and junk is refused', () => {
  assert.deepEqual(parseCursor(cursorText({ atMs: 1_760_000_000_123, id: 'x:9~9' })), { atMs: 1_760_000_000_123, id: 'x:9~9' });
  assert.deepEqual(parseCursor(null), FIRST_PAGE);
  assert.equal(parseCursor('abc'), null);
  assert.equal(parseCursor('12~'), null);
});

test('a card projected longer ago than the bar has its coin market dashed, nothing else', () => {
  const old = withCurrentMarket(card('x:1'), 0, 10 * 60_000, 8 * 60_000) as { coins: { coin: Record<string, unknown> }; excerpt: string };
  assert.deepEqual(old.coins.coin['marketCapUsd'], { v: null, why: 'not_read_yet' });
  assert.equal(old.coins.coin['marketCapBasis'], null);
  assert.equal(old.coins.coin['ticker'], 'X');
  assert.equal(old.excerpt, 'hi');
  const fresh = withCurrentMarket(card('x:1'), 5 * 60_000, 10 * 60_000, 8 * 60_000);
  assert.deepEqual(fresh, card('x:1'));
});

test('a full page carries the next cursor, a short one ends the scroll', () => {
  const at = new Date(1_760_000_000_000);
  const rows: Row[] = Array.from({ length: FEED_PAGE_SIZE }, (_, i) => ({ payload: card(`x:${i}`), item_id: `x:${i}`, first_shown_at: at, payload_at: at }));
  assert.equal(feedPage(rows, at.getTime()).next, `1760000000000~x:${FEED_PAGE_SIZE - 1}`);
  assert.equal(feedPage(rows.slice(0, 3), at.getTime()).next, null);
});

function deps(query: (sql: string, params: readonly unknown[]) => Promise<readonly Row[]>): Deps {
  return { log: SILENT, db: { query } };
}

test('the route reads one page with the cursor as parameters', async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const reply = await handle('GET', `/rising/fyp/older?before=${encodeURIComponent('1760000000000~x:1')}`, deps(async (sql, params) => {
    calls.push({ sql, params });
    return [];
  }));
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body), { posts: [], next: null });
  assert.equal(calls[0]?.sql, FEED_PAGE_SQL);
  assert.deepEqual(calls[0]?.params, ['fyp', new Date(1_760_000_000_000).toISOString(), 'x:1', FEED_PAGE_SIZE]);
});

test('a bad cursor is a 400, an unknown feed and a database without the table are 404s', async () => {
  const none = deps(async () => []);
  assert.equal((await handle('GET', '/rising/fyp/older?before=zz', none)).status, 400);
  assert.equal((await handle('GET', '/rising/news/older', none)).status, 404);
  const missing = deps(async () => {
    throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
  });
  assert.equal((await handle('GET', '/rising/popular/older', missing)).status, 404);
});
