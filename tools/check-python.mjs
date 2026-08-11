/**
 * THE SINGLE-RUNTIME GATE. Fails if a .py file exists outside ml/train/, or if any
 * production package mentions python, `uv run`, or `child_process`.
 *
 * WHY: Python is in the repository and never in production. It trains a model on a laptop,
 * by hand, weekly, and hands back a JSON file. Nothing under services/ imports it, shells
 * out to it, or waits on it — if Python vanished from the machine at 3am the system would
 * keep deciding with the model file it already has.
 *
 * The risk is not technical, it is gravitational: ml/train/ will try to grow. The first
 * time something shells out to it, the single-runtime property is gone and nobody decided
 * to lose it. This is eight lines that make losing it a choice.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk, read, blankNonCode, locate, Report } from './lib/source.mjs';

const PYTHON_HOME = 'ml/train/';
const PRODUCTION = ['contracts', 'core', 'adapters', 'store', 'services', 'ml/serve', 'ml/label', 'app/src'];
const SHELL_OUT = [
  { re: /\bchild_process\b/g, name: 'child_process' },
  { re: /\bspawn(?:Sync)?\s*\(/g, name: 'spawn(' },
  { re: /\bexecFile(?:Sync)?\s*\(/g, name: 'execFile(' },
  { re: /\buv\s+run\b/g, name: 'uv run' },
  { re: /\bpython3?\b/g, name: 'python' },
];

const report = new Report(
  'check-python',
  `Python lives in ${PYTHON_HOME} and nowhere else, and no production package may invoke it`,
);

/* 1. Stray .py files. */
const strays = [];
const stack = [ROOT];
while (stack.length > 0) {
  const dir = stack.pop();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'legacy', 'tapes', 'docs'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (entry.isDirectory()) stack.push(full);
    else if (rel.endsWith('.py') && !rel.startsWith(PYTHON_HOME)) strays.push(rel);
  }
}
for (const file of strays) {
  report.scanned += 1;
  report.add({
    file, line: 1, col: 1,
    message: 'a Python file outside ml/train/',
    why: 'the whole two-language split is safe because the boundary is data — a parquet in, a model.json out. A .py anywhere else is a second runtime in production.',
    fix: `move it under ${PYTHON_HOME}, or rewrite it in TypeScript.`,
  });
}

/* 2. A production package reaching for it. */
for (const root of PRODUCTION) {
  for (const file of walk(root, ['.ts', '.tsx', '.mts', '.mjs'])) {
    report.scanned += 1;
    const raw = read(file);
    const code = blankNonCode(raw);
    for (const { re, name } of SHELL_OUT) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code)) !== null) {
        const { line, col } = locate(raw, m.index);
        report.add({
          file, line, col, width: m[0].length,
          message: `\`${name}\` in a production package`,
          why: 'a process that waits on a subprocess has that subprocess in its uptime, its deploy, and its 3am pager.',
          fix: 'the model arrives as a file in the registry. Read the file.',
        });
      }
    }
  }
}

report.finish();
