import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodePortfolio } from '../../shared/api/decode.ts';
import { fixturePortfolio } from '../../test-fixtures/fixture-wallet.ts';
import { confirmBuilt, fromBase64 } from '../trade/order-flow.ts';
import { tradingOn } from '../../shared/trading.ts';
import { compactAmount, gainsNote, profitLine, rangeLine, solValueUsd } from './wallet-view.ts';

const usd = (v: number | null) => (v === null ? { known: false, pending: 'no_market' } : { known: true, amount: v }) as never;
const gain = (sol: number, usdV: number | null, partial = false) => ({ kind: 'known', sol, costSol: 0.1, pct: (sol / 0.1) * 100, usd: usd(usdV), partial }) as const;

test('★ no gain is a plain dash, never a number; its reason is in the title and the one note', () => {
  const none = profitLine({ kind: 'none', why: 'not_bought_here' });
  assert.equal(none.text, '—');
  assert.equal(none.tone, 'none');
  assert.match(none.title, /Not bought in Insidor/);
  assert.match(profitLine({ kind: 'none', why: 'history_unread' }).title, /could not be read/);
  const raw = fixturePortfolio();
  const read = decodePortfolio(raw);
  assert.equal(read.kind === 'read' && gainsNote(read.holdings), 'Gains count coins bought in Insidor.');
  assert.equal(gainsNote([{ ...(read.kind === 'read' ? read.holdings[0]! : null!), profit: { kind: 'none', why: 'history_unread' } }]), 'Gains count coins bought in Insidor. Your trades could not be read just now.');
});

test('the line under the total is the window\'s move in dollars and percent, in words; under two points it is not said', () => {
  const pts = [{ t: 1, value: 880 }, { t: 2, value: 888.1 }];
  assert.deepEqual(rangeLine(pts, '1w'), { text: '+$8.10 (+0.92%) this week', tone: 'up' });
  assert.deepEqual(rangeLine([{ t: 1, value: 100 }, { t: 2, value: 90 }], '1d'), { text: '−$10.00 (−10.00%) today', tone: 'down' });
  assert.equal(rangeLine([{ t: 1, value: 100 }], 'all'), null);
  assert.equal(rangeLine(null, '1m'), null);
  assert.equal(rangeLine([{ t: 1, value: 0 }, { t: 2, value: 5 }], '1m'), null, 'no share of nothing');
});

test('the SOL row is worth SOL at the price the totals were counted at; unknown stays unknown', () => {
  const p = decodePortfolio(fixturePortfolio());
  assert.equal(p.kind, 'read');
  if (p.kind !== 'read') return;
  const v = solValueUsd(p);
  if (p.totalSol.known && p.totalUsd.known && p.solBalance.known) assert.ok(v !== null && Math.abs(v - p.solBalance.amount * (p.totalUsd.amount / p.totalSol.amount)) < 1e-9);
  assert.equal(solValueUsd({ ...p, totalSol: { known: false, pending: 'no_market' } as never }), null);
});

