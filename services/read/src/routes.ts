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
import {
  BOARD_ROWS_SQL,
  BOARD_VIEW_SQL,
  LAUNCH_ROWS_SQL,
  LAUNCH_VIEW_SQL,
  PAIR_ROWS_SQL,
  PAIR_VIEW_SQL,
  SOURCE_VIEW_SQL,
  STORY_SQL,
  type Db,
  type Row,
} from './queries.ts';

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
/**
 * A `not null` jsonb column, passed through untouched.
 *
 * The same contract as `payloadOf` and the same reason for existing: the driver hands
 * back a parsed value, and the only thing checked is that a value arrived. A column the
 * schema declares NOT NULL arriving as `undefined` means the projection is broken, and it
 * must fail loudly rather than serialise to the literal `undefined` — which is not JSON
 * and reaches the client as a parse error with nothing in it to explain itself.
 */
function columnOf(row: Row, column: string): unknown {
  const value = row[column];
  if (value === undefined) throw new TypeError(`a projected view row arrived with no ${column}`);
  return value;
}

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
 *
 * ★ EXPORTED FOR THE LIVE CHANNEL, AND FOR NO OTHER REASON. stream.ts pushes a frame by
 * calling this — the same two statements, the same assembly, the same already-censored
 * payload handed over verbatim. The alternative was a second frame-builder for the socket
 * path, and two builders is two things that can disagree about what a board is. There is
 * one, and both the poll and the stream go through it.
 */
