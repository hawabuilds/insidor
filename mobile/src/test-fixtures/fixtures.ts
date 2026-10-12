/**
 * RECORDED DATA FOR THE PHONE APP'S TESTS, written as RAW WIRE PAYLOADS. Tests only: nothing in
 * the app imports this folder, and src/no-sample-data.test.ts fails the build's tests if
 * anything reachable from main.tsx ever does. The app shows the read service or an honest empty
 * state, never these.
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
  /** Where the sample coin came from; absent is not checked. Sample, like everything here. */
  readonly origin?: { readonly kind: string; readonly author: string; readonly offsetMs: number };
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
    origin:
      c.origin === undefined
        ? { kind: 'unknown', why: 'not_read_yet' }
        : {
            kind: c.origin.kind,
            post: { authorLabel: c.origin.author, permalink: `https://example.invalid/${c.origin.author}/origin`, postedAt: ago((c.mintedAgo ?? 0) - c.origin.offsetMs) },
            offset: m(c.origin.offsetMs),
          },
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
  coin({ id: 'c_jimothy_2', ticker: 'JIMOTHY', name: 'Jimothy', mcap: 4_100, liq: 3_300, price: 0.0000041, change: -3.2, mintedAgo: 5 * HOUR, tradable: true, origin: { kind: 'afterLaunch', author: 'whitehouse', offsetMs: 2 * HOUR } }),
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

const FERRY = coin({ id: 'c_ferry', ticker: 'FERRY', name: 'Ferry Horn', mcap: 182_000, liq: 41_000, price: 0.000182, change: 38.6, mintedAgo: 3 * HOUR + 40 * MIN, tradable: true, origin: { kind: 'matchedByInsidor', author: 'nordkyst_ferge', offsetMs: -25 * MIN } });

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
 * picture, views and line. Each carries its sample story's coin link and id — the same rule
 * the server applies when a post is part of a narrative. The "Sample data" notice covers these as it
 * covers the board.
 */
