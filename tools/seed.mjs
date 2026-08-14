#!/usr/bin/env node
/**
 * SIX STORIES, WRITTEN AS DOMAIN FACTS AND NOTHING ELSE.
 *
 *   node tools/seed.mjs        (or: pnpm db:seed)
 *
 * ★ WHAT THIS FILE IS NOT ALLOWED TO WRITE, AND WHY THAT IS THE POINT.
 *
 * It writes into `public.` only: author, item, item_fingerprint, observation,
 * story, story_member, asset. It writes NO projection row (board_view, board_row,
 * story_view) and NO internal row (decisions, labels, stage_runs). Not because
 * those are inconvenient — because a seed that writes the projection proves
 * nothing. The end-to-end claim is:
 *
 *     seed writes facts  →  services/project derives the wire JSON  →
 *     services/read selects that JSON as the app role and returns it verbatim
 *
 * If the seed wrote the board, the middle arrow would be untested and the leak
 * guarantee would be a comment. So every wire field the app renders has to be
 * *derivable* from what is below, and where it is not derivable the honest
 * projection is an absence with a reason — which is exactly what the vocabulary
 * is for.
 *
 * These are the six rows of app/src/shared/api/fixtures.ts, ported to real rows.
 * The fixture's numbers are described in its own header as "illustrative and not
 * measurements of anything"; the numbers here are internally consistent instead,
 * so the projector's arithmetic is checkable by hand:
 *
 *     wire reach          == the newest observation's rate_level, summed over members
 *     wire spark.points[] == { atMs: captured_at, value: rate_level }
 *     wire momentum       == derived from rate_per_min early-window vs late-window
 *
 * `rate_level` is NULL on every censored row — migration 0003's constraint
 * `censored_rate_carries_only_a_level` makes that an invariant, not a convention —
 * so "a censored reading is a null point, never a zero" falls out of the schema
 * rather than out of the projector remembering.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★ HOW A STORY GETS LINKED TO A COIN, since there is no story↔asset table and
 *   there must not be one (the link is a judgement, and judgements live in
 *   internal.decisions). Both steps read only public rows:
 *
 *   CANDIDATE (which coins are even in the running)
 *     the asset shares at least one normalised token with one of the story's
 *     `entitySpan` fingerprints. Retrieval is TIME-FIRST where a time exists —
 *     asset.minted_at inside the window opening at story.earliest_post_at — but
 *     text is what keeps a coin minted in the same minute as an unrelated story
 *     out of that story's list.
 *
 *   CONFIDENT (which coins we are willing to name)
 *     the asset's normalised `symbol` OR normalised `name` is EQUAL to one of
 *     those spans. Equal, not overlapping. "soup" overlapping "throws the soup"
 *     is how you confidently return the wrong one of 306 tokens sharing a ticker.
 *
 *   So the CoinLink tag falls straight out of the counts:
 *     0 candidates                        → none      (st_pigeon)
 *     1 confident                         → one       (st_ferry, st_rooftop)
 *     ≥2 confident                        → several   (st_chillguy, st_dance)
 *     ≥1 candidate and 0 confident        → unsure    (st_soup)  ← nothing here says "unsure"
 *
 *   st_soup is the case worth checking by hand. Its six coins are SOUP, SOUPGATE,
 *   HOTSOUP, SOUPCHEF, THESOUP and LADLE/"silent kitchen"; its spans are
 *   "throws the soup", "kitchen goes silent" and "nine second clip". Every coin
 *   overlaps. None matches. On top of that every one of the six carries
 *   minted_at_source = 'vendor_field' with minted_at_conf = 'bounded' and a
 *   half-width of 1800 seconds — a ±30-minute bound against a measured 3.8-minute
 *   median post-to-mint lag, so the ordering gate cannot separate them either,
 *   and 0005's `exact_requires_real_source` makes it impossible for a vendor
 *   field to ever claim otherwise. Two of them declare the seed author's own
 *   handle in `declared_social`, which is the impersonation that column is named
 *   as a warning about. Three independent reasons, all of them rows.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★ WHAT THE PROJECTOR WILL FIND MISSING, and must project as an absence:
 *
 *   - public.asset has NO price, market-cap or liquidity column, deliberately:
 *     those are market readings, not properties of a coin. Until a market adapter
 *     writes them, every coin projects priceUsd/marketCapUsd as `no_market`,
 *     liquidityUsd as `not_reported`, marketCapBasis as null and `tradable` as
 *     false — `tradable` is decided by getting a quote, and there is nothing here
 *     to quote against. That is the fixture's own "minted but never traded"
 *     shape, and it is honest rather than a gap.
 *   - There is no summary column anywhere. The two summary lines are composed by
 *     the projector out of facts it can count (members, distinct authors,
 *     distinct sources, coin count, oldest mint time). That is the right place
 *     for them: a stored sentence is a judgement nobody can re-derive.
 *   - `story.display_title` IS written here. In production the qualify stage
 *     writes it from a judgement; locally the seed stands in for that stage,
 *     because it is a column on public.story and the board has no title without
 *     it. `thumb_uri` is left NULL on all six — 0004 says null is a legitimate
 *     long-term state, not a gap to fill with a placeholder.
 *   - `item.counters` is left as the empty default on purpose. 0002 calls it a
 *     cache and not the record. A projector that reads it instead of differencing
 *     public.observation is the bug this whole schema is arranged against, so the
 *     seed leaves it with nothing in it to read.
 *   - raw.capture is not written. `item.raw_ref` points into it by convention and
 *     there is no foreign key; the seed stays inside public/ as instructed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCE, and the one ugly bit.
 *
 * Everything runs in a single transaction that deletes what the seed owns and
 * re-inserts it. public.observation cannot be deleted from — 0003 attaches
 * internal.forbid_mutation() as a BEFORE DELETE row trigger, and a cascade from
 * public.item fires it too — so it is TRUNCATEd instead. 0001 says out loud that
 * this is the sanctioned escape hatch: "DROP PARTITION and TRUNCATE are DDL and
 * do not fire row triggers... dropping a whole closed day is a policy, editing
 * one row is a lie." TRUNCATE is transactional here like everything else, and
 * locally this seed is the only writer the table has ever had.
 */

import { createHash } from 'node:crypto';

import { connect, redact, databaseUrl } from './lib/pgclient.mjs';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Anchored to load time so ages read sensibly, and to the minute so re-reads are tidy. */
const T0 = Math.floor(Date.now() / MIN) * MIN;
const ago = (ms) => new Date(T0 - ms);

/* ── text ─────────────────────────────────────────────────────────────────
   One normalisation, used for entity spans, tickers and coin names alike. A
   second spelling of "the same words" is how a match becomes unreproducible. */

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/* ── carrier bits ─────────────────────────────────────────────────────────
   Deterministic, so two runs produce the same fingerprints and a carrier
   distance recorded on a membership row is checkable against the bits it claims
   to describe rather than being a number somebody typed. */

