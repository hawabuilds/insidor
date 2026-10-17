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
 * ★ AND THE CRYPTO SIGNAL (the owner's pick, 2026-10-13): `passesWithSignal`. A post also passes
 * when OTHER accounts answer it with a cashtag, a contract address or "CA" (read early, before a
 * coin), provided its kind is not held — people coining it is the thing we are trying to see, and
 * the judge misses news it calls generic. A shill — the post's own text or its author's own
 * replies carrying a ticker or an address — is held as an ad and never passes, by either route:
 * an account advertising its own coin is not other people rallying around something.
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

/**
 * ★ THE APPLIED BLOCK'S OWN CUTOFF (the owner, 2026-10-16: "before refusing a new version, tune
 * its yes/no cutoff, aiming for less junk"). A re-tune may apply a learned block together with a
 * stricter confidence cutoff; the policy it is held to is this one: each evidence's bar raised to
 * the cutoff, never lowered below the policy's own. null (no cutoff applied) is the policy as is.
 * The picture boost's margin then hangs off the raised bar, as it hangs off the policy bar.
 */
export function withJudgeCutoff<P extends Policy>(p: P, cutoff: number | null): P {
  if (cutoff === null) return p;
  const bars = p.qualify.minJudgeConfidence;
  const raised = Object.fromEntries(Object.entries(bars).map(([k, v]) => [k, Math.max(v, cutoff)])) as typeof bars;
  return { ...p, qualify: { ...p.qualify, minJudgeConfidence: raised } };
}

/** The applied block's cutoff, and the model it was chosen on (the judge id up to its prompt hash); null: not recorded. */
export interface BlockCutoff {
  readonly cutoff: number | null;
  readonly chosenOn: string | null;
}

/** Which open model gave one stored answer: its model key, and its place (Policy.judge.cutoffs), null for any other judge. */
export interface AnswerSide {
  readonly model: string | null;
  readonly place: 'primary' | 'fallback' | null;
}

/**
 * ★ THE CUTOFF ONE ANSWER IS HELD TO, by the model that gave it (Policy.judge.cutoffs). The newest
 * measurement of that model wins: an answer from the model the block's cutoff was chosen on is held
 * to the block's; else an open model's to its place's number; else (the main judge, a rule, a copy,
 * an open model with no number) to the block's. Read per answer, so failover answers from both
 * models keep their own bars on one feed.
 */
export function answerCutoff(p: Policy, block: BlockCutoff, side: AnswerSide): number | null {
  if (block.chosenOn !== null && side.model === block.chosenOn) return block.cutoff;
  if (side.place !== null) return p.judge.cutoffs[side.place] ?? block.cutoff;
  return block.cutoff;
}

/**
 * The policy each answer is held to, one per distinct cutoff, built once: the projector asks it for
 * every post of every frame. `main` is the block's (owner calls and rules carry no judge id).
 */
export function answerPolicies<P extends Policy>(base: P, block: BlockCutoff): { readonly main: P; readonly of: (side: AnswerSide) => P } {
  const built = new Map<number | null, P>();
  const at = (cutoff: number | null): P => {
    const known = built.get(cutoff);
    if (known !== undefined) return known;
    const made = withJudgeCutoff(base, cutoff);
    built.set(cutoff, made);
    return made;
  };
  return { main: at(block.cutoff), of: (side) => at(answerCutoff(base, block, side)) };
}

/** Other accounts' crypto talk under a post, as the projector reads it: null when not read. */
export interface CryptoSignal {
  /** Another account replied or quoted with a cashtag, a contract address or "CA", early. */
  readonly others: boolean;
  /** The post's own text, or its author's own replies, carry a ticker or an address. */
  readonly shill: boolean;
}

/** How a post passes: the judge alone, the judge with the signal beside it, or the signal alone. */
export type PassRoute = 'judge' | 'judge+signal' | 'signal';

/**
 * The For You pass rule: the judge passes it (postScore, held kinds and all), OR its kind is not
 * held and other accounts' crypto signal is present. A shill never passes. null: it does not pass
 * (or, with no judgement and no signal, has not been decided — the caller's `postScore` says which).
 */
export function passesWithSignal(
  judgement: Answer | null,
  p: Policy,
  pictureSimilarity: number | null,
  kindLabel: string | null,
  signal: CryptoSignal | null,
): PassRoute | null {
  if (signal?.shill === true) return null;
  const others = signal?.others === true;
  if (postScoreReason(judgement, p, pictureSimilarity, kindLabel) === 'passes') return others ? 'judge+signal' : 'judge';
  return others && heldKind(kindLabel, p.judge.heldKinds) === null ? 'signal' : null;
}
