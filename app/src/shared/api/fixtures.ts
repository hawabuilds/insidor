/**
 * SAMPLE DATA, FOR LOOKING AT THE APP WITH NOTHING BEHIND IT.
 *
 * This is not a mock layer and it is not a step toward one. It exists so the screens can be
 * reviewed, argued about and shown to someone before the pipeline exists, and it is wired in
 * exactly one place: `client.ts` falls back to it when `VITE_READ_URL` is unset AND the build
 * is a dev build. A production build has `import.meta.env.DEV === false`, so the bundler drops
 * this module and its data at build time — there is no flag to leave on by accident.
 *
 * Two rules it obeys, both load-bearing:
 *
 *   1. It returns RAW wire payloads, not decoded objects, and `client.ts` runs them through
 *      `decode.ts` like anything off the network. Fixtures that skipped the decoder would be
 *      able to hold shapes the server can never send, and the screens would then be designed
 *      against a wire format that does not exist. (This caught a real mistake on the first
 *      run: these were written with bare numbers for `reach`, and the decoder rejected them.)
 *
 *   2. Every row demonstrates one of the decisions the vocabulary exists to enforce — a
 *      censored reading, an unknown age, a source with no view concept, an unsure match with
 *      no button. Filler rows would show that the components render; these show that they
 *      render the hard cases correctly, which is the part that was wrong before.
 *
 * The stories are shaped after events we actually studied. The numbers are illustrative and
 * are not measurements of anything.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Fixtures are relative to load time, so ages read sensibly whenever this is opened rather
 * than showing "8 months old" for a story written to be four minutes old.
 */
const T0 = Date.now();

/* ── wire constructors ────────────────────────────────────────────────── */

/**
 * A measured number on the wire: `{ v }`, or `{ v: null, why }` for an absence.
 *
 * Note there is no overload taking a bare number. The wire has never carried one — an absence
 * has to be able to say WHY it is absent, and a bare number has nowhere to put that.
 */
const m = (v: number): unknown => ({ v });
const noValue = (why: string): unknown => ({ v: null, why });

const at = (ms: number): unknown => ({ at: ms });
const noTime = (why: string): unknown => ({ at: null, why });

/** A rising curve, sampled every two minutes. */
function rising(from: number, to: number, points: number): { atMs: number; value: number }[] {
  const out: { atMs: number; value: number }[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    out.push({
      atMs: T0 - (points - 1 - i) * 2 * MIN,
      value: Math.round(from + (to - from) * t * t),
    });
  }
  return out;
}

function flat(level: number, points: number, jitter = 0): { atMs: number; value: number }[] {
  const out: { atMs: number; value: number }[] = [];
  for (let i = 0; i < points; i += 1) {
    out.push({
      atMs: T0 - (points - 1 - i) * 2 * MIN,
      /* Deterministic wobble. Math.random would make two loads disagree and make any
         screenshot of this unreproducible. */
      value: Math.round(level + Math.sin(i * 1.7) * jitter),
    });
  }
  return out;
}

const WINDOW = 30 * MIN;

/* ── the rows ─────────────────────────────────────────────────────────── */

/**
 * ONE MEME, MANY TOKENS — the case the product exists for.
 *
 * The meme is old and large, the tokens are new and numerous, and picking which of them is
 * the real one is the whole job. `several` is what puts Compare on the row.
 */
