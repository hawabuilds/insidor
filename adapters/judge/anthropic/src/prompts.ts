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
export type PromptName = (typeof PROMPT_NAMES)[number];

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
});

/**
 * One hash over all three, in a fixed order. This is what identifies the
 * instruction set in the decision log — a change to any file changes it.
 */
export const PROMPT_SET_SHA: string = createHash('sha256')
  .update(PROMPT_NAMES.map((n) => PROMPTS[n].sha).join('|'))
  .digest('hex')
  .slice(0, 8);
