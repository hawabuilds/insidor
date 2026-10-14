/**
 * THE POST-TO-COIN MATCHING EVAL: core's `matchPostCoin` on the gold matching set, scored.
 *
 * Offline: it reads match-cases.ts's cases and the frozen match-evidence.json, builds the facts
 * core is handed — exactly the facts the runner and projector hand it — and counts the answers.
 * Nothing here decides a match; it only says whether core's answer was right.
 *
 * Each post's candidates are what the live system would weigh: every name's search results
 * (launched within a week before the post, or after it), the coins whose address was posted in
 * the replies under it, and the coins whose picture's hash is within `widenHashDistance` of the
 * post's picture (searched over every coin the evidence holds, the gold coins included).
 *
 * Outcomes per case:
 *   provenRight / provenWrong   a coin was PROVEN (links, same picture and timing, or the poster
 *                               posted its address) — the only answer that carries a Buy
 *   likelyRight / likelyWrong   nothing proven; the score's top coin reached the likely share
 *   missed                      nothing named where a coin was right
 *   clear                       nothing named where none was right
 * On an `unrelated` or `afterLaunch` post any named coin is wrong. "Wrong links" are proven
 * wrongs only: a likely coin is shown first in the list and never with a Buy.
 *
 * What breaks if changed carelessly: the bars come from the policy (Policy.postCoin and the
 * group's picture bars), the same object the projector reads; an eval with its own bars would
 * measure a rule nobody runs. Weights may be passed in, so the fit can be scored before it ships.
 */

import { DEFAULT_POLICY, type Policy, type PostCoinWeights } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts';
import { isShillText, matchPostCoin, nameMatch, postCoinSignals, postPictureVerdict, type CoinSide, type MatchBars, type PostCoinMatch } from '@insidor/core';

import { pairKey, type FoundCoin, type MatchCase, type MatchEvidence } from './match-cases.ts';
import type { Choice } from './match-fit.ts';

/** The rule's bars from a policy: the projector builds its own the same way (services/project post-match.ts). */
export function matchBarsOf(p: Policy = DEFAULT_POLICY, weights: PostCoinWeights = p.postCoin.weights): MatchBars {
  const pc = p.postCoin;
  return {
    launchAllowanceMs: p.origin.launchAllowanceMs,
    windowMs: p.universe.matchWindowMs,
    minLinkIdLength: pc.minLinkIdLength,
    minVariantLength: pc.minVariantLength,
    sameHashDistance: pc.sameHashDistance,
    pictureFloor: pc.pictureFloor,
    timingHalfLifeMin: pc.timingHalfLifeMin,
    descriptionMinWord: pc.descriptionMinWord,
    likelyMinShare: pc.likelyMinShare,
    weights,
    closePicture: p.group.image.likely,
  };
}

export const MATCH_BARS: MatchBars = matchBarsOf();

export type MatchOutcome = 'provenRight' | 'provenWrong' | 'likelyRight' | 'likelyWrong' | 'missed' | 'clear';

/** Why an origin post was missed or not proven, for the owner's diagnosis. */
export type MissReason = 'notFound' | 'rankedFirst' | 'rankedLower' | 'nameNoMatch';

export interface CaseResult {
  readonly c: MatchCase;
  /** How many candidates the rule weighed. */
  readonly coins: number;
  /** Whether the right coin was among them, and how it got there. */
  readonly rightFound: boolean;
  readonly rightBy: readonly FoundBy[];
  readonly outcome: MatchOutcome;
  readonly evidence: PostCoinMatch;
  /** For an origin post not proven right: why. Null otherwise. */
  readonly reason: MissReason | null;
  /** The fit's view of this case: unproven posts only (a proof is not the score's choice). */
  readonly choice: Choice | null;
  /**
   * The judge side's shill rule holds this post as an ad, so no feed shows it or its coin: its
   * own words carry a cashtag, an address or a CA, or its own account posted an address under it.
   */
  readonly shillHeld: boolean;
}

