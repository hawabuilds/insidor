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
import type { DiscussionPost, Evidence, Story } from './wire/story.ts';
import type { TradeCost, TradeQuote } from './wire/trade.ts';
import {
  BOARD_ROW_FIELDS,
  COIN_FIELDS,
  FORBIDDEN_KEYS,
  FORBIDDEN_SUBSTRINGS,
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
  if ('coins' in f) fields['coins'] = decodeCoinLink(f['coins'], `${path}.fields.coins`);
  return { id: str(o['id'], `${path}.id`), fields: fields as RowPatch['fields'] };
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