function bits(seed, width) {
  let out = '';
  for (let round = 0; out.length < width; round += 1) {
    for (const byte of createHash('sha256').update(`${seed}#${round}`).digest()) {
      out += byte.toString(2).padStart(8, '0');
    }
  }
  return out.slice(0, width);
}

/** `base` with exactly `n` bits flipped, chosen deterministically from `salt`. */
function nearBits(base, n, salt) {
  const chars = [...base];
  const picks = new Set();
  for (let round = 0; picks.size < n; round += 1) {
    for (const byte of createHash('sha256').update(`${salt}!${round}`).digest()) {
      picks.add((byte * 257 + picks.size) % chars.length);
      if (picks.size >= n) break;
    }
  }
  for (const i of picks) chars[i] = chars[i] === '0' ? '1' : '0';
  return chars.join('');
}

/* ── level series ─────────────────────────────────────────────────────────
   A counter is cumulative, so a series is a list of LEVELS. Rates are
   differenced out of it below rather than being invented beside it — a rate that
   does not equal the difference of the two levels either side of it is a number
   with no referent, and the whole product is differences. */

/** Quadratic ease-IN: increments grow. This is what "rising" looks like on a counter. */
const risingLevels = (from, to, n) =>
  Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : i / (n - 1);
    return Math.round(from + (to - from) * t * t);
  });

/** Linear. Increments constant, so the rate is flat and momentum reads "steady". */
const steadyLevels = (from, to, n) =>
  Array.from({ length: n }, (_, i) => Math.round(from + (to - from) * (n === 1 ? 1 : i / (n - 1))));

/**
 * st_rooftop, written out rather than generated, because two properties have to
 * be exactly true and a formula would only approximately deliver them.
 *
 *   1. THE FOUR FLAT READS IN THE MIDDLE. The source rounds to three significant
 *      digits, so at ~1.05M its bucket is 10,000 wide. Four consecutive reads
 *      return the same bucket: the counter moved, we could not see how much, and
 *      the honest record is censored = 'below_step' with rate_level NULL. The
 *      seed does not assert that — it writes equal levels and the censoring is
 *      computed from them, the same way the tracker would compute it.
 *   2. COOLING WITH A RISING LEVEL. The early increments are 55,000 per 2 minutes
 *      (27,500/min) and the late ones are 10,000 per 2 minutes (5,000/min). The
 *      counter never falls — counters do not fall — and the story is cooling
 *      anyway. A projector that reads momentum off the level instead of the rate
 *      gets this row wrong, which is the point of including it.
 */
const ROOFTOP_LEVELS = [
  830_000, 885_000, 930_000, 965_000, 990_000, 1_010_000, 1_020_000,
  1_030_000, 1_040_000, 1_050_000,
  /* four reads that told us nothing — same bucket as the one before */
  1_050_000, 1_050_000, 1_050_000, 1_050_000,
  1_060_000, 1_070_000, 1_080_000, 1_090_000, 1_100_000, 1_110_000, 1_120_000,
];

/* ── fidelity by source ───────────────────────────────────────────────────
   Not "by platform": by what the platform's counter actually does. `lag_ms` is
   set only where the source admits its own staleness, per 0003. */

const FIDELITY = {
  x: { kind: 'exact', digits: null, lagMs: null },
  /* Rounds to three significant digits and stamps its payload ~45s stale. */
  tiktok: { kind: 'quantized', digits: 3, lagMs: 45_000 },
  reach_absent: { kind: 'absent', digits: null, lagMs: null },
  reddit: { kind: 'exact', digits: null, lagMs: null },
};

/* ── authors ──────────────────────────────────────────────────────────────
   author_key is '<source>:<stable id>' — the shape PgItemRepo#ensureAuthor
   enforces with a TypeError. Keyed by the source's own id, never the handle:
   0002 says handles are renamed and reused, and a renamed handle silently
   re-attributes every item its old owner ever posted. Reddit accounts carry no
   follower count here, and the pair (count, observed_at) is null together —
   a count with no clock is a number nobody can age. */

const AUTHORS = [
  ['x:1001', 'x', '1001', 'Ferry Watch', '@localferrywatch', 12_400],
  ['x:1002', 'x', '1002', 'Harbour Daily', '@harbourdaily', 184_000],
  ['x:1003', 'x', '1003', 'dock refuser', '@dockrefuser', 310],
  ['x:1004', 'x', '1004', 'moodboardz', '@moodboardz', 41_200],
  ['x:1005', 'x', '1005', 'sweater dog', '@sweaterdog', 8_800],
  ['x:1006', 'x', '1006', 'art reposts', '@artreposts', 76_500],
  ['x:1007', 'x', '1007', 'kitchen fails', '@kitchenfails', 54_300],
  ['x:1008', 'x', '1008', 'soup truther', '@souptruther', 940],
  ['x:1009', 'x', '1009', 'bus bird watch', '@busbirdwatch', 2_100],
  ['x:1010', 'x', '1010', 'local transit', '@localtransit', 47_800],
  ['tiktok:2001', 'tiktok', '2001', 'Boats of Instagram', '@boatsofinstagram', 92_000],
  ['tiktok:2002', 'tiktok', '2002', 'chill clips', '@chillclips', 220_000],
  ['tiktok:2003', 'tiktok', '2003', 'line cook diaries', '@linecookdiaries', 133_000],
  ['tiktok:2004', 'tiktok', '2004', 'commuter clips', '@commuterclips', 63_000],
  ['tiktok:2005', 'tiktok', '2005', 'diy fails', '@diyfails', 410_000],
  ['tiktok:2006', 'tiktok', '2006', 'roof projects', '@roofprojects', 15_600],
  ['tiktok:2007', 'tiktok', '2007', 'slide watch', '@slidewatch', 1_200],
  ['reddit:3001', 'reddit', '3001', 'dancing_gran', 'dancing_gran', null],
  ['reddit:3002', 'reddit', '3002', 'videoclips_daily', 'videoclips_daily', null],
  ['reddit:3003', 'reddit', '3003', 'family_archive', 'family_archive', null],
];

/* ── the six stories ──────────────────────────────────────────────────────
   Each one is here because it renders a rule, not because it fills a row. The
   `why` on each is the rule.

   `members[].evidence` is the flattened MatchEvidence union of 0004, and all
   five variants appear across the six stories, because a discriminator that is
   only ever written with one value is a discriminator nobody has tested the
   CHECK constraints of. */

