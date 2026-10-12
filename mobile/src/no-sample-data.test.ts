/**
 * ★ NO SAMPLE DATA CAN REACH THE APP BUILD.
 *
 * The owner removed every sample post, narrative, coin, wallet, person, comment, leaderboard
 * entry and alert from the app (2026-10-13). Recorded data still exists — in src/test-fixtures,
 * for tests. This test is what keeps it there: it follows every import the app makes, starting
 * from main.tsx (static imports, re-exports and dynamic `import()`), and fails if any file the
 * bundler could pull in is a test fixture, or carries one of the recorded samples' ids,
 * addresses or handles. A fixture wired back in "just for the demo" fails here, in CI, before
 * anyone sees it.
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(SRC, 'main.tsx');

/* What the removed samples were made of: if any of these is in a shipped file, a sample is too. */
const MARKERS = [
  'test-fixtures',
  'st_ferry',
  'c_ferry',
  'nordkyst_ferge',
  '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY',
  'sample:you',
  'FerryHorn111',
  'fixtureBoard',
  'fixtureStory',
  'fixturePortfolio',
  'sampleAnswer',
  'loadSample',
  'USING_FIXTURES',
  'SAMPLE_SCREENS',
];

const SPECIFIERS = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveFile(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate) && !candidate.endsWith('/')) return candidate;
  return null;
}

function reachable(): string[] {
  const seen = new Set<string>();
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPECIFIERS)) {
      const next = resolveFile(file, m[1] ?? m[2] ?? '');
      if (next !== null && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

test('★ nothing the app imports is a test fixture or carries a recorded sample', () => {
  const files = reachable();
  assert.ok(files.length > 40, `the walk found the app (${files.length} files)`);
  for (const file of files) {
    const rel = relative(SRC, file);
    assert.ok(!rel.startsWith('test-fixtures'), `${rel} is a test fixture, reachable from main.tsx`);
    assert.ok(!/\.test\.tsx?$/.test(rel), `${rel} is a test, reachable from main.tsx`);
    const text = readFileSync(file, 'utf8');
    for (const marker of MARKERS) assert.ok(!text.includes(marker), `${rel} carries "${marker}": sample data would ship`);
  }
});

test('the recorded data is still there for the tests', () => {
  assert.ok(existsSync(join(SRC, 'test-fixtures', 'fixtures.ts')));
});
