/**
 * THE POST-TO-COIN MATCHING EVAL: core's `matchPostCoin` on the gold matching set, scored.
 *
 * Offline: it reads match-cases.ts's cases and the frozen match-evidence.json, builds the facts
 * core is handed — exactly the facts the runner and projector hand it — and counts the answers.
 * Nothing here decides a match; it only says whether core's answer was right.
 *
 * Three rules are scored side by side, so the change is read against what it replaces:
 *
 *   today      the For You card's rule before this change: a post's own search never names a
 *              coin. Every post with coins is "unsure", so nothing is wrong and nothing is found.
 *   nameOnly   the rule this change must NOT become: one coin uses the subject's exact name,
 *              so it is the post's. Shown to say what the evidence bars are buying.
 *   oneName    core's rule over the coins ONE name's search found (the coin's name): the lookup
 *              before 2026-10-13, kept to read what searching every name bought.
 *   evidence   core's rule over every name's coins (name, ticker, the judge's name): links, then
 *              picture plus timing, then timing plus an exact name on the only coin of the name.
 *
 * Outcomes per case: `right` (named the right coin), `wrong` (named any coin that is not the
 * right one — on an `unrelated` or `afterLaunch` post, any coin), `missed` (named none where
 * one was right), `clear` (named none where none was right).
 *
 * What breaks if changed carelessly: the bars below must be the projector's
 * (services/project/src/post-match.ts) until they move into the policy. An eval run with
 * other bars than the ones that ship measures a rule nobody runs.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts';
import { matchPostCoin, postPictureVerdict, type CoinSide, type MatchBars, type PostCoinMatch } from '@insidor/core';

import { pairKey, type FoundCoin, type MatchCase, type MatchEvidence } from './match-cases.ts';

/* The projector's bars (services/project/src/post-match.ts), to be added to the policy. */
export const MATCH_BARS: MatchBars = {
  launchAllowanceMs: DEFAULT_POLICY.origin.launchAllowanceMs,
  windowMs: DEFAULT_POLICY.universe.matchWindowMs,
  minLinkIdLength: 8,
  minVariantLength: 4,
};

export type MatchOutcome = 'right' | 'wrong' | 'missed' | 'clear';
export type RuleName = 'today' | 'nameOnly' | 'oneName' | 'evidence';

export interface CaseResult {
  readonly c: MatchCase;
  /** How many coins the search found that the rule could weigh. */
  readonly coins: number;
  /** Whether the right coin was among them. */
  readonly rightFound: boolean;
  readonly outcomes: Readonly<Record<RuleName, MatchOutcome>>;
  readonly evidence: PostCoinMatch;
}

/** The picture's ids as a link would carry them: an X media key is the file's stem. */
function mediaIds(uri: string | null): string[] {
  if (uri === null) return [];
  const stem = /\/media\/([A-Za-z0-9_-]{8,})\./.exec(uri)?.[1];
  return stem === undefined ? [] : [stem];
}

/** The coins the runner's lookup would hold for this post: launched within a week before it, or after. */
export function coinsFor(c: MatchCase, ev: MatchEvidence, p: Policy = DEFAULT_POLICY, terms: readonly string[] = c.terms): readonly CoinSide[] {
  const found: readonly FoundCoin[] = [...new Map(terms.flatMap((t) => ev.searches[t] ?? []).map((f) => [f.address, f])).values()];
  const image = c.imageUri ?? ev.postImages[c.postId] ?? null;
  return found.flatMap((f): CoinSide[] => {
    const launchedAt = (ev.launched[f.address] ?? f.createdAt) as Millis | null;
    if (c.postedAt !== null && launchedAt !== null && launchedAt < c.postedAt - p.universe.lookup.withinMs) return [];
    const k = pairKey(c.postId, f.address);
    const s = image === null ? undefined : ev.similarity[k];
    const said = ev.sameSubject[k];
    const meta = ev.meta[f.address];
    return [{
      address: f.address,
      name: f.name,
      ticker: f.ticker,
      launchedAt,
      links: meta === undefined || meta === null ? null : meta.links,
      samePicture: postPictureVerdict(s ?? null, said ?? null, p.group.image),
    }];
  });
}

const outcome = (named: string | null, right: string | null): MatchOutcome =>
  named === null ? (right === null ? 'clear' : 'missed') : named === right ? 'right' : 'wrong';

export function evaluateCase(c: MatchCase, ev: MatchEvidence, bars: MatchBars = MATCH_BARS): CaseResult {
  const coins = coinsFor(c, ev);
  const post = { postedAt: c.postedAt as Millis | null, linkIds: [c.postId, ...mediaIds(c.imageUri ?? ev.postImages[c.postId] ?? null)], names: c.names };
  const result = matchPostCoin(post, coins, bars);
  const one = matchPostCoin(post, coinsFor(c, ev, DEFAULT_POLICY, [c.term]), bars);
  const exact = result.kind === 'none' ? [] : result.ranked.filter((e) => e.name === 'exact');
  const nameOnly = exact.length === 1 ? (exact[0]?.address ?? null) : null;
  return {
    c,
    coins: coins.length,
    rightFound: c.right !== null && coins.some((x) => x.address === c.right),
    evidence: result,
    outcomes: {
      today: outcome(null, c.right),
      nameOnly: outcome(nameOnly, c.right),
      oneName: outcome(one.kind === 'confident' ? one.address : null, c.right),
      evidence: outcome(result.kind === 'confident' ? result.address : null, c.right),
    },
  };
}
