/**
 * Routing and error shaping, against a fake query function. No database.
 *
 * Two of these tests are the reason the file exists:
 *
 *   - "a path parameter reaches the driver as a parameter" asserts the SQL is
 *     BYTE-IDENTICAL to the constant in queries.ts even when the id is a SQL
 *     injection. Asserting on the reply would pass just as happily against a
 *     concatenated statement that happened to return nothing.
 *
 *   - "a failure says nothing" asserts on the ABSENCE of words. A leak test that
 *     only checks the status code passes on a 500 whose body is the driver's
 *     description of our schema.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import {
  BOARD_ROWS_SQL,
  BOARD_VIEW_SQL,
  LAUNCH_ROWS_SQL,
  LAUNCH_VIEW_SQL,
  SOURCE_VIEW_SQL,
  STORY_SQL,
  type Row,
} from './queries.ts';
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

function throwingDb(e: unknown): { deps: Deps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: Deps = {
    log: SILENT,
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        throw e;
      },
    },
  };
  return { deps, calls };
}

const FERRY = { id: 'st_ferry', title: 'Ferry captain refuses to dock', isNew: false };
const PIGEON = { id: 'st_pigeon', title: 'Pigeon on the bus', isNew: true };

/* ── routing ──────────────────────────────────────────────────────────── */

test('an unknown route is a 404, not a 500 and not an empty 200', async () => {
  const { deps, calls } = fakeDb({});
  for (const url of ['/nope', '/board', '/story', '/board/a/b', '/quote/c_ferry']) {
    const reply = await handle('GET', url, deps);
    assert.equal(reply.status, 404, url);
    assert.deepEqual(JSON.parse(reply.body), { error: 'not found' }, url);
  }
  assert.equal(calls.length, 0, 'an unroutable path must not reach the database');
});

test('health answers 200 without touching the database', async () => {
  const { deps, calls } = fakeDb({});
  for (const url of ['/health', '/', '/health?probe=1']) {
    const reply = await handle('GET', url, deps);
    assert.equal(reply.status, 200, url);
    assert.deepEqual(JSON.parse(reply.body), { status: 'ok' }, url);
  }
  assert.equal(calls.length, 0, 'health must answer when the database is the thing that is down');
});

test('anything but GET is 405, and never reaches a query', async () => {
  const { deps, calls } = fakeDb({ [BOARD_VIEW_SQL]: [{ tick: '7' }] });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const reply = await handle(method, '/board/main', deps);
    assert.equal(reply.status, 405, method);
    assert.deepEqual(JSON.parse(reply.body), { error: 'method not allowed' });
  }
  assert.equal(calls.length, 0);
});

test('a malformed percent escape is the caller\'s error, not ours', async () => {
  const { deps, calls } = fakeDb({});
  const reply = await handle('GET', '/story/%zz', deps);
  assert.equal(reply.status, 400);
  assert.deepEqual(JSON.parse(reply.body), { error: 'bad request' });
  assert.equal(calls.length, 0);
});

/* ── the board ────────────────────────────────────────────────────────── */

test('the board assembles tick, order and rows from the projection', async () => {
  const { deps, calls } = fakeDb({
    [BOARD_VIEW_SQL]: [{ tick: '412' }],
    [BOARD_ROWS_SQL]: [
      { story_id: 'st_ferry', payload: FERRY },
      { story_id: 'st_pigeon', payload: PIGEON },
    ],
  });

  const reply = await handle('GET', '/board/main', deps);
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body), {
    tick: 412,
    order: ['st_ferry', 'st_pigeon'],
    rows: [FERRY, PIGEON],
  });

  assert.deepEqual(
    calls.map((c) => c.sql),
    [BOARD_VIEW_SQL, BOARD_ROWS_SQL],
    'exactly two statements, in this order, and no join',
  );
});

test('order and rows keep the projector\'s committed position', async () => {
  /* The driver returns them in the order the `order by "position"` produced. This
     service must not re-sort — the ordering IS the ranking, and re-deriving it here
     would put a product decision in the wrong package. */
  const { deps } = fakeDb({
    [BOARD_VIEW_SQL]: [{ tick: 1 }],
    [BOARD_ROWS_SQL]: [
      { story_id: 'st_c', payload: { id: 'st_c' } },
      { story_id: 'st_a', payload: { id: 'st_a' } },
      { story_id: 'st_b', payload: { id: 'st_b' } },
    ],
  });
  const body = JSON.parse((await handle('GET', '/board/main', deps)).body) as { order: string[] };
  assert.deepEqual(body.order, ['st_c', 'st_a', 'st_b']);
});

