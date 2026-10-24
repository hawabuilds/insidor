import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardNumbers, cardTrade, coinScale, createTradeCard, executionCapUsd, solRequests, solUsdNear, type CardScale, type CardTrade } from './trade-card.ts';
import type { Row } from './queries.ts';

const SOL = 1_000_000_000n;
const buy = (sol: bigint, coins: bigint, capUsd: number | null = null, atMs: number | null = 1): CardTrade => ({ kind: 'buy', lamports: sol, coins, capUsd, atMs });
const sell = (sol: bigint, coins: bigint, capUsd: number | null = null, atMs: number | null = 2): CardTrade => ({ kind: 'sell', lamports: sol, coins, capUsd, atMs });
/* Whole-unit coins, a supply of 1,000 and SOL at $100: a cap is 100,000 times the SOL paid per coin. */
const flat: CardScale = { decimals: 0, supply: 1_000, solUsdAt: () => 100 };
const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.abs(b) * 1e-9;

test('★ KURIBO, 24 Oct 2026: two trades 24 seconds apart get their own caps, and the loss reads as one', () => {
  /* The owner's trades from public.trade. Both rows carry market_cap_usd 277033, one market reading
     from 01:32:30 London, so the card used to say 1.0x on a trade that lost 0.0072 SOL. */
  const buyAt = Date.parse('2026-10-24T00:35:50Z');
  const sellAt = Date.parse('2026-10-24T00:36:19Z');
  const scale: CardScale = {
    decimals: 6,
    /* KURIBO's market reading of 01:32:30 London: $277,033 over $0.0002838. */
    supply: 277_033 / 0.0002838,
    /* SOL's one-minute closes at 00:35 and 00:36 UTC. */
    solUsdAt: (at) => (at === buyAt ? 102.24064002703577 : at === sellAt ? 102.25352039973511 : null),
  };
  const n = cardNumbers(sell(94_002_056n, 42_800_962_223n, 277_033, sellAt), [buy(100_000_000n, 42_282_954_767n, 277_033, buyAt)], scale);
  assert.ok(n.boughtCapUsd.v !== null && n.soldCapUsd.v !== null && n.multiple.v !== null);
  assert.notEqual(n.boughtCapUsd.v, n.soldCapUsd.v);
  assert.ok(Math.abs(n.boughtCapUsd.v - 236_035.51) < 0.5, `bought ${n.boughtCapUsd.v}`);
  assert.ok(Math.abs(n.soldCapUsd.v - 219_220.52) < 0.5, `sold ${n.soldCapUsd.v}`);
  assert.ok(n.multiple.v < 1 && Math.abs(n.multiple.v - 0.92876) < 1e-4, `multiple ${n.multiple.v}`);
  assert.equal(n.profitSol.v, -0.007223041);
});

test("★ a cap is the trade's own price: SOL over coins, minding decimals, times SOL in dollars, times supply", () => {
  /* 0.1 SOL for 1,000 coins of 6 decimals: 0.0001 SOL a coin; at $150 and a 1e9 supply, $15,000,000. */
  const v = executionCapUsd(buy(SOL / 10n, 1_000_000_000n), { decimals: 6, supply: 1e9, solUsdAt: () => 150 });
  assert.ok(v.v !== null && near(v.v, 15_000_000));
  /* The recorded cap is never read while the amounts are there. */
  assert.deepEqual(executionCapUsd(buy(SOL, 1_000n, 999_999), flat), { v: 100 });
});

test('★ the recorded cap is the fallback only for a trade with no amounts', () => {
  assert.deepEqual(executionCapUsd(sell(0n, 0n, 40_000), flat), { v: 40_000 });
  assert.deepEqual(executionCapUsd(sell(0n, 0n, null), flat), { v: null, why: 'not_recorded' });
});

test('★ no SOL price is "not read yet", no supply or decimals "not recorded": never a zero, never the stale cap', () => {
  assert.deepEqual(executionCapUsd(sell(SOL, 1_000n, 40_000), { ...flat, solUsdAt: () => null }), { v: null, why: 'not_read_yet' });
  assert.deepEqual(executionCapUsd(sell(SOL, 1_000n, 40_000), { ...flat, supply: null }), { v: null, why: 'not_recorded' });
  assert.deepEqual(executionCapUsd(sell(SOL, 1_000n, 40_000), { ...flat, decimals: null }), { v: null, why: 'not_recorded' });
});

