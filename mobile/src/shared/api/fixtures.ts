/**
 * SAMPLE DATA FOR THE PHONE APP, written as RAW WIRE PAYLOADS.
 *
 * Two jobs, both reached only through `client.ts`, which imports this module dynamically and
 * only in a dev build — so none of it can ship:
 *
 *   1. Stand in for the read service when `VITE_READ_URL` is unset: `fixtureBoard` and
 *      `fixtureStory` for the feed's stories.
 *   2. Be the Narratives list, which has no read route yet: `sampleNarrativeIds` and the
 *      `nr_` stories behind them.
 *
 * ★ RAW, NOT DECODED. Everything here goes through `decode.ts` like a network response, so a
 * fixture cannot hold a shape the server can never send. That is why the coin the designs
 * label "UNVERIFIED" is not here with a price beside it: on the wire an unsure match carries
 * NO coin (`CoinLink` `unsure`), so a screen that showed one would be designed against a
 * payload that does not exist.
 *
 * ★ EVERY ROW EXERCISES A RULE, as the desktop fixtures do: no coin yet, one tradable coin,
 * one coin that cannot be traded, several coins, an unsure match with no button, a source
 * that reports no view count, and an age nobody has read. Filler would show that the
 * components render; these show they render the hard cases.
 *
 * The stories follow the designs. The names, handles and numbers are invented; the
 * addresses start with SAMPLE so none of them can be mistaken for, or pasted as, a real
 * coin. Each story's picture is a free-licence (CC0 or public domain) stock photo of its
 * subject, served from public/sample/ and credited in public/sample/CREDITS.md — never a
 * screenshot of a real post and never a recognisable person, so nothing here borrows
 * somebody else's post. Coins have no image; their tile shows the ticker's first letter.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Relative to load time, so ages read sensibly whenever the app is opened. */
const T0 = Date.now();

/* ── wire constructors ─────────────────────────────────────────────── */

const m = (v: number): unknown => ({ v });
const noValue = (why: string): unknown => ({ v: null, why });
/* Half a minute further back than asked, so an age written as "2m" reads "2m" on first paint
   rather than flooring to "1m" in the milliseconds between this module loading and rendering. */
const ago = (ms: number): unknown => ({ at: T0 - ms - 30_000 });
const noTime = (why: string): unknown => ({ at: null, why });

/**
 * A climbing curve ending at `to`. Deterministic — `Math.random` would make two loads
 * disagree and any screenshot of them unreproducible. `bend` above one is a curve that is
 * still accelerating; below one, one that is levelling off.
 */
function curve(to: number, windowMs: number, bend = 2, points = 12): unknown {
  const out: { atMs: number; value: number }[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    out.push({
      atMs: T0 - (1 - t) * windowMs,
      value: Math.round(to * (0.25 + 0.75 * t ** bend)),
    });
  }
  return { points: out, windowMs };
}

interface CoinSpec {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly mcap: number;
  readonly liq: number | null;
  readonly price: number;
  readonly change: number | null;
  readonly mintedAgo: number | null;
  readonly tradable: boolean;
}

function coin(c: CoinSpec): unknown {
  return {
    coinId: c.id,
    ticker: c.ticker,
    name: c.name,
    address: `SAMPLE${c.id.replace(/[^a-z0-9]/gi, '')}notarealaddresspump`,
    venueLabel: 'pump.fun',
    imageUrl: null,
    mintedAt: c.mintedAgo === null ? noTime('not_read_yet') : ago(c.mintedAgo),
    priceUsd: m(c.price),
    marketCapUsd: m(c.mcap),
    marketCapBasis: 'fully-diluted',
    liquidityUsd: c.liq === null ? noValue('not_reported') : m(c.liq),
    priceChange24h: c.change === null ? noValue('not_reported') : m(c.change),
    tradable: c.tradable,
  };
}

function post(source: string, author: string, postedAgo: number, excerpt: string, n: number): unknown {
  return {
    evidenceId: `${author}-${n}`,
    sourceLabel: source,
    authorLabel: author,
    permalink: `https://example.invalid/${encodeURIComponent(author)}/${n}`,
    excerpt,
    thumbUrl: null,
    postedAt: ago(postedAgo),
    relation: n === 0 ? 'The earliest post we found.' : 'The same thing, posted again.',
  };
}

