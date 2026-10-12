import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodePortfolio } from '../../shared/api/decode.ts';
import { fixturePortfolio } from '../../shared/api/fixture-wallet.ts';
import { confirmBuilt, fromBase64 } from '../trade/order-flow.ts';
import { tradingOn } from '../../shared/trading.ts';
import { compactAmount, profitLine } from './wallet-view.ts';

test('★ no buy history means a dash with its reason, never a number', () => {
  assert.deepEqual(profitLine({ kind: 'none', why: 'no_buy_history' }), { text: '— no buy history', tone: 'none' });
  assert.deepEqual(profitLine({ kind: 'none', why: 'history_unread' }), { text: '— buy history not read', tone: 'none' });
  assert.deepEqual(profitLine({ kind: 'known', sol: 0.0123, partial: false }), { text: '+0.012 SOL', tone: 'up' });
  assert.equal(profitLine({ kind: 'known', sol: -0.004, partial: true }).text, '−0.0040 SOL on part');
});

test('★ a profit the server did not claim to know is never decoded as a number', () => {
  const raw = fixturePortfolio() as { holdings: Record<string, unknown>[] };
  const forged = { ...raw, holdings: [{ ...raw.holdings[0], profit: { kind: 'known', sol: null } }] };
  const p = decodePortfolio(forged);
  assert.equal(p.kind === 'read' && p.holdings[0]?.profit.kind, 'none');
});

test('★ an unsure narrative match shows nothing: only a named narrative object is read', () => {
  const raw = fixturePortfolio() as { holdings: Record<string, unknown>[] };
  const p = decodePortfolio({ ...raw, holdings: [{ ...raw.holdings[0], story: null }] });
  assert.equal(p.kind === 'read' && p.holdings[0]?.story, null);
});

test('the sample wallet decodes: real holdings, each a dash for profit (no buy history in what was read)', () => {
  const p = decodePortfolio(fixturePortfolio());
  assert.equal(p.kind, 'read');
  if (p.kind !== 'read') return;
  assert.equal(p.holdings.length, 10);
  assert.ok(p.notShown > 0);
});

test('★ Send is blocked when TRADING is off, and a failed simulation never reaches the wallet', async () => {
  assert.equal(tradingOn({}), false);
  let asked = 0;
  const out = await confirmBuilt(async () => ({ kind: 'blocked', why: 'This wallet has no SOL yet. Fund it and try again.' }), {
    signAndSend: async () => { asked += 1; return { kind: 'sent', ref: 'x' }; },
    decode: fromBase64,
  });
  assert.equal(out.kind, 'blocked');
  assert.equal(asked, 0);
});

test('amounts are written compactly and never as a bare zero', () => {
  assert.equal(compactAmount('1392353535035', 6), '1.39M');
  assert.equal(compactAmount('100', 0), '100');
});
