/**
 * THE VIRAL EXCEPTION'S THREE RULES (Policy.judge.viral): which turned-down posts are asked the
 * viral-moment question, how huge and fast is huge and fast, and which answers let a post onto For
 * You.
 *
 * Its own file beside post-score.ts because it is a second way past the first question, not a
 * change to it: `postScoreReason` still answers exactly as before for every post, and the projector
 * consults these rules only for a post that rule turned down. The runner (which posts to ask) and
 * the projector (which answers pass) read the same functions, so a post is never asked under one
 * rule and passed under another.
 *
 * ★ ONLY A "NO" OR A LIFTED KIND IS ELIGIBLE. A post the post question passed and no kind held
 * needs no exception; a post held as an ad, sport, fandom or a close match to one the owner called
 * "not a meme" is never asked — `liftsKinds` (politics, showbiz) are the only holds this route can
 * lift, and only the owner can widen them.
 *
 * ★ HUGE AND FAST, FROM THE POST'S OWN TIME. A reading counts only inside `maxAgeMs` of the post,
 * at `minReach` or more, at an average of `minReachPerMinute` or more since the post. Measured
 * from when it was posted, never from when we first saw it (reach-bar.ts says why). A post with no
 * post time, or no such reading, does not clear it: an unread count is not a big one.
 *
 * ★ OR FAST WHILE IT IS FRESH (`early`, policy.v188): a reading within `early.withinMs` of the post
 * averaging `early.minReachPerMinute` or more since the post is enough to ask, however few its
 * views. The answers decide the rest exactly as above; the bar only says when the question is asked.
 * `earlyPace` is the same arithmetic for TRACK's fast-climb re-reads (`track.fastClimb`), so a post
 * kept for re-reads and a post asked are measured one way.
 *
 * ★ TWO ANSWERS MUST AGREE. The moment answer says whether people coin this moment and what they
 * would call it; the kind answer (the feed's own kind question) says what it is. A TRAGEDY or any
 * kind outside `passKinds` never passes, whatever the moment answer said — the owner's rule is
 * deaths, tragedy and company news off For You. A missing kind answer is not a pass: the post
 * waits.
 *
 * What breaks if changed carelessly: the name test here must be post-score's (`maxNameWords`), or
 * a moment named in a sentence reaches For You that the first route would have stopped.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_MINUTE } from '../math.ts';
import { heldKind } from './kinds.ts';
import type { ReachLevel } from './reach-bar.ts';

/** The viral-moment answer and the kind answer stored for one post (internal.viral_moment). */
export interface ViralAnswer {
  /** The moment question's yes or no. */
  readonly moment: boolean;
  readonly confidence: number;
  /** The moment's name, or null. */
  readonly name: string | null;
  /** The kind question's label; null when it was not asked (a "no" moment) or gave no answer. */
  readonly kind: string | null;
}

/** Words in a name: runs of letters or digits, as post-score counts them. */
const wordsIn = (name: string): number => name.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '').length;

/**
 * Whether a post the first route turned down is one this exception is for: its first answer is a
 * "no" (and no kind held it, or a lifted kind did), or the kind question held it as a lifted kind.
 * `firstCoinable` null: never judged — not eligible.
 */
export function viralEligible(firstCoinable: boolean | null, kindLabel: string | null, p: Policy): boolean {
  const v = p.judge.viral;
  if (!v.on || firstCoinable === null) return false;
  const held = heldKind(kindLabel, p.judge.heldKinds);
  if (held !== null) return v.liftsKinds.includes(held);
  return !firstCoinable;
}

/** Whether any reading shows the post huge and fast: see the header. */
export function clearsViralBar(readings: readonly ReachLevel[], postedAtMs: number | null, p: Policy): boolean {
  const v = p.judge.viral;
  if (postedAtMs === null) return false;
  return readings.some((x) => {
    if (x.reach === null || x.reach < v.minReach) return false;
    const ageMs = x.atMs - postedAtMs;
    if (ageMs <= 0 || ageMs > v.maxAgeMs) return false;
    return x.reach / (ageMs / MS_PER_MINUTE) >= v.minReachPerMinute;
  });
}

/**
 * The fastest average views a minute since the post among readings within `withinMs` of it; null
 * when there is no such reading or no post time (not shown to be fast is not slow: it is unknown).
 */
export function earlyPace(readings: readonly ReachLevel[], postedAtMs: number | null, withinMs: number): number | null {
  if (postedAtMs === null) return null;
  let best: number | null = null;
  for (const x of readings) {
    const ageMs = x.atMs - postedAtMs;
    if (x.reach === null || ageMs <= 0 || ageMs > withinMs) continue;
    const pace = x.reach / (ageMs / MS_PER_MINUTE);
    if (best === null || pace > best) best = pace;
  }
  return best;
}

/** Whether a reading shows the post fast while fresh (`early`, see the header). Off: never. */
export function clearsEarlyViralBar(readings: readonly ReachLevel[], postedAtMs: number | null, p: Policy): boolean {
  const e = p.judge.viral.early;
  if (!e.on) return false;
  const pace = earlyPace(readings, postedAtMs, e.withinMs);
  return pace !== null && pace >= e.minReachPerMinute;
}

/** Whether the stored answers let the post onto For You: see the header. Null answers: no. */
export function passesAsViral(answer: ViralAnswer | null, p: Policy): boolean {
  const v = p.judge.viral;
  if (!v.on || answer === null || !answer.moment || answer.confidence < v.minConfidence) return false;
  const words = wordsIn(answer.name ?? '');
  if (words === 0 || words > p.rising.maxNameWords) return false;
  const kind = (answer.kind ?? '').trim().toUpperCase();
  return v.passKinds.includes(kind);
}
