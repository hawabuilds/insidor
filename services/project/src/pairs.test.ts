/**
 * THE PAIRS PROJECTION, tested against the rules it exists to hold.
 *
 * No database and no fixtures on disk: `projectPair`, `projectPairHead` and
 * `projectPairFeed` are pure, so a test is a literal in and a literal out. Each block names
 * the failure it guards against rather than the function it calls.
 *
 * THE FOUR RULES, and the first two are the ones this surface was built for:
 *
 *   1. NOTHING IS LISTED THAT CANNOT BE SHOWN TO BE REAL. When the store cannot separate a
 *      demo row from an observed one, the frame carries no rows AND no counts — because a
 *      confident "6 of 192" over a population that may hold fictions is the same class of
 *      lie as the fictions themselves.
 *
 *   2. A READING IS PUBLISHED WITH THE INSTANT IT WAS TAKEN AT. This screen deliberately
 *      does not apply the board's staleness gate, and the only thing that makes that
 *      defensible is that `readAt` travels with the figures. A projection that dropped it
 *      would turn a documented divergence into an undocumented one.
 *
 *   3. A MINT TIME WE ONLY HAVE BOUNDS ON LEAVES HERE WITH ITS BOUND ATTACHED — the same
 *      rule the launches rail holds, going through the same function, because mint time is
 *      the axis every ordering claim in this product hangs on.
 *
 *   4. A STRING SOMEBODY ELSE TYPED IS BOUNDED AND STRIPPED BEFORE IT IS STORED. Not before
 *      it is rendered — before it is STORED, so an over-long or control-laden name cannot
 *      reach a browser however the client is later rewritten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectPair, projectPairFeed, projectPairHead } from './project.ts';
import type { MarketNumber, PairCounts, PairFacts } from './project.ts';
import { FORBIDDEN_KEYS, FORBIDDEN_SUBSTRINGS, WireLeakError } from './wire.ts';

const T0 = 1_755_079_200_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const known = (amount: number): MarketNumber => ({ known: true, amount });
const absent = (why: 'no_market' | 'not_reported' | 'unreadable'): MarketNumber => ({
  known: false,
  why,
});

function facts(over: Partial<PairFacts> = {}): PairFacts {
  return {
    assetKey: 'solana:9pToadPoolA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU',
    ticker: 'CopeToad',
    name: 'cope toad',
    address: '9pToadPoolA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU',
    venueLabel: 'Pump.fun',
    mintedAt: T0 - 5 * DAY,
    mintPrecision: 'bounded',
    mintBoundS: 5,
    readAt: T0 - 52 * MIN,
    priceUsd: known(0.000_001_999),
    marketCapUsd: known(1_903),
    marketCapBasis: 'fully-diluted',
    liquidityUsd: known(1_978),
    ...over,
  };
}

const COUNTS: PairCounts = { mintsInWindow: 192, withMarket: 6, withoutMarket: 186 };

/* ── the reading, and the instant it was taken at ─────────────────────── */

test('a reading is published with the instant it was taken at, however old it is', () => {
  /* ★ THE DIVERGENCE FROM THE BOARD, ASSERTED. `projectCoin` drops a reading older than
     Policy.market.readingFreshnessMs whole, because a board row has a Buy button on it.
     This screen has no buy affordance, and suppressing here would replace six real rows
     with eighteen dashes and make the sentence the screen exists to say unsupportable. The
     honest form is the number WITH its age, and `readAt` is what carries the age. */
  const hoursOld = projectPair(facts({ readAt: T0 - 6 * HOUR }));
  assert.deepEqual(hoursOld.priceUsd, { v: 0.000_001_999 });
  assert.deepEqual(hoursOld.readAt, { at: T0 - 6 * HOUR });

  /* And it is structurally impossible to gate: `projectPair` takes no options, so there is
     no `nowMs` in scope to compare a reading against. This asserts the signature rather
     than the behaviour, which is the stronger of the two claims. */
  assert.equal(projectPair.length, 1);
});