const manyCoins = {
  id: 'st_chillguy',
  title: 'Cartoon dog in a sweater, posted as a mood',
  summary: [
    'One drawing has been reposted by 41 accounts in the last hour, mostly quoting it rather than sharing it.',
    'Three tokens now use the image. The oldest is 22 minutes old; the largest is not the oldest.',
  ],
  thumbUrl: null,
  reach: m(2_840_000),
  spark: { points: rising(120_000, 2_840_000, 15), windowMs: WINDOW },
  momentum: 'rising',
  firstSeenAt: at(T0 - 3 * HOUR - 14 * MIN),
  isNew: false,
  coins: {
    kind: 'several',
    coins: [
      {
        coinId: 'c_1',
        ticker: 'CHILLGUY',
        name: 'Just a chill guy',
        address: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',
        venueLabel: 'Pump.fun',
        imageUrl: null,
        mintedAt: at(T0 - 22 * MIN),
        priceUsd: m(0.000_412),
        marketCapUsd: m(412_000),
        marketCapBasis: 'fully-diluted',
        /* On a bonding curve there is no pool to report. Absence is not illiquidity. */
        liquidityUsd: noValue('not_reported'),
        tradable: true,
      },
      {
        coinId: 'c_2',
        ticker: 'CHILL',
        name: 'chill',
        address: '7xKq2mNvB4pLdRtYwEjHnCzAgFsUiOpQvXmZbNcVdRt3',
        venueLabel: 'Pump.fun',
        imageUrl: null,
        mintedAt: at(T0 - 9 * MIN),
        priceUsd: m(0.000_038),
        marketCapUsd: m(38_000),
        marketCapBasis: 'fully-diluted',
        liquidityUsd: noValue('not_reported'),
        tradable: true,
      },
      {
        coinId: 'c_3',
        ticker: 'CHILLGUY',
        name: 'chill guy (official)',
        address: '9mPxWq3nT8vKjRbYuEhGcZaFsDiOlQpXvNmZbCxVdRt7',
        venueLabel: 'Raydium',
        imageUrl: null,
        /* Mint time unknown, and it STAYS unknown rather than being backfilled from
           first-seen. Mint time is the axis every ordering claim hangs on: a guessed one can
           make a post that came after the mint look like it came before. */
        mintedAt: noTime('not_read_yet'),
        priceUsd: m(0.000_002),
        marketCapUsd: m(2_100),
        marketCapBasis: 'fully-diluted',
        liquidityUsd: m(900),
        tradable: false,
      },
    ],
  },
};

/**
 * ONE CONFIDENT MATCH — the ordinary good case. `one` is what puts Buy on the row.
 */
const oneCoin = {
  id: 'st_ferry',
  title: 'Ferry captain refuses to dock, three-hour standoff',
  summary: [
    'A local news clip has been reposted 1,200 times in two hours, mostly by accounts outside the region.',
    'One token was minted 6 minutes after the clip, and no other token uses the phrase.',
  ],
  thumbUrl: null,
  reach: m(486_000),
  spark: { points: rising(9_000, 486_000, 15), windowMs: WINDOW },
  momentum: 'rising',
  firstSeenAt: at(T0 - 2 * HOUR - 41 * MIN),
  isNew: false,
  coins: {
    kind: 'one',
    coin: {
      coinId: 'c_ferry',
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
      tradable: true,
    },
  },
};

/**
 * NOTHING MINTED YET — genuinely early. `none` is what puts Create on the row.
 *
 * This is the row the product's pitch is about, and it is also the rarest: the measured
 * median from post to mint is under four minutes, so a story climbing for eleven minutes with
 * no token is unusual rather than typical.
 */
const noCoin = {
  id: 'st_pigeon',
  title: 'Pigeon rides the same bus every morning, driver names it',
  summary: [
    'Posted 11 minutes ago; 340 reposts and climbing, no repost from an account with a large following yet.',
    'Nothing has been minted from this.',
  ],
  thumbUrl: null,
  reach: m(71_400),
  spark: { points: rising(400, 71_400, 8), windowMs: WINDOW },
  momentum: 'rising',
  firstSeenAt: at(T0 - 11 * MIN),
  isNew: true,
  coins: { kind: 'none' },
};

/**
 * ★ THE ONE THAT MATTERS — several coins claim the story and none is confidently the one.
 *
 * `unsure` carries NO coin, so there is nothing to buy with and the row renders no button at
 * all. Not a disabled button: a disabled button says "this exists but you may not have it",
 * which invites the user to wait for it to enable. The honest render of "we do not know which
 * token this is" is an absent affordance and a line of text saying so.
 */
