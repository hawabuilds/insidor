/**
 * THE POST-TO-COIN MATCHING SET: feed-like posts with the right coin, or with no right coin,
 * built from the gold set — and the frozen evidence the matching eval replays.
 *
 * The gold set is coin → origin post. Matching on the For You card goes the other way: a post,
 * and the coins its name search found. So each case is a POST, of three kinds:
 *
 *   origin       a founders' origin post. The right answer is the gold coin.
 *   afterLaunch  a post the founders found went viral AFTER its coin. That coin can never be
 *                its coin, and no other is known to be: any link is counted wrong.
 *   unrelated    a post that named a coin the founders found NO viral origin for, made in the
 *                two days before that coin launched, with For You's view count. The coin
 *                did not come from it: any link is counted wrong. These are the dangerous ones
 *                — right name, right timing, and still not the coin's post.
 *
 * ★ THE SUBJECT'S NAME IS THE COIN'S OWN (name and ticker), not a judge's answer: the judge
 * has read only a few of these posts. That is the best case for finding the right coin and
 * the worst case for wrong links on `unrelated` posts, which is the side the 2% bar is on.
 *
 * The evidence (`match-evidence.json`, written by tools/gold-match-fetch.ts) is frozen: each
 * name's search results, each coin's metadata links and launch, and each post-picture against
 * coin-picture comparison. The eval itself never touches a network.
 *
 * What breaks if changed carelessly: the split. `unrelated` cases exist only for the tuning
 * half (the search back for posts was only run there); `origin` cases come from both, and the
 * report keeps the held-out half's numbers apart.
 */

import { existsSync, readFileSync } from 'node:fs';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { loadEvidence, type CoinEvidence } from './coin-evidence.ts';
import { goldCoins, type GoldCoin, type GoldSplit } from './coin-origins.ts';

export type MatchCaseKind = 'origin' | 'afterLaunch' | 'unrelated';

export interface MatchCase {
  /** `<coin id>/<post id>`. */
  readonly id: string;
  readonly kind: MatchCaseKind;
  readonly coinId: string;
  readonly split: GoldSplit;
  readonly platform: 'x' | 'tiktok' | 'instagram';
  readonly postId: string;
  readonly postUrl: string;
  readonly postedAt: number | null;
  /** The post's picture when we hold it; the fetch tool may find one for posts we never read. */
  readonly imageUri: string | null;
  /** The subject's names: the coin's name and ticker (see the header). */
  readonly names: readonly string[];
  /** The term the name search ran with — the coin's name, as the lookup searches the judge's. */
  readonly term: string;
  /** The right coin's address; null when no coin is right. */
  readonly right: string | null;
  /** The gold coin of the case, which the search may or may not have found. */
  readonly goldMint: string;
}

/* An X id carries its own time (snowflake: milliseconds since the source's epoch, above bit 22). */
const X_EPOCH_MS = 1_288_834_974_657;
const X_TIME_SHIFT = 22n;
/* A TikTok video id carries its creation second above bit 32. */
const TIKTOK_TIME_SHIFT = 32n;
const MS_PER_SECOND = 1_000;

export function timeFromId(platform: MatchCase['platform'], id: string): number | null {
  if (!/^\d{15,20}$/.test(id)) return null;
  if (platform === 'x') return Number(BigInt(id) >> X_TIME_SHIFT) + X_EPOCH_MS;
  if (platform === 'tiktok') return Number(BigInt(id) >> TIKTOK_TIME_SHIFT) * MS_PER_SECOND;
  return null;
}

/** An unrelated post must have at least For You's bar of views, and fall in the timing window. */
const FEED_VIEWS = DEFAULT_POLICY.rising.fypMinReach;
const WINDOW_MS = DEFAULT_POLICY.universe.matchWindowMs;

const namesOf = (c: GoldCoin): string[] => [...new Set([c.name, c.ticker].filter((n) => n.trim() !== ''))];

export function matchCases(coins: readonly GoldCoin[] = goldCoins(), evidence: ReadonlyMap<string, CoinEvidence> = loadEvidence()): readonly MatchCase[] {
  const out: MatchCase[] = [];
  for (const c of coins) {
    const ev = evidence.get(c.id);
    const base = { coinId: c.id, split: c.split, names: namesOf(c), term: c.name.trim() || c.ticker, goldMint: c.mint };
    if (c.origin.kind === 'post' || c.origin.kind === 'afterLaunch') {
      const o = c.origin;
      const read = ev?.origin?.post ?? null;
      out.push({
        ...base,
        id: `${c.id}/${o.postId}`,
        kind: o.kind === 'post' ? 'origin' : 'afterLaunch',
        platform: o.platform,
        postId: o.postId,
        postUrl: o.url,
        postedAt: read?.postedAt ?? timeFromId(o.platform, o.postId),
        imageUri: read?.imageUri ?? null,
        right: o.kind === 'post' ? c.mint : null,
      });
      continue;
    }
    if (c.origin.kind !== 'none' || ev?.search === undefined) continue;
    const launch = Date.parse(c.createdAt);
    for (const p of ev.search.results) {
      if (p.postedAt === null || p.postedAt > launch || p.postedAt < launch - WINDOW_MS || (p.reach ?? 0) < FEED_VIEWS) continue;
      out.push({ ...base, id: `${c.id}/${p.postId}`, kind: 'unrelated', platform: 'x', postId: p.postId, postUrl: p.url, postedAt: p.postedAt, imageUri: p.imageUri, right: null });
    }
  }
  return out;
}

/* ── the frozen evidence ────────────────────────────────────────────────── */

/** One coin a name search returned, as the source described it. */
export interface FoundCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly createdAt: number | null;
  readonly imageUrl: string | null;
}

/** What a coin's metadata document said, read through our gateway; absent when unread. */
export interface CoinMeta {
  readonly links: readonly string[];
  readonly imageUri: string | null;
}

export interface MatchEvidence {
  /** Each term's search results, both sources merged; absent until searched. */
  readonly searches: Record<string, readonly FoundCoin[]>;
  /** Each coin's first transaction on the chain, by address; null when the chain did not say.
      A source's market time is a pool's, which for a coin that left its curve is its bonding,
      not its launch — so the chain's time is used whenever it is held. */
  readonly launched: Record<string, number | null>;
  /** Each coin's metadata, by address; null when it could not be read. */
  readonly meta: Record<string, CoinMeta | null>;
  /** A picture found for a post we never read (a TikTok cover), by post id. */
  readonly postImages: Record<string, string | null>;
  /** Post picture against coin picture, by `<post id>|<address>`; absent when not compared. */
  readonly similarity: Record<string, number>;
  /** The judge's same-subject answer for a borderline pair, by `<post id>|<address>`. */
  readonly sameSubject: Record<string, 'yes' | 'no' | 'unsure'>;
}

export const MATCH_EVIDENCE_FILE = new URL('./match-evidence.json', import.meta.url);

export function loadMatchEvidence(): MatchEvidence {
  const empty: MatchEvidence = { searches: {}, launched: {}, meta: {}, postImages: {}, similarity: {}, sameSubject: {} };
  if (!existsSync(MATCH_EVIDENCE_FILE)) return empty;
  return { ...empty, ...(JSON.parse(readFileSync(MATCH_EVIDENCE_FILE, 'utf8')) as Partial<MatchEvidence>) };
}

export const pairKey = (postId: string, address: string): string => `${postId}|${address}`;
