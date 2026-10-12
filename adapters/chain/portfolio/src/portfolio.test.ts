import test from 'node:test';
import assert from 'node:assert/strict';

import { BALANCE, CLASSIC, PARSED, TOKEN_2022, WALLET } from './__fixtures__/wallet.ts';
import { readBalances } from './index.ts';
import { positionsFrom, profitOf, tradesFromTx, type ParsedTx, type Trade } from './trades.ts';

test('a wallet\'s balances from recorded replies: SOL, and every coin with something in it, both token programs', () => {
  const b = readBalances(BALANCE, CLASSIC, TOKEN_2022);
  assert.equal(b.lamports, String((BALANCE as { result: { value: number } }).result.value));
  assert.equal(b.tokens.length, 6, 'the empty account is left out');
  assert.ok(b.tokens.some((t) => t.mint.startsWith('6VwLzw') && t.amount !== '0'), 'a Token-2022 coin is read too');
});

test('★ an outage is not an empty wallet: a missing reply throws', () => {
  assert.throws(() => readBalances({ jsonrpc: '2.0', id: 1, error: { code: -32005 } }, CLASSIC), /no balance/);
  assert.throws(() => readBalances(BALANCE, { jsonrpc: '2.0', id: 1 }), /no accounts/);
});

test('SOL arriving with nothing going out is not a trade (recorded transactions)', () => {
  for (const tx of PARSED as unknown as ParsedTx[]) assert.deepEqual(tradesFromTx(tx, WALLET), []);
});

const T = (side: 'buy' | 'sell', amount: number, sol: number, at: number): Trade => ({ signature: `s${at}`, at, mint: 'M', side, amount, sol });

test('★ no buy history means no number: a held coin with no priced buy says so', () => {
  assert.deepEqual(profitOf(1000, 0.5, undefined), { kind: 'none', why: 'no_buy_history' });
  assert.deepEqual(profitOf(1000, null, positionsFrom([T('buy', 1000, 0.1, 1)]).get('M')), { kind: 'none', why: 'no_buy_history' }, 'no price now is not a number either');
});

test('profit in SOL at average cost; a sell takes its share of the cost; holding more than was bought is partial', () => {
  const p = positionsFrom([T('buy', 1000, 0.1, 1), T('buy', 1000, 0.3, 2), T('sell', 1000, 0.25, 3)]).get('M');
  assert.equal(p?.qty, 1000);
  assert.ok(Math.abs((p?.costSol ?? 0) - 0.2) < 1e-12);
  const now = profitOf(1000, 0.5, p);
  assert.equal(now.kind, 'known');
  if (now.kind === 'known') assert.ok(Math.abs(now.sol - 0.3) < 1e-12);
  const more = profitOf(1500, 0.75, p);
  assert.equal(more.kind === 'known' && more.partial, true);
});

test('a buy is read from the wallet\'s own balance change, with the fee and token-account rent taken out', () => {
  const tx: ParsedTx = {
    signature: 'buy', timestamp: 10, fee: 5_000, feePayer: 'W',
    accountData: [
      { account: 'W', nativeBalanceChange: -(50_000_000 + 2_039_280 + 5_000) },
      { account: 'ATA', nativeBalanceChange: 2_039_280, tokenBalanceChanges: [{ userAccount: 'W', tokenAccount: 'ATA', mint: 'M', rawTokenAmount: { tokenAmount: '1000000000', decimals: 6 } }] },
    ],
  };
  assert.deepEqual(tradesFromTx(tx, 'W'), [{ signature: 'buy', at: 10_000, mint: 'M', side: 'buy', amount: 1000, sol: 0.05 }]);
});