test('a bigint tick arrives from the driver as a string and leaves as a JSON number', async () => {
  /* The client's int() checks `typeof === 'number'`, so a string here is a hard
     WireShapeError on the far side and the whole tick is dropped. */
  const { deps } = fakeDb({ [BOARD_VIEW_SQL]: [{ tick: '9007199254740991' }], [BOARD_ROWS_SQL]: [] });
  const body = JSON.parse((await handle('GET', '/board/main', deps)).body) as { tick: unknown };
  assert.equal(typeof body.tick, 'number');
  assert.equal(body.tick, 9_007_199_254_740_991);
});

test('a tick too large for a JSON number is refused rather than rounded', async () => {
  const { deps } = fakeDb({ [BOARD_VIEW_SQL]: [{ tick: '9223372036854775807' }], [BOARD_ROWS_SQL]: [] });
  const reply = await handle('GET', '/board/main', deps);
  assert.equal(reply.status, 500, 'silently losing digits would make the gap detector lie');
});

test('an unknown board view is 404 and never asks for its rows', async () => {
  const { deps, calls } = fakeDb({ [BOARD_VIEW_SQL]: [] });
  const reply = await handle('GET', '/board/does-not-exist', deps);
  assert.equal(reply.status, 404);
  assert.deepEqual(JSON.parse(reply.body), { error: 'not found' });
  assert.deepEqual(calls.map((c) => c.sql), [BOARD_VIEW_SQL]);
});

test('a view that exists with no rows is an empty board, not a 404', async () => {
  const { deps } = fakeDb({ [BOARD_VIEW_SQL]: [{ tick: '3' }], [BOARD_ROWS_SQL]: [] });
  const reply = await handle('GET', '/board/main', deps);
  assert.equal(reply.status, 200, 'a quiet board is a fact; a missing view is a different fact');
  assert.deepEqual(JSON.parse(reply.body), { tick: 3, order: [], rows: [] });
});

/* ── the story ────────────────────────────────────────────────────────── */

test('the story payload is returned verbatim, with no envelope', async () => {
  const payload = {
    id: 'st_ferry',
    title: 'Ferry captain refuses to dock',
    summary: ['line one.', 'line two.'],
    reach: { v: 486_000 },
    coins: { kind: 'none' },
    evidence: [],
    discussion: [],
  };
  const { deps, calls } = fakeDb({ [STORY_SQL]: [{ payload }] });

  const reply = await handle('GET', '/story/st_ferry', deps);
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body), payload, 'no wrapper key, no added field, no dropped field');
  assert.deepEqual(calls, [{ sql: STORY_SQL, params: ['st_ferry'] }]);
});

test('an unknown story is a 404 with a JSON body, never an invented page', async () => {
  const { deps } = fakeDb({ [STORY_SQL]: [] });
  const reply = await handle('GET', '/story/st_nope', deps);
  assert.equal(reply.status, 404);
  assert.deepEqual(JSON.parse(reply.body), { error: 'not found' });
});

test('a row with no payload is a 500, not the literal undefined', async () => {
  const { deps } = fakeDb({ [STORY_SQL]: [{}] });
  const reply = await handle('GET', '/story/st_broken', deps);
  assert.equal(reply.status, 500);
  assert.doesNotThrow(() => JSON.parse(reply.body), 'every body this service sends is JSON');
});

/* ── launches ─────────────────────────────────────────────────────────── */

/** Two finished payloads, as the projector would have written them. */
const DOCK = {
  launchId: 'solana:Dock1',
  ticker: 'DOCK',
  name: 'refuses to dock',
  address: 'Dock1',
  venueLabel: 'Pump.fun',
  mintedAt: { at: 1_755_079_200_000 },
  mintedAtBoundS: 30,
  marketCapUsd: { v: 412_000 },
  marketCapBasis: 'fully-diluted',
};
const JERSEY = {
  launchId: 'solana:Jrsy2',
  ticker: 'JERSEY',
  name: 'jersey',
  address: 'Jrsy2',
  venueLabel: 'Pump.fun',
  mintedAt: { at: 1_755_079_260_000 },
  mintedAtBoundS: 30,
  /* The common case on this rail: minted a moment ago, so there is no pool and no cap. */
  marketCapUsd: { v: null, why: 'no_market' },
  marketCapBasis: null,
};

/**
 * The feed's own state, as the projector committed it onto the view row.
 *
 * ★ THE STALE ONE IS USED BY THE EMPTY-FEED TEST BELOW ON PURPOSE. An empty `launches`
 * array with a live source and an empty one with a six-day silence are the same array and
 * completely different answers, and this service's job is to make sure the second fact
 * survives the trip.
 */
