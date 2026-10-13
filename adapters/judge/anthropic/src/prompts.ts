/**
 * Prompts are FILES, never inline strings.
 *
 * Three reasons, and the third is the one that pays:
 *   - a prompt in a template literal cannot be diffed, reviewed or shown to
 *     someone who does not read code, and the people best placed to improve it
 *     are exactly those people;
 *   - the same text is the instruction sheet a human labeller works from, which
 *     is what keeps a model's labels and a person's labels commensurable;
 *   - it survives the model. When this stage becomes a trained classifier, the
 *     prompt text remains the definition of what the label MEANS.
 *
 * Each prompt is hashed at load, and the hash goes into the decider string on
 * every Decision this judge contributes to. Without it, a prompt edit is
 * invisible in the log and every judgement before and after it looks alike.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROMPT_DIR = join(import.meta.dirname, '..', 'prompts');

export const PROMPT_NAMES = ['system', 'coinability-core', 'subject-vs-story'] as const;
/** The single-post question the feed asks: a set of its own, hashed apart. See POST_PROMPT_SET_SHA. */
export const POST_PROMPT_NAMES = ['post-system', 'post-coinability'] as const;
/** The feed's second question: which kind of post this is, so marketing, sport, fandom and showbiz are held back. */
export const VETO_PROMPT_NAMES = ['post-veto-system', 'post-veto'] as const;
export type PromptName = (typeof PROMPT_NAMES)[number] | (typeof POST_PROMPT_NAMES)[number] | (typeof VETO_PROMPT_NAMES)[number];

export interface Prompt {
  readonly name: PromptName;
  readonly text: string;
  /** First 8 hex characters of the sha256. Enough to name a version in a log. */
  readonly sha: string;
}

function load(name: PromptName): Prompt {
  const text = readFileSync(join(PROMPT_DIR, `${name}.txt`), 'utf8');
  const sha = createHash('sha256').update(text).digest('hex').slice(0, 8);
  return { name, text, sha };
}

/** Read once at module load. A prompt that changes mid-run is unauditable. */
export const PROMPTS: Readonly<Record<PromptName, Prompt>> = Object.freeze({
  system: load('system'),
  'coinability-core': load('coinability-core'),
  'subject-vs-story': load('subject-vs-story'),
  'post-system': load('post-system'),
  'post-coinability': load('post-coinability'),
  'post-veto-system': load('post-veto-system'),
  'post-veto': load('post-veto'),
});

/**
 * One hash over all three, in a fixed order. This is what identifies the
 * instruction set in the decision log — a change to any file changes it.
 */
export const PROMPT_SET_SHA: string = createHash('sha256')
  .update(PROMPT_NAMES.map((n) => PROMPTS[n].sha).join('|'))
  .digest('hex')
  .slice(0, 8);

/**
 * ★ THE FEED'S OWN QUESTION, HASHED APART. The set above asks whether a GROUP of posts shares
 * one subject, and leans hard on "no subject" — right for a narrative, wrong for one post, where
 * it turned down most of the owner's real coined posts (4 of 41 passed). The feed asks of one post
 * whether people could make a coin about it, from the owner's coined-post profile. A set of its
 * own, so a post's answer names which question it answered and the narrative judge is untouched.
 */
export const POST_PROMPT_SET_SHA: string = createHash('sha256')
  .update(POST_PROMPT_NAMES.map((n) => PROMPTS[n].sha).join('|'))
  .digest('hex')
  .slice(0, 8);

/** The kind question's own hash: an answer to it is never mistaken for the coinability answer. */
export const VETO_PROMPT_SET_SHA: string = createHash('sha256')
  .update(VETO_PROMPT_NAMES.map((n) => PROMPTS[n].sha).join('|'))
  .digest('hex')
  .slice(0, 8);

/**
 * The same-subject question GROUP asks about a borderline pair of pictures. Kept OUT of the
 * prompt set above, on purpose: the set's hash is in the id of every coinability judgement,
 * and adding an unrelated prompt to it would make every judgement after this look like it
 * came from a different instruction set. This one has its own hash, carried on every answer.
 */
const sameSubjectText = readFileSync(join(PROMPT_DIR, 'same-subject.txt'), 'utf8');
export const SAME_SUBJECT_PROMPT = Object.freeze({
  text: sameSubjectText,
  sha: createHash('sha256').update(sameSubjectText).digest('hex').slice(0, 8),
});

/**
 * The words that introduce the owner's labelled posts when they ride along with the post question
 * as precedent (client.ts `buildRequestBody`). Kept out of the post prompt set, like the
 * same-subject prompt: its hash is folded into the post question's id only when precedents are on
 * (index.ts `promptFor`), so turning them on or editing these words files every answer after it
 * under a new id, and turning them off returns to the rules' own id.
 */
const precedentsText = readFileSync(join(PROMPT_DIR, 'post-precedents.txt'), 'utf8');
export const PRECEDENTS_PROMPT = Object.freeze({
  text: precedentsText,
  sha: createHash('sha256').update(precedentsText).digest('hex').slice(0, 8),
});
