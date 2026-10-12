/**
 * ★ NO PRIVATE KEY EVER REACHES OUR CODE OR OUR LOGS — checked on the source, not trusted.
 *
 * The export goes through the vendor's own window (EmbeddedWallet.tsx), which draws the key in a
 * frame on the vendor's domain. Import is the one place a key passes through our code: the box in
 * KeyImport.tsx, read once by key-import.ts and handed to the vendor's SDK. This test reads every
 * source file of the packages a key could pass through and fails on any sign of a key anywhere
 * else — and holds those two files to having no way out: no request, no log, no storage, no
 * React state. If a feature ever needs more, this is where the decision becomes visible.
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
const FORBIDDEN = [/\buseImportWallet\b/, /\bimportWallet\b/, /\bprivateKey\b/, /\bsecretKey\b/, /\bfromSecretKey\b/, /\bKeypair\.fromSeed\b/, /\buseGetWalletPrivateKey\b/];
/** The two files the import passes through, held to their own rule below. */
const IMPORT_FILES = ['wallet-embedded/src/key-import.ts', 'wallet-embedded/src/KeyImport.tsx'];

test('★ no source file outside the import box takes a private key in, reads one, or calls the vendor\'s import', () => {
  for (const tree of TREES) {
    for (const file of sources(join(ROOT, tree))) {
      if (IMPORT_FILES.includes(relative(ROOT, file))) continue;
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

test('★ the import box has no way out: no request, no log, no storage, no state holding the key, no autofill', () => {
  for (const f of IMPORT_FILES) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    for (const out of [/\bfetch\(/, /console\./, /localStorage|sessionStorage|indexedDB/, /postMessage|sendBeacon|XMLHttpRequest|WebSocket/, /\bJSON\.stringify\(/]) {
      assert.ok(!out.test(text), `${f} matches ${out}`);
    }
  }
  const box = readFileSync(join(ROOT, 'wallet-embedded/src/KeyImport.tsx'), 'utf8');
  assert.ok(!/\bvalue=\{/.test(box), 'the field is uncontrolled: the key is never React state');
  assert.match(box, /type="password"/);
  assert.match(box, /autoComplete="off"/);
  assert.ok(!/useState<string>/.test(box), 'no string state in the box');
  const run = readFileSync(join(ROOT, 'wallet-embedded/src/key-import.ts'), 'utf8');
  assert.match(run, /field\.value = '';/, 'the box is emptied as the key is read');
});

test('★ the trade, read, social and alert services never see a key field in a request', () => {
  for (const tree of ['services/trade/src', 'services/read/src', 'services/social/src', 'services/notify/src']) {
    for (const file of sources(join(ROOT, tree))) {
      /* The server's own push-signing key (VAPID) is not a wallet's; its lines are the one exception. */
      const lines = readFileSync(file, 'utf8').split('\n').filter((l) => !/vapid/i.test(l));
      assert.ok(!lines.some((l) => /privateKey|secretKey|seedPhrase|mnemonic/i.test(l)), `${relative(ROOT, file)} names a wallet key`);
    }
  }
});
