/**
 * THE MINT STREAM: one long-lived socket, a bounded buffer, and an honest record
 * of every interval it was not delivering.
 *
 * WHY THIS EXISTS ALONGSIDE THE POLLING CLIENT, given client.ts argues against a
 * stream. That argument is intact and it was about a different thing: decoding a
 * create instruction off a PAID always-on RPC, which is venue-specific work on a
 * permanent bill, bought against a six-day median time-to-peak. None of that
 * applies to a free relay that hands us a decoded creation event over a socket
 * that needs no key. What the earlier reasoning correctly protects is the
 * conclusion that mint time may not be claimed exact from a feed, and that is
 * preserved below and enforced by mint-time.ts.
 *
 * ★ THE RULE THIS FILE EXISTS TO KEEP: A DROPPED SOCKET IS A GAP, NOT AN ABSENCE
 * OF MINTS.
 *
 * A push transport can fail in a way a poll cannot. A poll either answers or
 * throws, so its failures are whole reads and the supervisor above sees every
 * one of them. A socket fails INSIDE a window: it drops at 12:00:03 and returns
 * at 12:00:41, and the process was connected on both sides of that hole. If the
 * transport simply reconnects and carries on, the next read looks exactly like
 * every other read and the loop records a clean window over 38 seconds nobody
 * was listening to. Every coin minted in those 38 seconds is then, forever, a
 * coin that "did not appear" — which turns an outage of ours into a negative
 * training example about the world.
 *
 * So this file tracks two instants that nothing else can reconstruct later —
 * when delivery stopped and when it resumed — and hands the window between them
 * to the caller as a fact. It never writes anything and it never decides what a
 * gap means. It reports; the supervisor records. That is the same division
 * coverage.ts holds one layer up, and it is what makes both testable without a
 * database or a network.
 *
 * THE THREE FAILURES IT DECLARES, all of which a naive implementation hides:
 *
 *   A CLEAN DROP. The socket closes or errors. The hole is [close, reopen].
 *
 *   A HALF-OPEN SOCKET. TCP is alive, no bytes arrive, no close event ever
 *   fires. This is the failure that produces a seven-hour silence behind a green
 *   tick, because every liveness check that asks the socket answers yes. It is
 *   caught by asking a different question — when did data last arrive — and the
 *   hole starts at the last delivery, because that is the last instant we can
 *   PROVE we were receiving.
 *
 *   A FULL BUFFER. The socket delivers faster than the caller drains. Something
 *   has to give and the only choice is which lie to avoid: dropping silently
 *   claims coverage we do not have, so events are dropped loudly and counted,
 *   and the caller turns that count into a recorded gap.
 *
 *   A WEDGED HANDSHAKE. `open` returned, and then nothing: no `onOpen`, no
 *   `onClose`, ever. A far end that accepts the TCP connection and never
 *   upgrades produces this, and so does a black-holed route. It is the only
 *   failure here with NO event behind it, which is why it needs a deadline — see
 *   `connect`. Without one the stream sits with no socket, no reconnect
 *   scheduled and nothing that will ever schedule one.
 *
 * ★ AND THE FAILURE THAT IS NOT OURS TO HAVE: A RECONNECT STORM. The relay is
 * free, unauthenticated, and its operators owe us nothing; the documented
 * response to a client that reconnects in a loop is a block, and there is no
 * account to appeal it with. So the retry counter is only reset by a connection
 * that has PROVEN itself by lasting — see `healthyAfterMs`. A frame alone does
 * not prove it, because the first frame the relay sends is its own subscribe
 * acknowledgement, and a far end that accepts us, acks and then kicks us would
 * otherwise be retried at the base delay for ever.
 *
 * Everything that touches a clock, a timer or a socket is injected, so the tests
 * drive a fake socket through every one of these without waiting for anything.
 */

import type { Millis } from '@insidor/contracts';
import type { Asset } from '@insidor/contracts/asset.ts';
import { assetKey } from '@insidor/contracts/ids.ts';
import type { AssetRef, ChainId, VenueId } from '@insidor/contracts/ids.ts';
import type { MintEvent } from '@insidor/contracts/ports/venue.ts';
import { rec, str } from '@insidor/vendor-kit';

