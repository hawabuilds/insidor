/**
 * The launch odds route's rules: a coin is grouped by the definitions the tool counted, history is worded
 * as history beside all launches, an absence is said, and any rug sign wins the summary.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts';
import { VENUE_ID } from '@insidor/venue-solana-pumpfun';

import { bandFor, signalsFor, createLaunchOdds, lookOf, minuteFacts, oddsReply, signalMomentMs, signalNow, type BadgeRow, type BandRow, type Opening } from './launch-odds.ts';
import type { Db, Row } from './queries.ts';

const DAY = 86_400_000;
const band = (over: Partial<BandRow>): BandRow => ({
  signal: 'second_1',
  band: 1,
  scoreFrom: 0,
  scoreTo: null,
  launches: 1_000,
  hit: [0.12, 0.06, 0.03, 0.01],
  rugged: 0.1,
  neverMoved: 0.5,
  peakP50S: 240,
  peakP75S: 900,
  slow2x: null,
  heldUp: true,
  launchedFromMs: 0,
  launchedToMs: 30 * DAY,
  ...over,
});
const NORMAL = band({ band: 0, scoreFrom: null, launches: 20_000 });
const BANDS: BandRow[] = [
  NORMAL,
  band({ band: 1, scoreFrom: 0, scoreTo: 2, hit: [0.08, 0.04, 0.02, 0.005], neverMoved: 0.7 }),
  band({ band: 2, scoreFrom: 2, scoreTo: 8, hit: [0.13, 0.06, 0.03, 0.01] }),
  band({ band: 3, scoreFrom: 8, scoreTo: null, launches: 400, hit: [0.31, 0.18, 0.09, 0.04], rugged: 0.12 }),
];
const opening = (o: Partial<Opening>): Opening => ({ buyers: null, buys: null, devBuyUsd: null, tradesSoFar: null, movedSinceLaunch: null, ...o });

test('a minute signal looks at the end of the clock minute holding launch + its offset', () => {
  const launch = Date.UTC(2026, 9, 30, 12, 0, 45);
  assert.equal(signalMomentMs(launch, 'second_1'), launch + 1_000);
  assert.equal(signalMomentMs(launch, 'minute_1'), Date.UTC(2026, 9, 30, 12, 2, 0));
  assert.equal(signalMomentMs(launch, 'minute_5'), Date.UTC(2026, 9, 30, 12, 6, 0));
  assert.equal(signalNow(launch, launch + 500, true), null);
  assert.equal(signalNow(launch, launch + 60_000, true), 'second_1');
  assert.equal(signalNow(launch, Date.UTC(2026, 9, 30, 12, 2, 0), true), 'minute_1');
  assert.equal(signalNow(launch, launch + DAY, true), 'minute_5');
  assert.equal(signalNow(launch, launch + DAY, false), 'second_1');
});

test('minute facts count only the candles before the moment, and the move from the first open', () => {
  const k = [
    { bucketMs: 0, o: 1, c: 1.5, trades: 10 },
    { bucketMs: 60_000, o: 1.5, c: 3, trades: 40 },
    { bucketMs: 120_000, o: 3, c: 9, trades: 400 },
  ];
  assert.deepEqual(minuteFacts(k, 120_000), { tradesSoFar: 50, movedSinceLaunch: 3 });
  assert.deepEqual(minuteFacts([], 120_000), { tradesSoFar: 0, movedSinceLaunch: null });
});

test('a score falls in the group whose range holds it; the top group is open-ended', () => {
  assert.equal(bandFor(BANDS, 'second_1', 1)?.band, 1);
  assert.equal(bandFor(BANDS, 'second_1', 2)?.band, 2);
  assert.equal(bandFor(BANDS, 'second_1', 40)?.band, 3);
  assert.equal(bandFor(BANDS, 'minute_1', 40), null);
});

test('the reply is history beside all launches, with the group in words', () => {
  const r = oddsReply('second_1', { second_1: opening({ buyers: 12, buys: 14, devBuyUsd: 20 }) }, BANDS, []);
  assert.equal(r.kind, 'odds');
  if (r.kind !== 'odds') return;
  const m = r.moments[0];
  assert.equal(r.days, 30);
  assert.equal(m?.group, '8 or more buyers in the first second');
  assert.equal(m?.like.launches, 400);
  assert.deepEqual(m?.like.hit.map((h) => h.x), [...DEFAULT_POLICY.launchOdds.multiples]);
  assert.equal(m?.normal.hit[0]?.share, 0.12);
  assert.equal(m?.like.peakP50S, 240);
  assert.equal(m?.look, 'runner');
});

test('every moment reached is in the reply, in order, and the page opens on the latest', () => {
  const minuteBands = BANDS.map((b) => ({ ...b, signal: 'minute_1' as const }));
  const r = oddsReply('minute_5', { second_1: opening({ buyers: 1 }), minute_1: opening({ buyers: 1, tradesSoFar: 40 }), minute_5: opening({ buyers: 1, tradesSoFar: 90 }) }, [...BANDS, ...minuteBands], []);
  assert.ok(r.kind === 'odds');
  if (r.kind !== 'odds') return;
  /* No minute-5 groups built: that moment is left out, not shown empty. */
  assert.deepEqual(r.moments.map((m) => m.at), ['second_1', 'minute_1']);
  assert.equal(r.at, 'minute_1');
});