test('★ one buy, one sell: the multiple is sold cap over bought cap, the profit what the sell made over what it cost', () => {
  const n = cardNumbers(sell(2n * SOL, 1_000n), [buy(SOL / 2n, 1_000n)], flat);
  assert.deepEqual(n.boughtCapUsd, { v: 50 });
  assert.deepEqual(n.soldCapUsd, { v: 200 });
  assert.deepEqual(n.multiple, { v: 4 });
  assert.deepEqual(n.profitSol, { v: 1.5 });
});

test('★ several buys: the entry is the cap at the average price, weighted by the coins each bought', () => {
  /* 300 coins for 0.3 SOL and 100 for 0.3 SOL: 0.0015 SOL a coin on average, not the plain mean 0.002. */
  const n = cardNumbers(sell(SOL, 400n), [buy((SOL * 3n) / 10n, 300n), buy((SOL * 3n) / 10n, 100n)], flat);
  assert.ok(n.boughtCapUsd.v !== null && near(n.boughtCapUsd.v, 150));
  assert.ok(n.multiple.v !== null && near(n.multiple.v, 250 / 150));
  assert.ok(n.profitSol.v !== null && near(n.profitSol.v, 0.4));
});

test('★ a loss is said as a loss: a multiple under 1 and a negative profit', () => {
  /* The real SIDEEYE sell of 23 Oct 2026, from public.trade. */
  const n = cardNumbers(sell(44_060_373n, 274_308_856_291n), [buy(50_000_000n, 274_308_856_291n)], { decimals: 6, supply: 1e9, solUsdAt: () => 190 });
  assert.ok(n.multiple.v !== null && n.multiple.v < 1);
  assert.equal(n.profitSol.v, -0.005939627);
});

test('a part sell costs only its share: half the coins, half the cost', () => {
  const n = cardNumbers(sell(SOL, 500n), [buy(SOL, 1_000n)], flat);
  assert.deepEqual(n.profitSol, { v: 0.5 });
});

test('★ nothing bought here: no entry, no multiple, no profit, each with its reason, never zero', () => {
  const n = cardNumbers(sell(SOL, 1_000n), [], flat);
  assert.deepEqual(n.boughtCapUsd, { v: null, why: 'not_bought_here' });
  assert.deepEqual(n.multiple, { v: null, why: 'not_bought_here' });
  assert.deepEqual(n.profitSol, { v: null, why: 'not_bought_here' });
  assert.deepEqual(n.soldCapUsd, { v: 100 });
});

test("★ SOL's price unread for one buy: the entry is unknown, the multiple falls back to the price ratio", () => {
  const scale: CardScale = { ...flat, solUsdAt: (at) => (at === 9 ? null : 100) };
  const n = cardNumbers(sell(SOL, 200n), [buy(SOL / 4n, 100n), buy(SOL / 4n, 100n, 10_000, 9)], scale);
  assert.deepEqual(n.boughtCapUsd, { v: null, why: 'not_read_yet' });
  /* Paid 0.0025 SOL a coin, sold at 0.005: twice, with no dollar price needed. */
  assert.deepEqual(n.multiple, { v: 2 });
  assert.deepEqual(n.profitSol, { v: 0.5 });
});

test('★ selling more than the buys here left: the rest was bought elsewhere, so no profit', () => {
  /* Bought 100 here, sold 60 before, now sells 100. */
  const n = cardNumbers(sell(SOL, 100n), [buy(SOL / 2n, 100n), sell(SOL / 2n, 60n)], flat);
  assert.deepEqual(n.profitSol, { v: null, why: 'bought_elsewhere' });
  /* A sell a little over the quoted buy (the coins that landed can exceed the quote) still counts. */
  const close = cardNumbers(sell(SOL, 103n), [buy(SOL / 2n, 100n)], flat);
  assert.ok(close.profitSol.v !== null);
});

