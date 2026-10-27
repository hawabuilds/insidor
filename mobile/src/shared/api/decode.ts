/**
 * THE BOUNDARY, FOR THE PHONE APP. Everything that arrives from the read service passes
 * through this file and nothing skips it.
 *
 * ★ A COPY OF THE BOARD, STORY AND COIN HALF OF `app/src/shared/api/decode.ts`, KEPT IN STEP
 * BY HAND. The two jobs are the desktop decoder's, and so is the order:
 *
 * 1. Censor first. `assertNoInternalVocabulary` walks the raw payload and THROWS if an
 *    internal word appears, so a leak at the projection is loud here rather than silently
 *    dropped by the pick below — a leak that has been silently discarded is a leak nobody
 *    fixes at the source.
 * 2. Then validate and pick. Every field is read defensively against the allowlists in
 *    `wire/fields.ts`, and every absence becomes a pending value carrying a reason — never a
 *    zero, never a guessed timestamp.
 *
 * The launches, pairs, sources and quote decoders are not copied: the phone app has none of
 * those surfaces, and a decoder with no caller is a decoder nobody keeps in step.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: an absent provenance must keep resolving to
 * `unstated`, never `observed` — `observed` is the one value that makes the app say nothing,
 * so defaulting to it would publish invented stories as real through the last line of defence.
 */

import type { Instant, Measured, Delta, Millis, PendingReason } from '../format/measure.ts';
import { instantFrom, measuredFrom } from '../format/measure.ts';
import { postPicFile } from '../post-pic.ts';
import { posterPicFile } from '../poster-pic.ts';
import type { BoardProvenance, BoardRow, BoardTick, Spark, SparkPoint, Tone } from './wire/board.ts';
import type { Coin, CoinEvidence, CoinLink, CoinOrigin, MarketCapBasis, PostCoinLink } from './wire/coin.ts';
import type { OlderCoin, PostInStory, PostTranslation, QuotedPost, RisingFeed, SharedBy, RisingPage, PostSortBy, PostSortWindow, PostSpeeds, RisingPost, RisingSorted } from './wire/rising.ts';
import type { DiscussionPost, EarliestPost, Evidence, InWindow, NarrativesList, NarrativesPage, PostViews, Story, StoryProvenance, ViewsGained, WarCoin } from './wire/story.ts';
import type { Candle, CoinMarket, MarketPair, MarketTimeframe, MarketTrade } from './wire/market.ts';
import type { CreatedCoin, Gain, Holding, Portfolio, PortfolioRange } from './wire/wallet.ts';
import type { NameIdea, OriginGap, SameNameCoins, SearchCoin, SearchCoins, TickerUse, SearchedCoin, SearchNarrative, SearchPost, SearchResults } from './wire/search.ts';
import {
  BOARD_ROW_FIELDS,
  COIN_FIELDS,
  FORBIDDEN_KEYS,
  FORBIDDEN_SUBSTRINGS,
  OLDER_COIN_FIELDS,
  QUOTED_POST_FIELDS,
  RISING_POST_FIELDS,
  SHARED_BY_FIELDS,
  STORY_FIELDS,
} from './wire/fields.ts';

/* ── failures ─────────────────────────────────────────────────────────── */

/** The server sent something we cannot read. Distinct from a network failure. */
export class WireShapeError extends Error {
  constructor(path: string, saw: unknown) {
    super(`wire: ${path} is not readable (saw ${typeof saw})`);
    this.name = 'WireShapeError';
  }
}

/**
 * The server sent something the client is not allowed to have. This is a bug in the
 * projection, and it is deliberately fatal on this side: swallowing it would make the client
 * complicit in the leak.
 */
export class WireLeakError extends Error {
  constructor(path: string) {
    super(`wire: internal vocabulary reached the client at ${path}`);
    this.name = 'WireLeakError';
  }
}

/* ── narrow readers. The payload is data, not a promise. ──────────────── */

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new WireShapeError(path, v);
  return v as Record<string, unknown>;
}

function arr(v: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(v)) throw new WireShapeError(path, v);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new WireShapeError(path, v);
  return v;
}

function optStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** A picture link the app may load: https only, anything else is no picture. */
function httpsOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('https://') ? v : null;
}

function int(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WireShapeError(path, v);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new WireShapeError(path, v);
  return v;
}

/** Reasons are a closed list; an unrecognised one is `unreadable`, never dropped silently. */
function reasonOf(v: unknown): PendingReason {
  switch (v) {
    case 'not_minted':
    case 'no_market':
    case 'not_read_yet':
    case 'not_reported':
    case 'unreadable':
      return v;
    default:
      return 'unreadable';
  }
}

/**
 * The wire shape of a number that may not exist: `{ v: number | null, why?: string }`.
 *
 * `v: null` becomes pending. There is no branch of this function that produces 0 from an
 * absence, and `fallback` is the reason used when the server did not say why — not a value.
 */
function measured(v: unknown, path: string, fallback: PendingReason): Measured {
  if (v === null || v === undefined) return measuredFrom(null, fallback);
  const o = obj(v, path);
  const amount = o['v'];
  if (amount === null || amount === undefined) return measuredFrom(null, reasonOf(o['why'] ?? fallback));
  if (typeof amount !== 'number') throw new WireShapeError(`${path}.v`, amount);
  return measuredFrom(amount, fallback);
}

function delta(v: unknown, path: string, fallback: PendingReason): Delta {
  return measured(v, path, fallback);
}

/** The wire shape of an instant: `{ at: number | null, why?: string }`, epoch millis. */
function instantAt(v: unknown, path: string, fallback: PendingReason): Instant {
  if (v === null || v === undefined) return instantFrom(null, fallback);
  const o = obj(v, path);
  const at = o['at'];
  if (at === null || at === undefined) return instantFrom(null, reasonOf(o['why'] ?? fallback));
  if (typeof at !== 'number') throw new WireShapeError(`${path}.at`, at);
  return instantFrom(at, fallback);
}

function tone(v: unknown): Tone | null {
  return v === 'rising' || v === 'steady' || v === 'cooling' ? v : null;
}

/** Exactly two lines. A server sending three is a shape error, not something to truncate. */
function twoLines(v: unknown, path: string): readonly [string, string] {
  const a = arr(v, path);
  if (a.length !== 2) throw new WireShapeError(path, v);
  return [str(a[0], `${path}[0]`), str(a[1], `${path}[1]`)];
}

/* ── the censor ───────────────────────────────────────────────────────── */

/**
 * Walk the raw payload and throw if an internal word appears anywhere in it.
 *
 * Keys are matched exactly, because substring matching on short words ('eta' inside 'meta')
 * produces false positives, and a guard that cries wolf is a guard someone switches off.
 * Values are matched by substring against a shorter list where a substring hit cannot be
 * innocent — a vendor's name in a URL is still a vendor's name on our screen.
 */
export function assertNoInternalVocabulary(raw: unknown, path = '$'): void {
  if (typeof raw === 'string') {
    const lowered = raw.toLowerCase();
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      if (lowered.includes(bad)) throw new WireLeakError(`${path} (value contains "${bad}")`);
    }
    return;
  }
  if (Array.isArray(raw)) {
    raw.forEach((entry, i) => assertNoInternalVocabulary(entry, `${path}[${i}]`));
    return;
  }
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, entry] of Object.entries(raw)) {
      const lowered = key.toLowerCase();
      if (FORBIDDEN_KEYS.includes(lowered)) throw new WireLeakError(`${path}.${key}`);
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        if (lowered.includes(bad)) throw new WireLeakError(`${path}.${key}`);
      }
      assertNoInternalVocabulary(entry, `${path}.${key}`);
    }
  }
}