test('an absent figure stays absent, with the venue’s own reason, and never becomes zero', () => {
  const curve = projectPair(
    facts({ liquidityUsd: absent('not_reported'), marketCapUsd: absent('no_market') }),
  );
  /* A bonding curve has no two-sided reserve, so `not_reported` — which is a DIFFERENT fact
     from `no_market` and stays different all the way to the tooltip. Collapsing them, and
     then rejecting anything that came back zero, is how the build this replaces filtered out
     essentially the entire pre-graduation population. */
  assert.deepEqual(curve.liquidityUsd, { v: null, why: 'not_reported' });
  assert.deepEqual(curve.marketCapUsd, { v: null, why: 'no_market' });
  assert.equal(curve.liquidityUsd.v, null);
  assert.equal(curve.marketCapUsd.v, null);
});

test('a basis never outlives its cap', () => {
  /* A label with no number describes nothing; a number with no label is a figure whose
     meaning is missing, and the two bases differ by more than a factor of ten on a coin with
     most of its supply locked. Read off the PROJECTED cap and not off the facts, so the two
     can never be published apart. */
  const noCap = projectPair(facts({ marketCapUsd: absent('not_reported') }));
  assert.equal(noCap.marketCapBasis, null);

  const withCap = projectPair(facts());
  assert.equal(withCap.marketCapBasis, 'fully-diluted');
});

/* ── mint time ────────────────────────────────────────────────────────── */

test('a bounded mint time leaves here with its bound attached', () => {
  const pair = projectPair(facts({ mintPrecision: 'bounded', mintBoundS: 5 }));
  assert.deepEqual(pair.mintedAt, { at: T0 - 5 * DAY });
  assert.equal(pair.mintedAtBoundS, 5);
});

test('an exact mint time carries no bound, and a sub-second bound is rounded up to one', () => {
  const exact = projectPair(facts({ mintPrecision: 'exact', mintBoundS: null }));
  assert.equal(exact.mintedAtBoundS, null);

  /* Stating a bound smaller than it is claims a precision nobody has, and rounding is the
     cheapest place to lose one. */
  const tiny = projectPair(facts({ mintPrecision: 'bounded', mintBoundS: 0.4 }));
  assert.equal(tiny.mintedAtBoundS, 1);
});

test('a bounded mint time with no width is published as unreadable, not as a bare instant', () => {
  /* A row written around the store's `bounded_requires_width` constraint. An estimate whose
     error we cannot state is not a better answer than no answer — it is the same answer with
     the caveat deleted. */
  const broken = projectPair(facts({ mintPrecision: 'bounded', mintBoundS: null }));
  assert.deepEqual(broken.mintedAt, { at: null, why: 'unreadable' });
  assert.equal(broken.mintedAtBoundS, null);
});

test('an unknown mint time stays absent and is never filled from anything', () => {
  const unknown = projectPair(facts({ mintPrecision: 'unknown', mintedAt: null, mintBoundS: null }));
  assert.deepEqual(unknown.mintedAt, { at: null, why: 'not_read_yet' });
  assert.equal(unknown.mintedAtBoundS, null);
});

/* ── hostile text ─────────────────────────────────────────────────────── */