test("a gain reads as signed dollars; with no SOL price it stays in SOL; partial says so in the title", () => {
  assert.deepEqual(profitLine(gain(0.0123, 16.52)), { text: '+$16.52', tone: 'up', title: 'Current value minus what you paid.' });
  assert.equal(profitLine(gain(-0.02, -3.1)).text, '−$3.10');
  assert.equal(profitLine(gain(0.00001, 0.004)).text, '+$0.0040');
  assert.equal(profitLine(gain(-0.004, null)).text, '−0.0040 SOL');
  assert.equal(profitLine(gain(0.5, 80, true)).title, 'Covers only the part of this holding bought in Insidor.');
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

/* ── the last known dollars (the owner, 2026-10-21: "i should see the dollar value of my holdings at all times") ── */

const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const holding = (address: string, amount: string, value: number | null, why = 'not_read_yet'): any => ({
  coinId: `solana:${address}`, address, ticker: 'Laura', name: null, imageUrl: null, amount, decimals: 6,
  priceUsd: value === null ? { known: false, pending: why } : { known: true, amount: value / (Number(amount) / 1e6) },
  valueUsd: value === null ? { known: false, pending: why } : { known: true, amount: value },
  change: { known: false, pending: 'not_reported' }, profit: { kind: 'none', why: 'not_bought_here' }, story: null,
});
const wallet = (holdings: any[], totalUsd: number | null, totalSol: number | null): any => ({
  kind: 'read', address: 'W', range: '24h', solBalance: { known: true, amount: 0.5 },
  totalUsd: totalUsd === null ? { known: false, pending: 'no_market' } : { known: true, amount: totalUsd },
  totalSol: totalSol === null ? { known: false, pending: 'no_market' } : { known: true, amount: totalSol },
  holdings, notShown: 0, unpriced: holdings.filter((h) => !h.valueUsd.known).length, created: { unclaimedFeesSol: { known: false, pending: 'not_reported' }, coins: [] },
});

test('★ a coin this read could not price shows its last price, with its age, and the total counts it and says so', async () => {
  const { notePrices, steadyWallet, asOfWords } = await import('./wallet-view.ts');
  /* Laura priced: 1,000,000 coins worth $40; SOL at $100 (0.5 SOL = $50). */
  const first = wallet([holding(LAURA, '1000000000000', 40)], 90, 0.9);
  const last = notePrices(null, first, 1_000);
  assert.deepEqual(last.coins[LAURA], { usd: 0.00004, at: 1_000 });
  assert.deepEqual(last.sol, { usd: 100, at: 1_000 });
  /* Five minutes on, this read lost Laura's price; the holding grew to 2,000,000. */
  const now = 1_000 + 5 * 60_000;
  const second = wallet([holding(LAURA, '2000000000000', null)], 50, 0.5);
  const s = steadyWallet(second, notePrices(last, second, now), now);
  const h = s.data.holdings[0]!;
  assert.equal(h.valueUsd.known && h.valueUsd.amount, 80, 'today\'s amount at the last price');
  assert.equal(s.asOf.holdings.get(LAURA), 1_000);
  assert.equal(s.data.totalUsd.known && s.data.totalUsd.amount, 130);
  assert.ok(s.data.totalSol.known && Math.abs(s.data.totalSol.amount - 1.3) < 1e-12);
  assert.equal(s.asOf.total, 1_000);
  assert.equal(s.data.unpriced, 0);
  assert.equal(asOfWords(1_000, now), 'as of 5m ago');
});

test('★ no SOL price in this read: the total is at SOL\'s last price and says when; no last price at all stays a dash', async () => {
  const { notePrices, steadyWallet } = await import('./wallet-view.ts');
  const last = notePrices(null, wallet([holding(LAURA, '1000000000000', 40)], 90, 0.9), 1_000);
  const s = steadyWallet(wallet([holding(LAURA, '1000000000000', 40)], null, null), last, 2_000);
  assert.equal(s.data.totalUsd.known && s.data.totalUsd.amount, 90);
  assert.equal(s.asOf.total, 1_000);
  assert.equal(s.asOf.holdings.size, 0, 'Laura was priced in this read');

  const none = steadyWallet(wallet([holding('NEVER', '1000000', null, 'no_market')], 50, 0.5), last, 2_000);
  assert.equal(none.data.holdings[0]!.valueUsd.known, false, 'never priced: a dash, never zero');
  assert.equal(none.data.totalUsd.known && none.data.totalUsd.amount, 50);
  assert.equal(none.asOf.total, null);
  /* A last price older than a day is not shown. */
  const old = steadyWallet(wallet([holding(LAURA, '1000000000000', null)], 50, 0.5), last, 1_000 + 24 * 60 * 60_000);
  assert.equal(old.data.holdings[0]!.valueUsd.known, false);
});

test('a holding with no price at all says why in a few words: no market, or not read just now', async () => {
  const { noPriceReason } = await import('./wallet-view.ts');
  assert.equal(noPriceReason({ known: false, pending: 'no_market' }).text, 'No market price');
  assert.equal(noPriceReason({ known: false, pending: 'not_read_yet' }).text, 'Price not read');
});
