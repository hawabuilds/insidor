/**
 * The wall, asserted.
 *
 * Three properties, and each one corresponds to a leak that actually shipped:
 *   - the decoded row has exactly the public field set and nothing else;
 *   - an internal field in the payload is fatal, not ignored;
 *   - an absent number arrives as pending rather than as zero.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_ROW_FIELDS, LAUNCH_FIELDS } from './wire/fields.ts';
import {
  WireLeakError,
  WireShapeError,
  assertNoInternalVocabulary,
  decodeBoardRow,
  decodeCoinLink,
  decodeLaunch,
  decodeLaunchFeed,
  decodeRowPatch,
} from './decode.ts';

const CLEAN_ROW = {
  id: 'st_01',
  title: 'Cat pushing a tiny shopping trolley',
  summary: ['Clipped and re-cut by 40 accounts in six hours.', 'Two coins so far; one is ours.'],
  thumbUrl: 'https://cdn.example/thumb.jpg',
  reach: { v: 1_240_000 },
  spark: { windowMs: 3_600_000, points: [{ atMs: 1, value: 3 }, { atMs: 2, value: null }] },
  momentum: 'rising',
  marketCapUsd: { v: 186_400 },
  priceChange24h: { v: -7.9 },
  firstSeenAt: { at: 1_700_000_000_000 },
  coins: { kind: 'none' },
  isNew: true,
};

test('the decoder emits exactly the public field set', () => {
  const row = decodeBoardRow(CLEAN_ROW);
  assert.deepEqual(Object.keys(row).sort(), [...BOARD_ROW_FIELDS].sort());
});

test('an internal field on the payload is fatal, not silently dropped', () => {
  /* This is `live.js:397` as a test: the query asked for the score, so the client had the
     score, so the client rendered it. Here, having it is where it stops. */
  for (const leak of ['score', 'confidence', 'propensity', 'policyHash', 'burst', 'costUsd']) {
    assert.throws(
      () => decodeBoardRow({ ...CLEAN_ROW, [leak]: 0.83 }),
      WireLeakError,
      `${leak} was not caught`,
    );
  }
});

test('an internal field nested inside a sub-object is caught too', () => {
  assert.throws(
    () => decodeBoardRow({ ...CLEAN_ROW, coins: { kind: 'none', score: 0.4 } }),
    WireLeakError,
  );
});

test('a vendor name in a value is caught, not just in a key', () => {
  assert.throws(
    () => decodeBoardRow({ ...CLEAN_ROW, thumbUrl: 'https://io.dexscreener.com/x.png' }),
    WireLeakError,
  );
});

test('ordinary payloads pass the censor untouched', () => {
  assert.doesNotThrow(() => assertNoInternalVocabulary(CLEAN_ROW));
});

test('an absent counter decodes to pending, never to zero', () => {
  const row = decodeBoardRow({ ...CLEAN_ROW, reach: { v: null, why: 'not_reported' } });
  assert.equal(row.reach.known, false);
  if (!row.reach.known) assert.equal(row.reach.pending, 'not_reported');
});

test('a censored spark point stays null instead of collapsing to zero', () => {
  const row = decodeBoardRow(CLEAN_ROW);
  assert.deepEqual(
    row.spark.points.map((p) => p.value),
    [3, null],
  );
});

test('a market cap round-trips as a value', () => {
  const row = decodeBoardRow(CLEAN_ROW);
  assert.equal(row.marketCapUsd.known, true);
  if (row.marketCapUsd.known) assert.equal(row.marketCapUsd.amount, 186_400);
});

test('an absent market cap keeps the reason the server gave it', () => {
  /* The reason is the whole content of this column when there is no number: "nothing was
     minted" and "we will not say which of six coins this is" render the same dash and are
     not the same fact. If the reason were dropped on the way in, the dash would be the
     only thing left and the distinction would die at the boundary. */
  for (const why of ['not_minted', 'no_market', 'not_reported'] as const) {
    const row = decodeBoardRow({ ...CLEAN_ROW, marketCapUsd: { v: null, why } });
    assert.equal(row.marketCapUsd.known, false);
    if (!row.marketCapUsd.known) assert.equal(row.marketCapUsd.pending, why);
  }
});

test('a market cap the server omitted is pending, never zero', () => {
  const { marketCapUsd: _omitted, ...withoutCap } = CLEAN_ROW;
  const row = decodeBoardRow(withoutCap);
  assert.equal(row.marketCapUsd.known, false);
  if (!row.marketCapUsd.known) assert.equal(row.marketCapUsd.pending, 'not_read_yet');
});

test('a live patch can move the market cap, and its absence with it', () => {
  const moved = decodeRowPatch({ id: 'st_01', fields: { marketCapUsd: { v: 412_000 } } });
  assert.deepEqual(moved.fields.marketCapUsd, { known: true, amount: 412_000 });

  /* A cap that goes away — the coin stopped being quotable — must arrive as an absence
     with a reason, not as a patch nobody applied and not as a 0. */
  const gone = decodeRowPatch({
    id: 'st_01',
    fields: { marketCapUsd: { v: null, why: 'no_market' } },
  });
  assert.deepEqual(gone.fields.marketCapUsd, { known: false, pending: 'no_market' });
});

