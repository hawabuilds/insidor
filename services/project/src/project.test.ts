/**
 * The projection, tested against the rules it exists to hold.
 *
 * No database, no fixtures loaded from disk, no framework. Every function under test is
 * pure, so a test is a literal in and a literal out — which is the point of having split
 * the projection from the SQL in the first place. Each block below names the failure it
 * is guarding against rather than the function it calls, because "projectSpark returns
 * an array" is not what anybody needs to know six months from now.
 *
 * The recurring assertion is `notDeepEqual(x, 0)` sitting next to the positive one. It
 * looks redundant and it is not: `{ v: null, why: 'not_reported' }` and `{ v: 0 }` are
 * both "falsy-ish shapes that render", and the whole history this repository is written
 * against is a build where the second one silently replaced the first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CensorReason } from '@insidor/contracts';

import { coinCandidates, deriveCoinLink, normalise } from './coins.ts';
import { orderByRecency } from './order.ts';
import { permalinkFor } from './permalinks.ts';
import {
  projectBoard,
  projectBoardRow,
  projectCoin,
  projectCoins,
  projectEvidence,
  projectFirstSeenAt,
  projectMomentum,
  projectReach,
  projectReachDelta24h,
  projectSpark,
  projectStory,
  projectSummary,
  relationText,
  representativeReach,
} from './project.ts';
import type {
  CoinCandidate,
  CoinFacts,
  MemberFacts,
  ProjectOptions,
  ReachReading,
  StoryFacts,
} from './project.ts';
import { FORBIDDEN_KEYS, FORBIDDEN_SUBSTRINGS, WireLeakError } from './wire.ts';

const T0 = 1_755_079_200_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

const OPTIONS: ProjectOptions = { nowMs: T0, sparkWindowMs: 30 * MIN };

/* ── builders ─────────────────────────────────────────────────────────── */

function measuredAt(atMs: number, level: number, perMin: number): ReachReading {
  return { atMs, fidelity: 'exact', rate: { kind: 'measured', perMin, overMs: 2 * MIN, level } };
}

function censoredAt(
  atMs: number,
  reason: CensorReason,
  lastLevel: number | null,
  fidelity: ReachReading['fidelity'] = 'quantized',
): ReachReading {
  return { atMs, fidelity, rate: { kind: 'censored', reason, lastLevel } };
}

function member(overrides: Partial<MemberFacts> = {}): MemberFacts {
  return {
    itemId: 'it_1',
    sourceLabel: 'X',
    authorLabel: '@someone',
    postedAt: T0 - 3 * HOUR,
    excerpt: 'he has been sat out there for three hours now and he is not moving',
    thumbUrl: null,
    permalink: null,
    relation: { kind: 'seed' },
    reach: [measuredAt(T0 - 4 * MIN, 9_000, 40), measuredAt(T0 - 2 * MIN, 12_000, 1_500)],
    ...overrides,
  };
}

function coin(overrides: Partial<CoinFacts> = {}): CoinFacts {
  return {
    coinId: 'c_1',
    ticker: 'DOCK',
    name: 'refuses to dock',
    address: '4kLmNq7wR2vTbYxEuHgJcZaPsDiOfQnXvMmZbCyVdRt8',
    venueLabel: 'A launchpad',
    imageUrl: null,
    mintedAt: T0 - 20 * MIN,
    priceUsd: 0.000_186,
    marketCapUsd: 186_400,
    marketCapBasis: 'fully-diluted',
    liquidityUsd: null,
    tradable: true,
    ...overrides,
  };
}

function candidates(n: number, confident: boolean): CoinCandidate[] {
  return Array.from({ length: n }, (_unused, i) => ({
    coin: coin({ coinId: `c_${i}`, ticker: `TKR${i}` }),
    confident,
  }));
}

function story(overrides: Partial<StoryFacts> = {}): StoryFacts {
  return {
    storyId: 'st_ferry',
    displayTitle: 'Ferry captain refuses to dock, three-hour standoff',
    thumbUrl: null,
    lastMemberAt: T0 - MIN,
    memberCount: 12,
    distinctAuthors: 9,
    distinctSources: 2,
    members: [member()],
    coins: [],
    wasOnPreviousBoard: true,
    ...overrides,
  };
}

/* ── rule 1: a censored reading is null, and it is not zero ───────────── */

test('a censored reading projects to null on the spark, never to 0', () => {
  const readings = [
    measuredAt(T0 - 8 * MIN, 88_000, 900),
    censoredAt(T0 - 6 * MIN, 'below_step', 88_000),
    censoredAt(T0 - 4 * MIN, 'below_step', 88_000),
    measuredAt(T0 - 2 * MIN, 91_000, 1_500),
  ];

  const spark = projectSpark(readings, OPTIONS.sparkWindowMs);

  assert.deepEqual(
    spark.points.map((p) => p.value),
    [88_000, null, null, 91_000],
  );
  /* The two that matter, stated as their own assertions because they are the bug: a
     censored point must not be a zero, and it must not have been dropped either — the
     gap in atMs is the evidence that we looked. */
  for (const point of spark.points) assert.notEqual(point.value, 0);
  assert.equal(spark.points.length, readings.length);
  assert.deepEqual(
    spark.points.map((p) => p.atMs),
    readings.map((r) => r.atMs),
  );
});