/* ── coins ─────────────────────────────────────────────────────────── */

/**
 * Thirteen coins named after one raccoon, which is the product's premise as data. Ordered by
 * the server, biggest first. The first is the biggest and the second was minted earliest, so
 * the page has a fact to label each with; every cap and every mint time is known, which is
 * what lets either label be claimed at all.
 */
const JIMOTHY_COINS = [
  coin({ id: 'c_jimothy_1', ticker: 'JIMOTHY', name: 'Jimothy', mcap: 4_300, liq: 3_400, price: 0.0000043, change: 12.4, mintedAgo: 2 * HOUR, tradable: true }),
  coin({ id: 'c_jimothy_2', ticker: 'JIMOTHY', name: 'Jimothy', mcap: 4_100, liq: 3_300, price: 0.0000041, change: -3.2, mintedAgo: 5 * HOUR, tradable: true }),
  ...[
    ['JIMMY', 1_200], ['RACCOON', 980], ['JIMOTHY', 870], ['DCRACCOON', 640], ['JIM', 560],
    ['REDCAP', 430], ['JIMOTHYDC', 390], ['TRASHPANDA', 310], ['JIMBO', 280], ['WASHJIM', 240],
    ['RACC', 190],
  ].map(([ticker, mcap], i) =>
    coin({
      id: `c_jimothy_${i + 3}`,
      ticker: String(ticker),
      name: String(ticker).charAt(0) + String(ticker).slice(1).toLowerCase(),
      mcap: Number(mcap),
      liq: null,
      price: Number(mcap) / 1_000_000_000,
      change: null,
      mintedAgo: (90 - i * 6) * MIN,
      tradable: false,
    }),
  ),
];

const FERRY = coin({ id: 'c_ferry', ticker: 'FERRY', name: 'Ferry Horn', mcap: 182_000, liq: 41_000, price: 0.000182, change: 38.6, mintedAgo: 3 * HOUR + 40 * MIN, tradable: true });

/** Tradable is false: the server could not get a quote. The row shows its numbers and no button. */
const GERALD = coin({ id: 'c_gerald', ticker: 'GERALD', name: 'Porch Frog Gerald', mcap: 9_800, liq: null, price: 0.0000098, change: null, mintedAgo: null, tradable: false });

/* ── stories ───────────────────────────────────────────────────────── */

interface StorySpec {
  readonly id: string;
  readonly title: string;
  /** A file in public/sample/, credited in public/sample/CREDITS.md. */
  readonly image: string;
  readonly summary: readonly [string, string];
  readonly reach: unknown;
  readonly reachDelta: unknown;
  readonly spark: unknown;
  readonly momentum: 'rising' | 'steady' | 'cooling' | null;
  readonly firstSeen: unknown;
  readonly coins: unknown;
  readonly evidence: readonly unknown[];
}

function story(s: StorySpec): Record<string, unknown> {
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    thumbUrl: `/sample/${s.image}`,
    reach: s.reach,
    reachDelta24h: s.reachDelta,
    spark: s.spark,
    momentum: s.momentum,
    firstSeenAt: s.firstSeen,
    earliestPost: earliestOf(s.evidence),
    coins: s.coins,
    evidence: s.evidence,
    discussion: [],
    /* `observed`, for the reason the desktop fixtures give: the shell's permanent "Sample
       data" notice already says every number here is invented, and a second notice under it
       telling the reader to connect a source would be advice that changes nothing in a build
       with no backend. */
    provenance: { kind: 'observed' },
  };
}

/** The earliest sample post, as the server would send it. Never "started by": a sample proves nothing. */
function earliestOf(evidence: readonly unknown[]): unknown {
  let best: { authorLabel: string; permalink: string; at: number } | null = null;
  for (const e of evidence as readonly { authorLabel: string; permalink: string; postedAt: { at: number | null } }[]) {
    const at = e.postedAt.at;
    if (at !== null && (best === null || at < best.at)) best = { authorLabel: e.authorLabel, permalink: e.permalink, at };
  }
  return best === null ? noTime('not_reported') : { at: best.at, authorLabel: best.authorLabel, permalink: best.permalink, startedBy: null };
}

