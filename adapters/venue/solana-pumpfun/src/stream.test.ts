/**
 * The socket, driven by a fake one.
 *
 * Every test here is a failure that a working implementation makes invisible.
 * A stream that decodes correctly on the happy path and silently resumes after a
 * drop looks identical, in every log and every metric, to one that never dropped
 * — and the difference is a coverage window that gets labelled negative instead
 * of censored. So the assertions are mostly about what the stream SAYS about
 * itself, not about what it delivers.
 *
 * Nothing here waits. The clock, the timer and the socket are all injected, so
 * a 40-second outage is three function calls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chainId, venueId } from '@insidor/contracts/ids.ts';

import {
  createMintStream,
  toStreamMintEvent,
  type MintStreamOptions,
  type StreamHandlers,
  type StreamNote,
  type StreamSocket,
} from './stream.ts';

const CHAIN = chainId('solana');
const VENUE = venueId(CHAIN, 'pumpfun');
const T0 = 1_785_912_030_000;
const MINT = '6WZvG4M5gS9Evarrdd4k8WM2g61pWAZ5zDKrEFKBpump';
const MINT_B = 'evsLWxpAAoW8jKQyfuo4D9Jk8VhgGfabuXitjZPpump';
const WALLET = 'D7nMwAQRbV1PBAFcv7iBh6SDBXHeBLJWaXnMv8yrAyaM';

const CTX = {
  chain: CHAIN,
  venue: VENUE,
  decimals: 6,
  mintTimeOptions: { agreementToleranceMs: 10_000, observationLagS: 10 },
};

/** A real frame, taken verbatim from the live socket while writing this. */
function frame(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    signature: '2cvNFqrzTTsMiHUJogxr9J3JpKqPN2GjnyHRdMZ55duGRN5X5a5jkMFLRAyaBx1VoV1MLYC4zj9SyF6a5fD3kZpD',
    mint: MINT,
    traderPublicKey: WALLET,
    txType: 'create',
    initialBuy: 3_520_918.746_848,
    solAmount: 0.098_765_431,
    marketCapSol: 28.143_388_644_621_31,
    name: 'Testicle Token',
    symbol: 'TESTIS',
    uri: 'https://ipfs.io/ipfs/bafkreiges6b7efycdgdexydw2tg334eradjxu7jf7qyuyt6krixb2vqngm',
    pool: 'pump',
    ...over,
  });
}

/* ── a fake socket, and a clock that only moves when a test says so ─────── */

interface Rig {
  readonly stream: ReturnType<typeof createMintStream>;
  readonly notes: StreamNote[];
  /** Connections opened so far, newest last. */
  readonly opened: string[];
  tick(ms: number): void;
  /** Complete the pending connection. */
  connect(): void;
  deliver(data: string): void;
  drop(why?: string): void;
  /** Run the scheduled reconnect, if one is pending. */
  runReconnect(): void;
  now(): number;
}

function rig(over: Partial<MintStreamOptions> = {}): Rig {
  let clock = T0;
  const notes: StreamNote[] = [];
  const opened: string[] = [];
  let handlers: StreamHandlers | null = null;
  let pending: (() => void) | null = null;

  const open = (url: string, h: StreamHandlers): StreamSocket => {
    opened.push(url);
    handlers = h;
    return { send: () => undefined, close: () => undefined };
  };

  const stream = createMintStream({
    url: 'wss://stream.example/api/data',
    chain: CHAIN,
    venue: VENUE,
    decimals: 6,
    bufferLimit: 100,
    staleAfterMs: 60_000,
    mintTimeOptions: CTX.mintTimeOptions,
    now: () => clock,
    reconnectDelayMs: () => 1_000,
    open,
    schedule: (fn) => {
      pending = fn;
      return () => {
        pending = null;
      };
    },
    note: (n) => notes.push(n),
    ...over,
  });

  return {
    stream,
    notes,
    opened,
    now: () => clock,
    tick: (ms) => {
      clock += ms;
    },
    connect: () => handlers?.onOpen(),
    deliver: (data) => handlers?.onMessage(data),
    drop: (why = 'socket closed (1006)') => handlers?.onClose(why),
    runReconnect: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
  };
}