test('a censored reading is not filled in from the level it carries forward', () => {
  /* lastLevel is 88_000 on both censored readings. Using it here would draw a flat line
     across a window we did not measure, and a flat line is a claim about stability. */
  const spark = projectSpark([censoredAt(T0 - 4 * MIN, 'below_step', 88_000)], 30 * MIN);
  assert.deepEqual(spark.points, [{ atMs: T0 - 4 * MIN, value: null }]);
});

test('a wholly censored series still produces the window, not an empty graph', () => {
  const spark = projectSpark(
    [censoredAt(T0 - 4 * MIN, 'no_prior', null), censoredAt(T0 - 2 * MIN, 'below_step', null)],
    30 * MIN,
  );
  assert.equal(spark.windowMs, 30 * MIN);
  assert.deepEqual(
    spark.points.map((p) => p.value),
    [null, null],
  );
});

test('the spark carries only the window it declares, so the y scale is set by what is drawn', () => {
  /* The series handed in covers a day and a bit, because reachDelta24h needs its older
     end. The spark is half an hour wide. Sparkline.tsx anchors x at the newest point
     minus windowMs — so the day-old readings are clipped off the chart, but if they were
     still in the array they would set min/max and squash the last thirty minutes of a
     hundredfold riser into a flat line at the top. Flat reads as cooling. */
  const readings = [
    measuredAt(T0 - 25 * HOUR, 1_000, 5),
    measuredAt(T0 - 20 * HOUR, 40_000, 60),
    measuredAt(T0 - 20 * MIN, 480_000, 900),
    censoredAt(T0 - 10 * MIN, 'below_step', 480_000),
    measuredAt(T0 - 2 * MIN, 500_000, 1_500),
  ];

  const spark = projectSpark(readings, 30 * MIN);

  assert.deepEqual(
    spark.points.map((p) => p.atMs),
    [T0 - 20 * MIN, T0 - 10 * MIN, T0 - 2 * MIN],
    'nothing older than the declared window survives',
  );
  /* The censored point inside the window is still there. Clipping is about the axis;
     it must never become a reason to drop a hole we recorded. */
  assert.deepEqual(
    spark.points.map((p) => p.value),
    [480_000, null, 500_000],
  );
});

/* ── rule 2: an absent counter is the absent form, not zero ───────────── */

test('a source with no reach concept projects the absent form, never 0', () => {
  const readings = [
    censoredAt(T0 - 4 * MIN, 'unusable_fidelity', null, 'absent'),
    censoredAt(T0 - 2 * MIN, 'unusable_fidelity', null, 'absent'),
  ];

  const reach = projectReach(readings);

  assert.deepEqual(reach, { v: null, why: 'not_reported' });
  assert.notDeepEqual(reach, { v: 0 });
  assert.equal('v' in reach && reach.v, null);
});

test('a story nobody has read yet is not_read_yet, and is not 0', () => {
  const reach = projectReach([]);
  assert.deepEqual(reach, { v: null, why: 'not_read_yet' });
  assert.notDeepEqual(reach, { v: 0 });
});

test('reach uses the newest measured level, and falls back to the carried level', () => {
  assert.deepEqual(
    projectReach([measuredAt(T0 - 4 * MIN, 88_000, 900), measuredAt(T0 - 2 * MIN, 91_000, 1_500)]),
    { v: 91_000 },
  );
  /* No measured rate anywhere, but the censored reading knows the last level we trusted.
     A level survives even when a difference does not, so refusing it would throw away a
     number we hold — the opposite failure, and also wrong. */
  assert.deepEqual(projectReach([censoredAt(T0 - 2 * MIN, 'below_step', 88_000)]), { v: 88_000 });
});

test('a non-finite level degrades to an absence rather than putting NaN on the board', () => {
  assert.deepEqual(projectReach([measuredAt(T0 - 2 * MIN, Number.NaN, 10)]), {
    v: null,
    why: 'unreadable',
  });
});

test("the day's change is absent unless both of its ends were actually read", () => {
  const short = [measuredAt(T0 - 20 * MIN, 88_000, 900), measuredAt(T0 - 2 * MIN, 91_000, 1_500)];
  assert.deepEqual(projectReachDelta24h(short, T0), { v: null, why: 'not_read_yet' });

  const full = [measuredAt(T0 - 26 * HOUR, 84_000, 10), ...short];
  assert.deepEqual(projectReachDelta24h(full, T0), { v: 91_000 - 84_000 });
});

/* ── rule 3: an unknown instant stays unknown ─────────────────────────── */

test('an unknown first-seen stays unknown and is never backfilled', () => {
  const blind = story({ members: [member({ postedAt: null })] });

  const firstSeenAt = projectFirstSeenAt(blind.members);

  assert.deepEqual(firstSeenAt, { at: null, why: 'not_reported' });
  /* The three substitutions that would each render as "brand new": now, zero, and the
     story's own activity clock. */
  assert.notDeepEqual(firstSeenAt, { at: OPTIONS.nowMs });
  assert.notDeepEqual(firstSeenAt, { at: 0 });
  assert.notDeepEqual(firstSeenAt, { at: blind.lastMemberAt });

  const row = projectBoardRow(blind, OPTIONS);
  assert.deepEqual(row?.firstSeenAt, { at: null, why: 'not_reported' });
});