function board(s: Record<string, unknown>): Record<string, unknown> {
  const { reachDelta24h: _d, evidence: _e, discussion: _x, provenance: _p, earliestPost: _f, ...row } = s;
  const coins = s['coins'] as { kind: string; coin?: { marketCapUsd: unknown; priceChange24h: unknown } };
  return {
    ...row,
    marketCapUsd: coins.kind === 'one' ? coins.coin?.marketCapUsd : noValue(coins.kind === 'none' ? 'not_minted' : 'not_read_yet'),
    priceChange24h: coins.kind === 'one' ? coins.coin?.priceChange24h : noValue('not_read_yet'),
    isNew: false,
  };
}

const FEED_STORIES: readonly Record<string, unknown>[] = [
  story({
    id: 'st_goose',
    image: 'goose.jpg',
    title: 'Goose Steals Ice Cream',
    summary: ["A goose snatched a kid's ice cream cone at a park", 'and ran off with it while the whole family chased it.'],
    reach: m(41_200), reachDelta: m(41_200), spark: curve(41_200, 12 * MIN, 2.4), momentum: 'rising',
    firstSeen: ago(2 * MIN), coins: { kind: 'none' },
    evidence: [post('TikTok', 'parkdays', 2 * MIN, 'he did NOT ask permission', 0)],
  }),
  story({
    id: 'st_reaper',
    image: 'reaper.jpg',
    title: 'Grim Reaper On Hospital Roof',
    summary: ['A man dressed as the Grim Reaper climbed onto a hospital roof and scared patients.', "He'd already been caught stealing kitty litter months earlier."],
    reach: m(74_000), reachDelta: m(74_000), spark: curve(74_000, 20 * MIN, 2.2), momentum: 'rising',
    firstSeen: ago(9 * MIN), coins: { kind: 'none' },
    evidence: [post('X', 'Dexerto', 9 * MIN, 'the grim reaper is back and this time he is on a roof', 0)],
  }),
  story({
    id: 'st_dogbus',
    image: 'dog-bus.jpg',
    title: 'Dog Rides The Bus Alone',
    summary: ['A dog gets on the same bus every morning by itself,', 'rides two stops to the park, and gets off.'],
    reach: m(58_000), reachDelta: m(58_000), spark: curve(58_000, 24 * MIN, 2), momentum: 'rising',
    firstSeen: ago(12 * MIN), coins: { kind: 'none' },
    evidence: [post('X', 'citybuslog', 12 * MIN, 'our most punctual passenger', 0)],
  }),
  story({
    id: 'st_librarycat',
    image: 'library-cat.jpg',
    title: 'Library Cat Gets A Name Tag',
    summary: ['A town library gave its resident cat a name tag and a job title,', 'and people keep visiting just to see it.'],
    reach: m(36_000), reachDelta: m(36_000), spark: curve(36_000, 30 * MIN, 1.6), momentum: 'steady',
    firstSeen: ago(16 * MIN), coins: { kind: 'unsure', claimCount: 4 },
    evidence: [post('Reddit', 'u/stacksandcats', 16 * MIN, 'she has a lanyard now', 0)],
  }),
  story({
    id: 'st_ferry',
    image: 'ferry.jpg',
    title: 'Harbor Last Horn',
    summary: ['A ferry captain blew his horn one last time before retiring,', 'and every boat in the harbour blew theirs back.'],
    reach: m(2_440_000), reachDelta: m(1_100_000), spark: curve(2_440_000, 4 * HOUR, 0.6), momentum: 'steady',
    firstSeen: ago(4 * HOUR), coins: { kind: 'one', coin: FERRY },
    evidence: [post('X', 'nordkyst_ferge', 4 * HOUR, 'siste tur. takk for alt.', 0)],
  }),
  story({
    id: 'st_jimothy',
    image: 'raccoon.jpg',
    title: 'Jimothy Heads To DC',
    summary: ['The White House posted a raccoon in a red cap sprinting down a path,', 'captioned "Jimothy on the way to Washington".'],
    reach: m(681_000), reachDelta: m(512_000), spark: curve(681_000, 6 * HOUR, 1.4), momentum: 'rising',
    firstSeen: ago(6 * HOUR), coins: { kind: 'several', coins: JIMOTHY_COINS },
    evidence: [post('X', 'WhiteHouse', 6 * HOUR, 'Jimothy spotted on the way to Washington D.C.', 0)],
  }),
  story({
    id: 'st_seal',
    image: 'seal.jpg',
    title: 'Seal Keeps The Sunglasses',
    summary: ['A seal grabbed the sunglasses a tourist dropped on the dock', 'and has been wearing them on the rocks ever since.'],
    reach: m(1_200_000), reachDelta: m(900_000), spark: curve(1_200_000, 3 * HOUR, 1.3), momentum: 'rising',
    firstSeen: ago(3 * HOUR), coins: { kind: 'none' },
    evidence: [post('Instagram', 'harbourseals', 3 * HOUR, 'he is not giving them back', 0)],
  }),
  story({
    id: 'st_frog',
    image: 'frog.jpg',
    title: 'Porch Frog Gerald',
    summary: ['The same frog turns up on one porch every time it rains.', 'The owner named him Gerald and posts every visit.'],
    reach: m(740_000), reachDelta: m(300_000), spark: curve(740_000, 5 * HOUR, 1), momentum: 'cooling',
    firstSeen: ago(5 * HOUR), coins: { kind: 'one', coin: GERALD },
    evidence: [post('Reddit', 'u/geraldsporch', 5 * HOUR, 'Gerald is back. It is raining.', 0)],
  }),
  /* A source that reports no view count, and a story whose start nobody read. Both render as
     a dash with a reason — never as 0 views, never as "brand new". */
  story({
    id: 'st_troll',
    image: 'troll.jpg',
    title: 'Bridge Troll Statue Gets A Hat',
    summary: ['Someone has been knitting seasonal hats for the troll statue under the bridge,', 'and nobody knows who.'],
    reach: noValue('not_reported'), reachDelta: noValue('not_reported'),
    spark: { points: [], windowMs: HOUR }, momentum: null,
    firstSeen: noTime('not_read_yet'), coins: { kind: 'none' },
    evidence: [post('YouTube', 'troll_watch', 40 * MIN, 'the autumn hat has arrived', 0)],
  }),
];

