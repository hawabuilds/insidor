/**
 * Routing and error shaping, with no reference to node:http.
 *
 * The split is what makes the interesting properties testable without a socket or a
 * database: `handle` takes a method, a URL and a `Db`, and returns a status and an
 * already-serialised body. server.ts adds headers and writes bytes. Everything below
 * can be asserted against a fake query function, which is the only way the two
 * claims worth making here — "a path parameter is never interpolated into SQL" and
 * "a failure tells the caller nothing" — get tested rather than promised.
 *
 * ★ ERROR SHAPING IS A PRODUCT RULE, NOT AN OPERATIONAL ONE. Every failure answers
 * with one of four fixed strings. Not the driver's message, not the statement, not
 * the table name, not a stack. A Postgres error is a remarkably good description of
 * the schema — `permission denied for table observation` names a table the app is
 * not supposed to know exists, and `relation "internal.decisions" does not exist`
 * names the machinery by name. Passing those through would leak the shape of the
 * system to anyone who could provoke one, which is anyone with a browser. The detail
 * goes to the log, where it is ours.
 *
 * There is no logic in this file about what a board or a story MEANS. It reads three
 * columns, checks they are the types the schema promises, and puts them in an
 * envelope. If something here starts computing, it belongs in services/project.
 */

import { errorText, type Logger } from './log.ts';
import { BOARD_ROWS_SQL, BOARD_VIEW_SQL, STORY_SQL, type Db, type Row } from './queries.ts';

export interface Reply {
  readonly status: number;
  /** Already-serialised JSON. server.ts writes it verbatim and adds no envelope. */
  readonly body: string;
}

export interface Deps {
  readonly db: Db;
  readonly log: Logger;
}

/*
 * The four answers this service can give when it is not giving data. Fixed strings,
 * defined once, so there is no call site that could accidentally interpolate a
 * detail into one. Each is valid JSON because the client parses every response body.
 */
const NOT_FOUND: Reply = { status: 404, body: '{"error":"not found"}' };
const BAD_REQUEST: Reply = { status: 400, body: '{"error":"bad request"}' };
const NOT_ALLOWED: Reply = { status: 405, body: '{"error":"method not allowed"}' };
/* "server error" rather than the conventional "internal error": `internal` is the
   name of the schema holding every decision, label and policy in the system, and the
   leak test in routes.test.ts greps replies for exactly that word. A stock phrase
   that forces the guard to carve out an exception is a stock phrase worth changing. */
const SERVER_ERROR: Reply = { status: 500, body: '{"error":"server error"}' };

/**
 * Health does not touch the database, and that is deliberate — the same call made in
 * services/runner/src/health.ts. An endpoint that queries the database reports the
 * database's health, and then cannot answer at all when the database is the problem,
 * which is the exact moment the platform needs a truthful answer about whether to
 * restart this container. This process being able to accept a connection and write a
 * response is the whole claim, so it is the whole check.
 */
const HEALTH: Reply = { status: 200, body: '{"status":"ok"}' };

/**
 * Splits a request target into decoded path segments, or null if it is not a URL we
 * can read.
 *
 * The decode happens ONCE, here, and after the split — so `%2F` in an id stays part
 * of that id instead of becoming a path separator. A malformed escape (`%zz`) is a
 * malformed request, not a server fault: decodeURIComponent throws, and answering
 * 500 to it would report our own error for the caller's typo.
 */
function segmentsOf(rawUrl: string): readonly string[] | null {
  const path = rawUrl.split('?')[0] ?? '/';
  try {
    return path.split('/').filter((s) => s !== '').map(decodeURIComponent);
  } catch {
    return null;
  }
}

/**
 * `tick` is `bigint`, and the driver hands bigints back as STRINGS because a 64-bit
 * integer does not fit a float64 and it refuses to drop digits quietly. The wire
 * contract's `tick` is a JSON number — the client's `int()` checks
 * `typeof === 'number'` and throws a shape error on a string — so the string has to
 * become a number somewhere. Here, at the edge, with a range check.
 *
 * This is a transport decode, not a computation: it changes the representation and
 * nothing else, and it refuses rather than rounding when the two representations
 * stop agreeing.
 */
function tickNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isSafeInteger(n)) return n;
  }
  throw new TypeError('a board tick arrived in a form no JSON number can carry');
}

/** A column the schema declares `not null` arriving as anything but text is a broken projection. */
function textColumn(raw: unknown, column: string): string {
  if (typeof raw !== 'string') throw new TypeError(`${column} is not text`);
  return raw;
}

/**
 * The projected payload, passed through untouched.
 *
 * `payload jsonb not null` means the driver gives us a parsed value, and the only
 * thing checked is that a value arrived at all — a row that somehow carries no
 * payload must fail loudly rather than serialise to the literal `undefined`, which
 * is not JSON and would reach the client as a parse error with no explanation.
 */
function payloadOf(row: Row): unknown {
  const payload = row['payload'];
  if (payload === undefined) throw new TypeError('a projected row arrived with no payload');
  return payload;
}

function json(status: number, value: unknown): Reply {
  return { status, body: JSON.stringify(value) };
}

/**
 * GET /board/:viewId
 *
 * Two statements, no join. The first is the existence test and the second is the
 * ordering, already committed by the projector. They are separate because an unknown
 * view and an empty board are different answers — a join would collapse them into
 * "no rows", and the caller would get a 404 for a view that exists and is simply
 * quiet, which on a board that shows what is happening right now is a lie.
 */
async function board(viewId: string, deps: Deps): Promise<Reply> {
  const views = await deps.db.query(BOARD_VIEW_SQL, [viewId]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;

  const rows = await deps.db.query(BOARD_ROWS_SQL, [viewId]);
  return json(200, {
    tick: tickNumber(view['tick']),
    order: rows.map((r) => textColumn(r['story_id'], 'story_id')),
    rows: rows.map(payloadOf),
  });
}

/**
 * GET /story/:storyId
 *
 * The payload verbatim, with no envelope — `client.ts` hands the parsed body
 * straight to `decodeStory`. A story with no projected row is a 404 with a JSON
 * body, never an invented page: the app treats a missing story as a transport
 * failure it can show, and a fabricated empty one as a story that exists.
 */
async function story(storyId: string, deps: Deps): Promise<Reply> {
  const found = await deps.db.query(STORY_SQL, [storyId]);
  const row = found[0];
  if (row === undefined) return NOT_FOUND;
  return json(200, payloadOf(row));
}

/**
 * The whole router.
 *
 * Every throw below this line — a driver error, a broken projection, a permission
 * the app role does not have — lands in the one catch and becomes an opaque 500. A
 * route that wanted to explain itself to the caller would have to be written to do
 * so deliberately, which is the right amount of friction.
 */
export async function handle(method: string, rawUrl: string, deps: Deps): Promise<Reply> {
  const segments = segmentsOf(rawUrl);
  if (segments === null) return BAD_REQUEST;

  /* OPTIONS is answered by the transport, which owns the CORS headers. Nothing else
     is served: this surface is read-only, and a 405 says so more usefully than a 404. */
  if (method !== 'GET') return NOT_ALLOWED;

  /* Destructured rather than indexed: under noUncheckedIndexedAccess `segments[1]`
     is `string | undefined` even after a length check, and the honest way to spend
     that is an explicit guard rather than an assertion that the check was enough. */
  const [head, param] = segments;

  try {
    if (segments.length === 0) return HEALTH;
    if (segments.length === 1 && head === 'health') return HEALTH;

    if (segments.length === 2 && param !== undefined) {
      if (head === 'board') return await board(param, deps);
      if (head === 'story') return await story(param, deps);
    }
    return NOT_FOUND;
  } catch (e) {
    /* The only place the real reason exists. Logged with the path so it is findable,
       and never with the reply, so it cannot be read from outside. */
    deps.log.error('request failed', { method, url: rawUrl, err: errorText(e) });
    return SERVER_ERROR;
  }
}