test('a group that did not hold up shows all launches, and says so', () => {
  const bands = BANDS.map((b) => (b.band === 3 ? { ...b, heldUp: false } : b));
  const r = oddsReply('second_1', { second_1: opening({ buyers: 12 }) }, bands, []);
  assert.ok(r.kind === 'odds');
  if (r.kind !== 'odds') return;
  const m = r.moments[0];
  assert.equal(m?.held, false);
  assert.equal(m?.like.launches, NORMAL.launches);
  assert.equal(m?.group, 'No group of launches like it held up');
  assert.equal(m?.look, 'mixed');
});

test('too few launches is too early to tell; an unseen opening and unbuilt groups are said, not zero', () => {
  const thin = BANDS.map((b) => (b.band === 3 ? { ...b, launches: 20 } : b));
  const r = oddsReply('second_1', { second_1: opening({ buyers: 12 }) }, thin, []);
  assert.ok(r.kind === 'odds' && r.moments[0]?.look === 'early');
  assert.deepEqual(oddsReply('second_1', { second_1: opening({}) }, BANDS, []), { kind: 'none', why: 'not_seen' });
  assert.deepEqual(oddsReply('second_1', { second_1: opening({ buyers: 3 }) }, [], []), { kind: 'none', why: 'not_built' });
});

test('signals are worst first, at most four, each with its value and comparison; a rug sign wins the summary', () => {
  const rows: BadgeRow[] = [
    { fact: 'first_second_buyers', signal: 'second_1', from: 8, to: null, tone: 'green', launches: 400, hit2x: 0.31, rugged: 0.12, usual: 1, atLeast: 0.05 },
    { fact: 'dev_buy', signal: 'second_1', from: 100, to: null, tone: 'red', launches: 900, hit2x: 0.1, rugged: 0.3, usual: 20, atLeast: 0.4 },
    { fact: 'first_second_buys', signal: 'second_1', from: 10, to: 20, tone: 'amber', launches: 300, hit2x: 0.14, rugged: 0.1, usual: 1, atLeast: 0.3 },
    { fact: 'dev_buy', signal: 'minute_1', from: 100, to: null, tone: 'red', launches: 900, hit2x: 0.1, rugged: 0.3, usual: 20, atLeast: 0.4 },
  ];
  const o = opening({ buyers: 12, buys: 14, devBuyUsd: 250 });
  const shown = signalsFor(rows, NORMAL, 'second_1', o, 30);
  assert.deepEqual(shown.map((b) => b.qualifier), ['Rug sign', 'Typical', 'Strong']);
  assert.deepEqual([shown[0]?.label, shown[0]?.value, shown[0]?.context], ['Developer buy', '$250', 'Launches like it were rugged 30%, avg 10%']);
  assert.match(shown[0]?.explain ?? '', /^Of 900 launches whose creator bought \$100 or more in the last 30 days, 30% were rugged within the hour/);
  assert.deepEqual([shown[2]?.label, shown[2]?.value, shown[2]?.context], ['First-second buyers', '12', 'Launches like it doubled 31%, avg 12%']);
  assert.equal(lookOf(BANDS[3] as BandRow, NORMAL, shown), 'rug');
});

