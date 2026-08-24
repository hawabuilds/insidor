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
import type { StoryOrigin } from '@insidor/contracts/story.ts';

/**
 * What a story page says about itself when it is a real one. Every projectStory test below
 * is about titles, censoring, coins or evidence rather than about provenance, so they all
 * use the branch the app renders nothing for — a fixture announcing itself seeded would put
 * a claim into assertions that are not checking it. The provenance branches have their own
 * tests at the end of this file.
 */
const OBSERVED_STORY = { kind: 'observed' } as const;

import { coinCandidates, deriveCoinLink, NO_CORPUS, normalise } from './coins.ts';
import { orderByRecency } from './order.ts';
import { permalinkFor } from './permalinks.ts';
import {
  projectBoard,
  projectBoardProvenance,
  projectStoryProvenance,
  projectBoardRow,
  projectCoin,
  projectCoins,
  projectEvidence,
  projectFirstSeenAt,
  projectLaunch,
  projectMarketCap,
  projectMomentum,
  projectPriceChange24h,
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
  CoinMarket,
  LaunchFacts,
  MarketNumber,
  MemberFacts,
  ProjectOptions,
  ReachReading,
  StoryFacts,
} from './project.ts';
import { FORBIDDEN_KEYS, FORBIDDEN_SUBSTRINGS, WireLeakError } from './wire.ts';
import type { PendingReason } from './wire.ts';

const T0 = 1_755_079_200_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

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

/** A number the venue gave us. */
const got = (amount: number): MarketNumber => ({ known: true, amount });

/** A number it did not, with the venue's own reason. Never a zero. */
const none = (why: PendingReason): MarketNumber => ({ known: false, why });

/**
 * A fresh reading, priced, on a curve — so no reserve to report and a real price beside
 * the absence. The default is deliberately the shape most of this product's coins are in.
 */
function market(overrides: Partial<CoinMarket> = {}): CoinMarket {
  return {
    takenAt: T0 - MIN,
    priceUsd: got(0.000_186),
    marketCapUsd: got(186_400),
    marketCapBasis: 'fully-diluted',
    liquidityUsd: none('not_reported'),
    priceChange24h: got(23.6),
    tradable: true,
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
    market: market(),
    ...overrides,
  };
}

/** A coin whose reading differs from the default in the ways named. */
const priced = (overrides: Partial<CoinMarket>, facts: Partial<CoinFacts> = {}): CoinFacts =>
  coin({ market: market(overrides), ...facts });

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
  assert.deepEqual(projectCoins([], OPTIONS), { kind: 'none' });
});

test('six assets, none of them confident, projects to unsure carrying NO coin', () => {
  const link = projectCoins(candidates(6, false), OPTIONS);

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
  const link = projectCoins(candidates(1, true), OPTIONS);
  assert.equal(link.kind, 'one');
  assert.equal(link.kind === 'one' ? link.coin.ticker : null, 'TKR0');
});

test('three confident assets project to several, carrying all three', () => {
  const link = projectCoins(candidates(3, true), OPTIONS);

  assert.equal(link.kind, 'several');
  assert.equal(link.kind === 'several' ? link.coins.length : 0, 3);
  assert.deepEqual(
    link.kind === 'several' ? link.coins.map((c) => c.ticker) : [],
    ['TKR0', 'TKR1', 'TKR2'],
  );
});

test('a mixed set stands behind only the confident ones', () => {
  const link = projectCoins([...candidates(2, true), ...candidates(4, false)], OPTIONS);
  assert.equal(link.kind, 'several');
  assert.equal(link.kind === 'several' ? link.coins.length : 0, 2);
});

test('a coin with no market says so, and does not say it is worth zero', () => {
  const link = projectCoins(
    [
      {
        coin: priced({
          priceUsd: none('no_market'),
          marketCapUsd: none('no_market'),
          marketCapBasis: null,
          liquidityUsd: none('not_reported'),
          priceChange24h: none('no_market'),
          tradable: false,
        }),
        confident: true,
      },
    ],
    OPTIONS,
  );
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
  const link = projectCoins([{ coin: coin({ mintedAt: null }), confident: true }], OPTIONS);
  assert.equal(link.kind === 'one' ? link.coin.mintedAt.at : 'missing', null);
  assert.notDeepEqual(link.kind === 'one' ? link.coin.mintedAt : null, { at: OPTIONS.nowMs });
});

/* ── the row's market cap: a property of a coin, borrowed by a story ──────
   Four branches, four different facts, and the two that must not carry a number are the
   two where a number is easiest to produce. The `notDeepEqual` lines are not padding: a
   sum and a max are both single lines of code away, and both typecheck. */

test('one settled coin lends the row its market cap, unchanged', () => {
  const link = projectCoins([{ coin: priced({ marketCapUsd: got(186_400) }), confident: true }], OPTIONS);
  assert.deepEqual(projectMarketCap(link), { v: 186_400 });
});

test('one settled coin with no market lends the row that absence, not a zero', () => {
  /* The coin's own honest state travels through untouched. "Minted, nobody has traded it"
     is a different claim from "worth nothing", and this is the branch where confusing them
     would be most expensive: the row has a Buy button on it. */
  const link = projectCoins(
    [{ coin: priced({ marketCapUsd: none('no_market'), marketCapBasis: null }), confident: true }],
    OPTIONS,
  );
  assert.deepEqual(projectMarketCap(link), { v: null, why: 'no_market' });
  assert.notDeepEqual(projectMarketCap(link), { v: 0 });
});

test('nothing minted has no market to have a cap in, and says not_minted', () => {
  assert.deepEqual(projectMarketCap({ kind: 'none' }), { v: null, why: 'not_minted' });
  assert.notDeepEqual(projectMarketCap({ kind: 'none' }), { v: 0 });
});