const unsure = {
  id: 'st_soup',
  title: 'Chef throws the soup, kitchen goes silent',
  summary: [
    'A 9-second clip, reposted 890 times, spreading through cooking accounts rather than the usual crowd.',
    'Six tokens use some version of the phrase and none of them clearly matches the clip.',
  ],
  thumbUrl: null,
  reach: m(233_000),
  spark: { points: rising(15_000, 233_000, 15), windowMs: WINDOW },
  momentum: 'rising',
  firstSeenAt: at(T0 - 47 * MIN),
  isNew: false,
  coins: { kind: 'unsure', claimCount: 6 },
};

/**
 * A SOURCE WITH NO VIEW COUNT — reach is absent with a reason, not zero.
 *
 * The board renders a dash. The previous build defaulted this to 0, which sorted the row last
 * and made "this platform does not publish views" indistinguishable from "nobody watched it".
 * The activity graph is still live, because the counter that IS published still moves.
 */
const noReach = {
  id: 'st_dance',
  title: 'Grandmother learns the dance, does it better',
  summary: [
    'Spreading on a source that publishes no view count, so the number on the left is not available.',
    'Two tokens exist; neither has traded in the last ten minutes.',
  ],
  thumbUrl: null,
  reach: noValue('not_reported'),
  spark: { points: flat(4_200, 15, 260), windowMs: WINDOW },
  momentum: 'steady',
  firstSeenAt: at(T0 - 5 * HOUR - 8 * MIN),
  isNew: false,
  coins: {
    kind: 'several',
    coins: [
      {
        coinId: 'c_gran1',
        ticker: 'GRANNY',
        name: 'grandma dance',
        address: '2nQwErTyUiOpAsDfGhJkLzXcVbNm1234567890QwEr',
        venueLabel: 'Pump.fun',
        imageUrl: null,
        mintedAt: at(T0 - 4 * HOUR),
        priceUsd: m(0.000_009),
        marketCapUsd: m(9_100),
        marketCapBasis: 'fully-diluted',
        liquidityUsd: noValue('not_reported'),
        tradable: true,
      },
      {
        coinId: 'c_gran2',
        ticker: 'NANA',
        name: 'nana',
        address: '5tYuIoPaSdFgHjKlZxCvBnM0987654321TyUiOpAs',
        venueLabel: 'Pump.fun',
        imageUrl: null,
        mintedAt: at(T0 - 3 * HOUR - 20 * MIN),
        /* Minted but never traded. There is no price to have, and `no_market` is a different
           fact from a price of zero — one says nobody has bought, the other says it is
           worthless. */
        priceUsd: noValue('no_market'),
        marketCapUsd: noValue('no_market'),
        marketCapBasis: null,
        liquidityUsd: noValue('no_market'),
        tradable: false,
      },
    ],
  },
};

/**
 * ★ A CENSORED READING — the gap in the middle of the graph.
 *
 * The source rounds its counter, two successive reads fell inside the rounding step, and so
 * nothing was learned. That arrives as `value: null` and the line BREAKS rather than dropping
 * to the floor. A drop to the floor reads as collapse, and this item is in fact still moving —
 * the exact misread the `measured | censored` union exists to make impossible.
 *
 * Age is unknown too: we picked this up mid-flight and never saw its beginning. It renders as
 * unknown, not as zero. Zero would read as "brand new" on a product that sells earliness, and
 * that is the worst direction to be wrong in.
 */
const censored = {
  id: 'st_rooftop',
  title: 'Man builds a slide from his roof to the street',
  summary: [
    'Reposting steadily for two hours; the graph is broken where the counter stopped moving enough to read.',
    'One token, minted before we first saw the clip.',
  ],
  thumbUrl: null,
  reach: m(1_120_000),
  spark: {
    points: [
      ...flat(88_000, 5, 900),
      /* Four reads that told us nothing. Not zeros. */
      { atMs: T0 - 20 * MIN, value: null },
      { atMs: T0 - 18 * MIN, value: null },
      { atMs: T0 - 16 * MIN, value: null },
      { atMs: T0 - 14 * MIN, value: null },
      ...rising(91_000, 104_000, 7),
    ],
    windowMs: WINDOW,
  },
  momentum: 'cooling',
  firstSeenAt: noTime('not_read_yet'),
  isNew: false,
  coins: {
    kind: 'one',
    coin: {
      coinId: 'c_roof',
      ticker: 'SLIDE',
      name: 'roof slide',
      address: '8jHgFdSaQwErTyUiOpLkJhGfDsAzXcVbNm112233Qw',
      venueLabel: 'Raydium',
      imageUrl: null,
      mintedAt: at(T0 - 6 * HOUR),
      priceUsd: m(0.001_04),
      marketCapUsd: m(1_040_000),
      marketCapBasis: 'circulating',
      liquidityUsd: m(218_000),
      tradable: true,
    },
  },
};

