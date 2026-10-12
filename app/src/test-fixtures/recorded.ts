/**
 * RECORDED WIRE PAYLOADS, FOR TESTS AND NOTHING ELSE.
 *
 * ★ ONLY A `*.test.ts` FILE MAY IMPORT THIS. The app used to ship these shapes as sample data
 * that a build could render in front of a user; that path is gone, and this directory is what
 * survived because two decoder tests need a complete, realistic payload to push through the
 * wall. `src/no-sample-data.test.ts` walks every import the entry point can reach and fails if
 * any of them lands in `src/test-fixtures/`, so importing this from a component, a hook or the
 * read layer turns the suite red rather than putting invented rows back on screen.
 *
 * Two rules, both inherited from the module this replaces:
 *
 *   1. These are RAW wire payloads, never decoded objects. A test pushes them through
 *      `decode.ts` exactly as a network response would go, so a payload here cannot hold a
 *      shape the server can never send without a test noticing.
 *   2. Timestamps are fixed literals, not `Date.now()`. A recording is of one moment, and a
 *      test that depends on the clock it runs at is a test that fails on somebody's birthday.
 *
 * The names and numbers are illustrative and are not measurements of anything.
 */

import type { PendingReason } from '../shared/format/measure.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The moment these payloads were recorded at. Fixed so every run reads the same ages. */
const T0 = 1_755_079_200_000;

const m = (v: number): unknown => ({ v });
/* Typed against the app's own absence vocabulary, so a recording cannot carry a reason the
   screens have no words for. */
const noValue = (why: PendingReason): unknown => ({ v: null, why });
const at = (ms: number): unknown => ({ at: ms });

/* ── one story page ───────────────────────────────────────────────────── */

/**
 * One story, with its single settled coin, two evidence posts and one discussion post.
 * `decode.test.ts` spreads it and swaps one field, so every field the story decoder demands
 * has to be present and valid here.
 */
export function recordedStory(): Record<string, unknown> {
  return {
    id: 'st_rec_story',
    title: 'Ferry captain refuses to dock, three-hour standoff',
    summary: [
      'A local news clip has been reposted many times in two hours, mostly outside the region.',
      'One token was minted minutes after the clip, and no other token uses the phrase.',
    ],
    thumbUrl: null,
    reach: m(486_000),
    spark: {
      windowMs: 30 * MIN,
      points: [
        { atMs: T0 - 4 * MIN, value: 9_000 },
        { atMs: T0 - 2 * MIN, value: 130_000 },
        { atMs: T0, value: 486_000 },
      ],
    },
    momentum: 'rising',
    marketCapUsd: m(186_400),
    priceChange24h: m(23.6),
    firstSeenAt: at(T0 - 2 * HOUR - 41 * MIN),
    isNew: false,
    coins: {
      kind: 'one',
      coin: {
        coinId: 'c_rec_coin',
        ticker: 'DOCK',
        name: 'refuses to dock',
        address: '4kLmNq7wR2vTbYxEuHgJcZaPsDiOfQnXvMmZbCyVdRt8',
        venueLabel: 'Pump.fun',
        imageUrl: null,
        mintedAt: at(T0 - 2 * HOUR - 35 * MIN),
        priceUsd: m(0.000_186),
        marketCapUsd: m(186_400),
        marketCapBasis: 'fully-diluted',
        liquidityUsd: m(41_200),
        priceChange24h: m(23.6),
        tradable: true,
      },
    },
    reachDelta24h: m(402_000),
    evidence: [
      {
        evidenceId: 'e1',
        sourceLabel: 'X',
        authorLabel: '@recorded_one',
        permalink: 'https://example.invalid/post/1',
        excerpt: 'he has been sat out there for three hours now and he is not moving',
        thumbUrl: null,
        postedAt: at(T0 - 2 * HOUR - 41 * MIN),
        relation: 'The earliest post we found with this clip.',
      },
      {
        evidenceId: 'e2',
        sourceLabel: 'TikTok',
        authorLabel: '@recorded_two',
        permalink: 'https://example.invalid/post/2',
        excerpt: 'refuses to dock',
        thumbUrl: null,
        postedAt: at(T0 - 1 * HOUR - 50 * MIN),
        relation: 'A different platform, same clip and the same phrase.',
      },
    ],
    discussion: [
      {
        postId: 'd1',
        authorLabel: 'recorded',
        text: 'the second repost is the one that moved it.',
        postedAt: at(T0 - 40 * MIN),
      },
    ],
    provenance: { kind: 'observed' },
  };
}

/* ── one pairs frame ──────────────────────────────────────────────────── */

/**
 * One frame of the pairs feed: three rows, and at least one of them carries a figure the
 * venue did not report, because a recording where every row has every number teaches the
 * wrong lesson about this population and the test asserts as much.
 */
export function recordedPairs(): Record<string, unknown> {
  return {
    tick: 1,
    head: {
      windowMs: 14 * DAY,
      lastMintHeardAt: at(T0 - 5 * DAY - 21 * HOUR),
      rows: { listing: 'shown', mintsInWindow: 192, withMarket: 3, withoutMarket: 189 },
    },
    pairs: [
      {
        pairId: 'solana:rec_pool',
        ticker: 'RECA',
        name: 'recorded pool',
        address: '9pRecPoolA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU',
        venueLabel: 'Pump.fun',
        mintedAt: at(T0 - 5 * DAY - 21 * HOUR),
        mintedAtBoundS: 5,
        readAt: at(T0 - 52 * MIN),
        priceUsd: m(0.000_001_999),
        marketCapUsd: m(1_903),
        marketCapBasis: 'fully-diluted',
        liquidityUsd: m(1_978),
      },
      {
        pairId: 'solana:rec_curve',
        ticker: 'RECB',
        name: 'recorded curve',
        address: '4kRecCurveB6dE8fG0hJ2kL4mN6pQ8rS0tU2v',
        venueLabel: 'Pump.fun',
        mintedAt: at(T0 - 5 * DAY - 22 * HOUR),
        mintedAtBoundS: 5,
        readAt: at(T0 - 52 * MIN),
        priceUsd: m(0.000_001_88),
        marketCapUsd: m(1_840),
        marketCapBasis: 'fully-diluted',
        /* A curve has no two-sided reserve: not reported, never zero. */
        liquidityUsd: noValue('not_reported'),
      },
      {
        pairId: 'solana:rec_nocap',
        ticker: '',
        name: 'recorded no cap',
        address: '6mRecNoCapC8fG0hJ2kL4mN6pQ8rS0tU2vW4x',
        venueLabel: 'Raydium',
        mintedAt: at(T0 - 6 * DAY),
        mintedAtBoundS: null,
        readAt: at(T0 - 52 * MIN),
        priceUsd: m(0.000_001_591),
        marketCapUsd: noValue('not_reported'),
        marketCapBasis: null,
        liquidityUsd: m(1_620),
      },
    ],
  };
}