test('★ an unsure story shows no cap, because there is no coin to take one from', () => {
  /* The branch carries no coin at all, so this is not a refusal the projector has to
     remember to make — there is nothing here to read. The reason must not be `not_minted`:
     six coins do exist, and the row's own summary says so one cell away. */
  const link = projectCoins(candidates(6, false), OPTIONS);
  assert.equal(link.kind, 'unsure');
  assert.deepEqual(projectMarketCap(link), { v: null, why: 'not_reported' });
  assert.notDeepEqual(projectMarketCap(link), { v: null, why: 'not_minted' });
});

test('★ several coins show NO cap: not the sum, not the largest, not the first', () => {
  /* The one test worth reading twice. Each of the three tempting answers is written out
     as a literal so that an implementation which produces it fails here by name rather
     than by a mysterious number.

       sum     — 111,000: a market cap for a security nobody can hold.
       largest — 90,000:  picking which coin is the real one, presented as a measurement.
       first   — 1,000:   the same pick, made by the query planner instead of by us. */
  const link = projectCoins(
    [
      { coin: priced({ marketCapUsd: got(1_000) }, { coinId: 'c_a', ticker: 'AAA' }), confident: true },
      { coin: priced({ marketCapUsd: got(90_000) }, { coinId: 'c_b', ticker: 'BBB' }), confident: true },
      { coin: priced({ marketCapUsd: got(20_000) }, { coinId: 'c_c', ticker: 'CCC' }), confident: true },
    ],
    OPTIONS,
  );
  assert.equal(link.kind, 'several');

  const cap = projectMarketCap(link);
  assert.deepEqual(cap, { v: null, why: 'not_reported' });
  assert.notDeepEqual(cap, { v: 111_000 }, 'the sum is a number that is true of nothing');
  assert.notDeepEqual(cap, { v: 90_000 }, 'the largest is a choice dressed as a fact');
  assert.notDeepEqual(cap, { v: 1_000 }, 'the first is the planner making the choice');
  assert.notDeepEqual(cap, { v: 0 });
});

test('the four branches do not all give the same absence', () => {
  /* If a refactor ever collapses these onto one reason, the column stops distinguishing
     "nothing was minted" from "we will not pick", which is the entire content of it. */
  const reasons = [
    projectMarketCap({ kind: 'none' }),
    projectMarketCap(projectCoins(candidates(6, false), OPTIONS)),
    projectMarketCap(
      projectCoins(
        [{ coin: priced({ marketCapUsd: none('no_market'), marketCapBasis: null }), confident: true }],
        OPTIONS,
      ),
    ),
  ].map((m) => ('why' in m ? m.why : 'present'));
  assert.deepEqual(reasons, ['not_minted', 'not_reported', 'no_market']);
  assert.equal(new Set(reasons).size, 3);
});

test('the row takes its cap from the same coins value it publishes', () => {
  /* Derived once and read twice would let the cap and the button disagree about how many
     coins the story has — a Buy button beside a dash, or a cap beside "6 coins claim
     this". They come from one value on purpose. */
  const several = projectBoardRow(story({ coins: candidates(3, true) }), OPTIONS);
  assert.equal(several?.coins.kind, 'several');
  assert.deepEqual(several?.marketCapUsd, { v: null, why: 'not_reported' });

  const named = projectBoardRow(
    story({ coins: [{ coin: priced({ marketCapUsd: got(186_400) }), confident: true }] }),
    OPTIONS,
  );
  assert.equal(named?.coins.kind, 'one');
  assert.deepEqual(named?.marketCapUsd, { v: 186_400 });

  const bare = projectBoardRow(story({ coins: [] }), OPTIONS);
  assert.equal(bare?.coins.kind, 'none');
  assert.deepEqual(bare?.marketCapUsd, { v: null, why: 'not_minted' });
});

/* ── the market reading: absent, partial, and STALE ────────────────────
   Four states a coin's market can be in, and the projection has to keep them apart:
   no reading at all, a reading with holes in it, a reading that is too old to be true
   any more, and a reading we stand behind. The third is the one with no visible symptom
   — a stale number renders exactly like a live one — which is why it gets the most
   assertions here. */

test('★ a reading older than the freshness window is not published as the current market', () => {
  /* One second past the window, and the numbers are real ones we genuinely read. They
     still go, whole. On a product whose measured post-to-mint lag is under four minutes,
     a coin can be minted, run and peak inside one window — so an hour-old price is not a
     slightly-late price, it is a different story about the same coin, on a row with a
     Buy button. */
  const stale = priced({ takenAt: T0 - FRESHNESS - 1_000 });
  const wire = projectCoin(stale, OPTIONS);

  for (const field of [wire.priceUsd, wire.marketCapUsd, wire.liquidityUsd, wire.priceChange24h]) {
    assert.deepEqual(field, { v: null, why: 'not_read_yet' });
    assert.notDeepEqual(field, { v: 0 });
  }
  /* The number we are refusing to show is 186,400 and it is right there in the facts.
     Named as a literal so an implementation that leaks it fails here by name. */
  assert.notDeepEqual(wire.marketCapUsd, { v: 186_400 });
  assert.notDeepEqual(wire.priceUsd, { v: 0.000_186 });
  assert.equal(wire.marketCapBasis, null, 'a basis outlived the cap it describes');
  /* ★ AND THE QUOTE GOES WITH IT. `tradable` is a claim that a venue will fill an order
     RIGHT NOW; a quote taken an hour ago is not evidence about now, and leaving this
     true would put a Buy button behind figures the row has already withdrawn. */
  assert.equal(wire.tradable, false);
});

test('a reading inside the window is published whole, so the gate is a gate and not a wall', () => {
  const fresh = projectCoin(priced({ takenAt: T0 - FRESHNESS + 1_000 }), OPTIONS);
  assert.deepEqual(fresh.priceUsd, { v: 0.000_186 });
  assert.deepEqual(fresh.marketCapUsd, { v: 186_400 });
  assert.deepEqual(fresh.priceChange24h, { v: 23.6 });
  assert.equal(fresh.marketCapBasis, 'fully-diluted');
  assert.equal(fresh.tradable, true);
});