test('a patch that mentions no market cap leaves the field alone', () => {
  /* Absent from `fields` is not the same as absent as a value: the row keeps the cap it
     had. Writing a pending value here would blank the column on every unrelated patch. */
  const patch = decodeRowPatch({ id: 'st_01', fields: { reach: { v: 12 } } });
  assert.equal('marketCapUsd' in patch.fields, false);
});

test('a 24h move keeps its sign, and an absent one never becomes a flat zero', () => {
  /* A fall is a reading. A guard that treated a negative as suspect would delete exactly
     the coins that dropped, leaving a board on which nothing ever goes down. */
  const fell = decodeBoardRow(CLEAN_ROW);
  assert.deepEqual(fell.priceChange24h, { known: true, amount: -7.9 });

  /* ★ AND THE ABSENT CASE IS THE ORDINARY ONE. `not_minted` is a story with no coin,
     `not_reported` covers both a coin with no day behind it and a story with several
     coins and no single move to show, `no_market` is a coin nobody has traded. A zero
     would claim the price held over a period nobody observed, under a column head that
     says GAIN — the single column a user is most likely to trade on. */
  for (const why of ['not_minted', 'no_market', 'not_reported', 'not_read_yet'] as const) {
    const row = decodeBoardRow({ ...CLEAN_ROW, priceChange24h: { v: null, why } });
    assert.equal(row.priceChange24h.known, false);
    assert.notDeepEqual(row.priceChange24h, { known: true, amount: 0 });
    if (!row.priceChange24h.known) assert.equal(row.priceChange24h.pending, why);
  }
});

test('a 24h move the server omitted is pending, never zero', () => {
  const { priceChange24h: _omitted, ...withoutGain } = CLEAN_ROW;
  const row = decodeBoardRow(withoutGain);
  assert.equal(row.priceChange24h.known, false);
  if (!row.priceChange24h.known) assert.equal(row.priceChange24h.pending, 'not_read_yet');
});

test('a live patch can move the 24h gain, and its absence with it', () => {
  /* It is on the patchable list because a price moves between frames, and re-sending the
     whole row to change one figure is how a live channel becomes a refetch loop. */
  const moved = decodeRowPatch({ id: 'st_01', fields: { priceChange24h: { v: 12.5 } } });
  assert.deepEqual(moved.fields.priceChange24h, { known: true, amount: 12.5 });

  const gone = decodeRowPatch({
    id: 'st_01',
    fields: { priceChange24h: { v: null, why: 'not_read_yet' } },
  });
  assert.deepEqual(gone.fields.priceChange24h, { known: false, pending: 'not_read_yet' });
});

test('an unknown first-seen time decodes to pending, not to now', () => {
  const row = decodeBoardRow({ ...CLEAN_ROW, firstSeenAt: { at: null } });
  assert.equal(row.firstSeenAt.known, false);
});

test('the unsure link exposes no coin at all', () => {
  const link = decodeCoinLink({ kind: 'unsure', claimCount: 306, coin: { ticker: 'X' } });
  assert.equal(link.kind, 'unsure');
  assert.equal('coin' in link, false);
});

test('"several" with fewer than two coins is a shape error', () => {
  assert.throws(() => decodeCoinLink({ kind: 'several', coins: [] }), WireShapeError);
});

test('a summary that is not exactly two lines is a shape error', () => {
  assert.throws(() => decodeBoardRow({ ...CLEAN_ROW, summary: ['one'] }), WireShapeError);
  assert.throws(() => decodeBoardRow({ ...CLEAN_ROW, summary: ['a', 'b', 'c'] }), WireShapeError);
});

/* ── launches ─────────────────────────────────────────────────────────── */

const CLEAN_LAUNCH = {
  launchId: 'solana:9xJersey',
  ticker: 'JERSEY',
  name: 'jersey',
  address: '9xJersey',
  venueLabel: 'Pump.fun',
  mintedAt: { at: 1_700_000_000_000 },
  mintedAtBoundS: 20,
  marketCapUsd: { v: null, why: 'no_market' },
  marketCapBasis: null,
};

test('a launch decodes to exactly the public field set', () => {
  assert.deepEqual(Object.keys(decodeLaunch(CLEAN_LAUNCH)).sort(), [...LAUNCH_FIELDS].sort());
});

test('★ a launch carries nothing a buy affordance could be built from', () => {
  /* The structural half of the rule. A rail row must not be one prop-drill away from a
     trade panel, and the way that is guaranteed is that the fields simply are not there:
     `pick` drops them at runtime even if a server starts sending them. Asserting on the
     names rather than on a component is the only version of this a test runner with no DOM
     can make, and it is also the version that stays true when the component is rewritten. */
  const sent = { ...CLEAN_LAUNCH, priceUsd: { v: 0.0004 }, tradable: true, liquidityUsd: { v: 9_000 } };
  const launch: Record<string, unknown> = { ...decodeLaunch(sent) };
  for (const field of ['priceUsd', 'tradable', 'liquidityUsd', 'priceChange24h', 'imageUrl']) {
    assert.equal(field in launch, false, `${field} reached a Launch`);
  }
});

