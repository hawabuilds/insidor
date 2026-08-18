/**
 * HOW THIS SERVICE LEARNS THAT A FRAME EXISTS: one dedicated LISTEN, held for the life of
 * the process, with a reconnect loop.
 *
 * ★ IT CANNOT LIVE ON THE POOL, AND THAT IS THE DESIGN CONSTRAINT THE WHOLE FILE IS SHAPED
 * BY. `LISTEN` is SESSION state. main.ts's pool hands a backend out per query and reclaims
 * it, and `pg-pool` destroys an idle client after ten seconds — so a LISTEN taken on a
 * pooled client works for about ten seconds and then stops working SILENTLY: no error, no
 * event, no closed connection, just a subscription that is quietly gone while every liveness
 * check still answers yes. This is a measured property of that pool, not a caution. Hence a
 * dedicated `Client` outside the pool, owned for the process lifetime.
 *
 * The same reasoning rules out a transaction-mode pooler in front of this service. It
 * releases a different backend per statement and the subscription evaporates the same way.
 * store/src/client.ts exempts the app role from its session-mode check on the grounds that
 * "the app is read-only and stateless" — true of the pool, and no longer true of this
 * connection.
 *
 * ★ ONE CONNECTION PER PROCESS, NOT ONE PER BROWSER. Every attached client is fanned out to
 * in memory by stream.ts. A database connection per viewer would exhaust `max_connections`
 * at a couple of hundred readers, which is not a scale worth failing at.
 *
 * ★ NOTIFY HAS NO REPLAY EITHER, so a reconnect is not a resumption. Notifications that
 * fired while this connection was down are gone — Postgres queues them per listening
 * session and drops the queue with the session. So `onListening` fires on EVERY successful
 * subscribe, not just the first, and stream.ts turns it into a `ready` for every browser,
 * which the app turns into an authoritative refetch. Silence on reconnect here is the
 * previous build's bug, one layer below where it was found.
 *
 * ★ THE PAYLOAD IS UNTRUSTED. Postgres has no privilege model for LISTEN/NOTIFY at all —
 * no GRANT, no object to grant on — so any role that can open a connection can forge a
 * notification on this channel, including the app role this process itself holds. That is
 * survivable for exactly one reason: the payload names a view and a frame number, and
 * acting on it re-runs a SELECT this connection is already entitled to make. A forged
 * notification buys an extra read of a public board, not a leak. It is still parsed
 * defensively below, because a payload that is not our shape is a payload written by
 * something that is not our projector.
 *
 * The connection this file opens is the SAME app credential as the pool. There is no second
 * connection string in this service and there must never be one; see config.ts.
 */

import { errorText, type Logger } from './log.ts';

/**
 * The channel, as a constant, because a channel name is a SQL IDENTIFIER and cannot be a
 * bound parameter — `LISTEN $1` is a syntax error. Interpolating a view id here would put a
 * value from a browser's URL into a statement, and "a path parameter is never interpolated
 * into SQL" is a property routes.ts tests rather than promises. So there is one channel, and
 * the view id travels in the payload where it is data.
 *
 * services/project/src/notify.ts holds the same string. Two constants rather than a shared
 * import, because this package declares NO workspace dependency — importing @insidor/store
 * would put `createPool('internal')` one identifier away from the process the browser talks
 * to, and that absence is this package's entire safety argument.
 */
export const BOARD_CHANNEL = 'insidor_board';

/**
 * A view id longer than this is not ours. The cap exists because the payload is untrusted
 * and the value is used as a Map key against attached clients; a bound is cheaper than
 * reasoning about what an unbounded one could cost.
 */
const MAX_VIEW_ID_LENGTH = 200;

/**
 * The slice of a `pg` Client this file uses. Narrow on purpose: it is what lets the
 * reconnect loop, the backoff and the payload parsing be tested with a fake, in memory, with
 * no database — which matters here more than anywhere else in the service, because the
 * behaviour worth proving is what happens when the database goes away.
 *
 * main.ts holds the twenty lines that adapt a real Client to this.
 */
