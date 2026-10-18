import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodePortfolio } from '../../shared/api/decode.ts';
import { fixturePortfolio } from '../../test-fixtures/fixture-wallet.ts';
import { confirmBuilt, fromBase64 } from '../trade/order-flow.ts';
import { tradingOn } from '../../shared/trading.ts';
import { compactAmount, profitLine } from './wallet-view.ts';

const usd = (v: number | null) => (v === null ? { known: false, pending: 'no_market' } : { known: true, amount: v }) as never;
const gain = (sol: number, usdV: number | null, partial = false) => ({ kind: 'known', sol, costSol: 0.1, pct: (sol / 0.1) * 100, usd: usd(usdV), partial }) as const;

test('★ not bought in Insidor is a dash with its reason, never a number', () => {
  assert.equal(profitLine({ kind: 'none', why: 'not_bought_here' }).text, '— not bought in Insidor');
  assert.equal(profitLine({ kind: 'none', why: 'history_unread' }).text, '— trades not read');
  assert.equal(profitLine({ kind: 'none', why: 'not_bought_here' }).tone, 'none');
});

test("a gain reads as Trador's signed dollars; with no SOL price it stays in SOL; partial says so in the title", () => {
  assert.deepEqual(profitLine(gain(0.0123, 16.52)), { text: '+$16.52', tone: 'up', title: 'Current value minus what you paid.' });
  assert.equal(profitLine(gain(-0.02, -3.1)).text, '−$3.10');
  assert.equal(profitLine(gain(0.00001, 0.004)).text, '+$0.0040');
  assert.equal(profitLine(gain(-0.004, null)).text, '−0.0040 SOL');
  assert.equal(profitLine(gain(0.5, 80, true)).title, 'Covers only the part of this holding with a known purchase price.');
});

test('★ a gain the server did not fully state is refused, never decoded as a number', () => {
  const raw = fixturePortfolio() as { holdings: Record<string, unknown>[] };
  const withGain = (profit: unknown) => ({ ...raw, holdings: [{ ...raw.holdings[0], profit }] });
  assert.throws(() => decodePortfolio(withGain({ kind: 'known', sol: null })), 'no number is not a gain');
  assert.throws(() => decodePortfolio(withGain({ kind: 'known', sol: 0.1, costSol: 0, pct: 1, usd: { v: 1 }, partial: false })), 'a gain on nothing paid');
  assert.throws(() => decodePortfolio(withGain({ kind: 'known', sol: 0.1, costSol: 0.1, pct: 100, usd: { v: 1 } })), 'partial must be said');
  assert.throws(() => decodePortfolio(withGain({ kind: 'none', why: 'no_buy_history' })), 'an unknown reason is a shape error');
  const ok = decodePortfolio(withGain({ kind: 'known', sol: 0.1, costSol: 0.1, pct: 100, usd: { v: null, why: 'no_market' }, partial: false }));
  const g = ok.kind === 'read' ? ok.holdings[0]?.profit : null;
  assert.equal(g?.kind, 'known');
  assert.equal(g?.kind === 'known' && g.usd.known, false, 'no dollars is a pending value, not zero');
});

test('★ an unsure narrative match shows nothing: only a named narrative object is read', () => {
  const raw = fixturePortfolio() as { holdings: Record<string, unknown>[] };
  const p = decodePortfolio({ ...raw, holdings: [{ ...raw.holdings[0], story: null }] });
  assert.equal(p.kind === 'read' && p.holdings[0]?.story, null);
});

test('a recorded wallet decodes: real holdings, each a dash for its gain (none bought in Insidor)', () => {
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