export async function board(viewId: string, deps: Deps): Promise<Reply> {
  const views = await deps.db.query(BOARD_VIEW_SQL, [viewId]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;

  const rows = await deps.db.query(BOARD_ROWS_SQL, [viewId]);
  return json(200, {
    tick: tickNumber(view['tick']),
    order: rows.map((r) => textColumn(r['story_id'], 'story_id')),
    rows: rows.map(payloadOf),
    /* ★ FROM THE VIEW ROW, IN THIS REPLY, WITH THE ROWS IT DESCRIBES — the same argument
       `launches` makes about `source` below. A board of six seeded stories and a board of
       six real ones are the same array of six payloads, and this is the only field that
       tells them apart. Handed over as it was committed: this process cannot compute it,
       because `public.story.origin` is not something it reads and the judgement was made
       once, by the projector, against the frame it was committing. */
    provenance: columnOf(view, 'provenance'),
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
 * GET /launches/:feedId
 *
 * Two statements, no join, no logic — the same shape as the board and for the same
 * reasons. The payloads come back in the order the projector committed and this service
 * does not re-sort them: "newest first" was decided once, against mint times this process
 * cannot read, and re-deriving it here would put the product's ordering rule in the one
 * package that must never hold one.
 *
 * There is no `order` array in the reply. The board has one because rows arrive
 * individually over the live channel; launches are polled whole, so the array of payloads
 * is the order and a second spelling of it would be a second thing that can disagree.
 *
 * ★ `source` TRAVELS WITH THE ROWS, IN THIS REPLY, from the same view row. It is what
 * makes an empty `launches` array readable: a quiet market and a transport that has been
 * dead for six days produce the identical array, and only this field separates them. It is
 * handed over as it was committed — this process cannot compute it and cannot check it,
 * because the instant behind it comes from a schema its credential has no USAGE on.
 */
async function launches(feedId: string, deps: Deps): Promise<Reply> {
  const views = await deps.db.query(LAUNCH_VIEW_SQL, [feedId]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;

  const rows = await deps.db.query(LAUNCH_ROWS_SQL, [feedId]);
  return json(200, {
    tick: tickNumber(view['tick']),
    source: sourceOf(view),
    launches: rows.map(payloadOf),
  });
}

/**
 * The committed feed state, passed through untouched.
 *
 * Same shape and same reasoning as `payloadOf`: `source jsonb not null` means the driver
 * hands back a parsed value, and the only thing checked is that a value arrived at all. A
 * view row carrying none must fail loudly rather than serialise to the literal `undefined`
 * — which is not JSON, and which would reach the rail as a parse error rather than as the
 * one field that tells it whether an empty list means anything.
 *
 * Nothing here reads inside it, and nothing here could have produced it.
 */
function sourceOf(row: Row): unknown {
  const source = row['source'];
  if (source === undefined) throw new TypeError('a projected frame arrived with no source');
  return source;
}

/**
 * The committed head, passed through untouched.
 *
 * Same shape and same reasoning as `payloadOf` one screen up: `head jsonb not null` means
 * the driver hands back a parsed value, and the only thing checked is that a value arrived
 * at all. A row that somehow carries none must fail loudly rather than serialise to the
 * literal `undefined`, which is not JSON and would reach the client as a parse error with
 * nothing to say.
 *
 * Nothing here reads inside it. The counts, the window and the last-heard instant were all
 * decided by the projector, which holds a credential this process does not have.
 */
function headOf(row: Row): unknown {
  const head = row['head'];
  if (head === undefined) throw new TypeError('a projected frame arrived with no head');
  return head;
}

/**
 * GET /pairs/:feedId
 *
 * Two statements, no join, no logic — the same shape as the board and the rail, and for the
 * same reasons. The payloads come back in the order the projector committed, which is mint
 * order and NOT pair order: nothing in this system knows when a pool opened, so nothing
 * here may imply it. Re-sorting them would put the product's ordering rule in the one
 * package that must never hold one.
 *
 * ★ THE HEAD COMES OUT OF THE FIRST STATEMENT, BESIDE THE TICK. It says what window the
 * list covers, when a mint was last heard, and whether these rows may be listed at all —
 * and it is committed with the frame, so it cannot describe a different one. When it says
 * the rows are withheld, `pair_row` holds none and this reply carries an empty array; the
 * decoder does not read the array on that branch either. The two cannot disagree because
 * only one of them is ever consulted.
 *
 * There is no `order` array in the reply, for the launches rail's reason: these are polled
 * whole, so the array of payloads is the order and a second spelling of it would be a
 * second thing that can be wrong.
 */
async function pairs(feedId: string, deps: Deps): Promise<Reply> {
  const views = await deps.db.query(PAIR_VIEW_SQL, [feedId]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;

  const rows = await deps.db.query(PAIR_ROWS_SQL, [feedId]);
  return json(200, {
    tick: tickNumber(view['tick']),
    head: headOf(view),
    pairs: rows.map(payloadOf),
  });
}

/**
 * The committed set of sources, passed through untouched.
 *
 * Same shape and same reasoning as `payloadOf`, `sourceOf` and `headOf`: `sources jsonb not
 * null` means the driver hands back a parsed value, and the only thing checked is that a
 * value arrived at all. A frame carrying none must fail loudly rather than serialise to the
 * literal `undefined`, which is not JSON and would reach the shell as a parse error instead
 * of as the one field that says whether anything is feeding the board.
 *
 * ★ IT IS NOT CHECKED FOR BEING AN ARRAY, AND CERTAINLY NOT FOR BEING A NON-EMPTY ONE. An
 * empty array is the most important answer this endpoint can give — it means we ingest from
 * nothing — and a well-meant "if it is empty, treat it as missing" here would turn the one
 * state the whole feature exists to surface into a 500. Shape is the client's boundary to
 * enforce, and it does, against an allowlist this process has never seen.
 */
function sourcesOf(row: Row): unknown {
  const sources = row['sources'];
  if (sources === undefined) throw new TypeError('a projected frame arrived with no sources');
  return sources;
}

/**
 * GET /sources/:viewId
 *
 * ★ ONE STATEMENT, WHICH IS WHY THIS ROUTE LOOKS SHORTER THAN THE OTHERS RATHER THAN
 * SIMPLER. The other three surfaces are a frame plus a row table; this one is a frame whose
 * payload IS the whole answer, because there are three to five sources and the projector
 * already committed their order. A second statement would buy nothing and would cost the one
 * thing that matters here — a result set that could describe a different moment from the
 * tick beside it.
 *
 * Existence is the 404 test, and the distinction it holds open is the sharpest one this
 * service draws. A view id with no row has never been projected: the pipeline has not run.
 * A row carrying an EMPTY array has been projected and says we ingest from nothing: the
 * pipeline is switched off. Both produce a board with no new stories on it, they demand
 * completely different responses from whoever is looking, and only the difference between a
 * 404 and a 200 keeps them apart from here on down.
 *
 * Nothing in this function reads inside the payload, and nothing here could have produced
 * it: the three-way call is made against a record in a schema this credential has no USAGE
 * on, and against a bar in a policy this process has never seen.
 */
async function sources(viewId: string, deps: Deps): Promise<Reply> {
  const views = await deps.db.query(SOURCE_VIEW_SQL, [viewId]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;

  return json(200, { tick: tickNumber(view['tick']), sources: sourcesOf(view) });
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
      if (head === 'launches') return await launches(param, deps);
      if (head === 'pairs') return await pairs(param, deps);
      if (head === 'sources') return await sources(param, deps);
    }
    return NOT_FOUND;
  } catch (e) {
    /* The only place the real reason exists. Logged with the path so it is findable,
       and never with the reply, so it cannot be read from outside. */
    deps.log.error('request failed', { method, url: rawUrl, err: errorText(e) });
    return SERVER_ERROR;
  }
}
