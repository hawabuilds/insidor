/**
 * THE LAUNCHES PROJECTION, tested against the rules it exists to hold.
 *
 * No database and no fixtures on disk: `projectLaunch` is pure, so a test is a literal in
 * and a literal out. Each block names the failure it guards against rather than the function
 * it calls.
 *
 * The three rules, and all three are the same rule wearing different clothes — WHAT WE DO
 * NOT KNOW MUST NOT BE PUBLISHED AS SOMETHING WE DO:
 *
 *   1. A MINT TIME WE ONLY HAVE BOUNDS ON LEAVES HERE WITH ITS BOUND ATTACHED. A live mint
 *      feed reports when we HEARD, not when the coin was minted, and mint time is the axis
 *      every ordering claim in the product hangs on. Publishing the centre of an interval
 *      with the width deleted turns an estimate into a reading one field at a time.
 *
 *   2. AN ABSENT MARKET CAP STAYS ABSENT. A coin four minutes old has no pool. That is the
 *      normal state of this rail, and a zero says "worthless" about a coin whose actual
 *      state is "nobody has traded it yet".
 *
 *   3. A STRING SOMEBODY ELSE TYPED IS BOUNDED BEFORE IT IS STORED. Not before it is
 *      rendered — before it is STORED, so an over-long or control-laden name cannot reach a
 *      browser however the client is later rewritten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectFeedSource, projectLaunch } from './project.ts';
import type { CoinMarket, LaunchFacts, MarketNumber, ProjectOptions } from './project.ts';
import { FORBIDDEN_KEYS, FORBIDDEN_SUBSTRINGS, WireLeakError } from './wire.ts';

const T0 = 1_755_079_200_000;
const MIN = 60_000;
/** Five minutes, the same window Policy.market.readingFreshnessMs carries. */
const FRESHNESS = 5 * MIN;

/** Fifteen minutes, the same bar Policy.assets.feedFreshnessMs carries. */
const FEED_FRESHNESS = 15 * MIN;

const OPTIONS: ProjectOptions = {
  nowMs: T0,
  sparkWindowMs: 30 * MIN,
  marketFreshnessMs: FRESHNESS,
  feedFreshnessMs: FEED_FRESHNESS,
};

const known = (amount: number): MarketNumber => ({ known: true, amount });
const absent = (why: 'no_market' | 'not_reported' | 'unreadable'): MarketNumber => ({
  known: false,
  why,
});

function market(over: Partial<CoinMarket> = {}): CoinMarket {
  return {
    takenAt: T0 - MIN,
    priceUsd: known(0.000_031),
    marketCapUsd: known(31_400),
    marketCapBasis: 'fully-diluted',
    liquidityUsd: absent('not_reported'),
    priceChange24h: absent('not_reported'),
    tradable: true,
    ...over,
  };
}

function facts(over: Partial<LaunchFacts> = {}): LaunchFacts {
  return {
    assetKey: 'solana:9xJersey',
    ticker: 'JERSEY',
    name: 'jersey',
    address: '9xJerseyA1qP2mNvKdRt7sZbFgHyCwXeUoTiLkMnPq',
    venueLabel: 'Pump.fun',
    mintedAt: T0 - 3 * MIN,
    mintPrecision: 'bounded',
    mintBoundS: 20,
    market: null,
    ...over,
  };
}

/* ── ★ mint time: bounded is not exact and must not read as exact ─────── */

test('★ a bounded mint time is published WITH its bound', () => {
  const launch = projectLaunch(facts(), OPTIONS);
  assert.deepEqual(launch.mintedAt, { at: T0 - 3 * MIN });
  assert.equal(launch.mintedAtBoundS, 20);
});

test('★ an exact mint time carries no bound, so the bound means something', () => {
  /* If every row carried a width the tilde on the rail would be decoration. Only a chain
     confirmation earns `exact`, and 0005\'s `exact_requires_real_source` is what stops a
     third-party field claiming it. */
  const launch = projectLaunch(facts({ mintPrecision: 'exact', mintBoundS: null }), OPTIONS);
  assert.deepEqual(launch.mintedAt, { at: T0 - 3 * MIN });
  assert.equal(launch.mintedAtBoundS, null);
});

