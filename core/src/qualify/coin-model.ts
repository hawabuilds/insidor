/**
 * OUR OWN COIN MODEL'S ARITHMETIC: the facts a post is scored on, turned into named features, and
 * the stored fit's probability that the post gets coined (Policy.judge.coinModel).
 *
 * A safety net behind the judge, not a judge: the runner scores only posts the judge did not pass,
 * and the projector lets one through only when its stored score clears the fit's threshold and
 * every other For You gate still passes. Pure and in core because the SAME function must turn facts
 * into features when the re-tune fits (tools/lib/coin-model.ts, through eval coin-fit.ts) and when
 * the runner scores: a feature computed two ways is a model scored on inputs it never saw.
 *
 * ★ EVERY FACT IS AS OF THE DECISION. The facts are what we held when the judge answered: the
 * newest readings taken by then, never a later one, never the replies or the coin that followed.
 * A missing fact is null and becomes its own "missing" flag plus the training mean — never a zero
 * that would claim a post had no reach or no replies.
 *
 * ★ NAMES, NOT POSITIONS. The fit stores the names it was fitted on with their means and spreads,
 * so a feature added here later is simply not scored by an older fit, and the source and language
 * one-hots come from the fit's own list (core names no source).
 *
 * ★ A COIN IS AN INPUT, NOT THE LABEL, FOR THE VIRAL TARGET (0099). The coins linked to the post by
 * the decision are two features (`COIN_FEATURES`); the coined target's fit leaves them out, since
 * for it they would be the answer read before the question.
 *
 * ★ THE VECTOR IS ONE SPACE. A vector of another space or length is scored as "no vector", the
 * same flag a post without one gets; weights fitted on one meaning say nothing about another.
 *
 * What breaks if changed carelessly: a change to any feature's arithmetic changes what every stored
 * fit means — refit before shipping it. The probability decides and never leaves the system: no
 * number from here reaches a screen.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_MINUTE, logistic } from '../math.ts';

/** What we held about a post when the judge answered it. */
export interface CoinModelFacts {
  readonly source: string;
  readonly lang: string | null;
  readonly text: string;
  /** Each attached medium's kind, as filed ('video', 'image', …). */
  readonly mediaKinds: readonly string[];
  readonly postedAtMs: number | null;
  /** The decision: when the judge answered (or, for a post never judged, when we first saw it). */
  readonly decidedAtMs: number;
  /** The newest reach reading taken at or before the decision, with its time and rate. */
  readonly reach: number | null;
  readonly reachAtMs: number | null;
  readonly ratePerMinute: number | null;
  /** The rate of the reading before that one, for acceleration. */
  readonly priorRatePerMinute: number | null;
  readonly approval: number | null;
  readonly conversation: number | null;
  readonly rebroadcast: number | null;
  readonly followers: number | null;
  /** Posts we held by then that rebroadcast this one. */
  readonly echoes: number | null;
  /**
   * Coins we had linked to the post by the decision (launched and found by then); null when not
   * read. An input of the viral target only: for the coined target it is the label arriving early.
   */
  readonly coins?: number | null;
}

/** The features that read a coin: the coined target's fit leaves them out (its label is a coin). */
export const COIN_FEATURES: readonly string[] = ['coins', 'coined_by_then'];

/** A named feature's value; null is "not known at the decision". */
export type CoinFeatures = Readonly<Record<string, number | null>>;

/** A fit, as the runner holds it (internal.coin_model, 0096). */
export interface CoinModelFit {
  readonly id: number;
  readonly space: string;
  readonly intercept: number;
  readonly names: readonly string[];
  readonly means: readonly number[];
  readonly spreads: readonly number[];
  readonly weights: readonly number[];
  readonly vectorWeights: readonly number[];
  readonly threshold: number;
}

const ln1p = (x: number | null): number | null => (x === null || !Number.isFinite(x) || x < 0 ? null : Math.log1p(x));
const flag = (b: boolean): number => (b ? 1 : 0);

