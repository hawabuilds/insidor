import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardNumbers, cardTrade, createTradeCard, type CardTrade } from './trade-card.ts';
import type { Row } from './queries.ts';

const SOL = 1_000_000_000n;
const buy = (sol: bigint, coins: bigint, capUsd: number | null): CardTrade => ({ kind: 'buy', lamports: sol, coins, capUsd });
const sell = (sol: bigint, coins: bigint, capUsd: number | null): CardTrade => ({ kind: 'sell', lamports: sol, coins, capUsd });

test('★ one buy, one sell: the multiple is sold cap over bought cap, the profit what the sell made over what it cost', () => {
  const n = cardNumbers(sell(2n * SOL, 1_000n, 40_000), [buy(SOL / 2n, 1_000n, 9_000)]);
  assert.deepEqual(n.boughtCapUsd, { v: 9_000 });
  assert.deepEqual(n.soldCapUsd, { v: 40_000 });
  assert.ok(n.multiple.v !== null && Math.abs(n.multiple.v - 40_000 / 9_000) < 1e-12);
  assert.deepEqual(n.profitSol, { v: 1.5 });
});

test('★ several buys: the entry is the cap at the average price, weighted by the coins each bought', () => {
  /* 300 coins at $10k and 100 at $30k: the average price paid sits at $15k, not the plain mean $20k. */
  const n = cardNumbers(sell(SOL, 400n, 30_000), [buy(SOL / 10n, 300n, 10_000), buy(SOL / 10n, 100n, 30_000)]);
  assert.deepEqual(n.boughtCapUsd, { v: 15_000 });
  assert.deepEqual(n.multiple, { v: 2 });
  assert.deepEqual(n.profitSol, { v: 0.8 });
});

test('★ a loss is said as a loss: a multiple under 1 and a negative profit', () => {
  /* The real SIDEEYE sell of 23 Oct 2026, from public.trade. */
  const n = cardNumbers(sell(44_060_373n, 274_308_856_291n, 16_990.18), [buy(50_000_000n, 274_308_856_291n, 18_542.17)]);
  assert.ok(n.multiple.v !== null && n.multiple.v < 1);
  assert.equal(n.profitSol.v, -0.005939627);
});

test('a part sell costs only its share: half the coins, half the cost', () => {
  const n = cardNumbers(sell(SOL, 500n, 20_000), [buy(SOL, 1_000n, 10_000)]);
  assert.deepEqual(n.profitSol, { v: 0.5 });
});

test('★ nothing bought here: no entry, no multiple, no profit, each with its reason, never zero', () => {
  const n = cardNumbers(sell(SOL, 1_000n, 20_000), []);
  assert.deepEqual(n.boughtCapUsd, { v: null, why: 'not_bought_here' });
  assert.deepEqual(n.multiple, { v: null, why: 'not_bought_here' });
  assert.deepEqual(n.profitSol, { v: null, why: 'not_bought_here' });
  assert.deepEqual(n.soldCapUsd, { v: 20_000 });
});

test('★ a buy with no recorded cap makes the entry unknown; the profit still stands on the amounts', () => {
  const n = cardNumbers(sell(SOL, 200n, 20_000), [buy(SOL / 4n, 100n, 10_000), buy(SOL / 4n, 100n, null)]);
  assert.deepEqual(n.boughtCapUsd, { v: null, why: 'not_recorded' });
  assert.deepEqual(n.multiple, { v: null, why: 'not_recorded' });
  assert.deepEqual(n.profitSol, { v: 0.5 });
});

test('no recorded sell cap: the entry stands, the multiple does not', () => {
  const n = cardNumbers(sell(SOL, 100n, null), [buy(SOL / 2n, 100n, 10_000)]);
  assert.deepEqual(n.soldCapUsd, { v: null, why: 'not_recorded' });
  assert.deepEqual(n.multiple, { v: null, why: 'not_recorded' });
  assert.deepEqual(n.boughtCapUsd, { v: 10_000 });
});

test('★ selling more than the buys here left: the rest was bought elsewhere, so no profit', () => {
  /* Bought 100 here, sold 60 before, now sells 100. */
  const n = cardNumbers(sell(SOL, 100n, 20_000), [buy(SOL / 2n, 100n, 10_000), sell(SOL / 2n, 60n, 15_000)]);
  assert.deepEqual(n.profitSol, { v: null, why: 'bought_elsewhere' });
  /* A sell a little over the quoted buy (the coins that landed can exceed the quote) still counts. */
  const close = cardNumbers(sell(SOL, 103n, 20_000), [buy(SOL / 2n, 100n, 10_000)]);
  assert.ok(close.profitSol.v !== null);
});