test('the route: a coin we do not hold is a 404, another venue is none, the groups are read once per keep', async () => {
  const launched = Date.UTC(2026, 9, 30, 12, 0, 0);
  let bandReads = 0;
  const coins: Record<string, Row> = {
    'solana:A': { address: 'A', venue_id: VENUE_ID, launched_ms: launched, buyers: 12, buys: 14, dev_buy_usd: 20, from_launch: false },
    'solana:B': { address: 'B', venue_id: 'solana:pool', launched_ms: null, buyers: null, buys: null, dev_buy_usd: null, from_launch: null },
    /* No asset row, but chainwatch saw it launch: the launchpad's. */
    'solana:C': { address: 'C', venue_id: null, launched_ms: launched, buyers: 1, buys: 1, dev_buy_usd: null, from_launch: false },
  };
  const db: Db = {
    query: async (sql, params) => {
      if (sql.includes('from public.launch_odds_badge')) return [];
      if (sql.includes('from public.launch_odds')) {
        bandReads += 1;
        return BANDS.map((b) => ({ signal: b.signal, band: b.band, score_from: b.scoreFrom, score_to: b.scoreTo, launches: b.launches, hit_2x: b.hit[0], hit_3x: b.hit[1], hit_5x: b.hit[2], hit_10x: b.hit[3], rugged_1h: b.rugged, never_moved: b.neverMoved, peak_p50_s: b.peakP50S, held_up: b.heldUp, from_ms: b.launchedFromMs, to_ms: b.launchedToMs }));
      }
      const c = coins[String(params[0])];
      return c === undefined ? [] : [c];
    },
  };
  const read = createLaunchOdds(() => launched + 10 * 60_000);
  assert.equal(await read('solana:Z', db), null);
  assert.deepEqual(await read('solana:B', db), { kind: 'none', why: 'not_launchpad' });
  const a = await read('solana:A', db);
  assert.ok(a !== null && a.kind === 'odds' && a.at === 'second_1');
  await read('solana:A', db);
  assert.equal(bandReads, 1);
  const c = await read('solana:C', db);
  assert.ok(c !== null && c.kind === 'odds' && c.moments[0]?.group === 'under 2 buyers in the first second');
});

test('groups that cannot be read (the table not there yet) are not built, not a server fault', async () => {
  const db: Db = {
    query: async (sql) => {
      if (sql.includes('launch_odds')) throw new Error('relation does not exist');
      return [{ address: 'A', venue_id: VENUE_ID, launched_ms: 0, buyers: 1, buys: 1, dev_buy_usd: null, from_launch: false }];
    },
  };
  assert.deepEqual(await createLaunchOdds(() => 10 * 60_000)('solana:A', db), { kind: 'none', why: 'not_built' });
});

test('a rug sign is rugs outgrowing doubles, not a busy opening that is rugged and doubles more', async () => {
  const { rugSign } = await import('./launch-odds.ts');
  /* All launches: 14% rugged, 12% doubled. */
  assert.equal(rugSign(0.3, 0.27, 0.14, 0.12), false, 'rugged twice as often, but doubled twice as often too');
  assert.equal(rugSign(0.3, 0.08, 0.14, 0.12), true, 'rugged twice as often, doubled less');
  assert.equal(rugSign(0.18, 0, 0.14, 0.12), false, 'not rugged enough more often');
  assert.equal(rugSign(0.3, 0, 0.14, 0.12), true, 'rugged, never doubled');
});

test('the Wallets card: the coin against all launches, and a dash with a reason for what is not recorded', async () => {
  const { walletCells } = await import('./launch-odds.ts');
  const rows: BadgeRow[] = [
    { fact: 'first_second_buyers', signal: 'second_1', from: 8, to: null, tone: 'green', launches: 400, hit2x: 0.31, rugged: 0.12, usual: 1, atLeast: 0.05 },
    { fact: 'dev_buy', signal: 'second_1', from: 5, to: 20, tone: 'amber', launches: 400, hit2x: 0.2, rugged: 0.2, usual: 12, atLeast: 0.4 },
  ];
  const cells = walletCells(rows, opening({ buyers: 15, devBuyUsd: 8 }));
  assert.deepEqual(cells.map((c) => [c.label, c.value, c.note, c.tone]), [
    ['Buyers in sec 1', '15', 'Usual 1', 'good'],
    ['Smart wallets', '—', 'Not recorded yet', 'plain'],
    ['Dev buy', '$8.00', 'Usual $12', 'plain'],
    ['Dev sold', '—', 'Not recorded yet', 'plain'],
    ['Bundled supply', '—', 'Not recorded yet', 'plain'],
    ['Top 10 hold', '—', 'Not recorded yet', 'plain'],
  ]);
  assert.equal(walletCells(rows, undefined)[0]?.note, 'Not seen at launch');
});