/* ── decoding ───────────────────────────────────────────────────────────── */

test('a real creation frame decodes into a complete asset', () => {
  const event = toStreamMintEvent(JSON.parse(frame()), CTX, T0);
  assert.ok(event !== null);
  assert.equal(event.asset.ref.address, MINT);
  assert.equal(event.asset.key, `solana:${MINT}`);
  assert.equal(event.asset.venue, VENUE);
  assert.equal(event.asset.symbol, 'TESTIS');
  assert.equal(event.asset.name, 'Testicle Token');
  assert.equal(event.asset.creator, WALLET);
  assert.equal(event.asset.decimals, 6, 'a venue fact, never read from the payload');
  assert.equal(event.asset.firstSeenAt, T0);
  assert.equal(event.seenAt, T0);
});

test('★ the mint time is bounded and centred, never exact', () => {
  const event = toStreamMintEvent(JSON.parse(frame()), CTX, T0);
  assert.ok(event !== null);
  assert.equal(event.mintedAt.confidence, 'bounded');
  assert.equal(event.mintedAt.source, 'vendor_field');
  assert.equal(event.mintedAt.boundS, 5);
  assert.equal(event.mintedAt.at, T0 - 5_000, 'the interval ends at the arrival, not after it');
  assert.equal(
    event.asset.mintedAt.at,
    event.mintedAt.at,
    'the event and the asset carry the same instant; the asset is the one that persists',
  );
});

test('the metadata document is kept as a claim and is never an image source', () => {
  const event = toStreamMintEvent(JSON.parse(frame()), CTX, T0);
  assert.ok(event !== null);
  assert.equal(event.asset.imageUri, null, 'the payload carries a JSON document, not an image');
  assert.equal(
    event.asset.declaredSocial['metadata'],
    'https://ipfs.io/ipfs/bafkreiges6b7efycdgdexydw2tg334eradjxu7jf7qyuyt6krixb2vqngm',
  );
});

test('a non-https metadata pointer is dropped rather than stored', () => {
  for (const uri of ['javascript:alert(1)', 'data:text/html,<script>', 'http://plain.example/m']) {
    const event = toStreamMintEvent(JSON.parse(frame({ uri })), CTX, T0);
    assert.ok(event !== null, 'a bad link must cost the link, not the coin');
    assert.deepEqual(event.asset.declaredSocial, {});
  }
});

test('an event with no usable mint address is dropped, not thrown on', () => {
  // `assetKey` THROWS on an empty component or one carrying a separator, and it
  // runs once per event. Anything that reaches it must already be an address.
  for (const mint of [undefined, '', 'short', 'solana:notanaddress', 'has|a|pipe', 42, { a: 1 }]) {
    assert.equal(toStreamMintEvent(JSON.parse(frame({ mint })), CTX, T0), null, String(mint));
  }
});

test('the subscribe acknowledgement is not a mint', () => {
  const ack = { message: 'Successfully subscribed to token creation events.' };
  assert.equal(toStreamMintEvent(ack, CTX, T0), null);
});

test('a trade against an existing coin is not a creation', () => {
  // It carries a `mint` and would decode fine on shape alone — and would write a
  // fresh `firstSeenAt` over a coin we have watched for a week.
  assert.equal(toStreamMintEvent(JSON.parse(frame({ txType: 'buy' })), CTX, T0), null);
});

test("★ another launchpad's coin is dropped rather than filed under this venue", () => {
  // `public.asset.venue_id` is free text with no check constraint, so a coin
  // stamped with the wrong venue is wrong permanently and silently.
  assert.equal(toStreamMintEvent(JSON.parse(frame({ pool: 'bonk' })), CTX, T0), null);
});

