/**
 * NO SAMPLE DATA CAN REACH THE APP BUILD — asserted from the same graph the bundler walks.
 *
 * The app used to carry invented posts, stories, coins and pools, and a build could put them
 * in front of a user behind a "sample data" bar. The owner's rule since: no sample data,
 * anywhere; an empty screen says it is empty, and recorded payloads live in tests only. A
 * rule like that is undone by one innocent import, so this file checks it rather than
 * trusting it.
 *
 * ★ WHAT IT WALKS. It starts where the browser starts — the module `index.html` loads — and
 * follows every RELATIVE specifier in `import … from`, `export … from`, side-effect `import '…'`
 * and dynamic `import('…')`. That is the set of files Vite can put in the bundle from this
 * package. Bare specifiers (`react`, `@insidor/wallet`) are other packages, governed by their
 * own checks, and are not followed. A dynamic import counts exactly like a static one: the old
 * fixtures were reached through `await import('./fixtures.ts')`, so a walker that skipped
 * dynamic imports would have passed the very build this test exists to forbid.
 *
 * ★ WHAT FAILS IT. Two things, either of which means invented data can render:
 *   1. A reached file inside `src/test-fixtures/`, which is test-only by definition.
 *   2. A reached file holding a marker of the removed sample set: its story, coin and pool
 *      ids, its invented account names, its loader names, and the on-screen "sample data"
 *      notice. Markers catch the data being pasted back in under a new file name, which a
 *      path rule alone would miss.
 *
 * ★ AND IT PROBES ITSELF. The last test builds a tiny graph on disk with a planted violation
 * behind a dynamic import and asserts the walker finds it. A checker that silently stopped
 * following imports would otherwise keep passing forever, which is the failure
 * `check:boundaries` probes for in the same way.
 *
 * If this fails, move the data under `src/test-fixtures/` and import it from a `*.test.ts`
 * only. Do not add an exception to the marker list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The removed sample set, by the strings that only it ever contained. */
const SAMPLE_MARKERS: readonly string[] = [
  /* story ids */
  'st_ferry', 'st_pigeon', 'st_chillguy', 'st_dance', 'st_rooftop', 'st_soup',
  /* coin ids */
  'c_ferry', 'c_gran1', 'c_gran2', 'c_roof',
  /* pool and mint addresses */
  '9pToadPoolA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU', '4kLoongCurveB6dE8fG0hJ2kL4mN6pQ8rS0tU2v',
  '6mMcatNoCapC8fG0hJ2kL4mN6pQ8rS0tU2vW4x', '3bStackExactD0hJ2kL4mN6pQ8rS0tU2vW4xY6z',
  '9xJerseyA1qP2mNvKdRt7sZbFgHyCwXeUoTiLkMnPq', '4kJerseyB8sV1cQwErTyUiOpAsDfGhJkLzXcVbNm',
  /* invented accounts */
  '@localferrywatch', '@harbourdaily', '@boatsofinstagram', '@dockrefuser',
  /* the loader and the switch that put it on screen */
  'fixtureBoard', 'fixtureStory', 'fixturePairs', 'fixtureLaunches', 'fixtureSources',
  'readFixture', 'USING_FIXTURES', 'fixtureBar', 'simtagFixtures', 'sampleSwitchProblem',
  /* the recorded test payloads' own ids, so a copy of them is caught as well */
  'st_rec_story', 'c_rec_coin', 'solana:rec_pool',
];

/** Case-insensitive markers: the notice copy, however it is capitalised. */
const SAMPLE_PHRASES: readonly RegExp[] = [/sample data/i, /sample payload/i];

const TEST_ONLY_DIR = `${sep}src${sep}test-fixtures${sep}`;

/** Every relative module specifier in a source file: static, re-export, side-effect, dynamic. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const re of patterns) for (const match of source.matchAll(re)) out.push(match[1] ?? '');
  return out.filter((s) => s.startsWith('./') || s.startsWith('../'));
}

/** A specifier to a file, the way Vite would: as written, then with the usual extensions. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const tries = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const candidate of tries) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

/** The module `index.html` loads. Read from the page so a renamed entry cannot be skipped. */
function entryOf(root: string): string {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const src = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  assert.ok(src, 'index.html loads no module script, so there is no entry to walk from');
  return join(root, src.replace(/^\//, ''));
}

interface Walk {
  readonly reached: readonly string[];
  readonly unresolved: readonly string[];
}

function walk(entry: string): Walk {
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    /* Stylesheets and other assets are read for markers but have no module imports to follow. */
    if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(file)) continue;
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      const next = resolveSpecifier(file, spec);
      if (next === null) unresolved.push(`${file} -> ${spec}`);
      else queue.push(next);
    }
  }
  return { reached: [...seen], unresolved };
}

/** Every way a reached file can carry sample data, as readable lines. */
function violations(root: string, reached: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of reached) {
    const name = relative(root, file);
    if (file.includes(TEST_ONLY_DIR)) out.push(`${name}: test-only recorded data reached from the app entry`);
    if (/\.test\.tsx?$/.test(file)) out.push(`${name}: a test file reached from the app entry`);
    const text = readFileSync(file, 'utf8');
    for (const marker of SAMPLE_MARKERS) if (text.includes(marker)) out.push(`${name}: holds sample marker ${JSON.stringify(marker)}`);
    for (const phrase of SAMPLE_PHRASES) if (phrase.test(text)) out.push(`${name}: holds sample phrase ${phrase}`);
  }
  return out;
}

test('★ nothing the app entry can import holds sample or test-only data', () => {
  const { reached, unresolved } = walk(entryOf(APP_ROOT));
  /* A walk that reached almost nothing proves almost nothing. The read layer and the board
     must both be in it, or the walker has stopped following imports. */
  const names = reached.map((f) => relative(APP_ROOT, f).split(sep).join('/'));
  for (const must of ['src/main.tsx', 'src/App.tsx', 'src/shared/api/client.ts', 'src/features/feed/Feed.tsx']) {
    assert.ok(names.includes(must), `the walk never reached ${must}; the walker is broken, not the app clean`);
  }
  assert.deepEqual(unresolved, [], 'a relative import the walker could not resolve is a file it could not check');
  assert.deepEqual(violations(APP_ROOT, reached), []);
});

test('the sample loader and the sample switch are gone from the source tree', () => {
  for (const gone of ['src/shared/api/fixtures.ts', 'src/shared/api/sample-switch.ts']) {
    assert.equal(existsSync(join(APP_ROOT, gone)), false, `${gone} is back`);
  }
});

test('the walker catches a test-fixture reached through a dynamic import (probe)', () => {
  const root = mkdtempSync(join(tmpdir(), 'no-sample-probe-'));
  try {
    mkdirSync(join(root, 'src', 'test-fixtures'), { recursive: true });
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<script type="module" src="/src/main.tsx"></script>');
    writeFileSync(join(root, 'src', 'main.tsx'), "export { read } from './lib/read.ts';\n");
    writeFileSync(
      join(root, 'src', 'lib', 'read.ts'),
      "export async function read() { return (await import('../test-fixtures/rows.ts')).rows; }\n",
    );
    writeFileSync(join(root, 'src', 'test-fixtures', 'rows.ts'), "export const rows = [{ id: 'st_ferry' }];\n");

    const { reached } = walk(entryOf(root));
    const found = violations(root, reached);
    assert.ok(found.some((v) => v.includes('test-only recorded data')), 'the planted test-fixture import was missed');
    assert.ok(found.some((v) => v.includes('"st_ferry"')), 'the planted sample marker was missed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
