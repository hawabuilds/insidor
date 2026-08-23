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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

function sourcesUnder(dir: string, into: string[] = []): readonly string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourcesUnder(full, into);
    else if (/\.(ts|tsx)$/.test(name)) into.push(full);
  }
  return into;
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
  const files = [...sourcesUnder(join(ROOT, 'wallet', 'src')), ...sourcesUnder(join(ROOT, 'app', 'src'))];
  assert.ok(files.length > 40, 'the walk must actually be reading both packages');

  for (const file of files) {
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
  const imported = [
    ...sourcesUnder(join(ROOT, 'wallet', 'src')),
    ...sourcesUnder(join(ROOT, 'app', 'src')),
  ].flatMap((file) => bareImports(readFileSync(file, 'utf8')));

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
