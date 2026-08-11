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
import type { Budget, Metered } from './meter.ts';

export interface JudgeSubject {
  readonly storyId: StoryId;
  /** Member text, already selected and truncated by the caller. */
  readonly texts: readonly string[];
  readonly media: readonly MediaRef[];
  readonly distinctAuthors: number;
  readonly distinctSources: number;
}

export type JudgeOutcome =
  | { readonly kind: 'judged'; readonly judgement: Judgement }
  /** The call failed or the answer did not parse. Distinct from "judged not coinable". */
  | { readonly kind: 'unavailable'; readonly storyId: StoryId; readonly detail: string };

export interface JudgePort {
  /** Opaque, versioned id written into the Judgement and thence into the decision log. */
  readonly id: string;
  readonly promptId: string;
  readonly maxBatch: number;

  judge(
    subjects: readonly JudgeSubject[],
    budget: Budget,
  ): Promise<Metered<readonly JudgeOutcome[]>>;
}
