/**
 * The reveal: the only place a hand-labelled sheet meets its answers.
 *
 * It is a separate step, in a separate file, run by a separate command, because
 * the join is the moment blindness ends and it should be an event rather than a
 * side effect of opening a spreadsheet.
 *
 * WHAT THIS REFUSES TO DO, and why each refusal is here:
 *
 *   - Reveal a partially labelled sheet. Stopping when the pattern looks clear
 *     is how a wave becomes a story about the rows someone felt like doing.
 *   - Reveal against a different wave's answers. The sheetId must match.
 *   - Report a cell computed from fewer than five observations without flagging
 *     it. Wave 3's `others_copying_it` moved +28.3 points on counts that small,
 *     and the previous report flagged n<5 — that flag is carried forward here as
 *     code rather than as a convention.
 *   - Report a difference without its population and label source attached. A
 *     number with no population is what voided the last backtest.
 */

import type { AnswerFile, BlindSheet } from './sheet.ts';

/** One labeller's answers for one case. Booleans are the only feature type. */
export interface FilledRow {
  readonly caseKey: string;
  readonly labels: Readonly<Record<string, boolean>>;
}

export class RevealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevealError';
  }
}

export interface Cell {
  readonly feature: string;
  readonly group: string;
  readonly n: number;
  readonly trueCount: number;
  readonly rate: number;
  /** True when n < 5. Reported, never silently dropped and never silently read. */
  readonly underpowered: boolean;
}

export interface RevealResult {
  readonly sheetId: string;
  readonly population: string;
  readonly labelSource: string;
  readonly labelWindowDays: number;
  readonly seed: number;
  readonly groups: readonly string[];
  readonly cells: readonly Cell[];
  /** feature → (rate in the first group − rate in the second), percentage points. */
  readonly differences: ReadonlyMap<string, number>;
  readonly caveat: string;
}

const MIN_CELL = 5;

/**
 * @param groupOf reads the group out of an answer row's outcome. Passed in
 *   rather than assumed, because "winner" is a threshold somebody chose and the
 *   threshold belongs in the caller's sight, not buried here.
 */
export function reveal(
  sheet: BlindSheet,
  filled: readonly FilledRow[],
  answers: AnswerFile,
  groupOf: (outcome: Readonly<Record<string, unknown>>) => string,
): RevealResult {
  if (sheet.sheetId !== answers.sheetId) {
    throw new RevealError(
      `sheet "${sheet.sheetId}" and answers "${answers.sheetId}" are different waves. ` +
        'Joining across waves is how a wave gets read twice.',
    );
  }

  const expected = new Set(sheet.rows.map((r) => r.caseKey));
  const seen = new Set(filled.map((r) => r.caseKey));

  const missing = [...expected].filter((k) => !seen.has(k));
  if (missing.length > 0) {
    throw new RevealError(
      `${missing.length} of ${expected.size} cases are unlabelled. A partial reveal is a result ` +
        'about whichever rows someone felt like doing.',
    );
  }
  const unknown = [...seen].filter((k) => !expected.has(k));
  if (unknown.length > 0) {
    throw new RevealError(`${unknown.length} labelled cases are not on this sheet (first: ${unknown[0] ?? ''})`);
  }

  const groupByKey = new Map<string, string>();
  for (const a of answers.rows) groupByKey.set(a.caseKey, groupOf(a.outcome));

  const features = new Set<string>();
  for (const r of filled) for (const f of Object.keys(r.labels)) features.add(f);

  const groups = [...new Set([...groupByKey.values()])].sort();
  const cells: Cell[] = [];

  for (const feature of [...features].sort()) {
    for (const group of groups) {
      let n = 0;
      let trueCount = 0;
      for (const r of filled) {
        if (groupByKey.get(r.caseKey) !== group) continue;
        const v = r.labels[feature];
        if (v === undefined) continue;
        n++;
        if (v) trueCount++;
      }
      cells.push({
        feature,
        group,
        n,
        trueCount,
        rate: n === 0 ? Number.NaN : trueCount / n,
        underpowered: n < MIN_CELL,
      });
    }
  }

  const differences = new Map<string, number>();
  const [a, b] = groups;
  if (a !== undefined && b !== undefined && groups.length === 2) {
    for (const feature of features) {
      const ca = cells.find((c) => c.feature === feature && c.group === a);
      const cb = cells.find((c) => c.feature === feature && c.group === b);
      if (ca === undefined || cb === undefined) continue;
      differences.set(feature, (ca.rate - cb.rate) * 100);
    }
  }

  return {
    sheetId: sheet.sheetId,
    population: answers.population,
    labelSource: answers.labelSource,
    labelWindowDays: answers.labelWindowDays,
    seed: answers.seed,
    groups,
    cells,
    differences,
    caveat:
      'Descriptive only — not statistically significant. Cells with n < 5 are marked and must ' +
      'not be read. A result that does not replicate across waves is not a result: three of the ' +
      'four strongest features in the previous run flipped sign between wave 2 and wave 3.',
  };
}

export function renderReveal(r: RevealResult): string {
  const lines: string[] = [];
  lines.push(`# Blind reveal — ${r.sheetId}`);
  lines.push('');
  lines.push(`- **Population.** ${r.population}`);
  lines.push(`- **Label source.** ${r.labelSource}, ${r.labelWindowDays}-day window`);
  lines.push(`- **Seed.** ${r.seed} — this wave regenerates exactly from it`);
  lines.push('');
  lines.push(`> ${r.caveat}`);
  lines.push('');
  lines.push(`| feature | ${r.groups.join(' | ')} | difference (pp) |`);
  lines.push(`|---|${r.groups.map(() => '---|').join('')}---|`);

  const features = [...new Set(r.cells.map((c) => c.feature))].sort();
  for (const feature of features) {
    const cols = r.groups.map((g) => {
      const c = r.cells.find((x) => x.feature === feature && x.group === g);
      if (c === undefined) return '—';
      const pct = Number.isNaN(c.rate) ? '—' : `${(c.rate * 100).toFixed(1)}%`;
      return `${pct} (n=${c.n})${c.underpowered ? ' ⚠' : ''}`;
    });
    const diff = r.differences.get(feature);
    lines.push(`| ${feature} | ${cols.join(' | ')} | ${diff === undefined ? '—' : diff.toFixed(1)} |`);
  }
  lines.push('');
  lines.push('⚠ = fewer than 5 observations in the cell. Reported so it is visible, not so it is used.');
  return lines.join('\n');
}