test('first-seen is the earliest member that reported a time, ignoring the ones that did not', () => {
  const members = [
    member({ itemId: 'it_a', postedAt: null }),
    member({ itemId: 'it_b', postedAt: T0 - 2 * HOUR }),
    member({ itemId: 'it_c', postedAt: T0 - 5 * HOUR }),
  ];
  assert.deepEqual(projectFirstSeenAt(members), { at: T0 - 5 * HOUR });
});

test('a story with no members at all reports not_read_yet rather than not_reported', () => {
  assert.deepEqual(projectFirstSeenAt([]), { at: null, why: 'not_read_yet' });
});

/* ── rule 4: momentum is a word ───────────────────────────────────────── */

test('momentum is one of three words or nothing, never a number', () => {
  const rising = [
    measuredAt(T0 - 6 * MIN, 10, 100),
    measuredAt(T0 - 4 * MIN, 20, 200),
    measuredAt(T0 - 2 * MIN, 40, 400),
  ];
  assert.equal(projectMomentum(rising), 'rising');

  const cooling = [
    measuredAt(T0 - 6 * MIN, 10, 400),
    measuredAt(T0 - 4 * MIN, 20, 200),
    measuredAt(T0 - 2 * MIN, 25, 100),
  ];
  assert.equal(projectMomentum(cooling), 'cooling');

  const steady = [measuredAt(T0 - 4 * MIN, 10, 200), measuredAt(T0 - 2 * MIN, 20, 200)];
  assert.equal(projectMomentum(steady), 'steady');
});

test('too little to say produces no claim at all, not "steady"', () => {
  assert.equal(projectMomentum([]), null);
  assert.equal(projectMomentum([measuredAt(T0 - 2 * MIN, 10, 200)]), null);
  /* Two readings, both censored: we looked twice and learned nothing. "Steady" would be
     a claim that we watched it hold. */
  assert.equal(
    projectMomentum([
      censoredAt(T0 - 4 * MIN, 'below_step', 10),
      censoredAt(T0 - 2 * MIN, 'below_step', 10),
    ]),
    null,
  );
});

test('a censored reading is skipped by momentum, not counted as a flat step', () => {
  /* If the censored reading were read as a rate of 0 this would be down-up, a tie, and
     the answer would be "steady" — the accelerating item reported as holding still. */
  const readings = [
    measuredAt(T0 - 6 * MIN, 10, 100),
    censoredAt(T0 - 4 * MIN, 'below_step', 10),
    measuredAt(T0 - 2 * MIN, 40, 400),
  ];
  assert.equal(projectMomentum(readings), 'rising');
});

/* ── coins: the union, and the branch that carries no coin ────────────── */

test('no assets projects to none', () => {
  assert.deepEqual(projectCoins([]), { kind: 'none' });
});

test('six assets, none of them confident, projects to unsure carrying NO coin', () => {
  const link = projectCoins(candidates(6, false));

  assert.equal(link.kind, 'unsure');
  assert.deepEqual(link, { kind: 'unsure', claimCount: 6 });

  /* The assertion the whole union exists for. A coin anywhere under this tag — even one
     the current UI ignores — is one prop-drill away from a buy panel. */
  const keys = Object.keys(link).sort();
  assert.deepEqual(keys, ['claimCount', 'kind']);
  assert.equal(JSON.stringify(link).includes('address'), false);
  assert.equal(JSON.stringify(link).includes('coin"'), false);
});

test('one confident asset projects to one, with the coin', () => {
  const link = projectCoins(candidates(1, true));
  assert.equal(link.kind, 'one');
  assert.equal(link.kind === 'one' ? link.coin.ticker : null, 'TKR0');
});

test('three confident assets project to several, carrying all three', () => {
  const link = projectCoins(candidates(3, true));

  assert.equal(link.kind, 'several');
  assert.equal(link.kind === 'several' ? link.coins.length : 0, 3);
  assert.deepEqual(
    link.kind === 'several' ? link.coins.map((c) => c.ticker) : [],
    ['TKR0', 'TKR1', 'TKR2'],
  );
});

test('a mixed set stands behind only the confident ones', () => {
  const link = projectCoins([...candidates(2, true), ...candidates(4, false)]);
  assert.equal(link.kind, 'several');
  assert.equal(link.kind === 'several' ? link.coins.length : 0, 2);
});

test('a coin with no market says so, and does not say it is worth zero', () => {
  const link = projectCoins([
    {
      coin: coin({ priceUsd: null, marketCapUsd: null, liquidityUsd: null, tradable: false }),
      confident: true,
    },
  ]);
  assert.equal(link.kind, 'one');
  if (link.kind !== 'one') return;

  assert.deepEqual(link.coin.priceUsd, { v: null, why: 'no_market' });
  assert.deepEqual(link.coin.marketCapUsd, { v: null, why: 'no_market' });
  /* Absent on a bonding curve, and absence is not illiquidity — a different word from
     the two above, deliberately. */
  assert.deepEqual(link.coin.liquidityUsd, { v: null, why: 'not_reported' });
  assert.notDeepEqual(link.coin.priceUsd, { v: 0 });
  assert.notDeepEqual(link.coin.liquidityUsd, { v: 0 });
});