test('★ an unknown mint time is absent with a reason, never backfilled', () => {
  /* Never from first_seen_at, which is when WE looked and can postdate a mint by hours.
     Rendered as an age it would make the oldest, least-known coins look like the freshest,
     which on a product selling earliness is the worst available direction to be wrong in. */
  const launch = projectLaunch(
    facts({ mintPrecision: 'unknown', mintedAt: null, mintBoundS: null }),
    OPTIONS,
  );
  assert.deepEqual(launch.mintedAt, { at: null, why: 'not_read_yet' });
  assert.equal(launch.mintedAtBoundS, null);
});

test('★ a bounded row with no width is published as unreadable, not as a bare instant', () => {
  /* 0005\'s `bounded_requires_width` makes this row unwritable, so reaching this branch means
     something wrote around the constraint. The safe direction is to drop the instant: an
     estimate whose error we cannot state is not a better answer than no answer, it is the
     same answer with the caveat deleted. */
  const launch = projectLaunch(facts({ mintBoundS: null }), OPTIONS);
  assert.deepEqual(launch.mintedAt, { at: null, why: 'unreadable' });
  assert.equal(launch.mintedAtBoundS, null);
});

test('a fractional bound is rounded UP and never below one second', () => {
  /* Rounding is the cheapest place to lose a bound. A width stated smaller than it is
     claims a precision nobody has. */
  assert.equal(projectLaunch(facts({ mintBoundS: 20.4 }), OPTIONS).mintedAtBoundS, 21);
  assert.equal(projectLaunch(facts({ mintBoundS: 0.2 }), OPTIONS).mintedAtBoundS, 1);
});

/* ── ★ the market cap: absent is not zero ─────────────────────────────── */

test('★ a coin nobody has read has no cap and no basis, and neither is a zero', () => {
  const launch = projectLaunch(facts({ market: null }), OPTIONS);
  assert.deepEqual(launch.marketCapUsd, { v: null, why: 'not_read_yet' });
  assert.notDeepEqual(launch.marketCapUsd, { v: 0 });
  assert.equal(launch.marketCapBasis, null, 'a basis with no number is a label on nothing');
});

test('★ a coin the venue says has no market keeps the venue\'s own reason', () => {
  /* "Nobody has read this coin" and "the venue answered and there is no market" are
     different facts, and collapsing them is how the build this replaces filtered out the
     entire pre-graduation population. */
  const launch = projectLaunch(
    facts({ market: market({ marketCapUsd: absent('no_market'), marketCapBasis: null }) }),
    OPTIONS,
  );
  assert.deepEqual(launch.marketCapUsd, { v: null, why: 'no_market' });
});

test('a fresh reading publishes the cap and its basis together', () => {
  const launch = projectLaunch(facts({ market: market() }), OPTIONS);
  assert.deepEqual(launch.marketCapUsd, { v: 31_400 });
  assert.equal(launch.marketCapBasis, 'fully-diluted');
});

test('★ a stale reading is dropped whole, and the basis goes with it', () => {
  /* A reading is true of an instant, not of a coin. On a product where a coin can be
     minted, run and peak inside one freshness window, an hour-old cap is not a slightly
     late cap — it is a different story about the same coin. */
  const stale = market({ takenAt: T0 - FRESHNESS - 1 });
  const launch = projectLaunch(facts({ market: stale }), OPTIONS);
  assert.deepEqual(launch.marketCapUsd, { v: null, why: 'not_read_yet' });
  assert.equal(launch.marketCapBasis, null);
});

test('a reading exactly at the freshness edge is still current', () => {
  const edge = market({ takenAt: T0 - FRESHNESS });
  assert.deepEqual(projectLaunch(facts({ market: edge }), OPTIONS).marketCapUsd, { v: 31_400 });
});

/* ── ★ hostile metadata: bounded before it is stored ──────────────────── */

test('★ a ten-kilobyte token name cannot reach a payload', () => {
  const huge = 'A'.repeat(10_000);
  const launch = projectLaunch(facts({ name: huge }), OPTIONS);
  assert.ok(launch.name.length < 60, `a name of ${launch.name.length} characters was published`);
  /* The ellipsis is the point. A silently cut name reads as the coin\'s actual name, and a
     coin apparently called "OFFICIAL SOLANA FOUNDATION TREASU" is a better impersonation
     than the string it came from. */
  assert.ok(launch.name.endsWith('…'), 'a truncation must be visible as one');
});