test('a hostile token name is bounded and stripped before it is stored', () => {
  /* ★ THE THREE ATTACKS THAT MATTER, IN ONE ROW. A name is typed by whoever minted the coin.
     None of these is hypothetical and all three are free to do. */
  const hostile = projectPair(
    facts({
      /* 1. MARKUP. It stays as TEXT — the projection does not escape it and does not need to,
            because the far side renders it as a JSX child and never as HTML. What matters
            here is that it is a plain string and not an object, a URL or anything a renderer
            could be talked into interpreting. */
      name: '<script>alert(1)</script>',
      /* 2. A BIDI OVERRIDE, which does not affect this name alone: U+202E reverses the visual
            order of the text AROUND it, so a coin can rewrite the label sitting beside it. */
      ticker: 'AB‮CD',
      address: 'A'.repeat(400),
    }),
  );

  assert.equal(typeof hostile.name, 'string');
  assert.equal(hostile.name, '<script>alert(1)</script>');
  assert.equal(hostile.ticker.includes('‮'), false, 'a bidi override survived');
  assert.equal(hostile.ticker, 'ABCD');
  /* 3. LENGTH. A Solana address is at most 44 characters; anything longer is not one, and it
        arrives visibly truncated rather than silently full-length. */
  assert.ok(hostile.address.length <= 65, `an address of ${hostile.address.length} was stored`);
  assert.ok(hostile.address.endsWith('…'), 'a truncation must be visible as one');
});

test('a name of nothing but invisible characters collapses to empty, not to padding', () => {
  /* Zero-width and default-ignorable code points render as nothing, so a ticker built out of
     them is a coin wearing another coin's name once a lookalike is spliced in. An empty
     ticker renders as nothing on the far side — never as the address. */
  const invisible = projectPair(facts({ ticker: '​​ᅟ', name: '   ' }));
  assert.equal(invisible.ticker, '');
  assert.equal(invisible.name, '');
});

test('a vendor’s name inside a token name is refused, loudly', () => {
  /* Naming a rival's data vendor in a token name is free. The caller drops the one row and
     prints it rather than losing the frame. */
  for (const vendor of FORBIDDEN_SUBSTRINGS) {
    assert.throws(
      () => projectPair(facts({ name: `the ${vendor} coin` })),
      WireLeakError,
      `a token name containing "${vendor}" was published`,
    );
  }
});

test('no key of a projected pair is internal vocabulary', () => {
  const pair = projectPair(facts());
  for (const key of Object.keys(pair)) {
    assert.equal(
      FORBIDDEN_KEYS.includes(key.toLowerCase()),
      false,
      `the pair payload carries the key ${key}`,
    );
  }
});

test('a pair carries no tradable flag and no 24h move, so no buy affordance can be built', () => {
  /* Structural rather than stylistic: the fields do not exist, so a component cannot render
     them however the screen is later rewritten. Asserted on the payload rather than on the
     type, because a type is gone at runtime and this is the half that survives. */
  const pair: Record<string, unknown> = { ...projectPair(facts()) };
  assert.equal('tradable' in pair, false);
  assert.equal('priceChange24h' in pair, false);
  assert.equal('imageUrl' in pair, false);
});

/* ── the head, and the refusal ────────────────────────────────────────── */

test('a head with counts publishes them, and says how far the list reaches', () => {
  const head = projectPairHead({
    windowMs: 14 * DAY,
    lastMintHeardAt: T0 - 5 * DAY,
    counts: COUNTS,
  });
  assert.equal(head.windowMs, 14 * DAY);
  assert.deepEqual(head.lastMintHeardAt, { at: T0 - 5 * DAY });
  assert.deepEqual(head.rows, {
    listing: 'shown',
    mintsInWindow: 192,
    withMarket: 6,
    withoutMarket: 186,
  });
});

test('a feed that has never been heard from says so, rather than reporting an instant of zero', () => {
  /* ★ AN ABSENT INSTANT IS NOT AN OLD ONE. "Nothing has ever been heard on this feed" is a
     statement about our own watching; "we heard nothing lately" is about the world going
     quiet. Rendering both as a long duration would collapse the one distinction that tells
     an operator whether to start a process or to go and look at a market. */
  const head = projectPairHead({ windowMs: 14 * DAY, lastMintHeardAt: null, counts: COUNTS });
  assert.deepEqual(head.lastMintHeardAt, { at: null, why: 'not_read_yet' });
});

