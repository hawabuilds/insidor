import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodePortfolio } from '../../shared/api/decode.ts';
import { fixturePortfolio } from '../../test-fixtures/fixture-wallet.ts';
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

test('a recorded wallet decodes: real holdings, each a dash for profit (no buy history in what was read)', () => {
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

test('the chart is the stored points then the live total; its change is first to last, and needs two points', async () => {
  const { withLive, windowChange } = await import('./balance-points.ts');
  const pts = withLive([{ t: 1, value: 100 }, { t: 2, value: 120 }], 150, 10);
  assert.deepEqual(pts.map((p) => p.value), [100, 120, 150]);
  assert.equal(windowChange(pts), 50);
  assert.equal(windowChange(withLive([], 150, 10)), null, 'one point is not a change');
  assert.deepEqual(withLive([{ t: 1, value: 100 }], null, 10).length, 1, 'no live total is not a zero');
});

test('★ signed out, the Portfolio says sign in — never a stand-in wallet', async () => {
  const { readFileSync } = await import('node:fs');
  const { gateFor } = await import('../../shared/sign-in.ts');
  /* With sign-in set up, signed out never reaches the Portfolio: the door stands in front of it. */
  for (const kind of ['disconnected', 'refused', 'failed'] as const) {
    assert.equal(gateFor({ configured: true, state: (kind === 'failed' ? { kind, code: 'internal' } : { kind }) as never, entered: true }), 'landing');
  }
  /* And in a build without sign-in, the tab says so and reads no wallet at all. */
  const screen = readFileSync(new URL('./PortfolioScreen.tsx', import.meta.url), 'utf8');
  const signedOut = screen.slice(screen.indexOf('/* Signed out.'));
  assert.match(signedOut, /Sign in to see your portfolio/);
  assert.ok(!/fetchPortfolio\(|<Loaded/.test(signedOut), 'no wallet is read or drawn signed out');
});