const LIVE_SOURCE = { lastHeardAt: { at: 1_755_079_260_000 }, live: true };
const DEAD_SOURCE = { lastHeardAt: { at: 1_754_571_341_000 }, live: false };

test('the launches feed is the tick and the payloads, in the committed order', async () => {
  const { deps, calls } = fakeDb({
    [LAUNCH_VIEW_SQL]: [{ tick: '9', source: LIVE_SOURCE }],
    /* Deliberately not in mint order or alphabetical order: the driver returns them in
       whatever `order by "position"` produced, and this service must hand that back
       untouched. A re-sort here would be the product's ordering rule living in the one
       package that holds no rules. */
    [LAUNCH_ROWS_SQL]: [{ payload: JERSEY }, { payload: DOCK }],
  });

  const reply = await handle('GET', '/launches/default', deps);
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body), { tick: 9, source: LIVE_SOURCE, launches: [JERSEY, DOCK] });

  assert.deepEqual(
    calls.map((c) => c.sql),
    [LAUNCH_VIEW_SQL, LAUNCH_ROWS_SQL],
    'exactly two statements, in this order, and no join',
  );
  assert.deepEqual(calls[1]?.params, ['default']);
});

test('a launch payload is returned verbatim — no envelope, no added field, none dropped', async () => {
  const { deps } = fakeDb({
    [LAUNCH_VIEW_SQL]: [{ tick: 1, source: LIVE_SOURCE }],
    [LAUNCH_ROWS_SQL]: [{ payload: JERSEY }],
  });
  const body = JSON.parse((await handle('GET', '/launches/default', deps)).body) as {
    launches: unknown[];
  };
  assert.deepEqual(body.launches[0], JERSEY);
  /* The absence in particular: an absent cap must arrive as the absent form with its
     reason, not as a zero and not as a missing key. This service adds no coalesce. */
  assert.deepEqual((body.launches[0] as typeof JERSEY).marketCapUsd, {
    v: null,
    why: 'no_market',
  });
});

test('a feed that exists with no mints is an empty rail, not a 404', async () => {
  /* The distinction the whole endpoint turns on. A quiet market and an unreachable feed
     look identical if both answer 404, and the rail would show a transport error over a
     market that is simply quiet. */
  const { deps } = fakeDb({ [LAUNCH_VIEW_SQL]: [{ tick: '4', source: DEAD_SOURCE }], [LAUNCH_ROWS_SQL]: [] });
  const reply = await handle('GET', '/launches/default', deps);
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body), {
    tick: 4,
    /* ★ THE POINT OF THE WHOLE FIELD. The array is empty either way; only this says
       whether that means a quiet market or a transport nobody has heard from in six days. */
    source: DEAD_SOURCE,
    launches: [],
  });
});

test('a launches feed that has never been projected is 404 and never asks for its rows', async () => {
  const { deps, calls } = fakeDb({ [LAUNCH_VIEW_SQL]: [] });
  const reply = await handle('GET', '/launches/never', deps);
  assert.equal(reply.status, 404);
  assert.deepEqual(JSON.parse(reply.body), { error: 'not found' });
  assert.deepEqual(calls.map((c) => c.sql), [LAUNCH_VIEW_SQL]);
});

test('a launch row with no payload is a 500, not the literal undefined', async () => {
  const { deps } = fakeDb({ [LAUNCH_VIEW_SQL]: [{ tick: '1', source: LIVE_SOURCE }], [LAUNCH_ROWS_SQL]: [{}] });
  const reply = await handle('GET', '/launches/default', deps);
  assert.equal(reply.status, 500);
  assert.doesNotThrow(() => JSON.parse(reply.body), 'every body this service sends is JSON');
});

test('★ a driver failure on the launches path says nothing about the schema either', async () => {
  const { deps } = throwingDb(new Error('permission denied for table market_reading'));
  const reply = await handle('GET', '/launches/default', deps);
  assert.equal(reply.status, 500);
  assert.deepEqual(JSON.parse(reply.body), { error: 'server error' });
  assertSaysNothing(reply.body);
});

/* ── ★ parameters, never interpolation ────────────────────────────────── */

test('★ a path parameter reaches the driver as a PARAMETER, never interpolated', async () => {
  const hostile = "main'; drop table public.board_row; --";
  const { deps, calls } = fakeDb({ [BOARD_VIEW_SQL]: [{ tick: '1' }], [BOARD_ROWS_SQL]: [] });

  await handle('GET', `/board/${encodeURIComponent(hostile)}`, deps);

  for (const call of calls) {
    assert.ok(
      call.sql === BOARD_VIEW_SQL || call.sql === BOARD_ROWS_SQL,
      'the statement must be byte-identical to the constant in queries.ts',
    );
    assert.ok(!call.sql.includes('drop'), 'nothing from the path may appear in the statement');
    assert.deepEqual(call.params, [hostile], 'the id travels in the parameter array, decoded once');
  }
  assert.equal(calls.length, 2);
});

