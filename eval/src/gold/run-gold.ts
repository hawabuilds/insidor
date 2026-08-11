/**
 * The CI entry point for the frozen set: `node eval/src/gold/run-gold.ts`.
 *
 * Exits non-zero on any failure, printing the incident rather than a diff, so a
 * pull request that moves a threshold says "you have reintroduced the $PUMP
 * match" instead of "expected drop, got pass".
 */

import { runGold, describeGold } from './run.ts';
import type { ResolverGate, GoldRunOptions } from './run.ts';

/**
 * NOT YET WIRED — and deliberately a named seat rather than a plausible guess.
 *
 * What goes here: core's real resolver gate, adapted to `ResolverGate`. It
 * cannot be written until `core/src/resolve/gates.ts` exists, because the
 * adapter is a mapping between that file's candidate type and this directory's
 * neutral `GoldGateInput`, and inventing the mapping now would produce a gold
 * run that grades a function nobody wrote.
 *
 * What must NOT go here: a local reimplementation of the gates. A regression set
 * that runs against its own copy of the rule proves the copy is self-consistent
 * and nothing else. `gold.test.ts` already exercises the harness against a
 * reference gate; that is where a test double belongs.
 */
export function coreResolverGate(): ResolverGate {
  throw new Error(
    'NotImplemented: adapt core/src/resolve/gates.ts to eval/src/gold/run.ts#ResolverGate. ' +
      'The mapping is GoldGateInput → the resolver candidate type; do not reimplement the gates here.',
  );
}

export function main(options: GoldRunOptions): number {
  const report = runGold(coreResolverGate(), options);
  process.stdout.write(`${describeGold(report)}\n`);
  return report.failures.length === 0 ? 0 : 1;
}