/** Catchphrase hints from the words alone: stated tests, no model. */
export function textHints(text: string, p: Policy): Readonly<Record<string, number>> {
  const T = p.judge.coinModel.text;
  const words = text.replace(/https?:\/\/\S+/gi, ' ').split(/\s+/).filter((w) => w !== '');
  const plain = words.filter((w) => !w.startsWith('#') && !w.startsWith('@'));
  const marked = new RegExp(`["“”«»「」『』]\\s*([^"“”«»「」『』]+?)\\s*["“”«»「」『』]`, 'gu');
  const phrases = [...text.matchAll(marked)].map((m) => (m[1] ?? '').split(/\s+/).filter((w) => w !== '').length);
  const capsWord = new RegExp(`^[^\\p{L}]*\\p{Lu}{${T.minCapsLetters},}[^\\p{L}]*$`, 'u');
  const capital = /^[^\p{L}]*\p{Lu}\p{Ll}/u;
  /* A capitalised word that does not start a sentence: a crude name test, stated. */
  let names = 0;
  for (let i = 1; i < plain.length; i++) {
    const before = plain[i - 1] as string;
    if (capital.test(plain[i] as string) && !/[.!?:]$/.test(before)) names += 1;
  }
  return {
    no_text: flag(plain.length === 0),
    words: Math.log1p(plain.length),
    short_text: flag(plain.length > 0 && plain.length <= T.shortWords),
    marked_phrase: flag(phrases.some((n) => n > 0 && n <= T.maxQuotedWords)),
    caps_word: flag(plain.some((w) => capsWord.test(w))),
    names: Math.log1p(names),
    hashtags: Math.log1p(words.filter((w) => w.startsWith('#')).length),
    mentions: Math.log1p(words.filter((w) => w.startsWith('@')).length),
    link: flag(/https?:\/\//i.test(text)),
    question: flag(text.includes('?')),
    exclaim: flag(text.includes('!')),
  };
}

/** The named features of one post. `sources` and `langs` are the one-hots the fit knows. */
export function coinModelFeatures(f: CoinModelFacts, sources: readonly string[], langs: readonly string[], p: Policy): CoinFeatures {
  const read = f.reach !== null && f.reachAtMs !== null;
  const ageAtReading = read && f.postedAtMs !== null ? Math.max(1, ((f.reachAtMs as number) - f.postedAtMs) / MS_PER_MINUTE) : null;
  const ageAtDecision = f.postedAtMs === null ? null : Math.max(0, (f.decidedAtMs - f.postedAtMs) / MS_PER_MINUTE);
  const rate = ln1p(f.ratePerMinute);
  const prior = ln1p(f.priorRatePerMinute);
  const share = (x: number | null): number | null => (x === null || f.reach === null || x < 0 ? null : Math.log((x + 1) / (f.reach + 1)));
  const out: Record<string, number | null> = {
    reach: read ? ln1p(f.reach) : null,
    reach_a_minute: ageAtReading === null ? null : ln1p((f.reach as number) / ageAtReading),
    rate,
    acceleration: rate !== null && prior !== null ? rate - prior : null,
    approval: ln1p(f.approval),
    conversation: ln1p(f.conversation),
    rebroadcast: ln1p(f.rebroadcast),
    approval_share: share(f.approval),
    conversation_share: share(f.conversation),
    age: ln1p(ageAtDecision),
    followers: ln1p(f.followers),
    echoes: ln1p(f.echoes),
    coins: ln1p(f.coins ?? null),
    coined_by_then: f.coins === undefined || f.coins === null ? null : flag(f.coins > 0),
    no_reading: flag(!read),
    no_rate: flag(rate === null),
    no_followers: flag(f.followers === null),
    no_post_time: flag(f.postedAtMs === null),
    video: flag(f.mediaKinds.includes('video')),
    image: flag(f.mediaKinds.includes('image') && !f.mediaKinds.includes('video')),
    no_media: flag(f.mediaKinds.length === 0),
    lang_none: flag(f.lang === null),
    ...textHints(f.text, p),
  };
  for (const s of sources) out[`source:${s}`] = flag(f.source === s);
  for (const l of langs) out[`lang:${l}`] = flag(f.lang === l);
  return out;
}

/** One post's standardised named part, in the fit's order: a missing value sits at the mean. */
export function standardised(features: CoinFeatures, names: readonly string[], means: readonly number[], spreads: readonly number[]): Float64Array {
  const x = new Float64Array(names.length);
  for (let i = 0; i < names.length; i++) {
    const v = features[names[i] as string];
    const m = means[i] as number;
    const s = spreads[i] as number;
    x[i] = v === null || v === undefined || !Number.isFinite(v) || s <= 0 ? 0 : (v - m) / s;
  }
  return x;
}

/** Whether a vector can be scored by a fit: its space and its length. */
export function vectorFits(vector: { readonly space: string; readonly values: ArrayLike<number> } | null, space: string, dim: number): boolean {
  return vector !== null && vector.space === space && vector.values.length === dim && dim > 0;
}

/** The fit's probability that the post gets coined; a vector that does not fit it scores as none (`no_vector`). */
export function coinModelProbability(features: CoinFeatures, vector: { readonly space: string; readonly values: ArrayLike<number> } | null, fit: Omit<CoinModelFit, 'id' | 'threshold'>): number | null {
  const has = vectorFits(vector, fit.space, fit.vectorWeights.length);
  const x = standardised({ ...features, no_vector: flag(!has) }, fit.names, fit.means, fit.spreads);
  let z = fit.intercept;
  for (let i = 0; i < x.length; i++) z += (fit.weights[i] as number) * (x[i] as number);
  if (has) {
    const v = (vector as { readonly values: ArrayLike<number> }).values;
    for (let j = 0; j < fit.vectorWeights.length; j++) z += (fit.vectorWeights[j] as number) * Number(v[j]);
  }
  return Number.isFinite(z) ? logistic(z) : null;
}

export type CoinModelVerdict =
  | { readonly kind: 'add'; readonly probability: number; readonly threshold: number; readonly fitId: number }
  | { readonly kind: 'keep_out'; readonly probability: number; readonly threshold: number; readonly fitId: number }
  | { readonly kind: 'unscored'; readonly why: 'off' | 'no_fit' | 'not_finite' };

/**
 * Whether the safety net would take one post the judge did not pass. Policy `threshold` overrides
 * the fit's own only for the live target (`isLiveTarget`): it was set for that target's scale, and
 * a shadowed target's probabilities mean something else.
 */
export function coinModelVerdict(facts: CoinModelFacts, vector: { readonly space: string; readonly values: ArrayLike<number> } | null, fit: CoinModelFit | null, p: Policy, isLiveTarget = true): CoinModelVerdict {
  const C = p.judge.coinModel;
  if (!C.on && !C.shadow) return { kind: 'unscored', why: 'off' };
  if (fit === null) return { kind: 'unscored', why: 'no_fit' };
  const { sources, langs } = oneHotsOf(fit.names);
  const probability = coinModelProbability(coinModelFeatures(facts, sources, langs, p), vector, fit);
  if (probability === null) return { kind: 'unscored', why: 'not_finite' };
  const threshold = (isLiveTarget ? C.threshold : null) ?? fit.threshold;
  return probability >= threshold ? { kind: 'add', probability, threshold, fitId: fit.id } : { kind: 'keep_out', probability, threshold, fitId: fit.id };
}

/** The source and language one-hots a fit knows, read back from its names. */
export function oneHotsOf(names: readonly string[]): { readonly sources: readonly string[]; readonly langs: readonly string[] } {
  return {
    sources: names.filter((n) => n.startsWith('source:')).map((n) => n.slice('source:'.length)),
    langs: names.filter((n) => n.startsWith('lang:')).map((n) => n.slice('lang:'.length)),
  };
}
