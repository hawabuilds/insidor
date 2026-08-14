/**
 * The transport, over a real socket on an ephemeral port, with a fake database.
 *
 * routes.test.ts proves what this service SAYS. This file proves what it sends
 * alongside it — the three headers, the preflight, and the fact that an origin
 * nobody configured gets no allow header rather than a permissive one. Those are
 * exactly the properties that a framework would have supplied by default, in a shape
 * nobody chose, which is why there is no framework here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { SILENT } from './log.ts';
import { BOARD_ROWS_SQL, BOARD_VIEW_SQL, STORY_SQL, type Row } from './queries.ts';
import { createReadServer } from './server.ts';

const ORIGIN = 'http://localhost:5173';

const ANSWERS: Readonly<Record<string, readonly Row[]>> = {
  [BOARD_VIEW_SQL]: [{ tick: '412' }],
  [BOARD_ROWS_SQL]: [{ story_id: 'st_ferry', payload: { id: 'st_ferry', isNew: false } }],
  [STORY_SQL]: [{ payload: { id: 'st_ferry', evidence: [], discussion: [] } }],
};

/** Starts the server on port 0 and returns its base URL plus a teardown. */
async function serving(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createReadServer({
    log: SILENT,
    allowedOrigins: [ORIGIN],
    db: { query: async (sql) => ANSWERS[sql] ?? [] },
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('a board request answers JSON with no-store and the configured origin', async () => {
  const { base, close } = await serving();
  try {
    const res = await fetch(`${base}/board/main`, { headers: { origin: ORIGIN } });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('vary'), 'origin');
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);

    assert.deepEqual(await res.json(), {
      tick: 412,
      order: ['st_ferry'],
      rows: [{ id: 'st_ferry', isNew: false }],
    });
  } finally {
    await close();
  }
});

test('an origin nobody configured gets no allow header, and never a wildcard', async () => {
  const { base, close } = await serving();
  try {
    const res = await fetch(`${base}/story/st_ferry`, { headers: { origin: 'https://not-ours.example' } });
    assert.equal(res.status, 200, 'the request is still served; the browser is what refuses to read it');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    /* Vary must be present even when the header is absent, or a cache can store the
       no-header answer and replay it to the origin that should have got one. */
    assert.equal(res.headers.get('vary'), 'origin');
  } finally {
    await close();
  }
});

test('an OPTIONS preflight is answered without a body', async () => {
  const { base, close } = await serving();
  try {
    const res = await fetch(`${base}/board/main`, { method: 'OPTIONS', headers: { origin: ORIGIN } });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), '');
  } finally {
    await close();
  }
});

test('an unknown route and a write attempt are both refused over the wire', async () => {
  const { base, close } = await serving();
  try {
    const missing = await fetch(`${base}/admin`, { headers: { origin: ORIGIN } });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'not found' });
    assert.equal(missing.headers.get('cache-control'), 'no-store', 'errors are not cacheable either');

    const write = await fetch(`${base}/board/main`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: '{"tick":1}',
    });
    assert.equal(write.status, 405);
    assert.deepEqual(await write.json(), { error: 'method not allowed' });
  } finally {
    await close();
  }
});

test('an unknown story is a 404 the client can parse', async () => {
  const server = createReadServer({
    log: SILENT,
    allowedOrigins: [ORIGIN],
    db: { query: async () => [] },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/story/st_nope`, { headers: { origin: ORIGIN } });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