/** The picture's ids as a link would carry them: an X media key is the file's stem. */
function mediaIds(uri: string | null): string[] {
  if (uri === null) return [];
  const stem = /\/media\/([A-Za-z0-9_-]{8,})\./.exec(uri)?.[1];
  return stem === undefined ? [] : [stem];
}

/** Bits that differ between two 16-hex-digit hashes. */
function bitsApart(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x > 0n; x >>= 1n) n += Number(x & 1n);
  return n;
}

const isLink = (s: string) => /^(?:https?:\/\/|www\.|t\.me\/)/i.test(s.trim());

let universeCache: { ev: MatchEvidence; coins: readonly FoundCoin[] } | null = null;
function universeOf(ev: MatchEvidence): readonly FoundCoin[] {
  if (universeCache?.ev === ev) return universeCache.coins;
  const coins = [...new Map([...Object.values(ev.searches).flat(), ...Object.values(ev.replyCoins), ...Object.values(ev.universeCoins)].map((f) => [f.address, f])).values()];
  universeCache = { ev, coins };
  return coins;
}

const launchOf = (ev: MatchEvidence, f: FoundCoin): number | null => ev.launched[f.address] ?? f.createdAt;
const coinPicture = (ev: MatchEvidence, f: FoundCoin): string | null => ev.meta[f.address]?.imageUri ?? f.imageUrl;
const postPicture = (c: MatchCase, ev: MatchEvidence): string | null => c.imageUri ?? ev.postImages[c.postId] ?? null;

export type FoundBy = 'name' | 'replies' | 'picture' | 'universe';

/**
 * Every candidate and how it was found: by a name search, by an address in the replies, by its
 * picture. With `universe`, also every coin the evidence holds (the gold coins included) whose
 * name or ticker meets the subject's names, launched after the post inside the window: the live
 * projector's search of the mint stream's own copy, which a market search months later cannot
 * stand in for (a coin that died is no longer listed). That scenario is reported apart: its
 * universe holds the gold coins but not the other coins of the day that died with them.
 */
export function candidatesFor(c: MatchCase, ev: MatchEvidence, p: Policy = DEFAULT_POLICY, universe = false): ReadonlyMap<string, { readonly f: FoundCoin; readonly by: Set<FoundBy> }> {
  const out = new Map<string, { f: FoundCoin; by: Set<FoundBy> }>();
  const add = (f: FoundCoin, by: FoundBy) => {
    const e = out.get(f.address) ?? { f, by: new Set() };
    e.by.add(by);
    out.set(f.address, e);
  };
  for (const t of c.terms) for (const f of ev.searches[t] ?? []) add(f, 'name');
  for (const a of ev.replies[c.postId]?.addresses ?? []) {
    const f = ev.replyCoins[a.address] ?? universeOf(ev).find((u) => u.address === a.address);
    if (f !== undefined) add(f, 'replies');
  }
  const img = postPicture(c, ev);
  const ph = img === null ? null : (ev.hashes[img] ?? null);
  if (ph !== null && c.postedAt !== null) {
    for (const f of universeOf(ev)) {
      const at = launchOf(ev, f);
      if (at === null || at < c.postedAt - p.origin.launchAllowanceMs || at > c.postedAt + p.universe.matchWindowMs) continue;
      const u = coinPicture(ev, f);
      const h = u === null ? null : (ev.hashes[u] ?? null);
      if (h !== null && bitsApart(ph, h) <= p.postCoin.widenHashDistance) add(f, 'picture');
    }
  }
  if (universe && c.postedAt !== null) {
    for (const f of universeOf(ev)) {
      const at = launchOf(ev, f);
      if (at === null || at < c.postedAt - p.origin.launchAllowanceMs || at > c.postedAt + p.universe.matchWindowMs) continue;
      if (nameMatch(c.names, f, p.postCoin) !== 'none') add(f, 'universe');
    }
  }
  return out;
}