export function fixtureRising(feed: 'fyp' | 'popular'): unknown {
  const posts = FEED_STORIES.map((s) => {
    const lead = (s['evidence'] as readonly Record<string, unknown>[])[0] ?? {};
    const coins = s['coins'] as { kind: string };
    return {
      id: `${String(s['id'])}:post`,
      sourceLabel: lead['sourceLabel'],
      authorLabel: lead['authorLabel'],
      permalink: lead['permalink'],
      excerpt: lead['excerpt'],
      thumbUrl: s['thumbUrl'],
      thumbIsVideo: false,
      postedAt: lead['postedAt'],
      reach: s['reach'],
      readAt: s['firstSeenAt'],
      spark: s['spark'],
      /* The story decides: its own link, with its id, unless it has not been searched. */
      storyId: coins.kind === 'pending' ? null : s['id'],
      coins,
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

/* ── a coin's market (sample) ───────────────────────────────────────── */

/** Every sample coin by id, wherever it appears. */
function sampleCoins(): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const s of BY_ID.values()) {
    const link = s['coins'] as { kind: string; coin?: Record<string, unknown>; coins?: Record<string, unknown>[] };
    for (const c of [...(link.coin ? [link.coin] : []), ...(link.coins ?? [])]) out.set(String(c['coinId']), c);
  }
  return out;
}

/** A small deterministic generator, so one coin draws the same sample chart every time. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const STEP: Record<string, number> = { '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN, '1h': HOUR, '4h': 4 * HOUR, '1D': 24 * HOUR };

/**
 * A sample coin's market, as the read service would send it: 48 candles ending at its price
 * (the one-minute view drifts down and the rest up, so both colours show), four trades with no
 * transaction — a made-up signature is one copy-paste from being looked up as real — and, for
 * a coin under $69K, curve progress. An unknown coin is `unavailable`, never an empty market.
 */
export function fixtureMarket(coinId: string, timeframe: string): unknown {
  const coin = sampleCoins().get(coinId);
  const price = (coin?.['priceUsd'] as { v?: number } | undefined)?.v;
  if (coin === undefined || price === undefined) return { kind: 'unavailable', timeframe };
  const rand = seeded(`${coinId}:${timeframe}`);
  const drift = timeframe === '1m' ? -0.012 : 0.03;
  const step = STEP[timeframe] ?? MIN;
  const closes: number[] = [price];
  for (let i = 1; i < 48; i += 1) closes.push((closes[i - 1] ?? price) / (1 + drift + (rand() - 0.5) * 0.06));
  closes.reverse();
  const candles = closes.map((c, i) => {
    const o = closes[i - 1] ?? c;
    return { t: T0 - (closes.length - i) * step, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c };
  });
  const trade = (side: 'buy' | 'sell', agoMs: number, tokens: number, usd: number) => ({ tx: null, side, tokenAmount: m(tokens), usd: m(usd), priceUsd: m(usd / tokens), at: ago(agoMs) });
  const mcap = (coin['marketCapUsd'] as { v?: number } | undefined)?.v ?? 0;
  return {
    kind: 'read',
    timeframe,
    venue: mcap < 69_000 ? 'curve' : 'pool',
    candles,
    trades: [trade('buy', 12_000, 1_200_000, 5.16), trade('sell', 41_000, 640_000, 2.75), trade('buy', MIN, 4_800_000, 20.6), trade('buy', 2 * MIN, 800_000, 3.44)],
    curveProgress: mcap < 69_000 ? m(Math.round((0.05 + rand() * 0.4) * 1000) / 1000) : null,
  };
}

/* ── the Search tab (sample) ───────────────────────────────────────── */

type Raw = Record<string, unknown>;

function searchCoinsOf(story: Raw): readonly Raw[] {
  const coins = story['coins'] as Raw;
  if (coins['kind'] === 'one') return [coins['coin'] as Raw];
  if (coins['kind'] === 'several') return coins['coins'] as readonly Raw[];
  return [];
}

/**
 * A search over the sample stories, in the read service's shape: their titles, their posts and
 * their coins, one of each, as the server dedupes them. Every coin here is one a sample story names, so each is "matched" to it; the
 * "Sample data" notice covers the whole screen.
 */
export function fixtureSearch(term: string): unknown {
  const t = term.trim().replace(/^\$+/, '').toLowerCase();
  const stories = [...BY_ID.values()];
  const hits = stories.filter((s) => String(s['title']).toLowerCase().includes(t) || searchCoinsOf(s).some((c) => String(c['ticker']).toLowerCase() === t));
  return {
    term: t,
    narratives: {
      capped: false,
      items: hits.map((s, i) => {
        const coins = searchCoinsOf(s);
        return {
          storyId: String(s['id']),
          title: s['title'],
          thumbUrl: s['thumbUrl'] ?? null,
          live: i % 2 === 0,
          firstPostAt: { at: (s['earliestPost'] as Raw)['at'] ?? null, why: 'not_read_yet' },
          firstCoinAt: coins.length === 0 ? { at: null, why: 'not_minted' } : (coins[0]?.['mintedAt'] ?? { at: null, why: 'not_reported' }),
          peakMarketCapUsd: coins.length === 0 ? { v: null, why: 'not_minted' } : (coins[0]?.['marketCapUsd'] ?? { v: null, why: 'not_read_yet' }),
        };
      }),
    },
    posts: {
      capped: false,
      items: stories.flatMap((s) => (s['evidence'] as readonly Raw[]).filter((e) => String(e['excerpt']).toLowerCase().includes(t)).map((e) => ({
        id: String(e['evidenceId']),
        sourceLabel: e['sourceLabel'],
        authorLabel: e['authorLabel'],
        permalink: null,
        excerpt: e['excerpt'],
        thumbUrl: e['thumbUrl'] ?? null,
        postedAt: e['postedAt'],
        live: false,
      }))).filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i).slice(0, 10),
    },
    coins: {
      kind: 'read',
      capped: false,
      sourcesMissing: 0,
      items: hits.flatMap((s) => searchCoinsOf(s).map((c) => ({
        coinId: c['coinId'],
        address: c['address'],
        name: c['name'],
        ticker: c['ticker'],
        imageUrl: c['imageUrl'] ?? null,
        marketCapUsd: c['marketCapUsd'],
        launchedAt: c['mintedAt'],
        venue: 'curve',
        curveProgress: { v: 0.42 },
        matched: { storyId: String(s['id']), title: s['title'] },
      }))).filter((c, i, all) => all.findIndex((d) => d.coinId === c.coinId) === i),
    },
  };
}

/** A sample coin opened from search, or null — a 404, never an invented coin. */
export function fixtureSearchedCoin(coinId: string): unknown | null {
  for (const s of BY_ID.values()) {
    for (const c of searchCoinsOf(s)) {
      if (c['coinId'] === coinId) {
        return { coinId, address: c['address'], name: c['name'], ticker: c['ticker'], imageUrl: c['imageUrl'] ?? null, marketCapUsd: c['marketCapUsd'], launchedAt: c['mintedAt'], venue: 'curve' };
      }
    }
  }
  return null;
}