test('★ a row is read by side: a buy is SOL in and coins out, a sell coins in and SOL out', () => {
  const b = cardTrade({ kind: 'buy', in_amount: '50000000', out_amount: '615882068687', market_cap_usd: 8258.02, settled_ms: '1792800000000' } as Row);
  assert.deepEqual(b, { kind: 'buy', lamports: 50_000_000n, coins: 615_882_068_687n, capUsd: 8258.02, atMs: 1792800000000 });
  const s = cardTrade({ kind: 'sell', in_amount: '615882068687', out_amount: '48495350', market_cap_usd: null } as Row);
  assert.deepEqual(s, { kind: 'sell', lamports: 48_495_350n, coins: 615_882_068_687n, capUsd: null, atMs: null });
  assert.deepEqual(cardTrade({ kind: 'buy', in_amount: null, out_amount: '1' } as Row), { kind: 'buy', lamports: 0n, coins: 1n, capUsd: null, atMs: null });
  assert.equal(cardTrade({ kind: 'transfer', in_amount: '1', out_amount: '1' } as Row), null);
});

test("the coin's scale: its stored decimals and reading supply; a launchpad coin falls back to its fixed mint", () => {
  assert.deepEqual(coinScale('Abc', { decimals: 9, supply: 976_155_743.48 } as Row), { decimals: 9, supply: 976_155_743.48 });
  assert.deepEqual(coinScale('8WRdyRqn2GeAxNb5MpGqHytXTD1MHEiTewbadR5hpump', { decimals: null, supply: null } as Row), { decimals: 6, supply: 1e9 });
  assert.deepEqual(coinScale('Abc', undefined), { decimals: null, supply: null });
});

test("SOL's price at a landing: its own minute, else the nearest within five before, else none", () => {
  const closes = new Map([[0, 100], [60_000, 101]]);
  assert.equal(solUsdNear(closes, 65_000), 101);
  assert.equal(solUsdNear(closes, 200_000), 101);
  assert.equal(solUsdNear(closes, 60_000 * 7), null);
  assert.equal(solUsdNear(closes, null), null);
});

test('SOL candle requests: one page covers trades close together, a far buy gets its own', () => {
  const m = 60_000;
  assert.deepEqual(solRequests([10 * m + 5, 9 * m + 1]), [{ untilMs: 11 * m, minutes: 7 }]);
  assert.deepEqual(solRequests([5_000 * m, 10 * m]), [{ untilMs: 5_001 * m, minutes: 6 }, { untilMs: 11 * m, minutes: 6 }]);
});

const SIG = '5'.repeat(88);
const log = { info: () => undefined, error: () => undefined };

function fakeDb(sellRow: Row | null, extra: { earlier?: Row[]; post?: Row | null; files?: Row[]; scale?: Row } = {}) {
  const asked: string[] = [];
  return {
    asked,
    db: {
      async query(sql: string): Promise<readonly Row[]> {
        asked.push(sql);
        if (sql.includes('where signature = $1')) return sellRow === null ? [] : [sellRow];
        if (sql.includes('t.settled_at < s.settled_at')) return extra.earlier ?? [];
        if (sql.includes('public.feed_post')) return extra.post === undefined || extra.post === null ? [] : [extra.post];
        if (sql.includes('public.post_picture')) return extra.files ?? [];
        if (sql.includes('public.coin_name')) return [{ ticker: 'SIDEEYE', name: 'SIDE EYE DOG' }];
        if (sql.includes('as supply')) return extra.scale === undefined ? [] : [extra.scale];
        return [];
      },
    },
  };
}

const route = (db: ReturnType<typeof fakeDb>['db']) => createTradeCard({ db, log, now: () => 0, solCandles: null });

test('★ a sell not yet landed is pending, asked again next time; one that failed is no card', async () => {
  const pending = fakeDb({ kind: 'sell', status: 'sent', mint: 'M', in_amount: '1', out_amount: '1', settled_ms: null });
  const r = route(pending.db);
  assert.deepEqual(JSON.parse((await r.card(SIG, 'c')).body), { kind: 'pending' });
  await r.card(SIG, 'c');
  assert.equal(pending.asked.length, 2, 'a pending reply is not kept');

  const failed = fakeDb({ kind: 'sell', status: 'failed' });
  assert.deepEqual(JSON.parse((await route(failed.db).card(SIG, 'c')).body), { kind: 'none', why: 'failed' });
  const buyRow = fakeDb({ kind: 'buy', status: 'confirmed' });
  assert.deepEqual(JSON.parse((await route(buyRow.db).card(SIG, 'c')).body), { kind: 'none', why: 'not_a_sell' });
});

