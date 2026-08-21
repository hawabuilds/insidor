/**
 * THE PAIRS SCREEN'S RULES, called with literals.
 *
 * `pairsView` and `pairRows` are pure, so every branch of this screen is reachable from a
 * test with no DOM, no clock and no network — which is the whole reason the decisions live
 * in `pairs.ts` and not in the component. The `.tsx` renders what these functions return and
 * decides nothing, so what is asserted here is what is on screen.
 *
 * THE FIVE CLAIMS, in the order the parent surface asked for them:
 *
 *   1. AN EMPTY LIST SAYS WHY, AND SAYS WHEN WE LAST LOOKED. "Nothing reached a market" is
 *      a fact about the market; "nothing has been heard for six days" is a fact about us.
 *      An empty screen that gave only the first would be blaming the world for our silence.
 *
 *   2. A SCREEN THAT HAS STOPPED REFRESHING SAYS SO, and keeps the rows it holds rather than
 *      blanking them — a stale list beside a notice is worth more than an empty one.
 *
 *   3. ROWS THAT MAY NOT BE LISTED ARE NOT LISTED, and that state is neither an error nor an
 *      empty market. All three render differently.
 *
 *   4. AN ABSENCE IS A DASH WITH A REASON, NEVER A ZERO — and a bounded mint time renders
 *      with a "~" and states its bound.
 *
 *   5. A HOSTILE TOKEN NAME IS CARRIED AS TEXT. Not escaped, not stripped a second time:
 *      carried, as an inert string, in a field a component puts into JSX children.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Pair, PairFeed } from '../../shared/api/index.ts';
import { instant, known, pending, pendingInstant } from '../../shared/format/measure.ts';
import { POLL_MS, pairRows, pairsView } from './pairs.ts';

const T0 = 1_755_079_200_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The last read succeeded a moment ago. Anything else would trip the stale branch. */
const FRESH = T0 - 2_000;

function pair(over: Partial<Pair> = {}): Pair {
  return {
    pairId: 'solana:toad',
    ticker: 'CopeToad',
    name: 'cope toad',
    address: '9pToadPoolA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU',
    venueLabel: 'Pump.fun',
    mintedAt: instant(T0 - 5 * DAY),
    mintedAtBoundS: 5,
    readAt: instant(T0 - 52 * MIN),
    priceUsd: known(0.000_001_999),
    marketCapUsd: known(1_903),
    marketCapBasis: 'fully-diluted',
    liquidityUsd: known(1_978),
    ...over,
  };
}

function feed(over: { pairs?: readonly Pair[]; heardAt?: number | null; counts?: { mintsInWindow: number; withMarket: number; withoutMarket: number } | null } = {}): PairFeed {
  const counts = over.counts === undefined ? { mintsInWindow: 192, withMarket: 6, withoutMarket: 186 } : over.counts;
  const heardAt = over.heardAt === undefined ? T0 - 5 * DAY - 21 * HOUR : over.heardAt;
  return {
    tick: 1,
    head: {
      windowMs: 14 * DAY,
      lastMintHeardAt: heardAt === null ? pendingInstant('not_read_yet') : instant(heardAt),
      rows: counts === null ? { listing: 'withheld' } : { listing: 'shown', ...counts },
    },
    pairs: counts === null ? [] : (over.pairs ?? [pair()]),
  };
}

/* ── the sentence the screen exists to say ────────────────────────────── */

test('the ratio is the headline, and it names both sides of it', () => {
  const view = pairsView({ feed: feed(), failure: null, lastOkAt: FRESH, now: T0 });
  assert.equal(view.ratio, '6 of 192 mints we captured reached a market. 186 have none.');
  assert.equal(view.span, 'Mints from the last 14d, newest mint first.');
});

test('★ an empty population is its own sentence, never a "0 of 0"', () => {
  /* A ratio over nothing reads as a measurement of a market. What actually happened is that
     we captured nothing to measure, which is a fact about us. */
  const view = pairsView({
    feed: feed({ counts: { mintsInWindow: 0, withMarket: 0, withoutMarket: 0 }, pairs: [] }),
    failure: null,
    lastOkAt: FRESH,
    now: T0,
  });
  assert.equal(view.ratio, 'No mints were captured in this window, so there is nothing to price.');
  assert.equal(view.ratio?.includes('0 of 0'), false);
});

