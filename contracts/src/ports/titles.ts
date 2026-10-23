/**
 * THE NARRATIVE TITLER'S PORT: a few of a narrative's posts, and back a short clear title for the
 * story they share (Policy.narrative.title, the owner 2026-10-16: "Short clear title (cheap model)").
 *
 * Its own port rather than a question on the judge's, because it is asked once per narrative —
 * a few dozen a day — not once per post, and folding it into the judge would move the judge's
 * prompt hash, which files every verdict.
 *
 * Nothing here names a provider or a model; the adapter prices and meters each call. Two
 * outcomes: `titled`, or `absent` (the call failed, was refused for money, or the answer was not
 * a usable title) — absent is asked again on a later pass and meanwhile the narrative keeps the
 * name its posts' judge gave it, never a placeholder.
 *
 * ★ ONE MORE QUESTION ON THE SAME CALL (policy.v153, Policy.narrative.fight): whether the posts are
 * users of two or more countries trading memes and insults with each other online, and which
 * countries. `fight` on a `titled` answer: the countries (two or more, each a plain country name),
 * an empty list for "no", or absent when the answer said nothing usable about it — absent is asked
 * again with the next title; an empty list is an answer and is kept.
 *
 * What breaks if changed carelessly: the subject `ref` is what answers are matched back by.
 */

import type { Budget, Metered } from './meter.ts';

export interface TitleSubject {
  /** Unique within a call: answers come back by it. */
  readonly ref: string;
  /** Some of the narrative's posts' own words, most seen first. */
  readonly posts: readonly string[];
  /** The names the judge gave its posts' subject. */
  readonly names: readonly string[];
}

export type TitleOutcome =
  | { readonly kind: 'titled'; readonly ref: string; readonly title: string; readonly fight?: readonly string[] }
  | { readonly kind: 'absent'; readonly ref: string; readonly detail: string };

export interface TitlePort {
  /** 'titles:<vendor>/<model>@<prompt sha>'. */
  readonly id: string;
  readonly model: string;
  /** One outcome per subject, in the order asked. */
  title(subjects: readonly TitleSubject[], budget: Budget): Promise<Metered<readonly TitleOutcome[]>>;
}