test('an unknown mint time stays unknown rather than becoming freshly minted', () => {
  const link = projectCoins([{ coin: coin({ mintedAt: null }), confident: true }]);
  assert.equal(link.kind === 'one' ? link.coin.mintedAt.at : 'missing', null);
  assert.notDeepEqual(link.kind === 'one' ? link.coin.mintedAt : null, { at: OPTIONS.nowMs });
});

/* ── the link itself: spans and coin rows in, the row's button out ─────
   These are the six rows of tools/seed.mjs written as literals, so the acceptance test
   that runs against a real database is checkable here without one. The spans are the
   story's `entitySpan` fingerprints; the coins are what time-first retrieval returned. */

/** A coin as public.asset actually holds one: two observed names, and no market at all. */
function asset(symbol: string | null, name: string | null, mintedAt: number | null = T0 - MIN): CoinFacts {
  return coin({
    coinId: `solana:${symbol ?? name ?? 'unnamed'}`,
    ticker: symbol,
    name,
    address: `addr_${symbol ?? name ?? 'unnamed'}`,
    mintedAt,
    priceUsd: null,
    marketCapUsd: null,
    marketCapBasis: null,
    liquidityUsd: null,
    tradable: false,
  });
}

/** The wire coin's own field list, read off a projected coin so it cannot drift from it. */
const COIN_FIELDS: readonly string[] = Object.keys(projectCoin(coin()));

const SOUP_SPANS = ['throws the soup', 'kitchen goes silent', 'nine second clip'];
const SOUP_COINS: readonly CoinFacts[] = [
  asset('SOUP', 'soup'),
  asset('SOUPGATE', 'soup gate'),
  asset('HOTSOUP', 'hot soup'),
  asset('SOUPCHEF', 'soup chef'),
  asset('THESOUP', 'the soup'),
  asset('LADLE', 'silent kitchen'),
];

test('a story that shares no word with any coin in its window links to nothing', () => {
  /* st_pigeon. Its window contains another story's CHILL, minted two minutes ago, and a
     coin with no mint time at all — both of which a time-only rule would attach here and
     offer to a user as this story's coin. Neither shares a word with either span. */
  const link = deriveCoinLink(
    ['bus pigeon', 'pigeon commute'],
    [asset('CHILL', 'chill', T0 - 2 * MIN), asset('LADLE', 'silent kitchen'), asset('SLIDE', 'roof slide', null)],
  );
  assert.deepEqual(link, { kind: 'none' });
});

test('one coin whose name IS a span is the one coin we name', () => {
  /* st_ferry. DOCK matches on both channels — its symbol equals the span 'dock' and its
     name equals 'refuses to dock' — and the soup coin in the same window matches neither. */
  const link = deriveCoinLink(
    ['refuses to dock', 'dock'],
    [asset('DOCK', 'refuses to dock'), asset('SOUP', 'soup')],
  );
  assert.equal(link.kind, 'one');
  assert.equal(link.kind === 'one' ? link.coin.ticker : null, 'DOCK');
  assert.equal(link.kind === 'one' ? link.coin.name : null, 'refuses to dock');
});

test('three coins that each equal a span are all named, and all three are carried', () => {
  /* st_chillguy. One meme, three tokens: two share a symbol, and the third's mint time was
     never learned — which costs it a Buy affordance elsewhere, not its place in the
     comparison. Excluding it here would silently delete a coin a user is choosing between. */
  const link = deriveCoinLink(
    ['just a chill guy', 'chill', 'chillguy'],
    [
      asset('CHILLGUY', 'Just a chill guy', T0 - 22 * MIN),
      asset('CHILL', 'chill', T0 - 9 * MIN),
      asset('CHILLGUY', 'chill guy (official)', null),
    ],
  );

  assert.equal(link.kind, 'several');
  assert.equal(link.kind === 'several' ? link.coins.length : 0, 3);
  assert.deepEqual(
    link.kind === 'several' ? link.coins.map((c) => c.name) : [],
    ['Just a chill guy', 'chill', 'chill guy (official)'],
  );
});

test('★ six coins that merely mention the story name none of them, and carry no coin', () => {
  /* st_soup, the case the whole union exists for. Every one of the six overlaps a span and
     not one of them IS a span, so there are six claims and no answer. If this ever projects
     to `one` or `several`, the equality test has become an overlap test and the row is
     confidently offering the wrong one of six coins. */
  const link = deriveCoinLink(SOUP_SPANS, SOUP_COINS);

  assert.deepEqual(link, { kind: 'unsure', claimCount: 6 });

  /* The assertion that matters more than the tag: no coin is REACHABLE. Not under another
     key, not nested, not one the current UI happens to ignore — a coin in this payload is
     one prop-drill away from a buy panel, however the UI is later rewritten. */
  const found = { keys: [] as string[], strings: [] as string[] };
  walk(link, found);
  for (const key of found.keys) {
    assert.equal(COIN_FIELDS.includes(key), false, `a coin field reached the unsure branch: ${key}`);
  }
  assert.deepEqual(found.keys.sort(), ['claimCount', 'kind']);
  for (const coinField of COIN_FIELDS) {
    assert.equal(JSON.stringify(link).includes(coinField), false);
  }
});

