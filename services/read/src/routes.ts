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


import { coinAbout, type AboutDeps } from './coin-about.ts';
import { coinMarket, type MarketDeps } from './market.ts';
import { FEED_PAGE_FEEDS, FEED_PAGE_SIZE, FEED_PAGE_SQL, FOR_YOU_PAGE_SQL, FOR_YOU_START_SQL, feedPage, forYouKeptFrom, parseCursor, startCursor } from './feed-page.ts';
import { createNarrativeLists, parseNarrativeList } from './narrative-sorts.ts';
import { createSorts, parseSort } from './post-sorts.ts';
import { createRunningCoins } from './running-coins.ts';
import { createLaunchOdds } from './launch-odds.ts';
import { pictureFiles, pictureLinks, withFile, withPictureFiles } from './post-pics.ts';
import { quoteFaces, withQuoteFace } from './quote-faces.ts';
import { withStoryTags } from './story-tags.ts';
import { withTranslations } from './translations.ts';
import { withCardVideos } from './card-video.ts';
import { errorText, type Logger } from './log.ts';
import type { PostSheet } from './post-sheet.ts';
import type { Search } from './search.ts';
import type { TradeCard } from './trade-card.ts';
import type { ThesesReply } from './theses.ts';
import { isDepositChain, type Deposits } from './deposits.ts';
import type { WalletRoute } from './wallet.ts';
import { readWarCoin } from './war-coin.ts';
import {
  BOARD_ROWS_SQL,
  BOARD_VIEW_SQL,
  LAUNCH_ROWS_SQL,
  LAUNCH_VIEW_SQL,
  RISING_ROWS_SQL,
  RISING_VIEW_SQL,
  PAIR_ROWS_SQL,
  PAIR_VIEW_SQL,
  SOURCE_VIEW_SQL,
  NARRATIVES_SQL,
  FIGHT_NARRATIVES_SQL,
  PERMANENT_NARRATIVES_SQL,
  STORY_ALIAS_SQL,
  STORY_ALIAS_ID_SQL,
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
  /** A coin's market data (market.ts). Absent: the coin market route is a 404. */
  readonly market?: Omit<MarketDeps, 'db' | 'log' | 'recent'>;
  /** A coin's links, day numbers, holders, creator and posts (coin-about.ts). Absent: a 404. */
  readonly about?: Omit<AboutDeps, 'db' | 'log' | 'recent'>;
  /** The Search tab's live search (search.ts). Absent: /search and /coin/:id are 404s. */
  readonly search?: Search;
  /** The Portfolio tab (wallet.ts). Absent: /wallet/:address is a 404. */
  readonly wallet?: WalletRoute;
  /** The flex card's facts for one sell (trade-card.ts). Absent: /sell/:signature/card is a 404. */
  readonly tradeCard?: TradeCard;
  /** The phone's post sheet (post-sheet.ts) and narrative sheet (story-sheet.ts). Absent: /post/:id/sheet and /story/:id/sheet are 404s. */
  readonly postSheet?: PostSheet;
  /** For You's Trending and Most viewed (post-sorts.ts), kept per projector run. Absent: worked out on every request. */
  readonly sorts?: ReturnType<typeof createSorts>;
  /** The Narratives tab's lists (narrative-sorts.ts), ranked once per board tick. Absent: ranked on every request. */
  readonly narrativeLists?: ReturnType<typeof createNarrativeLists>;
  /** The running coins strip (running-coins.ts), kept `runningCoins.keepMs`. Absent: read on every request. */
  readonly runningCoins?: ReturnType<typeof createRunningCoins>;
  /** A coin's launch odds (launch-odds.ts), its groups kept `launchOdds.keepMs`. Absent: the groups are read on every request. */
  readonly launchOdds?: ReturnType<typeof createLaunchOdds>;
  /** A coin's fomo theses by its Solana address (theses.ts). Absent: the route answers "not_configured". */
  readonly theses?: (address: string, minUsd?: number) => Promise<ThesesReply>;
  /** Deposits from other chains into a wallet as SOL (deposits.ts). Absent: both routes answer "not_configured". */
  readonly deposits?: Deposits;
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
  /* Sent together: two statements still, but one round trip to a database a continent away. */
  const [views, rows] = await Promise.all([deps.db.query(BOARD_VIEW_SQL, [viewId]), deps.db.query(BOARD_ROWS_SQL, [viewId])]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;

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
 * GET /narratives/:viewId
 *
 * The board's stories as whole pages, in the board's order, with the same `tick` and
 * `provenance` the board carries — so the Narratives tab can say what kind of stories these
 * are exactly as the feed does. A view never projected is a 404, as for the board.
 */
async function narratives(viewId: string, deps: Deps): Promise<Reply> {
  const [views, rows] = await Promise.all([deps.db.query(BOARD_VIEW_SQL, [viewId]), deps.db.query(NARRATIVES_SQL, [viewId])]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;
  /* Each narrative's picture and its posts' with our copy named (post-pics.ts, 0119). */
  return json(200, { tick: tickNumber(view['tick']), stories: await withPictureFiles(deps.db, rows.map(payloadOf)), provenance: columnOf(view, 'provenance') });
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
  if (row !== undefined) return json(200, (await withPictureFiles(deps.db, [payloadOf(row)]))[0]);
  /* ★ A merged narrative's old link opens the one it was merged into (0106), never a 404. */
  const [ready] = await deps.db.query(PERMANENT_NARRATIVES_SQL, []);
  if (ready?.['ok'] !== true) return NOT_FOUND;
  const alias = (await deps.db.query(STORY_ALIAS_SQL, [storyId]))[0];
  return alias === undefined ? NOT_FOUND : json(200, (await withPictureFiles(deps.db, [payloadOf(alias)]))[0]);
}

/** The id whose page a narrative link opens: its own, or for a merged one the survivor's (0106). */
async function pageIdOf(storyId: string, deps: Deps): Promise<string> {
  if ((await deps.db.query(STORY_SQL, [storyId]))[0] !== undefined) return storyId;
  const [ready] = await deps.db.query(PERMANENT_NARRATIVES_SQL, []);
  if (ready?.['ok'] !== true) return storyId;
  const [alias] = await deps.db.query(STORY_ALIAS_ID_SQL, [storyId]);
  return typeof alias?.['into_story_id'] === 'string' ? alias['into_story_id'] : storyId;
}

/**
 * GET /narratives/:viewId/all?sort=new|trending|today|week|viewed&offset=N[&on=x|tiktok][&coin=none]
 *
 * The Narratives tab's lists, as For You's sorts (the owner, 2026-10-18; narrative-sorts.ts says
 * each): every narrative, dead ones included where the sort keeps them, 20 at a time. `next` is the
 * offset of the next page, or null on the last. A view never projected is a 404, as the board's; so
 * is a database before 0106, which has no list to page.
 */
async function allNarratives(viewId: string, rawUrl: string, deps: Deps): Promise<Reply> {
  const ask = parseNarrativeList(rawUrl);
  if (ask === null) return BAD_REQUEST;
  const [views, [ready]] = await Promise.all([deps.db.query(BOARD_VIEW_SQL, [viewId]), deps.db.query(PERMANENT_NARRATIVES_SQL, [])]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;
  if (ready?.['ok'] !== true) return NOT_FOUND;
  const tick = tickNumber(view['tick']);
  const page = await (deps.narrativeLists ?? createNarrativeLists())(deps.db, tick, ask);
  return json(200, { tick, stories: await withPictureFiles(deps.db, page.stories), provenance: columnOf(view, 'provenance'), next: page.next });
}

/**
 * GET /narratives/:viewId/fights
 *
 * The narratives that are online meme wars between countries (the projector's `countries`), whole
 * pages, most viewed first: what the tab's "Twitter World War" opens, one section per pair of
 * countries drawn by the app. Same envelope and same 404 as /narratives/:viewId, plus `warCoin`: the
 * one coin the owner chose for the whole war, or null (war-coin.ts).
 */
async function fightNarratives(viewId: string, deps: Deps): Promise<Reply> {
  const [views, rows, warCoin] = await Promise.all([deps.db.query(BOARD_VIEW_SQL, [viewId]), deps.db.query(FIGHT_NARRATIVES_SQL, []), readWarCoin(deps.db, Date.now())]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;
  return json(200, { tick: tickNumber(view['tick']), stories: await withPictureFiles(deps.db, rows.map(payloadOf)), provenance: columnOf(view, 'provenance'), warCoin });
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
/** One feed of single posts — `fyp` or `popular` — handed over verbatim. */
async function rising(feedId: string, deps: Deps): Promise<Reply> {
  /* Two round trips, not four: the frame and its rows together, then the cards' two additions together. */
  const [views, rows] = await Promise.all([deps.db.query(RISING_VIEW_SQL, [feedId]), deps.db.query(RISING_ROWS_SQL, [feedId])]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;

  /* The English of each post written in another language (translations.ts, 0081), and the real narrative it is part of (story-tags.ts). */
  return json(200, { tick: tickNumber(view['tick']), posts: await withCardAdditions(deps.db, rows.map(payloadOf)) });
}

/**
 * A feed's cards with their English (translations.ts), their narrative (story-tags.ts), our copy
 * of their picture (post-pics.ts), the face of the account a card quotes (quote-faces.ts) and the
 * video the card can play (card-video.ts), the five reads sent at once. Each leaves a card it adds nothing
 * to as the same object, so the answers are put together card by card.
 */
async function withCardAdditions(db: Deps['db'], cards: readonly unknown[]): Promise<readonly unknown[]> {
  const [translated, tagged, files, faces, videos] = await Promise.all([withTranslations(db, cards), withStoryTags(db, cards), pictureFiles(db, cards.flatMap(pictureLinks)), quoteFaces(db, cards), withCardVideos(db, cards)]);
  return translated.map((card, i) => {
    const tag = tagged[i];
    const withTag = tag === cards[i] || typeof tag !== 'object' || tag === null ? card : { ...(card as Record<string, unknown>), inStory: (tag as Record<string, unknown>)['inStory'] };
    const video = videos[i] === cards[i] ? undefined : (videos[i] as Record<string, unknown> | undefined)?.['video'];
    const out = video === undefined ? withTag : { ...(withTag as Record<string, unknown>), video };
    return withQuoteFace(withFile(out, files), faces);
  });
}

/**
 * Only the feed's tick: the phone's 30-second backup check while For You is open (live feed,
 * mobile/src/features/feed/useLiveFeed.ts). One indexed single-row read and a dozen bytes, so a
 * phone can ask twice a minute for nearly nothing and fetch the whole feed only when the tick has
 * moved past the one it holds. Same 404 as the feed for a feed that was never projected.
 */
async function risingTick(feedId: string, deps: Deps): Promise<Reply> {
  const views = await deps.db.query(RISING_VIEW_SQL, [feedId]);
  const view = views[0];
  if (view === undefined) return NOT_FOUND;
  return json(200, { tick: tickNumber(view['tick']) });
}

/**
 * GET /rising/:feedId/older?before=<cursor> — the infinite scroll under the frame (feed-page.ts);
 * For You's first page takes `?after=<post id>`, the card the phone shows last, instead.
 * A feed with no scroll is a 404; so is a database the scroll's table has not reached yet, which
 * tells the phone to stop asking rather than claiming there is nothing older.
 */
async function risingOlder(feedId: string, rawUrl: string, deps: Deps): Promise<Reply> {
  if (!FEED_PAGE_FEEDS.includes(feedId)) return NOT_FOUND;
  const query = new URLSearchParams(rawUrl.split('?')[1] ?? '');
  const before = query.get('before');
  const cursor = parseCursor(before);
  if (cursor === null) return BAD_REQUEST;
  const nowMs = Date.now();
  try {
    let rows: readonly Row[];
    if (feedId === 'fyp') {
      /* No cursor: the first page, under the phone's last card or else the frame's oldest. */
      const from = before === null || before === '' ? startCursor(await deps.db.query(FOR_YOU_START_SQL, [query.get('after') ?? ''])) : cursor;
      rows = await deps.db.query(FOR_YOU_PAGE_SQL, [new Date(from.atMs).toISOString(), from.id, FEED_PAGE_SIZE, forYouKeptFrom(nowMs)]);
    } else rows = await deps.db.query(FEED_PAGE_SQL, [feedId, new Date(cursor.atMs).toISOString(), cursor.id, FEED_PAGE_SIZE]);
    const page = feedPage(rows, nowMs);
    return json(200, { ...page, posts: await withCardAdditions(deps.db, page.posts) });
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return NOT_FOUND;
    throw e;
  }
}

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
 * A coin route's reply; when it does not know the coin, the coin is looked up by its address once
 * (search.ts `open`) and the route asked again. Null: no source lists it either.
 */
async function orOpened<T>(assetKey: string, deps: Deps, answer: () => Promise<T | null>): Promise<T | null> {
  const first = await answer();
  if (first !== null || deps.search === undefined) return first;
  return (await deps.search.open(assetKey)) ? answer() : null;
}

/**
 * The whole router.
 *
 * Every throw below this line — a driver error, a broken projection, a permission
 * the app role does not have — lands in the one catch and becomes an opaque 500. A
 * route that wanted to explain itself to the caller would have to be written to do
 * so deliberately, which is the right amount of friction.
 */
export async function handle(method: string, rawUrl: string, deps: Deps, client = ''): Promise<Reply> {
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

    if (segments.length === 3 && head === 'coin' && param !== undefined && segments[2] === 'market' && deps.market !== undefined) {
      const tf = new URLSearchParams(rawUrl.split('?')[1] ?? '').get('tf');
      const search = deps.search;
      const recent = search === undefined ? {} : { recent: (address: string) => search.recent(address) !== null };
      const market = deps.market;
      return (await orOpened(param, deps, () => coinMarket(param, tf, { ...market, ...recent, db: deps.db, log: deps.log }))) ?? NOT_FOUND;
    }

    if (segments.length === 3 && head === 'coin' && param !== undefined && segments[2] === 'about' && deps.about !== undefined) {
      const search = deps.search;
      const recent = search === undefined ? {} : { recent: (address: string) => search.recent(address) !== null };
      const about = deps.about;
      return (await orOpened(param, deps, () => coinAbout(param, { ...about, ...recent, db: deps.db, log: deps.log }))) ?? NOT_FOUND;
    }

    /* What happened to past launches that opened like this one: the Info tab's odds block (launch-odds.ts). */
    if (segments.length === 3 && head === 'coin' && param !== undefined && segments[2] === 'odds') {
      const odds = await (deps.launchOdds ?? createLaunchOdds())(param, deps.db);
      return odds === null ? NOT_FOUND : json(200, odds);
    }

    /* What fomo's traders wrote about this coin: chart bubbles and the theses section (theses.ts). */
    if (segments.length === 3 && head === 'coin' && param !== undefined && segments[2] === 'theses') {
      const address = param.startsWith('solana:') ? param.slice('solana:'.length) : null;
      if (address === null || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return NOT_FOUND;
      const minUsdRaw = new URLSearchParams(rawUrl.split('?')[1] ?? '').get('min_usd');
      const minUsd = minUsdRaw !== null && /^\d+$/.test(minUsdRaw) ? parseInt(minUsdRaw, 10) : undefined;
      return json(200, deps.theses === undefined ? { theses: null, why: 'not_configured' } : await deps.theses(address, minUsd));
    }

    /* A wallet's fixed deposit address on another chain, and what has arrived through it (deposits.ts). */
    if (segments.length === 3 && head === 'deposit' && param !== undefined && (segments[2] === 'address' || segments[2] === 'arrivals')) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(param)) return NOT_FOUND;
      const q = new URLSearchParams(rawUrl.split('?')[1] ?? '');
      const notConfigured = { kind: 'missing', why: 'not_configured' };
      if (segments[2] === 'address') {
        const chain = q.get('chain');
        if (!isDepositChain(chain)) return BAD_REQUEST;
        return json(200, deps.deposits === undefined ? notConfigured : await deps.deposits.address(param, chain));
      }
      const address = q.get('address');
      if (address === null || !/^[A-Za-z0-9:._-]{20,120}$/.test(address)) return BAD_REQUEST;
      return json(200, deps.deposits === undefined ? notConfigured : await deps.deposits.arrivals(address));
    }

    if (deps.tradeCard !== undefined && segments.length === 3 && head === 'sell' && param !== undefined && segments[2] === 'card') {
      return await deps.tradeCard.card(param, client);
    }
    if (deps.wallet !== undefined && segments.length === 3 && head === 'wallet' && param !== undefined && segments[2] === 'catches') {
      return await deps.wallet.catches(param, client);
    }
    if (deps.wallet !== undefined && segments.length === 3 && head === 'wallet' && param !== undefined && segments[2] === 'history') {
      return await deps.wallet.history(param, new URLSearchParams(rawUrl.split('?')[1] ?? '').get('range'), client);
    }
    if (deps.wallet !== undefined && segments.length === 2 && head === 'wallet' && param !== undefined) {
      return await deps.wallet.wallet(param, new URLSearchParams(rawUrl.split('?')[1] ?? '').get('range'), client);
    }

    /* One feed post as the phone's post sheet shows it (post-sheet.ts). */
    if (deps.postSheet !== undefined && segments.length === 3 && head === 'post' && param !== undefined && segments[2] === 'sheet') {
      return await deps.postSheet.sheet(param);
    }
    /* A narrative page's posts with their readings, and its coins (story-sheet.ts). */
    if (deps.postSheet !== undefined && segments.length === 3 && head === 'story' && param !== undefined && segments[2] === 'sheet') {
      const posts = new URLSearchParams(rawUrl.split('?')[1] ?? '').get('posts');
      const id = await pageIdOf(param, deps);
      if (posts !== null) return await deps.postSheet.storyPosts(id, posts.split(','));
      return await deps.postSheet.story(id);
    }

    if (deps.search !== undefined) {
      if (segments.length === 1 && head === 'search') return await deps.search.search(new URLSearchParams(rawUrl.split('?')[1] ?? '').get('q'), client);
      if (segments.length === 2 && head === 'coin' && param !== undefined) {
        const search = deps.search;
        return (await orOpened(param, deps, () => search.facts(param))) ?? NOT_FOUND;
      }
      if (segments.length === 2 && head === 'ticker' && param !== undefined) return await deps.search.ticker(param, client);
      /* An unsure feed post's same-named coins: what "See 3 coins" opens (same-name.ts). */
      if (segments.length === 3 && head === 'post' && param !== undefined && segments[2] === 'coins') return await deps.search.postCoins(param, client);
      /* A feed post's name ideas for Create, and the coins already using a ticker (name-ideas.ts). */
      if (segments.length === 3 && head === 'post' && param !== undefined && segments[2] === 'names') return await deps.search.postNames(param, client);
      if (segments.length === 3 && head === 'ticker' && param !== undefined && segments[2] === 'coins') return await deps.search.tickerCoins(param, client);
    }

    if (segments.length === 3 && head === 'rising' && param !== undefined && segments[2] === 'tick') return await risingTick(param, deps);
    /* For You by Trending or Most viewed (post-sorts.ts), a page at a time. Only For You has them. */
    if (segments.length === 3 && head === 'rising' && param === 'fyp' && segments[2] === 'sorted') {
      const sort = parseSort(rawUrl);
      if (sort === null) return BAD_REQUEST;
      const reply = await (deps.sorts ?? createSorts())(deps.db, sort.by, sort.window, sort.cursor);
      return reply === null ? NOT_FOUND : json(200, reply);
    }
    if (segments.length === 3 && head === 'rising' && param !== undefined && segments[2] === 'older') return await risingOlder(param, rawUrl, deps);

    /* Every narrative, dead ones included, a page at a time: the tab's All time list. */
    if (segments.length === 3 && head === 'narratives' && param !== undefined && segments[2] === 'all') return await allNarratives(param, rawUrl, deps);
    /* The online meme wars between countries: the tab's umbrella. */
    if (segments.length === 3 && head === 'narratives' && param !== undefined && segments[2] === 'fights') return await fightNarratives(param, deps);

    /* The running coins strip on For You and the Narratives tab (running-coins.ts). */
    if (segments.length === 2 && head === 'running' && param === 'coins') return json(200, await (deps.runningCoins ?? createRunningCoins())(deps.db));

    if (segments.length === 2 && param !== undefined) {
      if (head === 'board') return await board(param, deps);
      if (head === 'story') return await story(param, deps);
      if (head === 'narratives') return await narratives(param, deps);
      if (head === 'launches') return await launches(param, deps);
      if (head === 'rising') return await rising(param, deps);
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
