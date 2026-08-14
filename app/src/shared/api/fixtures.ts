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
  /* ★ Three coins, so NO market cap — and the two tempting answers are both lies. Their
     caps sum to 452,100, a number that is true of nothing; the largest is 412,000, which
     is a choice about which coin is the real one dressed up as a measurement. Declining is
     the same refusal `unsure` makes, arriving through a different branch. */
  marketCapUsd: noValue('not_reported'),
  /* And no 24h move either, for the same reason and with a stronger temptation: the three
     coins moved +41.8%, -12.4% and not at all. The mean of those describes a portfolio
     nobody holds; the biggest is a choice about which coin is the real one wearing a
     percentage sign. Both would sit under a head reading GAIN. */
  priceChange24h: noValue('not_reported'),
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
        /* Up, and the row shows nothing: three coins claim this story, so there is no
           single move to put in the GAIN column. See BoardRow.priceChange24h. */
        priceChange24h: m(41.8),
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
        priceChange24h: m(-12.4),
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
        /* Nine minutes old, so there is no trailing day to have changed over. Absent, and
           emphatically not 0 — zero would say it held flat through a day it did not exist
           for, on the column a user is most likely to trade on. */
        priceChange24h: noValue('not_reported'),
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
  /* One settled coin, so the row's cap IS that coin's cap — the same object, not a second
     reading of it. This is the only branch that carries a number. */
  marketCapUsd: m(186_400),
  /* One settled coin, so the row's move IS that coin's move — the same object, not a
     second reading of it. The only branch that carries a number. */
  priceChange24h: m(23.6),
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
      priceChange24h: m(23.6),
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
  /* Nothing minted, so there is no market to have a number in. A different absence from
     the one below it, and it says so. */
  marketCapUsd: noValue('not_minted'),
  /* Nothing minted, so no price anywhere to have moved. A different absence from the one
     above it, and it says so. */
  priceChange24h: noValue('not_minted'),
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
  /* Six coins claim it and none is settled. The payload carries no coin at all, so there
     is not even a cap here to be tempted by — which is the union doing its job twice. */
  marketCapUsd: noValue('not_reported'),
  priceChange24h: noValue('not_reported'),
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
  /* Two coins, and one of them has no cap of its own. Even "the one we can read" would be
     a pick, so this is absent like every other multi-coin row. */
  marketCapUsd: noValue('not_reported'),
  priceChange24h: noValue('not_reported'),
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
        priceChange24h: m(-3.2),
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
        /* No price at all, so nothing to have moved. `no_market` and not `not_reported`:
           the first says nobody has bought it, the second would say a market exists and
           does not publish the figure. */
        priceChange24h: noValue('no_market'),
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
  /* One settled coin, so its cap is the row's. Note this row's AGE is unknown while its
     cap is known — the two absences are independent, and neither is allowed to infect the
     other with a zero. */
  marketCapUsd: m(1_040_000),
  /* Down, while the row's activity graph is broken and its age unknown. Three absences and
     two numbers on one row, none of them infecting another with a zero. */
  priceChange24h: m(-8.1),
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
      priceChange24h: m(-8.1),
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

/* ── the launches rail ────────────────────────────────────────────────── */

/**
 * MINTS, NEWEST FIRST — six of them, and each one is a case the rail has to get right.
 *
 * ★ THREE OF THEM ARE CALLED "JERSEY". That is not filler and it is not a joke: a fifteen
 * second sample of a real mint stream produced three separate tokens with that name, which
 * is the product's entire premise arriving as data. A rail that renders them as three
 * indistinguishable rows is telling the truth about what happened, and the address is the
 * only thing that separates them — which is why it is on the row at all.
 *
 * The cases, in order:
 *   1. a bounded mint time with no cap        — the ordinary new mint
 *   2. a bounded mint time with a cap         — one that has started trading
 *   3. an EXACT mint time                     — a chain confirmation landed, so no "~"
 *   4. a name already truncated by the server — an over-long name, bounded at the source
 *   5. an unknown mint time                   — an age that renders as a dash, not as 0
 *   6. an empty ticker                        — renders as nothing, never as the address
 *
 * Every mint time here is `bounded` unless stated, because that is what a socket-fed
 * pipeline can honestly claim: the event says when we HEARD, and the mint happened at or
 * shortly before that.
 */