test('★ a row is read by side: a buy is SOL in and coins out, a sell coins in and SOL out', () => {
  const b = cardTrade({ kind: 'buy', in_amount: '50000000', out_amount: '615882068687', market_cap_usd: 8258.02 } as Row);
  assert.deepEqual(b, { kind: 'buy', lamports: 50_000_000n, coins: 615_882_068_687n, capUsd: 8258.02 });
  const s = cardTrade({ kind: 'sell', in_amount: '615882068687', out_amount: '48495350', market_cap_usd: null } as Row);
  assert.deepEqual(s, { kind: 'sell', lamports: 48_495_350n, coins: 615_882_068_687n, capUsd: null });
  assert.equal(cardTrade({ kind: 'buy', in_amount: null, out_amount: '1' } as Row), null);
  assert.equal(cardTrade({ kind: 'transfer', in_amount: '1', out_amount: '1' } as Row), null);
});

const SIG = '5'.repeat(88);
const log = { info: () => undefined, error: () => undefined };

function fakeDb(sellRow: Row | null, extra: { earlier?: Row[]; post?: Row | null; files?: Row[] } = {}) {
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
        return [];
      },
    },
  };
}

test('★ a sell not yet landed is pending, asked again next time; one that failed is no card', async () => {
  const pending = fakeDb({ kind: 'sell', status: 'sent', mint: 'M', in_amount: '1', out_amount: '1', settled_ms: null });
  const route = createTradeCard({ db: pending.db, log, now: () => 0 });
  assert.deepEqual(JSON.parse((await route.card(SIG, 'c')).body), { kind: 'pending' });
  await route.card(SIG, 'c');
  assert.equal(pending.asked.length, 2, 'a pending reply is not kept');

  const failed = fakeDb({ kind: 'sell', status: 'failed' });
  assert.deepEqual(JSON.parse((await createTradeCard({ db: failed.db, log, now: () => 0 }).card(SIG, 'c')).body), { kind: 'none', why: 'failed' });
  const buyRow = fakeDb({ kind: 'buy', status: 'confirmed' });
  assert.deepEqual(JSON.parse((await createTradeCard({ db: buyRow.db, log, now: () => 0 }).card(SIG, 'c')).body), { kind: 'none', why: 'not_a_sell' });
});

test('★ a landed sell: the numbers, the coin and the post with our stored picture copies only', async () => {
  const f = fakeDb(
    { wallet: 'W', kind: 'sell', status: 'confirmed', mint: 'M', in_amount: '1000', out_amount: '2000000000', market_cap_usd: 40_000, settled_ms: '1792800000000' },
    {
      earlier: [{ kind: 'buy', in_amount: '500000000', out_amount: '1000', market_cap_usd: 9_000 }],
      post: { item_id: 'x:1', posted_ms: '1792700000000', author: '@teeelatricee', thumb: 'https://pic.example/a.jpg?sig=1', author_file: 'df94874b9a4fcbbb8e9eda7c2f871da6' },
      files: [{ link_path: 'https://pic.example/a.jpg', file: 'f6c9a08a0b96f1bd86b9c8af91630c58' }],
    },
  );
  const body = JSON.parse((await createTradeCard({ db: f.db, log, now: () => 0 }).card(SIG, 'c')).body);
  assert.equal(body.kind, 'read');
  assert.equal(body.ticker, 'SIDEEYE');
  assert.deepEqual(body.profitSol, { v: 1.5 });
  assert.deepEqual(body.post, { id: 'x:1', postedAt: 1792700000000, author: '@teeelatricee', authorPictureFile: 'df94874b9a4fcbbb8e9eda7c2f871da6', pictureFile: 'f6c9a08a0b96f1bd86b9c8af91630c58' });
  assert.ok(!f.asked.some((q) => q.includes('market_reading')), 'no market read: the recorded caps only');
});

test('a post with no stored picture copy names none, and no post is null', async () => {
  const sellRow = { wallet: 'W', kind: 'sell', status: 'confirmed', mint: 'M', in_amount: '1', out_amount: '1', market_cap_usd: 1, settled_ms: '1' };
  const noCopy = fakeDb(sellRow, { post: { item_id: 'x:1', posted_ms: null, author: 'Some Channel', thumb: 'https://pic.example/a.jpg', author_file: null } });
  const body = JSON.parse((await createTradeCard({ db: noCopy.db, log, now: () => 0 }).card(SIG, 'c')).body);
  assert.deepEqual(body.post, { id: 'x:1', postedAt: null, author: null, authorPictureFile: null, pictureFile: null });
  const none = fakeDb(sellRow, { post: null });
  assert.equal(JSON.parse((await createTradeCard({ db: none.db, log, now: () => 0 }).card(SIG, 'c')).body).post, null);
});

test('a signature that is not one is refused before any read', async () => {
  const f = fakeDb(null);
  assert.equal((await createTradeCard({ db: f.db, log, now: () => 0 }).card("x' or 1=1", 'c')).status, 400);
  assert.equal(f.asked.length, 0);
});
