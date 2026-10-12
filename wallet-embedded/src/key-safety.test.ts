/**
 * ★ NO PRIVATE KEY EVER REACHES OUR CODE OR OUR LOGS — checked on the source, not trusted.
 *
 * The export goes through the vendor's own window (EmbeddedWallet.tsx), which draws the key in a
 * frame on the vendor's domain. This test reads every source file of the three packages a key
 * could pass through — this one, the phone app, the trade service — and fails on any sign that
 * one of them takes a key in, reads one, or names the vendor's import call. If a feature ever
 * needs one of these, this is where the decision becomes visible, in a review.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TREES = ['wallet-embedded/src', 'wallet/src', 'mobile/src', 'app/src', 'services/trade/src'];
const SKIP = new Set(['node_modules', 'dist']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : [];
  });
}

/** What taking a key in looks like: the vendor's import call, a key field, a secret-key constructor. */
const FORBIDDEN = [/\buseImportWallet\b/, /\bimportWallet\b/, /\bprivateKey\b/, /\bsecretKey\b/, /\bfromSecretKey\b/, /\bKeypair\.fromSeed\b/];

test('★ no source file takes a private key in, reads one, or calls the vendor\'s import', () => {
  for (const tree of TREES) {
    for (const file of sources(join(ROOT, tree))) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        assert.ok(!pattern.test(text), `${relative(ROOT, file)} matches ${pattern} — a key would be in our code`);
      }
    }
  }
});

test('★ the export is the vendor\'s window, given only the address, and its answer is dropped', () => {
  const file = readFileSync(join(ROOT, 'wallet-embedded/src/EmbeddedWallet.tsx'), 'utf8');
  assert.match(file, /exportWallet\(\{ address \}\)/, 'the vendor\'s export window, for this address and nothing else');
  assert.ok(!/console\.|log\(/.test(file), 'nothing in the vendor bridge logs');
  const store = readFileSync(join(ROOT, 'wallet-embedded/src/store.ts'), 'utf8');
  assert.match(store, /await act\.showExport\(\);\s*return 'shown';/, 'whatever the window resolves with is not kept');
});