test('★ overlapping a span is being in the running, never being named', () => {
  /* The single rule the previous behaviour got wrong. "soup" is inside "throws the soup",
     and a coin called SOUP is therefore worth considering — but 306 tokens can share that
     ticker and "worth considering" is not "this is the one". */
  const [candidate, ...rest] = coinCandidates(['throws the soup'], [asset('SOUP', 'soup')]);

  assert.equal(rest.length, 0);
  assert.notEqual(candidate, undefined);
  assert.equal(candidate?.confident, false);
  assert.equal(candidate?.coin.ticker, 'SOUP');
});

test('one normalisation, so the two halves cannot disagree about the same words', () => {
  /* Case, punctuation and spacing are all the same word to both tests. What is NOT the same
     word is a name with its spaces removed: 'soupgate' is one token and shares nothing with
     'throws the soup', which is why that coin is in the running through its NAME ('soup
     gate') and would not be in it at all through its symbol alone. */
  assert.equal(normalise('  Refuses To DOCK!! '), 'refuses to dock');
  assert.equal(normalise('chill-guy (official)'), 'chill guy official');
  assert.equal(normalise('💀'), '');

  assert.equal(coinCandidates(['throws the soup'], [asset('SOUPGATE', null)]).length, 0);
  assert.equal(coinCandidates(['throws the soup'], [asset('SOUPGATE', 'soup gate')]).length, 1);
});

test('a named coin with no mint time projects the absence, not a time we invented', () => {
  /* Mint time is the axis every ordering claim hangs on. Backfilled from first-seen — the
     only other time we hold — a post that came AFTER the mint reads as having come before,
     which inverts the one claim the product is making. */
  const link = deriveCoinLink(['roof slide'], [asset('SLIDE', 'roof slide', null)]);

  assert.equal(link.kind, 'one');
  assert.deepEqual(link.kind === 'one' ? link.coin.mintedAt : null, {
    at: null,
    why: 'not_read_yet',
  });
  assert.notDeepEqual(link.kind === 'one' ? link.coin.mintedAt : null, { at: OPTIONS.nowMs });
});

test('a derived coin has no market, and says so rather than saying zero', () => {
  /* public.asset has no price, market-cap or liquidity column — those are readings taken
     from a market, not properties of a coin, and nothing writes them yet. A zero here reads
     as "worthless" on a coin whose actual state is "nobody has traded it", which are
     opposite claims. `tradable` is false because tradability is decided by getting a quote
     and there is nothing to quote against. */
  const link = deriveCoinLink(['roof slide'], [asset('SLIDE', 'roof slide')]);
  assert.equal(link.kind, 'one');
  if (link.kind !== 'one') return;

  assert.deepEqual(link.coin.priceUsd, { v: null, why: 'no_market' });
  assert.deepEqual(link.coin.marketCapUsd, { v: null, why: 'no_market' });
  assert.deepEqual(link.coin.liquidityUsd, { v: null, why: 'not_reported' });
  assert.equal(link.coin.marketCapBasis, null);
  assert.equal(link.coin.tradable, false);

  assert.notDeepEqual(link.coin.priceUsd, { v: 0 });
  assert.notDeepEqual(link.coin.marketCapUsd, { v: 0 });
  assert.notDeepEqual(link.coin.liquidityUsd, { v: 0 });
});

test('a story with no spans links to nothing, whatever was minted in its window', () => {
  /* Not a degenerate case to paper over with a time-only fallback: a story we hold no
     phrase for is a story we cannot say a coin is named after. */
  assert.deepEqual(deriveCoinLink([], SOUP_COINS), { kind: 'none' });
  assert.deepEqual(deriveCoinLink(['   '], SOUP_COINS), { kind: 'none' });
});

/* ── words ────────────────────────────────────────────────────────────── */

test('the summary is exactly two lines of plain English', () => {
  const summary = projectSummary(story(), { kind: 'none' });

  assert.equal(summary.length, 2);
  assert.deepEqual(summary, [
    '12 posts from 9 accounts, across 2 sources.',
    'Nothing has been minted from this yet.',
  ]);
});

test('the summary counts in English, singular and plural', () => {
  const [spread] = projectSummary(
    story({ memberCount: 1, distinctAuthors: 1, distinctSources: 1 }),
    { kind: 'none' },
  );
  assert.equal(spread, '1 post from 1 account, across 1 source.');
});

test('the unsure summary says the count and refuses to pick', () => {
  const [, coins] = projectSummary(story(), projectCoins(candidates(6, false)));
  assert.equal(coins, '6 coins use this, and none of them is clearly the one.');
});

test('a story with no title and nothing to quote is not projected at all', () => {
  const nameless = story({ displayTitle: null, members: [member({ excerpt: '   ' })] });
  assert.equal(projectBoardRow(nameless, OPTIONS), null);
  assert.equal(projectStory(nameless, OPTIONS), null);
});

test('a story with no title falls back to quoting its earliest post, not to a placeholder', () => {
  const row = projectBoardRow(story({ displayTitle: null }), OPTIONS);
  assert.equal(row?.title, 'he has been sat out there for three hours now and he is not moving');
});

test('every relation is a sentence and none of them is a number', () => {
  const relations = [
    relationText({ kind: 'seed' }),
    relationText({ kind: 'carrier', carrier: 'imageHash' }),
    relationText({ kind: 'carrier', carrier: 'textShingle' }),
    relationText({ kind: 'carrier', carrier: 'formatId' }),
    relationText({ kind: 'carrier', carrier: 'entitySpan' }),
    relationText({ kind: 'lineage', via: 'reproduction' }),
    relationText({ kind: 'lineage', via: 'rebroadcast' }),
    relationText({ kind: 'representation' }),
    relationText({ kind: 'adjudicated' }),
  ];
  for (const text of relations) {
    assert.equal(text.trim().length > 0, true);
    assert.equal(/\d/.test(text), false, `"${text}" contains a digit`);
  }
});

