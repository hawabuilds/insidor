/**
 * THE ORIGIN EVAL: our creator-link check, coin-to-post matching (with the picture matching)
 * and earliest-post search, run on the gold set's tuning coins and scored against what the
 * founders found.
 *
 * Offline: it reads coin-evidence.json (fetched by tools/gold-fetch.ts) and calls core's rules
 * (core/src/origin/check.ts) — the same rules the coin universe will run. Nothing here decides
 * an origin itself; it only builds the facts core is handed and counts what came back.
 *
 * ★ A COIN WHOSE EVIDENCE IS INCOMPLETE IS REPORTED AS SUCH, NEVER SCORED AS "FOUND NOTHING".
 * A stage not yet fetched is our gap, and counting it as a miss would make the pipeline look
 * worse than it is in a way nobody could see.
 *
 * What breaks if changed carelessly: the scores are over `tuning()` only. Pointing this at
 * `holdout()` while the bars are still being chosen spends the one honest measurement we have.
 */

import { isOrigin } from '@insidor/contracts/origin.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts';
import {
  checkCreatorLink,
  decideOrigin,
  earliestByReproduction,
  matchCandidates,
  type Candidate,
  type CoinFacts,
  type CreatorLink,
  type OriginDecision,
  type PostFacts,
} from '@insidor/core';

import type { CoinEvidence, PostRead } from './coin-evidence.ts';
import type { GoldCoin } from './coin-origins.ts';

export type Outcome =
  | 'right'          // named the founders' origin post
  | 'wrongPost'      // named a different post as the origin
  | 'missed'         // named no origin where there was one
  | 'calledViral'    // named an origin where the founders found none, or only a post after launch
  | 'correctNone';   // named no origin, and there was none to name

export interface CoinResult {
  readonly coin: GoldCoin;
  readonly decision: OriginDecision;
  readonly outcome: Outcome | 'incomplete' | 'unscored';
  readonly note: string;
}

const STAGES = ['meta', 'creator', 'search', 'similarity'] as const;

function missingStages(ev: CoinEvidence | undefined): string[] {
  if (ev === undefined) return [...STAGES];
  return STAGES.filter((s) => ev[s] === undefined);
}

function postFacts(p: PostRead, judged: CoinEvidence['judged']): PostFacts {
  return { postId: p.postId, postedAt: p.postedAt as Millis | null, text: p.text, authorFollowers: p.authorFollowers, reach: p.reach, judged: judged?.[p.postId] ?? null };
}

/** A picture's similarity to the coin's, as the tier core reads; a borderline one needs the judge's yes. */
export function pictureTier(similarity: number | undefined, sameSubject: 'yes' | 'no' | 'unsure' | undefined, p: Policy): Candidate['picture'] {
  if (similarity === undefined) return null;
  const bars = p.group.image;
  if (similarity >= bars.nearIdentical) return 'near';
  if (similarity >= bars.likely) return 'likely';
  if (similarity >= bars.borderline && sameSubject === 'yes') return 'confirmed';
  return null;
}

export function evaluateCoin(coin: GoldCoin, ev: CoinEvidence | undefined, p: Policy): CoinResult {
  const missing = missingStages(ev);
  const facts: CoinFacts = { address: coin.mint, ticker: ev?.meta?.ticker ?? coin.ticker, name: ev?.meta?.name ?? coin.name, launchedAt: Date.parse(coin.createdAt) as Millis };

  const creator: CreatorLink =
    ev?.creator === undefined || ev.creator.kind === 'none' ? { kind: 'none' }
    : ev.creator.kind === 'account' ? { kind: 'account' }
    : { kind: 'post', post: ev.creator.post === null ? null : postFacts(ev.creator.post, ev.judged) };
  const checked = checkCreatorLink(creator, facts, p);

  const results = ev?.search?.results ?? [];
  const candidates: Candidate[] = results.map((r) => ({
    postId: r.postId,
    postedAt: r.postedAt as Millis | null,
    text: r.text,
    picture: pictureTier(ev?.similarity?.[r.postId], ev?.sameSubject?.[r.postId], p),
  }));
  let decision = decideOrigin(checked, matchCandidates(candidates, facts, p));
  /* Earliest-post search: a matched post's meme started where its quotes lead. */
  if (decision.status === 'matched_by_insidor' && decision.postId !== null) {
    const byId = new Map(results.map((r) => [r.postId, { postedAt: r.postedAt as Millis | null, reproduces: r.quotes }]));
    decision = { ...decision, postId: earliestByReproduction(decision.postId, byId) };
  }

  if (missing.length > 0) return { coin, decision, outcome: 'incomplete', note: `not yet fetched: ${missing.join(', ')}` };

  const named = isOrigin(decision.status) ? decision.postId : null;
  const gold = coin.origin;
  if (gold.kind === 'account') return { coin, decision, outcome: 'unscored', note: 'founders know only the account' };
  if (gold.kind === 'post') {
    if (named === null) return { coin, decision, outcome: 'missed', note: `${decision.status}; the origin is ${gold.url}` };
    return named === gold.postId
      ? { coin, decision, outcome: 'right', note: decision.status }
      : { coin, decision, outcome: 'wrongPost', note: `${decision.status} named post ${named}; the origin is ${gold.url}` };
  }
  if (named !== null) {
    return { coin, decision, outcome: 'calledViral', note: `${decision.status} named post ${named}; ${gold.kind === 'afterLaunch' ? `the founders' post came after launch (${gold.url})` : 'the founders found no viral origin'}` };
  }
  return { coin, decision, outcome: 'correctNone', note: decision.status };
}

export interface PictureBands {
  readonly near: number;
  readonly likely: number;
  readonly borderline: number;
  readonly below: number;
  readonly unknown: number;
}

/** How the coin's picture compares with the founders' origin post, and with search results that are not it. */
export function pictureBands(coins: readonly GoldCoin[], evidence: ReadonlyMap<string, CoinEvidence>, p: Policy) {
  const bars = p.group.image;
  const band = (s: number | undefined, into: Record<keyof PictureBands, number>) => {
    if (s === undefined) into.unknown += 1;
    else if (s >= bars.nearIdentical) into.near += 1;
    else if (s >= bars.likely) into.likely += 1;
    else if (s >= bars.borderline) into.borderline += 1;
    else into.below += 1;
  };
  const origins = { near: 0, likely: 0, borderline: 0, below: 0, unknown: 0 };
  const others = { near: 0, likely: 0, borderline: 0, below: 0, unknown: 0 };
  const originScores: number[] = [];
  for (const c of coins) {
    const ev = evidence.get(c.id);
    if (ev?.similarity === undefined) continue;
    if (c.origin.kind === 'post' && c.origin.platform === 'x') {
      const s = ev.similarity[c.origin.postId];
      band(s, origins);
      if (s !== undefined) originScores.push(s);
    }
    const goldId = c.origin.kind === 'post' || c.origin.kind === 'afterLaunch' ? c.origin.postId : null;
    for (const r of ev.search?.results ?? []) if (r.postId !== goldId && r.imageUri !== null) band(ev.similarity[r.postId], others);
  }
  return { origins, others, originScores: originScores.sort((a, b) => a - b) };
}
