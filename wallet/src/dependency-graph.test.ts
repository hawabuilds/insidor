/**
 * ★ THE APP COMPILES WITH NO WALLET VENDOR SDK IN ITS DEPENDENCY GRAPH.
 *
 * This is the assertion that keeps the boundary honest at the level that actually ships. The
 * architecture rule in `.dependency-cruiser.cjs` says which WORKSPACE packages may reach
 * which; it says nothing about what any of them may install. A single `pnpm add` inside this
 * package would put a chain client, a transaction builder and — sooner or later — an
 * endpoint carrying an authentication token into the browser bundle, and every existing
 * check would stay green while it happened.
 *
 * So this test reads the manifests and the imports rather than the architecture:
 *
 *   1. ★ THIS PACKAGE DEPENDS ON THE VOCABULARY AND NOTHING ELSE. Exactly one entry, no dev
 *      dependencies. The moment that list grows, this fails and somebody has to justify it
 *      in a review rather than in a lockfile diff.
 *
 *   2. ★ THE APP'S OWN DEPENDENCIES ARE STILL THE FOUR IT HAD. Gaining a wallet added two
 *      workspace links and no third-party package at all — which is possible because a
 *      browser extension publishes a plain object on the page and talking to it needs no
 *      library. If a wallet SDK is ever genuinely needed, this test is where the decision
 *      becomes visible.
 *
 *   3. ★ NO FILE IN EITHER PACKAGE IMPORTS ANYTHING OUTSIDE A SHORT ALLOWLIST. The manifests
 *      are what a package DECLARES; this is what its code actually reaches for, and the two
 *      can differ — a transitive package is importable without being declared. This is the
 *      assertion that would catch it.
 *
 *   4. ★ AND NO SPECIFIER ANYWHERE MATCHES A KNOWN WALLET OR CHAIN LIBRARY. Belt and braces,
 *      and it exists because the allowlist above is a list of what we expect: this one is a
 *      list of what we are afraid of, and the two fail differently.
 *
 * It lives in this package rather than in the app because this is the package that would
 * grow the dependency. It reads the app's files because the app is where the bundle is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Package-name fragments that mean a wallet, a chain client or a transaction builder.
 *
 * Matched as substrings of a specifier, so a scoped package and a re-publish under a new
 * name are both caught. Every one of them is banned from a browser bundle on this path for
 * the same reason: if the app can build or send a transaction, a bug in a render path is a
 * bug in a money path.
 */
const FORBIDDEN_FRAGMENTS = [
  'wallet-adapter', 'walletconnect', 'wallet-standard', 'privy', 'dynamic-labs', 'magic-sdk',
  'web3', 'ethers', 'viem', 'wagmi', 'rainbowkit', 'thirdweb', 'reown', 'appkit',
  'solana', 'anchor', 'metaplex', 'helius', 'bs58', 'tweetnacl', 'ed25519',
];

/** Everything either package is permitted to reach for by name. */
const ALLOWED_SPECIFIERS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@insidor/wallet',
];

const isAllowed = (specifier: string): boolean =>
  specifier.startsWith('node:') ||
  specifier.startsWith('@insidor/contracts') ||
  ALLOWED_SPECIFIERS.includes(specifier);

/** Never this repository's source, by the same list the `tools/` walk keeps. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);

/**
 * ★ THE ONE NAME ANOTHER TOOL PUTS IN THESE TREES AND TAKES BACK OUT AGAIN.
 *
 * `tools/check-boundaries-probe.mjs` proves the boundary checker is not blind the only way that
 * works: it writes a deliberate violation — `wallet/src/__probe_boundary.ts`, importing
 * `@insidor/core` — cruises it, requires the violation to be reported, and deletes it. That file
 * is on disk for about six hundred milliseconds of every `pnpm check`.
 *
 * A walk that reads whatever is in the directory at that instant reads it, and this test then
 * fails naming an import nobody wrote: another checker's scaffolding, reported as the wallet's
 * dependency. Within one `pnpm check` the two phases are sequenced by `&&` and cannot overlap,
 * but nothing makes them mutually exclusive across processes — a second run of the toolchain in
 * the same tree, or a `pnpm test` started while a check is in its boundary phase, puts that
 * window inside this walk. It was seen once in three runs, which is the worst rate a check can
 * have: often enough to be noticed, rare enough to be re-run rather than believed.
 *
 * So the walk reads the source and not the disk. `__probe` is scaffolding by the same convention
 * that makes `__fixtures__` scaffolding, and nothing a person writes is named this.
 *
 * ★ NOTHING ELSE MAY BE ADDED HERE. This is the one name in the repository that appears and
 * disappears on its own. Every other file under these trees is somebody's, and a file this walk
 * skips is a file this check does not read — so an exclusion list that grows is this check going
 * quietly blind, which is exactly the failure the probe above exists to catch elsewhere.
 */
const isScaffolding = (name: string): boolean => name.startsWith('__probe');

