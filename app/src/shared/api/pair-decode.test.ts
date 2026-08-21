/**
 * THE PAIRS DECODER — the client-side backstop, tested at the boundary it defends.
 *
 * The projection already censors, bounds and refuses. This is the second door, and it exists
 * because the first one runs on a server that can be redeployed independently of a browser
 * that is already open. Three separate mechanisms are asserted here and they are not
 * redundant:
 *
 *   1. `assertNoInternalVocabulary` throws on the raw payload, so a leak at the projection is
 *      LOUD here rather than silent until somebody renders it.
 *   2. `pick` drops anything not on the allowlist, so a server that starts sending a price
 *      change or a tradable flag has them gone before a component can see them. A type says
 *      a field is not there; a type is gone at runtime. This says it while the program runs.
 *   3. The withheld branch never reads the rows array AT ALL — not filters it, not empties it
 *      afterwards. There is no value in the decoded object that a component could reach.
 *
 * The fixture is decoded here too. `client.ts` runs sample payloads through this same
 * decoder, so a fixture that could not survive it would be a shape the server can never send,
 * and every screen designed against it would be designed against a wire format that does not
 * exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodePair, decodePairFeed, WireLeakError, WireShapeError } from './decode.ts';
import { fixturePairs } from './fixtures.ts';

const T0 = 1_755_079_200_000;
const MIN = 60_000;
const DAY = 24 * 60 * 60 * 1000;

const PAIR = {
  pairId: 'solana:toad',
  ticker: 'CopeToad',
  name: 'cope toad',
  address: '9pToadPoolA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU',
  venueLabel: 'Pump.fun',
  mintedAt: { at: T0 - 5 * DAY },
  mintedAtBoundS: 5,
  readAt: { at: T0 - 52 * MIN },
  priceUsd: { v: 0.000_001_999 },
  marketCapUsd: { v: 1_903 },
  marketCapBasis: 'fully-diluted',
  liquidityUsd: { v: 1_978 },
};

const SHOWN_HEAD = {
  windowMs: 14 * DAY,
  lastMintHeardAt: { at: T0 - 5 * DAY },
  rows: { listing: 'shown', mintsInWindow: 192, withMarket: 6, withoutMarket: 186 },
};

/* ── the ordinary case, and the fixture ───────────────────────────────── */

test('a frame decodes into its head, its counts and its rows, in order', () => {
  const feed = decodePairFeed({ tick: 9, head: SHOWN_HEAD, pairs: [PAIR] });
  assert.equal(feed.tick, 9);
  assert.equal(feed.head.windowMs, 14 * DAY);
  assert.deepEqual(feed.head.lastMintHeardAt, { known: true, at: T0 - 5 * DAY });
  assert.deepEqual(feed.head.rows, {
    listing: 'shown',
    mintsInWindow: 192,
    withMarket: 6,
    withoutMarket: 186,
  });
  assert.equal(feed.pairs.length, 1);
  assert.equal(feed.pairs[0]?.pairId, 'solana:toad');
});

test('the sample payload survives the decoder, so it is a shape the server could send', () => {
  const feed = decodePairFeed(fixturePairs());
  assert.ok(feed.pairs.length > 0);
  assert.equal(feed.head.rows.listing, 'shown');
  /* And the fixture demonstrates the absences rather than only the happy path: at least one
     row must carry a figure the venue did not report. */
  assert.ok(
    feed.pairs.some((p) => !p.liquidityUsd.known || !p.marketCapUsd.known),
    'every sample row has every figure, which teaches the wrong lesson about this population',
  );
});

/* ── the allowlist ────────────────────────────────────────────────────── */

test('★ a server that starts sending a buy affordance has it dropped before a component sees it', () => {
  /* The whole reason `pick` exists. A type promising there is no `tradable` here is a promise
     that erases at runtime; this is the half that is true of the running program. */
  const decoded: Record<string, unknown> = {
    ...decodePair({ ...PAIR, tradable: true, priceChange24h: { v: 41.8 }, imageUrl: 'https://x/y.png' }),
  };
  assert.equal('tradable' in decoded, false);
  assert.equal('priceChange24h' in decoded, false);
  assert.equal('imageUrl' in decoded, false);
});

test('an internal word anywhere in a payload is fatal, not filtered', () => {
  /* Filtering would make the client complicit: the leak would be projected, stored, served
     and quietly discarded, and nobody would fix it at the source. */
  assert.throws(() => decodePair({ ...PAIR, score: 0.83 }), WireLeakError);
  assert.throws(() => decodePair({ ...PAIR, name: 'the helius coin' }), WireLeakError);
  assert.throws(
    () => decodePairFeed({ tick: 1, head: SHOWN_HEAD, pairs: [{ ...PAIR, confidence: 0.4 }] }),
    WireLeakError,
  );
});

/* ── the withheld branch ──────────────────────────────────────────────── */