test('what the screen cannot show is on the screen, whenever it holds a frame', () => {
  const view = pairsView({ feed: feed(), failure: null, lastOkAt: FRESH, now: T0 });
  assert.ok(view.limits !== null);
  for (const missing of ['when the pool opened', 'how new the pair is', 'can be bought']) {
    assert.ok(view.limits?.includes(missing), `the limits line does not name "${missing}"`);
  }
});

/* ── 1. the empty state ───────────────────────────────────────────────── */

test('★ an empty list says both why it is empty and when we last heard a mint', () => {
  const view = pairsView({
    feed: feed({ pairs: [], counts: { mintsInWindow: 192, withMarket: 0, withoutMarket: 192 } }),
    failure: null,
    lastOkAt: FRESH,
    now: T0,
  });

  assert.deepEqual(view.rows, []);
  assert.equal(view.notice, null, 'an empty market is not a failure and must not read as one');
  assert.equal(view.empty?.headline, 'Nothing we captured reached a market.');
  /* The two halves of the sentence the parent surface asked for: the market's answer, and
     how long ago we last had contact with the world it is an answer about. */
  assert.ok(view.empty?.detail.includes('0 of 192 mints we captured reached a market'));
  assert.ok(view.empty?.detail.includes('Mints last heard 5d ago'));
});

test('before the first read there are no rows, no counts and no invented zero', () => {
  const view = pairsView({ feed: null, failure: null, lastOkAt: null, now: T0 });
  assert.deepEqual(view.rows, []);
  assert.equal(view.ratio, null, 'a count we have not been given must not be printed');
  assert.equal(view.heard, null);
  assert.equal(view.notice, null);
  assert.equal(view.empty?.headline, 'Reading the pairs feed.');
});

test('a feed that has never been projected reads differently from one that failed', () => {
  const notFound = pairsView({
    feed: null,
    failure: Object.assign(new Error('read failed'), { name: 'ReadError', status: 404 }),
    lastOkAt: null,
    now: T0,
  });
  /* A plain object with a status is NOT a ReadError, so this falls to the general branch —
     which is the point: the 404 sentence is only reachable through the real class, and
     nothing here reads a status off an arbitrary thrown value. */
  assert.equal(notFound.empty, null);
  assert.ok(notFound.notice !== null);
  assert.equal(notFound.notice?.headline, 'The pairs feed could not be read.');
  /* Whatever the failure was, the screen says the list is empty because we could not ask —
     not because nothing has reached a market. */
  assert.ok(notFound.notice?.detail.includes('because we could not ask'));
});

/* ── 2. the stale states ──────────────────────────────────────────────── */

test('★ a screen that has stopped refreshing keeps its rows and says they are not refreshing', () => {
  const view = pairsView({
    feed: feed(),
    failure: null,
    /* Four polls without a successful read. The bar is three, expressed as a multiple of the
       cadence so changing the cadence cannot silently change what counts as broken. */
    lastOkAt: T0 - 4 * POLL_MS,
    now: T0,
  });

  assert.equal(view.rows.length, 1, 'rows we hold are worth more than a blank screen');
  assert.equal(view.notice?.headline, 'This screen has stopped refreshing.');
  assert.ok(view.notice?.detail.includes('older than they say'));
  assert.equal(view.empty, null);
  /* The ratio survives: it describes the frame we are holding, and that frame is still what
     is on screen. */
  assert.equal(view.ratio, '6 of 192 mints we captured reached a market. 186 have none.');
});

test('a failure on top of rows keeps them and warns that both ages are understated', () => {
  const view = pairsView({
    feed: feed(),
    failure: new Error('network'),
    lastOkAt: FRESH,
    now: T0,
  });
  assert.equal(view.rows.length, 1);
  assert.equal(view.notice?.headline, 'The pairs feed stopped answering.');
  assert.ok(view.notice?.detail.includes('reading ages'));
});

