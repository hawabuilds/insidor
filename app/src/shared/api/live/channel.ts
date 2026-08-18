/**
 * THE LIVE CHANNEL, client half. One EventSource, four callbacks, and a watchdog.
 *
 * The transport is Server-Sent Events because the channel is one-way — the board is read
 * over the `GET /board/:viewId` that already exists, and nothing is ever sent up this
 * connection — and because EventSource reconnects on its own. That last property is worth
 * more here than anywhere else in the app: the reconnect path is the one this product has
 * already got wrong once, and browser-supplied reconnect is reconnect code we cannot get
 * wrong a second time.
 *
 * ★ THE RULE THE PREVIOUS BUILD BROKE. Broadcast has no replay. A socket that goes away for
 * thirty seconds does not come back to a queue of missed frames — those frames are gone, and
 * every row that changed inside that window is silently wrong on screen until something
 * refetches. The previous build resumed its subscription, cancelled its fallback poll, and
 * issued no refetch. So: `onSubscribed` fires on the server's `ready` event, the server
 * sends `ready` on EVERY attach and on every recovery of its own database subscription, and
 * App.tsx turns `onSubscribed` into an authoritative refetch. Not on the first connect. On
 * every one.
 *
 * ★ WHY `ready` AND NOT EventSource's `open`. `open` means headers arrived. It does not mean
 * the server is in a position to tell us anything — its own database subscription may be
 * down, in which case the socket is perfectly healthy and completely useless. Firing
 * `onSubscribed` on `open` would put a live pip over a board nothing is feeding, which is
 * precisely the failure the status line is being rebuilt to stop telling. The server says
 * `ready` when it can actually deliver and `hold` when it cannot, and this file believes it
 * rather than the socket.
 *
 * ★ THE WATCHDOG, AND WHY THE HEARTBEAT IS A NAMED EVENT. A half-open TCP connection answers
 * every liveness check while delivering nothing: the socket is open, `readyState` is OPEN,
 * EventSource has no reason to reconnect, and no frame will ever arrive again. The only
 * detector is silence — so the server beats every fifteen seconds and this file gives up on
 * a stream that has said nothing for `silenceMs`. The conventional SSE heartbeat is a `:`
 * comment, which EventSource does not surface to JavaScript at all and which therefore could
 * not feed this timer; the server sends a named `beat` event instead, for exactly this.
 *
 * ★ NOTHING HERE DECODES AND NOTHING HERE CATCHES. `onTick` and `onPatch` are handed the
 * parsed message body as `unknown`; decoding happens at the app edge, where `decodeBoardTick`
 * throws `WireLeakError` if the projection leaked. Wrapping these calls in a try/catch to
 * keep the socket alive would convert a leak into a dropped frame and make the client
 * complicit in it — decode.ts says so, and this is the file that would have done it.
 */

/**
 * The four callbacks. Fixed before the transport existed, because `onSubscribed` is the
 * load-bearing one and its contract had to be written down before anyone could forget it.
 */
export interface LiveHandlers {
  readonly onTick: (raw: unknown) => void;
  readonly onPatch: (raw: unknown) => void;
  /** Fired on every (re)subscribe, so the caller can refetch authoritatively. */
  readonly onSubscribed: () => void;
  readonly onDropped: () => void;
}

export interface LiveChannel {
  close(): void;
}

/**
 * The slice of EventSource this file uses, so the whole channel can be tested against a
 * plain object with no browser, no socket and no server. `client.ts` adapts the real one in
 * about eight lines — the adapter is there rather than here so that the type of a DOM event
 * never reaches this logic.
 */
export interface EventStream {
  /** `listener` receives the event's `data` field, or an empty string for events without one. */
  addEventListener(type: string, listener: (data: string) => void): void;
  close(): void;
}

export type EventStreamFactory = (url: string) => EventStream;

