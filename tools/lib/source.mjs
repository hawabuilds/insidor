/**
 * Shared plumbing for the tools/ checks: walk a directory, blank out the parts of a
 * source file that are not code, and print a failure a human can act on.
 *
 * WHY this exists as one file rather than five copies: the checks are greps, and a grep
 * that reports the wrong line number is worse than no grep — it gets one false report,
 * loses its credibility, and is switched off. The line/column arithmetic is written once.
 *
 * WHY every path is relative to the repository root: an absolute path on a CI runner can
 * itself contain a banned word (a home directory, a machine name), which produces a
 * failure on every file at once and looks exactly like a real one. Compare relatives.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, derived from this file's own location. No env, no cwd. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'legacy', 'tapes']);

/**
 * Every file under `dir` with one of `exts`, as repo-relative POSIX paths, sorted.
 * Sorted because two checks reporting the same tree in different orders makes a diff
 * of two CI logs useless.
 */
export function walk(dir, exts) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const found = [];
  const stack = [abs];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (exts.some((e) => entry.name.endsWith(e))) {
        found.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  }
  return found.sort();
}

export function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/** Byte offsets where each line begins, so an index becomes a line and a column. */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/** Turn a character offset into { line, col }, both 1-based, the way an editor counts. */
export function locate(text, offset, starts = lineIndex(text)) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 };
}

export function lineAt(text, line) {
  return text.split('\n')[line - 1] ?? '';
}

const REGEX_CAN_FOLLOW = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '']);

/**
 * Replace every comment, string and regular-expression literal with spaces, keeping the
 * file exactly as long as it was.
 *
 * WHY same-length: the purity and policy checks report the line and column of what they
 * find, and they find it in this blanked copy. Preserving offsets means the reported
 * position points at the real character in the real file.
 *
 * The template-literal case blanks `${}` interpolations too. That is a deliberate small
 * blind spot — a threshold hidden inside a template string is not a shape this codebase
 * produces, and the alternative is a real parser.
 */
export function blankNonCode(src, { comments = true, strings = true, regex = true } = {}) {
  const out = src.split('');
  const blank = (i) => { if (src[i] !== '\n') out[i] = ' '; };
  let i = 0;
  let prev = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { if (comments) blank(i); i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const from = i;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(src.length, i + 2);
      if (comments) for (let k = from; k < i; k++) blank(k);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      if (!strings) { i++; while (i < src.length && src[i] !== c) { i += src[i] === '\\' ? 2 : 1; } i++; continue; }
      blank(i++);
      while (i < src.length) {
        if (src[i] === '\\') { blank(i++); if (i < src.length) blank(i++); continue; }
        if (src[i] === c) { blank(i++); break; }
        blank(i++);
      }
      continue;
    }
    if (regex && c === '/' && REGEX_CAN_FOLLOW.has(prev)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        while (i <= j) blank(i++);
        while (i < src.length && /[a-z]/.test(src[i])) blank(i++); // flags
        prev = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/**
 * A predicate: is this offset inside a comment? Used by the one exemption shape that is
 * genuinely safe — a rule is allowed to name the words it bans, in prose, without that
 * counting as a use. A banned word in an identifier or a string literal still counts.
 */
export function inComment(src) {
  const masked = blankNonCode(src, { comments: true, strings: false, regex: false });
  return (offset) => masked[offset] !== src[offset];
}

/**
 * Every identifier in a file, with its offset. Used by the vocabulary checks, which run
 * against the RAW text — a banned word in a comment is still a banned word, because the
 * comment is where the next person learns what to call the field.
 */
export function identifiers(text) {
  const found = [];
  const re = /[A-Za-z][A-Za-z0-9_$]*/g;
  let m;
  while ((m = re.exec(text)) !== null) found.push({ word: m[0], offset: m.index });
  return found;
}

/**
 * The forms of an identifier a ban list should be compared against: the whole thing, its
 * camel/snake sub-words, adjacent sub-word pairs, and singulars.
 *
 * WHY sub-words and not substrings: `playCount` must trip the ban on "playcount", and
 * `reviews` must NOT trip the ban on "views". Substring matching gets the second one
 * wrong, and one false positive is all it takes for someone to delete the check.
 */
export function forms(identifier) {
  const parts = identifier
    .split(/[_$]+/)
    .flatMap((s) => s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(' '))
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  const out = new Set([identifier.toLowerCase()]);
  for (const p of parts) {
    out.add(p);
    if (p.length > 3 && p.endsWith('s')) out.add(p.slice(0, -1));
  }
  for (let i = 0; i + 1 < parts.length; i++) out.add(parts[i] + parts[i + 1]);
  return out;
}

/** A findings collector that prints one actionable block per finding and sets the exit code. */
export class Report {
  constructor(check, rule) {
    this.check = check;
    this.rule = rule;
    this.findings = [];
    this.scanned = 0;
  }

  add({ file, line, col, width = 1, message, why, fix }) {
    this.findings.push({ file, line, col, width, message, why, fix });
  }

  /** Prints, then exits. Non-zero on any finding — a check that only warns is a comment. */
  finish() {
    const label = `[${this.check}]`;
    if (this.findings.length === 0) {
      console.log(`${label} ok — ${this.scanned} file${this.scanned === 1 ? '' : 's'} scanned, 0 findings`);
      process.exit(0);
    }
    this.findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
    for (const f of this.findings) {
      const src = lineAt(read(f.file), f.line);
      const gutter = String(f.line).padStart(5);
      console.error('');
      console.error(`${f.file}:${f.line}:${f.col}  ${f.message}`);
      console.error(`${gutter} | ${src.replace(/\t/g, '  ')}`);
      console.error(`${' '.repeat(5)} | ${' '.repeat(Math.max(0, f.col - 1))}${'^'.repeat(Math.max(1, f.width))}`);
      console.error(`      rule: ${this.rule}`);
      if (f.why) console.error(`      why:  ${f.why}`);
      if (f.fix) console.error(`      fix:  ${f.fix}`);
    }
    console.error('');
    console.error(`${label} FAILED — ${this.findings.length} finding${this.findings.length === 1 ? '' : 's'} across ${this.scanned} scanned files`);
    process.exit(1);
  }
}
