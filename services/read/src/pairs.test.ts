/**
 * GET /pairs/:feedId, against a fake query function. No database.
 *
 * A separate file from routes.test.ts rather than more cases inside it, because the claims
 * here are about ONE endpoint and two of them are specific to it:
 *
 *   - AN EMPTY LIST IS A 200 AND A MISSING FEED IS A 404. On this surface the empty answer
 *     is the COMMON one — of the mints this product captured, seven in a hundred and ninety-two
 *     ever reached a market, and on a quiet fortnight the honest answer is none at all. A
 *     screen that showed a transport error over that would be the exact failure the whole
 *     surface was built to avoid, so the two have to be different answers here.
 *
 *   - THE HEAD IS RETURNED VERBATIM AND NOTHING IS COMPUTED FROM IT. This service holds the
 *     app credential: it has no privilege on the readings behind those counts and no USAGE
 *     on the schema the coverage log lives in, so it could not have worked any of it out. The
 *     test asserts it does not try.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { PAIR_ROWS_SQL, PAIR_VIEW_SQL, type Row } from './queries.ts';
import { handle, type Deps } from './routes.ts';

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Answers each statement from a table keyed by the exact SQL constant. */
function fakeDb(answers: Readonly<Record<string, readonly Row[]>>): { deps: Deps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: Deps = {
    log: SILENT,
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return answers[sql] ?? [];
      },
    },
  };
  return { deps, calls };
}

const HEAD = {
  windowMs: 1_209_600_000,
  lastMintHeardAt: { at: 1_755_000_000_000 },
  rows: { listing: 'shown', mintsInWindow: 192, withMarket: 6, withoutMarket: 186 },
};

const TOAD = { pairId: 'solana:toad', ticker: 'CopeToad', priceUsd: { v: 0.000_001_999 } };
const LOOONG = { pairId: 'solana:loong', ticker: 'LOOONG', priceUsd: { v: 0.000_001_88 } };

test('a projected frame answers 200 with its tick, its head and its rows in order', async () => {
  const { deps } = fakeDb({
    [PAIR_VIEW_SQL]: [{ tick: '12', head: HEAD }],
    /* Already in `position` order — the projector committed it and the SELECT reads it back.
       Nothing in this service re-sorts, so what comes out is what went in. */
    [PAIR_ROWS_SQL]: [{ payload: TOAD }, { payload: LOOONG }],
  });

  const reply = await handle('GET', '/pairs/default', deps);
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body), { tick: 12, head: HEAD, pairs: [TOAD, LOOONG] });
});

test('the head is handed over byte for byte, with nothing added and nothing computed', async () => {
  /* ★ THE COUNTS ARE NOT THIS SERVICE'S TO DERIVE OR TO CHECK. They came out of one
     statement over one population in the projector, which is the only place they can be
     consistent with each other. A service that "corrected" a head whose numbers did not add
     up would be inventing a population, and it holds a credential that cannot see the real
     one. So an inconsistent head passes through unchanged and is a projection bug, findable
     where it was made. */
  const odd = { ...HEAD, rows: { listing: 'shown', mintsInWindow: 1, withMarket: 9, withoutMarket: 0 } };
  const { deps } = fakeDb({
    [PAIR_VIEW_SQL]: [{ tick: '3', head: odd }],
    [PAIR_ROWS_SQL]: [],
  });

  const reply = await handle('GET', '/pairs/default', deps);
  const body = JSON.parse(reply.body) as { head: unknown };
  assert.deepEqual(body.head, odd);
});

test('★ a projected frame with no rows is a 200 and an empty list, never a 404', async () => {
  /* The true answer on the store this was written against: the market was read, and nothing
     we captured had a pool. "We looked and found none" and "this feed has never been
     projected" are different facts, and the screen says something different for each. */
  const { deps } = fakeDb({
    [PAIR_VIEW_SQL]: [{ tick: '4', head: { ...HEAD, rows: { listing: 'shown', mintsInWindow: 192, withMarket: 0, withoutMarket: 192 } } }],
    [PAIR_ROWS_SQL]: [],
  });

  const reply = await handle('GET', '/pairs/default', deps);
  assert.equal(reply.status, 200);
  const body = JSON.parse(reply.body) as { pairs: unknown[] };
  assert.deepEqual(body.pairs, []);
});

