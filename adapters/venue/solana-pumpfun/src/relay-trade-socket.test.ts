import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import { createRelayTradeSocket, firstMint, readRelayFrame } from './relay-trade-socket.ts';
import type { StreamHandlers } from './stream.ts';

const COIN = 'HwFM5tAJA99h7PDwXYVaXyd8suubFjtvG31rAdVipump';
const SOL = 'So11111111111111111111111111111111111111112';

const tradeFrame = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  signature: 'sig1',
  action: 'buy',
  poolId: 'pool',
  mint: COIN,
  quoteMint: SOL,
  pool: 'pump',
  creatorFeeAddress: 'creator1',
  marketCapQuote: 31.5,
  timestamp: 1793025772603,
  breakdown: [
    { action: 'buy', trader: 'alice', tokenAmount: 1000, quoteAmount: 0.5 },
    { action: 'sell', trader: 'bob', tokenAmount: 200, quoteAmount: 0.1 },
  ],
  ...over,
});

test('each curve leg is one trade, its trader the user, SOL figures kept', () => {
  const r = readRelayFrame(tradeFrame(), COIN);
  assert.equal(r.kind, 'trades');
  if (r.kind !== 'trades') return;
  assert.equal(r.signature, 'sig1');
  assert.deepEqual(
    r.trades.map((t) => [t.user, t.isBuy, t.sol, t.tokens, t.creator, t.timestampS, t.mcapSol]),
    [
      ['alice', true, 0.5, 1000, 'creator1', 1793025772, 31.5],
      ['bob', false, 0.1, 200, 'creator1', 1793025772, 31.5],
    ],
  );
});

test('a launch frame carries the creator\'s opening buy as a trade', () => {
  const r = readRelayFrame(tradeFrame({ action: 'create', breakdown: [{ action: 'buy', trader: 'creator1', tokenAmount: 5, quoteAmount: 0.01 }] }), COIN);
  assert.equal(r.kind, 'trades');
});

test('another pool or a migrate is a completed curve; another quote token is other_quote, never 0', () => {
  assert.equal(readRelayFrame(tradeFrame({ pool: 'pump-amm' }), COIN).kind, 'completed');
  assert.equal(readRelayFrame(tradeFrame({ action: 'migrate' }), COIN).kind, 'completed');
  assert.equal(readRelayFrame(tradeFrame({ quoteMint: 'DJTu7vi8norVzdVAffgvb39VP7wjKeTsgaMBJrzfxvoF' }), COIN).kind, 'other_quote');
});

test('fees, other coins and broken legs are not trades', () => {
  assert.equal(readRelayFrame(tradeFrame({ action: 'distributeFees' }), COIN).kind, 'ignored');
  assert.equal(readRelayFrame(tradeFrame({ mint: 'other' }), COIN).kind, 'ignored');
  assert.equal(readRelayFrame(tradeFrame({ breakdown: [{ action: 'buy', trader: 'a' }] }), COIN).kind, 'undecodable');
});

test('the prefilter reads the frame\'s first mint without parsing it', () => {
  assert.equal(firstMint(JSON.stringify(tradeFrame())), COIN);
  assert.equal(firstMint('{"action":"transfer"}'), null);
});

function harness() {
  let t = 1_000;
  let handlers: StreamHandlers | null = null;
  const timers: (() => void)[] = [];
  const sock = createRelayTradeSocket({
    url: 'wss://relay.test/',
    staleAfterMs: 30_000,
    healthyAfterMs: 60_000,
    now: () => t as Millis,
    reconnectDelayMs: () => 10,
    open: (_url, h) => {
      handlers = h;
      return { send: () => {}, close: () => {} };
    },
    schedule: (fn) => {
      timers.push(fn);
      return () => {};
    },
    note: () => {},
  });
  return {
    sock,
    at: (ms: number) => {
      t = ms;
    },
    h: () => handlers!,
  };
}

test('a coin is confirmed as soon as it is watched on a live stream, and only its frames are kept', () => {
  const x = harness();
  x.sock.start();
  x.h().onOpen();
  x.at(2_000);
  x.sock.watch(COIN);
  x.h().onMessage(JSON.stringify(tradeFrame()));
  x.h().onMessage(JSON.stringify(tradeFrame({ mint: 'someOtherCoin' })));
  const d = x.sock.drain();
  assert.deepEqual(d.subscribed, [{ coin: COIN, atMs: 2_000 }]);
  assert.equal(d.trades.length, 2);
  assert.equal(d.trades[0]?.coin, COIN);
  assert.equal(d.bytes.size, 0);
});

test('a drop is an outage, and every wanted coin is confirmed again when the stream returns', () => {
  const x = harness();
  x.sock.start();
  x.h().onOpen();
  x.sock.watch(COIN);
  x.sock.drain();
  x.at(5_000);
  x.h().onClose('socket closed (1006)');
  x.sock.start();
  x.at(9_000);
  x.h().onOpen();
  const d = x.sock.drain();
  assert.equal(d.outages.length, 1);
  assert.equal(d.outages[0]?.fromMs, 5_000);
  assert.equal(d.outages[0]?.toMs, 9_000);
  assert.deepEqual(d.subscribed, [{ coin: COIN, atMs: 9_000 }]);
});

test('silence past the stale window is an outage from the last frame', () => {
  const x = harness();
  x.sock.start();
  x.h().onOpen();
  x.at(1_000 + 30_001);
  assert.equal(x.sock.live(), false);
});