const ROWS = [manyCoins, oneCoin, noCoin, unsure, noReach, censored];

/**
 * The board, as the server would send it.
 *
 * `order` is committed by the server and the client never sorts, so the order here is the
 * order on screen. It is deliberately NOT the reach order — the ranking is not "biggest
 * first", and a fixture sorted by size would quietly teach everyone looking at it that it is.
 */
export function fixtureBoard(): unknown {
  return {
    tick: 1,
    order: ['st_pigeon', 'st_chillguy', 'st_soup', 'st_ferry', 'st_rooftop', 'st_dance'],
    rows: ROWS,
  };
}

/* ── one story, in full ───────────────────────────────────────────────── */

/**
 * Evidence is the part that has to be honest: the posts we counted, so a user can check our
 * work. Each carries who, when and where, and a plain-English `relation` — never a number
 * saying how much it contributed to anything.
 */
const EVIDENCE = [
  {
    evidenceId: 'e1',
    sourceLabel: 'X',
    authorLabel: '@localferrywatch',
    permalink: 'https://x.com/localferrywatch/status/1',
    excerpt: 'he has been sat out there for three hours now and he is not moving',
    thumbUrl: null,
    postedAt: at(T0 - 2 * HOUR - 41 * MIN),
    relation: 'The earliest post we found with this clip.',
  },
  {
    evidenceId: 'e2',
    sourceLabel: 'X',
    authorLabel: '@harbourdaily',
    permalink: 'https://x.com/harbourdaily/status/2',
    excerpt: 'THREE HOURS. the captain simply said no.',
    thumbUrl: null,
    postedAt: at(T0 - 2 * HOUR - 12 * MIN),
    relation: 'Same clip, reposted by a larger account — this is where it left the region.',
  },
  {
    evidenceId: 'e3',
    sourceLabel: 'TikTok',
    authorLabel: '@boatsofinstagram',
    permalink: 'https://www.tiktok.com/@boatsofinstagram/video/3',
    excerpt: 'refuses to dock 😭',
    thumbUrl: null,
    postedAt: at(T0 - 1 * HOUR - 50 * MIN),
    relation: 'A different platform, same clip and the same phrase.',
  },
  {
    evidenceId: 'e4',
    sourceLabel: 'X',
    authorLabel: '@dockrefuser',
    permalink: 'https://x.com/dockrefuser/status/4',
    excerpt: 'refuses to dock is now a coin, ca in bio',
    thumbUrl: null,
    postedAt: at(T0 - 2 * HOUR - 30 * MIN),
    relation: 'Names the token. This is how the token was linked to the clip.',
  },
];

const DISCUSSION = [
  {
    postId: 'd1',
    authorLabel: 'hawa',
    text: 'the second repost is the one that moved it. everything before that is local.',
    postedAt: at(T0 - 40 * MIN),
  },
  {
    postId: 'd2',
    authorLabel: 'zain',
    text: 'six minutes from clip to mint. that is about the median we measured.',
    postedAt: at(T0 - 26 * MIN),
  },
];

/**
 * One story page. Only the ferry story is filled in — the others return null, which becomes a
 * 404. That is honest: a fixture that invented a page for every id would hide the fact that
 * the story endpoint does not exist yet.
 */
export function fixtureStory(storyId: string): unknown | null {
  if (storyId !== 'st_ferry') return null;
  return {
    ...oneCoin,
    reachDelta24h: m(402_000),
    evidence: EVIDENCE,
    discussion: DISCUSSION,
  };
}
