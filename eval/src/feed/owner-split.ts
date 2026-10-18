/**
 * THE OWNER'S SPLIT OF THE MISSED POSTS, READ: which post ids the re-tune always teaches and which it
 * never teaches and always tests (owner-split.json, the owner 2026-10-17: "add 6 as yes examples and
 * keep the other 6, plus the other test posts it already caught, as the test set the gate uses").
 *
 * Its own file, not the policy, because a post id names its source and contracts/ may not know
 * source names (check-vocabulary); the gate's numbers stay in Policy.learning.ownerGate. Read once,
 * at import, from the committed file, so every tool that builds a block (tools/retune.ts,
 * tools/judge-examples.ts, tools/judge-open-eval.ts) splits the same way.
 *
 * What breaks if changed carelessly: an id in both lists, or an untaught miss missing from `test`,
 * would teach the gate's own answer key — so the file is checked here and a bad file stops the tool
 * rather than grading a block on posts it was shown. Moving an id between the lists changes what
 * the gate measures; it is the owner's call, made in the file with a commit that says so.
 */

import { readFileSync } from 'node:fs';

import type { Policy } from '@insidor/contracts/policy.ts';

interface Entry { readonly id: string; readonly post: string }
interface SplitFile { readonly teach: readonly Entry[]; readonly test: readonly Entry[]; readonly untaughtMisses: readonly string[]; readonly dropped?: readonly Entry[] }

export interface OwnerSplit {
  readonly teach: readonly string[];
  readonly test: readonly string[];
  readonly untaughtMisses: readonly string[];
  /** Never taught from any source (the owner, 2026-10-18: once taught, they made the candidate worse twice). */
  readonly dropped: readonly string[];
}

/** The split, checked: no id in both lists, every untaught miss in `test`, no id twice. */
export function checkSplit(f: SplitFile): OwnerSplit {
  const teach = f.teach.map((e) => e.id);
  const test = f.test.map((e) => e.id);
  const both = teach.filter((id) => test.includes(id));
  if (both.length > 0) throw new Error(`owner-split.json: ${both.join(', ')} is both taught and tested`);
  const loose = f.untaughtMisses.filter((id) => !test.includes(id));
  if (loose.length > 0) throw new Error(`owner-split.json: untaughtMisses ${loose.join(', ')} not in test`);
  for (const [name, ids] of [['teach', teach], ['test', test]] as const) {
    if (new Set(ids).size !== ids.length) throw new Error(`owner-split.json: an id is twice in ${name}`);
  }
  const dropped = (f.dropped ?? []).map((e) => e.id);
  const taughtDrop = dropped.filter((id) => teach.includes(id) || test.includes(id));
  if (taughtDrop.length > 0) throw new Error(`owner-split.json: ${taughtDrop.join(', ')} is dropped and also taught or tested`);
  return { teach, test, untaughtMisses: [...f.untaughtMisses], dropped };
}

export const OWNER_SPLIT: OwnerSplit = checkSplit(JSON.parse(readFileSync(new URL('./owner-split.json', import.meta.url), 'utf8')) as SplitFile);

/**
 * Every id the block always teaches: the policy's list, then the owner's split; never one the split
 * tests (the test wins, as `isExample` has it).
 */
export const alwaysTeachIds = (p: Policy, split: OwnerSplit = OWNER_SPLIT): readonly string[] =>
  [...new Set([...p.learning.alwaysTeach, ...split.teach])].filter((id) => !split.test.includes(id) && !split.dropped.includes(id));