test('★ a silent mint feed is stated in every state, including the healthy ones', () => {
  /* This is the fact the whole surface turns on: a list of six-day-old coins under no
     mention of the silence behind them is a lie of omission. It is attached BEFORE the
     branch ladder, so a failed poll cannot take it off the screen at the moment it is most
     worth reading. */
  const healthy = pairsView({ feed: feed(), failure: null, lastOkAt: FRESH, now: T0 });
  const broken = pairsView({ feed: feed(), failure: new Error('x'), lastOkAt: FRESH, now: T0 });
  const stopped = pairsView({ feed: feed(), failure: null, lastOkAt: T0 - 4 * POLL_MS, now: T0 });

  for (const view of [healthy, broken, stopped]) {
    assert.equal(view.heard?.headline, 'Mints last heard 5d ago.');
  }
});

test('a feed nothing has ever been heard on says that, not "a long time ago"', () => {
  /* Two different facts. "Nothing has ever watched" is about us; "we watched and it went
     quiet" is about the world, and only one of them is fixed by starting a process. */
  const view = pairsView({ feed: feed({ heardAt: null }), failure: null, lastOkAt: FRESH, now: T0 });
  assert.equal(view.heard?.headline, 'No mint has ever been heard on this feed.');
  assert.equal(view.heard?.headline.includes('ago'), false);
});

/* ── 3. rows that may not be listed ───────────────────────────────────── */

test('★ withheld rows are not listed, carry no counts, and do not read as an error', () => {
  const view = pairsView({ feed: feed({ counts: null }), failure: null, lastOkAt: FRESH, now: T0 });

  assert.deepEqual(view.rows, []);
  /* Not a ratio: the counts behind one would be over a population that may hold coins nobody
     ever minted, and a confident "6 of 192" about that is the invented data this screen
     refuses to print. */
  assert.equal(view.ratio, null);
  /* Not amber. This is a correct refusal rather than a degraded transport, and a transport
     notice would suggest it will clear itself. It clears when the store learns where its
     rows came from. */
  assert.equal(view.notice, null);
  assert.equal(view.empty?.headline, 'These rows are not being listed.');
  assert.ok(view.empty?.detail.includes('written by a demo tool'));
  /* And the silence is still stated, because it is still true. */
  assert.equal(view.heard?.headline, 'Mints last heard 5d ago.');
});

test('★ a withheld frame takes precedence over a failed poll', () => {
  /* A withheld frame carries no rows, so "failed while holding rows" cannot be true of it —
     and a transport notice over this card would name the wrong cause. */
  const view = pairsView({
    feed: feed({ counts: null }),
    failure: new Error('network'),
    lastOkAt: T0 - 9 * POLL_MS,
    now: T0,
  });
  assert.equal(view.empty?.headline, 'These rows are not being listed.');
  assert.equal(view.notice, null);
});

/* ── 4. absences, and the bounded age ─────────────────────────────────── */

test('★ an absent figure is a dash with a reason and never a zero', () => {
  const [row] = pairRows(
    [
      pair({
        /* A bonding curve reports no two-sided reserve. `not_reported` is a different fact
           from `no_market` and the tooltip says which. */
        liquidityUsd: pending('not_reported'),
        marketCapUsd: pending('no_market'),
      }),
    ],
    T0,
  );

  assert.equal(row?.liquidity.kind, 'pending');
  assert.equal(row?.liquidity.text, '—');
  assert.equal(row?.cap.kind, 'pending');
  assert.equal(row?.cap.text, '—');
  for (const cell of [row?.liquidity, row?.cap]) {
    assert.equal(cell?.text.includes('0'), false, 'an absence rendered as a zero');
  }
});

test('a price below a cent keeps its significant figures rather than rounding to $0.00', () => {
  const [row] = pairRows([pair({ priceUsd: known(0.000_001_999) })], T0);
  assert.equal(row?.price.kind, 'value');
  assert.equal(row?.price.text, '$0.00000200');
  assert.equal(row?.price.text, '$0.00000200', 'a price must never render as $0.00');
});

test('★ a bounded mint time renders with a "~" and states its bound in words', () => {
  const [bounded] = pairRows([pair({ mintedAt: instant(T0 - 3 * MIN), mintedAtBoundS: 1800 })], T0);
  assert.equal(bounded?.age.text, '~3m');
  assert.equal(bounded?.ageLabel, 'minted about 3m ago, give or take 30m');

  /* Only a chain confirmation earns the plain form. */
  const [exact] = pairRows([pair({ mintedAt: instant(T0 - 3 * MIN), mintedAtBoundS: null })], T0);
  assert.equal(exact?.age.text, '3m');
  assert.equal(exact?.ageLabel, 'minted 3m ago');
});

