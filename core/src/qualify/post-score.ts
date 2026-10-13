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
 * ★ THE PICTURE BOOST. An UNSURE "no" (`rising.boostMaxNoConfidence`) passes when the post's
 * picture is close to a coined post's (`rising.boostMinSimilarity`). A firm "no" never does.
 *
 * ★ AND THE NAME TEST. A "yes" must also name its subject in at most `rising.maxNameWords`
 * words, the prompt's own rule ("a short name that could become a ticker"). The judge broke it
 * on live posts — a political headline passed as "Kacey Musgraves dog shot response" — and a
 * rule the model can skip is held here, where it cannot.
 */

import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

export type PostScore = 'passes' | 'below' | 'waiting';

/** Words in a proposed name: runs of letters or digits. "J-HOPE" is two, "CHILLGUY" one. */
const wordsIn = (name: string): number => name.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '').length;

export function postScore(
  judgement: Pick<Judgement, 'coinable' | 'confidence' | 'lookedAt' | 'proposedName'> | null,
  p: Policy,
  /** The post's picture against pictures of coined posts, at its closest; null when not compared. */
  pictureSimilarity: number | null = null,
): PostScore {
  const why = postScoreReason(judgement, p, pictureSimilarity);
  return why === 'passes' ? 'passes' : why === 'not_scored' ? 'waiting' : 'below';
}

/** Why a post is not on the feed, or 'passes': the same checks as `postScore`, named. */
export type PostScoreReason = 'passes' | 'not_scored' | 'not_memeable' | 'judge_unsure' | 'name_test';

export function postScoreReason(
  judgement: Pick<Judgement, 'coinable' | 'confidence' | 'lookedAt' | 'proposedName'> | null,
  p: Policy,
  pictureSimilarity: number | null = null,
): PostScoreReason {
  if (judgement === null) return 'not_scored';
  if (!judgement.coinable) {
    /* The picture boost: an unsure "no" on a post whose picture looks like a coined post's. */
    const unsure = judgement.confidence <= p.rising.boostMaxNoConfidence;
    return unsure && pictureSimilarity !== null && pictureSimilarity >= p.rising.boostMinSimilarity ? 'passes' : 'not_memeable';
  }
  const words = wordsIn(judgement.proposedName ?? '');
  if (words === 0 || words > p.rising.maxNameWords) return 'name_test';
  return judgement.confidence >= p.qualify.minJudgeConfidence[judgement.lookedAt] ? 'passes' : 'judge_unsure';
}
