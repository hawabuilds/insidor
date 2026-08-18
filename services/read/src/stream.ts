/**
 * THE LIVE CHANNEL, as Server-Sent Events. One HTTP response that never finishes.
 *
 * WHY SSE AND NOT A WEBSOCKET. The channel is strictly one-way — the browser sends nothing
 * up it, it refetches over the `GET /board/:viewId` that already exists — so bidirectionality
 * buys nothing and costs a runtime dependency in the one package whose entire argument is
 * "three SELECTs, one driver, nothing else to audit" (queries.ts). It costs more than that,
 * in fact: a WebSocket handshake is not subject to the same-origin policy, so the exact-match
 * origin allowlist in server.ts would stop applying and origin checking would become
 * something this code does by hand. It also needs a reconnect loop with backoff, jitter and a
 * liveness ping, written by us, and the reconnect path is the one this product has already
 * got wrong once. SSE is an ordinary HTTP/1.1 GET whose body never ends, it traverses
 * anything that speaks HTTP, and the browser's own EventSource reconnects automatically.
 *
 * ★ THE ONE RULE THIS FILE EXISTS TO HOLD: BROADCAST HAS NO REPLAY. There is no buffer here
 * and there must never be one. A client that was disconnected for a minute did not miss
 * "some events it can catch up on" — it missed an unknown set of frames, and the only
 * correct repair is to re-read the board authoritatively. So every path back to health ends
 * in a `ready` event, and `ready` is what the app turns into a refetch:
 *
 *     a browser connects or reconnects        → `ready` on attach
 *     the database listener (re)subscribes    → `ready` to everyone
 *
 * Deliberately absent: `id:` fields. EventSource replays a `Last-Event-ID` header on
 * reconnect, and honouring it would be promising a replay buffer that does not exist.
 * Emitting an id would invite somebody to implement partial catch-up later and reintroduce
 * exactly the silent-hole failure the refetch is here to prevent. The refetch IS the replay.
 *
 * ★ WHAT A SLOW CLIENT GETS: DISCONNECTED, NOT QUEUED. A board frame is a whole committed
 * board; an older one is worthless the moment a newer one exists. So a socket that is not
 * draining keeps exactly one pending chunk — the newest — and past a bounded number of
 * dropped chunks, or a bounded stall, it is destroyed. That is not data loss: the recovery
 * for a destroyed client is identical to the recovery for a dropped one, because EventSource
 * reconnects and the `ready` on attach forces the refetch. Buffering for a reader who has
 * stopped reading is how a read surface runs out of memory on behalf of one bad connection.
 *
 * NOTHING IN THIS FILE COMPUTES A BOARD. It calls the same `board()` the polled route calls,
 * which runs the same two frozen SELECTs under the same app credential and returns the same
 * already-censored payload. The live path and the polled path cannot disagree, because there
 * is only one of them.
 */

import { errorText } from './log.ts';
import { board, type Deps, type Reply } from './routes.ts';
import { BOARD_VIEW_SQL } from './queries.ts';

/**
 * The slice of `node:http`'s ServerResponse this file uses. Narrow on purpose: it is what
 * lets every property above be asserted against a plain object in stream.test.ts, with no
 * socket, no port and no database. A real ServerResponse satisfies it structurally.
 */
export interface StreamSink {
  writeHead(status: number, headers: Readonly<Record<string, string>>): unknown;
  write(chunk: string): boolean;
  end(chunk?: string): unknown;
  destroy(): unknown;
  on(event: 'close' | 'drain' | 'error', listener: () => void): unknown;
  /** Present on a real response; absent on a test double, hence optional. */
  setTimeout?(ms: number): unknown;
}

export interface BoardStream {
  /** The view id this request wants to stream, or null if it is not a stream request. */
  match(method: string, rawUrl: string): string | null;
  /**
   * Serve one client. Never rejects — a failure is answered on the socket, because a
   * rejected promise here would reach main.ts's unhandledRejection handler and take the
   * whole read surface down for one malformed request.
   */
  attach(sink: StreamSink, viewId: string, headers: Readonly<Record<string, string>>): Promise<void>;
  /** A new frame was committed for this view. Re-reads it and pushes it to that view's clients. */
  publish(viewId: string): void;
  /** The database listener is subscribed. Every client refetches, because we may have missed frames. */
  linkUp(): void;
  /** The database listener lost its connection. Every client is told it is no longer live. */
  linkDown(): void;
  /** How many clients are attached. For the log line and for tests. */
  size(): number;
  /** Ends every stream and stops the heartbeat. */
  close(): void;
}