import { boundedText, httpsUri, mintAddress } from './hostile.ts';
import { mintTime } from './mint-time.ts';
import type { MintTimeOptions } from './mint-time.ts';

/* ── the vendor's own words, which is why this file is in an adapter ────── */

/** The relay's subscribe frame. The only thing we ever send it. */
const SUBSCRIBE = JSON.stringify({ method: 'subscribeNewToken' });

/**
 * The event kind we accept. The socket multiplexes — a subscribe acknowledgement
 * (`{"message":"Successfully subscribed…"}`) and, for other subscriptions, trade
 * events share the same channel. Filtering on the type rather than on "does it
 * have a mint field" means a trade against an existing coin can never be decoded
 * as a fresh creation, which would put a wrong `firstSeenAt` on a real asset.
 */
const TX_TYPE_CREATE = 'create';

/**
 * ★ The launchpad marker, and it is not decoration. This relay carries several
 * launchpads on one socket. This package is the adapter for exactly one venue and
 * every asset it produces is stamped `solana:pumpfun`; `public.asset.venue_id` is
 * free text with NO check constraint, so a coin from a different launchpad
 * decoded here would be permanently filed under a venue it was never on, and
 * nothing downstream would object. A launchpad we have no adapter for is dropped,
 * which is a coin we do not have rather than a coin we have wrong.
 */
const POOL = 'pump';

/* ── what a hostile string is allowed to be ─────────────────────────────── */

/** A ticker. Long enough for the absurd ones, short enough not to be a payload. */
const SYMBOL_MAX = 32;
const NAME_MAX = 128;
const URI_MAX = 512;
/** Base58 tops out at 44; the cap is on the field, not on the shape. */
const ADDRESS_MAX = 64;

/**
 * A frame larger than this is not a mint event. The socket hands us whatever the
 * far end sends, `JSON.parse` is O(n) on it, and the far end is not under our
 * control. Refusing early costs one length check.
 */
const MAX_FRAME_BYTES = 64 * 1024;

/**
 * ★ How many separate outages may wait for a drain before they are merged into
 * one, and why a bound is needed on a list the caller empties every cycle.
 *
 * The caller only drains while the socket is LIVE — a read taken during an
 * outage would claim a window nobody was listening to, so the supervisor refuses
 * it. A socket that flaps therefore produces outages that nothing collects,
 * because at every read instant we happen to be down again. Five thousand flaps
 * measured in a test produced five thousand retained objects and, far worse, one
 * eventual drain handing the supervisor five thousand gaps to INSERT one at a
 * time while the buffer behind it kept filling. A week of second-by-second
 * flapping is six hundred thousand.
 *
 * Merging rather than dropping is the whole point. Dropping either end loses a
 * hole we have already declared, which is the one direction this file is not
 * allowed to be wrong in. The merged window spans from the earliest start to the
 * latest end, so it also censors the brief live moments between them — that is
 * over-censoring, it is visible in the reason string, and it is recoverable by
 * anyone reading the log. Under-censoring is not.
 */
const MAX_PENDING_OUTAGES = 64;

/* ── the ports: everything that is not pure ─────────────────────────────── */

export interface StreamSocket {
  send(data: string): void;
  close(): void;
}

export interface StreamHandlers {
  readonly onOpen: () => void;
  readonly onMessage: (data: string) => void;
  /** Close and error are one event here: both mean delivery has stopped. */
  readonly onClose: (why: string) => void;
}

export type OpenSocket = (url: string, handlers: StreamHandlers) => StreamSocket;

/** A window during which the socket was not delivering. Reported, never written. */
export interface StreamOutage {
  /** Inclusive start of the window we cannot vouch for. */
  readonly fromMs: Millis;
  /** Exclusive end. */
  readonly toMs: Millis;
  /**
   * ★ Carries WHY delivery stopped, and it has to survive this far.
   *
   * The three failures in the header are one window each by the time they reach
   * the caller, and the window alone cannot tell them apart: a socket that
   * closed with a code, a socket that went quiet with TCP still up, and a
   * subscribe that failed all produce an interval. That distinction is the first
   * question anyone asks of a recorded gap — a close code is the far end saying
   * something, a silence is nobody saying anything, and they are answered
   * differently. It is recorded once, at `markDown`, because that is the only
   * moment it is known; reconstructing it from the width afterwards is guessing.
   */
  readonly detail: string;
}