test("★ a landed sell: the trades' own caps, the coin and the post with our stored picture copies only", async () => {
  const sellAt = 1_792_800_000_000;
  const f = fakeDb(
    { wallet: 'W', kind: 'sell', status: 'confirmed', mint: 'M', in_amount: '1000', out_amount: '2000000000', market_cap_usd: 40_000, settled_ms: String(sellAt) },
    {
      earlier: [{ kind: 'buy', in_amount: '500000000', out_amount: '1000', market_cap_usd: 9_000, settled_ms: String(sellAt - 120_000) }],
      post: { item_id: 'x:1', posted_ms: '1792700000000', author: '@teeelatricee', thumb: 'https://pic.example/a.jpg?sig=1', author_file: 'df94874b9a4fcbbb8e9eda7c2f871da6' },
      files: [{ link_path: 'https://pic.example/a.jpg', file: 'f6c9a08a0b96f1bd86b9c8af91630c58' }],
      scale: { decimals: 0, supply: 1_000 },
    },
  );
  const asked: { untilMs: number; minutes: number }[] = [];
  const solCandles = async (untilMs: number, minutes: number) => {
    asked.push({ untilMs, minutes });
    return [{ t: sellAt - 120_000, c: 100 }, { t: sellAt, c: 110 }];
  };
  const body = JSON.parse((await createTradeCard({ db: f.db, log, now: () => sellAt + 600_000, solCandles }).card(SIG, 'c')).body);
  assert.equal(body.kind, 'read');
  assert.equal(body.ticker, 'SIDEEYE');
  /* Bought at 0.0005 SOL a coin with SOL at $100, sold at 0.002 with SOL at $110; the recorded 9,000 and 40,000 unused. */
  assert.deepEqual(body.boughtCapUsd, { v: 50 });
  assert.deepEqual(body.soldCapUsd, { v: 220 });
  assert.ok(near(body.multiple.v, 4.4));
  assert.deepEqual(body.profitSol, { v: 1.5 });
  assert.deepEqual(body.post, { id: 'x:1', postedAt: 1792700000000, author: '@teeelatricee', authorPictureFile: 'df94874b9a4fcbbb8e9eda7c2f871da6', pictureFile: 'f6c9a08a0b96f1bd86b9c8af91630c58' });
  assert.equal(asked.length, 1, 'one candle page covers both trades');
});

test("★ SOL's price not answering: no caps, the price-ratio multiple stands, and the reply is not kept", async () => {
  const f = fakeDb(
    { wallet: 'W', kind: 'sell', status: 'confirmed', mint: 'M', in_amount: '1000', out_amount: '2000000000', market_cap_usd: 40_000, settled_ms: '1792800000000' },
    { earlier: [{ kind: 'buy', in_amount: '500000000', out_amount: '1000', market_cap_usd: 9_000, settled_ms: '1792799000000' }], scale: { decimals: 0, supply: 1_000 } },
  );
  let calls = 0;
  const r = createTradeCard({
    db: f.db,
    log,
    now: () => 0,
    solCandles: async () => {
      calls++;
      throw new Error('down');
    },
  });
  const body = JSON.parse((await r.card(SIG, 'c')).body);
  assert.deepEqual(body.soldCapUsd, { v: null, why: 'not_read_yet' });
  assert.deepEqual(body.boughtCapUsd, { v: null, why: 'not_read_yet' });
  assert.deepEqual(body.multiple, { v: 4 });
  await r.card(SIG, 'c');
  assert.equal(calls, 2, 'asked again: an unread price is not kept');
});

test('a post with no stored picture copy names none, and no post is null', async () => {
  const sellRow = { wallet: 'W', kind: 'sell', status: 'confirmed', mint: 'M', in_amount: '1', out_amount: '1', market_cap_usd: 1, settled_ms: '1' };
  const noCopy = fakeDb(sellRow, { post: { item_id: 'x:1', posted_ms: null, author: 'Some Channel', thumb: 'https://pic.example/a.jpg', author_file: null } });
  const body = JSON.parse((await route(noCopy.db).card(SIG, 'c')).body);
  assert.deepEqual(body.post, { id: 'x:1', postedAt: null, author: null, authorPictureFile: null, pictureFile: null });
  const none = fakeDb(sellRow, { post: null });
  assert.equal(JSON.parse((await route(none.db).card(SIG, 'c')).body).post, null);
});

test('a signature that is not one is refused before any read', async () => {
  const f = fakeDb(null);
  assert.equal((await route(f.db).card("x' or 1=1", 'c')).status, 400);
  assert.equal(f.asked.length, 0);
});