/* ── narratives (sample only) ──────────────────────────────────────── */

function posts(spec: readonly (readonly [string, string])[], newestAgo: number, oldestAgo: number, excerpt: string): unknown[] {
  return spec.map(([source, author], i) =>
    post(source, author, oldestAgo - ((oldestAgo - newestAgo) * i) / Math.max(1, spec.length - 1), excerpt, i),
  );
}

const NARRATIVES: readonly Record<string, unknown>[] = [
  story({
    id: 'nr_jimothy',
    image: 'raccoon.jpg',
    title: 'Jimothy',
    summary: ['The White House posted a raccoon in a red cap sprinting down a path, captioned "Jimothy on the way to Washington".', 'People are reposting it with their own edits.'],
    reach: m(3_300_000), reachDelta: m(2_100_000), spark: curve(3_300_000, 6 * HOUR, 1.6), momentum: 'rising',
    firstSeen: ago(6 * HOUR), coins: { kind: 'several', coins: JIMOTHY_COINS },
    evidence: posts(
      [['X', 'WhiteHouse'], ['X', 'dcraccoonwatch'], ['TikTok', 'jimothyedits'], ['X', 'potus_pets'], ['TikTok', 'redcapclips'],
        ['X', 'capitolcritters'], ['TikTok', 'raccoonrunz'], ['X', 'beltwaybeasts'], ['TikTok', 'jimothyfan']],
      20 * MIN, 6 * HOUR, 'Jimothy spotted on the way to Washington D.C.',
    ),
  }),
  story({
    id: 'nr_ferry',
    image: 'ferry.jpg',
    title: 'Ferry Horn',
    summary: ["A retiring ferry captain's last horn, answered by every boat in the harbour.", 'People are posting it from different angles.'],
    reach: m(4_100_000), reachDelta: m(1_900_000), spark: curve(4_100_000, 4 * HOUR, 0.6), momentum: 'steady',
    firstSeen: ago(4 * HOUR), coins: { kind: 'one', coin: FERRY },
    evidence: posts(
      [['X', 'nordkyst_ferge'], ['X', 'harbourdaily'], ['TikTok', 'boatsdaily'], ['Instagram', 'fjordlife'], ['X', 'maritimeclips'],
        ['TikTok', 'hornsound'], ['Instagram', 'portviews'], ['X', 'captainsdesk'], ['TikTok', 'lastvoyage'], ['X', 'shipspotter'],
        ['Instagram', 'harbourlights'], ['TikTok', 'ferryfans'], ['X', 'nordicnews'], ['Instagram', 'tugboatdiary']],
      15 * MIN, 4 * HOUR, 'every boat answered',
    ),
  }),
  story({
    id: 'nr_reaper',
    image: 'reaper.jpg',
    title: 'Grim Reaper',
    summary: ['A man in a Grim Reaper costume on a hospital roof,', 'the same guy caught stealing kitty litter months ago.'],
    reach: m(1_100_000), reachDelta: m(1_100_000), spark: curve(1_100_000, 2 * HOUR, 1.8), momentum: 'rising',
    firstSeen: ago(2 * HOUR), coins: { kind: 'none' },
    evidence: posts([['X', 'Dexerto'], ['X', 'localnews9'], ['X', 'weirdheadlines']], 30 * MIN, 2 * HOUR, 'he is on the roof again'),
  }),
  story({
    id: 'nr_gerald',
    image: 'frog.jpg',
    title: 'Gerald',
    summary: ['A frog shows up on the same porch every rainstorm.', 'The owner named him Gerald and posts every visit.'],
    reach: m(920_000), reachDelta: m(240_000), spark: curve(920_000, 5 * HOUR, 0.9), momentum: 'cooling',
    firstSeen: ago(5 * HOUR), coins: { kind: 'unsure', claimCount: 2 },
    evidence: posts(
      [['Reddit', 'u/geraldsporch'], ['X', 'frogfacts'], ['Reddit', 'u/rainyporch'], ['Reddit', 'u/amphibianfan'], ['X', 'weatherfrogs']],
      40 * MIN, 5 * HOUR, 'Gerald is back',
    ),
  }),
];