test('hostile strings are bounded, stripped and never dropped whole', () => {
  const event = toStreamMintEvent(
    JSON.parse(
      frame({
        name: `${'A'.repeat(10_000)}`,
        symbol: 'SAFE‮kcatta',
        traderPublicKey: 'X'.repeat(5_000),
      }),
    ),
    CTX,
    T0,
  );
  assert.ok(event !== null);
  assert.equal(event.asset.name?.length, 128);
  assert.ok(
    !/‮/.test(event.asset.symbol ?? ''),
    'a right-to-left override makes the stored glyphs differ from the rendered ones',
  );
  assert.equal(event.asset.symbol, 'SAFEkcatta');
  assert.equal(event.asset.creator?.length, 64);
});

test('an empty name is null rather than an empty string', () => {
  const event = toStreamMintEvent(JSON.parse(frame({ name: '   ', symbol: '​' })), CTX, T0);
  assert.ok(event !== null);
  assert.equal(event.asset.name, null);
  assert.equal(event.asset.symbol, null, 'a zero-width space is not a ticker');
});

/* ── the buffer ─────────────────────────────────────────────────────────── */

test('the buffer drains in arrival order and empties as it goes', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  r.deliver(frame());
  r.tick(10);
  r.deliver(frame({ mint: MINT_B }));

  const first = r.stream.drain(10);
  assert.equal(first.events.length, 2);
  assert.equal(first.events[0]?.asset.ref.address, MINT);
  assert.equal(first.events[1]?.asset.ref.address, MINT_B);
  assert.equal(first.limited, false);
  assert.equal(first.dropped, 0);

  assert.equal(r.stream.drain(10).events.length, 0, 'a drained event is not drained twice');
});

test('seenAt is the ARRIVAL instant, not the drain instant', () => {
  // The arrival is the only evidence of when the mint happened. Reading the
  // clock at drain time would bias every stored mint time by however long the
  // event sat in the buffer — always late, always in the direction that makes a
  // post look pre-mint.
  const r = rig();
  r.stream.start();
  r.connect();
  r.deliver(frame());
  const arrival = r.now();
  r.tick(2_500);

  const [event] = r.stream.drain(10).events;
  assert.equal(event?.seenAt, arrival);
});

test('a drain that hits its limit says so, and leaves the rest in the buffer', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  for (let i = 0; i < 5; i++) r.deliver(frame());

  const taken = r.stream.drain(3);
  assert.equal(taken.events.length, 3);
  assert.equal(taken.limited, true, 'this page cannot prove it covers its window');
  assert.equal(taken.dropped, 0, 'nothing was lost — they are still in the buffer');
  assert.equal(r.stream.drain(10).events.length, 2);
});

test('★ an overflow destroys events and COUNTS them', () => {
  const r = rig({ bufferLimit: 3 });
  r.stream.start();
  r.connect();
  for (let i = 0; i < 7; i++) r.deliver(frame());

  const taken = r.stream.drain(100);
  assert.equal(taken.events.length, 3, 'the bound held: this is not an out-of-memory crash');
  assert.equal(taken.dropped, 4, 'and the loss is a number, not a silence');
  assert.equal(r.stream.drain(100).dropped, 0, 'the count resets; one hole is recorded once');
});

test('a malformed frame does not end the socket', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  r.deliver('{not json');
  r.deliver(frame());

  assert.equal(r.stream.live(), true, 'one bad byte must not become a coverage gap');
  assert.equal(r.stream.drain(10).events.length, 1);
  assert.ok(r.notes.some((n) => n.msg === 'undecodable frame dropped'));
});

test('an oversized frame is refused before it is parsed', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  r.deliver(JSON.stringify({ txType: 'create', pool: 'pump', mint: MINT, name: 'x'.repeat(70_000) }));

  assert.equal(r.stream.drain(10).events.length, 0);
  assert.ok(r.notes.some((n) => n.msg === 'oversized frame dropped'));
});

/* ── ★ the gaps ─────────────────────────────────────────────────────────── */