export interface StreamDrain {
  readonly events: readonly MintEvent[];
  /**
   * The drain handed over exactly as many as it was asked for, so this page
   * cannot prove it carries everything that arrived in its window. More are
   * waiting in the buffer; nothing was lost.
   */
  readonly limited: boolean;
  /** Events DESTROYED because the buffer was full. Never silent, never inferred. */
  readonly dropped: number;
  /** Outages that closed since the previous drain. Empty is the normal answer. */
  readonly outages: readonly StreamOutage[];
}

/**
 * The stream, as the caller sees it. Structural on purpose: the service that
 * consumes this declares the same shape in its own words and imports nothing
 * from here except through its one composition file.
 */
export interface MintStream {
  start(): void;
  stop(): void;
  /**
   * Connected and subscribed right now — and the moment a half-open socket is
   * noticed, because that failure has no event to announce itself with. Asking
   * is what makes it true, so a caller that drains before asking gets a page
   * covering a window this stream has by then concluded was dark.
   */
  live(): boolean;
  /** The instant the current live period began, or null while down. */
  liveSince(): Millis | null;
  /** Take up to `limit` events. Also checks staleness, for a caller that skipped `live`. */
  drain(limit: number): StreamDrain;
  /** An opaque marker for the cursor. See the note where it is built. */
  position(): string;
}

