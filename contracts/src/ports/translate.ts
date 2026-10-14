/**
 * THE TRANSLATOR'S PORT: a feed post's words, and back the same words in English with the
 * language they were written in (Policy.translate, 0081).
 *
 * Its own port rather than another question on the judge's, because the judge reads thousands
 * of posts a day before any reaches a feed and a translation is wanted only for the few hundred
 * that do (measured 2026-10-14: about 7 a day need one). Folding it into the judge's answer would
 * pay for translating every judged post and would move the judge's prompt hash, which files every
 * verdict.
 *
 * Nothing here names a provider or a model. The adapter prices and meters each call. Three
 * outcomes, never two: `translated` (the English and the language), `kept` (the model read the
 * words as already English, or as nothing to translate: the card shows them as they are), and
 * `absent` (the call failed, was refused for money, or did not parse — asked again later, never
 * stored as "nothing to translate").
 *
 * What breaks if changed carelessly: the subject `ref` is what answers are matched back by. It
 * must be unique within a call; matching by position would put one post's words on another's card.
 */

import type { Budget, Metered } from './meter.ts';

export interface TranslateSubject {
  /** Unique within a call: answers come back by it. */
  readonly ref: string;
  readonly text: string;
}

export type TranslateOutcome =
  /** `from`: the language's two- or three-letter code, lower case. */
  | { readonly kind: 'translated'; readonly ref: string; readonly from: string; readonly text: string }
  /** Already English (`from` 'en') or no words to translate (`from` 'zxx'): shown as written. */
  | { readonly kind: 'kept'; readonly ref: string; readonly from: string }
  /** No usable answer: the call failed, was refused, or did not parse. Not "nothing to translate". */
  | { readonly kind: 'absent'; readonly ref: string; readonly detail: string };

export interface TranslatePort {
  /** 'translate:<vendor>/<model>@<prompt sha>'. */
  readonly id: string;
  /** Stored beside every translation: 'translate@<prompt sha>'. */
  readonly promptId: string;
  readonly model: string;
  /** One outcome per subject, in the order asked. Calls of at most the policy's `perCall` subjects. */
  translate(subjects: readonly TranslateSubject[], budget: Budget): Promise<Metered<readonly TranslateOutcome[]>>;
}