export interface StreamOptions {
  /**
   * How often a beat is sent. Three things need it and all three are real: proxies close
   * connections they think are idle (ALB defaults to 60s, Cloudflare around 100), nginx
   * buffers a response until something flushes it, and — the one that matters most — a
   * half-open socket answers every liveness check while delivering nothing. The beat is a
   * NAMED EVENT rather than the conventional `:` comment precisely because of the third:
   * a comment is invisible to EventSource, so a client watching for silence could never
   * see one. See app/src/shared/api/live/channel.ts, which times out on its absence.
   */
  readonly heartbeatMs?: number;
  /**
   * How long a client may leave the socket un-drained before it is disconnected. Generous
   * — longer than a heartbeat — so that a merely slow reader is not killed for being slow.
   */
  readonly stallMs?: number;
  /**
   * How many chunks a blocked client may fail to take before it is disconnected. By this
   * point it is several frames behind and would refetch on the tick gap anyway.
   */
  readonly maxBehind?: number;
  /**
   * A ceiling on attached clients. Each one costs a socket and at most one pending string,
   * so the memory is bounded either way; this bounds the file descriptors. A refused client
   * gets a 503 it can retry, which is a truthful answer, unlike a stream that connects and
   * then starves.
   */
  readonly maxClients?: number;
}

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_STALL_MS = 30_000;
const DEFAULT_MAX_BEHIND = 8;
const DEFAULT_MAX_CLIENTS = 512;

/** The retry delay EventSource uses after a drop. Sent once, on open. */
const RETRY_MS = 3_000;

/* The fixed replies this endpoint can give instead of a stream. Same discipline as
   routes.ts: a failure names no table, no statement and no view that does exist. */
const JSON_TYPE = 'application/json; charset=utf-8';
const NOT_FOUND_BODY = '{"error":"not found"}';
const SERVER_ERROR_BODY = '{"error":"server error"}';
const BUSY_BODY = '{"error":"too many streams"}';

/**
 * One SSE record. `data` is written on a single line, which is safe for every payload this
 * file sends: `JSON.stringify` escapes U+000A and U+000D inside strings, so a serialised
 * board frame cannot contain the blank line that would end the record early.
 */