test('★ a withheld frame is a 200 with an empty list, and no counts anywhere in the body', async () => {
  /* The projector writes no rows under this tag, so there is nothing to hand over. What
     matters is that the body carries no count either: a number over a population that may
     hold coins nobody minted is exactly what this state exists to refuse. */
  const { deps } = fakeDb({
    [PAIR_VIEW_SQL]: [{ tick: '5', head: { windowMs: 1_209_600_000, lastMintHeardAt: { at: null, why: 'not_read_yet' }, rows: { listing: 'withheld' } } }],
    [PAIR_ROWS_SQL]: [],
  });

  const reply = await handle('GET', '/pairs/default', deps);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.includes('mintsInWindow'), false);
  assert.equal(reply.body.includes('withMarket'), false);
});

test('a feed that has never been projected is a 404, and the rows are never asked for', async () => {
  const { deps, calls } = fakeDb({});
  const reply = await handle('GET', '/pairs/default', deps);
  assert.equal(reply.status, 404);
  assert.deepEqual(JSON.parse(reply.body), { error: 'not found' });
  /* One statement, not two. The existence test short-circuits, so an unknown feed costs a
     single index probe rather than a second scan of a table that will answer nothing. */
  assert.equal(calls.length, 1);
});

test('a feed id reaches the driver as a parameter, and the SQL is byte-identical', async () => {
  /* Asserting on the reply would pass just as happily against a concatenated statement that
     happened to return nothing. The claim is about the STRING that reached the driver. */
  const hostile = "default'; drop table public.pair_row; --";
  const { deps, calls } = fakeDb({
    [PAIR_VIEW_SQL]: [{ tick: '1', head: HEAD }],
    [PAIR_ROWS_SQL]: [],
  });

  await handle('GET', `/pairs/${encodeURIComponent(hostile)}`, deps);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.sql, PAIR_VIEW_SQL);
  assert.deepEqual(calls[0]?.params, [hostile]);
  assert.equal(calls[1]?.sql, PAIR_ROWS_SQL);
  assert.deepEqual(calls[1]?.params, [hostile]);
});

test('a driver failure says nothing about the schema', async () => {
  /* A Postgres error is a remarkably good description of our schema. The reply is one of
     four fixed strings and the detail goes to the log, where it is ours. */
  const deps: Deps = {
    log: SILENT,
    db: {
      query: async () => {
        throw new Error('permission denied for schema internal: relation internal.mint_coverage');
      },
    },
  };

  const reply = await handle('GET', '/pairs/default', deps);
  assert.equal(reply.status, 500);
  assert.deepEqual(JSON.parse(reply.body), { error: 'server error' });
  for (const word of ['internal', 'mint_coverage', 'pair_row', 'permission', 'schema']) {
    assert.equal(reply.body.includes(word), false, `the reply leaked "${word}"`);
  }
});

test('a broken frame fails rather than serialising a row with no payload', async () => {
  /* `undefined` is not JSON. A row that somehow carries no payload would reach the client as
     a parse error with nothing to say, so it becomes an opaque 500 here instead. */
  const { deps } = fakeDb({
    [PAIR_VIEW_SQL]: [{ tick: '1', head: HEAD }],
    [PAIR_ROWS_SQL]: [{}],
  });

  const reply = await handle('GET', '/pairs/default', deps);
  assert.equal(reply.status, 500);
});

test('a frame with no head fails rather than answering with a head of undefined', async () => {
  /* Same argument as the payload one line up, applied to the column that carries the
     sentence above the table. A head that silently vanished would leave the screen with rows
     and no idea how far back they reach or when a mint was last heard. */
  const { deps } = fakeDb({
    [PAIR_VIEW_SQL]: [{ tick: '1' }],
    [PAIR_ROWS_SQL]: [],
  });

  const reply = await handle('GET', '/pairs/default', deps);
  assert.equal(reply.status, 500);
});

test('the pairs route is GET only, and an extra segment is a 404 rather than a 500', async () => {
  const { deps, calls } = fakeDb({ [PAIR_VIEW_SQL]: [{ tick: '1', head: HEAD }] });

  assert.equal((await handle('POST', '/pairs/default', deps)).status, 405);
  assert.equal((await handle('GET', '/pairs', deps)).status, 404);
  assert.equal((await handle('GET', '/pairs/default/extra', deps)).status, 404);
  assert.equal(calls.length, 0, 'an unroutable path must not reach the database');
});
