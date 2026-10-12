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
import type { BoardProvenance, BoardRow, BoardTick, Spark, SparkPoint, Tone } from './wire/board.ts';
import type { Coin, CoinLink, CoinOrigin, MarketCapBasis } from './wire/coin.ts';
import type { RisingFeed, RisingPost } from './wire/rising.ts';
import type { DiscussionPost, EarliestPost, Evidence, NarrativesList, Story, StoryProvenance } from './wire/story.ts';
import type { Candle, CoinMarket, MarketTimeframe, MarketTrade } from './wire/market.ts';
import {
  BOARD_ROW_FIELDS,
  COIN_FIELDS,
  FORBIDDEN_KEYS,
  FORBIDDEN_SUBSTRINGS,
  RISING_POST_FIELDS,
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
    case 'unsure':
      return { kind: 'unsure', claimCount: int(o['claimCount'], `${path}.claimCount`) };
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

export function decodeNarratives(raw: unknown, path = '$'): NarrativesList {
  const o = obj(raw, path);
  return {
    tick: int(o['tick'], `${path}.tick`),
    stories: arr(o['stories'], `${path}.stories`).map((s, i) => decodeStory(s, `${path}.stories[${i}]`)),
    provenance: decodeBoardProvenance(o['provenance'], `${path}.provenance`),
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
    discussion: arr(o.discussion, `${path}.discussion`).map((d, i) =>
      decodeDiscussionPost(d, `${path}.discussion[${i}]`),
    ),
    provenance: decodeStoryProvenance(o.provenance, `${path}.provenance`),
  };
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
 * ★ THE COIN RULE IS ENFORCED HERE AS WELL AS ON THE SERVER. A post may carry a coin only as
 * a confident (`one`) link, and only together with the story id of the narrative that link
 * belongs to. A `none`, `unsure` or `several` link, a coin without a story, or a story without
 * a coin is a server sending something a single post must never carry, and it throws
 * `WireLeakError` — the row is not shown with the coin quietly dropped.
 */
export function decodeRisingPost(raw: unknown, path = '$.post'): RisingPost {
  assertNoInternalVocabulary(raw, path);
  const o = pick(obj(raw, path), RISING_POST_FIELDS);
  const storyId = optStr(o.storyId);
  let coin: Coin | null = null;
  if (o.coins !== null && o.coins !== undefined) {
    const link = decodeCoinLink(o.coins, `${path}.coins`);
    if (link.kind !== 'one') throw new WireLeakError(`${path}.coins (a ${link.kind} link on a single post)`);
    coin = link.coin;
  }
  if ((coin === null) !== (storyId === null)) {
    throw new WireLeakError(`${path}.storyId (a coin and its narrative travel together or not at all)`);
  }
  return {
    id: str(o.id, `${path}.id`),
    sourceLabel: str(o.sourceLabel, `${path}.sourceLabel`),
    authorLabel: str(o.authorLabel, `${path}.authorLabel`),
    permalink: optStr(o.permalink),
    excerpt: str(o.excerpt, `${path}.excerpt`),
    thumbUrl: optStr(o.thumbUrl),
    postedAt: instantAt(o.postedAt, `${path}.postedAt`, 'not_reported'),
    reach: measured(o.reach, `${path}.reach`, 'not_read_yet'),
    readAt: instantAt(o.readAt, `${path}.readAt`, 'not_read_yet'),
    spark: decodeSpark(o.spark, `${path}.spark`),
    storyId,
    coin,
  };
}

export function decodeRisingFeed(raw: unknown, path = '$'): RisingFeed {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  return {
    tick: int(o['tick'], `${path}.tick`),
    posts: arr(o['posts'], `${path}.posts`).map((p, i) => decodeRisingPost(p, `${path}.posts[${i}]`)),
  };
}

const MARKET_TIMEFRAMES: readonly MarketTimeframe[] = ['1m', '5m', '1h', '6h'];

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
      at: instantAt(r['at'], `${path}.trades[${i}].at`, 'not_reported'),
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
  };
}