function record(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/** Delivered to the app as `onSubscribed`, whose only job is to force an authoritative refetch. */
const READY = record('ready', '1');
/** Delivered to the app as `onDropped`. The board is no longer being told when it changes. */
const HOLD = record('hold', '1');
/** Liveness only. Carries no board state and is never queued for a blocked client. */
const BEAT = record('beat', '1');

interface Subscriber {
  readonly sink: StreamSink;
  readonly viewId: string;
  /** The socket's buffer is full; nothing may be written until it drains. */
  blocked: boolean;
  /** At most one chunk, always the newest. An older board frame is worth nothing. */
  pending: string | null;
  /** How many chunks this client has failed to take since it blocked. Not how many are held. */
  behind: number;
  gone: boolean;
  stall: ReturnType<typeof setTimeout> | undefined;
}

export function createBoardStream(deps: Deps, options: StreamOptions = {}): BoardStream {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS;
  const maxBehind = options.maxBehind ?? DEFAULT_MAX_BEHIND;
  const maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;

  const subscribers = new Set<Subscriber>();
  /**
   * Attaches that have passed the ceiling but have not reached `subscribers` yet.
   *
   * ★ WITHOUT THIS THE CEILING IS NOT A CEILING. `attach` awaits a view-existence read
   * before it adds anybody, and `subscribers.size` does not move until that read comes
   * back — so every client that arrives during the round trip measures a set that still
   * holds none of them. That is not a rare interleaving: it is precisely the population
   * `maxClients` exists to refuse, because the moment every browser attaches at once is
   * the moment the read surface restarts and a thousand EventSources reconnect together.
   * Measured against a cap of 8: two hundred simultaneous attaches, two hundred admitted,
   * none refused. Counted here, the reservation is taken before the await and released
   * before the subscriber is added, and nothing between them yields.
   */
  let reserved = 0;
  /** Views with a frame build in flight, so a burst of notifications is one SELECT, not N. */
  const building = new Set<string>();
  /** Views that were notified while their build was in flight and must be rebuilt once. */
  const restack = new Set<string>();

  /**
   * Whether the database listener currently holds its subscription. A client attaching while
   * this is false is told `hold` immediately rather than being shown a live pip over a board
   * nothing is feeding — the failure this whole status line exists to make visible.
   */
  let linked = false;
  let closed = false;

  function drop(sub: Subscriber): void {
    if (sub.gone) return;
    sub.gone = true;
    clearTimeout(sub.stall);
    sub.stall = undefined;
    subscribers.delete(sub);
    /* destroy, not end: a client whose socket will not drain is not going to read a polite
       final chunk either, and `end` on a full buffer waits for a drain that is not coming. */
    try {
      sub.sink.destroy();
    } catch {
      /* Already torn down by the platform. Nothing to do and nothing to report. */
    }
  }

  function armStall(sub: Subscriber): void {
    if (sub.stall !== undefined) return;
    const timer = setTimeout(() => {
      deps.log.info('stream client stalled', { view: sub.viewId, behind: sub.behind });
      drop(sub);
    }, stallMs);
    /* Unref'd so a stalled client's timer cannot hold the process open through a shutdown. */
    timer.unref?.();
    sub.stall = timer;
  }

  /**
   * `liveness` chunks (the beat) are never queued: a blocked socket is by definition not
   * idle, so proving the connection is alive to a reader who is not reading is pointless,
   * and queuing one could displace a pending frame.
   */
  function send(sub: Subscriber, chunk: string, liveness = false): void {
    if (sub.gone) return;

    if (sub.blocked) {
      if (liveness) return;
      /* Only the newest chunk is kept. Whatever it displaces is gone, and that is the whole
         policy: a board frame that has been superseded is not worth a byte of memory. */
      sub.pending = chunk;
      sub.behind += 1;
      if (sub.behind > maxBehind) {
        deps.log.info('stream client fell too far behind', { view: sub.viewId, behind: sub.behind });
        drop(sub);
      }
      return;
    }

    let accepted = false;
    try {
      accepted = sub.sink.write(chunk);
    } catch (e: unknown) {
      deps.log.error('stream write failed', { view: sub.viewId, err: errorText(e) });
      drop(sub);
      return;
    }
    if (!accepted) {
      sub.blocked = true;
      armStall(sub);
    }
  }

  function onDrain(sub: Subscriber): void {
    if (sub.gone) return;
    sub.blocked = false;
    clearTimeout(sub.stall);
    sub.stall = undefined;
    const pending = sub.pending;
    sub.pending = null;
    sub.behind = 0;
    if (pending !== null) send(sub, pending);
  }

  function broadcast(chunk: string, viewId: string | null, liveness = false): void {
    for (const sub of subscribers) {
      if (viewId !== null && sub.viewId !== viewId) continue;
      send(sub, chunk, liveness);
    }
  }

  function watching(viewId: string): boolean {
    for (const sub of subscribers) if (sub.viewId === viewId) return true;
    return false;
  }

  function refuse(sink: StreamSink, status: number, body: string, headers: Readonly<Record<string, string>>): void {
    sink.writeHead(status, { ...headers, 'content-type': JSON_TYPE });
    sink.end(body);
  }

  /**
   * Re-read the committed frame for one view and push it.
   *
   * A standalone function rather than a method on the returned object, because it calls
   * itself to drain `restack` and a `this.publish` would break the moment a caller
   * destructured it — which server.ts and the tests both do.
   */
  function publish(viewId: string): void {
    if (closed) return;
    /* Nobody is watching this view, so there is nothing to read it for. This is also what
       bounds the cost of a forged notification: anything holding the app credential can
       announce any view — LISTEN/NOTIFY has no privilege model in Postgres — and with no
       subscriber that buys exactly zero queries. */
    if (!watching(viewId)) return;

    if (building.has(viewId)) {
      /* A burst of notifications must not become a burst of SELECTs. The newest committed
         frame is the only one worth reading, and one rebuild after this one gets it. */
      restack.add(viewId);
      return;
    }
    building.add(viewId);

    board(viewId, deps)
      .then((reply: Reply) => {
        if (reply.status !== 200) {
          /* The view existed when the client attached and does not now. Nothing goes on the
             wire: the next successful frame arrives with a tick more than one ahead, the
             client sees the hole and refetches. A fabricated frame would be worse. */
          deps.log.error('a committed frame could not be read', { view: viewId, status: reply.status });
          return;
        }
        broadcast(record('frame', reply.body), viewId);
      })
      .catch((e: unknown) => {
        deps.log.error('a committed frame could not be read', { view: viewId, err: errorText(e) });
      })
      .finally(() => {
        building.delete(viewId);
        if (restack.delete(viewId)) publish(viewId);
      });
  }

  /* One timer for every client, not one per client. It also doubles as the flush that stops
     an intermediary holding a quiet board's response in a buffer. */
  const beat = setInterval(() => broadcast(BEAT, null, true), heartbeatMs);
  beat.unref?.();

  return {
    match(method, rawUrl) {
      if (method !== 'GET') return null;
      const path = rawUrl.split('?')[0] ?? '/';
      let segments: readonly string[];
      try {
        segments = path.split('/').filter((s) => s !== '').map(decodeURIComponent);
      } catch {
        /* A malformed escape is a malformed request, not a stream request. server.ts hands
           it to `handle`, which answers 400 — the same answer the polled routes give. */
        return null;
      }
      const [head, kind, viewId] = segments;
      if (segments.length !== 3 || head !== 'stream' || kind !== 'board' || viewId === undefined) return null;
      return viewId;
    },

    async attach(sink, viewId, headers) {
      if (closed) {
        refuse(sink, 503, BUSY_BODY, headers);
        return;
      }
      /* The reservation, not the count. See `reserved` above: the count alone is blind to
         every client already inside the existence read, which is all of them during the one
         event this ceiling is for. */
      if (subscribers.size + reserved >= maxClients) {
        deps.log.info('stream refused; at capacity', {
          view: viewId,
          clients: subscribers.size,
          opening: reserved,
        });
        refuse(sink, 503, BUSY_BODY, headers);
        return;
      }
      reserved += 1;

      /* Existence, before a single byte of stream. A view that has never been projected must
         get the same 404 the polled route gives it — a stream that opens for an unknown view
         is a green pip over a board that will never arrive, which is precisely the lie the
         status line is being rebuilt to stop telling. One indexed single-row read. */
      try {
        const views = await deps.db.query(BOARD_VIEW_SQL, [viewId]);
        if (views[0] === undefined) {
          refuse(sink, 404, NOT_FOUND_BODY, headers);
          return;
        }
      } catch (e: unknown) {
        deps.log.error('stream could not be opened', { view: viewId, err: errorText(e) });
        refuse(sink, 500, SERVER_ERROR_BODY, headers);
        return;
      } finally {
        /* Released on every exit, refusals included, and released HERE rather than after the
           subscriber is added: everything between this line and `subscribers.add` is
           synchronous, so no other attach can observe the gap. Holding the reservation past
           an await would leak a slot on every 404. */
        reserved -= 1;
      }

      sink.writeHead(200, {
        ...headers,
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive',
        /* nginx buffers a proxied response by default and would hold events until a buffer
           filled — on a quiet board, indefinitely. This is the header it honours. */
        'x-accel-buffering': 'no',
      });
      /* No socket timeout: this response is meant to stay open for hours, and a platform
         default that closes an "idle" one would look exactly like a dropped connection. */
      sink.setTimeout?.(0);

      const sub: Subscriber = {
        sink,
        viewId,
        blocked: false,
        pending: null,
        behind: 0,
        stall: undefined,
        gone: false,
      };
      subscribers.add(sub);

      sink.on('close', () => drop(sub));
      sink.on('error', () => drop(sub));
      sink.on('drain', () => onDrain(sub));

      /* How long EventSource waits before reconnecting. Stated once so the reconnect cadence
         is ours rather than whatever the browser defaults to. */
      send(sub, `retry: ${RETRY_MS}\n\n`);

      /* ★ The refetch trigger, on EVERY attach — first connection and every reconnect alike.
         This is the line the previous build did not have: it resumed its subscription and
         issued no refetch, so every row that changed during the outage stayed invisible.
         If the listener is down we say `hold` instead, because promising liveness we cannot
         deliver is worse than admitting the gap. */
      send(sub, linked ? READY : HOLD);

      deps.log.info('stream attached', { view: viewId, clients: subscribers.size, linked });
    },

    publish,

    linkUp() {
      if (linked || closed) return;
      linked = true;
      /* ★ NOTIFY has no replay either. Notifications that fired while the listener was
         disconnected are gone, so a listener that resubscribes and says nothing is the same
         silent-hole bug one layer down. Every attached client refetches. */
      deps.log.info('stream link up', { clients: subscribers.size });
      broadcast(READY, null);
    },

    linkDown() {
      if (!linked || closed) return;
      linked = false;
      /* Told immediately rather than left to a timeout: the browser's socket is still open
         and still beating, so nothing else about this connection would look different. */
      deps.log.info('stream link down', { clients: subscribers.size });
      broadcast(HOLD, null);
    },

    size: () => subscribers.size,

    close() {
      if (closed) return;
      closed = true;
      clearInterval(beat);
      for (const sub of [...subscribers]) {
        clearTimeout(sub.stall);
        sub.gone = true;
        subscribers.delete(sub);
        try {
          sub.sink.end();
        } catch {
          /* The socket is already gone; shutting down is not the time to care. */
        }
      }
    },
  };
}
