/**
 * Running the frozen set against a resolver.
 *
 * The gate is passed IN. This module owns the cases and the comparison; it does
 * not own the rule. That split is what lets the same set run against core's real
 * `resolve/gates.ts`, against a candidate policy, and against a deliberately
 * broken gate in the harness's own tests — without any of them being able to
 * quietly redefine what "correct" means for a case.
 */

import type { Verdict } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';

import type { GoldCase, GoldGateInput } from './cases.ts';
import { GOLD_CASES, toGateInput } from './cases.ts';

/**
 * A resolver gate under test: given a candidate and a policy, return the reason
 * it is refused, or null if it survives every gate.
 *
 * Synchronous, because every gate in this set is one of the free local ones —
 * mint-time confidence, temporal ordering, symbol provenance. The paid gates
 * (transfer rules, quotability) need a venue read and are exercised by the
 * adapter contract suite instead; eval is forbidden from importing adapters, and
 * a gold set that needed the network would not run.
 */
export type ResolverGate = (c: GoldGateInput, p: Policy) => ReasonCode | null;

/**
 * How a reason maps to a verdict. Declared by the caller rather than inferred,
 * because ABSTAIN and DROP are different populations — "we said no" and "we
 * never had the evidence" — and merging them poisons every recall number
 * downstream.
 */
export interface GoldRunOptions {
  readonly abstainReasons: readonly ReasonCode[];
  readonly policy: Policy;
}

export interface GoldOutcome {
  readonly caseId: string;
  readonly ok: boolean;
  readonly expected: { readonly verdict: Verdict; readonly reason: ReasonCode | null };
  readonly actual: { readonly verdict: Verdict; readonly reason: ReasonCode | null };
  readonly incident: string;
  readonly why: string;
}

export interface GoldReport {
  readonly total: number;
  readonly passed: number;
  readonly failures: readonly GoldOutcome[];
  readonly outcomes: readonly GoldOutcome[];
}

export function runGold(gate: ResolverGate, opts: GoldRunOptions, cases: readonly GoldCase[] = GOLD_CASES): GoldReport {
  const abstain = new Set<ReasonCode>(opts.abstainReasons);
  const outcomes: GoldOutcome[] = [];

  for (const c of cases) {
    const reason = gate(toGateInput(c), opts.policy);
    const verdict: Verdict = reason === null ? 'pass' : abstain.has(reason) ? 'abstain' : 'drop';
    const actual = { verdict, reason };

    // A case is satisfied when the verdict matches AND, when the case names a
    // reason, the reason matches. Verdict alone is not enough: a resolver that
    // drops the GYM case for the wrong reason has not fixed the temporal gate,
    // it has coincidentally rejected the row, and the next threshold change
    // brings it straight back.
    const ok =
      verdict === c.expect.verdict && (c.expect.reason === null || reason === c.expect.reason);

    outcomes.push({ caseId: c.id, ok, expected: c.expect, actual, incident: c.incident, why: c.why });
  }

  const failures = outcomes.filter((o) => !o.ok);
  return { total: outcomes.length, passed: outcomes.length - failures.length, failures, outcomes };
}

/** Human-readable, for CI output and for the weekly report. */
export function describeGold(report: GoldReport): string {
  if (report.failures.length === 0) return `gold set: ${report.passed}/${report.total} — every known incident is still caught`;

  const lines = [`gold set: ${report.passed}/${report.total}`, ''];
  for (const f of report.failures) {
    lines.push(`✗ ${f.caseId}`);
    lines.push(`    what happened once: ${f.incident}`);
    lines.push(`    expected: ${f.expected.verdict} ${f.expected.reason ?? '(no reason)'}`);
    lines.push(`    got:      ${f.actual.verdict} ${f.actual.reason ?? '(no reason)'}`);
    lines.push(`    why it matters: ${f.why}`);
    lines.push('');
  }
  return lines.join('\n');
}
