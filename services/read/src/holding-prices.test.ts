import test from 'node:test';
import assert from 'node:assert/strict';

import type { CoinQuote } from '@insidor/market-dexscreener';

import { createHoldingPrices, SOL } from './holding-prices.ts';
import { SILENT } from './log.ts';

const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const MSTRX = 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const quote = (priceUsd: number | null, quoteAddress: string, native: number | null): CoinQuote => ({
  name: null, ticker: null, priceUsd, priceSol: quoteAddress === SOL ? native : null,
  marketCapUsd: null, liquidityUsd: null, change: { h1: 1, h6: 2, h24: 3 }, bonded: true,
  quote: { address: quoteAddress, price: native },
});

/* As the pair source answered on 2026-10-21: SOL at $180, Laura only in MSTRx with no dollar
   price, MSTRx against USDC. A coin it does not list is absent. */
const LISTED: Record<string, CoinQuote> = {
  [SOL]: quote(180, USDC, 180),
  [LAURA]: quote(null, MSTRX, 0.0000002712),
  [MSTRX]: quote(146.61, USDC, 146.6143),
  SOLPAIR: quote(0.9, SOL, 0.005),
};

function pairs(listed: Record<string, CoinQuote>, asked: string[][] = [], failing: (a: readonly string[]) => boolean = () => false) {
  return {
    batch: 2,
    async quotes(addresses: readonly string[]) {
      asked.push([...addresses]);
      if (failing(addresses)) throw new Error('responded 429');
      return new Map(addresses.flatMap((a) => (listed[a] === undefined ? [] : [[a, listed[a]] as const])));
    },
  };
}

const pricer = (over: Partial<Parameters<typeof createHoldingPrices>[0]> = {}) =>
  createHoldingPrices({ pairs: pairs(LISTED), tokenPrices: null, log: SILENT, now: () => 0, keepMs: 30_000, ...over });

test('★ a coin paired only with another coin is priced through that coin\'s dollar price, and its SOL price is dollars over SOL\'s', async () => {
  const asked: string[][] = [];
  const p = await pricer({ pairs: pairs({ [SOL]: LISTED[SOL]!, [LAURA]: LISTED[LAURA]! }, asked) }).prices([SOL, LAURA]);
  /* MSTRx was not in the first answer, so it is asked for. */
  assert.deepEqual(asked, [[SOL, LAURA], [MSTRX]]);
  assert.equal(p.get(LAURA)?.priceUsd, null, 'MSTRx is not listed here, so nothing converts');

  const q = await pricer().prices([SOL, LAURA]);
  const laura = q.get(LAURA)!;
  assert.ok(Math.abs(laura.priceUsd! - 0.0000002712 * 146.61) < 1e-15);
  assert.ok(Math.abs(laura.priceSol! - (0.0000002712 * 146.61) / 180) < 1e-18, 'never the price in MSTRx read as SOL');
  assert.equal(laura.quote?.change.h24, 3, 'the move is still the pair source\'s');
  assert.equal(q.get(SOL)?.priceSol, 1);
});

test('★ what the pair source cannot price, the token price source does; nothing anywhere is no_market, never zero', async () => {
  const tokenAsked: string[][] = [];
  const tokenPrices = { async prices(a: readonly string[]) { tokenAsked.push([...a]); return new Map([['ONLYTOKEN', 0.25]]); } };
  const p = await pricer({ tokenPrices }).prices([SOL, 'ONLYTOKEN', 'NOWHERE', 'SOLPAIR']);
  assert.equal(p.get('ONLYTOKEN')?.priceUsd, 0.25);
  assert.ok(Math.abs(p.get('ONLYTOKEN')!.priceSol! - 0.25 / 180) < 1e-15);
  assert.deepEqual(tokenAsked, [['ONLYTOKEN', 'NOWHERE']], 'only what the pair source left unpriced');
  assert.equal(p.get('NOWHERE')?.priceUsd, null);
  assert.equal(p.get('NOWHERE')?.why, 'no_market');
  assert.ok(Math.abs(p.get('SOLPAIR')!.priceSol! - 0.9 / 180) < 1e-15);
});

test('★ one failed batch costs only its own coins; an outage is not_read_yet, never no_market', async () => {
  const failing = (a: readonly string[]) => a.includes('SOLPAIR');
  const p = await pricer({ pairs: pairs(LISTED, [], failing) }).prices([SOL, LAURA, 'SOLPAIR', MSTRX]);
  /* Batches of two: [SOL, LAURA] answered, [SOLPAIR, MSTRX] failed — Laura's quote coin with it. */
  assert.equal(p.get(SOL)?.priceUsd, 180, 'the batch that answered still prices');
  assert.equal(p.get('SOLPAIR')?.priceUsd, null);
  assert.equal(p.get('SOLPAIR')?.why, 'not_read_yet');

  const tokenDown = { async prices(): Promise<ReadonlyMap<string, number>> { throw new Error('503'); } };
  const q = await pricer({ tokenPrices: tokenDown }).prices([SOL, 'NOWHERE']);
  assert.equal(q.get('NOWHERE')?.why, 'not_read_yet');

  /* And the token price source rescues the failed batch's coins. */
  const rescue = { async prices(a: readonly string[]) { return new Map(a.filter((x) => x === 'SOLPAIR').map((x) => [x, 0.9] as const)); } };
  const r = await pricer({ pairs: pairs(LISTED, [], failing), tokenPrices: rescue }).prices([SOL, LAURA, 'SOLPAIR', MSTRX]);
  assert.equal(r.get('SOLPAIR')?.priceUsd, 0.9);
});

test('a price is kept briefly; a coin left unread for an outage is asked again at once', async () => {
  let now = 0;
  const asked: string[][] = [];
  let down = true;
  const p = pricer({ now: () => now, pairs: pairs(LISTED, asked, (a) => down && a.includes('SOLPAIR')) });
  await p.prices([SOL, 'SOLPAIR']);
  down = false;
  await p.prices([SOL, 'SOLPAIR']);
  assert.equal(asked.filter((a) => a.includes('SOLPAIR')).length, 2, 'the outage was not kept');
  await p.prices([SOL, 'SOLPAIR']);
  assert.equal(asked.filter((a) => a.includes('SOLPAIR')).length, 2, 'the answer was');
  now += 30_000;
  await p.prices([SOL, 'SOLPAIR']);
  assert.equal(asked.filter((a) => a.includes('SOLPAIR')).length, 3);
});