const STORIES = [
  {
    /* CASE 1 — NOTHING MINTED. Zero candidates → `none` → the row shows Create.
       The trap this row sets: st_chillguy's CHILL is minted 9 minutes ago, which
       is inside this story's window. A projector that generates candidates by
       time alone attaches it here and offers a stranger's coin. Nothing in
       "pigeon rides the same bus" shares a token with "chill", so the text step
       is what keeps this row honest. */
    id: 'st_pigeon',
    title: 'Pigeon rides the same bus every morning, driver names it',
    /* ★ NO STOP WORD IN EITHER SPAN, and that is load-bearing rather than
       stylistic. The candidate step is a token overlap, so a span containing
       "the" makes every coin whose name contains "the" — st_soup's THESOUP, for
       one — a candidate here, and this row would project to `unsure` instead of
       `none`. Both spans are content words only, so this story genuinely has
       zero candidates and the row can honestly show Create. */
    spans: ['bus pigeon', 'pigeon commute'],
    earliestPost: 11 * MIN,
    reach: { shape: 'rising', from: 400, to: 71_400 },
    rebroadcast: { from: 40, to: 340 },
    imageSeed: 'pigeon-bus-clip',
    members: [
      {
        id: 'it_pigeon_1', author: 'x:1009', sourceItemId: '1770000000000000001',
        posted: 11 * MIN, weight: 0.55, lang: 'en',
        body: 'the bus pigeon is on the same route every morning and the driver has started calling it Kevin',
        evidence: { kind: 'seed' },
      },
      {
        id: 'it_pigeon_2', author: 'x:1010', sourceItemId: '1770000000000000002',
        posted: 8 * MIN, weight: 0.25, lang: 'en',
        body: 'bus pigeon has a name now',
        rebroadcastOf: 'it_pigeon_1',
        /* A rebroadcast adds ZERO new authorship. 0002 keeps it in a different
           column from a reproduction for exactly that reason. */
        evidence: { kind: 'lineage', via: 'rebroadcast', toItem: 'it_pigeon_1' },
      },
      {
        id: 'it_pigeon_3', author: 'tiktok:2004', sourceItemId: '7460000000000000003',
        posted: 6 * MIN, weight: 0.2, lang: 'en',
        body: 'the bus pigeon commute continues, day 40',
        evidence: { kind: 'carrier', carrierKind: 'imageHash', distance: 6, weight: 0.81 },
      },
    ],
    assets: [],
  },

  {
    /* CASE 2 — ONE CONFIDENT MATCH. The coin's name normalises to exactly the
       span "refuses to dock", it was minted 6 minutes after the earliest post,
       and its mint time came from the chain rather than a market vendor, so 0005
       lets it claim 'exact'. One confident candidate → `one` → the row shows Buy. */
    id: 'st_ferry',
    title: 'Ferry captain refuses to dock, three-hour standoff',
    spans: ['refuses to dock', 'dock'],
    earliestPost: 2 * HOUR + 41 * MIN,
    reach: { shape: 'rising', from: 9_000, to: 486_000 },
    rebroadcast: { from: 120, to: 1_200 },
    imageSeed: 'ferry-standoff-clip',
    members: [
      {
        id: 'it_ferry_1', author: 'x:1001', sourceItemId: '1',
        posted: 2 * HOUR + 41 * MIN, weight: 0.3, lang: 'en',
        body: 'he has been sat out there for three hours now and he is not moving. the captain refuses to dock',
        evidence: { kind: 'seed' },
      },
      {
        id: 'it_ferry_2', author: 'x:1002', sourceItemId: '2',
        posted: 2 * HOUR + 12 * MIN, weight: 0.45, lang: 'en',
        body: 'THREE HOURS. the captain simply said no. he refuses to dock',
        reproductionOf: 'it_ferry_1',
        /* A reproduction adds ONE new author. This is the join that turned a
           local clip into a national one, and it is a pointer, not a score. */
        evidence: { kind: 'lineage', via: 'reproduction', toItem: 'it_ferry_1' },
      },
      {
        id: 'it_ferry_3', author: 'tiktok:2001', sourceItemId: '3',
        posted: 1 * HOUR + 50 * MIN, weight: 0.2, lang: 'en',
        body: 'refuses to dock 😭',
        /* The cross-platform join, done on image bits. No language, no vendor,
           no model — this is the tier that is free and works on day one. */
        evidence: { kind: 'carrier', carrierKind: 'imageHash', distance: 4, weight: 0.88 },
      },
      {
        id: 'it_ferry_4', author: 'x:1003', sourceItemId: '4',
        posted: 2 * HOUR + 30 * MIN, weight: 0.05, lang: 'en',
        body: 'refuses to dock is now a coin, ca in bio',
        evidence: { kind: 'carrier', carrierKind: 'entitySpan', key: 'refuses to dock', weight: 0.94 },
      },
    ],
    assets: [
      {
        address: '4kLmNq7wR2vTbYxEuHgJcZaPsDiOfQnXvMmZbCyVdRt8',
        venue: 'pumpfun', symbol: 'DOCK', name: 'refuses to dock',
        minted: 2 * HOUR + 35 * MIN, source: 'chain_rpc', conf: 'exact', boundS: null,
        decimals: 6, creator: 'Hq3vRt8yUeWq2mNbVcXzAsDfGhJkLpOiUyTrEwQ1234',
        social: { x: 'https://x.com/dockcoin' },
      },
    ],
  },

  {
    /* CASE 3 — ONE MEME, THREE TOKENS. All three names/symbols normalise onto a
       span, so all three are confident → `several` → the row shows Compare.
       ★ The third has NO mint time at all (source 'none', conf 'unknown', which
       0005's `unknown_iff_absent` forces to travel together). It is therefore
       invisible to a time-first candidate query and is found only by the text
       step — and an unknown mint time costs it the Buy affordance, not its place
       in the comparison. Those two consequences are different and must stay so. */
    id: 'st_chillguy',
    title: 'Cartoon dog in a sweater, posted as a mood',
    spans: ['just a chill guy', 'chill', 'chillguy'],
    earliestPost: 3 * HOUR + 14 * MIN,
    reach: { shape: 'rising', from: 120_000, to: 2_840_000 },
    rebroadcast: { from: 900, to: 4_100 },
    imageSeed: 'chillguy-drawing',
    members: [
      {
        id: 'it_chill_1', author: 'x:1004', sourceItemId: '1770000000000000101',
        posted: 3 * HOUR + 14 * MIN, weight: 0.4, lang: 'en',
        body: 'just a chill guy in a sweater. that is the whole post',
        evidence: { kind: 'seed' },
      },
      {
        id: 'it_chill_2', author: 'x:1005', sourceItemId: '1770000000000000102',
        posted: 2 * HOUR + 50 * MIN, weight: 0.25, lang: 'en',
        body: 'nobody is beating the #chillguy allegations',
        evidence: { kind: 'carrier', carrierKind: 'imageHash', distance: 3, weight: 0.9 },
      },
      {
        id: 'it_chill_3', author: 'tiktok:2002', sourceItemId: '7460000000000000103',
        posted: 2 * HOUR + 5 * MIN, weight: 0.2, lang: 'es',
        /* Different language, same drawing. The carrier join does not read text,
           which is why this row is in the story at all. */
        body: 'solo un chill guy con su sueter',
        evidence: { kind: 'carrier', carrierKind: 'imageHash', distance: 7, weight: 0.9 },
      },
      {
        id: 'it_chill_4', author: 'x:1006', sourceItemId: '1770000000000000104',
        posted: 1 * HOUR + 10 * MIN, weight: 0.15, lang: 'en',
        /* Redrawn, not reposted: the bits do not match and the meaning does. This
           is the paid tier, and it records WHICH SPACE the similarity came from,
           because a bar tuned on one embedding space means nothing on another. */
        body: 'my version of the chill guy, hand drawn',
        evidence: {
          kind: 'representation', similarity: 0.912, space: 'insidor-text-v1@1024',
        },
      },
    ],
    assets: [
      {
        address: 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',
        venue: 'pumpfun', symbol: 'CHILLGUY', name: 'Just a chill guy',
        minted: 22 * MIN, source: 'issuer_api', conf: 'exact', boundS: null,
        decimals: 6, creator: 'Bq7wErTyUiPaSdFgHjKlZxCvBnM2233445566778899',
        social: { x: 'https://x.com/chillguycoin' },
      },
      {
        address: '7xKq2mNvB4pLdRtYwEjHnCzAgFsUiOpQvXmZbNcVdRt3',
        venue: 'pumpfun', symbol: 'CHILL', name: 'chill',
        minted: 9 * MIN, source: 'issuer_api', conf: 'exact', boundS: null,
        decimals: 6, creator: 'Cw8rTyUiOpAsDfGhJkLzXcVbNm3344556677889900',
        social: {},
      },
      {
        address: '9mPxWq3nT8vKjRbYuEhGcZaFsDiOlQpXvNmZbCxVdRt7',
        venue: 'raydium', symbol: 'CHILLGUY', name: 'chill guy (official)',
        minted: null, source: 'none', conf: 'unknown', boundS: null,
        decimals: 9, creator: null,
        /* "official" in the name and a handle it does not own. The column is
           called `declared_social` because everything in it was typed by whoever
           minted the coin. */
        social: { x: 'https://x.com/moodboardz' },
      },
    ],
  },

  {
    /* ★ CASE 4 — SIX CANDIDATES, NONE CONFIDENT → `unsure` → the row shows NO
       BUTTON AT ALL. Nothing below says "unsure". What is written is: six coins
       that each share a token with a span and none of which IS a span, all six
       carrying a vendor-supplied mint time with a ±30-minute bound, and two of
       them declaring the seed author's own handle. Delete any one of those three
       facts and the row still projects to `unsure` on the other two. */
    id: 'st_soup',
    title: 'Chef throws the soup, kitchen goes silent',
    spans: ['throws the soup', 'kitchen goes silent', 'nine second clip'],
    earliestPost: 47 * MIN,
    reach: { shape: 'rising', from: 15_000, to: 233_000 },
    rebroadcast: { from: 90, to: 890 },
    imageSeed: 'soup-kitchen-clip',
    members: [
      {
        id: 'it_soup_1', author: 'x:1007', sourceItemId: '1770000000000000201',
        posted: 47 * MIN, weight: 0.35, lang: 'en',
        body: 'nine second clip. the chef throws the soup and the kitchen goes silent',
        evidence: { kind: 'seed' },
      },
      {
        id: 'it_soup_2', author: 'tiktok:2003', sourceItemId: '7460000000000000202',
        posted: 38 * MIN, weight: 0.3, lang: 'en',
        body: 'when he throws the soup 💀 #kitchennightmare',
        formatIds: ['tt_sound_88213'],
        /* A reusable template — a sound, an effect. Exact match, so no distance:
           0004 leaves carrier_distance out of `evidence_carrier_is_whole` for
           precisely the kinds where a distance would be meaningless. */
        evidence: { kind: 'carrier', carrierKind: 'formatId', key: 'tt_sound_88213', weight: 0.42 },
      },
      {
        id: 'it_soup_3', author: 'x:1008', sourceItemId: '1770000000000000203',
        posted: 29 * MIN, weight: 0.2, lang: 'en',
        body: 'the kitchen goes silent and then nothing. nine second clip and no context',
        evidence: { kind: 'carrier', carrierKind: 'textShingle', distance: 2, weight: 0.66 },
      },
      {
        id: 'it_soup_4', author: 'x:1002', sourceItemId: '1770000000000000204',
        posted: 15 * MIN, weight: 0.15, lang: 'en',
        /* Neither the bits nor the words matched; a person looked and said yes.
           Rare on purpose — these are the rows a model is later fit on. */
        body: 'that soup video is from a restaurant two streets away, I recognise the tiles',
        evidence: { kind: 'adjudicated', by: 'analyst:zain', atAgo: 12 * MIN },
      },
    ],
    assets: [
      {
        address: 'So1PGkNb2mQ7vXcRtYuPaSdFgHjKzXcVbNm1111aaa',
        venue: 'pumpfun', symbol: 'SOUP', name: 'soup',
        minted: 43 * MIN, source: 'vendor_field', conf: 'bounded', boundS: 1800,
        decimals: 6, creator: null, social: {},
      },
      {
        address: 'So2GaTe9wErTyUPaSdFgHjKzXcVbNm2222bbbcccd',
        /* Two words in the name on purpose. The candidate step is a token
           overlap, and "soupgate" as one token shares nothing with any span —
           this coin would drop out of the running entirely and the row would
           project claimCount 5. "soup gate" overlaps on `soup` and still
           equals no span, so it is a candidate and is not confident, which is
           the whole shape of this case. */
        venue: 'pumpfun', symbol: 'SOUPGATE', name: 'soup gate',
        minted: 38 * MIN, source: 'vendor_field', conf: 'bounded', boundS: 1800,
        decimals: 6, creator: null,
        social: { x: 'https://x.com/kitchenfails' },
      },
      {
        address: 'So3HoT7qWeRtYuPaSdFgHjKzXcVbNm3333cccddde',
        venue: 'pumpfun', symbol: 'HOTSOUP', name: 'hot soup',
        minted: 31 * MIN, source: 'vendor_field', conf: 'bounded', boundS: 1800,
        decimals: 6, creator: null, social: {},
      },
      {
        address: 'So4ChEf5rTyUiPaSdFgHjKzXcVbNm4444dddeeeff',
        venue: 'pumpfun', symbol: 'SOUPCHEF', name: 'soup chef',
        minted: 24 * MIN, source: 'vendor_field', conf: 'bounded', boundS: 1800,
        decimals: 6, creator: null, social: {},
      },
      {
        address: 'So5ThE3tYuIoPaSdFgHjKzXcVbNm5555eeefffggg',
        venue: 'raydium', symbol: 'THESOUP', name: 'the soup',
        minted: 16 * MIN, source: 'vendor_field', conf: 'bounded', boundS: 1800,
        decimals: 9, creator: null,
        social: { x: 'https://x.com/kitchenfails' },
      },
      {
        address: 'So6LaDy1yUiOpAsDfGhJkZxCvBnM6666fffggghhh',
        venue: 'pumpfun', symbol: 'LADLE', name: 'silent kitchen',
        minted: 7 * MIN, source: 'vendor_field', conf: 'bounded', boundS: 1800,
        decimals: 6, creator: null, social: {},
      },
    ],
  },

  {
    /* CASE 5 — A SOURCE THAT PUBLISHES NO VIEW COUNT. Every `reach` reading on
       this story is fidelity_kind = 'absent' with a NULL value, which 0003's
       `absent_has_no_value` insists on, and a rate censored 'unusable_fidelity'.
       The board must render a dash. The previous build wrote 0 here, which sorted
       the row last and made "this platform has no such concept" identical to
       "nobody watched it".
       The graph is still alive, because the counter this source DOES publish
       still moves — the rebroadcast series below is measured throughout. Two
       confident coins → `several`. */
    id: 'st_dance',
    title: 'Grandmother learns the dance, does it better',
    /* Content words only, for the same reason st_pigeon's are: a span containing
       "the" would drag st_soup's THESOUP in here as a candidate. */
    spans: ['grandma dance', 'nana'],
    earliestPost: 5 * HOUR + 8 * MIN,
    reach: { absent: true },
    rebroadcast: { shape: 'steady', from: 3_750, to: 4_200 },
    imageSeed: 'grandmother-dance-clip',
    members: [
      {
        id: 'it_dance_1', author: 'reddit:3001', sourceItemId: 't3_1a2b3c',
        posted: 5 * HOUR + 8 * MIN, weight: 0.5, lang: 'en',
        body: 'my nana learns the dance and immediately does it better than all of us',
        evidence: { kind: 'seed' },
      },
      {
        id: 'it_dance_2', author: 'reddit:3002', sourceItemId: 't3_1a2b3d',
        posted: 4 * HOUR + 30 * MIN, weight: 0.3, lang: 'en',
        body: 'grandma dance, full version',
        evidence: { kind: 'carrier', carrierKind: 'imageHash', distance: 5, weight: 0.86 },
      },
      {
        id: 'it_dance_3', author: 'reddit:3003', sourceItemId: 't3_1a2b3e',
        posted: 3 * HOUR + 45 * MIN, weight: 0.2, lang: 'en',
        body: 'we filmed our own nana doing it',
        reproductionOf: 'it_dance_1',
        evidence: { kind: 'lineage', via: 'reproduction', toItem: 'it_dance_1' },
      },
    ],
    assets: [
      {
        address: '2nQwErTyUiPaSdFgHjKzXcVbNm1234567890QwEr',
        venue: 'pumpfun', symbol: 'GRANNY', name: 'grandma dance',
        minted: 4 * HOUR, source: 'chain_rpc', conf: 'exact', boundS: null,
        decimals: 6, creator: 'Dx9rTyUiOpAsDfGhJkLzXcVbNm4455667788990011',
        social: {},
      },
      {
        address: '5tYuIoPaSdFgHjKzXcVbNm0987654321TyUiOpAs',
        venue: 'pumpfun', symbol: 'NANA', name: 'nana',
        minted: 3 * HOUR + 20 * MIN, source: 'chain_rpc', conf: 'exact', boundS: null,
        decimals: 6, creator: 'Ey1rTyUiOpAsDfGhJkLzXcVbNm5566778899001122',
        social: {},
      },
    ],
  },

  {
    /* ★ CASE 6 — A BROKEN GRAPH AND AN AGE WE NEVER LEARNED.
       Two separate absences, and they arrive by two separate routes:

       1. THE GAP. See ROOFTOP_LEVELS above: four consecutive reads land in the
          same rounding bucket, so four rows are written with rate_per_min NULL
          and censored = 'below_step'. rate_level is NULL on those rows because
          the constraint will not let it be anything else, so the spark's `value`
          is null and the line BREAKS. A zero there would draw a collapse on a
          story that is still moving.

       2. THE AGE. Every member has posted_at NULL — we picked the clip up
          mid-flight and the source never told us when it started. `min(posted_at)
          over members` is therefore NULL and the wire's firstSeenAt must be
          { at: null, why: 'not_read_yet' }, NOT a zero and NOT backfilled from
          first_seen_at.

       ★ NOTE FOR THE PROJECTOR: story.earliest_post_at is NOT NULL in 0004, so it
       is filled here with the earliest first_seen_at, which is a DIFFERENT CLOCK
       — when we first read the item, not when it was posted. Read the members'
       posted_at, not that column, or this row silently claims an age it does not
       have.

       The coin was minted six hours ago, BEFORE the earliest thing we ever saw,
       so the mint-lag gate has nothing to order and must abstain rather than
       decide. The text step still links it: "roof slide" is a span. */
    id: 'st_rooftop',
    title: 'Man builds a slide from his roof to the street',
    spans: ['roof slide', 'slide from his roof'],
    earliestPost: null,
    reach: { shape: 'rooftop' },
    rebroadcast: { from: 600, to: 2_600 },
    imageSeed: 'rooftop-slide-clip',
    members: [
      {
        id: 'it_roof_1', author: 'tiktok:2006', sourceItemId: '7460000000000000301',
        posted: null, firstSeen: 2 * HOUR + 10 * MIN, weight: 0.5, lang: 'en',
        body: 'he built a slide from his roof to the street and the council has questions',
        evidence: { kind: 'seed' },
      },
      {
        id: 'it_roof_2', author: 'tiktok:2005', sourceItemId: '7460000000000000302',
        posted: null, firstSeen: 1 * HOUR + 40 * MIN, weight: 0.3, lang: 'en',
        body: 'roof slide guy is back',
        evidence: { kind: 'carrier', carrierKind: 'imageHash', distance: 2, weight: 0.92 },
      },
      {
        id: 'it_roof_3', author: 'tiktok:2007', sourceItemId: '7460000000000000303',
        posted: null, firstSeen: 55 * MIN, weight: 0.2, lang: 'en',
        body: 'the roof slide has a landing mat now',
        evidence: { kind: 'carrier', carrierKind: 'entitySpan', key: 'roof slide', weight: 0.89 },
      },
    ],
    assets: [
      {
        address: '8jHgFdSaQwErTyUPaSdFgHjKzXcVbNm112233QwEr',
        venue: 'raydium', symbol: 'SLIDE', name: 'roof slide',
        minted: 6 * HOUR, source: 'chain_rpc', conf: 'exact', boundS: null,
        decimals: 9, creator: 'Fz2rTyUiOpAsDfGhJkLzXcVbNm6677889900112233',
        social: {},
      },
    ],
  },
];