test('the freshness window is read from the options, not typed into the projection', () => {
  /* The same facts, two policies. If this ever stops depending on the option, a threshold
     has been written into the projection where nobody can answer what a board was judged
     against last month. */
  const facts = priced({ takenAt: T0 - 30 * MIN });
  assert.deepEqual(projectCoin(facts, OPTIONS).priceUsd, { v: null, why: 'not_read_yet' });
  assert.deepEqual(projectCoin(facts, { ...OPTIONS, marketFreshnessMs: HOUR }).priceUsd, {
    v: 0.000_186,
  });
});

test('a reading with liquidity and no price keeps both facts, and invents neither', () => {
  /* A drained pool: the reserve is a real, measured zero and there is no price because
     nothing has traded through it. Two different absences and one real zero on one coin
     — a shape a single `number | null` per field could not carry, and the reason the
     reasons are stored beside the numbers rather than re-guessed here. */
  const wire = projectCoin(
    priced({
      priceUsd: none('no_market'),
      marketCapUsd: none('no_market'),
      marketCapBasis: null,
      liquidityUsd: got(0),
      priceChange24h: none('no_market'),
      tradable: false,
    }),
    OPTIONS,
  );

  assert.deepEqual(wire.liquidityUsd, { v: 0 }, 'a measured zero was turned into an absence');
  assert.deepEqual(wire.priceUsd, { v: null, why: 'no_market' });
  assert.notDeepEqual(wire.priceUsd, { v: 0 });
  assert.equal(wire.marketCapBasis, null);
});

test('★ tradable is false when liquidity is absent — and NOT because liquidity is absent', () => {
  /* Both of these have no liquidity number and both are not tradable, and the two arrive
     at it by completely different routes. contracts/src/asset.ts forbids the shortcut by
     name: "Nothing anywhere may gate on liquidityUsd. The gate is quotability."

     The proof that no such gate exists is the third case below: a curve with NO liquidity
     at all IS tradable, because a venue said it would quote it. A projection that derived
     the flag from the number would fail on that line, which is why it is here. */
  const noReading = projectCoin(coin({ market: null }), OPTIONS);
  assert.equal(noReading.tradable, false);
  assert.deepEqual(noReading.liquidityUsd, { v: null, why: 'not_read_yet' });

  const unquoted = projectCoin(
    priced({ liquidityUsd: none('not_reported'), tradable: false }),
    OPTIONS,
  );
  assert.equal(unquoted.tradable, false);

  const quotedCurve = projectCoin(
    priced({ liquidityUsd: none('not_reported'), tradable: true }),
    OPTIONS,
  );
  assert.equal(
    quotedCurve.tradable,
    true,
    'a curve with no reserve was refused a Buy affordance for having no reserve',
  );
  assert.deepEqual(quotedCurve.liquidityUsd, { v: null, why: 'not_reported' });
});

/* ── the row's 24h move: the same rule as the cap, one column over ────── */

test('one settled coin lends the row its 24h move, unchanged and with its sign', () => {
  const link = projectCoins([{ coin: priced({ priceChange24h: got(-7.9) }), confident: true }], OPTIONS);
  assert.deepEqual(projectPriceChange24h(link), { v: -7.9 });
});

test('★ several coins show NO 24h move: not the mean, not the biggest, not the first', () => {
  /* The three tempting answers, written out as literals so an implementation producing
     one fails here by name rather than by a mysterious number. This is the column a user
     is most likely to trade on, which is what makes it the worst place in the product to
     turn a judgement into arithmetic.

       mean    — +11.3%: the return of a portfolio nobody holds.
       biggest — +48.0%: picking which coin is the real one, wearing a percentage sign.
       first   — +48.0%: the same pick, made by the query planner instead of by us. */
  const link = projectCoins(
    [
      { coin: priced({ priceChange24h: got(48) }, { coinId: 'c_a', ticker: 'AAA' }), confident: true },
      { coin: priced({ priceChange24h: got(-12) }, { coinId: 'c_b', ticker: 'BBB' }), confident: true },
      { coin: priced({ priceChange24h: got(-2) }, { coinId: 'c_c', ticker: 'CCC' }), confident: true },
    ],
    OPTIONS,
  );
  assert.equal(link.kind, 'several');

  const gain = projectPriceChange24h(link);
  assert.deepEqual(gain, { v: null, why: 'not_reported' });
  assert.notDeepEqual(gain, { v: 34 / 3 }, 'the mean is the return of a portfolio nobody holds');
  assert.notDeepEqual(gain, { v: 48 }, 'the biggest is a choice dressed as a fact');
  assert.notDeepEqual(gain, { v: 0 });
});

test('an unsure story shows no 24h move, because there is no coin to take one from', () => {
  const link = projectCoins(candidates(6, false), OPTIONS);
  assert.equal(link.kind, 'unsure');
  assert.deepEqual(projectPriceChange24h(link), { v: null, why: 'not_reported' });
  assert.notDeepEqual(projectPriceChange24h(link), { v: null, why: 'not_minted' });
});

test('nothing minted has no price to have moved, and says not_minted', () => {
  assert.deepEqual(projectPriceChange24h({ kind: 'none' }), { v: null, why: 'not_minted' });
  assert.notDeepEqual(projectPriceChange24h({ kind: 'none' }), { v: 0 });
});

test('the cap and the 24h move agree, on the same row, about how many coins there are', () => {
  /* Both are read off the SAME `coins` value, so a row can never show a cap beside a dash
     for the gain, or the reverse — which would read as one of the two being broken rather
     than as the refusal both of them are. */
  for (const coins of [
    story({ coins: [] }),
    story({ coins: candidates(6, false) }),
    story({ coins: candidates(3, true) }),
    story({ coins: [{ coin: priced({ marketCapUsd: got(186_400), priceChange24h: got(9.1) }), confident: true }] }),
  ]) {
    const row = projectBoardRow(coins, OPTIONS);
    const capAbsent = 'why' in (row?.marketCapUsd ?? {});
    const gainAbsent = 'why' in (row?.priceChange24h ?? {});
    assert.equal(capAbsent, gainAbsent, 'one market cell refused and the other did not');
  }
});