export interface ListenSocket {
  connect(): Promise<void>;
  /** Issues `LISTEN <channel>`. The channel is an identifier and is never a parameter. */
  listen(channel: string): Promise<void>;
  onNotification(handler: (payload: string | null) => void): void;
  /** Fired at most once, for whichever of error/end happens first. */
  onClosed(handler: (reason: string) => void): void;
  end(): Promise<void>;
}

export interface NotifierDeps {
  /** Opens a fresh socket. Called again on every reconnect — a closed pg Client cannot be reused. */
  readonly open: () => ListenSocket;
  readonly log: Logger;
  /** A board frame was announced. `tick` is informational; the frame is re-read, never trusted from here. */
  readonly onFrame: (viewId: string, tick: number) => void;
  /** The subscription is live. Fires on EVERY subscribe, including every reconnect. */
  readonly onListening: () => void;
  /** The subscription is gone. Fires on the first loss and not again until it is regained. */
  readonly onLost: () => void;
}

export interface NotifierOptions {
  readonly minBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /**
   * How long a subscription must survive before it counts as a real one and earns the
   * backoff back. See `stableMs` below for why a subscription that dies faster than this
   * must NOT reset it.
   */
  readonly stableMs?: number;
  /** Injected so a test can assert the backoff schedule instead of tolerating it. */
  readonly random?: () => number;
  /** The clock, injected, so a test can state the time rather than sleep through it. */
  readonly now?: () => number;
}

export interface Notifier {
  start(): void;
  close(): Promise<void>;
}

/** Fast enough that a database restart is invisible; slow enough not to hammer one that is down. */
const DEFAULT_MIN_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 10_000;

/**
 * ★ HOW LONG A SUBSCRIPTION HAS TO LAST BEFORE IT COUNTS AS ONE.
 *
 * The backoff above only ever protected against a database that REFUSES connections. It did
 * nothing about the far commoner failure, which is a database that accepts them and then
 * drops them: a failover in progress, a pooler recycling backends, an `idle_session_timeout`,
 * a connection killer. Every one of those subscribes successfully, so resetting the attempt
 * counter on `LISTEN` succeeding meant the counter was always zero and the delay was always
 * the floor. Measured against a backend terminated every 150ms: thirty-one subscriptions in
 * seven hundred milliseconds, every gap at the floor, no growth at all.
 *
 * ★ AND THE COST IS NOT THE RECONNECTS. It is that every successful subscribe is an
 * `onListening`, which stream.ts turns into `ready` for every attached browser, which the app
 * turns into an authoritative refetch of the whole board — correctly, because NOTIFY has no
 * replay. Measured end to end against the running service: ONE browser issued fifteen full
 * board reads in seven seconds of flapping. At five hundred browsers that is seven and a half
 * thousand reads through a pool of five connections, aimed at a database that is already
 * unwell. The flap is the trigger and the refetch fan-out is the amplifier, so the bound has
 * to go on the trigger.
 *
 * Thirty seconds because it has to be comfortably longer than the maximum backoff — a window
 * shorter than the delay it gates could be satisfied by the waiting rather than by the
 * subscription being healthy, and the counter would decay to zero again.
 */
const DEFAULT_STABLE_MS = 30_000;

/**
 * What the projector announces. Anything else is discarded, loudly enough to find and
 * quietly enough that a stream of forged payloads cannot fill a disk.
 *
 * `tick` is validated and then not used to decide anything: the frame is re-read from the
 * table. A number from an untrusted payload deciding what a client sees would be exactly the
 * mistake the rest of this service is arranged to prevent.
 */
