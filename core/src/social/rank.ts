/**
 * RANKS AND REP — Trador's ladder (config/ranks.ts, lib/ranks.ts, server/ranks.ts), ported with
 * its numbers in policy: Intern, Analyst, Quant, Wolf, GOAT.
 *
 * Rep is earned only from other people: a holder of the coin likes a comment, and that like is
 * worth `votePoints`, multiplied by the VOTER's rank, by the proof boost if the comment carries
 * proof, and by the early boost if its author bought early. A voter earns others rep on at most
 * `dailyVoteCap` likes a UTC day. Seasons are calendar months from `seasonEpochMs`; rep starts
 * again each season and nothing decays inside one. The calendar itself (which month it is) is
 * the service's to read.
 *
 * ★ GOAT IS A STANDING, NOT A NUMBER. It is Wolf's rep AND the top `goatPercentile` of the
 * season's ranked people — at least one person — so it can be lost when others overtake. The
 * ladder below GOAT is reached by rep alone.
 *
 * Pure: every function takes the policy and the facts; the service supplies the clock and the
 * database. What breaks if changed carelessly: the order of RANKS. `rankedUp` compares positions
 * in it, and a reordering would announce a fall as a rise.
 */

import type { SocialPolicy } from '@insidor/contracts/policy.ts';

export const RANKS = ['intern', 'analyst', 'quant', 'wolf', 'goat'] as const;
export type RankId = (typeof RANKS)[number];

export interface Standing {
  readonly rep: number;
  /** This person's place among the season's ranked people, 0 for a GOAT, (i+1)/n otherwise; null when unranked. */
  readonly percentile: number | null;
}

export function rankFor(standing: Standing, P: SocialPolicy): RankId {
  if (standing.rep >= P.rankRep.goat && standing.percentile !== null && standing.percentile <= P.goatPercentile) return 'goat';
  let held: RankId = 'intern';
  for (const rank of RANKS) {
    if (rank !== 'goat' && standing.rep >= P.rankRep[rank]) held = rank;
  }
  return held;
}

/** The next rung and the rep still to earn; never GOAT, which is a standing, not a target. */
export function nextRank(rep: number, P: SocialPolicy): { readonly rank: RankId; readonly repToGo: number } | null {
  for (const rank of RANKS) {
    if (rank !== 'goat' && rank !== 'intern' && rep < P.rankRep[rank]) return { rank, repToGo: Math.ceil(P.rankRep[rank] - rep) };
  }
  return null;
}

/** What one like is worth, rounded to the cent of a point as Trador stores it. */
export function votePoints(facts: { readonly voterRank: RankId; readonly proof: boolean; readonly early: boolean }, P: SocialPolicy): number {
  const points = P.votePoints * P.rankMultiplier[facts.voterRank] * (facts.proof ? P.proofBoost : 1) * (facts.early ? P.earlyBoost : 1);
  return Number(points.toFixed(2));
}

/** Whether this voter's next like still earns rep today. */
export const earnsRep = (votesEarnedToday: number, P: SocialPolicy): boolean => votesEarnedToday < P.dailyVoteCap;

/** The author bought early: their first buy was under `earlyBuyMultiple` times the coin's earliest price. Unknown is not early. */
export function boughtEarly(firstBuyPrice: number | null, earliestPrice: number | null, P: SocialPolicy): boolean {
  if (firstBuyPrice === null || earliestPrice === null || !(earliestPrice > 0) || !(firstBuyPrice > 0)) return false;
  return firstBuyPrice < earliestPrice * P.earlyBuyMultiple;
}

/** How many GOATs a season of `ranked` people has: the top percentile, at least one. */
export function goatCount(ranked: number, P: SocialPolicy): number {
  if (ranked <= 0) return 0;
  return Math.max(1, Math.floor(ranked * P.goatPercentile));
}

/**
 * Every ranked person's standing, from the season's totals. Only rep above zero is ranked;
 * ties keep the order given (the service orders by rep, then by who got there first).
 */
export function standings(totals: readonly { readonly userId: string; readonly rep: number }[], P: SocialPolicy): Map<string, Standing> {
  const ranked = totals.filter((t) => t.rep > 0).sort((a, b) => b.rep - a.rep);
  const goats = goatCount(ranked.length, P);
  const out = new Map<string, Standing>();
  ranked.forEach((t, i) => out.set(t.userId, { rep: t.rep, percentile: i < goats ? 0 : (i + 1) / ranked.length }));
  return out;
}

/** True only when the rank moved UP the ladder. A fall never makes an event. */
export const rankedUp = (before: RankId, after: RankId): boolean => RANKS.indexOf(after) > RANKS.indexOf(before);

/**
 * The season a UTC calendar month falls in: months counted from the epoch's month, season one
 * first. The service reads the year and month from the clock; before the epoch is season one.
 */
export function seasonOf(now: { readonly year: number; readonly month: number }, epoch: { readonly year: number; readonly month: number }): number {
  return Math.max(1, (now.year - epoch.year) * MONTHS + (now.month - epoch.month) + 1);
}

const MONTHS = 12; // policy-allow: months in a year — a calendar fact, not a judgement