test('a stale reading empties the row as well as the coin', () => {
  /* End to end, because the row's figures are read off the projected coin rather than off
     the facts — so if the staleness gate were applied in only one of the two places, the
     row would keep publishing a number the coin panel had already withdrawn. */
  const row = projectBoardRow(
    story({ coins: [{ coin: priced({ takenAt: T0 - 2 * HOUR }), confident: true }] }),
    OPTIONS,
  );
  assert.equal(row?.coins.kind, 'one');
  assert.deepEqual(row?.marketCapUsd, { v: null, why: 'not_read_yet' });
  assert.deepEqual(row?.priceChange24h, { v: null, why: 'not_read_yet' });
  assert.notDeepEqual(row?.marketCapUsd, { v: 186_400 });
});

test('the story page carries no story-level market cap at all', () => {
  /* The page renders the coins themselves, each with its own cap. A roll-up there would be
     a second spelling of a number already on screen — and a dash beside three real caps. */
  const page = projectStory(story({ coins: candidates(3, true) }), OPTIONS, OBSERVED_STORY);
  assert.equal('marketCapUsd' in (page ?? {}), false);
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
    /* ★ NO READING AT ALL, which is what public.asset alone can tell us and is a
       different fact from a reading that came back empty. Nobody has looked. */
    market: null,
  });
}

/** The wire coin's own field list, read off a projected coin so it cannot drift from it. */
const COIN_FIELDS: readonly string[] = Object.keys(projectCoin(coin(), OPTIONS));

/**
 * ★ EVERY COIN TEST BELOW PASSES `NO_CORPUS`, AND IT IS AN ASSERTION RATHER THAN A STUB.
 *
 * coins.ts drops a story's word from the candidate test once too many coins already carry
 * it. `NO_CORPUS` is that measurement absent — the cold start, an empty store — and these
 * are the rules that must hold with no statistics at all: the soup story still gathers six
 * claimants and names none, the ferry story still names DOCK, the pigeon story still links
 * to nothing. Passing a real corpus here would test the filter; passing none tests that the
 * union underneath it did not move, which is the thing these tests were written for.
 *
 * The filter itself is measured in coins.test.ts, against the 205 assets in public.asset
 * and 33 hand-labelled pairs. If a change makes THAT file fail and this one pass, the
 * frequency ceiling moved. If it makes this one fail, the union moved.
 */
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
    NO_CORPUS,
    OPTIONS,
  );
  assert.deepEqual(link, { kind: 'none' });
});