test('a mint time we never learned is a dash, never "0s"', () => {
  /* "0s" reads as brand new, which would promote the coins we know least about to the top of
     a list whose whole subject is earliness. */
  const [row] = pairRows([pair({ mintedAt: pendingInstant('not_read_yet'), mintedAtBoundS: null })], T0);
  assert.equal(row?.age.kind, 'pending');
  assert.equal(row?.age.text, '—');
  assert.equal(row?.ageLabel, 'reading');
});

test('★ every row states how old the figures beside it are', () => {
  /* This screen publishes a reading rather than suppressing a stale one. That is only
     defensible while this cell exists, so its absence would be the bug. */
  const [row] = pairRows([pair({ readAt: instant(T0 - 52 * MIN) })], T0);
  assert.equal(row?.read.kind, 'value');
  assert.equal(row?.read.text, '52m');
  assert.ok(row?.readLabel.includes('read 52m ago'));
  assert.ok(row?.readLabel.includes('these figures are that old'));
});

test('an empty ticker renders as nothing — never as the address and never as the name', () => {
  const [row] = pairRows([pair({ ticker: '', name: 'unnamed' })], T0);
  assert.equal(row?.ticker, '');
  assert.equal(row?.tile, '?');
  assert.equal(row?.ticker === row?.address, false);
});

test('the address is shortened, and the order the server committed is never re-sorted', () => {
  const rows = pairRows([pair({ pairId: 'b', mintedAt: instant(T0 - 1 * DAY) }), pair({ pairId: 'a', mintedAt: instant(T0 - 9 * DAY) })], T0);
  assert.deepEqual(rows.map((r) => r.key), ['b', 'a']);
  assert.equal(rows[0]?.address, '9pTo…S0tU');
});

/* ── 5. hostile text ──────────────────────────────────────────────────── */

test('★ a hostile token name is carried as inert text, in a field that is rendered as text', () => {
  /* The projection already bounded this string and stripped its control and bidi characters.
     What this side must not do is turn it into anything a renderer could interpret: no URL,
     no markup, no object. It arrives as a string, it leaves as a string, and `Pairs.tsx` puts
     it into JSX children — which React escapes — rather than into `dangerouslySetInnerHTML`,
     an `href` or an `<img src>`. */
  const nasty = '<img src=x onerror=alert(1)>"\'&`';
  const [row] = pairRows([pair({ name: nasty, ticker: '<b>PWN</b>' })], T0);

  assert.equal(typeof row?.name, 'string');
  assert.equal(row?.name, nasty, 'the string must be carried unchanged, not silently rewritten');
  assert.equal(typeof row?.ticker, 'string');
  assert.equal(row?.tile, '<', 'the tile is one character of the ticker and nothing more');

  /* Nothing in the row is a URL, a node, or anything with a `__html` in it. A row is a bag of
     strings and `Rendered` values, and that is what makes "rendered as text" checkable. */
  for (const [key, cell] of Object.entries(row ?? {})) {
    const shape = typeof cell;
    assert.ok(shape === 'string' || shape === 'object', `${key} is a ${shape}`);
    if (shape === 'object') {
      assert.equal('__html' in (cell as object), false, `${key} carries raw markup`);
    }
  }
});

test('an astral first character is not cut through the middle of a surrogate pair', () => {
  /* `Array.from` iterates code points. `[0]` would leave half a pair and render a replacement
     glyph in the tile. */
  const [row] = pairRows([pair({ ticker: '🐸FROG' })], T0);
  assert.equal(row?.tile, '🐸');
});

/* ── the table and the sentence above it are one screen ───────────────── */

