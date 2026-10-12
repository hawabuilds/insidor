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
 */

import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

export type PostScore = 'passes' | 'below' | 'waiting';

export function postScore(judgement: Judgement | null, p: Policy): PostScore {
  if (judgement === null) return 'waiting';
  if (!judgement.coinable) return 'below';
  return judgement.confidence >= p.qualify.minJudgeConfidence[judgement.lookedAt] ? 'passes' : 'below';
}
