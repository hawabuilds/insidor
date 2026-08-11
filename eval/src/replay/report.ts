/**
 * The replay report, as markdown.
 *
 * ONE RULE GOVERNS THIS FILE: every measurement declares its population, its
 * label source and its window, IN THE ARTEFACT ITSELF, next to the number. Not
 * in a README, not in the commit message, not in someone's memory of which
 * command they ran. The previous backtest produced a real number about a
 * population nobody wrote down, and it took a re-derivation months later to
 * discover the number was about graduated coins — roughly 107 a day against
 * 30,000 mints — while the claim it was used for was about coinability at large.
 *
 * So the header is not decoration and must not be trimmed to make the report
 * shorter. A number with no population is not a shorter report; it is a
 * different and much worse artefact.
 */

import type { ReplayResult } from './harness.ts';
import { populationCaveat } from '../lane.ts';
import { summarise, transitionMatrix } from './diff.ts';

export interface ReportMeta {
  /** What is being compared, in one line: 'admit minReach 5000 → 3500'. */
  readonly candidate: string;
  /** The policy hash the candidate run used. Pairs with policyHashBefore. */
  readonly candidatePolicyHash: string;
  /** How the source rows were selected. The SQL, or a sentence. */
  readonly sourceDescription: string;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function renderReport(r: ReplayResult, meta: ReportMeta, topN: number): string {
  const s = summarise(r, topN);
  const lines: string[] = [];

  lines.push(`# Replay — ${meta.candidate}`);
  lines.push('');
  lines.push('## What this is about');
  lines.push('');
  lines.push(`- **Population.** ${meta.sourceDescription}`);
  lines.push(`- **Lanes.** ${r.lanes.join(', ')}`);
  lines.push(`- ${populationCaveat(r.lanes)}`);
  lines.push(
    `- **Window.** ${r.window === null ? 'no rows considered' : `${iso(r.window.fromMs)} … ${iso(r.window.toMs)}`}`,
  );
  lines.push(`- **Stages.** ${r.stages.length === 0 ? 'none' : r.stages.join(', ')}`);
  lines.push(`- **Feature sets.** ${r.featureSets.length === 0 ? 'none' : r.featureSets.join(', ')}`);
  lines.push(`- **Candidate policy hash.** ${meta.candidatePolicyHash}`);
  lines.push('');
  lines.push('No network was used to produce this. The core is pure and the feature vectors');
  lines.push('were frozen at decision time, so these are the numbers the decider actually saw.');
  lines.push('');

  lines.push('## Coverage');
  lines.push('');
  lines.push(`- rows read: **${r.seen}**`);
  lines.push(`- rows replayed: **${r.considered}**`);
  for (const [reason, n] of Object.entries(r.skipped)) {
    if (n > 0) lines.push(`- skipped, ${reason.replace(/_/g, ' ')}: ${n}`);
  }
  if (r.skipped.feature_set_excluded > 0) {
    lines.push('');
    lines.push(
      '> Rows written under a feature set the candidate does not read are skipped, not scored. ' +
        'Scoring them would read `undefined` for the newer keys and produce flips that are an ' +
        'artefact of the schema rather than of the policy.',
    );
  }
  lines.push('');

  lines.push('## What would change');
  lines.push('');
  lines.push(`- **newly admitted:** ${s.newlyAdmitted}  — costs tracking budget`);
  lines.push(`- **newly rejected:** ${s.newlyRejected}  — ★ the expensive direction, and invisible in production`);
  lines.push(`- same verdict, different reason: ${s.reasonOnly}`);
  lines.push(`- unchanged: ${s.unchanged}`);
  lines.push(`- churn: ${(s.churnRate * 100).toFixed(2)}% of replayed rows`);
  lines.push('');

  const cells = transitionMatrix(r);
  if (cells.length > 0) {
    lines.push('| before | after | rows |');
    lines.push('|---|---|---|');
    for (const c of cells) lines.push(`| ${c.before} | ${c.after} | ${c.count} |`);
    lines.push('');
  }

  if (s.topNewReasons.length > 0) {
    lines.push('## Where the change landed');
    lines.push('');
    lines.push('| new reason | rows |');
    lines.push('|---|---|');
    for (const x of s.topNewReasons) lines.push(`| \`${x.reason}\` | ${x.count} |`);
    lines.push('');
  }

  if (r.examples.length > 0) {
    lines.push('## Examples');
    lines.push('');
    lines.push('| subject | lane | before | after |');
    lines.push('|---|---|---|---|');
    for (const e of r.examples) {
      lines.push(
        `| \`${e.subjectId}\` | ${e.lane} | ${e.before.verdict} \`${e.before.reason}\` | ` +
          `${e.after.verdict} \`${e.after.reason}\` |`,
      );
    }
    lines.push('');
    lines.push(`Showing ${r.examples.length} of ${r.flips} flips.`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('Before trusting any number above, run the replay with the CURRENT policy and');
  lines.push('confirm zero flips. A replay that disagrees with the log about the past cannot');
  lines.push('be trusted about a hypothetical.');

  return lines.join('\n');
}