/* ── evidence ─────────────────────────────────────────────────────────── */

test('a member with no link is dropped rather than cited without one', () => {
  const page = projectStory(story({ members: [member({ permalink: null })] }), OPTIONS);
  assert.deepEqual(page?.evidence, []);
});

test('a member with a link becomes checkable evidence', () => {
  const page = projectStory(
    story({ members: [member({ permalink: 'https://example.com/p/1' })] }),
    OPTIONS,
  );
  const first = page?.evidence[0];
  assert.equal(first?.permalink, 'https://example.com/p/1');
  assert.equal(first?.relation, 'The earliest post we found with this in it.');
  assert.deepEqual(first?.postedAt, { at: T0 - 3 * HOUR });
});

/* ── representative series ────────────────────────────────────────────── */

test('the story reads from its most-read post rather than a sum across posts', () => {
  const small = member({ itemId: 'it_small', reach: [measuredAt(T0 - 2 * MIN, 1_000, 10)] });
  const large = member({ itemId: 'it_large', reach: [measuredAt(T0 - 2 * MIN, 90_000, 900)] });

  assert.deepEqual(representativeReach([small, large]), large.reach);
  /* And the story's reach is that post's level — not 91_000, which would be a series
     nobody read. */
  assert.deepEqual(projectReach(representativeReach([small, large])), { v: 90_000 });
});

test('with nothing readable anywhere the longest series is still shown', () => {
  const a = member({ itemId: 'it_a', reach: [censoredAt(T0 - 2 * MIN, 'no_prior', null)] });
  const b = member({
    itemId: 'it_b',
    reach: [censoredAt(T0 - 4 * MIN, 'no_prior', null), censoredAt(T0 - 2 * MIN, 'below_step', null)],
  });
  assert.equal(representativeReach([a, b]).length, 2);
});

/* ── ordering ─────────────────────────────────────────────────────────── */

test('the placeholder ordering is recency, and it is stable on a tie', () => {
  const rows = [
    { storyId: 'st_b', lastMemberAt: T0 - 5 * MIN },
    { storyId: 'st_a', lastMemberAt: T0 - 5 * MIN },
    { storyId: 'st_c', lastMemberAt: T0 - MIN },
  ];
  assert.deepEqual(
    orderByRecency(rows).map((r) => r.storyId),
    ['st_c', 'st_a', 'st_b'],
  );
  /* Twice, in a different input order, because a board that reshuffles between ticks
     with nothing having changed renders a shuffle as news. */
  assert.deepEqual(
    orderByRecency([...rows].reverse()).map((r) => r.storyId),
    ['st_c', 'st_a', 'st_b'],
  );
});

/* ── the censor ───────────────────────────────────────────────────────── */

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