test('★ a drop and a reconnect produce an outage covering exactly the hole', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  r.deliver(frame());

  r.tick(5_000);
  const droppedAt = r.now();
  r.drop();
  assert.equal(r.stream.live(), false, 'a disconnected stream must never read as live');

  r.tick(38_000);
  r.runReconnect();
  const backAt = r.now();
  r.connect();
  assert.equal(r.stream.live(), true);

  const taken = r.stream.drain(10);
  assert.equal(taken.outages.length, 1, 'a silent resume claims coverage of an unwatched window');
  assert.equal(taken.outages[0]?.fromMs, droppedAt);
  assert.equal(taken.outages[0]?.toMs, backAt);
  assert.equal(taken.outages[0]?.toMs - taken.outages[0]?.fromMs, 38_000);
});

test('an outage is reported once and then forgotten', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  r.drop();
  r.tick(4_000);
  r.runReconnect();
  r.connect();

  assert.equal(r.stream.drain(10).outages.length, 1);
  assert.equal(r.stream.drain(10).outages.length, 0, 'the same hole must not be counted twice');
});

test('the mints buffered before a drop survive it', () => {
  // They are the reason `read()` throws while down rather than draining: a drain
  // during an outage would hand these over on a page whose window we cannot
  // vouch for, and then the cursor would move past it.
  const r = rig();
  r.stream.start();
  r.connect();
  r.deliver(frame());
  r.drop();
  r.tick(3_000);
  r.runReconnect();
  r.connect();

  assert.equal(r.stream.drain(10).events.length, 1);
});

test('an error and the close that follows it are one outage, not two', () => {
  // A socket that errors always closes. Taking the second event as a new start
  // would move the hole forward and shrink a recorded gap on a duplicate.
  const r = rig();
  r.stream.start();
  r.connect();
  const at = r.now();
  r.drop('socket error');
  r.tick(1_000);
  r.drop('socket closed (1006)');

  r.tick(2_000);
  r.runReconnect();
  r.connect();

  const taken = r.stream.drain(10);
  assert.equal(taken.outages.length, 1);
  assert.equal(taken.outages[0]?.fromMs, at, 'the hole starts where delivery actually stopped');
});

test('★ a half-open socket is caught, and the hole starts at the last delivery', () => {
  // TCP alive, no bytes, no close event. Every liveness check that asks the
  // socket answers yes, which is how a seven-hour silence hides behind a green
  // tick. The last instant we can PROVE we were receiving is the last frame.
  const r = rig({ staleAfterMs: 60_000 });
  r.stream.start();
  r.connect();
  r.deliver(frame());
  const lastDelivery = r.now();

  r.tick(61_000);
  r.stream.drain(10);
  assert.equal(r.stream.live(), false, 'a socket delivering nothing is not a socket delivering');

  r.tick(2_000);
  r.runReconnect();
  r.connect();

  const taken = r.stream.drain(10);
  assert.equal(taken.outages.length, 1);
  assert.equal(
    taken.outages[0]?.fromMs,
    lastDelivery,
    'not `now` — everything since the last frame is unprovable',
  );
});

test('a freshly opened socket is not stale, and a quiet one under the window is not either', () => {
  const r = rig({ staleAfterMs: 60_000 });
  r.stream.start();
  r.connect();

  r.tick(30_000);
  r.stream.drain(10);
  assert.equal(r.stream.live(), true, 'quiet is not dead');

  r.tick(31_000);
  r.stream.drain(10);
  assert.equal(r.stream.live(), false);
});

test('a first connection declares no outage — there is no earlier window to have missed', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  assert.deepEqual(r.stream.drain(10).outages, []);
  assert.equal(r.stream.liveSince(), T0);
});

test('★ a reconnect that dies before it opens schedules another one', () => {
  // The failure this guards is a stream that goes permanently, silently dead. We
  // are still down when a reconnect attempt starts, so a guard written as "are we
  // already down?" takes the new socket's failure for a duplicate close,
  // schedules nothing, and leaves a process that stays up, answers its health
  // check on the last read that worked, and never sees another mint.
  const attempts: number[] = [];
  const r = rig({ reconnectDelayMs: (n) => (attempts.push(n), n * 1_000) });
  r.stream.start();
  r.connect();

  r.drop();
  r.runReconnect();
  // This socket never completed its handshake — no onOpen, straight to close.
  r.drop();
  assert.deepEqual(attempts, [1, 2], 'a failing reconnect backs off rather than giving up');

  r.runReconnect();
  r.connect();
  assert.equal(r.stream.live(), true, 'and it eventually gets back');
});

