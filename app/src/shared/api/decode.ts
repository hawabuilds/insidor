/**
 * THE BOUNDARY. Everything that arrives over the network passes through this file and
 * nothing skips it.
 *
 * Two jobs, and the second is the one that matters.
 *
 * 1. Validate. Types erase at runtime, so `raw: unknown` proves nothing about what the
 *    server actually sent. Every field is read defensively and every absence becomes a
 *    pending value carrying a reason — never a zero, never a guessed timestamp.
 *
 * 2. Censor. Decoding is a runtime pick against the allowlists in `wire/fields.ts`, so a
 *    field nobody asked for cannot reach a component even if the server starts sending it.
 *    Then `assertNoInternalVocabulary` runs over the raw payload and THROWS if an internal
 *    word appears, so a leak at the projection is loud here rather than silent until someone
 *    renders it six weeks later.
 *
 * The order is deliberate: assert first, decode second. If we decoded first the pick would
 * have already dropped the evidence, and a leak that has been silently discarded is a leak
 * nobody fixes at the source.
 */

import type { Instant, Measured, Delta, PendingReason } from '../format/measure.ts';
import { instantFrom, measuredFrom } from '../format/measure.ts';
import type { BoardRow, BoardTick, RowPatch, Spark, SparkPoint, Tone } from './wire/board.ts';
import type { Coin, CoinLink, MarketCapBasis } from './wire/coin.ts';
import type { FeedSource, Launch, LaunchFeed } from './wire/launch.ts';
import type { Pair, PairFeed, PairHead, PairListing } from './wire/pair.ts';
import type { DiscussionPost, Evidence, Story } from './wire/story.ts';
import type { TradeCost, TradeQuote } from './wire/trade.ts';
import {
  BOARD_ROW_FIELDS,
  COIN_FIELDS,
  FEED_SOURCE_FIELDS,
  FORBIDDEN_KEYS,
  FORBIDDEN_SUBSTRINGS,
  LAUNCH_FIELDS,
  PAIR_FIELDS,
  PAIR_HEAD_FIELDS,
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

export function decodeBoardTick(raw: unknown, path = '$'): BoardTick {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  return {
    tick: int(o['tick'], `${path}.tick`),
    order: arr(o['order'], `${path}.order`).map((id, i) => str(id, `${path}.order[${i}]`)),
    rows: arr(o['rows'], `${path}.rows`).map((r, i) => decodeBoardRow(r, `${path}.rows[${i}]`)),
  };
}

/**
 * A patch carries only the fields that moved. Unknown keys are dropped rather than merged,
 * so a patch cannot introduce a field the full row shape does not have.
 */
export function decodeRowPatch(raw: unknown, path = '$.patch'): RowPatch {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  const f = obj(o['fields'], `${path}.fields`);
  const fields: Record<string, unknown> = {};
  if ('title' in f) fields['title'] = str(f['title'], `${path}.fields.title`);
  if ('summary' in f) fields['summary'] = twoLines(f['summary'], `${path}.fields.summary`);
  if ('thumbUrl' in f) fields['thumbUrl'] = optStr(f['thumbUrl']);
  if ('reach' in f) fields['reach'] = measured(f['reach'], `${path}.fields.reach`, 'not_read_yet');
  if ('spark' in f) fields['spark'] = decodeSpark(f['spark'], `${path}.fields.spark`);
  if ('momentum' in f) fields['momentum'] = tone(f['momentum']);
  if ('marketCapUsd' in f) {
    fields['marketCapUsd'] = measured(f['marketCapUsd'], `${path}.fields.marketCapUsd`, 'not_read_yet');
  }
  if ('priceChange24h' in f) {
    fields['priceChange24h'] = delta(f['priceChange24h'], `${path}.fields.priceChange24h`, 'not_read_yet');
  }
  if ('coins' in f) fields['coins'] = decodeCoinLink(f['coins'], `${path}.fields.coins`);
  return { id: str(o['id'], `${path}.id`), fields: fields as RowPatch['fields'] };
}

/* ── launches ─────────────────────────────────────────────────────────── */

/**
 * The mint-time bound, in seconds.
 *
 * Absent, non-numeric, non-finite or negative all become `null`, which the rail reads as
 * "no bound was stated". ★ NOTE THE DIRECTION OF THAT DEFAULT AND WHY IT IS SAFE HERE: a
 * null bound means the rail shows the age WITHOUT a "~", i.e. as a reading. That is only
 * correct because the server sends this field for exactly the bounded case and omits it
 * for the exact one — 0005's `bounded_requires_width` makes a bounded mint time with no
 * width unwritable, and `projectMintTime` publishes such a row as unreadable rather than
 * as a bare instant. So a missing bound beside a present instant means exact, by
 * construction on the far side, and this decoder does not have to guess.
 *
 * A negative half-width is not a bound, it is a broken reading, and it degrades to the
 * same null rather than to an interval that runs backwards.
 */
function boundSeconds(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/**
 * One launch.
 *
 * Assert first, pick second, exactly like `decodeBoardRow` — a leak that has already been
 * dropped by the pick is a leak nobody fixes at the source. This one earns the assert more
 * than most: `name` and `ticker` are free text somebody chose while minting a coin, and a
 * vendor's name inside a token name is free to type.
 */
export function decodeLaunch(raw: unknown, path = '$.launch'): Launch {
  assertNoInternalVocabulary(raw, path);
  const o = pick(obj(raw, path), LAUNCH_FIELDS);
  return {
    launchId: str(o.launchId, `${path}.launchId`),
    ticker: str(o.ticker, `${path}.ticker`),
    name: str(o.name, `${path}.name`),
    address: str(o.address, `${path}.address`),
    venueLabel: str(o.venueLabel, `${path}.venueLabel`),
    /* Unknown stays unknown, and is never backfilled from anything. The fallback reason
       fires only when the server sent no reason at all — "we have not learned it" is the
       only thing that can honestly be said on such a server's behalf. */
    mintedAt: instantAt(o.mintedAt, `${path}.mintedAt`, 'not_read_yet'),
    mintedAtBoundS: boundSeconds(o.mintedAtBoundS),
    /* `no_market` and not `not_read_yet`: on this rail the fallback describes a coin
       minted minutes ago, and "nothing is quotable yet" is what is true of nearly all of
       them. Neither branch of this function can produce a number from an absence. */
    marketCapUsd: measured(o.marketCapUsd, `${path}.marketCapUsd`, 'no_market'),
    marketCapBasis: decodeBasis(o.marketCapBasis),
  };
}

/**
 * One frame of the rail. `launches` is the order; nothing here sorts it.
 *
 * Every row is decoded, and one unreadable row throws the whole frame rather than being
 * skipped. That is the same call `decodeBoardTick` makes: a rail silently one row short is
 * a rail that is wrong in a way nobody can see, and the caller already has an error state
 * that says so out loud.
 */
export function decodeLaunchFeed(raw: unknown, path = '$'): LaunchFeed {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  return {
    tick: int(o['tick'], `${path}.tick`),
    launches: arr(o['launches'], `${path}.launches`).map((l, i) =>
      decodeLaunch(l, `${path}.launches[${i}]`),
    ),
    source: decodeFeedSource(o['source'], `${path}.source`),
  };
}

/**
 * The state of the feed this frame came off.
 *
 * ★ A MISSING `source` IS `live: false` AND AN UNKNOWN INSTANT — never a quiet default to
 * healthy, and this is the one defaulting decision in the file worth arguing. A server too
 * old to send the field is a server whose freshness we genuinely do not know, and the rail
 * over it is exactly the rail this whole change exists to stop: rows with nothing above
 * them. So the absence resolves to the honest statement, which makes the banner appear and
 * the pip go out, and the failure lands on the side of saying too much rather than too
 * little.
 *
 * `live` is read with `bool` and never coerced. A truthy string would otherwise light the
 * pip over a dead feed, which is the cheapest lie in the app arriving through a decoder.
 */
function decodeFeedSource(raw: unknown, path: string): FeedSource {
  if (raw === null || raw === undefined) {
    return { lastHeardAt: instantFrom(null, 'not_read_yet'), live: false };
  }
  const o = pick(obj(raw, path), FEED_SOURCE_FIELDS);
  return {
    /* Unknown stays unknown. It is NOT backfilled from the moment this frame was
       projected, which is when WE ran — the same mistake as backfilling a mint time from
       when we first looked, and it would make a feed nobody has ever watched read as one
       heard from a second ago. */
    lastHeardAt: instantAt(o.lastHeardAt, `${path}.lastHeardAt`, 'not_read_yet'),
    live: bool(o.live, `${path}.live`),
  };
}

/* ── pairs ────────────────────────────────────────────────────────────── */

/**
 * A whole number of things, which is what the three figures in the pairs head are.
 *
 * ★ STRICTER THAN `int` ON PURPOSE, AND THE STRICTNESS IS THE MISSING-DATA RULE AGAIN.
 * These are read out loud as a sentence — "6 of 192 mints have a market" — so a fractional
 * or negative one is not a number to round, it is a payload that has stopped meaning what
 * the sentence claims. A shape error here is loud at the boundary; a `-1` rendered into
 * that sentence is a confident lie about a population.
 */
function wholeCount(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new WireShapeError(path, v);
  return v;
}

/**
 * One pair.
 *
 * Assert first, pick second, exactly like `decodeLaunch` and for the same reason — a leak
 * already dropped by the pick is a leak nobody fixes at the source. This payload earns the
 * assert as much as the rail's does: `ticker` and `name` are free text somebody chose while
 * minting a coin, and a vendor's name inside a token name is free to type.
 */
export function decodePair(raw: unknown, path = '$.pair'): Pair {
  assertNoInternalVocabulary(raw, path);
  const o = pick(obj(raw, path), PAIR_FIELDS);
  return {
    pairId: str(o.pairId, `${path}.pairId`),
    ticker: str(o.ticker, `${path}.ticker`),
    name: str(o.name, `${path}.name`),
    address: str(o.address, `${path}.address`),
    venueLabel: str(o.venueLabel, `${path}.venueLabel`),
    /* Unknown stays unknown and is never backfilled. The fallback fires only when the
       server sent no reason at all, and "we have not learned it" is the only thing that can
       honestly be said on such a server's behalf. */
    mintedAt: instantAt(o.mintedAt, `${path}.mintedAt`, 'not_read_yet'),
    mintedAtBoundS: boundSeconds(o.mintedAtBoundS),
    /* ★ `unreadable` AND NOT `not_read_yet`. A row is on this screen BECAUSE a reading
       exists for it, so "we have not read it" is the one thing that cannot be true here —
       an absent instant means the one we were sent did not make sense, and the screen must
       not offer the reassuring reason for the alarming state. */
    readAt: instantAt(o.readAt, `${path}.readAt`, 'unreadable'),
    priceUsd: measured(o.priceUsd, `${path}.priceUsd`, 'no_market'),
    marketCapUsd: measured(o.marketCapUsd, `${path}.marketCapUsd`, 'no_market'),
    marketCapBasis: decodeBasis(o.marketCapBasis),
    /* `not_reported` is the right fallback for liquidity specifically: a bonding curve has
       no two-sided reserve to report, which is the common case here and is a different fact
       from having no market at all. */
    liquidityUsd: measured(o.liquidityUsd, `${path}.liquidityUsd`, 'not_reported'),
  };
}

/**
 * Whether the rows of this frame may be listed, and the counts when they may.
 *
 * ★ AN UNKNOWN TAG IS A SHAPE ERROR AND NOT A QUIET 'shown'. Defaulting either way is a
 * decision about whether to put unverified rows under a heading that says a venue priced
 * them, and that decision is not this function's to make on a server's behalf. The caller
 * already has an error state that says the screen could not be read, which is true.
 */
function decodePairListing(raw: unknown, path: string): PairListing {
  const o = obj(raw, path);
  const listing = str(o['listing'], `${path}.listing`);
  switch (listing) {
    case 'withheld':
      /* No counts read, not even to keep them around. A count over a population that may
         hold fictions is precisely the number this branch exists to refuse to print. */
      return { listing: 'withheld' };
    case 'shown':
      return {
        listing: 'shown',
        mintsInWindow: wholeCount(o['mintsInWindow'], `${path}.mintsInWindow`),
        withMarket: wholeCount(o['withMarket'], `${path}.withMarket`),
        withoutMarket: wholeCount(o['withoutMarket'], `${path}.withoutMarket`),
      };
    default:
      throw new WireShapeError(`${path}.listing`, listing);
  }
}

function decodePairHead(raw: unknown, path: string): PairHead {
  const o = pick(obj(raw, path), PAIR_HEAD_FIELDS);
  return {
    windowMs: int(o.windowMs, `${path}.windowMs`),
    /* Absent means nothing has ever been heard on this feed. `not_read_yet` is the honest
       reason for that and it is a different sentence from "the feed reports no mints" —
       `formatAge` renders the pending glyph with its reason, so the screen distinguishes
       "never watched" from "watched, long ago" with no new formatter. */
    lastMintHeardAt: instantAt(o.lastMintHeardAt, `${path}.lastMintHeardAt`, 'not_read_yet'),
    rows: decodePairListing(o.rows, `${path}.rows`),
  };
}

/**
 * One frame of the pairs screen.
 *
 * ★ THE ROWS ARE NOT READ AT ALL ON THE WITHHELD BRANCH. Not filtered, not emptied
 * afterwards — never decoded. The projector already commits an empty array under that tag
 * and writes no rows, so this is the third of three independent layers saying the same
 * thing, and it is the one that holds if a server ever sends both. Nothing downstream can
 * reach a row that was not supposed to be listed, because nothing downstream is handed one.
 *
 * Every row that IS decoded is decoded, and one unreadable row throws the whole frame
 * rather than being skipped — the same call `decodeBoardTick` and `decodeLaunchFeed` make.
 * A list silently one row short is wrong in a way nobody can see, and the caller already
 * has an error state that says so out loud.
 */
export function decodePairFeed(raw: unknown, path = '$'): PairFeed {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  const head = decodePairHead(o['head'], `${path}.head`);
  return {
    tick: int(o['tick'], `${path}.tick`),
    head,
    pairs:
      head.rows.listing === 'withheld'
        ? []
        : arr(o['pairs'], `${path}.pairs`).map((p, i) => decodePair(p, `${path}.pairs[${i}]`)),
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
    coins: decodeCoinLink(o.coins, `${path}.coins`),
    evidence: arr(o.evidence, `${path}.evidence`).map((e, i) =>
      decodeEvidence(e, `${path}.evidence[${i}]`),
    ),
    discussion: arr(o.discussion, `${path}.discussion`).map((d, i) =>
      decodeDiscussionPost(d, `${path}.discussion[${i}]`),
    ),
  };
}

function decodeCost(raw: unknown, path: string): TradeCost {
  const o = obj(raw, path);
  const code = str(o['code'], `${path}.code`);
  switch (code) {
    case 'network':
    case 'priority':
    case 'rent':
    case 'venue':
    case 'price-impact':
    case 'aggregator':
    case 'platform':
      return {
        code,
        label: str(o['label'], `${path}.label`),
        amountUsd: measured(o['amountUsd'], `${path}.amountUsd`, 'unreadable'),
        bps: measured(o['bps'], `${path}.bps`, 'unreadable'),
        refundable: bool(o['refundable'], `${path}.refundable`),
      };
    default:
      throw new WireShapeError(`${path}.code`, code);
  }
}

export function decodeTradeQuote(raw: unknown, path = '$.quote'): TradeQuote {
  assertNoInternalVocabulary(raw, path);
  const o = obj(raw, path);
  const expiry = str(o['expiryReason'], `${path}.expiryReason`);
  if (expiry !== 'blockhash' && expiry !== 'ttl' && expiry !== 'none') {
    throw new WireShapeError(`${path}.expiryReason`, expiry);
  }
  return {
    quoteId: str(o['quoteId'], `${path}.quoteId`),
    coin: decodeCoin(o['coin'], `${path}.coin`),
    side: 'buy',
    inAmountRaw: str(o['inAmountRaw'], `${path}.inAmountRaw`),
    outExpectedRaw: str(o['outExpectedRaw'], `${path}.outExpectedRaw`),
    outMinimumRaw: str(o['outMinimumRaw'], `${path}.outMinimumRaw`),
    inDisplay: str(o['inDisplay'], `${path}.inDisplay`),
    outExpectedDisplay: str(o['outExpectedDisplay'], `${path}.outExpectedDisplay`),
    slippageBps: int(o['slippageBps'], `${path}.slippageBps`),
    costs: arr(o['costs'], `${path}.costs`).map((c, i) => decodeCost(c, `${path}.costs[${i}]`)),
    allInBps: measured(o['allInBps'], `${path}.allInBps`, 'unreadable'),
    priceImpactBps: measured(o['priceImpactBps'], `${path}.priceImpactBps`, 'unreadable'),
    expiresAt: instantAt(o['expiresAt'], `${path}.expiresAt`, 'unreadable'),
    expiryReason: expiry,
    route: arr(o['route'], `${path}.route`).map((r, i) => ({
      label: str(obj(r, `${path}.route[${i}]`)['label'], `${path}.route[${i}].label`),
    })),
  };
}