test('a projected board row carries no forbidden key and no forbidden substring', () => {
  const row = projectBoardRow(
    story({
      coins: candidates(6, false),
      members: [member({ permalink: 'https://example.com/p/1' })],
    }),
    OPTIONS,
  );
  assert.notEqual(row, null);

  const found = { keys: [] as string[], strings: [] as string[] };
  walk(row, found);

  for (const key of found.keys) {
    assert.equal(
      FORBIDDEN_KEYS.includes(key.toLowerCase()),
      false,
      `forbidden key on the wire: ${key}`,
    );
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

test('the row carries exactly the ten public fields and no eleventh', () => {
  const row = projectBoardRow(story(), OPTIONS);
  assert.deepEqual(Object.keys(row ?? {}).sort(), [
    'coins',
    'firstSeenAt',
    'id',
    'isNew',
    'momentum',
    'reach',
    'spark',
    'summary',
    'thumbUrl',
    'title',
  ]);
});

test('the story page is the row minus isNew, plus the change, the evidence and the discussion', () => {
  const page = projectStory(story(), OPTIONS);
  assert.deepEqual(Object.keys(page ?? {}).sort(), [
    'coins',
    'discussion',
    'evidence',
    'firstSeenAt',
    'id',
    'momentum',
    'reach',
    'reachDelta24h',
    'spark',
    'summary',
    'thumbUrl',
    'title',
  ]);
});

test('a vendor name inside free text stops the story being published', () => {
  /* The likeliest leak is not a key somebody added, it is a word inside text a person
     typed. Failing here means one story does not get projected; not failing here means
     the whole board tick dies in a browser, after the value has already been served. */
  const leaky = story({ displayTitle: 'Everything is fine, says dexscreener' });
  assert.throws(() => projectBoardRow(leaky, OPTIONS), WireLeakError);
  assert.throws(() => projectStory(leaky, OPTIONS), WireLeakError);
});

test('★ one leaky story costs one row, not the whole frame', () => {
  /* The whole projection runs inside a single transaction. If projectBoard let a
     WireLeakError escape, this input would roll the frame back, freeze the board at the
     last tick, and exit the projector non-zero on every run until the story aged out of
     the 48-hour window. A vendor name inside a quoted post body is ordinary vocabulary
     on a feed about crypto memes, so this is the expected case and not the exotic one. */
  const board = projectBoard(
    [
      story({ storyId: 'st_ok_a', lastMemberAt: T0 - MIN }),
      story({ storyId: 'st_leak', displayTitle: 'ser check the dexscreener chart', lastMemberAt: T0 - 2 * MIN }),
      story({ storyId: 'st_ok_b', lastMemberAt: T0 - 3 * MIN }),
    ],
    OPTIONS,
  );

  assert.deepEqual(board.order, ['st_ok_a', 'st_ok_b']);
  assert.deepEqual(board.withheld, ['st_leak']);
  /* order and rows are built in the same pass, so a withheld story leaves neither an id
     pointing at nothing nor a row nothing points at. */
  assert.deepEqual(board.rows.map((r) => r.id), [...board.order]);
});

test('a failure that is not a leak still takes the run down', () => {
  /* Swallowing everything would turn a broken projection into a quietly short board.
     Only the leak is recoverable, because only the leak is one story's problem. */
  const exploding: StoryFacts = {
    ...story(),
    get members(): readonly MemberFacts[] {
      throw new TypeError('the projection is broken');
    },
  };
  assert.throws(() => projectBoard([exploding], OPTIONS), TypeError);
});

test('isNew is an arrival on the board and nothing else', () => {
  assert.equal(projectBoardRow(story({ wasOnPreviousBoard: true }), OPTIONS)?.isNew, false);
  assert.equal(projectBoardRow(story({ wasOnPreviousBoard: false }), OPTIONS)?.isNew, true);
});

/* ── evidence, and the link that is what makes it evidence ────────────────
 *
 * Evidence is the only place on the product where a user can check our work, so these
 * tests are about one question asked twice: can this be opened? A link we can build is
 * built exactly, character for character — a wrong path still typechecks and still
 * renders. A link we cannot build is not approximated, and the member goes with it.
 *
 * The failing direction is asserted more heavily than the succeeding one on purpose. A
 * missing citation is a hole somebody notices; a citation that 404s teaches the one user
 * who bothered to click that we make things up, and one working link later does not
 * undo that.
 */

/** The handles as public.author actually stores them — sigil included, per the seed. */
const X_HANDLE = '@localferrywatch';
const TIKTOK_HANDLE = '@boatsofinstagram';

test('a known source, a handle and the source’s own id build the link exactly', () => {
  assert.equal(
    permalinkFor('x', X_HANDLE, '1770000000000000002'),
    'https://x.com/localferrywatch/status/1770000000000000002',
  );
  assert.equal(
    permalinkFor('tiktok', TIKTOK_HANDLE, '7460000000000000003'),
    'https://www.tiktok.com/@boatsofinstagram/video/7460000000000000003',
  );
});

test('the stored sigil is stripped once, here, and never doubled into the path', () => {
  /* public.author.handle holds the handle as it is DISPLAYED, and whether that includes
     an '@' is a property of the row rather than of the platform. A handle passed through
     unstripped produces `x.com/@name/status/1`, which is a 404 that looks like a link. */
  assert.equal(permalinkFor('x', 'localferrywatch', '1'), 'https://x.com/localferrywatch/status/1');
  assert.equal(permalinkFor('x', '  @localferrywatch  ', '1'), 'https://x.com/localferrywatch/status/1');
});

test('★ an unknown source yields no link, and the member is dropped rather than shown broken', () => {
  /* reddit is in the seed and has no adapter package, so there is nothing that knows its
     URL shape. The answer is no link — not a guessed path, not a home page, not a search.
     A generic fallback host would put a citation on screen that goes nowhere. */
  assert.equal(permalinkFor('reddit', 'dancing_gran', 't3_1a2b3c'), null);
  assert.equal(permalinkFor('somethingnew', '@someone', '1'), null);

  const dropped = member({ itemId: 'it_reddit', permalink: permalinkFor('reddit', 'dancing_gran', 't3_1a2b3c') });
  assert.deepEqual(projectEvidence([dropped]), []);
  /* And the story page still projects — an unlinkable member costs its own row and
     nothing else. */
  const page = projectStory(story({ members: [dropped] }), OPTIONS);
  assert.deepEqual(page?.evidence, []);
});

test('★ a member with no handle is dropped, because there is no path to put it in', () => {
  for (const handle of [null, '', '   ', '@']) {
    assert.equal(permalinkFor('x', handle, '1770000000000000002'), null, `handle ${String(handle)}`);
  }
  /* Symmetrically for the id: half an address is not an address. */
  assert.equal(permalinkFor('x', X_HANDLE, null), null);
  assert.equal(permalinkFor('x', X_HANDLE, ''), null);

  const anonymous = member({ itemId: 'it_nohandle', permalink: permalinkFor('x', null, '17') });
  assert.deepEqual(projectEvidence([anonymous]), []);
});

test('★ a source that is only a property of Object yields no link', () => {
  /* `source` is a database column, and an object literal answers for its prototype as
     well as its own keys. Indexed as one, `toString` returned a FUNCTION rather than
     undefined and the citation became the string `[object Undefined]` — a relative
     href, so "open" resolved against our own origin — while `valueOf` threw inside the
     projection and took the entire frame with it. These are unknown sources and the
     only correct answer for an unknown source is null. */
  for (const source of ['toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf', '__proto__']) {
    assert.equal(permalinkFor(source, X_HANDLE, '1'), null, `source ${source}`);
  }
});

test('★ a handle that would change which URL this is yields no link', () => {
  /* public.author.handle is unconstrained text holding whatever a vendor called the
     account, so these are inputs and not impossibilities. The first one is the reason
     this test exists: it built `https://x.com/victim/status/1770000000000000009?/status/1`,
     which the platform serves as a REAL post — a citation that opens cleanly, looks
     checked, and points at somebody else's post. */
  const hostile = [
    'victim/status/1770000000000000009?',
    '../../login',
    'a?next=https://evil.example',
    'a#@evil.example',
    'a\\..\\..\\b',
    'a%2f..%2fb',
    'good bad',
    'a\nb',
    '@ spaced',
    'аpple', // a Cyrillic а: a different account that reads as the same one
  ];
  for (const handle of hostile) {
    assert.equal(permalinkFor('x', handle, '1'), null, `handle ${JSON.stringify(handle)}`);
    assert.equal(permalinkFor('tiktok', handle, '1'), null, `handle ${JSON.stringify(handle)}`);
  }
  /* And symmetrically for the id, which is spliced into the same path. */
  for (const id of ['1?x=', '1/../../evil', '1 2', '1#frag']) {
    assert.equal(permalinkFor('x', X_HANDLE, id), null, `id ${JSON.stringify(id)}`);
  }
  /* The handles that really do occur still build, unescaped and unchanged. A guard
     that quietly broke ordinary handles would be a worse bug than the one it fixes. */
  assert.equal(permalinkFor('x', 'dancing_gran', '1'), 'https://x.com/dancing_gran/status/1');
  assert.equal(permalinkFor('tiktok', '@a.b_c-d', '7'), 'https://www.tiktok.com/@a.b_c-d/video/7');
});

test('★ evidence carries an absolute https link or no row at all', () => {
  /* Evidence.tsx puts this string in an anchor's href, where the scheme is executable
     rather than decorative. permalinkFor cannot emit any of these today; this is the
     gate that keeps that true of every builder anyone writes later. */
  for (const permalink of [
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/status/1',
    'http://x.com/a/status/1',
    'x.com/a/status/1',
    '[object Undefined]',
  ]) {
    assert.deepEqual(projectEvidence([member({ permalink })]), [], `permalink ${permalink}`);
  }
});

test('a mixed list keeps exactly the members that can be opened', () => {
  /* The list gets SHORTER and stays true, rather than staying long and going weak. */
  const evidence = projectEvidence([
    member({ itemId: 'it_x', permalink: permalinkFor('x', X_HANDLE, '1') }),
    member({ itemId: 'it_reddit', permalink: permalinkFor('reddit', 'dancing_gran', 't3_1a2b3c') }),
    member({ itemId: 'it_tiktok', permalink: permalinkFor('tiktok', TIKTOK_HANDLE, '7460000000000000003') }),
    member({ itemId: 'it_nohandle', permalink: permalinkFor('x', null, '2') }),
  ]);
  assert.deepEqual(evidence.map((e) => e.evidenceId), ['it_x', 'it_tiktok']);
});

test('a surviving evidence entry carries the eight fields the wire requires, and no ninth', () => {
  const entry = projectEvidence([
    member({
      itemId: 'it_ferry_1',
      sourceLabel: 'X',
      authorLabel: X_HANDLE,
      thumbUrl: '',
      permalink: permalinkFor('x', X_HANDLE, '1'),
      relation: { kind: 'carrier', carrier: 'imageHash' },
    }),
  ])[0];
  assert.notEqual(entry, undefined);

  assert.deepEqual(Object.keys(entry ?? {}).sort(), [
    'authorLabel',
    'evidenceId',
    'excerpt',
    'permalink',
    'postedAt',
    'relation',
    'sourceLabel',
    'thumbUrl',
  ]);
  assert.equal(entry?.permalink, 'https://x.com/localferrywatch/status/1');
  /* The relation is a sentence, never a number and never a tier name. */
  assert.equal(entry?.relation, 'Uses the same picture.');
  /* An empty thumbnail is null and not '', so no component renders a broken image. */
  assert.equal(entry?.thumbUrl, null);
  /* An unknown post time stays unknown; it does not become the epoch or now. */
  assert.deepEqual(projectEvidence([member({ postedAt: null, permalink: 'https://x.com/a/status/1' })])[0]?.postedAt, {
    at: null,
    why: 'not_reported',
  });
});

test('a story page whose evidence is populated still carries no forbidden key or substring', () => {
  /* The link is the newest string on this payload and it is built from a platform's own
     host name, so it is exactly the kind of value that trips the censor. Walked at every
     depth, keys and string values alike — the same check the projector runs before it
     stores anything. */
  const page = projectStory(
    story({
      members: [
        member({ itemId: 'it_x', permalink: permalinkFor('x', X_HANDLE, '1') }),
        member({ itemId: 'it_tk', permalink: permalinkFor('tiktok', TIKTOK_HANDLE, '746') }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(page?.evidence.length, 2);

  const found = { keys: [] as string[], strings: [] as string[] };
  walk(page, found);

  for (const key of found.keys) {
    assert.equal(FORBIDDEN_KEYS.includes(key.toLowerCase()), false, `forbidden key on the wire: ${key}`);
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