/**
 * Every .ts/.tsx file under `dir`, in a fixed order.
 *
 * One `readdirSync(…, { withFileTypes: true })` rather than a `statSync` per entry, because the
 * separate stat is the same race a second time: an entry listed and then removed before it is
 * stat'd throws ENOENT, and the test dies with a filesystem error instead of an assertion — the
 * same flake wearing a different hat. Sorted with a plain comparison rather than `localeCompare`,
 * which is ICU-dependent: two runs that disagree about the order of the tree cannot be compared.
 */
function sourcesUnder(dir: string, into: string[] = []): readonly string[] {
  const entries = [...readdirSync(dir, { withFileTypes: true })];
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith('.') || SKIP_DIRS.has(name) || isScaffolding(name)) continue;
    const full = join(dir, name);
    if (entry.isDirectory()) sourcesUnder(full, into);
    else if (/\.(ts|tsx)$/.test(name)) into.push(full);
  }
  return into;
}

/**
 * Both trees, each required to be there on its own.
 *
 * One count across the pair cannot tell a walk that read both packages from a walk that read the
 * app and silently missed the wallet: eighty-three app files clear any floor ten wallet files
 * could set. So each tree is floored separately, and either one going quiet fails here rather
 * than passing as a green tick over half the code the check claims to have read.
 */
function walkedSources(): readonly string[] {
  const wallet = sourcesUnder(join(ROOT, 'wallet', 'src'));
  const app = sourcesUnder(join(ROOT, 'app', 'src'));
  assert.ok(wallet.length >= 5, `the walk found ${wallet.length} files in wallet/src and must be reading the package`);
  assert.ok(app.length >= 35, `the walk found ${app.length} files in app/src and must be reading the package`);
  return [...wallet, ...app];
}

/**
 * Comments removed before the imports are read.
 *
 * Not fastidiousness: this repository's headers are long and argumentative, and one of them
 * contains the phrase `from "we asked and could not get an answer"`. Without this the test
 * reported that a file imports a sentence, which is the kind of false positive that gets a
 * check deleted rather than fixed. The `[^:]` guard keeps `https://` inside a comment from
 * being read as the start of a line comment.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/** Every bare (non-relative) specifier a file names, static or dynamic. */
function bareImports(source: string): readonly string[] {
  const text = stripComments(source);
  const out: string[] = [];
  /* Anchored to the start of a statement rather than matching a bare `from '…'` anywhere.
     A loose match read every `test('… from "x" …')` title in the app as an import — the
     second false positive this walk produced, and the reason the patterns below insist the
     line begins with `import` or `export`. The `[^;`]` middle keeps a multi-line import list
     matchable while stopping the scan running past the end of the statement. */
  const patterns = [
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /^\s*(?:import|export)\s[^;`]*?\sfrom\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1] ?? '';
      if (specifier !== '' && !specifier.startsWith('.') && !specifier.startsWith('/')) {
        out.push(specifier);
      }
    }
  }
  return out;
}

const manifest = (pkg: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(ROOT, pkg, 'package.json'), 'utf8')) as never;

test('★ 1 — the wallet adapter depends on the vocabulary and on nothing else', () => {
  const pkg = manifest('wallet');
  assert.deepEqual(
    Object.keys(pkg.dependencies ?? {}),
    ['@insidor/contracts'],
    'a second dependency here is a second thing in the browser bundle, on the one path ' +
      'where a bug costs a person money',
  );
  assert.equal(
    pkg.devDependencies,
    undefined,
    'the tests run on node:test, which is a builtin — there is nothing to add',
  );
});

test('★ 2 — gaining a wallet added no third-party package to the app', () => {
  const pkg = manifest('app');
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), [
    '@insidor/contracts',
    '@insidor/wallet',
    'react',
    'react-dom',
  ]);
});

test('★ 3 — no file in either package imports anything outside the allowlist', () => {
  for (const file of walkedSources()) {
    for (const specifier of bareImports(readFileSync(file, 'utf8'))) {
      assert.ok(
        isAllowed(specifier),
        `${relative(ROOT, file)} imports "${specifier}", which is not on the allowlist in ` +
          `this test. If it is genuinely needed, add it here — deliberately, in a review.`,
      );
    }
  }
});

test('★ 4 — and nothing anywhere names a wallet, chain or signing library', () => {
  const declared = [
    ...Object.keys(manifest('wallet').dependencies ?? {}),
    ...Object.keys(manifest('wallet').devDependencies ?? {}),
    ...Object.keys(manifest('app').dependencies ?? {}),
    ...Object.keys(manifest('app').devDependencies ?? {}),
  ];
  const imported = walkedSources().flatMap((file) => bareImports(readFileSync(file, 'utf8')));

  for (const specifier of [...declared, ...imported]) {
    for (const fragment of FORBIDDEN_FRAGMENTS) {
      assert.ok(
        !specifier.toLowerCase().includes(fragment),
        `"${specifier}" matches "${fragment}". A library that can build or send a ` +
          `transaction must not be reachable from the browser bundle: submission, ` +
          `confirmation and idempotency belong to a service that survives a closed tab.`,
      );
    }
  }
});
