#!/usr/bin/env node
/**
 * DOES THE BOUNDARY CHECK ACTUALLY SEE ANYTHING?
 *
 * `pnpm check:boundaries` passing means one of two things: no forbidden import exists, or the
 * checker cannot see imports at all. Those look identical from the outside — both print a
 * green tick — and this repo shipped the second one. Every `@insidor/*` import was
 * unresolvable, so every rule written against a path like `^core/` matched nothing, and the
 * whole check passed while reading none of the edges it exists to police.
 *
 * A test suite has the same failure mode and the same fix: assert that the thing fails when
 * it should. So this writes a file that breaks a rule, cruises it, and requires the violation
 * to be reported. If it is not, the checker is blind and this exits non-zero.
 *
 *   node tools/check-boundaries-probe.mjs
 *
 * Run it after touching `.dependency-cruiser.cjs`. It is in `pnpm check` for the same reason
 * the check itself is: the failure it catches is silent, and a silent failure is only ever
 * found by something that looks for it on purpose.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each probe writes one file that MUST be reported by one named rule.
 *
 * `core` importing an adapter is the case worth stating plainly: it is the edge the whole
 * three-layer split exists to prevent, and it is the one whose absence would be hardest to
 * notice, because nothing else in the build would complain until a vendor's field shape had
 * already spread through the logic.
 */
const PROBES = [
  {
    file: 'core/src/__probe_boundary.ts',
    source: "import { VENDOR } from '@insidor/adapter-x';\nexport const probe = VENDOR;\n",
    expectRule: 'core-imports-only-contracts',
    why: 'core must not be able to reach a vendor adapter',
  },
  {
    file: 'store/src/__probe_boundary.ts',
    source: "import { decide } from '@insidor/core';\nexport const probe = decide;\n",
    expectRule: 'store-imports-only-contracts',
    why: 'store persists the vocabulary and must not hold logic',
  },
  {
    file: 'contracts/src/__probe_boundary.ts',
    source: "import { readFile } from 'node:fs/promises';\nexport const probe = readFile;\n",
    expectRule: 'contracts-is-a-leaf',
    why: 'contracts must depend on nothing at all, builtins included',
  },
  /*
   * The wallet package is the one thing the app is allowed to construct that is not
   * contracts, so it is the one route by which the app could reach the logic. `app` cannot
   * import `core` directly — that is probed by the architecture as a whole — but nothing
   * stops `wallet` from importing it, and then the app reaches core THROUGH the package
   * added to respect the boundary. The rule that forbids it was added at the same time as
   * the package; this is what proves the rule is being read.
   */
  {
    file: 'wallet/src/__probe_boundary.ts',
    source: "import { decide } from '@insidor/core';\nexport const probe = decide;\n",
    expectRule: 'wallet-imports-only-contracts',
    why: 'the app must not be able to reach the logic through the wallet',
  },
];

function cruise(target) {
  try {
    return execFileSync(
      'pnpm',
      ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', target],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    /* A non-zero exit is the EXPECTED outcome here — violations were found. The report we
       need is on stdout either way. */
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

let failed = 0;

for (const probe of PROBES) {
  const abs = join(ROOT, probe.file);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, probe.source);
  try {
    const report = cruise(probe.file.split('/')[0]);
    /*
     * Either rule name is a pass, and which one fires depends on something incidental: whether
     * the offending package happens to be a declared dependency of the offender.
     *
     *   declared     → it resolves → the named boundary rule fires.
     *   not declared → it does not resolve → `no-unresolvable` fires.
     *
     * Both are a red build, which is the property being asserted. Requiring the named rule
     * specifically would fail this probe on the SAFER of the two arrangements — the one where
     * pnpm's layout already makes the import impossible — and the fix would be to add a real
     * dependency purely to satisfy a test. So: accept either, and print which, because the
     * distinction says something true about how the edge is being stopped.
     */
    const lines = report.split('\n').filter((l) => l.includes('__probe_boundary'));
    const byName = lines.some((l) => l.includes(probe.expectRule));
    const byResolve = lines.some((l) => l.includes('no-unresolvable'));
    if (byName || byResolve) {
      const how = byName ? probe.expectRule : 'no-unresolvable (package not declared — pnpm blocks it too)';
      console.log(`  ok    ${how}`);
      console.log(`        ${probe.why}`);
    } else {
      failed += 1;
      console.error(`  BLIND ${probe.expectRule} — ${probe.why}`);
      console.error(`        wrote a violation to ${probe.file} and the checker did not report it.`);
    }
  } finally {
    /* Always remove it. A probe file left behind is a real forbidden import sitting in the
       tree, and the next run would be measuring its own litter. */
    rmSync(abs, { force: true });
  }
}

if (failed > 0) {
  console.error(
    `\n${failed} boundary rule(s) did not fire on a deliberate violation.\n` +
      `The boundary check is not reading the imports it claims to police, so its green tick\n` +
      `means nothing. Usual cause: a resolver change in .dependency-cruiser.cjs — see the\n` +
      `enhancedResolveOptions block and preserveSymlinks there.`,
  );
  process.exit(1);
}

console.log(`\n${PROBES.length} boundary rules fire on a deliberate violation.`);