/** The candidates as core is handed them: launched within a week before the post, or after. */
export function coinsFor(c: MatchCase, ev: MatchEvidence, p: Policy = DEFAULT_POLICY, universe = false): readonly CoinSide[] {
  const img = postPicture(c, ev);
  const ph = img === null ? null : (ev.hashes[img] ?? null);
  const replies = ev.replies[c.postId];
  return [...candidatesFor(c, ev, p, universe).values()].flatMap(({ f }): CoinSide[] => {
    const launchedAt = launchOf(ev, f) as Millis | null;
    if (c.postedAt !== null && launchedAt !== null && launchedAt < c.postedAt - p.universe.lookup.withinMs) return [];
    const k = pairKey(c.postId, f.address);
    const s = img === null ? undefined : ev.similarity[k];
    const meta = ev.meta[f.address];
    const u = coinPicture(ev, f);
    const ch = u === null ? null : (ev.hashes[u] ?? null);
    const posted = replies?.addresses.find((a) => a.address === f.address);
    const ownText = c.text !== null && c.text.includes(f.address);
    return [{
      address: f.address,
      name: f.name,
      ticker: f.ticker,
      launchedAt,
      links: meta === undefined || meta === null ? null : meta.links,
      samePicture: postPictureVerdict(s ?? null, ev.sameSubject[k] ?? null, p.group.image),
      pictureSimilarity: s ?? null,
      hashDistance: ph === null || ch === null ? null : bitsApart(ph, ch),
      description: meta === undefined || meta === null ? null : (meta.links.filter((l) => !isLink(l)).join(' ') || null),
      addressByAuthor: replies === undefined && c.text === null ? null : (posted?.byAuthor ?? false) || ownText,
      addressByOthers: replies === undefined ? null : (posted?.byOthers ?? 0),
      tradingJump: null,
    }];
  });
}

export function evaluateCase(c: MatchCase, ev: MatchEvidence, bars: MatchBars = MATCH_BARS, p: Policy = DEFAULT_POLICY, universe = false): CaseResult {
  const coins = coinsFor(c, ev, p, universe);
  const author = c.author ?? ev.postReads[c.postId]?.author ?? null;
  const text = c.text ?? ev.postReads[c.postId]?.text ?? null;
  const post = { postedAt: c.postedAt as Millis | null, linkIds: [c.postId, ...mediaIds(postPicture(c, ev))], names: c.names, author, text };
  const result = matchPostCoin(post, coins, bars);
  const cands = candidatesFor(c, ev, p, universe);
  const rightFound = c.right !== null && coins.some((x) => x.address === c.right);
  const rightBy = c.right === null ? [] : [...(cands.get(c.right)?.by ?? [])];
  const named = result.kind === 'confident' ? result.address : result.kind === 'unsure' ? result.likely : null;
  const proven = result.kind === 'confident';
  const outcome: MatchOutcome =
    named === null ? (c.right === null ? 'clear' : 'missed') : named === c.right ? (proven ? 'provenRight' : 'likelyRight') : proven ? 'provenWrong' : 'likelyWrong';

  let reason: MissReason | null = null;
  if (c.kind === 'origin' && outcome !== 'provenRight') {
    const ranked = result.kind === 'none' ? [] : result.ranked;
    const at = ranked.findIndex((e) => e.address === c.right);
    const e = ranked[at];
    reason = !rightFound || e === undefined ? 'notFound' : e.name === 'none' ? 'nameNoMatch' : at === 0 ? 'rankedFirst' : 'rankedLower';
  }

  let choice: Choice | null = null;
  if (!proven && result.kind !== 'none') {
    const possible = result.ranked.filter((e) => !e.before);
    if (possible.length > 0) {
      const at = possible.findIndex((e) => e.address === c.right);
      choice = { options: possible.map((e) => postCoinSignals(e, bars)), right: at < 0 ? null : at };
    }
  }
  const shillHeld = (text !== null && isShillText(text, p.attention)) || (ev.replies[c.postId]?.addresses.some((a) => a.byAuthor) ?? false);
  return { c, coins: coins.length, rightFound, rightBy, outcome, evidence: result, reason, choice, shillHeld };
}
