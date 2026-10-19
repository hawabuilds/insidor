/**
 * The trade socket against a fake socket and a fake clock: a subscription per coin, every byte
 * charged to its coin, failed transactions dropped but paid for, a cut log handed over as cut, and
 * a drop or a silence reported as an outage after which the coins are subscribed again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { Millis } from '@insidor/contracts';

import { curveEvents } from './events.ts';
import type { StreamHandlers } from './stream.ts';
import { createTradeSocket } from './trade-socket.ts';

interface Fixture {
  readonly label: string;
  readonly signature: string;
  readonly err: unknown;
  readonly logs: readonly string[];
}
const FIXTURES: readonly Fixture[] = JSON.parse(readFileSync(new URL('./__fixtures__/curve-logs.json', import.meta.url), 'utf8'));
const TRADE = FIXTURES.find((f) => f.label === 'trade' && curveEvents(f.logs).trades.length === 1)!;
const COIN = curveEvents(TRADE.logs).trades[0]!.mint;

function harness() {
  let now = 1_000;
  const sent: Record<string, unknown>[] = [];
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  let handlers: StreamHandlers | null = null;
  let opened = 0;
  const notes: string[] = [];
  const sock = createTradeSocket({
    url: 'wss://example.invalid/',
    accountOf: (c) => `curve-of-${c}`,
    staleAfterMs: 30_000,
    probeEveryMs: 10_000,
    healthyAfterMs: 60_000,
    now: () => now as Millis,
    reconnectDelayMs: (n) => n * 1_000,
    open: (_url, h) => {
      handlers = h;
      opened += 1;
      return { send: (d) => sent.push(JSON.parse(d)), close: () => {} };
    },
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    note: (msg) => notes.push(msg),
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.live && x.at <= now)) {
      t.live = false;
      t.fn();
    }
  };
  const frame = (o: unknown) => handlers!.onMessage(JSON.stringify(o));
  const notify = (sub: number, value: Record<string, unknown>) => frame({ jsonrpc: '2.0', method: 'logsNotification', params: { subscription: sub, result: { context: { slot: 1 }, value } } });
  return { sock, sent, advance, frame, notify, open: () => handlers!.onOpen(), close: (why: string) => handlers!.onClose(why), opened: () => opened, notes, now: () => now };
}

test('★ a coin is subscribed on its curve, its trades decoded, and every byte charged to it', () => {
  const h = harness();
  h.sock.watch(COIN);
  h.sock.start();
  h.open();
  const sub = h.sent.find((s) => s['method'] === 'logsSubscribe')!;
  assert.deepEqual((sub['params'] as unknown[])[0], { mentions: [`curve-of-${COIN}`] });
  h.frame({ jsonrpc: '2.0', id: sub['id'], result: 77 });
  h.notify(77, { signature: TRADE.signature, err: null, logs: TRADE.logs });
  h.notify(77, { signature: 'failed', err: { InstructionError: [0, 'x'] }, logs: TRADE.logs });
  const d = h.sock.drain();
  assert.equal(d.subscribed[0]?.coin, COIN);
  assert.equal(d.trades.length, 1);
  assert.equal(d.trades[0]?.coin, COIN);
  assert.equal(d.failedDropped, 1, 'a failed transaction is dropped');
  assert.ok((d.bytes.get(COIN) ?? 0) > 2 * JSON.stringify(TRADE.logs).length, 'and still paid for: both frames are charged to the coin');
  assert.ok(d.otherBytes > 0, 'the subscribe reply is charged to nobody');
});

test('a cut log is handed over as cut, with none of its trades', () => {
  const h = harness();
  h.sock.watch(COIN);
  h.sock.start();
  h.open();
  h.frame({ jsonrpc: '2.0', id: h.sent[0]!['id'], result: 5 });
  h.notify(5, { signature: 'cut', err: null, logs: [...TRADE.logs, 'Log truncated'] });
  const d = h.sock.drain();
  assert.equal(d.trades.length, 0);
  assert.deepEqual(d.truncated.map((t) => t.signature), ['cut']);
});

test('frames after an unsubscribe are still charged to the coin; a refused subscribe is reported', () => {
  const h = harness();
  h.sock.watch(COIN);
  h.sock.watch('other');
  h.sock.start();
  h.open();
  const [a, b] = h.sent.filter((s) => s['method'] === 'logsSubscribe');
  h.frame({ jsonrpc: '2.0', id: a!['id'], result: 9 });
  h.frame({ jsonrpc: '2.0', id: b!['id'], error: { code: -32602, message: 'Invalid' } });
  h.sock.unwatch(COIN);
  assert.ok(h.sent.some((s) => s['method'] === 'logsUnsubscribe' && (s['params'] as unknown[])[0] === 9));
  h.notify(9, { signature: TRADE.signature, err: null, logs: TRADE.logs });
  const d = h.sock.drain();
  assert.equal(d.trades.length, 0, 'not watched any more: no trades');
  assert.ok((d.bytes.get(COIN) ?? 0) > 0, 'but its bytes count');
  assert.equal(d.refused[0]?.coin, 'other');
});

test('★ a drop is an outage for every coin, and on reconnect the coins are subscribed again', () => {
  const h = harness();
  h.sock.watch(COIN);
  h.sock.start();
  h.open();
  h.advance(5_000);
  h.close('socket closed (1006)');
  assert.equal(h.sock.live(), false);
  h.advance(1_000); // the first retry
  assert.equal(h.opened(), 2);
  h.open();
  const d = h.sock.drain();
  assert.equal(d.outages.length, 1);
  assert.equal(d.outages[0]?.fromMs, 6_000);
  assert.equal(d.outages[0]?.toMs, 7_000);
  assert.equal(h.sent.filter((s) => s['method'] === 'logsSubscribe').length, 2);
});

test('a silent socket is noticed: probes keep a quiet one alive, and no reply at all is an outage from the last frame', () => {
  const h = harness();
  h.sock.start();
  h.open();
  h.advance(10_000);
  const probe = h.sent.find((s) => s['method'] === 'logsUnsubscribe');
  assert.ok(probe !== undefined, 'a probe went out');
  h.frame({ jsonrpc: '2.0', id: probe['id'], result: false });
  h.advance(25_000);
  assert.equal(h.sock.live(), true, 'answered 25 s ago: alive');
  h.advance(10_000);
  assert.equal(h.sock.live(), false, 'nothing for over 30 s: dead');
  h.advance(1_000);
  h.open();
  const d = h.sock.drain();
  assert.equal(d.outages[0]?.fromMs, 11_000, 'the hole starts at the last frame');
});
