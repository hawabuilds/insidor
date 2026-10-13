/**
 * THE FOR YOU ORDER: one post's separate signals, and a fitted weighting of them that turns them
 * into a single number used to ORDER the feed (and, when the owner sets `rising.scorePassBar`, to
 * hold back posts under it). The number never leaves the projector: no screen, alert or payload.
 *
 * Its own file, not inside `post-score.ts`, because it answers a different question. post-score is
 * the owner's rule — pass or not, for a stated reason. This is a learned weighting, re-fitted twice
 * a day by tools/lib/score-model.ts from the owner's labels, and it only ever narrows or orders
 * what the rule let through. Kept in core, pure, so the fit (tools/) and the projector compute every
 * signal with this one function: a signal computed two ways is a model scored on inputs it never saw.
 *
 * THE SIGNALS, each a fact we already store, kept apart so the fit can weigh them apart:
 *   the judge's answer      yes / held by kind / not judged, as separate indicators ("no" is the base)
 *   the judge's belief      how sure it was the post is coinable (its confidence, turned for a "no")
 *   what it looked at       a picture, a video frame (text is the base)
 *   the name test           its proposed name is 1..`rising.maxNameWords` words
 *   picture                 closest cosine to a coined post's picture
 *   reach                   the most reach read, on the source's own scale, logged
 *   growth                  the fast path's rate: reach a minute since the post, inside `fypFastWindowMs`
 *   first read age          minutes from the post to our first reading, logged
 *   attention               the crypto-attention fact for the post, when that signal is held
 * Only readings inside `rising.fypMaxAgeMs` of the post count, the age a For You post can be: a
 * labelled post read for days would otherwise teach the fit reach a live post never has yet.
 *
 * ★ A MISSING VALUE IS NOT ZERO. A continuous signal we could not read is null here. The fit gives
 * it a term of its own ("<signal> missing") and the value term contributes nothing — the value is
 * set to the fit's own centre, never to 0-as-measured. A signal the fit never saw is missing.
 *
 * What breaks if changed carelessly: renaming or re-defining a signal silently changes what a
 * stored fit's weights mean. Add a new name instead; an old fit reads an unknown signal as missing
 * and a fit that names a signal this file no longer makes scores it as missing too.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { logistic, MS_PER_MINUTE } from '../math.ts';
import { heldKind } from './kinds.ts';
import type { ReachLevel } from './reach-bar.ts';

export const SCORE_SIGNALS = [
  'judge_yes',
  'judge_held_kind',
  'judge_unjudged',
  'judge_belief',
  'looked_picture',
  'looked_frame',
  'name_test',
  'picture',
  'reach',
  'growth',
  'first_read_age',
  'attention',
] as const;
export type ScoreSignal = (typeof SCORE_SIGNALS)[number];
/** Each signal's value, or null when it could not be read. */
export type PostSignals = Readonly<Record<ScoreSignal, number | null>>;

/** The facts one post's signals are made from. Every one is stored before the projector runs. */
export interface RankFacts {
  /** Null together when the judge has not answered. */
  readonly coinable: boolean | null;
  readonly confidence: number | null;
  readonly lookedAt: 'text' | 'picture' | 'videoFrame' | null;
  readonly proposedName: string | null;
  readonly kindLabel: string | null;
  /** Closest cosine to a coined post's picture; null when the post has no vector. */
  readonly pictureSimilarity: number | null;
  readonly readings: readonly ReachLevel[];
  readonly postedAtMs: number | null;
  /** 1, or `rising.shortVideoReachScale` for the short-video source. The caller knows the source. */
  readonly reachScale: number;
  /** The crypto-attention fact; null when not measured (or the signal is not held at all). */
  readonly attention: number | null;
}

const wordsIn = (name: string): number => name.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '').length;
const logged = (x: number): number => Math.log10(1 + Math.max(0, x));

export function postSignals(f: RankFacts, p: Policy): PostSignals {
  const judged = f.coinable !== null && f.confidence !== null;
  const r = p.rising;
  const inWindow = (x: ReachLevel): boolean => f.postedAtMs === null || x.atMs - f.postedAtMs <= r.fypMaxAgeMs;
  const readings = f.readings.filter(inWindow);
  const measured = readings.filter((x): x is { atMs: number; reach: number } => x.reach !== null);
  const most = measured.reduce<number | null>((m, x) => (m === null ? x.reach : Math.max(m, x.reach)), null);
  let growth: number | null = null;
  let firstAge: number | null = null;
  if (f.postedAtMs !== null) {
    const posted = f.postedAtMs;
    for (const x of measured) {
      const age = x.atMs - posted;
      if (age <= 0 || age > r.fypFastWindowMs) continue;
      const rate = x.reach / (age / MS_PER_MINUTE) / f.reachScale;
      growth = growth === null ? rate : Math.max(growth, rate);
    }
    const first = readings.reduce<number | null>((m, x) => (m === null ? x.atMs : Math.min(m, x.atMs)), null);
    if (first !== null) firstAge = Math.max(0, first - posted) / MS_PER_MINUTE;
  }
  const words = judged ? wordsIn(f.proposedName ?? '') : 0;
  return {
    judge_yes: judged && f.coinable === true ? 1 : 0,
    judge_held_kind: heldKind(f.kindLabel, p.judge.heldKinds) === null ? 0 : 1,
    judge_unjudged: judged ? 0 : 1,
    judge_belief: !judged ? null : f.coinable === true ? (f.confidence as number) : 1 - (f.confidence as number),
    looked_picture: f.lookedAt === 'picture' ? 1 : 0,
    looked_frame: f.lookedAt === 'videoFrame' ? 1 : 0,
    name_test: words >= 1 && words <= r.maxNameWords ? 1 : 0,
    picture: f.pictureSimilarity,
    reach: most === null ? null : logged(most / f.reachScale),
    growth: growth === null ? null : logged(growth),
    first_read_age: firstAge === null ? null : logged(firstAge),
    attention: f.attention === null ? null : logged(f.attention),
  };
}

/**
 * One term of a fit: a signal's standardised value (`(v - centre) / spread`), or the indicator that
 * the signal was missing. `weight` is on that standardised scale, so weights compare across signals.
 */
export interface ScoreTerm {
  readonly signal: string;
  readonly kind: 'value' | 'missing';
  readonly centre: number;
  readonly spread: number;
  readonly weight: number;
}

export interface ScoreFit {
  readonly intercept: number;
  readonly terms: readonly ScoreTerm[];
}

/** One term's input for one post: what the fit multiplies by its weight. */
export function termInput(term: Pick<ScoreTerm, 'signal' | 'kind' | 'centre' | 'spread'>, signals: Readonly<Record<string, number | null>>): number {
  const v = signals[term.signal] ?? null;
  if (term.kind === 'missing') return v === null ? 1 : 0;
  /* Missing: the value term says nothing (the centre), its missing term speaks for it. */
  return v === null || term.spread === 0 ? 0 : (v - term.centre) / term.spread;
}

/** The fit's number for one post, between 0 and 1. Used to order and gate; never shown. */
export function postRankScore(signals: Readonly<Record<string, number | null>>, fit: ScoreFit): number {
  let z = fit.intercept;
  for (const t of fit.terms) z += t.weight * termInput(t, signals);
  return logistic(z);
}