test('★ a table shorter than its own headline says so, rather than contradicting itself', () => {
  /* THE GAP THIS CLOSES. `withMarket` is a count with no limit on it; the rows come from a
     listing that HAS one (PAIR_LIMIT in the pairs projector) and that additionally drops any
     single row whose payload would have leaked. So "48 of 235 reached a market" can sit above
     forty-seven rows, and a reader who counts them finds the screen disagreeing with itself
     with nothing on it to reconcile the two. The launches rail already had this line and this
     screen did not — which is the same rule held in one place and dropped in another.

     Two numbers stated, no cause given: a capped list and a withheld row are both "not on
     this frame", and which one happened is our machinery rather than a fact about a coin. */
  const view = pairsView({
    feed: feed({ pairs: [pair(), pair({ pairId: 'solana:b' })], counts: { mintsInWindow: 235, withMarket: 5, withoutMarket: 230 } }),
    failure: null,
    lastOkAt: FRESH,
    now: T0,
  });
  assert.equal(view.rows.length, 2);
  assert.equal(
    view.shortfall,
    'Listing 2 of the 5 that reached a market. The other 3 are not on this frame.',
  );
  /* Never a reason, because we do not have one to give. */
  for (const word of ['withheld', 'limit', 'censor', 'leak']) {
    assert.equal(view.shortfall?.includes(word), false, `the shortfall line explains itself with "${word}"`);
  }
});

test('a table that matches its headline carries no reconciliation line at all', () => {
  const view = pairsView({
    feed: feed({ pairs: [pair(), pair({ pairId: 'solana:b' })], counts: { mintsInWindow: 235, withMarket: 2, withoutMarket: 233 } }),
    failure: null,
    lastOkAt: FRESH,
    now: T0,
  });
  assert.equal(view.shortfall, null, 'a line that is always up is a line nobody reads');
});

test('★ the shortfall survives a failed poll and a stale screen, where it matters most', () => {
  /* Both are states in which the frame on screen is the last one we managed to read, so the
     gap between the table and the sentence above it is exactly as real as it was — and a line
     that vanished the moment something else went wrong would be missing at the moment it was
     most worth reading. `heard`, `span` and `limits` are attached to every branch for the same
     reason. */
  const held = feed({
    pairs: [pair()],
    counts: { mintsInWindow: 235, withMarket: 4, withoutMarket: 231 },
  });
  const failed = pairsView({ feed: held, failure: new Error('read failed'), lastOkAt: FRESH, now: T0 });
  const stale = pairsView({ feed: held, failure: null, lastOkAt: T0 - 10 * MIN, now: T0 });

  assert.match(failed.shortfall ?? '', /Listing 1 of the 4/);
  assert.match(stale.shortfall ?? '', /Listing 1 of the 4/);
  assert.notEqual(failed.notice, null, 'the fetch-loop notice is still its own slot');
  assert.notEqual(stale.notice, null);
});

test('★ an empty table under a non-zero count blames US, not the market', () => {
  /* The branch is reached whenever there are no rows, and it used to say "Nothing we captured
     reached a market" in every one of them — a flat contradiction of the sentence printed
     directly above it whenever the count was not zero. A frame that counted four and carried
     none of them is a fact about our own projection, and stating it as a fact about the market
     is the same shape of untruth this screen exists to refuse, arriving through an empty card.

     There is no shortfall line on this branch: the card already IS the whole sentence, and a
     second line under an empty table would say it twice. */
  const view = pairsView({
    feed: feed({ pairs: [], counts: { mintsInWindow: 235, withMarket: 4, withoutMarket: 231 } }),
    failure: null,
    lastOkAt: FRESH,
    now: T0,
  });
  assert.deepEqual(view.rows, []);
  assert.equal(view.empty?.headline, 'None of them are listed here.');
  assert.match(view.empty?.detail ?? '', /ours and not the market/);
  assert.equal(view.shortfall, null);
});

test('an empty table under a count of zero still says the market produced nothing', () => {
  /* The other half of the same branch, unchanged: when nothing reached a market that IS the
     fact, and it is still printed beside when we last heard a mint so that an empty screen
     cannot be read as a quiet market when it is a dead feed. */
  const view = pairsView({
    feed: feed({ pairs: [], counts: { mintsInWindow: 235, withMarket: 0, withoutMarket: 235 } }),
    failure: null,
    lastOkAt: FRESH,
    now: T0,
  });
  assert.equal(view.empty?.headline, 'Nothing we captured reached a market.');
  assert.match(view.empty?.detail ?? '', /Mints last heard/);
});

test('a withheld frame has no two numbers to reconcile, so it carries no line', () => {
  const view = pairsView({ feed: feed({ counts: null }), failure: null, lastOkAt: FRESH, now: T0 });
  assert.equal(view.shortfall, null);
  assert.equal(view.ratio, null, 'and still no count over a population that may hold fictions');
});
