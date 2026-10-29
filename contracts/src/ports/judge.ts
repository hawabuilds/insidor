/**
 * THE JUDGE PORT — the one place the system asks a language model anything.
 *
 * Nothing here names a provider or a model, and the prompt is an id rather than a
 * string: prompts live beside the adapter as files, never inline, so a prompt change
 * is a reviewable diff and an answer is replayable against the exact text that
 * produced it.
 *
 * WHY the port returns data rather than being called from a stage: the stage that
 * uses a judgement is pure and synchronous. The service calls this port, gets a
 * Judgement, and hands it in as an input field. If the judge was not called, the
 * field is null and the stage ABSTAINS with a named reason rather than deciding
 * blind — and replaying that stage over the decision log needs no network and no key.
 *
 * Batching is in the signature because most of the spend is one static prompt
 * retransmitted per subject.
 */

import type { Judgement } from '../judgement.ts';
import type { StoryId } from '../ids.ts';
import type { MediaRef } from '../vocabulary.ts';
import type { Budget, CostEstimate, Metered } from './meter.ts';

/**
 * One story, packaged for the judge — and note what is NOT here: the story object, its
 * members, its carriers, its scores. Only the text and media somebody chose to send.
 *
 * The selection and truncation are the CALLER's, deliberately. Which members to include
 * is a spend decision and a leakage decision at once, and hiding it inside the adapter
 * would make the prompt's actual contents depend on a vendor package's internals — so a
 * replay would reconstruct a different prompt from the same story and get a different
 * answer with nothing recorded to explain the difference.
 *
 * `distinctAuthors` and `distinctSources` ride along because they are breadth, and
 * breadth is the one thing about a story the text itself cannot show.
 */
export interface JudgeSubject {
  readonly storyId: StoryId;
  /** Member text, already selected and truncated by the caller. */
  readonly texts: readonly string[];
  readonly media: readonly MediaRef[];
  readonly distinctAuthors: number;
  readonly distinctSources: number;
  /**
   * Posts the owner has labelled that are closest to this one, with the owner's label, shown to
   * the judge as precedent. Chosen by the CALLER (by similarity), for the reason above: what the
   * judge is shown is a decision that must be visible outside the adapter. Absent or empty: none.
   */
  readonly precedents?: readonly JudgePrecedent[];
  /**
   * A huge account has just shared this post (Policy.judge.resurface): quoted it, or posted the same
   * picture or video under its own name, with these words. Shown to the judge beside the post,
   * because for a coin the share is the moment, whatever the post's age. Chosen by the CALLER, for
   * the reason above. Absent: the post is judged on its own.
   */
  readonly sharedBy?: JudgeShare;
}

/** Who shared a post just now, how, and what they said. Facts only: the adapter words them. */
export interface JudgeShare {
  /** The account's handle, without the "@". */
  readonly handle: string;
  /** Followers as last read; null when never read. */
  readonly followers: number | null;
  /** 'quoted': a quote of the post; 'samePicture': the same picture or video posted under its own name. */
  readonly how: 'quoted' | 'samePicture' | 'reposted';
  /** The sharing post's own words (links removed, trimmed); '' when it said nothing. */
  readonly words: string;
}

/** One labelled post shown as precedent: its words (already trimmed), the owner's label, and why. */
export interface JudgePrecedent {
  /** The labelled post's id: two subjects sharing a precedent are shown it once. */
  readonly ref: string;
  readonly text: string;
  readonly label: 'meme' | 'not';
  /** The owner's reason, or what the label came from; null when nothing was said. */
  readonly why: string | null;
}

export type JudgeOutcome =
  | { readonly kind: 'judged'; readonly judgement: Judgement }
  /** The call failed or the answer did not parse. Distinct from "judged not coinable". */
  | { readonly kind: 'unavailable'; readonly storyId: StoryId; readonly detail: string };

/** The three answers to the same-subject question. Only `yes` is evidence. */
export type SameSubjectAnswer = 'yes' | 'no' | 'unsure';

export interface JudgePort {
  /** Opaque, versioned id written into the Judgement and thence into the decision log. */
  readonly id: string;
  readonly promptId: string;
  readonly maxBatch: number;

  judge(
    subjects: readonly JudgeSubject[],
    budget: Budget,
  ): Promise<Metered<readonly JudgeOutcome[]>>;

  /**
   * What judging these subjects WOULD cost, worked out without asking. Pessimistic.
   *
   * ★ NO I/O AND NO SPEND, like `PlatformAdapter.estimate`. It is what lets the runner
   * price a dry run, and consult the budget BEFORE a call, without the judge being able
   * to reach the network to answer.
   */
  estimate(subjects: readonly JudgeSubject[]): CostEstimate;

  /**
   * Is the main subject of these two pictures the same? GROUP asks this only about a pair
   * whose image similarity is borderline, and only "yes" counts as evidence. Null when either
   * picture could not be read or the reply carried no usable answer — nothing was learned.
   * Optional: a judge without it is never asked, and a borderline pair simply does not join.
   */
  readonly sameSubjectPromptId?: string;
  sameSubject?(a: MediaRef, b: MediaRef, budget: Budget): Promise<Metered<SameSubjectAnswer | null>>;
  estimateSameSubject?(): CostEstimate;
}

/**
 * One side of the coin-and-post question, as each presents itself: the coin by its name, ticker,
 * description, the words of the post its own link points at, and its picture; the post by its words
 * and picture. A field we do not hold is null and is told to the judge as "(none)", never guessed.
 */
export interface CoinPostSides {
  readonly coin: { readonly name: string | null; readonly ticker: string | null; readonly description: string | null; readonly linkedText: string | null; readonly picture: MediaRef };
  readonly post: { readonly text: string | null; readonly picture: MediaRef };
}

/**
 * Is a coin tied to a post by its name alone about the same subject as the post, judged on both
 * sides' words AND pictures together? Only "no" removes the coin, and only from a name-only tie;
 * null (a picture that would not load, a garbled reply) is "nothing learned", never a "no".
 */
export interface CoinPostCheckPort {
  /** The model and the prompt's hash: stored on every answer. */
  readonly id: string;
  readonly promptId: string;
  check(sides: CoinPostSides, budget: Budget): Promise<Metered<SameSubjectAnswer | null>>;
}
