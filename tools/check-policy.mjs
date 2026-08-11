/**
 * THE POLICY GATE. Fails on a bare numeric literal anywhere in core/, outside policy.ts
 * and a short, named allowlist of files that do genuine mathematics.
 *
 * WHY: in the build this replaces there were sixty uppercase numeric constants across
 * twenty-four files, and no way to answer "what was this item judged against in March?"
 * without reading twenty-four files as they stood in March. Every threshold living in one
 * frozen object means tuning is a diff, the decision row can carry a hash of it, and a
 * replay can be run against a policy that no longer exists.
 *
 * Allowed everywhere: -1, 0, 1, 2, and an array index. Those are structure, not judgement.
 * A unit conversion (60_000 for millis-per-minute) is not a threshold either, but it is
 * also not structure — it belongs in core/src/math.ts as a named constant, which is why
 * that file is on the allowlist and a stage file is not.
 *
 * This check needs an occasional allowlist edit. That is a real, small, recurring cost,
 * and it is the price of "every threshold is a number somebody typed somewhere" never
 * being true again.
 *
 * Escape for one line: `policy-allow: <reason>`. It requires a reason because a number
 * with no reason is exactly what this check exists to find.
 */

import { walk, read, blankNonCode, locate, Report } from './lib/source.mjs';

const SCANNED = 'core';

/** Structural values. Not judgements — no amount of tuning changes what "the first one" is. */
const ALWAYS_ALLOWED = new Set(['0', '1', '2', '-1', '0.0', '1.0']);

/**
 * Files where a literal is mathematics rather than policy. Each one costs a reason.
 * A stage file will never appear here: if a stage needs a number, the number is a
 * threshold, and thresholds live in contracts/src/policy.ts.
 */
const ALLOWED_FILES = {
  'core/src/policy.ts': 'the one place thresholds are allowed to be typed.',
  'core/src/math.ts': 'clamp01, logistic, percentile — the arithmetic itself, plus named unit constants.',
  'core/src/hash.ts': 'FNV-1a is defined by two specific constants. They are the algorithm, not a choice.',
};

const isAllowedFile = (file) =>
  file in ALLOWED_FILES ||
  file.endsWith('/policy.ts') ||
  file.endsWith('.test.ts') ||
  file.includes('/__fixtures__/');

const LITERAL_RE = /(?<![\w$.])-?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/g;

/** `xs[3]` is an index. `x > 3` is a judgement. The bracket is the whole difference. */
function isArrayIndex(code, start, end) {
  let before = start - 1;
  while (before >= 0 && /\s/.test(code[before])) before -= 1;
  let after = end;
  while (after < code.length && /\s/.test(code[after])) after += 1;
  return code[before] === '[' && code[after] === ']';
}

const report = new Report(
  'check-policy',
  'no bare numeric literal in core/ — every threshold is named and lives in contracts/src/policy.ts',
);

for (const file of walk(SCANNED, ['.ts', '.tsx', '.mts'])) {
  report.scanned += 1;
  if (isAllowedFile(file)) continue;

  const raw = read(file);
  const code = blankNonCode(raw);
  const allowedLines = new Set();
  for (const m of raw.matchAll(/policy-allow:\s*\S/g)) allowedLines.add(locate(raw, m.index).line);

  LITERAL_RE.lastIndex = 0;
  let m;
  while ((m = LITERAL_RE.exec(code)) !== null) {
    const literal = m[0];
    if (ALWAYS_ALLOWED.has(literal)) continue;
    if (isArrayIndex(code, m.index, m.index + literal.length)) continue;
    const { line, col } = locate(raw, m.index);
    if (allowedLines.has(line)) continue;
    report.add({
      file, line, col, width: literal.length,
      message: `bare numeric literal \`${literal}\``,
      why: 'a number typed into a stage is a threshold nobody can find later, and a decision judged against it cannot be replayed against a different one.',
      fix: 'name it in contracts/src/policy.ts and read it off the Policy argument. If it is arithmetic rather than judgement, put it in core/src/math.ts, or add `policy-allow: <reason>` on this line.',
    });
  }
}

if (report.findings.length > 0) {
  console.error('');
  console.error('[check-policy] files exempt by design:');
  for (const [file, why] of Object.entries(ALLOWED_FILES)) console.error(`   ${file}  — ${why}`);
}
report.finish();
