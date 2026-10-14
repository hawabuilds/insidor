/**
 * THE NAMER'S PORT: a post, its closest known post → coin pairs, and back the names and tickers
 * people are likeliest to coin it as, best first (Policy.names).
 *
 * Its own port rather than another question on the judge's, because the answer is a different
 * shape (a ranked list of names, not a verdict) and has different readers: coin matching
 * searches with every guess, and the Create sheet offers the first few. The judge's own
 * `proposedName` stays what it is — the subject's name, read by the feed's bar — and is never
 * overwritten by a guess.
 *
 * Nothing here names a provider or a model. The adapter prices and meters each call; a call that
 * fails, was refused for money or did not parse is a post with NO guesses (`absent`), never an
 * empty list read as "nobody would coin this".
 *
 * What breaks if changed carelessly: the subject `ref` is what answers are matched back by. It
 * must be unique within a call; matching by position would give one post another's names.
 */

import type { Budget, Metered } from './meter.ts';

/** One known pair: a post people made a coin of, and every name they used for it. */
export interface NameExample {
  /** The post's words as shown; '' for a picture-only post. */
  readonly text: string;
  /** A few words on what its picture shows, when we have them; null otherwise. */
  readonly seen: string | null;
  readonly coins: readonly { readonly name: string; readonly ticker: string }[];
}

export interface NameSubject {
  /** Unique within a call: answers come back by it. */
  readonly ref: string;
  readonly text: string;
  /** The post's picture, shown to the model when it can be read; null for none. */
  readonly picture: string | null;
  /** Its closest known pairs, closest first. */
  readonly examples: readonly NameExample[];
}

export interface NameGuess {
  readonly name: string;
  /** Capitals and digits, no '$'. */
  readonly ticker: string;
}

export type NameOutcome =
  | { readonly kind: 'guessed'; readonly ref: string; readonly guesses: readonly NameGuess[]; readonly seen: string | null }
  /** No usable answer for this post: the call failed, was refused, or did not parse. Not "no names". */
  | { readonly kind: 'absent'; readonly ref: string; readonly detail: string };

export interface NamePort {
  /** 'names:<model>@<prompt sha>' — recorded beside every guess. */
  readonly id: string;
  readonly promptId: string;
  readonly model: string;
  /** One outcome per subject, in the order asked. Calls of at most the policy's `perCall` subjects. */
  guess(subjects: readonly NameSubject[], budget: Budget): Promise<Metered<readonly NameOutcome[]>>;
}