test('★ a hostile feed id reaches the driver as a PARAMETER on the launches path too', async () => {
  const hostile = "default'; drop table public.launch_row; --";
  const { deps, calls } = fakeDb({ [LAUNCH_VIEW_SQL]: [{ tick: '1', source: LIVE_SOURCE }], [LAUNCH_ROWS_SQL]: [] });

  await handle('GET', `/launches/${encodeURIComponent(hostile)}`, deps);

  for (const call of calls) {
    assert.ok(
      call.sql === LAUNCH_VIEW_SQL || call.sql === LAUNCH_ROWS_SQL,
      'the statement must be byte-identical to the constant in queries.ts',
    );
    assert.ok(!call.sql.includes('drop'), 'nothing from the path may appear in the statement');
    assert.deepEqual(call.params, [hostile], 'the id travels in the parameter array, decoded once');
  }
  assert.equal(calls.length, 2);
});

test('a percent-encoded separator stays inside the id and does not become a route', async () => {
  const { deps, calls } = fakeDb({ [STORY_SQL]: [{ payload: { id: 'a/b' } }] });
  const reply = await handle('GET', '/story/a%2Fb', deps);
  assert.equal(reply.status, 200);
  assert.deepEqual(calls, [{ sql: STORY_SQL, params: ['a/b'] }]);
});

test('a query string is not part of the id', async () => {
  const { deps, calls } = fakeDb({ [STORY_SQL]: [{ payload: {} }] });
  await handle('GET', '/story/st_ferry?t=1', deps);
  assert.deepEqual(calls, [{ sql: STORY_SQL, params: ['st_ferry'] }]);
});

/* ── ★ error shaping ──────────────────────────────────────────────────── */

/** Every word the reply is not allowed to contain, in one place. */
const MUST_NOT_APPEAR = [
  'select',
  'board_view',
  'board_row',
  'story_view',
  'observation',
  'internal',
  'decisions',
  'permission denied',
  'relation',
  'postgres',
  'pg',
  'at ',
  'stack',
  'ECONNREFUSED',
];

function assertSaysNothing(body: string): void {
  const lowered = body.toLowerCase();
  for (const word of MUST_NOT_APPEAR) {
    assert.ok(!lowered.includes(word.toLowerCase()), `the reply leaked ${JSON.stringify(word)}: ${body}`);
  }
}

test('★ a thrown query error is a 500 whose body describes nothing', async () => {
  /* The realistic worst case: Postgres describing our schema back to us, complete
     with the name of a table the app role is not permitted to know exists. */
  const { deps } = throwingDb(new Error('permission denied for table observation'));

  for (const url of ['/board/main', '/story/st_ferry']) {
    const reply = await handle('GET', url, deps);
    assert.equal(reply.status, 500, url);
    assert.deepEqual(JSON.parse(reply.body), { error: 'server error' });
    assertSaysNothing(reply.body);
  }
});

test('a thrown non-Error is shaped the same way', async () => {
  const { deps } = throwingDb('relation "internal.decisions" does not exist');
  const reply = await handle('GET', '/board/main', deps);
  assert.equal(reply.status, 500);
  assertSaysNothing(reply.body);
});

test('the failure detail is logged server-side, so an opaque 500 is still debuggable', async () => {
  const logged: { msg: string; fields?: Record<string, unknown> }[] = [];
  const reply = await handle('GET', '/board/main', {
    log: {
      info: () => {},
      error: (msg, fields) => logged.push({ msg, ...(fields ? { fields: { ...fields } } : {}) }),
    },
    db: {
      query: async () => {
        throw new Error('permission denied for table observation');
      },
    },
  });

  assert.equal(reply.status, 500);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.fields?.['err'], 'permission denied for table observation');
  assert.equal(logged[0]?.fields?.['url'], '/board/main');
});