test('one coin whose name IS a span is the one coin we name', () => {
  /* st_ferry. DOCK matches on both channels — its symbol equals the span 'dock' and its
     name equals 'refuses to dock' — and the soup coin in the same window matches neither. */
  const link = deriveCoinLink(
    ['refuses to dock', 'dock'],
    [asset('DOCK', 'refuses to dock'), asset('SOUP', 'soup')],
    NO_CORPUS,
    OPTIONS,
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
    NO_CORPUS,
    OPTIONS,
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
  const link = deriveCoinLink(SOUP_SPANS, SOUP_COINS, NO_CORPUS, OPTIONS);

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
  const [candidate, ...rest] = coinCandidates(['throws the soup'], [asset('SOUP', 'soup')], NO_CORPUS);

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

  assert.equal(coinCandidates(['throws the soup'], [asset('SOUPGATE', null)], NO_CORPUS).length, 0);
  assert.equal(coinCandidates(['throws the soup'], [asset('SOUPGATE', 'soup gate')], NO_CORPUS).length, 1);
});

test('a named coin with no mint time projects the absence, not a time we invented', () => {
  /* Mint time is the axis every ordering claim hangs on. Backfilled from first-seen — the
     only other time we hold — a post that came AFTER the mint reads as having come before,
     which inverts the one claim the product is making. */
  const link = deriveCoinLink(['roof slide'], [asset('SLIDE', 'roof slide', null)], NO_CORPUS, OPTIONS);

  assert.equal(link.kind, 'one');
  assert.deepEqual(link.kind === 'one' ? link.coin.mintedAt : null, {
    at: null,
    why: 'not_read_yet',
  });
  assert.notDeepEqual(link.kind === 'one' ? link.coin.mintedAt : null, { at: OPTIONS.nowMs });
});

test('a coin nobody has read says NOT READ YET, which is our state and not the market’s', () => {
  /* ★ THE DISTINCTION THIS WHOLE SHAPE EXISTS FOR. public.asset still has no price,
     market-cap or liquidity column — those are readings taken FROM a market, not
     properties OF a coin — so a coin with no row in public.market_reading arrives with
     `market: null`, and the honest thing to say about it is that we have not looked.

     `no_market` would be a claim about the WORLD ("this coin has never traded") made
     out of our own ignorance, and it is a claim a user can act on: it is the row that
     reads as "too early, nobody is in yet". Only a venue that answered may say it. A
     zero would be worse again — "worthless" about a coin nobody has priced. */
  const link = deriveCoinLink(['roof slide'], [asset('SLIDE', 'roof slide')], NO_CORPUS, OPTIONS);
  assert.equal(link.kind, 'one');
  if (link.kind !== 'one') return;

  for (const field of [
    link.coin.priceUsd,
    link.coin.marketCapUsd,
    link.coin.liquidityUsd,
    link.coin.priceChange24h,
  ]) {
    assert.deepEqual(field, { v: null, why: 'not_read_yet' });
    assert.notDeepEqual(field, { v: 0 });
    assert.notDeepEqual(field, { v: null, why: 'no_market' });
  }
  assert.equal(link.coin.marketCapBasis, null);
  /* No reading means no quote, and no quote means no Buy affordance. Not derived from
     any number above it — there are no numbers above it. */
  assert.equal(link.coin.tradable, false);
});

test('a coin the venue answered about keeps the venue’s own reasons', () => {
  /* The other side of the test above: once a reading exists, the reasons stop being ours
     and start being the market's. `no_market` for a price nobody has set, `not_reported`
     for a reserve a curve has no concept of — two different absences on one coin, which
     is exactly the pair a single spelling would destroy. */
  const link = projectCoins(
    [
      {
        coin: priced({
          priceUsd: none('no_market'),
          marketCapUsd: none('no_market'),
          marketCapBasis: null,
          liquidityUsd: none('not_reported'),
          priceChange24h: none('no_market'),
          tradable: false,
        }),
        confident: true,
      },
    ],
    OPTIONS,
  );
  assert.equal(link.kind, 'one');
  if (link.kind !== 'one') return;

  assert.deepEqual(link.coin.priceUsd, { v: null, why: 'no_market' });
  assert.deepEqual(link.coin.liquidityUsd, { v: null, why: 'not_reported' });
  assert.notDeepEqual(link.coin.liquidityUsd, link.coin.priceUsd);
  assert.notDeepEqual(link.coin.priceUsd, { v: 0 });
  assert.notDeepEqual(link.coin.liquidityUsd, { v: 0 });
});

test('a story with no spans links to nothing, whatever was minted in its window', () => {
  /* Not a degenerate case to paper over with a time-only fallback: a story we hold no
     phrase for is a story we cannot say a coin is named after. */
  assert.deepEqual(deriveCoinLink([], SOUP_COINS, NO_CORPUS, OPTIONS), { kind: 'none' });
  assert.deepEqual(deriveCoinLink(['   '], SOUP_COINS, NO_CORPUS, OPTIONS), { kind: 'none' });
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
  const [, coins] = projectSummary(story(), projectCoins(candidates(6, false), OPTIONS));
  assert.equal(coins, '6 coins use this, and none of them is clearly the one.');
});

test('a story with no title and nothing to quote is not projected at all', () => {
  const nameless = story({ displayTitle: null, members: [member({ excerpt: '   ' })] });
  assert.equal(projectBoardRow(nameless, OPTIONS), null);
  assert.equal(projectStory(nameless, OPTIONS, OBSERVED_STORY), null);
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
  const page = projectStory(story({ members: [member({ permalink: null })] }), OPTIONS, OBSERVED_STORY);
  assert.deepEqual(page?.evidence, []);
});

test('a member with a link becomes checkable evidence', () => {
  const page = projectStory(
    story({ members: [member({ permalink: 'https://example.com/p/1' })] }),
    OPTIONS,
    OBSERVED_STORY,
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

test('the row carries exactly the twelve public fields and no thirteenth', () => {
  const row = projectBoardRow(story(), OPTIONS);
  assert.deepEqual(Object.keys(row ?? {}).sort(), [
    'coins',
    'firstSeenAt',
    'id',
    'isNew',
    'marketCapUsd',
    'momentum',
    'priceChange24h',
    'reach',
    'spark',
    'summary',
    'thumbUrl',
    'title',
  ]);
});

test('the story page is the row minus isNew, plus the change, the evidence, the discussion and its provenance', () => {
  /* An exact list, because a field that exists gets rendered eventually. `provenance` was
     added deliberately and is the only field here that is not a fact about the story's
     subject — it is the fact about whether the subject happened, which a reader needs
     before believing any of the others. Anything else appearing in this list is a leak
     until somebody argues otherwise in this comment. */
  const page = projectStory(story(), OPTIONS, OBSERVED_STORY);
  assert.deepEqual(Object.keys(page ?? {}).sort(), [
    'coins',
    'discussion',
    'evidence',
    'firstSeenAt',
    'id',
    'momentum',
    'provenance',
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
  assert.throws(() => projectStory(leaky, OPTIONS, OBSERVED_STORY), WireLeakError);
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
  /* ★ The three members this seam was written for. They cited nothing for as long as
     no package owned that source's URL shape, which was correct and visible; the fix
     was the adapter, not a guess here. Note the stored id is a fullname and the URL
     takes the bare id — the prefix is stripped inside that package, because which
     characters of an id are addressable is a fact about that platform. */
  assert.equal(permalinkFor('reddit', 'dancing_gran', 't3_1a2b3c'), 'https://www.reddit.com/comments/1a2b3c');
  assert.equal(permalinkFor('reddit', 'videoclips_daily', 't3_1a2b3d'), 'https://www.reddit.com/comments/1a2b3d');
  assert.equal(permalinkFor('reddit', 'family_archive', 't3_1a2b3e'), 'https://www.reddit.com/comments/1a2b3e');
});

test('★ the three seeded members that used to cite nothing now survive the projection', () => {
  /* This is the whole observable result of adding that adapter: projectEvidence drops
     any member it cannot link to, so before there was a package that knew the shape,
     the evidence list on that story was empty. The drop was right and stays; what
     changed is that there is now an honest link to hand it. */
  const cited = [
    member({ itemId: 'it_dance_1', permalink: permalinkFor('reddit', 'dancing_gran', 't3_1a2b3c') }),
    member({ itemId: 'it_dance_2', permalink: permalinkFor('reddit', 'videoclips_daily', 't3_1a2b3d') }),
    member({ itemId: 'it_dance_3', permalink: permalinkFor('reddit', 'family_archive', 't3_1a2b3e') }),
  ];
  assert.deepEqual(
    projectEvidence(cited).map((e) => e.evidenceId),
    ['it_dance_1', 'it_dance_2', 'it_dance_3'],
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
  /* A source with no adapter package has nothing that knows its URL shape. The answer is
     no link — not a guessed path, not a home page, not a search. A generic fallback host
     would put a citation on screen that goes nowhere.

     This used to be spelled with `reddit`, which is the best possible demonstration of
     the rule: the answer for that source was null right up until somebody wrote the
     adapter, and then it became a real link without this file learning anything. */
  assert.equal(permalinkFor('somethingnew', '@someone', '1'), null);
  assert.equal(permalinkFor('instagram', 'someone', 'Cabcdef'), null);

  const dropped = member({ itemId: 'it_unknown', permalink: permalinkFor('somethingnew', '@someone', '1') });
  assert.deepEqual(projectEvidence([dropped]), []);
  /* And the story page still projects — an unlinkable member costs its own row and
     nothing else. */
  const page = projectStory(story({ members: [dropped] }), OPTIONS, OBSERVED_STORY);
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
    member({ itemId: 'it_unknown', permalink: permalinkFor('somethingnew', 'someone', '1') }),
    member({ itemId: 'it_tiktok', permalink: permalinkFor('tiktok', TIKTOK_HANDLE, '7460000000000000003') }),
    member({ itemId: 'it_nohandle', permalink: permalinkFor('x', null, '2') }),
  ]);
  assert.deepEqual(evidence.map((e) => e.evidenceId), ['it_x', 'it_reddit', 'it_tiktok']);
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
    OBSERVED_STORY,
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

/* ── ★ hostile token metadata, on the way to a browser ────────────────── */

/**
 * A LAUNCH IS THE ONE PAYLOAD IN THIS FILE WHOSE TEXT AN ATTACKER TYPED.
 *
 * A story's title and summary are written by our own qualify stage; a token's `symbol`
 * and `name` are typed by whoever paid to mint the coin, which on this product means by
 * someone who would like a rail position. Everything below is a value a mint can carry
 * today, for nothing, and the assertion in each case is about what the PROJECTION does
 * with it — the rail is the second door and it is tested from the other side.
 *
 * ★ THE FAILURE THAT MOTIVATED THIS BLOCK IS THE FOURTH ONE, AND IT WAS NOT AN INJECTION.
 * `boundedText` capped by `.slice()`, which counts UTF-16 units, so a cut at 48 landed
 * between the halves of one emoji and left a lone surrogate on the end of the name. That
 * string cannot be encoded as UTF-8; `writeLaunches` hands `JSON.stringify` of the payload
 * to a `jsonb` cast, Postgres answers `Unicode low surrogate must follow a high surrogate`,
 * and because the launches write shares one transaction with the board the WHOLE
 * projection rolls back — and rolls back again on every run for as long as the coin sits
 * in the six-hour window. One token name of two dozen emoji, which is an ordinary name on
 * this venue and needs no malice at all, froze the entire read surface at the tick it was
 * on. That is the largest blast radius any single field on this wire has.
 */

function launchFacts(over: Partial<LaunchFacts> = {}): LaunchFacts {
  return {
    assetKey: 'solana:4kLmNq7wR2vTbYxEuHgJcZaPsDiOfQnXvMmZbCyVdRt8',
    ticker: 'JERSEY',
    name: 'jersey',
    address: '4kLmNq7wR2vTbYxEuHgJcZaPsDiOfQnXvMmZbCyVdRt8',
    venueLabel: 'Pump.fun',
    mintedAt: T0 - 3 * MIN,
    mintPrecision: 'bounded',
    mintBoundS: 5,
    market: null,
    ...over,
  };
}

/** Every string on a finished payload, at every depth. */
function stringsOf(payload: unknown): string[] {
  const found = { keys: [] as string[], strings: [] as string[] };
  walk(payload, found);
  return found.strings;
}

test('★ an astral name is cut between characters, so the frame can still be committed', () => {
  /* 60 rockets is 60 characters and 120 UTF-16 units. A cut at 48 units would fall inside
     the 24th one. `isWellFormed` is the whole assertion: an ill-formed string is one
     Postgres refuses, and refusing it costs the board and the rail together. */
  const launch = projectLaunch(launchFacts({ name: '\u{1F680}'.repeat(60) }), OPTIONS);
  assert.equal(launch.name.isWellFormed(), true, 'a lone surrogate would fail the jsonb cast');
  assert.equal([...launch.name].length, 49, '48 characters and the ellipsis that says so');
  assert.equal(launch.name.endsWith('…'), true);
});

test('★ the cut lands between characters wherever the boundary happens to fall', () => {
  /* The bug only showed up when the 48th unit was the FIRST half of a pair, so a single
     length is not a test. Every offset from 40 to 60 puts the boundary somewhere different
     inside the run, and one of them is the one that used to break. */
  for (let lead = 0; lead <= 20; lead += 1) {
    const name = `${'A'.repeat(lead)}${'\u{1F4A9}'.repeat(40)}`;
    const launch = projectLaunch(launchFacts({ name, ticker: name }), OPTIONS);
    assert.equal(launch.name.isWellFormed(), true, `name ill-formed with ${lead} leading letters`);
    assert.equal(launch.ticker.isWellFormed(), true, `ticker ill-formed with ${lead} leading letters`);
  }
});

test('★ the whole finished payload is serialisable, which is what the writer needs', () => {
  /* `writeLaunches` casts `JSON.stringify(launch)` to jsonb. A well-formed name is not
     enough on its own — the claim being made is about the payload, so it is asserted about
     the payload.

     ★ THE SINGLE LEADING LETTER IS THE TEST. Without it both caps land on an even offset,
     every pair stays whole by luck, and the assertion passes against the broken code. One
     character of padding is what pushes the boundary inside a pair. `JSON.parse` is NOT
     the check — JavaScript round-trips a lone surrogate happily, which is exactly why this
     survived to production; `isWellFormed` is the question Postgres actually asks. */
  const launch = projectLaunch(
    launchFacts({ name: `A${'\u{1F680}'.repeat(60)}`, ticker: `A${'\u{1F4A9}'.repeat(30)}` }),
    OPTIONS,
  );
  for (const text of stringsOf(launch)) {
    assert.equal(text.isWellFormed(), true, `ill-formed string on the wire: ${escape(text)}`);
  }
});

test('the cap counts characters, so a name is as long as a person would say it is', () => {
  /* 48 means 48 to a reader, to Postgres `left()` and to `hostile.ts` one layer up. It
     used to mean 24 for a name made of emoji and 48 for a name made of letters. */
  assert.equal([...projectLaunch(launchFacts({ name: 'A'.repeat(200) }), OPTIONS).name].length, 49);
  assert.equal([...projectLaunch(launchFacts({ name: 'é'.repeat(200) }), OPTIONS).name].length, 49);
  assert.equal([...projectLaunch(launchFacts({ name: '\u{1F680}'.repeat(200) }), OPTIONS).name].length, 49);
});

test('a ten-kilobyte name is a bounded name and not a ten-kilobyte row', () => {
  const launch = projectLaunch(launchFacts({ name: 'A'.repeat(10_000) }), OPTIONS);
  assert.equal(launch.name.length, 49);
  const huge = projectLaunch(launchFacts({ name: 'B'.repeat(100_000) }), OPTIONS);
  assert.equal(huge.name.length, 49);
});

test('★ markup is kept as text and is neither escaped nor stripped', () => {
  /* Deliberately unchanged. Escaping here would produce `&lt;script&gt;` in the DATABASE,
     which is a different string from the one the coin was minted with and which renders as
     literal ampersands the day somebody puts it somewhere that escapes again. The rail
     renders it as a text node, which is where the safety comes from; this only has to not
     make it worse, and has to keep a name a person could recognise. */
  const launch = projectLaunch(launchFacts({ name: '<script>alert(1)</script>', ticker: '<img src=x>' }), OPTIONS);
  assert.equal(launch.name, '<script>alert(1)</script>');
  assert.equal(launch.ticker, '<img src=x>');
});

test('a name that is a URI stays a name, and nothing on this wire can carry it', () => {
  /* There is no field on a launch that becomes an href or a src — see the field list
     asserted below — so a `javascript:` name is a name that reads oddly and nothing more.
     The assertion worth making is the one about the field set, not about the string. */
  const launch = projectLaunch(launchFacts({ name: 'javascript:alert(1)' }), OPTIONS);
  assert.equal(launch.name, 'javascript:alert(1)');
  assert.deepEqual(Object.keys(launch).sort(), [
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

test('★ a right-to-left override cannot reach the rail and reorder the row around it', () => {
  const launch = projectLaunch(launchFacts({ ticker: 'SAFE‮kcatta', name: 'a‮b' }), OPTIONS);
  assert.equal(launch.ticker, 'SAFEkcatta');
  assert.equal(launch.name, 'ab');
});

test('★ a zero-width character cannot disguise one coin as another', () => {
  /* The lookalike, which is the reason this strip exists at all: two different stored
     strings that draw the same picture on a list of thirty coins. U+200B is Cf and was
     always caught. U+115F, U+1160 and U+17B4 are Lo and Mn — letters and marks — and every
     one of them measures zero pixels in the rail's own font, so the category test alone let
     the impersonation through. */
  const real = projectLaunch(launchFacts({ ticker: 'BONK' }), OPTIONS).ticker;
  for (const invisible of ['​', 'ᅟ', 'ᅠ', '឴', 'ㅤ', 'ﾠ', '️']) {
    const fake = projectLaunch(launchFacts({ ticker: `B${invisible}ONK` }), OPTIONS).ticker;
    assert.equal(fake, real, `U+${invisible.codePointAt(0)?.toString(16).toUpperCase()} survived the strip`);
  }
});

test('a ticker made only of invisible characters is no ticker, not a blank one', () => {
  /* '' is what the rail reads as "this coin named no ticker", and it draws the dashed
     placeholder tile for it. A string of fillers would instead take the solid tile and an
     empty label, which says "this coin has a ticker" while showing nothing. */
  assert.equal(projectLaunch(launchFacts({ ticker: 'ᅟㅤﾠ' }), OPTIONS).ticker, '');
});

test('a control character separates words rather than joining them', () => {
  /* The one thing the strip must NOT do: a newline is a control character and also a word
     separator, so deleting it outright turns two words into one word that was never a
     name. */
  assert.equal(projectLaunch(launchFacts({ name: 'line one\nline two' }), OPTIONS).name, 'line one line two');
});

test('an empty, blank or absent name is the empty string, never a stand-in', () => {
  /* Not the address, not the ticker, not "Unknown". The rail renders '' as nothing, and
     anything else here would look like the coin's actual name to a person. */
  for (const raw of ['', '   ', '\t\n ', null]) {
    const launch = projectLaunch(launchFacts({ name: raw, ticker: raw }), OPTIONS);
    assert.equal(launch.name, '');
    assert.equal(launch.ticker, '');
  }
});

test('a name of four thousand spaces is empty, not a four-thousand-character cell', () => {
  assert.equal(projectLaunch(launchFacts({ name: ' '.repeat(4_000) }), OPTIONS).name, '');
});

test('★ a truncation is visible as one, so a cut name is not read as the whole name', () => {
  /* A coin apparently called "OFFICIAL SOLANA FOUNDATION TREASU" is a better impersonation
     than the string it came from, because it reads as complete. */
  const launch = projectLaunch(
    launchFacts({ name: 'OFFICIAL SOLANA FOUNDATION TREASURY WALLET DO NOT SHARE' }),
    OPTIONS,
  );
  assert.equal(launch.name.endsWith('…'), true);
});

test('★ our own vendor inside a token name costs that row and not the frame', () => {
  /* Free to type, and it is the reason `main.ts` catches WireLeakError around this call
     rather than letting it end the run. The name is somebody else's text; the check has to
     hold over values and not only over keys. */
  for (const bad of FORBIDDEN_SUBSTRINGS) {
    assert.throws(
      () => projectLaunch(launchFacts({ name: `a ${bad} coin` }), OPTIONS),
      WireLeakError,
      `a token named after "${bad}" was published`,
    );
  }
});

test('an internal word typed into a ticker is caught in the value, not only in a key', () => {
  assert.throws(() => projectLaunch(launchFacts({ ticker: 'MEMESCORE' }), OPTIONS), WireLeakError);
});

test('a hostile launch that IS published carries no forbidden key and no forbidden substring', () => {
  const launch = projectLaunch(
    launchFacts({ name: '<b>Official</b> USDC — CA: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }),
    OPTIONS,
  );
  const found = { keys: [] as string[], strings: [] as string[] };
  walk(launch, found);
  for (const key of found.keys) {
    assert.equal(FORBIDDEN_KEYS.includes(key.toLowerCase()), false, `forbidden key on the wire: ${key}`);
  }
  for (const text of found.strings) {
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      assert.equal(text.toLowerCase().includes(bad), false, `forbidden substring in value: ${text}`);
    }
  }
});

test('a story quoted out of somebody else’s post is cut between characters too', () => {
  /* `trimTo` had the same `.slice()` and lands in the same jsonb column by way of
     `story_view.payload`. A post is somebody else's text as much as a token name is.

     Both of its callers are exercised here: `displayTitle: null` makes the title a QUOTE of
     the earliest post, and a permalink is what stops the member being dropped so its
     EXCERPT is projected too. `trimTo` usually cuts at a space, which hides the bug; an
     excerpt with no space in it takes the other branch, and an excerpt with no space in it
     is what a wall of emoji is. The leading letter moves both caps onto an odd offset,
     which is where the boundary falls inside a pair. */
  const excerpt = `A${'\u{1F680}'.repeat(400)}`;
  const page = projectStory(
    story({
      displayTitle: null,
      members: [member({ excerpt, permalink: 'https://x.com/a/status/1' })],
    }),
    OPTIONS,
    OBSERVED_STORY,
  );
  assert.notEqual(page, null);
  assert.equal(page?.title.endsWith('…'), true, 'the title is a cut quote, so the cut is under test');
  assert.equal(page?.evidence[0]?.excerpt.endsWith('…'), true, 'and so is the excerpt');
  for (const text of stringsOf(page)) {
    assert.equal(text.isWellFormed(), true, 'a lone surrogate would fail the story_view jsonb cast');
  }
});

/* ── ★ the frame's provenance ─────────────────────────────────────────────
   The projector's half of "a fiction is labelled a fiction or it is not shown". The
   seeded rows are worth publishing — the alternative is an empty board, which is the
   state five migrations have gone into distinguishing from a broken one — but publishing
   them unannounced under a heading reading `Trending` was the rule failing on the first
   surface anybody opens. */

test('★ a board of seeded stories announces itself, and names the free source', () => {
  const origins = new Map<string, StoryOrigin>([
    ['st_a', 'fixture'],
    ['st_b', 'fixture'],
  ]);

  const provenance = projectBoardProvenance(origins, ['st_a', 'st_b'], 'Reddit');
  assert.equal(provenance.kind, 'seeded');
  assert.deepEqual(provenance, {
    kind: 'seeded',
    seededStories: 2,
    totalStories: 2,
    connectSourceLabel: 'Reddit',
  });
});

test('★ one observed story is not enough to be announced as seeded — it is counted', () => {
  /* The mixed frame, which is the first thing that exists after a real source is
     connected. The banner has to keep appearing while any fiction is on the board, and it
     has to say how many — telling a reader that the real row they just watched arrive is
     invented is the same class of error in the other direction. */
  const origins = new Map<string, StoryOrigin>([
    ['st_a', 'fixture'],
    ['st_b', 'observed'],
    ['st_c', 'fixture'],
  ]);
  const provenance = projectBoardProvenance(origins, ['st_a', 'st_b', 'st_c'], 'Reddit');
  assert.deepEqual(provenance, {
    kind: 'seeded',
    seededStories: 2,
    totalStories: 3,
    connectSourceLabel: 'Reddit',
  });
});

test('★ the notice switches ITSELF off when the board becomes real', () => {
  /* The requirement, asserted: no code change, no flag, no deploy. A frame whose stories
     were all assembled from observed posts carries the branch the app renders nothing
     for, and that is the whole mechanism. */
  const origins = new Map<string, StoryOrigin>([
    ['st_a', 'observed'],
    ['st_b', 'observed'],
  ]);
  assert.deepEqual(projectBoardProvenance(origins, ['st_a', 'st_b'], 'Reddit'), {
    kind: 'observed',
  });
});

test('★ the count is over the FRAME, not over the table', () => {
  /* A database that still holds six old fixtures under a board showing nothing but real
     rows must not keep the banner up: it would be a permanent warning about rows nobody
     can see, which is how a banner gets ignored and then deleted. Only the ids on the
     frame are counted, so a fixture the board did not retrieve contributes nothing. */
  const origins = new Map<string, StoryOrigin>([
    ['st_on_frame', 'observed'],
    ['st_old_fixture', 'fixture'],
  ]);
  assert.deepEqual(projectBoardProvenance(origins, ['st_on_frame'], 'Reddit'), {
    kind: 'observed',
  });
});

test('an empty board states nothing rather than announcing a fiction', () => {
  assert.deepEqual(projectBoardProvenance(new Map(), [], 'Reddit'), { kind: 'observed' });
});

test('★ a seeded story page announces itself, and a discovered one does not', () => {
  /* The page's own answer. It is NOT derived from the frame, because a story link opened
     cold has no frame — see projectStoryProvenance. */
  assert.deepEqual(projectStoryProvenance('fixture', 'Reddit'), {
    kind: 'seeded',
    connectSourceLabel: 'Reddit',
  });
  assert.deepEqual(projectStoryProvenance('observed', 'Reddit'), { kind: 'observed' });
});

test('a story whose origin never arrived is not stamped as a fiction', () => {
  /* The narrow default, matching projectBoardProvenance: the failure being avoided is a
     new origin silently putting "this is made up" over every real story. The opposite
     mistake is caught by STORY_ORIGINS being pinned to the schema in migrations.test.ts. */
  assert.deepEqual(projectStoryProvenance(undefined, 'Reddit'), { kind: 'observed' });
});