export interface LiveChannelOptions {
  /**
   * How long a stream may say nothing at all before it is treated as dead and reopened.
   * Comfortably more than the server's heartbeat, so a late beat is not a reconnect, and
   * comfortably less than a person's patience for a board that stopped moving.
   */
  readonly silenceMs?: number;
}

const DEFAULT_SILENCE_MS = 50_000;

export function createLiveChannel(
  url: string,
  handlers: LiveHandlers,
  open: EventStreamFactory,
  options: LiveChannelOptions = {},
): LiveChannel {
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;

  let stream: EventStream | null = null;
  let silence: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  /**
   * Whether the SERVER has said it can deliver, not whether a socket is open. `onDropped`
   * is only owed to a caller that was previously told `onSubscribed`, so this also stops a
   * first-connect failure from being reported as a lost connection — the board was never
   * streaming, which is a different sentence and a different pip.
   */
  let subscribed = false;

  function dropped(): void {
    if (!subscribed) return;
    subscribed = false;
    handlers.onDropped();
  }

  /** Any byte from the server resets the clock. Silence is the only symptom a half-open socket has. */
  function heard(): void {
    clearTimeout(silence);
    if (closed) return;
    silence = setTimeout(() => {
      /* The socket claims to be fine and has delivered nothing for the whole window. It is
         not fine, and EventSource will never notice on its own, so it is torn down and
         reopened — which produces a fresh `ready` and therefore a fresh refetch. */
      dropped();
      reopen();
    }, silenceMs);
  }

  function reopen(): void {
    stream?.close();
    stream = null;
    if (closed) return;
    connect();
  }

  function connect(): void {
    const source = open(url);
    stream = source;

    /* Headers arrived. Not proof of anything except that the server is answering, so it
       resets the silence clock and nothing else — see the note about `open` above. */
    source.addEventListener('open', () => heard());

    source.addEventListener('ready', () => {
      heard();
      /* ★ Unconditional, and NOT guarded by `if (!subscribed)`. Every ready is a fresh
         claim that the server can deliver again, and every one of them has to force a
         refetch: the server sends it after a reconnect and after its own database
         subscription recovers, and in both cases frames were published that this client
         never saw. Making this idempotent would restore the exact bug. */
      subscribed = true;
      handlers.onSubscribed();
    });

    /* The server is up and its own subscription is not. The socket stays open — there is
       nothing wrong with it — but this board is no longer being told when it changes, and
       the status line has to say so rather than keep pulsing. */
    source.addEventListener('hold', () => {
      heard();
      dropped();
    });

    source.addEventListener('frame', (data) => {
      heard();
      /* Parsed, not decoded, and deliberately not wrapped: `onTick` runs the decoder, and a
         decoder that throws must reach the console rather than be swallowed by transport
         code trying to keep a socket tidy. */
      handlers.onTick(JSON.parse(data));
    });

    /* Nothing publishes row patches today — the projector commits whole frames — so this
       listener is dormant. It is wired anyway because the alternative is a server that
       starts sending patches into silence, which is a much harder thing to notice than a
       listener that never fires. */
    source.addEventListener('row', (data) => {
      heard();
      handlers.onPatch(JSON.parse(data));
    });

    /* Liveness only. It carries no board state; its entire job is to prove the connection
       is still a connection. */
    source.addEventListener('beat', () => heard());

    /* EventSource fires this for a dropped connection and for a failed connect alike, and
       then retries on its own schedule. We say we are no longer live and let it retry;
       `ready` is what will say we are live again. */
    source.addEventListener('error', () => {
      heard();
      dropped();
    });

    heard();
  }

  connect();

  return {
    /**
     * Idempotent, and it genuinely stops the stream.
     *
     * React's StrictMode double-invokes effects in development — open, close, open — so a
     * `close` that left the underlying stream running would leave two channels attached in
     * every dev session, and every refetch would happen twice.
     */
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(silence);
      silence = undefined;
      subscribed = false;
      stream?.close();
      stream = null;
    },
  };
}
