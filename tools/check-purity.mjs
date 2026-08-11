/**
 * THE PURITY GATE. Fails if anything under core/ can read the clock, roll a die, reach the
 * network, read the environment, or await.
 *
 * WHY: the replay guarantee — "re-run any past decision under a new rule and see exactly
 * what changes" — is only real if a decider cannot see anything it did not log. A stage
 * receives `now` as a VALUE on its StageContext; the moment one calls `Date.now()` instead,
 * a replay six months later gets a different answer and nobody finds out, because both
 * answers look plausible. Same for `Math.random`, for `process.env`, and for a fetch that
 * quietly refreshes a feature the decision log says was stale.
 *
 * The type system already forbids the worst of it: a function typed to return `Decision`
 * rather than `Promise<Decision>` cannot be `async`, and a function that cannot be `async`
 * cannot `await`. This check covers what types do not — a top-level `await`, a clock read
 * inside a helper, an import of something that is not the vocabulary.
 *
 * Colocated tests are exempt from the IMPORT rule only, because they legitimately import
 * `node:test` and `node:assert/strict`. They are NOT exempt from the clock or the RNG: a
 * core test that reads the wall clock is a test that fails on a Tuesday.
 */

import path from 'node:path';
import { walk, read, blankNonCode, locate, Report } from './lib/source.mjs';

const SCANNED = 'core';

/** Each pattern is written against code with comments and strings already blanked out. */
const FORBIDDEN = [
  { re: /\bDate\s*\.\s*now\b/g, name: 'Date.now', why: 'the clock is an input. A stage receives `ctx.now`; it does not ask.' },
  { re: /\bnew\s+Date\b/g, name: 'new Date', why: 'a Date is mutable, is not JSON, and is a clock read in disguise. Millis, from ctx.' },
  { re: /\bDate\s*\(/g, name: 'Date(', why: 'the clock is an input.' },
  { re: /\bMath\s*\.\s*random\b/g, name: 'Math.random', why: 'exploration is assigned from `ctx.seed`, deterministically, or the holdout cannot be replayed.' },
  { re: /\bperformance\s*\.\s*now\b/g, name: 'performance.now', why: 'still a clock.' },
  { re: /\bfetch\s*\(/g, name: 'fetch(', why: 'core decides on data it was handed. The service does the fetching.' },
  { re: /\bprocess\s*\./g, name: 'process.*', why: 'an environment variable is an ungoverned input that no decision row records.' },
  { re: /\brequire\s*\(/g, name: 'require(', why: 'ESM only, and a dynamic require defeats every static boundary check in this repo.' },
  { re: /\bimport\s*\(/g, name: 'import(', why: 'a dynamic import is an import the boundary checks cannot see.' },
  { re: /\basync\b/g, name: 'async', why: 'a decider that can await can fetch, query, or recompute a feature from fresher data than the one it logged.' },
  { re: /\bawait\b/g, name: 'await', why: 'same reason. The signature says Decision, not Promise<Decision>; keep it true inside too.' },
  { re: /\bPromise\b/g, name: 'Promise', why: 'nothing in core is asynchronous. A Promise here is the beginning of one.' },
  { re: /\bset(?:Timeout|Interval|Immediate)\s*\(/g, name: 'timer', why: 'scheduling is the runner\'s job. core computes when to look again and returns it as data.' },
  { re: /\bqueueMicrotask\s*\(/g, name: 'queueMicrotask', why: 'nothing in core is asynchronous.' },
  { re: /\bcrypto\s*\./g, name: 'crypto.*', why: 'core hashes with its own FNV-1a in hash.ts, which is deterministic and dependency-free.' },
  { re: /\bconsole\s*\./g, name: 'console.*', why: 'a pure function has one output: its return value. Logging is the caller\'s decision.' },
  { re: /\bglobalThis\b/g, name: 'globalThis', why: 'ambient state is state the decision row does not contain.' },
];

const IMPORT_RE = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;

/** The only specifiers core may name. Everything else is a dependency core does not have. */
function importIsAllowed(spec, file, isTest) {
  if (spec === '@insidor/contracts' || spec.startsWith('@insidor/contracts/')) return true;
  if (isTest && (spec === 'node:test' || spec.startsWith('node:assert'))) return true;
  if (!spec.startsWith('.')) return false;
  /* A relative path may not climb out of the package. rootDir catches this at typecheck
     time; catching it here too means the message names the rule instead of saying TS6059. */
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  return resolved.startsWith('core/src/');
}

const report = new Report(
  'check-purity',
  'core/ is pure: no clock, no randomness, no network, no environment, no await, and no import that is not the vocabulary',
);

for (const file of walk(SCANNED, ['.ts', '.tsx', '.mts'])) {
  report.scanned += 1;
  const raw = read(file);
  const code = blankNonCode(raw);
  /* Imports are read from a copy that keeps STRING LITERALS — the specifier is a string.
     Comments are still blanked, so a commented-out import is not a finding. */
  const withStrings = blankNonCode(raw, { strings: false });
  const isTest = file.endsWith('.test.ts');

  for (const { re, name, why } of FORBIDDEN) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      const { line, col } = locate(raw, m.index);
      report.add({
        file, line, col, width: m[0].length,
        message: `\`${name}\` is not allowed in core/`,
        why,
        fix: 'take it as an argument instead. If a service must supply it, it belongs on StageContext or on the stage input — as data, not as a call.',
      });
    }
  }

  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(withStrings)) !== null) {
    const spec = m[1] ?? m[2];
    if (importIsAllowed(spec, file, isTest)) continue;
    const at = withStrings.indexOf(spec, m.index);
    const { line, col } = locate(raw, at === -1 ? m.index : at);
    report.add({
      file, line, col, width: spec.length,
      message: `core/ may not import "${spec}"`,
      why: 'core knows the vocabulary and its own files. Nothing else — not a vendor, not the store, not a Node builtin.',
      fix: spec.startsWith('.')
        ? 'a relative import must stay inside core/src. Shared types belong in contracts/.'
        : 'if this is a vendor, the code belongs in adapters/. If it is a Node builtin, core has no business needing it.',
    });
  }
}

report.finish();