test('★ a withheld head means the rows array is never read, whatever is in it', () => {
  /* Not filtered and not emptied afterwards — never decoded. The projector already commits
     an empty array under this tag; this is the layer that holds if a server ever sends both,
     and it means nothing downstream is handed a row that was not supposed to be listed. */
  const feed = decodePairFeed({
    tick: 3,
    head: { windowMs: 14 * DAY, lastMintHeardAt: { at: null, why: 'not_read_yet' }, rows: { listing: 'withheld' } },
    pairs: [PAIR, PAIR],
  });
  assert.deepEqual(feed.pairs, []);
  assert.deepEqual(feed.head.rows, { listing: 'withheld' });
});

test('★ counts sent alongside a withheld tag are dropped, not carried', () => {
  /* A count over a population that may hold coins nobody minted is exactly the number this
     state exists to refuse to print. */
  const feed = decodePairFeed({
    tick: 3,
    head: {
      windowMs: 14 * DAY,
      lastMintHeardAt: { at: T0 },
      rows: { listing: 'withheld', mintsInWindow: 192, withMarket: 6, withoutMarket: 186 },
    },
    pairs: [],
  });
  const rows: Record<string, unknown> = { ...feed.head.rows };
  assert.equal('mintsInWindow' in rows, false);
  assert.equal('withMarket' in rows, false);
});

test('an unrecognised listing tag is a shape error, never a quiet "shown"', () => {
  /* Defaulting either way is a decision about whether to put unverified rows under a heading
     that says a venue priced them, and that is not the decoder's to make on a server's
     behalf. The caller already has an error state that says the screen could not be read. */
  assert.throws(
    () =>
      decodePairFeed({
        tick: 1,
        head: { ...SHOWN_HEAD, rows: { listing: 'probably-fine' } },
        pairs: [PAIR],
      }),
    WireShapeError,
  );
});

test('a count that is not a whole number of things is a shape error', () => {
  /* These are read out loud as a sentence. A fractional or negative one is not a number to
     round, it is a payload that has stopped meaning what the sentence claims. */
  for (const bad of [-1, 1.5, Number.NaN, '192', null]) {
    assert.throws(
      () =>
        decodePairFeed({
          tick: 1,
          head: { ...SHOWN_HEAD, rows: { ...SHOWN_HEAD.rows, withMarket: bad } },
          pairs: [],
        }),
      WireShapeError,
      `a withMarket of ${String(bad)} was accepted`,
    );
  }
});

/* ── absences ─────────────────────────────────────────────────────────── */

test('★ every absence decodes to a pending value with a reason, and never to zero', () => {
  const pair = decodePair({
    ...PAIR,
    priceUsd: { v: null, why: 'no_market' },
    marketCapUsd: { v: null, why: 'not_reported' },
    liquidityUsd: { v: null, why: 'not_reported' },
    marketCapBasis: null,
  });

  assert.deepEqual(pair.priceUsd, { known: false, pending: 'no_market' });
  assert.deepEqual(pair.marketCapUsd, { known: false, pending: 'not_reported' });
  assert.deepEqual(pair.liquidityUsd, { known: false, pending: 'not_reported' });
  assert.equal(pair.marketCapBasis, null);
  /* There is no branch of `measured` that produces a number from an absence, in either
     direction — the absent branch of the union has no numeric member to hold one. */
  assert.equal('amount' in pair.priceUsd, false);
});

test('★ an unreadable reading instant degrades to "unreadable", not to "we have not read it"', () => {
  /* A row is on this screen BECAUSE a reading exists for it, so "we have not read it" is the
     one thing that cannot be true here. Offering the reassuring reason for the alarming state
     is how an absence stops being informative. */
  const pair = decodePair({ ...PAIR, readAt: { at: null } });
  assert.deepEqual(pair.readAt, { known: false, pending: 'unreadable' });
});

test('a mint bound that is absent, negative or not a number becomes null rather than an interval that runs backwards', () => {
  for (const bad of [undefined, null, -30, 0, 'thirty', Number.POSITIVE_INFINITY]) {
    const pair = decodePair({ ...PAIR, mintedAtBoundS: bad });
    assert.equal(pair.mintedAtBoundS, null, `a bound of ${String(bad)} survived`);
  }
});

test('an unknown absence reason becomes "unreadable" rather than being dropped', () => {
  const pair = decodePair({ ...PAIR, marketCapUsd: { v: null, why: 'the-vendor-was-grumpy' } });
  assert.deepEqual(pair.marketCapUsd, { known: false, pending: 'unreadable' });
});

/* ── one bad row takes the frame, not a hole in it ────────────────────── */

test('one unreadable row throws the whole frame rather than being skipped', () => {
  /* A list silently one row short is wrong in a way nobody can see, and this screen's whole
     subject is how few rows there are. The caller has an error state that says so out loud. */
  assert.throws(
    () => decodePairFeed({ tick: 1, head: SHOWN_HEAD, pairs: [PAIR, { ...PAIR, ticker: 42 }] }),
    WireShapeError,
  );
});