test('★ the feed state travels with the rows, verbatim, from the same view row', async () => {
  /* One statement, one frame, one answer. Fetched separately it could describe a different
     projection from the rows on screen, which is two spellings of one thing that can
     disagree — and the disagreement would land exactly where it hurts, on a rail claiming
     to be current. */
  const { deps, calls } = fakeDb({
    [LAUNCH_VIEW_SQL]: [{ tick: '12', source: DEAD_SOURCE }],
    [LAUNCH_ROWS_SQL]: [{ payload: DOCK }],
  });
  const body = JSON.parse((await handle('GET', '/launches/default', deps)).body) as {
    source: unknown;
  };

  assert.deepEqual(body.source, DEAD_SOURCE, 'passed through untouched, not re-derived');
  assert.deepEqual(
    calls.map((c) => c.sql),
    [LAUNCH_VIEW_SQL, LAUNCH_ROWS_SQL],
    'still exactly two statements — the feed state came off the frame, not a third read',
  );
  assert.match(LAUNCH_VIEW_SQL, /select tick, source from public\.launch_view/);
});

test('a view row with no feed state is a 500, not a rail with nothing above it', async () => {
  /* `source jsonb not null` means this cannot happen against our own schema, and if it
     somehow does the honest answer is a failure rather than `undefined` — which is not JSON
     and would reach the rail as a parse error, or worse, decode to a silently live feed. */
  const { deps } = fakeDb({
    [LAUNCH_VIEW_SQL]: [{ tick: '3' }],
    [LAUNCH_ROWS_SQL]: [{ payload: DOCK }],
  });
  const reply = await handle('GET', '/launches/default', deps);
  assert.equal(reply.status, 500);
  assert.doesNotThrow(() => JSON.parse(reply.body), 'every body this service sends is JSON');
});

/* ── the source indicator ─────────────────────────────────────────────── */

const SOURCES = [
  { sourceId: 'reddit', label: 'Reddit', state: 'live', lastHeardAt: { at: 1_700_000_000_000 } },
  { sourceId: 'x', label: 'X', state: 'dormant', lastHeardAt: { at: null, why: 'not_read_yet' } },
];

test('★ an EMPTY source list is a 200, not a 404 and not a 500', async () => {
  /* THE MOST IMPORTANT TEST IN THIS FILE FOR THIS SURFACE. An empty array means "we ingest
     from nothing", which is a real, deliberate, load-bearing answer — it is what turns an
     empty board from a statement about the world into a statement about us. A well-meant
     "no sources, so treat it as missing" anywhere on this path would turn the one state the
     whole feature exists to surface into an error page. */
  const { deps } = fakeDb({ [SOURCE_VIEW_SQL]: [{ tick: '4', sources: [] }] });
  const reply = await handle('GET', '/sources/default', deps);

  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body), { tick: 4, sources: [] });
});

test('a view id that has never been projected is a 404, which is a different fact', async () => {
  /* "The pipeline has not run" and "the pipeline is switched off" produce the same board and
     demand completely different responses. From here down, the only thing keeping them apart
     is the difference between a 404 and a 200 carrying an empty array. */
  const { deps } = fakeDb({});
  const reply = await handle('GET', '/sources/default', deps);
  assert.equal(reply.status, 404);
});

test('the states travel verbatim, from one statement, and nothing re-derives them', async () => {
  const { deps, calls } = fakeDb({ [SOURCE_VIEW_SQL]: [{ tick: '9', sources: SOURCES }] });
  const body = JSON.parse((await handle('GET', '/sources/default', deps)).body) as {
    tick: number;
    sources: unknown;
  };

  assert.equal(body.tick, 9);
  assert.deepEqual(body.sources, SOURCES, 'passed through untouched');
  assert.deepEqual(
    calls.map((c) => c.sql),
    [SOURCE_VIEW_SQL],
    'exactly one statement: the frame IS the payload, so a second read could only disagree',
  );
  assert.match(SOURCE_VIEW_SQL, /select tick, sources from public\.source_view/);
});

test('a frame with no source list is a 500, not a nav with nothing in it', async () => {
  /* `sources jsonb not null` means this cannot happen against our own schema, and if it
     somehow does the honest answer is a failure rather than `undefined` — which is not JSON,
     and which would reach the shell as a parse error rather than as the one field that says
     whether anything is feeding the board. */
  const { deps } = fakeDb({ [SOURCE_VIEW_SQL]: [{ tick: '3' }] });
  const reply = await handle('GET', '/sources/default', deps);
  assert.equal(reply.status, 500);
  assert.doesNotThrow(() => JSON.parse(reply.body), 'every body this service sends is JSON');
});

test('a view id is a parameter here too, never interpolated', async () => {
  const hostile = "default'; drop table public.source_view; --";
  const { deps, calls } = fakeDb({});
  await handle('GET', `/sources/${encodeURIComponent(hostile)}`, deps);

  assert.equal(calls[0]?.sql, SOURCE_VIEW_SQL, 'byte-identical to the constant');
  assert.deepEqual(calls[0]?.params, [hostile]);
});
