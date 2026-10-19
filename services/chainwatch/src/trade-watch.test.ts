/**
 * The trade watcher against a fake socket, chain and store: trades into whole minute and state
 * rows, and every end of measurement — a coin's byte cap, the day's credit cap, an outage, a cut
 * log, a graduated or curveless coin — recorded as not measured from an instant, never as quiet.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { TradeBook } from './trade-book.ts';
import { createTradeWatch, type ChainPort, type SocketDrain, type SocketTrade, type TradeStorePort } from './trade-watch.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 19, 18, 0, 0);
const CREATOR = 'Creator';

const emptyDrain = (): SocketDrain => ({ trades: [], bytes: new Map(), otherBytes: 0, subscribed: [], refused: [], truncated: [], completed: [], otherQuote: [], failedDropped: 0, undecodable: 0, outages: [] });

function world(o: { places?: Record<string, 'curve' | 'graduated' | 'no_curve'>; dayCredits?: number; coins?: string[] } = {}) {
  let now = T0;
  const watching = new Set<string>();
  let next: Partial<SocketDrain>[] = [];
  const writes: Parameters<TradeStorePort['write']>[0][] = [];
  const coins = o.coins ?? ['A', 'B'];
  const socket = {
    live: () => true,
    watch: (c: string) => void watching.add(c),
    unwatch: (c: string) => void watching.delete(c),
    drain: (): SocketDrain => ({ ...emptyDrain(), ...(next.shift() ?? {}) }),
  };
  const chain: ChainPort = {
    places: async (cs) => ({ places: new Map(cs.map((c) => [c, o.places?.[c] ?? 'curve'] as const)), calls: 1 }),
    transactionTrades: async () => null,
    opening: async () => ({ opening: { creatorBuyTokens: 1_000, creatorBuySol: 0.5, launchMcapSol: 30 }, historyCalls: 2 }),
  };
  const store: TradeStorePort = {
    watchList: async () => coins.map((address) => ({ address, untilMs: T0 + 60 * MIN, measuredFromMs: null, unmeasured: false })),
    missingOpenings: async (a) => new Set(a.filter((x) => x === 'A')),
    day: async () => (o.dayCredits === undefined ? null : { dayMs: Date.UTC(2026, 9, 19), bytes: 0, rpcCalls: 0, credits: o.dayCredits }),
    markRestarted: async () => 0,
    write: async (w) => void writes.push(w),
  };
  const policy = { watchMs: DEFAULT_POLICY.oneCoin.watchMs, tradeFeed: { ...DEFAULT_POLICY.oneCoin.tradeFeed, coinCapBytes: 10_000, dayCapCredits: 1_000 } };
  const watch = createTradeWatch({ socket, chain, store, policy, now: () => now, note: () => undefined });
  return {
    watch,
    watching,
    writes,
    queue: (...d: Partial<SocketDrain>[]) => void (next = [...next, ...d]),
    advance: (ms: number) => void (now += ms),
    now: () => now,
    cover: (address: string) => writes.flatMap((w) => w.cover).filter((c) => c.address === address),
  };
}

const trade = (coin: string, user: string, isBuy: boolean, sol: number, cap: number, atMs: number): SocketTrade => ({ coin, user, creator: CREATOR, isBuy, timestampS: atMs / 1_000, sol, mcapSol: cap, seenAtMs: atMs });

test('★ a coin on its curve is subscribed, measured from its confirmation, and its trades written as whole minutes and state', async () => {
  const w = world();
  await w.watch.boot();
  await w.watch.pass();
  assert.deepEqual([...w.watching].sort(), ['A', 'B']);
  assert.deepEqual(w.writes[0]?.openings, [{ address: 'A', creatorBuyTokens: 1_000, creatorBuySol: 0.5, launchMcapSol: 30 }], 'the missing opening buy is read once');
  w.advance(5_000);
  w.queue({
    subscribed: [{ coin: 'A', atMs: T0 + 1_000 }, { coin: 'B', atMs: T0 + 1_000 }],
    trades: [trade('A', 'u1', true, 1, 40, T0 + 2_000), trade('A', 'u2', true, 2, 45, T0 + 3_000), trade('A', 'u1', true, 1, 50, T0 + 70_000), trade('A', CREATOR, false, 0.5, 48, T0 + 71_000)],
    bytes: new Map([['A', 4_000]]),
  });
  await w.watch.pass();
  const last = w.writes[1]!;
  const m0 = last.minutes.find((m) => m.minuteMs === T0)!;
  const m1 = last.minutes.find((m) => m.minuteMs === T0 + MIN)!;
  assert.deepEqual([m0.buys, m0.buyers, m0.newBuyers, m0.buySol, m0.lastMcapSol], [2, 2, 2, 3, 45]);
  assert.deepEqual([m1.buys, m1.sells, m1.buyers, m1.newBuyers, m1.creatorSoldSol, m1.lastMcapSol], [1, 1, 1, 0, 0.5, 48], 'a wallet that bought before is not new');
  assert.deepEqual(last.states.map((s) => [s.address, s.uniqueBuyers, s.peakMcapSol, s.lastMcapSol, s.creatorSold]), [['A', 2, 50, 48, true]]);
  assert.equal(w.cover('A').find((c) => c.measuredFromMs !== null)?.measuredFromMs, T0 + 1_000);
  assert.equal(w.cover('B').at(-1)?.measuredToMs, w.now(), 'B, with no trade, is a measured nothing: its heartbeat moves');
  assert.equal(w.cover('A').at(-1)?.addBytes, 4_000);
});

test('★ a coin past its byte cap is unsubscribed and recorded not measured from then', async () => {
  const w = world();
  await w.watch.boot();
  await w.watch.pass();
  w.advance(5_000);
  w.queue({ subscribed: [{ coin: 'A', atMs: T0 }, { coin: 'B', atMs: T0 }], bytes: new Map([['A', 10_001]]) });
  await w.watch.pass();
  assert.equal(w.watching.has('A'), false);
  assert.deepEqual(w.cover('A').find((c) => c.unmeasured !== null)?.unmeasured, { fromMs: w.now(), reason: 'coin_cap' });
  assert.equal(w.watching.has('B'), true, 'the other coin is untouched');
});

test('★ the day\'s credit cap ends every coin, and a new coin that day is recorded not measured, never subscribed', async () => {
  const w = world({ dayCredits: 999 });
  await w.watch.boot();
  await w.watch.pass();
  w.advance(5_000);
  w.queue({ subscribed: [{ coin: 'A', atMs: T0 }, { coin: 'B', atMs: T0 }], bytes: new Map([['A', 100_000]]) }); // 2 credits: over 1,000
  await w.watch.pass();
  assert.equal(w.watching.size, 0);
  assert.deepEqual(['A', 'B'].map((c) => w.cover(c).find((x) => x.unmeasured !== null)?.unmeasured?.reason), ['day_cap', 'day_cap']);
  assert.ok(w.watch.status().dayCapped);
  assert.ok((w.writes.at(-1)?.day?.credits ?? 0) >= 1_000, 'the counted cost is written with the day');
});

test('a day already over its cap at boot subscribes nothing', async () => {
  const w = world({ dayCredits: 1_000 });
  await w.watch.boot();
  w.advance(10_000);
  await w.watch.pass();
  assert.equal(w.watching.size, 0);
  assert.equal(w.cover('A').at(-1)?.unmeasured?.reason, 'day_cap');
});

test('★ an outage ends every coin measured across it, from the outage\'s start', async () => {
  const w = world();
  await w.watch.boot();
  await w.watch.pass();
  w.advance(5_000);
  w.queue({ subscribed: [{ coin: 'A', atMs: T0 + 1_000 }] });
  await w.watch.pass();
  w.advance(5_000);
  w.queue({ outages: [{ fromMs: T0 + 6_000, toMs: T0 + 9_000, detail: 'dropped' }], subscribed: [{ coin: 'B', atMs: T0 + 9_500 }] });
  await w.watch.pass();
  assert.deepEqual(w.cover('A').find((c) => c.unmeasured !== null)?.unmeasured, { fromMs: T0 + 6_000, reason: 'outage' });
  assert.equal(w.cover('B').some((c) => c.unmeasured !== null), false, 'B was first confirmed after the outage: measured from then');
});

test('a graduated or curveless coin is recorded not measured without a subscription; a graduating trade still counts', async () => {
  const w = world({ places: { B: 'graduated' }, coins: ['A', 'B', 'C'] });
  await w.watch.boot();
  await w.watch.pass();
  assert.deepEqual([...w.watching], ['A', 'C']);
  assert.equal(w.cover('B')[0]?.unmeasured?.reason, 'graduated');
  w.advance(5_000);
  w.queue({ subscribed: [{ coin: 'A', atMs: T0 }], trades: [trade('A', 'u1', true, 5, 400, T0 + 4_000)], completed: [{ coin: 'A', atMs: T0 + 4_000 }], otherQuote: [{ coin: 'C', atMs: T0 + 4_500 }] });
  await w.watch.pass();
  assert.equal(w.writes.at(-1)?.states[0]?.peakMcapSol, 400);
  assert.equal(w.cover('A').find((c) => c.unmeasured !== null)?.unmeasured?.reason, 'graduated');
  assert.equal(w.cover('C').find((c) => c.unmeasured !== null)?.unmeasured?.reason, 'other_quote');
});

test('a cut log that cannot be read whole ends its coin as truncated; its trades are not guessed', async () => {
  const w = world();
  await w.watch.boot();
  await w.watch.pass();
  w.advance(5_000);
  w.queue({ subscribed: [{ coin: 'A', atMs: T0 }], truncated: [{ coin: 'A', signature: 's', atMs: T0 + 3_000 }] });
  await w.watch.pass();
  assert.deepEqual(w.cover('A').find((c) => c.unmeasured !== null)?.unmeasured, { fromMs: T0 + 3_000, reason: 'truncated' });
  assert.equal(w.writes.at(-1)?.states.length, 0);
});

test('a failed write hands the same rows over again next time', async () => {
  const book = new TradeBook();
  book.apply({ coin: 'A', user: 'u', creator: CREATOR, isBuy: true, timestampS: T0 / 1_000, sol: 1, mcapSol: 30, seenAtMs: T0 });
  const rows = book.take();
  assert.equal(book.take().minutes.length, 0);
  book.restore(rows);
  assert.equal(book.take().minutes.length, 1);
});
