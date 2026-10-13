/**
 * Whether one post, judged alone, clears the meme-score bar — the earlier build's rule for
 * which single posts reach the For You feed.
 *
 * The bar is QUALIFY's own (`qualify.minJudgeConfidence`, keyed by what the judge looked
 * at: 0.70 on text, 0.75 with a video frame), so a post and a story are held to one number.
 *
 * ★ THREE ANSWERS. A post with no judgement has not been scored, and it WAITS: it is never
 * shown as if it had passed, and never counted as a failure either — a dry run, a paused
 * budget and a judge outage all leave a post waiting, and none of them is a judgement.
 *
 * ★ A HELD KIND COMES FIRST. A post the kind question filed as an ad, sport, a tragedy and so on
 * (kinds.ts) fails before anything else is weighed: no picture and no confidence lifts it. Only a
 * label in Policy.judge.heldKinds holds — an OTHER answer, whatever yes/no it was filed with, holds nothing.
 *
 * ★ THE PICTURE BOOST lifts only a "yes" just under its bar (`rising.boostBarMargin`) whose
 * picture is close to a coined post's (`rising.boostMinSimilarity`). A "no" is never lifted:
 * the policy comment says why a "no"'s confidence cannot mark it unsure.
 *
 * ★ AND THE NAME TEST. A "yes" must also name its subject in at most `rising.maxNameWords`
 * words, the prompt's own rule ("a short name that could become a ticker"). The judge broke it
 * on live posts — a political headline passed as "Kacey Musgraves dog shot response" — and a
 * rule the model can skip is held here, where it cannot.
 *
 * What breaks if changed carelessly: the runner asks the kind question of exactly the posts
 * `couldPassWithBoost` says yes to. A boost rule widened here without that is a boosted post that
 * never met the kind question — how a zoo-mauling news post reached For You on 2026-10-13.
 */

import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { heldKind } from './kinds.ts';

export type PostScore = 'passes' | 'below' | 'waiting';

type Answer = Pick<Judgement, 'coinable' | 'confidence' | 'lookedAt' | 'proposedName'>;

/** Words in a proposed name: runs of letters or digits. "J-HOPE" is two, "CHILLGUY" one. */
const wordsIn = (name: string): number => name.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '').length;

/** The closest a picture can be to another: cosine similarity tops out at one. */
const BEST_POSSIBLE_PICTURE_MATCH = 1;

export function postScore(
  judgement: Answer | null,
  p: Policy,
  /** The post's picture against pictures of coined posts, at its closest; null when not compared. */
  pictureSimilarity: number | null = null,
  /** The label the kind question filed for this post, if any; only a held kind holds. */
  kindLabel: string | null = null,
): PostScore {
  const why = postScoreReason(judgement, p, pictureSimilarity, kindLabel);
  return why === 'passes' ? 'passes' : why === 'not_scored' ? 'waiting' : 'below';
}

/** Why a post is not on the feed, or 'passes': the same checks as `postScore`, named. A held kind is `not_memeable`. */
export type PostScoreReason = 'passes' | 'not_scored' | 'not_memeable' | 'judge_unsure' | 'name_test';

export function postScoreReason(
  judgement: Answer | null,
  p: Policy,
  pictureSimilarity: number | null = null,
  kindLabel: string | null = null,
): PostScoreReason {
  if (judgement === null) return 'not_scored';
  if (heldKind(kindLabel, p.judge.heldKinds) !== null) return 'not_memeable';
  if (!judgement.coinable) return 'not_memeable';
  const words = wordsIn(judgement.proposedName ?? '');
  if (words === 0 || words > p.rising.maxNameWords) return 'name_test';
  const bar = p.qualify.minJudgeConfidence[judgement.lookedAt];
  if (judgement.confidence >= bar) return 'passes';
  /* The picture boost: a "yes" just under its bar, on a post whose picture looks like a coined post's. */
  const nearTheBar = judgement.confidence >= bar - p.rising.boostBarMargin;
  return nearTheBar && pictureSimilarity !== null && pictureSimilarity >= p.rising.boostMinSimilarity ? 'passes' : 'judge_unsure';
}

/**
 * Whether this answer could pass with the luckiest picture match there could be: a pass, or a
 * "yes" near enough the bar for the boost. Exactly the posts that must also be asked the kind
 * question, and the ones still worth a picture or a re-read.
 */
export const couldPassWithBoost = (judgement: Answer, p: Policy): boolean =>
  postScoreReason(judgement, p, BEST_POSSIBLE_PICTURE_MATCH) === 'passes';