test('an over-long ticker is bounded too, on its own much tighter limit', () => {
  const launch = projectLaunch(facts({ ticker: 'X'.repeat(500) }), OPTIONS);
  assert.ok(launch.ticker.length < 20);
  assert.ok(launch.ticker.endsWith('…'));
});

test('★ a bidi override cannot survive into a payload', () => {
  /* U+202E does not affect only the string it is in: it reverses the visual order of the
     text AROUND it, so a coin could rewrite the label sitting beside it on the rail. */
  const launch = projectLaunch(facts({ name: 'safe‮elbatrofmoc‬' }), OPTIONS);
  assert.equal(/[‪-‮⁦-⁩]/.test(launch.name), false);
});

test('newlines and control characters are removed, not escaped', () => {
  /* A newline in a ticker turns one dense tape row into three and pushes the rest of the
     rail down the page. */
  const launch = projectLaunch(facts({ name: 'line one\nline two\ttabbed ' }), OPTIONS);
  assert.equal(launch.name, 'line one line two tabbed');
});

test('a name of nothing but whitespace and controls becomes empty, not 48 spaces', () => {
  /* The order of the steps is what makes this true: strip, then collapse, then cap. Capping
     first would publish forty-eight characters of invisible garbage with an ellipsis. */
  assert.equal(projectLaunch(facts({ name: `${' '.repeat(4_000)}​` }), OPTIONS).name, '');
});

test('a null ticker renders as nothing — never as the address and never as the name', () => {
  const launch = projectLaunch(facts({ ticker: null, name: null }), OPTIONS);
  assert.equal(launch.ticker, '');
  assert.equal(launch.name, '');
  assert.notEqual(launch.ticker, launch.address);
});

test('an ordinary name and ticker pass through untouched', () => {
  /* The bound must not be so eager that it mangles the common case; a rail full of
     ellipses would teach everyone reading it to ignore them. */
  const launch = projectLaunch(facts({ ticker: 'JERSEY', name: 'jersey' }), OPTIONS);
  assert.equal(launch.ticker, 'JERSEY');
  assert.equal(launch.name, 'jersey');
});

test('an address longer than any real one is truncated rather than passed whole', () => {
  const launch = projectLaunch(facts({ address: 'Z'.repeat(400) }), OPTIONS);
  assert.ok(launch.address.length < 70);
  assert.ok(launch.address.endsWith('…'));
});

/* ── ★ the censor ─────────────────────────────────────────────────────── */

/** Every key and every string value in a payload, at every depth. */
function walk(value: unknown, out: { keys: string[]; strings: string[] }): void {
  if (typeof value === 'string') {
    out.strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      out.keys.push(key);
      walk(entry, out);
    }
  }
}

test('a projected launch carries no forbidden key and no forbidden substring', () => {
  const launch = projectLaunch(facts({ market: market() }), OPTIONS);
  const found = { keys: [] as string[], strings: [] as string[] };
  walk(launch, found);

  for (const key of found.keys) {
    assert.equal(FORBIDDEN_KEYS.includes(key.toLowerCase()), false, `forbidden key: ${key}`);
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      assert.equal(key.toLowerCase().includes(bad), false, `forbidden substring in key: ${key}`);
    }
  }
  for (const text of found.strings) {
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      assert.equal(text.toLowerCase().includes(bad), false, `forbidden substring in value: ${text}`);
    }
  }
});

test('★ the mint feed\'s name inside a token name is fatal here, not in a browser', () => {
  /* Naming the relay we read a coin from is free to do and would leak who we buy from. It
     is caught before the INSERT, where the cost is one row that is not projected rather
     than a value sitting in a response body. */
  assert.throws(() => projectLaunch(facts({ name: 'first on pumpportal.fun' }), OPTIONS), WireLeakError);
  /* And the venue label is untouched by that rule: 'pumpportal' is not a substring of
     'Pump.fun', so the venue keeps its name. */
  assert.doesNotThrow(() => projectLaunch(facts({ venueLabel: 'Pump.fun' }), OPTIONS));
});

test('a payload carries exactly the nine public fields and no tenth', () => {
  assert.deepEqual(Object.keys(projectLaunch(facts(), OPTIONS)).sort(), [
    'address',
    'launchId',
    'marketCapBasis',
    'marketCapUsd',
    'mintedAt',
    'mintedAtBoundS',
    'name',
    'ticker',
    'venueLabel',
  ]);
});