/* ── derivation ───────────────────────────────────────────────────────────── */

const STEP_MS = 2 * MIN;
const MAX_CAPTURES = 21; /* 40 minutes of history; the spark window is 30 */

const authorSource = (key) => key.slice(0, key.indexOf(':'));

/** first_seen_at: when WE read it. Always known, even when posted_at is not. */
function memberFirstSeen(member) {
  if (member.firstSeen !== undefined) return member.firstSeen;
  /* We found it a couple of minutes after it was posted. Never before. */
  return Math.max(member.posted - 2 * MIN, 0);
}

/**
 * Split a story-level series across its members by weight, exactly.
 *
 * The last member absorbs the rounding remainder so that summing the members at
 * any capture reproduces the story level to the unit. A projector that sums
 * member levels and a human reading the story level have to agree, or the first
 * disagreement is blamed on the projector.
 */
function allocate(level, weights) {
  const out = weights.map((w, i) => (i === weights.length - 1 ? 0 : Math.round(level * w)));
  out[out.length - 1] = level - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

/**
 * A reading rounded to the significant digits the source admits to.
 *
 * ★ THIS IS NOT COSMETIC. `fidelity_kind = 'quantized'` is a claim about what the
 * source returns, and a seed that declares it while writing full precision makes
 * 'below_step' unreachable — the one censor reason the whole vocabulary was built
 * around would then only ever exist because a seed hardcoded it. Rounding here is
 * what lets the censoring be COMPUTED, in toObservations, from two readings that
 * genuinely landed in the same bucket.
 */
function quantize(value, digits) {
  if (value === 0) return 0;
  const step = 10 ** (Math.floor(Math.log10(Math.abs(value))) - (digits - 1));
  return Math.round(value / step) * step;
}

/**
 * Levels → observation rows, with the rate DIFFERENCED rather than declared.
 *
 * Three censor reasons come out of this and all three are earned:
 *   'no_prior'    the first reading of a series. There is nothing to subtract.
 *   'below_step'  a QUANTIZED level did not change. The counter moved and the
 *                 rounding hid how much, so nothing was learned about the change.
 *   'non_monotonic' a cumulative counter went backwards. Never expected, and if a
 *                 future edit here makes it happen it must NOT quietly become a
 *                 negative rate.
 *
 * ★ AND THE ONE THAT IS NOT A CENSOR. An EXACT counter that did not change gets
 * rate_per_min = 0, measured, uncensored — because "this counter did not move" is
 * something we genuinely learned from a source that does not round. That is the
 * other half of the rule 0003 is written around, and it is the half that is easy
 * to over-correct into. Null and zero are not the same number: writing 0 where we
 * learned nothing hides acceleration, and writing null where we measured a
 * standstill throws away a real reading. The fidelity is what decides which of
 * the two happened, which is why a reading carries it.
 */
function toObservations(itemId, kind, capturedAt, levels, fidelity) {
  const rows = [];
  let lastLevel = null;
  let lastAt = null;

  for (let i = 0; i < capturedAt.length; i += 1) {
    const at = capturedAt[i];
    const raw = levels[i];
    /* What the source would actually have returned, not what was true. */
    const level =
      raw !== null && fidelity.kind === 'quantized' ? quantize(raw, fidelity.digits) : raw;
    const observedAt = fidelity.lagMs === null ? at : at - fidelity.lagMs;
    const base = {
      itemId, kind,
      capturedAt: new Date(at),
      value: fidelity.kind === 'absent' ? null : level,
      fidelityKind: fidelity.kind,
      fidelityDigits: fidelity.digits,
      observedAt: new Date(observedAt),
      lagMs: fidelity.lagMs,
    };

    const censor = (reason, lastTrusted) =>
      rows.push({
        ...base,
        ratePerMin: null, censored: reason,
        rateOverMs: null, rateLevel: null, rateLastLevel: lastTrusted,
      });

    if (fidelity.kind === 'absent') {
      /* The source has no such counter. Not a failed read — an absent concept,
         and there has never been a trustworthy level to carry forward. */
      censor('unusable_fidelity', null);
      continue;
    }
    if (lastLevel === null) {
      censor('no_prior', level);
      lastLevel = level;
      lastAt = at;
      continue;
    }
    if (level === lastLevel) {
      if (fidelity.kind === 'exact') {
        /* No rounding step for a change to fall below. The counter is flat and we
           know it is flat. A measured zero, and the only kind there is. */
        rows.push({
          ...base,
          ratePerMin: 0, censored: null,
          rateOverMs: at - lastAt, rateLevel: level, rateLastLevel: null,
        });
        lastAt = at;
        continue;
      }
      censor('below_step', lastLevel);
      continue;
    }
    if (level < lastLevel) {
      process.stderr.write(`  ! ${itemId}/${kind} went backwards at ${new Date(at).toISOString()}\n`);
      censor('non_monotonic', lastLevel);
      continue;
    }

    const overMs = at - lastAt;
    rows.push({
      ...base,
      ratePerMin: ((level - lastLevel) / overMs) * MIN,
      censored: null,
      rateOverMs: overMs,
      rateLevel: level,
      rateLastLevel: null,
    });
    lastLevel = level;
    lastAt = at;
  }
  return rows;
}

function build() {
  const items = [];
  const fingerprints = [];
  const members = [];
  const observations = [];
  const stories = [];
  const assets = [];

  for (const story of STORIES) {
    const firstSeenAll = story.members.map(memberFirstSeen);
    const oldestFirstSeen = Math.max(...firstSeenAll);
    const newestFirstSeen = Math.min(...firstSeenAll);
    const postedAll = story.members.map((m) => m.posted).filter((p) => p !== null && p !== undefined);

    /* The capture grid. It cannot start before we had anything to read, which is
       why st_pigeon gets six points and not twenty-one — and why the wire carries
       `windowMs` beside the points, so six points are not drawn as a full window. */
    const spanMs = Math.min(oldestFirstSeen, (MAX_CAPTURES - 1) * STEP_MS);
    const count = Math.max(2, Math.floor(spanMs / STEP_MS) + 1);
    const capturedAt = Array.from({ length: count }, (_, i) => T0 - (count - 1 - i) * STEP_MS);

    const weights = story.members.map((m) => m.weight);

    /* reach */
    const reachLevels =
      story.reach.absent === true
        ? Array.from({ length: count }, () => null)
        : story.reach.shape === 'rooftop'
          ? ROOFTOP_LEVELS.slice(ROOFTOP_LEVELS.length - count)
          : risingLevels(story.reach.from, story.reach.to, count);

    /* rebroadcast — the counter that is always published, and st_dance's only one */
    const rebroadcastLevels =
      story.rebroadcast.shape === 'steady'
        ? steadyLevels(story.rebroadcast.from, story.rebroadcast.to, count)
        : risingLevels(story.rebroadcast.from, story.rebroadcast.to, count);

    const baseImage = bits(story.imageSeed, 256);

    for (let mi = 0; mi < story.members.length; mi += 1) {
      const member = story.members[mi];
      const source = authorSource(member.author);
      const firstSeen = memberFirstSeen(member);

      items.push({
        itemId: member.id,
        source,
        sourceItemId: member.sourceItemId,
        authorKey: member.author,
        postedAt: member.posted === null || member.posted === undefined ? null : ago(member.posted),
        firstSeenAt: ago(firstSeen),
        lang: member.lang,
        body: member.body,
        formatIds: member.formatIds ?? [],
        rebroadcastOf: member.rebroadcastOf ?? null,
        reproductionOf: member.reproductionOf ?? null,
        rawRef: `local:seed/${member.id}`,
      });

      /* ── fingerprints ──
         The image carrier: one hash per story, each member's copy a few bits
         away, so the `carrier_distance` on the membership row below is a real
         Hamming distance against real bits rather than a decorative float. */
      const distance = member.evidence.kind === 'carrier' && member.evidence.carrierKind === 'imageHash'
        ? member.evidence.distance
        : 0;
      fingerprints.push({
        itemId: member.id, kind: 'imageHash', key: story.imageSeed,
        imageBits: distance === 0 ? baseImage : nearBits(baseImage, distance, member.id),
        textBits: null,
      });
      fingerprints.push({
        itemId: member.id, kind: 'textShingle', key: `shingle:${story.id}`,
        imageBits: null,
        textBits:
          member.evidence.kind === 'carrier' && member.evidence.carrierKind === 'textShingle'
            ? nearBits(bits(`shingle:${story.id}`, 64), member.evidence.distance, member.id)
            : bits(`shingle:${story.id}`, 64),
      });
      /* The entity spans that actually occur in this item's text. These are the
         only rows that link a story to a coin, so they are derived from the body
         rather than asserted per member. */
      const normBody = norm(member.body);
      for (const span of story.spans) {
        if (normBody.includes(span)) {
          fingerprints.push({ itemId: member.id, kind: 'entitySpan', key: span, imageBits: null, textBits: null });
        }
      }
      for (const formatId of member.formatIds ?? []) {
        fingerprints.push({ itemId: member.id, kind: 'formatId', key: formatId, imageBits: null, textBits: null });
      }

      /* ── membership ── */
      const e = member.evidence;
      members.push({
        storyId: story.id,
        itemId: member.id,
        joinedAt: ago(firstSeen),
        evidenceKind: e.kind,
        carrierKind: e.kind === 'carrier' ? e.carrierKind : null,
        carrierKey:
          e.kind === 'carrier'
            ? (e.key ?? (e.carrierKind === 'imageHash' ? story.imageSeed : `shingle:${story.id}`))
            : null,
        carrierDistance: e.kind === 'carrier' ? (e.distance ?? null) : null,
        carrierWeight: e.kind === 'carrier' ? e.weight : null,
        lineageVia: e.kind === 'lineage' ? e.via : null,
        lineageToItem: e.kind === 'lineage' ? e.toItem : null,
        representationSimilarity: e.kind === 'representation' ? e.similarity : null,
        representationSpace: e.kind === 'representation' ? e.space : null,
        adjudicatedBy: e.kind === 'adjudicated' ? e.by : null,
        adjudicatedAt: e.kind === 'adjudicated' ? ago(e.atAgo) : null,
      });

      /* ── observations ── */
      const reachFidelity = story.reach.absent === true ? FIDELITY.reach_absent : FIDELITY[source];
      const mine = (levels) =>
        levels.map((l) => (l === null ? null : allocate(l, weights)[mi]));

      observations.push(
        ...toObservations(member.id, 'reach', capturedAt, mine(reachLevels), reachFidelity),
        ...toObservations(member.id, 'rebroadcast', capturedAt, mine(rebroadcastLevels), FIDELITY[source]),
      );
    }

    /* ── the story row ──
       earliest_post_at is NOT NULL, so st_rooftop (no known post times at all)
       falls back to the earliest first_seen_at — a different clock, flagged in
       this story's comment because reading it as an age is the one mistake this
       row exists to catch. */
    const earliestPostMs = postedAll.length > 0 ? Math.max(...postedAll) : oldestFirstSeen;
    stories.push({
      storyId: story.id,
      createdAt: ago(oldestFirstSeen),
      earliestPostAt: ago(earliestPostMs),
      promotedAt: ago(Math.max(earliestPostMs - 6 * MIN, 0)),
      lastMemberAt: ago(newestFirstSeen),
      state: 'promoted',
      carriers: JSON.stringify([
        { kind: 'imageHash', key: story.imageSeed, weight: 0.9 },
        ...story.spans.map((s) => ({ kind: 'entitySpan', key: s, weight: 0.7 })),
      ]),
      displayTitle: story.title,
      thumbUri: null,
    });

    for (const asset of story.assets) {
      assets.push({
        chain: 'solana',
        address: asset.address,
        assetKey: `solana:${asset.address}`,
        venueId: asset.venue,
        mintedAt: asset.minted === null ? null : ago(asset.minted),
        mintedAtSource: asset.source,
        mintedAtConf: asset.conf,
        mintedAtBoundS: asset.boundS,
        symbol: asset.symbol,
        name: asset.name,
        imageUri: null,
        decimals: asset.decimals,
        creator: asset.creator,
        declaredSocial: JSON.stringify(asset.social),
        firstSeenAt: ago(asset.minted === null ? 30 * MIN : Math.max(asset.minted - 1 * MIN, 0)),
      });
    }
  }

  return { items, fingerprints, members, observations, stories, assets };
}

/* ── writing ──────────────────────────────────────────────────────────────── */

/** A multi-row INSERT, chunked. One statement per 400 rows keeps the parameter count sane. */
async function insertMany(client, table, columns, rows, extra = '') {
  const CHUNK = 400;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK);
    const params = [];
    const tuples = slice.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(
      `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')} ${extra}`,
      params,
    );
  }
}