/**
 * The runtime pick. Returns a copy holding only the allowlisted keys.
 *
 * This is what makes the wall structural rather than typed: a type says a score is not
 * there, and a type is gone at runtime. This says a score is not there while the program is
 * running.
 */
export function pick<K extends string>(
  source: Record<string, unknown>,
  allow: readonly K[],
): Record<K, unknown> {
  const out = {} as Record<K, unknown>;
  for (const key of allow) {
    if (key in source) out[key] = source[key];
  }
  return out;
}

/* ── decoders ─────────────────────────────────────────────────────────── */

function decodeSpark(v: unknown, path: string): Spark {
  const o = obj(v, path);
  const points: SparkPoint[] = arr(o['points'], `${path}.points`).map((p, i) => {
    const q = obj(p, `${path}.points[${i}]`);
    const raw = q['value'];
    return {
      atMs: int(q['atMs'], `${path}.points[${i}].atMs`),
      /* A censored reading arrives as null and stays null. Coercing it to 0 here would
         redraw acceleration as collapse, which is the bug this whole vocabulary is
         organised against. */
      value: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
    };
  });
  return { points, windowMs: int(o['windowMs'], `${path}.windowMs`) };
}

function decodeBasis(v: unknown): MarketCapBasis | null {
  return v === 'fully-diluted' || v === 'circulating' ? v : null;
}

const ORIGIN_KINDS = ['linkedByCreator', 'matchedByInsidor', 'foundByTeam', 'influencer', 'afterLaunch'] as const;

/**
 * A coin's origin. Absent (an older server) or a kind we do not know is `unknown` — a dash —
 * never a post: "where this came from" is the one claim here that needs the server's proof.
 */
function decodeCoinOrigin(v: unknown, path: string): CoinOrigin {
  if (v === null || v === undefined) return { kind: 'unknown', pending: 'not_read_yet' };
  const o = obj(v, path);
  const kind = ORIGIN_KINDS.find((k) => k === o['kind']);
  if (kind === undefined) return { kind: 'unknown', pending: reasonOf(o['why'] ?? 'not_read_yet') };
  const post = obj(o['post'], `${path}.post`);
  return {
    kind,
    post: {
      authorLabel: str(post['authorLabel'], `${path}.post.authorLabel`),
      permalink: optStr(post['permalink']),
      postedAt: instantAt(post['postedAt'], `${path}.post.postedAt`, 'not_reported'),
    },
    offset: measured(o['offset'], `${path}.offset`, 'not_reported'),
  };
}

export function decodeCoin(raw: unknown, path = '$.coin'): Coin {
  const o = pick(obj(raw, path), COIN_FIELDS);
  return {
    coinId: str(o.coinId, `${path}.coinId`),
    ticker: str(o.ticker, `${path}.ticker`),
    name: str(o.name, `${path}.name`),
    address: str(o.address, `${path}.address`),
    venueLabel: str(o.venueLabel, `${path}.venueLabel`),
    imageUrl: optStr(o.imageUrl),
    /* Mint time unknown is normal and stays unknown — never backfilled from first-seen,
       which would make an old coin look freshly minted on the axis everything hangs on. */
    mintedAt: instantAt(o.mintedAt, `${path}.mintedAt`, 'not_read_yet'),
    priceUsd: measured(o.priceUsd, `${path}.priceUsd`, 'no_market'),
    marketCapUsd: measured(o.marketCapUsd, `${path}.marketCapUsd`, 'no_market'),
    marketCapBasis: decodeBasis(o.marketCapBasis),
    liquidityUsd: measured(o.liquidityUsd, `${path}.liquidityUsd`, 'not_reported'),
    /* The fallback is `not_reported` and not `no_market`: it fires only when the server
       sent no reason at all — a server too old to know about this field — and "nothing
       reports a change for this" is true of that, while "there is no market" is a claim
       about the world we would be making on the server's behalf, next to a price cell
       that may hold a number. */
    priceChange24h: delta(o.priceChange24h, `${path}.priceChange24h`, 'not_reported'),
    tradable: bool(o.tradable, `${path}.tradable`),
    origin: decodeCoinOrigin(o.origin, `${path}.origin`),
  };
}

/**
 * The link, decoded.
 *
 * The `unsure` branch reads no coin out of the payload at all — not even to keep it around
 * "just in case a designer wants it". If it were read, it would be one prop-drill away from
 * a buy panel, and the whole point of the union is that that path does not exist.
 */
export function decodeCoinLink(raw: unknown, path = '$.coins'): CoinLink {
  const o = obj(raw, path);
  const kind = str(o['kind'], `${path}.kind`);
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'pending':
      return { kind: 'pending' };
    case 'unsure': {
      const claimCount = int(o['claimCount'], `${path}.claimCount`);
      /* Only a literal true is "at least": anything else is the whole count. */
      /* `ownerList` only as a literal true: anything else is a list everyone may open. */
      const owner = o['ownerList'] === true ? { ownerList: true as const } : {};
      return o['more'] === true ? { kind: 'unsure', claimCount, more: true, ...owner } : { kind: 'unsure', claimCount, ...owner };
    }
    case 'one':
      return { kind: 'one', coin: decodeCoin(o['coin'], `${path}.coin`) };
    case 'several': {
      const list = arr(o['coins'], `${path}.coins`).map((c, i) => decodeCoin(c, `${path}.coins[${i}]`));
      const [first, second, ...rest] = list;
      /* "several" is a claim about cardinality. A server sending one coin under this tag is
         a shape error, because the tuple type downstream promises two. */
      if (first === undefined || second === undefined) throw new WireShapeError(`${path}.coins`, list);
      return { kind: 'several', coins: [first, second, ...rest] };
    }
    default:
      throw new WireShapeError(`${path}.kind`, kind);
  }
}