export interface StreamNote {
  readonly msg: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface MintStreamOptions {
  readonly url: string;
  readonly chain: ChainId;
  readonly venue: VenueId;
  /** A venue fact, not a payload field. The socket does not carry decimals. */
  readonly decimals: number;
  /**
   * How many events may wait between drains. See the header: full means dropping,
   * and dropping is declared. Below the caller's page size it can never fill a
   * page, which would make every busy window a recorded gap for no reason.
   */
  readonly bufferLimit: number;
  /**
   * No delivery for this long, while nominally connected, is a dead socket.
   *
   * It is also the handshake deadline, because a socket that `open` returned and
   * that has not called back is nominally connected and delivering nothing —
   * the same question, asked of a connection one state earlier. Reusing the
   * value rather than adding a second one keeps there being a single answer to
   * "how long may this transport be silent before we stop believing it".
   */
  readonly staleAfterMs: number;
  /**
   * ★ How long a connection must LAST before its next failure is allowed to
   * retry at the base delay. The one thing standing between us and a block.
   *
   * The retry counter cannot be reset by a connection merely working, because
   * every connection works for an instant — the relay accepts the socket,
   * acknowledges the subscribe, and may then drop us because we are being rate
   * limited. Resetting on that acknowledgement makes the backoff decorative: the
   * measured behaviour was attempt=1 for ever, which is a reconnect roughly
   * every base delay, indefinitely, against a free service with no account and
   * no appeal.
   *
   * So the counter is reset by DURATION, which is the only evidence a client has
   * that the far end is willing to keep it. The natural value is the backoff
   * CEILING: if a connection dies faster than the longest we were ever prepared
   * to wait before retrying, then retrying at the base delay means hammering
   * harder than we had already decided was reasonable.
   */
  readonly healthyAfterMs: number;
  readonly mintTimeOptions: MintTimeOptions;
  readonly now: () => Millis;
  /**
   * Reconnect delay for attempt N. Injected because the schedule is a policy
   * decision that already has exactly one implementation in this system, and a
   * second one here would be a second answer to "how hard do we retry".
   */
  readonly reconnectDelayMs: (attempt: number) => number;
  readonly open: OpenSocket;
  /** Returns a cancel. Injected so tests advance time by calling functions. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly note: (note: StreamNote) => void;
}

/* ── the decoder ────────────────────────────────────────────────────────── */

export interface StreamDecodeContext {
  readonly chain: ChainId;
  readonly venue: VenueId;
  readonly decimals: number;
  readonly mintTimeOptions: MintTimeOptions;
}

/**
 * One socket payload to one `MintEvent`, or null.
 *
 * NULL IS THE ANSWER FOR EVERYTHING WE DO NOT WANT, and the reasons are not
 * interchangeable — an acknowledgement frame, a trade, another launchpad's coin
 * and a hostile address are four different facts — but the caller's response to
 * all four is identical and correct: skip the row, keep the socket. A decoder
 * that threw on the fourth would let one crafted `mint` field end a drain.
 *
 * @param seenAt the instant the event ARRIVED, passed in rather than read from a
 *               clock here, because it must be the arrival instant and not the
 *               instant we got around to decoding. It is also the only evidence
 *               of when the mint happened, so a millisecond of laziness here is
 *               a millisecond of bias on the axis every ordering claim uses.
 */
export function toStreamMintEvent(
  raw: unknown,
  ctx: StreamDecodeContext,
  seenAt: Millis,
): MintEvent | null {
  const r = rec(raw);

  if (str(r.txType) !== TX_TYPE_CREATE) return null;
  if (str(r.pool) !== POOL) return null;

  const address = mintAddress(r.mint);
  if (address === null) return null;

  const ref: AssetRef = { chain: ctx.chain, address };
  const mintedAt = mintTime(
    { issuerMs: null, chainMs: null, vendorMs: null, observedMs: seenAt },
    ctx.mintTimeOptions,
  );

  /*
   * The metadata document, kept as a CLAIM and nothing more.
   *
   * `declaredSocial` is the vocabulary's word for links the issuer asserts, and
   * the field name is the warning. The one link a creation event carries is a
   * pointer to a JSON document on a host the issuer chose — one of the samples
   * taken while writing this pointed at a domain registered that week.
   *
   * ★ IT IS NOT FETCHED, HERE OR ANYWHERE. A fetch per mint is an outbound
   * request, at our expense, to an address an attacker supplies, at the rate they
   * choose to mint — which is a server-side request forgery primitive and a
   * denial-of-service amplifier in one field. The image lives inside that
   * document, which is why `imageUri` below is null and not the URI: storing a
   * JSON document's address in a column every renderer treats as an image source
   * is a broken image at best and a request to an attacker's host at worst.
   */
  const metadata = httpsUri(r.uri, URI_MAX);
  const declaredSocial: Record<string, string> = {};
  if (metadata !== null) declaredSocial['metadata'] = metadata;

  const asset: Asset = {
    ref,
    // Never hand-built. This is also the second place a malformed address would
    // throw, and the first (`mintAddress` above) is why it cannot reach here.
    key: assetKey(ref),
    chain: ctx.chain,
    venue: ctx.venue,
    /*
     * ★ THE ROW SAYS HOW WE CAME TO KNOW IT, and this file is the only place in the
     * pipeline that can honestly answer. A push transport delivered this event while we
     * were connected: we heard it happen. That is a different fact from the listing path
     * in watch.ts, which asks after the fact and learns that something already happened,
     * and it is a different fact again from a fixture, which is not a claim about the
     * world at all.
     *
     * ★ IT IS STAMPED HERE AND NOT IN THE SERVICE'S SINK, deliberately. The mint watcher
     * is transport-agnostic by design — its own composition root says so — so a sink that
     * mapped a configured transport name onto an origin would be a table of correspondences
     * living one layer away from the thing it describes, and a new transport would inherit
     * whatever the table said last. Here the answer is structural: this function exists
     * BECAUSE a socket pushed a frame at us, so it cannot be wrong about that, and a second
     * decoder added tomorrow has to answer for itself.
     *
     * Note that this says nothing about the mint TIME, which is ('vendor_field','bounded')
     * on this path — an arrival instant bounded by the observation lag. The two facts are
     * orthogonal and that orthogonality is the whole reason the column exists.
     */
    origin: 'live_stream',
    mintedAt,
    symbol: boundedText(r.symbol, SYMBOL_MAX),
    name: boundedText(r.name, NAME_MAX),
    // See the note above: the payload carries no image, only a document that
    // might contain one. Null is the honest answer and it renders as a
    // placeholder rather than as a request.
    imageUri: null,
    decimals: ctx.decimals,
    // The wallet that signed the creation. Bounded like everything else: it is a
    // string from the same hostile payload, and nothing downstream re-checks it.
    creator: boundedText(r.traderPublicKey, ADDRESS_MAX),
    declaredSocial,
    firstSeenAt: seenAt,
  };

  return { asset, venue: ctx.venue, mintedAt, seenAt };
}

/* ── the stream ─────────────────────────────────────────────────────────── */

export function createMintStream(opts: MintStreamOptions): MintStream {
  const ctx: StreamDecodeContext = {
    chain: opts.chain,
    venue: opts.venue,
    decimals: opts.decimals,
    mintTimeOptions: opts.mintTimeOptions,
  };

  const buffer: MintEvent[] = [];
  let socket: StreamSocket | null = null;
  let stopped = false;

  /** The instant the current live period began. Null means we are down. */
  let liveAt: Millis | null = null;
  /**
   * The instant delivery stopped, for the outage currently open. Null means no
   * outage is open — which at construction means "we have not started yet", and
   * is why `start()` does not invent one: a process that has never connected has
   * no window of its own to declare. The window before it started belongs to the
   * durable cursor, one layer up, which is the only thing that remembers it.
   */
  let downSince: Millis | null = null;
  /**
   * Why delivery stopped, for the outage currently open. Held beside `downSince`
   * and cleared with it, because the two are one fact: an outage that knows when
   * it started and not what started it is a row somebody has to guess about.
   */
  let downWhy: string | null = null;
  /** The last instant we can PROVE data was arriving. Drives staleness. */
  let lastDeliveredAt: Millis | null = null;

  let outages: StreamOutage[] = [];
  /**
   * How many outages the pending list has already swallowed by merging. Kept so
   * the merged window can say how many separate failures it stands for, which is
   * the difference between "the socket dropped once" and "the socket flapped two
   * hundred times" — and those are answered differently.
   */
  let outagesMerged = 0;
  let dropped = 0;
  let delivered = 0;
  let attempt = 0;
  let cancelReconnect: (() => void) | null = null;
  /**
   * The deadline on a connection that has not called back yet. See `connect`.
   *
   * It is a timer created per connection ATTEMPT, which is exactly the shape of
   * leak a process meant to run for weeks dies of, so every path out of the
   * connecting state clears it: `markLive`, `markDown` and `stop`.
   */
  let cancelHandshake: (() => void) | null = null;
  /**
   * Which connection attempt is the live one.
   *
   * A closed socket keeps its handlers and keeps firing them. Without this, a
   * `close` from the connection we abandoned four seconds ago arrives after the
   * replacement is up and tears down a healthy socket — and, worse, its
   * `message` handler keeps appending to the buffer, so events decode with an
   * arrival instant from a connection whose coverage we already declared a hole.
   * Every callback checks that it still belongs to the current attempt.
   */
  let generation = 0;

  /**
   * Hand an outage to the pending list, merging rather than growing once the
   * list is at its bound. See `MAX_PENDING_OUTAGES`.
   */
  const pushOutage = (outage: StreamOutage): void => {
    outages.push(outage);
    if (outages.length <= MAX_PENDING_OUTAGES) return;

    // The union, computed without indexing so `noUncheckedIndexedAccess` has
    // nothing to complain about and there is no assertion silencing anything.
    let fromMs = outage.fromMs;
    let toMs = outage.toMs;
    for (const held of outages) {
      if (held.fromMs < fromMs) fromMs = held.fromMs;
      if (held.toMs > toMs) toMs = held.toMs;
    }
    outagesMerged += outages.length;
    outages = [
      {
        fromMs,
        toMs,
        detail:
          `mint stream was not delivering across ${outagesMerged} separate outages merged ` +
          `into one window of ${toMs - fromMs}ms; the transport is flapping, and the brief ` +
          'live moments between them are censored with it',
      },
    ];
  };

  const markDown = (atMs: Millis, why: string): void => {
    // A connection that is being retired is no longer waiting on its handshake,
    // whichever way it left the connecting state.
    cancelHandshake?.();
    cancelHandshake = null;

    // The EARLIEST instant delivery stopped is the one that bounds the hole. A
    // socket that errors and then closes reports twice, and letting the second
    // one move the start forward would shrink a recorded gap on the strength of
    // a duplicate event. The reason is kept from the same first report, for the
    // same reason: 'socket error' followed by 'socket closed (1006)' is one
    // event described twice, and the first description is the one that saw it.
    if (downSince === null) {
      downSince = atMs;
      downWhy = why;
    }
    liveAt = null;
    // Retire this connection: anything it fires from here is from a socket we
    // have already stopped counting on.
    generation += 1;

    const dying = socket;
    socket = null;
    if (dying !== null) {
      try {
        dying.close();
      } catch {
        // Closing an already-dead socket is not an event. The connection is gone
        // either way and the outage is already open.
      }
    }

    /*
     * ★ The guard is on whether a reconnect is already PENDING, not on whether
     * we are already down — and that distinction is the difference between a
     * stream that recovers and one that dies quietly.
     *
     * A reconnect opens a socket that has not handshaked yet. We are still down:
     * `downSince` is still set. If that socket fails before it opens, guarding on
     * `downSince` would take this path as a duplicate close, schedule nothing,
     * and leave the stream permanently disconnected with no error and no retry —
     * a process that stays up, answers its health check on the last read that
     * worked, and never sees another mint.
     */
    if (cancelReconnect !== null) return;

    attempt += 1;
    const wait = opts.reconnectDelayMs(attempt);
    opts.note({ msg: 'mint stream disconnected', fields: { why, atMs, attempt, wait } });
    if (stopped) return;
    cancelReconnect = opts.schedule(connect, wait);
  };

  const markLive = (atMs: Millis): void => {
    // It handshaked. The deadline has done its job and must not outlive it.
    cancelHandshake?.();
    cancelHandshake = null;

    const from = downSince;
    const why = downWhy;
    downSince = null;
    downWhy = null;
    liveAt = atMs;
    // Start the staleness clock at the connection. Nothing has been delivered
    // yet, and treating that as "no data for ever" would declare a healthy
    // socket dead the moment it opened.
    lastDeliveredAt = atMs;

    // ★ The window nobody was listening to, handed to the caller as a fact.
    // Guarded on strict forward order because the coverage row it becomes has a
    // `window_to > window_from` check, and a zero-width outage is not a hole.
    if (from !== null && atMs > from) {
      pushOutage({
        fromMs: from,
        toMs: atMs,
        detail: `mint stream was not delivering for ${atMs - from}ms (${why ?? 'cause not recorded'})`,
      });
    }
    opts.note({ msg: 'mint stream live', fields: { atMs, recoveredFromMs: from } });
  };

  const accept = (event: MintEvent): void => {
    if (buffer.length < opts.bufferLimit) {
      buffer.push(event);
      return;
    }
    /*
     * ★ FULL. The newest is dropped rather than the oldest, so what survives is
     * a contiguous run from the front of the window: a suffix we can name is a
     * better thing to lose than a hole in the middle of a window we then claim.
     * The count is what makes the loss declarable — a drop nobody counted is
     * indistinguishable from a quiet minute.
     */
    dropped += 1;
  };

  const handle = (data: string): void => {
    // Arrival, not decode. Everything below can only make this later.
    const seenAt = opts.now();
    lastDeliveredAt = seenAt;
    /*
     * ★ THE BACKOFF IS RESET BY A CONNECTION THAT LASTED, NOT BY ONE THAT SPOKE.
     *
     * Resetting in `onOpen` is obviously wrong — a socket that opens and closes
     * immediately would retry at the base delay for ever. Resetting on the first
     * FRAME looks like the fix and is the same bug wearing a disguise, because
     * the first frame this relay sends is its own subscribe acknowledgement.
     * That frame arrives on every connection it ever accepts, including the ones
     * it is about to drop us from, so a far end that accepts, acks and kicks
     * produced a measured attempt sequence of [1,1,1,1,…] — a reconnect roughly
     * every base delay, for as long as the process runs. Against a free,
     * unauthenticated relay that is how a client gets blocked, and there is no
     * account to appeal it with.
     *
     * Duration is the only evidence a client has that the far end is willing to
     * keep it. `liveAt` is null here only if data arrived before we considered
     * ourselves live, and not resetting in that case is the safe direction.
     */
    if (liveAt !== null && seenAt - liveAt >= opts.healthyAfterMs) attempt = 0;

    if (data.length > MAX_FRAME_BYTES) {
      opts.note({ msg: 'oversized frame dropped', fields: { bytes: data.length } });
      return;
    }

    try {
      const event = toStreamMintEvent(JSON.parse(data), ctx, seenAt);
      if (event !== null) accept(event);
    } catch (e) {
      // ★ One malformed frame must never end the socket. Unparseable JSON, a
      // payload shape nobody expected, an address that got past the shape check:
      // all of them are one row we do not have. Letting this throw would take the
      // connection down and turn a bad byte into a coverage gap.
      opts.note({
        msg: 'undecodable frame dropped',
        fields: { err: e instanceof Error ? e.message : String(e) },
      });
    }
  };

  function connect(): void {
    cancelReconnect = null;
    // Belt and braces: every path into `connect` has already been through
    // `markDown`, which clears this. A deadline that outlived its attempt is one
    // timer per reconnect, which is the leak shape that kills a long run.
    cancelHandshake?.();
    cancelHandshake = null;
    if (stopped) return;
    const mine = ++generation;
    const current = (): boolean => mine === generation && !stopped;
    try {
      socket = opts.open(opts.url, {
        onOpen: () => {
          if (!current()) return;
          try {
            socket?.send(SUBSCRIBE);
          } catch (e) {
            markDown(opts.now(), `subscribe failed: ${e instanceof Error ? e.message : String(e)}`);
            return;
          }
          markLive(opts.now());
        },
        onMessage: (data) => {
          if (!current()) return;
          handle(data);
        },
        onClose: (why) => {
          if (!current()) return;
          markDown(opts.now(), why);
        },
      });

      /*
       * ★ THE HANDSHAKE DEADLINE, and it is the only failure in this file with
       * no event behind it.
       *
       * Every other way a connection dies arrives as a callback. This one is the
       * absence of one: `open` returned a socket and the far end never completed
       * the upgrade — it accepted the TCP connection and went quiet, or the
       * route is black-holed and the kernel is still waiting. Node's global
       * WebSocket has no connect timeout, so nothing below us will ever give up.
       *
       * Measured, that left the stream with no socket, no reconnect scheduled,
       * and nothing that would ever schedule one: permanently and silently dead,
       * from the FIRST connect at boot onwards, which is the failure this whole
       * service exists to make impossible. `live()` answers false so the
       * supervisor's reads fail and the health endpoint eventually goes red, but
       * a red health endpoint only helps if something is watching it, and a
       * process that can rescue itself should.
       *
       * Treated as a close, because that is what it is: we are not delivering.
       * The retry then backs off like any other failure.
       */
      // `liveAt === null` because an opener that completes the handshake
      // SYNCHRONOUSLY has already run `markLive` by the time we get here, and
      // arming a deadline on a connection that is up would kill a healthy socket
      // one stale-window later.
      if (current() && liveAt === null) {
        cancelHandshake = opts.schedule(() => {
          cancelHandshake = null;
          if (!current()) return;
          markDown(opts.now(), `handshake did not complete within ${opts.staleAfterMs}ms`);
        }, opts.staleAfterMs);
      }
    } catch (e) {
      // The opener itself threw — a bad URL, an exhausted file descriptor. Same
      // event as a close: we are not delivering, and the retry is scheduled.
      socket = null;
      markDown(opts.now(), `open failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The half-open check, asked at drain time rather than on a timer.
   *
   * A timer would be a second thing to cancel on shutdown and a second thing to
   * fake in a test, for a question that only matters when somebody asks for
   * events. The cost is that staleness is noticed within one drain interval of
   * when it began, which is the same resolution everything else in this loop has.
   */
  const checkStale = (nowMs: Millis): void => {
    if (liveAt === null || lastDeliveredAt === null) return;
    if (nowMs - lastDeliveredAt <= opts.staleAfterMs) return;

    // ★ The hole starts at the LAST DELIVERY, not at now. A socket that stopped
    // delivering without closing gives us no other instant we can defend: from
    // the last frame onwards we have been unable to tell "nothing was minted"
    // from "nothing reached us", and that is precisely what a gap says.
    markDown(lastDeliveredAt, `no delivery for ${nowMs - lastDeliveredAt}ms`);
  };

  return {
    start() {
      stopped = false;
      connect();
    },

    stop() {
      stopped = true;
      // Retire the connection before closing it, so the `close` this triggers
      // does not schedule a reconnect on the way out of the process.
      generation += 1;
      cancelReconnect?.();
      cancelReconnect = null;
      // The handshake deadline holds a reference to this closure and, under a
      // ref'd scheduler, would hold the process open past the loop's end.
      cancelHandshake?.();
      cancelHandshake = null;
      const dying = socket;
      socket = null;
      liveAt = null;
      try {
        dying?.close();
      } catch {
        // Shutting down. A socket that objects to being closed has still stopped.
      }
    },

    /*
     * ★ THE STALENESS CHECK RUNS HERE, AND NOT ONLY AT DRAIN, BECAUSE THIS IS
     * THE QUESTION THE SUPERVISOR ASKS FIRST.
     *
     * The caller's read is gated on `live()` and only then drains. With the
     * check at drain alone, the read that DISCOVERS a half-open socket had
     * already been let through: `live()` answered yes, the drain then noticed
     * the silence and tore the connection down, and the drain it returned —
     * empty, unlimited, with no outage on it, because an outage only closes when
     * the replacement comes up — went back as a clean page. The supervisor
     * writes that page's window as observed, with `gap = false`, ending at the
     * very instant we concluded the socket was dead.
     *
     * Asking here makes that read FAIL instead, which is what a read taken over
     * a window we cannot vouch for is supposed to do. The buffered events are
     * not lost: nothing drained, so they go out on the first read that succeeds
     * after the reconnect, on a page that also carries the outage.
     *
     * It is a query with a side effect, which is ugly, and the alternative is a
     * timer — a second thing to cancel on shutdown and a second thing to fake in
     * a test, for a question that only matters when somebody asks it.
     */
    live: () => {
      checkStale(opts.now());
      return liveAt !== null;
    },
    liveSince: () => liveAt,

    drain(limit) {
      const nowMs = opts.now();
      // Kept here as well as in `live()`. `drain` is a public entry point and a
      // caller that reaches it another way must not get a page that outlives the
      // connection behind it.
      checkStale(nowMs);

      const events = buffer.splice(0, Math.max(0, limit));
      const taken = { events, limited: limit > 0 && events.length === limit, dropped, outages };
      delivered += events.length;
      dropped = 0;
      outages = [];
      outagesMerged = 0;
      return taken;
    },

    /*
     * The cursor position, and it is deliberately not resumable.
     *
     * A poll cursor is an offset or a page token: hand it back and the source
     * replays from there. A socket has no such thing — what arrived while we were
     * away is gone, and that is the entire reason the coverage log exists. So the
     * marker states a count of events handed over and nothing that could be
     * mistaken for a place to resume from. It is a diagnostic: it is visible on
     * the coverage row, and a row whose count has not moved is a stream that is
     * connected and silent.
     */
    position: () => `delivered=${delivered}`,
  };
}

/**
 * The real opener, over the global `WebSocket` Node 24 ships. No package, and no
 * reconnect logic here — reconnection is the stream's, above, because it is the
 * thing that knows what a reconnection means for coverage.
 */
export function openWebSocket(url: string, handlers: StreamHandlers): StreamSocket {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.onOpen();
  ws.onmessage = (event: MessageEvent) => {
    const { data } = event;
    handlers.onMessage(typeof data === 'string' ? data : String(data));
  };
  // Error and close are one event to the caller. A socket that errors always
  // closes, and reporting both would open an outage and then try to open it
  // again; `markDown` ignores the second, and this makes that explicit.
  ws.onerror = () => handlers.onClose('socket error');
  ws.onclose = (event: CloseEvent) => handlers.onClose(`socket closed (${event.code})`);
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
}