async function main() {
  const data = build();
  const storyIds = STORIES.map((s) => s.id);
  const itemIds = data.items.map((i) => i.itemId);
  const authorKeys = AUTHORS.map((a) => a[0]);
  const assetKeys = data.assets.map((a) => a.assetKey);

  const client = await connect();
  process.stderr.write(`  ${redact(databaseUrl())}\n`);

  try {
    await client.query('begin');

    /* ── clear ──
       Order matters. public.observation is truncated FIRST so that deleting the
       items does not cascade into it and fire the append-only trigger, which
       would abort the whole transaction with "observation is append-only". */
    await client.query('truncate table public.observation');
    await client.query('delete from public.story_member where story_id = any($1)', [storyIds]);
    await client.query('delete from public.story where story_id = any($1)', [storyIds]);
    await client.query('delete from public.item_fingerprint where item_id = any($1)', [itemIds]);
    /* Items reference each other through rebroadcast_of / reproduction_of. One
       statement deleting the whole set is fine — the constraint is checked at
       the end of it, by which point nothing dangles. */
    await client.query('delete from public.item where item_id = any($1)', [itemIds]);
    await client.query('delete from public.author where author_key = any($1)', [authorKeys]);
    await client.query('delete from public.asset where asset_key = any($1)', [assetKeys]);
    process.stderr.write('  cleared previously seeded rows (observation truncated)\n');

    await insertMany(
      client,
      'public.author',
      ['author_key', 'source', 'source_author_id', 'first_seen_at', 'last_seen_at',
       'display_name', 'handle', 'follower_count', 'follower_count_observed_at'],
      AUTHORS.map(([key, source, id, name, handle, followers]) => [
        key, source, id, ago(7 * 24 * HOUR), ago(2 * MIN), name, handle,
        followers, followers === null ? null : ago(2 * MIN),
      ]),
    );
    process.stderr.write(`  ${AUTHORS.length} authors\n`);

    await insertMany(
      client,
      'public.item',
      ['item_id', 'source', 'source_item_id', 'author_key', 'posted_at', 'first_seen_at',
       'lang', 'body', 'format_ids', 'raw_ref'],
      data.items.map((i) => [
        i.itemId, i.source, i.sourceItemId, i.authorKey, i.postedAt, i.firstSeenAt,
        i.lang, i.body, i.formatIds, i.rawRef,
      ]),
    );
    /* Lineage in a second pass: the target item has to exist before a column can
       point at it, and one of them points backwards inside the same story. */
    for (const item of data.items) {
      if (item.rebroadcastOf === null && item.reproductionOf === null) continue;
      await client.query(
        'update public.item set rebroadcast_of = $2, reproduction_of = $3 where item_id = $1',
        [item.itemId, item.rebroadcastOf, item.reproductionOf],
      );
    }
    process.stderr.write(`  ${data.items.length} items\n`);

    await insertMany(
      client,
      'public.item_fingerprint',
      ['item_id', 'kind', 'key', 'image_bits', 'text_bits'],
      data.fingerprints.map((f) => [f.itemId, f.kind, f.key, f.imageBits, f.textBits]),
      'on conflict (item_id, kind, key) do nothing',
    );
    process.stderr.write(`  ${data.fingerprints.length} fingerprints\n`);

    await insertMany(
      client,
      'public.story',
      ['story_id', 'created_at', 'earliest_post_at', 'promoted_at', 'last_member_at',
       'state', 'carriers', 'display_title', 'thumb_uri'],
      data.stories.map((s) => [
        s.storyId, s.createdAt, s.earliestPostAt, s.promotedAt, s.lastMemberAt,
        s.state, s.carriers, s.displayTitle, s.thumbUri,
      ]),
    );

    await insertMany(
      client,
      'public.story_member',
      ['story_id', 'item_id', 'joined_at', 'evidence_kind', 'carrier_kind', 'carrier_key',
       'carrier_distance', 'carrier_weight', 'lineage_via', 'lineage_to_item',
       'representation_similarity', 'representation_space', 'adjudicated_by', 'adjudicated_at'],
      data.members.map((m) => [
        m.storyId, m.itemId, m.joinedAt, m.evidenceKind, m.carrierKind, m.carrierKey,
        m.carrierDistance, m.carrierWeight, m.lineageVia, m.lineageToItem,
        m.representationSimilarity, m.representationSpace, m.adjudicatedBy, m.adjudicatedAt,
      ]),
    );
    process.stderr.write(`  ${data.stories.length} stories, ${data.members.length} memberships\n`);

    /* Counted in SQL from the rows just written, never carried in from the
       constants above. `distinct_authors` is breadth: 0004's note that one author
       posting forty times is not forty reproducers is only true if this is a
       count(distinct) and not a member_count. */
    await client.query(
      `update public.story s set
         member_count     = c.members,
         distinct_authors = c.authors,
         distinct_sources = c.sources
       from (
         select m.story_id,
                count(*)                       as members,
                count(distinct i.author_key)   as authors,
                count(distinct i.source)       as sources
           from public.story_member m
           join public.item i using (item_id)
          group by m.story_id
       ) c
       where c.story_id = s.story_id and s.story_id = any($1)`,
      [storyIds],
    );

    await insertMany(
      client,
      'public.asset',
      ['chain', 'address', 'asset_key', 'venue_id', 'minted_at', 'minted_at_source',
       'minted_at_conf', 'minted_at_bound_s', 'symbol', 'name', 'image_uri', 'decimals',
       'creator', 'declared_social', 'first_seen_at'],
      data.assets.map((a) => [
        a.chain, a.address, a.assetKey, a.venueId, a.mintedAt, a.mintedAtSource,
        a.mintedAtConf, a.mintedAtBoundS, a.symbol, a.name, a.imageUri, a.decimals,
        a.creator, a.declaredSocial, a.firstSeenAt,
      ]),
    );
    process.stderr.write(`  ${data.assets.length} assets\n`);

    await insertMany(
      client,
      'public.observation',
      ['item_id', 'kind', 'captured_at', 'value', 'fidelity_kind', 'fidelity_digits',
       'observed_at', 'lag_ms', 'rate_per_min', 'censored', 'rate_over_ms', 'rate_level',
       'rate_last_level'],
      data.observations.map((o) => [
        o.itemId, o.kind, o.capturedAt, o.value, o.fidelityKind, o.fidelityDigits,
        o.observedAt, o.lagMs, o.ratePerMin, o.censored, o.rateOverMs, o.rateLevel,
        o.rateLastLevel,
      ]),
      'on conflict (item_id, kind, captured_at) do nothing',
    );

    const byReason = new Map();
    for (const o of data.observations) {
      const key = o.censored ?? 'measured';
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    process.stderr.write(
      `  ${data.observations.length} observations  (${[...byReason]
        .sort()
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')})\n`,
    );

    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  process.stderr.write(
    '\n  Domain facts only — no projection row and no internal row was written.\n' +
      '  Next:  pnpm db:project     (derive the board)\n' +
      '         pnpm dev:read       (serve it as the app role)\n\n',
  );
}

await main();