/* ── what the client asks for ──────────────────────────────────────── */

const BY_ID = new Map([...FEED_STORIES, ...NARRATIVES].map((s) => [String(s['id']), s]));

/**
 * The board, as the read service would send it. The order is committed here and the client
 * never sorts it — and it is deliberately not the views order, because the ranking is not
 * "biggest first" and a fixture sorted by size would teach everyone looking that it is.
 */
export function fixtureBoard(): unknown {
  return {
    tick: 1,
    order: FEED_STORIES.map((s) => s['id']),
    rows: FEED_STORIES.map(board),
    provenance: { kind: 'observed' },
  };
}

/** One story page, or null — which the client turns into a 404, never an invented page. */
export function fixtureStory(storyId: string): unknown | null {
  return BY_ID.get(storyId) ?? null;
}

/** The Narratives list, in its order. */
export function sampleNarrativeIds(): readonly string[] {
  return NARRATIVES.map((s) => String(s['id']));
}

/* ── the For You and Popular feeds (sample) ────────────────────────── */

/**
 * The sample feeds of single posts: each sample feed story's one post, with that story's
 * picture, views and line. A coin only when the sample story names exactly one — the same
 * rule the server applies — and never otherwise. The "Sample data" notice covers these as it
 * covers the board.
 */
export function fixtureRising(feed: 'fyp' | 'popular'): unknown {
  const posts = FEED_STORIES.map((s) => {
    const lead = (s['evidence'] as readonly Record<string, unknown>[])[0] ?? {};
    const coins = s['coins'] as { kind: string };
    const confident = coins.kind === 'one';
    return {
      id: `${String(s['id'])}:post`,
      sourceLabel: lead['sourceLabel'],
      authorLabel: lead['authorLabel'],
      permalink: lead['permalink'],
      excerpt: lead['excerpt'],
      thumbUrl: s['thumbUrl'],
      postedAt: lead['postedAt'],
      reach: s['reach'],
      readAt: s['firstSeenAt'],
      spark: s['spark'],
      storyId: confident ? s['id'] : null,
      coins: confident ? coins : null,
    };
  });
  const at = (p: Record<string, unknown>): number => ((p['postedAt'] as { at?: number }).at ?? 0);
  const views = (p: Record<string, unknown>): number | null => ((p['reach'] as { v?: number | null }).v ?? null);
  const ordered =
    feed === 'fyp'
      ? [...posts].sort((a, b) => at(b) - at(a))
      : [...posts].sort((a, b) => {
          const va = views(a);
          const vb = views(b);
          if (va === null || vb === null) return va === null ? (vb === null ? 0 : 1) : -1;
          return vb - va;
        });
  return { tick: 1, posts: ordered };
}