const LAUNCHES = [
  {
    launchId: 'solana:9xJerseyA1qP2mNvKdRt7sZbFgHyCwXeUoTiLkMnPq',
    ticker: 'JERSEY',
    name: 'jersey',
    address: '9xJerseyA1qP2mNvKdRt7sZbFgHyCwXeUoTiLkMnPq',
    venueLabel: 'Pump.fun',
    mintedAt: at(T0 - 40_000),
    mintedAtBoundS: 20,
    /* Forty seconds old. There is no pool, so there is no cap — and that is the normal
       state of this rail, not a gap in it. A zero here would say "worthless" about a coin
       whose actual state is "nobody has traded it yet". */
    marketCapUsd: noValue('no_market'),
    marketCapBasis: null,
  },
  {
    launchId: 'solana:4kJerseyB8sV1cQwErTyUiOpAsDfGhJkLzXcVbNm',
    ticker: 'JERSEY',
    name: 'Jersey',
    address: '4kJerseyB8sV1cQwErTyUiOpAsDfGhJkLzXcVbNm',
    venueLabel: 'Pump.fun',
    mintedAt: at(T0 - 3 * MIN),
    mintedAtBoundS: 20,
    marketCapUsd: m(31_400),
    marketCapBasis: 'fully-diluted',
  },
  {
    launchId: 'solana:7mJerseyC3dF5gH9jK2lZ4xC6vB8nM1qW3eR5tY',
    ticker: 'JERSEY',
    /* Same word, third token, and the capitalisation is the only difference in the name.
       Nothing on this rail claims which of the three is "the" jersey coin — that judgement
       is the resolve stage's and it does not run here. */
    name: 'JERSEY',
    address: '7mJerseyC3dF5gH9jK2lZ4xC6vB8nM1qW3eR5tY',
    venueLabel: 'Pump.fun',
    /* ★ EXACT, because a chain confirmation landed for this one: the earliest signature
       against the address is a reading, not an estimate, so there is no bound and the rail
       shows the age with no "~". This is the only row here entitled to that. */
    mintedAt: at(T0 - 11 * MIN),
    mintedAtBoundS: null,
    marketCapUsd: m(88_200),
    marketCapBasis: 'fully-diluted',
  },
  {
    launchId: 'solana:2bLongNameD7fG3hJ5kL8mN0pQ2rS4tU6vW8xY',
    ticker: 'OFFICIAL',
    /* ★ ALREADY TRUNCATED, WITH THE ELLIPSIS THE SERVER PUT THERE. The token was minted
       with a name several kilobytes long; `boundedText` in the projection cut it to 48
       characters before it was ever stored, so this is the longest name the rail can
       receive. The ellipsis is the point: a silently cut name reads as the coin's actual
       name, and a coin apparently called "OFFICIAL SOLANA FOUNDATION TREASU" is a better
       impersonation than the string it came from. */
    name: 'OFFICIAL SOLANA FOUNDATION TREASURY TOKEN DO NOT…',
    address: '2bLongNameD7fG3hJ5kL8mN0pQ2rS4tU6vW8xY',
    venueLabel: 'Pump.fun',
    mintedAt: at(T0 - 24 * MIN),
    mintedAtBoundS: 20,
    marketCapUsd: noValue('no_market'),
    marketCapBasis: null,
  },
  {
    launchId: 'solana:5cNoTimeE9gH1jK3lM5nP7qR9sT1uV3wX5yZ7a',
    ticker: 'LADLE',
    name: 'silent kitchen',
    address: '5cNoTimeE9gH1jK3lM5nP7qR9sT1uV3wX5yZ7a',
    venueLabel: 'Raydium',
    /* ★ AN AGE WE NEVER LEARNED, which renders as a dash and NOT as "0s". This row would
       not survive the projection's own filter today — a coin with no mint time cannot be
       placed in a newest-first list, so it is left out and counted — and it is here anyway,
       because the decoder and the rail must both do the right thing on the day it arrives
       from somewhere else. */
    mintedAt: noTime('not_read_yet'),
    mintedAtBoundS: null,
    marketCapUsd: noValue('no_market'),
    marketCapBasis: null,
  },
  {
    launchId: 'solana:8dNoTickerF2hJ4kL6mN8pQ0rS2tU4vW6xY8zA',
    /* ★ EMPTY, AND IT STAYS EMPTY. An unknown ticker renders as nothing — never as the
       address, never as the name, never as anything else that would look like a ticker to
       a person deciding what to buy. */
    ticker: '',
    name: 'unnamed',
    address: '8dNoTickerF2hJ4kL6mN8pQ0rS2tU4vW6xY8zA',
    venueLabel: 'Pump.fun',
    mintedAt: at(T0 - 51 * MIN),
    mintedAtBoundS: 20,
    marketCapUsd: noValue('no_market'),
    marketCapBasis: null,
  },
];

/**
 * One frame of the rail, as the server would send it.
 *
 * `launches` is the committed order and the client never sorts, so the order here is the
 * order on screen. It is mint order, newest first, which is the only ordering this surface
 * claims — not "biggest first", and a fixture sorted by cap would quietly teach everyone
 * looking at it that it is.
 */
export function fixtureLaunches(): unknown {
  return { tick: 1, launches: LAUNCHES };
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