test('★ when rows are withheld, the head carries no counts at all', () => {
  /* The counts would be over a population that may contain coins nobody ever minted. A
     confident "6 of 192" about that population is the same class of claim as listing the
     fictions themselves, so the union has no branch that can express it. */
  const head = projectPairHead({ windowMs: 14 * DAY, lastMintHeardAt: T0 - 5 * DAY, counts: null });
  assert.deepEqual(head.rows, { listing: 'withheld' });

  const asRecord: Record<string, unknown> = { ...head.rows };
  assert.equal('mintsInWindow' in asRecord, false);
  assert.equal('withMarket' in asRecord, false);
  assert.equal('withoutMarket' in asRecord, false);
});

test('★ a withheld frame carries no rows, even when rows were projected', () => {
  /* The frame is emptied HERE, at the projection, and not at the screen. A frame carrying
     rows under a withheld head is a frame whose two halves disagree, and the half that got
     rendered would be whichever one a component happened to read. */
  const withheld = projectPairHead({ windowMs: 14 * DAY, lastMintHeardAt: null, counts: null });
  const frame = projectPairFeed(7, withheld, [projectPair(facts())]);
  assert.equal(frame.tick, 7);
  assert.deepEqual(frame.pairs, []);
});

test('a shown frame keeps the order it was given and does not re-sort it', () => {
  /* The ordering is mint time, decided by the projector against times this function cannot
     see. Anything that re-derived it here would be a second answer nobody compared. */
  const head = projectPairHead({ windowMs: 14 * DAY, lastMintHeardAt: T0, counts: COUNTS });
  const newer = projectPair(facts({ assetKey: 'solana:newer', mintedAt: T0 - 1 * DAY }));
  const older = projectPair(facts({ assetKey: 'solana:older', mintedAt: T0 - 9 * DAY }));
  const frame = projectPairFeed(2, head, [newer, older]);
  assert.deepEqual(
    frame.pairs.map((p) => p.pairId),
    ['solana:newer', 'solana:older'],
  );
});

test('★ the head carries no machinery either, on both branches of the union', () => {
  /* THE GAP THIS CLOSES. 0014 stores this payload on public.pair_view, which is granted to
     the app role, and the column comment promises it is "already censored" — a promise
     nothing kept until `projectPairHead` started running the censor. Every other payload
     committed onto a granted table runs it, including `projectFeedSource`, which carries no
     free text at all and runs it anyway so the property survives the next field somebody
     adds.

     This is the payload most likely to acquire that field: it is the sentence above the
     table, so the pressure on it is always to explain — a `reason` for the withholding, a
     `threshold` the silence was measured against, a `verdict` about the feed. All three are
     forbidden, and all three would have been published without a word. */
  for (const head of [
    projectPairHead({ windowMs: 14 * DAY, lastMintHeardAt: T0 - 6 * DAY, counts: COUNTS }),
    projectPairHead({ windowMs: 14 * DAY, lastMintHeardAt: null, counts: null }),
  ]) {
    const flat = JSON.stringify(head).toLowerCase();
    for (const word of [...FORBIDDEN_KEYS, ...FORBIDDEN_SUBSTRINGS]) {
      assert.equal(flat.includes(word), false, `the pairs head leaked ${word}`);
    }
  }

  /* ★ AND THE KEY LIST IS PINNED, WHICH IS THE HALF THAT CAN FAIL TODAY. The censor above
     cannot be provoked from this function's inputs — every field of the head is constructed
     by name, so an extra key on `counts` is dropped before the payload exists — exactly as
     `projectFeedSource`'s equivalent test cannot provoke its own. What both CAN do is state
     the shape, so that the day a fourth key is added the diff has to come past a test that
     names all three, and the censor is standing behind it for the words that matter. */
  const head = projectPairHead({ windowMs: 14 * DAY, lastMintHeardAt: T0, counts: COUNTS });
  assert.deepEqual(Object.keys(head).sort(), ['lastMintHeardAt', 'rows', 'windowMs']);
  assert.deepEqual(Object.keys(head.rows).sort(), [
    'listing',
    'mintsInWindow',
    'withMarket',
    'withoutMarket',
  ]);
});