test('★ a dead connection cannot tear down the one that replaced it', () => {
  // A closed socket keeps its handlers and keeps firing them. A `close` from the
  // connection abandoned four seconds ago must not kill the healthy replacement,
  // and its `message` must not append to the buffer with an arrival instant
  // inside a window we have already declared a hole.
  //
  // The two connections are collected into an ARRAY rather than into two `let`
  // bindings, and the reason is worth stating because the obvious spelling does
  // not typecheck and — worse — the obvious FIX for that is silent. A `let`
  // assigned only from inside a callback is still narrowed to its initialiser at
  // every use site out here, so `stale` reads as `null` and `stale?.onOpen()` is
  // a property access on `never`. Reaching for `?.` to make that compile is how
  // this test would quietly become vacuous: if a handler were never captured,
  // every optional call short-circuits, nothing is driven, and the assertions
  // below all pass against a stream nobody touched. So the handlers are read out
  // of the array and asserted present first. A missing connection fails here,
  // loudly, instead of passing as a test that exercised nothing.
  const sockets: StreamHandlers[] = [];
  const r = rig({
    open: (_url, h) => {
      sockets.push(h);
      return { send: () => undefined, close: () => undefined };
    },
  });

  r.stream.start();
  const stale = sockets[0];
  assert.ok(stale, 'the first connection was opened');
  stale.onOpen();
  stale.onClose('socket closed (1006)');
  r.tick(4_000);
  r.runReconnect();

  const live = sockets[1];
  assert.ok(live, 'the reconnect opened a replacement');
  live.onOpen();
  assert.equal(r.stream.live(), true);

  stale.onClose('a late close from a socket nobody is listening to');
  assert.equal(r.stream.live(), true, 'the replacement survives its predecessor');

  stale.onMessage(frame());
  assert.equal(r.stream.drain(10).events.length, 0, 'and a ghost cannot fill the buffer');
});

test('a delivered frame resets the backoff; an open that delivers nothing does not', () => {
  // Resetting on `onOpen` would let a socket that opens and immediately closes
  // retry at the base delay forever, which is a hot loop wearing a backoff.
  const attempts: number[] = [];
  const r = rig({ reconnectDelayMs: (n) => (attempts.push(n), 1_000) });
  r.stream.start();
  r.connect();
  r.drop();
  r.runReconnect();
  r.connect();
  r.drop();
  assert.deepEqual(attempts, [1, 2]);

  r.runReconnect();
  r.connect();
  r.deliver(frame());
  r.drop();
  assert.deepEqual(attempts, [1, 2, 1], 'a frame proves the connection works');
});

test('stop() cancels the pending reconnect: a stopped stream stays stopped', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  const before = r.opened.length;
  r.drop();
  r.stream.stop();
  r.runReconnect();

  assert.equal(r.opened.length, before, 'a reconnect after shutdown holds the process open');
  assert.equal(r.stream.live(), false);
});

test('an opener that throws is the same event as a close, and is retried', () => {
  let boom = true;
  const r = rig({
    open: (_url, _h) => {
      if (boom) throw new Error('bad url');
      return { send: () => undefined, close: () => undefined };
    },
  });
  r.stream.start();
  assert.equal(r.stream.live(), false);
  boom = false;
  assert.doesNotThrow(() => r.runReconnect());
});

test('the cursor marker moves with delivery and is not a place to resume from', () => {
  const r = rig();
  r.stream.start();
  r.connect();
  const cold = r.stream.position();
  r.deliver(frame());
  r.stream.drain(10);

  assert.notEqual(r.stream.position(), cold, 'a marker that never moves proves nothing');
  assert.match(r.stream.position(), /delivered=1/);
});