test('★ nothing on a launch could build a buy affordance', () => {
  /* A rail row must not be one prop-drill from a trade panel. The guarantee is structural:
     the fields are simply not there, so `actionFor` cannot be handed one and no component
     can invent a quote from what is. */
  const keys = Object.keys(projectLaunch(facts({ market: market() }), OPTIONS));
  for (const field of ['priceUsd', 'liquidityUsd', 'priceChange24h', 'tradable', 'imageUrl']) {
    assert.equal(keys.includes(field), false, `${field} reached a launch payload`);
  }
});

/* ── ★ the feed's own state: a dead transport is not a quiet market ───── */

/**
 * THE FAILURE THESE GUARD AGAINST, stated once. The rail's poll loop and the mint feed are
 * independent, and for six days they disagreed in the worst direction: the pill read
 * "updated 2s ago" over coins last heard about 141 hours earlier, and both were true. The
 * rail had no field to say the second thing with. These tests are about that field.
 */

test('★ a feed heard from inside the bar is live, and carries the instant it was heard', () => {
  const source = projectFeedSource(T0 - MIN, OPTIONS);
  assert.deepEqual(source.lastHeardAt, { at: T0 - MIN });
  assert.equal(source.live, true);
});

test('★ a feed silent past the bar is NOT live, and still says when it was last heard', () => {
  /* The instant survives the judgement. A stale feed that published only `live: false`
     would let a surface say "this is old" without being able to say how old, and "no mints
     for a while" is not a sentence anybody can act on. */
  const source = projectFeedSource(T0 - 141 * 60 * MIN, OPTIONS);
  assert.deepEqual(source.lastHeardAt, { at: T0 - 141 * 60 * MIN });
  assert.equal(source.live, false);
});

test('★ the bar is exactly the policy bar, not a number typed in the projector', () => {
  /* At the boundary and one millisecond past it. If this ever disagrees with
     Policy.assets.feedFreshnessMs, the frame a user saw stops being answerable against the
     policy that was in force — which is the whole reason thresholds live in one object. */
  assert.equal(projectFeedSource(T0 - FEED_FRESHNESS, OPTIONS).live, true);
  assert.equal(projectFeedSource(T0 - FEED_FRESHNESS - 1, OPTIONS).live, false);
});

test('★ never heard is a DIFFERENT fact from heard-long-ago, and stays one', () => {
  /* A watcher that has not been started and a watcher that died are different states with
     different answers — start one, versus go and look at why it stopped. Collapsing them
     would tell a fresh deployment its feed had died. */
  const never = projectFeedSource(null, OPTIONS);
  assert.deepEqual(never.lastHeardAt, { at: null, why: 'not_read_yet' });
  assert.equal(never.live, false, 'silence we cannot date is not evidence of liveness');

  const old = projectFeedSource(T0 - 6 * 24 * 60 * MIN, OPTIONS);
  assert.notDeepEqual(never.lastHeardAt, old.lastHeardAt);
});

test('★ an instant in the future is not live, so a skewed clock cannot fake a live feed', () => {
  /* `nowMs - at` goes negative, which passes any naive `silence < bar` test forever — a
     feed that could never be declared dead. It fails closed instead: the reading is
     published as it arrived and judged not live. */
  const source = projectFeedSource(T0 + MIN, OPTIONS);
  assert.deepEqual(source.lastHeardAt, { at: T0 + MIN });
  assert.equal(source.live, false);
});

test('★ the payload carries the instant and the judgement, and no machinery at all', () => {
  /* The vocabulary is what keeps this honest: a bar, a gap count or a sentence explaining
     our reasoning would each be a number about US on a user's screen, and `threshold`,
     `reason` and `verdict` are all forbidden keys. Two keys, no third. */
  const source = projectFeedSource(T0 - 6 * 24 * 60 * MIN, OPTIONS);
  assert.deepEqual(Object.keys(source).sort(), ['lastHeardAt', 'live']);

  const flat = JSON.stringify(source).toLowerCase();
  for (const word of [...FORBIDDEN_KEYS, ...FORBIDDEN_SUBSTRINGS]) {
    assert.equal(flat.includes(word), false, `the feed source leaked ${word}`);
  }
});