export function decodeBoardRow(raw: unknown, path = '$.row'): BoardRow {
  assertNoInternalVocabulary(raw, path);
  const o = pick(obj(raw, path), BOARD_ROW_FIELDS);
  return {
    id: str(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`),
    summary: twoLines(o.summary, `${path}.summary`),
    thumbUrl: optStr(o.thumbUrl),
    reach: measured(o.reach, `${path}.reach`, 'not_read_yet'),
    spark: decodeSpark(o.spark, `${path}.spark`),
    momentum: tone(o.momentum),
    /* The fallback is `not_read_yet` and not `not_minted`, because it fires only when the
       server sent no reason at all — a server too old to know about this field, say. "We
       have not learned it" is true of that; "nothing has been minted from this" is a claim
       about the world we would be making on the server's behalf, and the row's own `coins`
       may say the opposite two lines down. */
    marketCapUsd: measured(o.marketCapUsd, `${path}.marketCapUsd`, 'not_read_yet'),
    /* Same reasoning as `marketCapUsd` one line up: the fallback covers a server that
       does not know about this field yet, and "we have not learned it" is the only
       honest thing to say on that server's behalf. */
    priceChange24h: delta(o.priceChange24h, `${path}.priceChange24h`, 'not_read_yet'),
    firstSeenAt: instantAt(o.firstSeenAt, `${path}.firstSeenAt`, 'not_read_yet'),
    coins: decodeCoinLink(o.coins, `${path}.coins`),
    isNew: bool(o.isNew, `${path}.isNew`),
  };
}

/** One page of the All time list. A `next` that is not a whole offset ends the list rather than looping. */
export function decodeNarrativesPage(raw: unknown, path = '$'): NarrativesPage {
  const o = obj(raw, path);
  const next = o['next'];
  return {
    stories: arr(o['stories'], `${path}.stories`).map((s, i) => decodeStory(s, `${path}.stories[${i}]`)),
    provenance: decodeBoardProvenance(o['provenance'], `${path}.provenance`),
    next: typeof next === 'number' && Number.isSafeInteger(next) && next > 0 ? next : null,
  };
}

export function decodeNarratives(raw: unknown, path = '$'): NarrativesList {
  const o = obj(raw, path);
  return {
    tick: int(o['tick'], `${path}.tick`),
    stories: arr(o['stories'], `${path}.stories`).map((s, i) => decodeStory(s, `${path}.stories[${i}]`)),
    provenance: decodeBoardProvenance(o['provenance'], `${path}.provenance`),
    warCoin: decodeWarCoin(o['warCoin'], `${path}.warCoin`),
  };
}

/** The Twitter World War's coin, or null: absent (an older server, or another list) is no coin, never an error. */
export function decodeWarCoin(raw: unknown, path = '$.warCoin'): WarCoin | null {
  if (raw === null || raw === undefined) return null;
  const o = obj(raw, path);
  return {
    address: str(o['address'], `${path}.address`),
    ticker: optStr(o['ticker']),
    name: optStr(o['name']),
    imageUrl: httpsOrNull(o['imageUrl']),
    marketCapUsd: measured(o['marketCapUsd'], `${path}.marketCapUsd`, 'not_read_yet'),
    changePct: delta(o['priceChange24h'], `${path}.priceChange24h`, 'not_read_yet'),
    tradable: o['tradable'] === true,
  };
}

export function decodeBoardTick(raw: unknown, path = '$'): BoardTick {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  return {
    tick: int(o['tick'], `${path}.tick`),
    order: arr(o['order'], `${path}.order`).map((id, i) => str(id, `${path}.order[${i}]`)),
    rows: arr(o['rows'], `${path}.rows`).map((r, i) => decodeBoardRow(r, `${path}.rows[${i}]`)),
    provenance: decodeBoardProvenance(o['provenance'], `${path}.provenance`),
  };
}

/**
 * Where the stories on this frame came from.
 *
 * ★ AN ABSENT OR UNREADABLE FIELD RESOLVES TO `unstated` AND NEVER TO `observed`, and this
 * is the one defaulting decision in this function worth arguing about. It is
 * `decodeFeedSource`'s rule, applied to the more dangerous field: `observed` is the value
 * that makes the app say NOTHING, so defaulting to it would mean a server that forgot to
 * send provenance publishes six invented stories as observations — which is precisely the
 * failure the field was added to stop, arriving through the decoder that was supposed to
 * be the last line of defence.
 *
 * So an unknown `kind` is `unstated` too, rather than a throw. A frame is not worth
 * discarding over a discriminator this decoder has not been taught yet — the rows are
 * still the rows — and `unstated` renders a banner, so the failure is loud without being
 * fatal.
 *
 * The counts are read with `int` and refused rather than coerced: a `seeded` branch whose
 * numbers did not arrive as numbers has nothing to say, and a banner reading "NaN of 6"
 * would send somebody looking for a bug in the wrong package.
 */
function decodeBoardProvenance(raw: unknown, path: string): BoardProvenance {
  if (raw === null || raw === undefined) return { kind: 'unstated' };
  const o = obj(raw, path);
  if (o['kind'] === 'observed') return { kind: 'observed' };
  if (o['kind'] !== 'seeded') return { kind: 'unstated' };
  return {
    kind: 'seeded',
    seededStories: int(o['seededStories'], `${path}.seededStories`),
    totalStories: int(o['totalStories'], `${path}.totalStories`),
    connectSourceLabel: str(o['connectSourceLabel'], `${path}.connectSourceLabel`),
  };
}

function decodeEvidence(raw: unknown, path: string): Evidence {
  const o = obj(raw, path);
  return {
    evidenceId: str(o['evidenceId'], `${path}.evidenceId`),
    sourceLabel: str(o['sourceLabel'], `${path}.sourceLabel`),
    authorLabel: str(o['authorLabel'], `${path}.authorLabel`),
    permalink: str(o['permalink'], `${path}.permalink`),
    excerpt: str(o['excerpt'], `${path}.excerpt`),
    thumbUrl: optStr(o['thumbUrl']),
    /* Our copy's file name (0119); anything but 32 hex characters, or a server before it, is none. */
    thumbFile: postPicFile(o['thumbFile']),
    postedAt: instantAt(o['postedAt'], `${path}.postedAt`, 'not_reported'),
    relation: str(o['relation'], `${path}.relation`),
  };
}

function decodeDiscussionPost(raw: unknown, path: string): DiscussionPost {
  const o = obj(raw, path);
  return {
    postId: str(o['postId'], `${path}.postId`),
    authorLabel: str(o['authorLabel'], `${path}.authorLabel`),
    text: str(o['text'], `${path}.text`),
    postedAt: instantAt(o['postedAt'], `${path}.postedAt`, 'unreadable'),
  };
}

/**
 * The earliest post found. Absent — a server that does not send it yet — is pending with
 * `not_read_yet`, never a post. An unrecognised `startedBy` reads as null: the claim is
 * dropped rather than guessed, since "Started by" is the one sentence here that needs proof.
 */
function decodeEarliestPost(v: unknown, path: string): EarliestPost {
  if (v === null || v === undefined) return { known: false, pending: 'not_read_yet' };
  const o = obj(v, path);
  const at = o['at'];
  if (at === null || at === undefined) return { known: false, pending: reasonOf(o['why'] ?? 'not_read_yet') };
  if (typeof at !== 'number') throw new WireShapeError(`${path}.at`, at);
  const startedBy = o['startedBy'];
  return {
    known: true,
    at: at as Millis,
    authorLabel: str(o['authorLabel'], `${path}.authorLabel`),
    permalink: optStr(o['permalink']),
    startedBy: startedBy === 'quoted' || startedBy === 'samePicture' ? startedBy : null,
  };
}

export function decodeStory(raw: unknown, path = '$.story'): Story {
  assertNoInternalVocabulary(raw, path);
  const o = pick(obj(raw, path), STORY_FIELDS);
  return {
    id: str(o.id, `${path}.id`),
    title: str(o.title, `${path}.title`),
    summary: twoLines(o.summary, `${path}.summary`),
    thumbUrl: optStr(o.thumbUrl),
    thumbFile: postPicFile(o.thumbFile),
    reach: measured(o.reach, `${path}.reach`, 'not_read_yet'),
    reachDelta24h: delta(o.reachDelta24h, `${path}.reachDelta24h`, 'not_read_yet'),
    spark: decodeSpark(o.spark, `${path}.spark`),
    momentum: tone(o.momentum),
    firstSeenAt: instantAt(o.firstSeenAt, `${path}.firstSeenAt`, 'not_read_yet'),
    earliestPost: decodeEarliestPost(o.earliestPost, `${path}.earliestPost`),
    coins: decodeCoinLink(o.coins, `${path}.coins`),
    evidence: arr(o.evidence, `${path}.evidence`).map((e, i) =>
      decodeEvidence(e, `${path}.evidence[${i}]`),
    ),
    stage: o.stage === 'early' || o.stage === 'forming' || o.stage === 'big' ? o.stage : null,
    discussion: arr(o.discussion, `${path}.discussion`).map((d, i) =>
      decodeDiscussionPost(d, `${path}.discussion[${i}]`),
    ),
    provenance: decodeStoryProvenance(o.provenance, `${path}.provenance`),
    /* Absent from a server that does not send it yet: null, which orders after every known gain, never as 0. */
    viewsGained1h: o.viewsGained1h === undefined || o.viewsGained1h === null ? null : measured(o.viewsGained1h, `${path}.viewsGained1h`, 'not_read_yet'),
    /* The page's own sums, from a projector that sends them (services/project, 0093); null from one that does not. */
    viewsGained1hPosts: count(o.viewsGained1hPosts),
    viewsTotal: o.viewsTotal === undefined || o.viewsTotal === null ? null : measured(o.viewsTotal, `${path}.viewsTotal`, 'not_read_yet'),
    viewsTotalPosts: count(o.viewsTotalPosts),
    viewsGained: decodeViewsGained(o.viewsGained),
    viewsGainedAll: decodeViewsGained(o.viewsGainedAll),
    viewsTotals: decodeViewsGained(o.viewsTotals),
    viewsTotalsAll: decodeViewsGained(o.viewsTotalsAll),
    postViews: decodePostViews(o.postViews),
    inWindow: decodeInWindow(o.inWindow, `${path}.inWindow`),
    /* A top coin that does not decode is dropped, never the page: the card then says no coin is settled. */
    topCoin: (() => {
      try {
        return o.topCoin === undefined || o.topCoin === null ? null : decodeCoin(o.topCoin, `${path}.topCoin`);
      } catch {
        return null;
      }
    })(),
    postCount: count(o.postCount),
    foundAt: o.foundAt === undefined || o.foundAt === null ? null : instantAt(o.foundAt, `${path}.foundAt`, 'not_reported'),
    dead: o.dead === true,
    countries: countriesOf(o.countries),
    viewsPerMinute: decodeSpeeds(o.viewsPerMinute, `${path}.viewsPerMinute`),
    viewsGainedDay: o.viewsGainedDay === undefined || o.viewsGainedDay === null ? null : measured(o.viewsGainedDay, `${path}.viewsGainedDay`, 'not_read_yet'),
    viewsGainedWeek: o.viewsGainedWeek === undefined || o.viewsGainedWeek === null ? null : measured(o.viewsGainedWeek, `${path}.viewsGainedWeek`, 'not_read_yet'),
    /* Absent, or not a whole count: null, and the card offers no "See N coins" (never a 0 it did not count). */
    coinsMade: count(o.coinsMade),
  };
}

/** A narrative's two speeds: absent or null is none; anything else must be two views-a-minute numbers. */
function decodeSpeeds(raw: unknown, path: string): { readonly now: number; readonly before: number } | null {
  if (raw === undefined || raw === null) return null;
  const o = obj(raw, path);
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!ok(o['now'])) throw new WireShapeError(`${path}.now`, o['now']);
  if (!ok(o['before'])) throw new WireShapeError(`${path}.before`, o['before']);
  return { now: o['now'], before: o['before'] };
}

/** The countries of a meme war: two or more names, or null for anything else (never a page dropped for it). */
function countriesOf(v: unknown): readonly string[] | null {
  if (!Array.isArray(v) || v.length < 2 || !v.every((c): c is string => typeof c === 'string' && c.trim() !== '')) return null;
  return v.map((c) => c.trim());
}

/** A whole count of posts the server sent, or null when it sent none or something that is not one. */
function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * The views the narrative gained in each slot (`stepMs`, five minutes) from `fromMs`, each post's
 * gain spread between its own readings and added up by the projector. A slot with no number is one
 * no post was being read in, kept as null so the chart breaks there. Null when the server sent no
 * series at all, which is not the same as a quiet day.
 */
function decodeViewsGained(raw: unknown): ViewsGained | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const fromMs = typeof r['fromMs'] === 'number' && Number.isFinite(r['fromMs']) ? r['fromMs'] : null;
  const stepMs = typeof r['stepMs'] === 'number' && Number.isFinite(r['stepMs']) && r['stepMs'] > 0 ? r['stepMs'] : null;
  if (fromMs === null || stepMs === null || !Array.isArray(r['values'])) return null;
  return { fromMs, stepMs, values: r['values'].map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)) };
}

/** Each listed post's newest views and last-hour gain, by post id; null when the server sent none. */
function decodePostViews(raw: unknown): ReadonlyMap<string, PostViews> | null {
  if (!Array.isArray(raw)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return new Map(raw.flatMap((p) => {
    if (typeof p !== 'object' || p === null) return [];
    const r = p as Record<string, unknown>;
    return typeof r['postId'] === 'string' ? [[r['postId'], { views: n(r['views']), gainedLastHour: n(r['gainedLastHour']), foundAt: n(r['foundAt']) }] as const] : [];
  }));
}

/**
 * The tab's orders, one per window the server sends (1h, 6h, 24h): views gained in it (a dash with
 * its reason when no post was read in it, never 0), the posts found in it, and the place in the
 * trending order. An entry that does not decode is left out; the tab then orders that story after
 * every one that has the window.
 */
function decodeInWindow(raw: unknown, path: string): ReadonlyMap<number, InWindow> | null {
  if (!Array.isArray(raw)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return new Map(raw.flatMap((w, i): (readonly [number, InWindow])[] => {
    if (typeof w !== 'object' || w === null) return [];
    const r = w as Record<string, unknown>;
    const hours = n(r['hours']);
    const place = n(r['trendingPlace']);
    const posts = n(r['newPosts']);
    /* A dead narrative has the window's facts and no Trending place. */
    if (hours === null || posts === null) return [];
    try {
      return [[hours, { viewsGained: measured(r['viewsGained'], `${path}[${i}].viewsGained`, 'not_read_yet'), newPosts: posts, trendingPlace: place, viralAccounts: n(r['viralAccounts']), viralMinViews: n(r['viralMinViews']) }] as const];
    } catch {
      return [];
    }
  }));
}

/**
 * Whether this story happened.
 *
 * ★ ABSENT OR UNREADABLE RESOLVES TO `unstated`, NEVER TO `observed` — `decodeBoardTick`'s
 * rule, applied to the page. `observed` is the value that makes the app say nothing, so
 * defaulting to it would let a server that forgot the field publish an invented story as a
 * real one, through the decoder that is supposed to be the last line of defence.
 */
function decodeStoryProvenance(raw: unknown, path: string): StoryProvenance {
  if (raw === null || raw === undefined) return { kind: 'unstated' };
  const o = obj(raw, path);
  if (o['kind'] === 'observed') return { kind: 'observed' };
  if (o['kind'] !== 'seeded') return { kind: 'unstated' };
  return { kind: 'seeded', connectSourceLabel: str(o['connectSourceLabel'], `${path}.connectSourceLabel`) };
}

/**
 * One post on the For You or Popular feed.
 *
 * ★ THE COIN RULE IS ENFORCED HERE AS WELL AS ON THE SERVER. A post may carry a coin (`one`)
 * or coins (`several`) only together with the story id of the narrative that link belongs to;
 * one without is a server sending something a single post must never carry, and it throws
 * `WireLeakError` — the row is not shown with a coin of unknown standing. A row projected before
 * every post carried a coin line has `coins: null`, and that reads as `pending`: not searched
 * is the only thing such a row can be said to know. `unchecked` is a post's alone and is read
 * here, never by `decodeCoinLink`, so a narrative carrying it is still a shape error.
 */
export function decodeRisingPost(raw: unknown, path = '$.post'): RisingPost {
  assertNoInternalVocabulary(raw, path);
  const o = pick(obj(raw, path), RISING_POST_FIELDS);
  const storyId = optStr(o.storyId);
  const kind = o.coins === null || o.coins === undefined ? null : obj(o.coins, `${path}.coins`)['kind'];
  const coins: PostCoinLink =
    kind === null
      ? { kind: 'pending' }
      : kind === 'unchecked'
        ? { kind: 'unchecked' }
        : kind === 'matched'
          ? { kind: 'matched', coin: decodeCoin(obj(o.coins, `${path}.coins`)['coin'], `${path}.coins.coin`), evidence: decodeCoinEvidence(obj(o.coins, `${path}.coins`)['evidence'], `${path}.coins.evidence`) }
          : decodeCoinLink(o.coins, `${path}.coins`);
  if ((coins.kind === 'one' || coins.kind === 'several') && storyId === null) {
    throw new WireLeakError(`${path}.coins (a ${coins.kind} link on a post with no narrative)`);
  }
  return {
    id: str(o.id, `${path}.id`),
    sourceLabel: str(o.sourceLabel, `${path}.sourceLabel`),
    authorLabel: str(o.authorLabel, `${path}.authorLabel`),
    /* Added by the read service from the account; absent from an older server or the owner's copies. */
    authorPictureUrl: httpsOrNull(o.authorPictureUrl),
    /* Our copy's file name, sent beside the link since 0079; anything but 32 hex characters is none. */
    authorPictureFile: posterPicFile(o.authorPictureFile),
    permalink: optStr(o.permalink),
    excerpt: str(o.excerpt, `${path}.excerpt`),
    thumbUrl: optStr(o.thumbUrl),
    /* Our copy of that picture's file name, added by the read service since 0119; else none. */
    thumbFile: postPicFile(o.thumbFile),
    /* Absent from a row projected before the field existed: no play icon, the picture still shows. */
    thumbIsVideo: o.thumbIsVideo === undefined ? false : bool(o.thumbIsVideo, `${path}.thumbIsVideo`),
    postedAt: instantAt(o.postedAt, `${path}.postedAt`, 'not_reported'),
    reach: measured(o.reach, `${path}.reach`, 'not_read_yet'),
    readAt: instantAt(o.readAt, `${path}.readAt`, 'not_read_yet'),
    spark: decodeSpark(o.spark, `${path}.spark`),
    storyId,
    coins,
    /* Absent from a row projected before the field existed: no older coin is said to be running. */
    runningOlder: o.runningOlder === undefined || o.runningOlder === null ? [] : arr(o.runningOlder, `${path}.runningOlder`).map((c, i) => decodeOlderCoin(c, `${path}.runningOlder[${i}]`)),
    ...decodeTranslation(o.translation, `${path}.translation`),
    ...decodeInStory(o.inStory),
    ...decodeQuote(o.quote, `${path}.quote`),
    ...decodeDeleted(o.deletedAt),
    ...decodeSharedBy(o.sharedBy, `${path}.sharedBy`),
  };
}

/**
 * A huge account's share of the card's post. Absent or null: none. One that is not readable (no id,
 * no @handle, an unknown way of sharing) is dropped and the card shown without it — another
 * account's post is never a reason to refuse the card. An unreadable time is "not reported".
 */
export function decodeSharedBy(raw: unknown, path = '$.sharedBy'): { sharedBy?: SharedBy } {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = pick(raw as Record<string, unknown>, SHARED_BY_FIELDS);
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const id = text(o.id);
  const authorLabel = text(o.authorLabel);
  const how = o.how === 'quoted' || o.how === 'samePicture' || o.how === 'reposted' ? o.how : null;
  if (id === null || authorLabel === null || !authorLabel.startsWith('@') || how === null) return {};
  let at: Instant;
  try {
    at = instantAt(o.at, `${path}.at`, 'not_reported');
  } catch {
    at = instantFrom(null, 'not_reported');
  }
  return {
    sharedBy: {
      id,
      authorLabel,
      authorName: text(o.authorName),
      authorPictureUrl: httpsOrNull(o.authorPictureUrl),
      authorPictureFile: posterPicFile(o.authorPictureFile),
      how,
      at,
      permalink: httpsOrNull(o.permalink),
    },
  };
}

/**
 * When the post was found deleted from its source. Only a whole positive time in ms counts: absent,
 * null or anything else is "not known to be deleted", and the card shows as it always did — a
 * malformed field never refuses the card, and never marks a live post deleted.
 */
export function decodeDeleted(raw: unknown): { deletedAt?: number } {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? { deletedAt: raw } : {};
}

/**
 * The post a card's post quotes. Absent or null: none. One that is not a readable quote (no id, no
 * account, nothing to draw) is dropped and the card shown without it: another account's post is
 * never a reason to refuse the card, or the feed. The internal-vocabulary check has already run over
 * the whole card, quote included.
 */
export function decodeQuote(raw: unknown, path = '$.quote'): { quote?: QuotedPost } {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = pick(raw as Record<string, unknown>, QUOTED_POST_FIELDS);
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const id = text(o.id);
  const authorLabel = text(o.authorLabel);
  const excerpt = typeof o.excerpt === 'string' ? o.excerpt : '';
  const thumbUrl = httpsOrNull(o.thumbUrl);
  if (id === null || authorLabel === null || (excerpt.trim() === '' && thumbUrl === null)) return {};
  let postedAt: Instant;
  try {
    postedAt = instantAt(o.postedAt, `${path}.postedAt`, 'not_reported');
  } catch {
    postedAt = instantFrom(null, 'not_reported');
  }
  return {
    quote: {
      id,
      authorLabel,
      authorName: text(o.authorName),
      authorPictureUrl: httpsOrNull(o.authorPictureUrl),
      authorPictureFile: posterPicFile(o.authorPictureFile),
      permalink: httpsOrNull(o.permalink),
      excerpt,
      thumbUrl,
      thumbFile: postPicFile(o.thumbFile),
      thumbIsVideo: o.thumbIsVideo === true,
      postedAt,
    },
  };
}

/**
 * The read service's English for a post written in another language. Absent or null: none, and the
 * card shows its own words. One with no words or no readable language code is dropped, never shown
 * and never a reason to refuse the whole feed: the original words are always there to fall back on.
 */
export function decodeTranslation(raw: unknown, path: string): { translation?: PostTranslation } {
  if (raw === undefined || raw === null) return {};
  const o = obj(raw, path);
  const text = o['text'];
  const from = o['from'];
  if (typeof text !== 'string' || text.trim() === '' || typeof from !== 'string' || !/^[a-z]{2,3}$/.test(from)) return {};
  return { translation: { text, from } };
}

/**
 * The real narrative a post is part of, when the read service says (story-tags.ts). Absent, or
 * without an id: no tag. A missing title or count is left out of the tag, never guessed.
 */
function decodeInStory(raw: unknown): { inStory?: PostInStory } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const storyId = typeof o['storyId'] === 'string' && o['storyId'] !== '' ? o['storyId'] : null;
  if (storyId === null) return {};
  const title = typeof o['title'] === 'string' && o['title'].trim() !== '' ? o['title'] : null;
  const posts = typeof o['posts'] === 'number' && Number.isInteger(o['posts']) && o['posts'] > 0 ? o['posts'] : null;
  return { inStory: { storyId, title, posts } };
}

/** One older coin trading since a post: a number we were not sent is a dash, never zero. */
function decodeOlderCoin(raw: unknown, path: string): OlderCoin {
  const o = pick(obj(raw, path), OLDER_COIN_FIELDS);
  const usd = (v: unknown, at: string): Measured => {
    if (v === null || v === undefined) return measuredFrom(null, 'not_read_yet');
    return measuredFrom(int(v, at), 'not_read_yet');
  };
  return {
    address: str(o.address, `${path}.address`),
    name: optStr(o.name),
    ticker: optStr(o.ticker),
    launchedAt: instantAt(o.launchedAt, `${path}.launchedAt`, 'not_reported'),
    hourBeforeUsd: usd(o.hourBeforeUsd, `${path}.hourBeforeUsd`),
    peakHourUsd: usd(o.peakHourUsd, `${path}.peakHourUsd`),
    priceChangeSincePost: o.priceChangeSincePost === null || o.priceChangeSincePost === undefined ? null : int(o.priceChangeSincePost, `${path}.priceChangeSincePost`),
    readAt: instantAt(o.readAt, `${path}.readAt`, 'not_read_yet'),
  };
}

/** One page of the infinite scroll: its posts as the frame's are decoded, and an opaque cursor or null. */
export function decodeRisingPage(raw: unknown, path = '$'): RisingPage {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  const next = o['next'];
  if (next !== null && typeof next !== 'string') throw new WireShapeError(`${path}.next`, next);
  return {
    posts: arr(o['posts'], `${path}.posts`).map((p, i) => decodeRisingPost(p, `${path}.posts[${i}]`)),
    next,
  };
}

const SORT_BYS = ['trending', 'most_viewed'] as const;
/** Each sort's own windows: Trending has one, Most viewed two. A pair outside these is refused. */
const SORT_WINDOWS: Readonly<Record<PostSortBy, readonly PostSortWindow[]>> = { trending: ['now'], most_viewed: ['today', 'week', 'all'] };

const viewCount = (v: unknown, path: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new WireShapeError(path, v);
  return v;
};

/**
 * For You's Trending or Most viewed, one page. Strict: a sort with a window not its own, a speed or
 * total that is not a count, or a missing `next` throws. A post with no entry of its own (no speeds
 * on Trending, no total on Most viewed) is dropped, never shown at zero.
 */
export function decodeRisingSorted(raw: unknown, path = '$'): RisingSorted {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  const by = SORT_BYS.find((b) => b === o['by']);
  if (by === undefined) throw new WireShapeError(`${path}.by`, o['by']);
  const window = SORT_WINDOWS[by].find((w) => w === o['window']);
  if (window === undefined) throw new WireShapeError(`${path}.window`, o['window']);
  const speeds = new Map<string, PostSpeeds>();
  const views = new Map<string, number>();
  const gained = new Map<string, number>();
  if (by === 'trending') {
    for (const [id, v] of Object.entries(obj(o['speeds'], `${path}.speeds`))) {
      const s = obj(v, `${path}.speeds.${id}`);
      speeds.set(id, { now: viewCount(s['now'], `${path}.speeds.${id}.now`), before: viewCount(s['before'], `${path}.speeds.${id}.before`) });
    }
  } else {
    for (const [id, v] of Object.entries(obj(o['views'], `${path}.views`))) views.set(id, viewCount(v, `${path}.views.${id}`));
    if (window !== 'all') for (const [id, v] of Object.entries(obj(o['gained'], `${path}.gained`))) gained.set(id, viewCount(v, `${path}.gained.${id}`));
  }
  const next = o['next'];
  if (next !== null && typeof next !== 'string') throw new WireShapeError(`${path}.next`, next);
  const has = (id: string): boolean => (by === 'trending' ? speeds.has(id) : views.has(id) && (window === 'all' || gained.has(id)));
  const posts = arr(o['posts'], `${path}.posts`).map((p, i) => decodeRisingPost(p, `${path}.posts[${i}]`)).filter((p) => has(p.id));
  return { by, window, posts, speeds, views, gained, next };
}

export function decodeRisingFeed(raw: unknown, path = '$'): RisingFeed {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  return {
    tick: int(o['tick'], `${path}.tick`),
    posts: arr(o['posts'], `${path}.posts`).map((p, i) => decodeRisingPost(p, `${path}.posts[${i}]`)),
  };
}

const MARKET_TIMEFRAMES: readonly MarketTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

/**
 * A coin's market. A candle missing a number is dropped, never drawn at zero; a trade with an
 * unknown side is dropped, never coloured as either.
 */
export function decodeCoinMarket(raw: unknown, path = '$.market'): CoinMarket {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  const timeframe = MARKET_TIMEFRAMES.find((t) => t === o['timeframe']) ?? '1m';
  if (o['kind'] !== 'read') return { kind: 'unavailable', timeframe };
  const candles: Candle[] | null = o['candles'] === null ? null : arr(o['candles'], `${path}.candles`).flatMap((c) => {
    const r = obj(c, `${path}.candles[]`);
    const [t, op, h, l, cl] = [r['t'], r['o'], r['h'], r['l'], r['c']];
    return [t, op, h, l, cl].every((v) => typeof v === 'number' && Number.isFinite(v)) ? [{ t: t as number, o: op as number, h: h as number, l: l as number, c: cl as number }] : [];
  });
  const trades: MarketTrade[] | null = o['trades'] === null ? null : arr(o['trades'], `${path}.trades`).flatMap((t, i) => {
    const r = obj(t, `${path}.trades[${i}]`);
    const side = r['side'] === 'buy' || r['side'] === 'sell' ? r['side'] : null;
    if (side === null) return [];
    return [{
      tx: optStr(r['tx']),
      side,
      tokenAmount: measured(r['tokenAmount'], `${path}.trades[${i}].tokenAmount`, 'not_reported'),
      usd: measured(r['usd'], `${path}.trades[${i}].usd`, 'not_reported'),
      priceUsd: measured(r['priceUsd'], `${path}.trades[${i}].priceUsd`, 'not_reported'),
      at: instantAt(r['at'], `${path}.trades[${i}].at`, 'not_reported'),
      maker: optStr(r['maker']),
    }];
  });
  const venue = o['venue'] === 'curve' || o['venue'] === 'pool' ? o['venue'] : null;
  return {
    kind: 'read',
    timeframe,
    venue,
    candles,
    trades,
    curveProgress: o['curveProgress'] === null || o['curveProgress'] === undefined ? null : measured(o['curveProgress'], `${path}.curveProgress`, 'not_reported'),
    pair: marketPair(o['pair'], `${path}.pair`),
    coin: o['coin'] === null || o['coin'] === undefined ? null : { ticker: optStr(obj(o['coin'], `${path}.coin`)['ticker']), name: optStr(obj(o['coin'], `${path}.coin`)['name']) },
  };
}

/** The chart's pool. Absent (an older read service) is null, the same as "trades nowhere we can see". */
function marketPair(v: unknown, path: string): MarketPair | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const t = o['token'] === null || o['token'] === undefined ? null : obj(o['token'], `${path}.token`);
  const address = t === null ? null : optStr(t['address']);
  const venue = o['venue'] === null || o['venue'] === undefined ? {} : obj(o['venue'], `${path}.venue`);
  return {
    token: t === null || address === null ? null : { address, ticker: optStr(t['ticker']), name: optStr(t['name']), imageUrl: httpsOrNull(t['imageUrl']), stock: t['stock'] === true },
    venue: { name: optStr(venue['name']), launchpad: venue['launchpad'] === true, url: httpsOrNull(venue['url']) },
    liquidityUsd: measured(o['liquidityUsd'], `${path}.liquidityUsd`, 'not_reported'),
  };
}

/* ── search ───────────────────────────────────────────────────────────── */

const venueOf = (v: unknown): 'curve' | 'pool' | null => (v === 'curve' || v === 'pool' ? v : null);
const GAPS: readonly OriginGap[] = ['not_searched_yet', 'origin_not_found', 'possibly_deleted', 'tiktok_not_searchable'];

/**
 * The Search tab's reply. Only the fields named here are read, so a post that somehow arrived
 * with a narrative or a coin on it reaches the screen without them: search is a list.
 */
export function decodeSearch(raw: unknown, path = '$'): SearchResults {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  const n = obj(o['narratives'], `${path}.narratives`);
  const p = obj(o['posts'], `${path}.posts`);
  const c = obj(o['coins'], `${path}.coins`);
  const narratives = arr(n['items'], `${path}.narratives.items`).map((x, i): SearchNarrative => {
    const q = `${path}.narratives.items[${i}]`;
    const r = obj(x, q);
    const post = r['originPost'] === null || r['originPost'] === undefined ? null : obj(r['originPost'], `${q}.originPost`);
    const gap = GAPS.find((g) => g === r['originGap']) ?? null;
    return {
      storyId: optStr(r['storyId']),
      title: str(r['title'], `${q}.title`),
      thumbUrl: optStr(r['thumbUrl']),
      live: bool(r['live'], `${q}.live`),
      firstPostAt: instantAt(r['firstPostAt'], `${q}.firstPostAt`, 'not_read_yet'),
      firstCoinAt: instantAt(r['firstCoinAt'], `${q}.firstCoinAt`, 'not_read_yet'),
      peakMarketCapUsd: measured(r['peakMarketCapUsd'], `${q}.peakMarketCapUsd`, 'not_read_yet'),
      originPost: post === null ? null : {
        authorLabel: str(post['authorLabel'], `${q}.originPost.authorLabel`),
        permalink: optStr(post['permalink']),
        postedAt: instantAt(post['postedAt'], `${q}.originPost.postedAt`, 'not_reported'),
        afterLaunch: post['afterLaunch'] === true,
      },
      /* A past narrative with neither a post nor a known gap says "not searched yet", never nothing. */
      originGap: post === null && r['storyId'] === null ? (gap ?? 'not_searched_yet') : gap,
    };
  });
  const posts = arr(p['items'], `${path}.posts.items`).map((x, i): SearchPost => {
    const q = `${path}.posts.items[${i}]`;
    const r = obj(x, q);
    return {
      id: str(r['id'], `${q}.id`),
      sourceLabel: typeof r['sourceLabel'] === 'string' ? r['sourceLabel'] : '',
      authorLabel: str(r['authorLabel'], `${q}.authorLabel`),
      permalink: optStr(r['permalink']),
      excerpt: str(r['excerpt'], `${q}.excerpt`),
      thumbUrl: optStr(r['thumbUrl']),
      postedAt: instantAt(r['postedAt'], `${q}.postedAt`, 'not_reported'),
      live: bool(r['live'], `${q}.live`),
    };
  });
  const coins: SearchCoins = c['kind'] !== 'read'
    ? { kind: 'unavailable' }
    : {
        kind: 'read',
        capped: c['capped'] === true,
        sourcesMissing: typeof c['sourcesMissing'] === 'number' ? c['sourcesMissing'] : 0,
        items: arr(c['items'], `${path}.coins.items`).map((x, i) => decodeSearchCoin(x, `${path}.coins.items[${i}]`)),
      };
  return {
    term: str(o['term'], `${path}.term`),
    narratives: { capped: n['capped'] === true, items: narratives },
    posts: { capped: p['capped'] === true, items: posts },
    coins,
  };
}

/** One coin row as Search and the same-name list show it. */
function decodeSearchCoin(x: unknown, q: string): SearchCoin {
  const r = obj(x, q);
  const venue = venueOf(r['venue']);
  const m = r['matched'] === null || r['matched'] === undefined ? null : obj(r['matched'], `${q}.matched`);
  return {
    coinId: str(r['coinId'], `${q}.coinId`),
    address: str(r['address'], `${q}.address`),
    name: optStr(r['name']),
    ticker: optStr(r['ticker']),
    imageUrl: optStr(r['imageUrl']),
    marketCapUsd: measured(r['marketCapUsd'], `${q}.marketCapUsd`, 'not_reported'),
    launchedAt: instantAt(r['launchedAt'], `${q}.launchedAt`, 'not_reported'),
    venue,
    /* Progress belongs to a curve; on anything else it is not shown at all. */
    curveProgress: venue === 'curve' ? measured(r['curveProgress'], `${q}.curveProgress`, 'not_read_yet') : null,
    matched: m === null ? null : { storyId: optStr(m['storyId']), title: str(m['title'], `${q}.matched.title`) },
  };
}

/**
 * What is known about a coin against a post. Each fact is a literal boolean or null — anything
 * else is "not known", never coerced to a "no". A time difference must be a finite number.
 */
export function decodeCoinEvidence(raw: unknown, path = '$.evidence'): CoinEvidence {
  const o = obj(raw, path);
  const fact = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  const after = o['launchedAfterMs'];
  return {
    linksPost: fact(o['linksPost']),
    samePicture: fact(o['samePicture']),
    launchedAfterMs: typeof after === 'number' && Number.isFinite(after) ? after : null,
    /* Only a literal true: anything else is not the owner's coin for the story. */
    ...(o['storyCoin'] === true ? { storyCoin: true as const } : {}),
    /* The server's `posterBioNamesCoin`; only a literal true is said. */
    ...(o['posterBioNamesCoin'] === true ? { posterBio: true as const } : {}),
    /* The coin picked for the post (one post, one coin); only a literal true. */
    ...(o['picked'] === true ? { picked: true as const } : {}),
    /* The race: a whole number of 2 or more, or nothing. */
    ...(typeof o['racing'] === 'number' && Number.isInteger(o['racing']) && o['racing'] >= 2 ? { racing: o['racing'] } : {}),
    /* The post's trading coins: two or more distinct addresses, or nothing. */
    ...tradingCoinsOf(o['tradingCoins']),
  };
}

function tradingCoinsOf(raw: unknown): { readonly tradingCoins?: readonly string[] } {
  if (!Array.isArray(raw)) return {};
  const list = [...new Set(raw.filter((a): a is string => typeof a === 'string' && a.trim() !== ''))];
  return list.length >= 2 ? { tradingCoins: list } : {};
}

/**
 * An unsure post's same-named coins. Each is a coin with that name and nothing more: `matched`
 * is dropped whatever the server sent, since this list never says which coin is the post's.
 */
export function decodeSameNameCoins(raw: unknown, path = '$'): SameNameCoins {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  return {
    more: o['more'] === true,
    sourcesMissing: typeof o['sourcesMissing'] === 'number' && Number.isInteger(o['sourcesMissing']) && o['sourcesMissing'] >= 0 ? o['sourcesMissing'] : 0,
    items: arr(o['items'], `${path}.items`).map((x, i) => {
      const e = obj(x, `${path}.items[${i}]`)['evidence'];
      return { ...decodeSearchCoin(x, `${path}.items[${i}]`), matched: null, evidence: e === null || e === undefined ? null : decodeCoinEvidence(e, `${path}.items[${i}].evidence`) };
    }),
  };
}

/** The coins using a ticker: the same list shape, no post to weigh them against. */
export function decodeTickerCoins(raw: unknown, path = '$'): SameNameCoins {
  const list = decodeSameNameCoins(raw, path);
  return { ...list, items: list.items.map((c) => ({ ...c, evidence: null })) };
}

/** A post's name ideas for Create, in the server's order (free tickers first). */
export function decodeNameIdeas(raw: unknown, path = '$'): readonly NameIdea[] {
  assertNoInternalVocabulary(raw, path);
  return arr(obj(raw, path)['items'], `${path}.items`).map((x, i): NameIdea => {
    const q = `${path}.items[${i}]`;
    const r = obj(x, q);
    const u = obj(r['use'], `${q}.use`);
    const use: TickerUse =
      u['kind'] === 'free' ? { kind: 'free' }
        : u['kind'] === 'taken' ? { kind: 'taken', count: int(u['count'], `${q}.use.count`), more: u['more'] === true }
          : { kind: 'unknown' };
    return { name: str(r['name'], `${q}.name`), ticker: str(r['ticker'], `${q}.ticker`), use };
  });
}

export function decodeSearchedCoin(raw: unknown, path = '$.coin'): SearchedCoin {
  assertNoInternalVocabulary(raw, path);
  const r = obj(raw, path);
  return {
    coinId: str(r['coinId'], `${path}.coinId`),
    address: str(r['address'], `${path}.address`),
    name: optStr(r['name']),
    ticker: optStr(r['ticker']),
    imageUrl: optStr(r['imageUrl']),
    marketCapUsd: measured(r['marketCapUsd'], `${path}.marketCapUsd`, 'not_reported'),
    launchedAt: instantAt(r['launchedAt'], `${path}.launchedAt`, 'not_reported'),
    venue: venueOf(r['venue']),
  };
}

/* ── the Portfolio tab ───────────────────────────────────────────────────── */

const PORTFOLIO_RANGES: readonly PortfolioRange[] = ['1h', '6h', '24h'];

/**
 * A holding's gain, strictly: a known gain needs every number, finite, and a cost above zero; an
 * absence needs one of the two reasons. Anything else is a shape error, never a guessed number.
 */
export function decodeGain(p: Record<string, unknown>, path: string): Gain {
  if (p['kind'] === 'none') {
    if (p['why'] !== 'not_bought_here' && p['why'] !== 'history_unread') throw new WireShapeError(`${path}.why`, p['why']);
    return { kind: 'none', why: p['why'] };
  }
  if (p['kind'] !== 'known') throw new WireShapeError(`${path}.kind`, p['kind']);
  const costSol = int(p['costSol'], `${path}.costSol`);
  if (!(costSol > 0)) throw new WireShapeError(`${path}.costSol`, costSol);
  return {
    kind: 'known',
    sol: int(p['sol'], `${path}.sol`),
    costSol,
    pct: int(p['pct'], `${path}.pct`),
    usd: measured(p['usd'], `${path}.usd`, 'not_reported'),
    partial: bool(p['partial'], `${path}.partial`),
  };
}

export function decodePortfolio(raw: unknown, path = '$'): Portfolio {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  if (o['kind'] !== 'read') return { kind: 'unavailable' };
  const holdings = arr(o['holdings'], `${path}.holdings`).map((x, i): Holding => {
    const q = `${path}.holdings[${i}]`;
    const r = obj(x, q);
    const p = obj(r['profit'], `${q}.profit`);
    const n = r['story'] === null || r['story'] === undefined ? null : obj(r['story'], `${q}.story`);
    const amount = str(r['amount'], `${q}.amount`);
    if (!/^\d+$/.test(amount)) throw new WireShapeError(`${q}.amount`, amount);
    return {
      coinId: str(r['coinId'], `${q}.coinId`),
      address: str(r['address'], `${q}.address`),
      ticker: optStr(r['ticker']),
      name: optStr(r['name']),
      imageUrl: optStr(r['imageUrl']),
      amount,
      decimals: int(r['decimals'], `${q}.decimals`),
      priceUsd: measured(r['priceUsd'], `${q}.priceUsd`, 'not_reported'),
      valueUsd: measured(r['valueUsd'], `${q}.valueUsd`, 'not_reported'),
      change: measured(r['change'], `${q}.change`, 'not_reported'),
      profit: decodeGain(p, `${q}.profit`),
      story: n === null ? null : { storyId: str(n['storyId'], `${q}.story.storyId`), title: str(n['title'], `${q}.story.title`) },
    };
  });
  const c = obj(o['created'], `${path}.created`);
  const created = arr(c['coins'], `${path}.created.coins`).map((x, i): CreatedCoin => {
    const q = `${path}.created.coins[${i}]`;
    const r = obj(x, q);
    return {
      coinId: str(r['coinId'], `${q}.coinId`),
      address: str(r['address'], `${q}.address`),
      name: optStr(r['name']),
      ticker: optStr(r['ticker']),
      marketCapUsd: measured(r['marketCapUsd'], `${q}.marketCapUsd`, 'not_reported'),
      /* An older service sends none of these three: unknown, and not from a catch. */
      launchedAt: typeof r['launchedAt'] === 'number' && Number.isFinite(r['launchedAt']) ? r['launchedAt'] : null,
      graduated: typeof r['graduated'] === 'boolean' ? r['graduated'] : null,
      fromCatch: r['fromCatch'] === true,
    };
  });
  return {
    kind: 'read',
    address: str(o['address'], `${path}.address`),
    range: PORTFOLIO_RANGES.find((r) => r === o['range']) ?? '24h',
    solBalance: measured(o['solBalance'], `${path}.solBalance`, 'not_reported'),
    totalUsd: measured(o['totalUsd'], `${path}.totalUsd`, 'not_reported'),
    totalSol: measured(o['totalSol'], `${path}.totalSol`, 'not_reported'),
    holdings,
    notShown: typeof o['notShown'] === 'number' ? o['notShown'] : 0,
    unpriced: typeof o['unpriced'] === 'number' ? o['unpriced'] : 0,
    created: { unclaimedFeesSol: measured(c['unclaimedFeesSol'], `${path}.created.unclaimedFeesSol`, 'not_reported'), coins: created },
  };
}