test('an internal word anywhere in a launch is fatal, not silently dropped', () => {
  for (const leak of ['score', 'confidence', 'propensity', 'heat']) {
    assert.throws(() => decodeLaunch({ ...CLEAN_LAUNCH, [leak]: 1 }), WireLeakError, leak);
  }
});

test('★ the mint feed vendor is caught in a value, not only in a key', () => {
  /* The specific leak this rail could produce: a coin's own metadata naming the relay we
     read it from. It is caught at every depth and in free text, which is where it would
     actually arrive — inside a name somebody typed, not as a field somebody added. */
  assert.throws(
    () => decodeLaunch({ ...CLEAN_LAUNCH, name: 'seen first on pumpportal.fun' }),
    WireLeakError,
  );
  /* And the venue label is unaffected: 'pumpportal' is not a substring of 'Pump.fun'. */
  assert.doesNotThrow(() => decodeLaunch({ ...CLEAN_LAUNCH, venueLabel: 'Pump.fun' }));
});

test('★ an absent market cap stays absent, with the reason, and never becomes zero', () => {
  const launch = decodeLaunch(CLEAN_LAUNCH);
  assert.equal(launch.marketCapUsd.known, false);
  assert.notDeepEqual(launch.marketCapUsd, { known: true, amount: 0 });
  if (!launch.marketCapUsd.known) assert.equal(launch.marketCapUsd.pending, 'no_market');
});

test('a market cap the server omitted is pending, never zero', () => {
  const { marketCapUsd: _omitted, ...withoutCap } = CLEAN_LAUNCH;
  const launch = decodeLaunch(withoutCap);
  assert.equal(launch.marketCapUsd.known, false);
  if (!launch.marketCapUsd.known) assert.equal(launch.marketCapUsd.pending, 'no_market');
});

test('★ the mint-time bound survives decoding, because the age depends on it', () => {
  assert.equal(decodeLaunch(CLEAN_LAUNCH).mintedAtBoundS, 20);
  /* Absent means the instant is exact — the server sends the width for the bounded case
     and only for it, and 0005 makes a bounded row with no width unwritable. */
  assert.equal(decodeLaunch({ ...CLEAN_LAUNCH, mintedAtBoundS: null }).mintedAtBoundS, null);
  /* A half-width that runs backwards is not a bound, it is a broken reading, and it
     degrades to "no bound stated" rather than to an interval nobody can draw. */
  assert.equal(decodeLaunch({ ...CLEAN_LAUNCH, mintedAtBoundS: -5 }).mintedAtBoundS, null);
  assert.equal(decodeLaunch({ ...CLEAN_LAUNCH, mintedAtBoundS: 'soon' }).mintedAtBoundS, null);
});

test('an unknown mint time decodes to pending, never to now and never to the epoch', () => {
  const launch = decodeLaunch({ ...CLEAN_LAUNCH, mintedAt: { at: null, why: 'not_read_yet' } });
  assert.equal(launch.mintedAt.known, false);
  if (!launch.mintedAt.known) assert.equal(launch.mintedAt.pending, 'not_read_yet');
});

test('an empty ticker survives as an empty ticker, not as a shape error', () => {
  /* A coin that named no symbol is ordinary. It renders as nothing; it must not fail the
     frame, and it must not fall back to the address. */
  assert.equal(decodeLaunch({ ...CLEAN_LAUNCH, ticker: '' }).ticker, '');
});

test('the feed keeps the projector\'s order and never sorts', () => {
  const feed = decodeLaunchFeed({
    tick: 9,
    launches: [
      { ...CLEAN_LAUNCH, launchId: 'solana:c' },
      { ...CLEAN_LAUNCH, launchId: 'solana:a' },
      { ...CLEAN_LAUNCH, launchId: 'solana:b' },
    ],
  });
  assert.equal(feed.tick, 9);
  assert.deepEqual(feed.launches.map((l) => l.launchId), ['solana:c', 'solana:a', 'solana:b']);
});

test('a feed with no launches is an empty list, not a shape error', () => {
  assert.deepEqual(decodeLaunchFeed({ tick: 1, launches: [] }).launches, []);
});

test('one unreadable launch fails the frame rather than being quietly skipped', () => {
  /* A rail silently one row short is wrong in a way nobody can see. The caller already has
     an error state that says so out loud, which is the better place for this to land. */
  assert.throws(
    () => decodeLaunchFeed({ tick: 1, launches: [CLEAN_LAUNCH, { ...CLEAN_LAUNCH, ticker: 7 }] }),
    WireShapeError,
  );
});