export function parseAnnouncement(payload: string | null): { view: string; tick: number } | null {
  if (payload === null || payload === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const view = record['view'];
  const tick = record['tick'];
  if (typeof view !== 'string' || view === '' || view.length > MAX_VIEW_ID_LENGTH) return null;
  if (typeof tick !== 'number' || !Number.isSafeInteger(tick) || tick < 0) return null;
  return { view, tick };
}

export function createNotifier(deps: NotifierDeps, options: NotifierOptions = {}): Notifier {
  const minBackoffMs = options.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const stableMs = options.stableMs ?? DEFAULT_STABLE_MS;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  let socket: ListenSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let listening = false;
  /** When the current subscription came up. 0 while there is not one. */
  let listeningSince = 0;
  let stopped = false;
  /* Every socket gets a generation. A late error from a socket we already abandoned must not
     schedule a second reconnect — that is how one dropped connection becomes two loops. */
  let generation = 0;

  function scheduleReconnect(): void {
    if (stopped || retry !== undefined) return;
    /* Exponential, capped, with full jitter. The jitter is not decoration: without it every
       reader in a fleet reconnects to a recovering database in the same millisecond. */
    const ceiling = Math.min(maxBackoffMs, minBackoffMs * 2 ** attempt);
    const delay = minBackoffMs + random() * Math.max(0, ceiling - minBackoffMs);
    attempt += 1;
    const timer = setTimeout(() => {
      retry = undefined;
      void connect();
    }, delay);
    timer.unref?.();
    retry = timer;
  }

  function lost(reason: string, mine: number): void {
    if (stopped || mine !== generation) return;
    /* Bump first, so anything else this socket emits belongs to a generation nobody is
       listening to any more. */
    generation += 1;
    const abandoned = socket;
    socket = null;
    if (listening) {
      /* ★ THE BACKOFF IS EARNED, NOT GRANTED BY A SUCCESSFUL HANDSHAKE. A subscription that
         lasted is proof the database is well and the next drop deserves a fast retry; one
         that died in milliseconds is proof of the opposite, and resetting on it is what made
         the backoff a no-op against a flapping backend. See DEFAULT_STABLE_MS. */
      if (now() - listeningSince >= stableMs) attempt = 0;
      listening = false;
      listeningSince = 0;
      deps.log.error('the board listener lost its subscription', { reason });
      deps.onLost();
    } else {
      deps.log.error('the board listener could not subscribe', { reason });
    }
    /* ★ END WHAT WE ARE ABANDONING. Two of the three ways into this function leave a socket
       that is still OPEN: `connect` reaches it when `listen()` throws, and a pg Client whose
       LISTEN was refused is connected, idle and holding a backend. Dropping the reference
       without ending it leaks one backend per reconnect attempt — at a floor of half a second
       that is `max_connections` inside an hour, and the read surface would then be unable to
       serve the board it is still trying to subscribe to. `end()` on an already-dead client
       resolves, so the third path costs nothing. */
    if (abandoned !== null) void abandoned.end().catch(() => {});
    scheduleReconnect();
  }

  async function connect(): Promise<void> {
    if (stopped || socket !== null) return;
    const mine = generation;
    const next = deps.open();
    socket = next;

    next.onClosed((reason) => lost(reason, mine));
    next.onNotification((payload) => {
      if (stopped || mine !== generation) return;
      const announcement = parseAnnouncement(payload);
      if (announcement === null) {
        /* Not our shape. Anyone who can open a connection can send this, so it is a fact
           about the world rather than a fault, and it is logged without the payload — an
           attacker-chosen string in our log lines is a second problem. */
        deps.log.error('an announcement arrived in a shape this service does not read');
        return;
      }
      deps.onFrame(announcement.view, announcement.tick);
    });

    try {
      await next.connect();
      await next.listen(BOARD_CHANNEL);
    } catch (e: unknown) {
      lost(errorText(e), mine);
      return;
    }
    if (stopped || mine !== generation) {
      /* We were closed, or the socket died, while the handshake was in flight. */
      await next.end().catch(() => {});
      return;
    }

    /* `attempt` is deliberately NOT reset here. A handshake succeeding says the database
       accepted a connection, which is exactly what a flapping one also does; the reset moved
       into `lost`, where the subscription's own lifetime is known. */
    listening = true;
    listeningSince = now();
    deps.log.info('the board listener is subscribed', { channel: BOARD_CHANNEL });
    /* ★ On EVERY subscribe, first or hundredth. Notifications that fired while this was down
       are gone, so a resumed subscription is not a resumed stream — every client downstream
       has to re-read the board rather than assume it kept up. */
    deps.onListening();
  }

  return {
    start() {
      if (stopped) return;
      void connect();
    },

    async close() {
      stopped = true;
      generation += 1;
      clearTimeout(retry);
      retry = undefined;
      const open = socket;
      socket = null;
      listening = false;
      listeningSince = 0;
      if (open !== null) await open.end().catch(() => {});
    },
  };
}
