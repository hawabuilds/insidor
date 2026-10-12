/**
 * ★ AN IMPORTED KEY GOES ONLY TO THE PROVIDER'S SDK: not to a request to our servers, not to a
 * log, not to an error report, not back to the caller — and the box is empty afterwards.
 */

import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import { runKeyImport } from './key-import.ts';

const KEY = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKiWzS2Jm5mnYoNmdRvVzjL8bZZbM5oWrwwdtkC5i4FbwpEf';

/* Everything that could carry the key out, watched while an import runs. */
const seen: string[] = [];
const original = { fetch: globalThis.fetch, log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
function watch() {
  seen.length = 0;
  globalThis.fetch = (async (...args: unknown[]) => {
    seen.push(`fetch ${JSON.stringify(args)}`);
    return new Response('{}');
  }) as typeof fetch;
  for (const k of ['log', 'error', 'warn', 'info', 'debug'] as const) console[k] = (...a: unknown[]) => void seen.push(`${k} ${a.map(String).join(' ')}`);
}
afterEach(() => {
  globalThis.fetch = original.fetch;
  Object.assign(console, { log: original.log, error: original.error, warn: original.warn, info: original.info, debug: original.debug });
});

test('★ the key reaches the SDK and nothing else, and the box is empty after the import', async () => {
  watch();
  const field = { value: `  ${KEY}\n` };
  const sdkGot: unknown[] = [];
  const outcome = await runKeyImport(field, async (input) => void sdkGot.push(input));
  assert.equal(outcome, 'imported');
  assert.deepEqual(sdkGot, [{ privateKey: KEY }], 'the SDK gets the key, trimmed, as its only argument');
  assert.equal(field.value, '', 'the box is empty');
  assert.ok(!seen.some((s) => s.includes(KEY)), 'no request and no log line carries it');
});

test('★ a failed import says "failed" and nothing of the error — an error about a key can quote the key', async () => {
  watch();
  const field = { value: KEY };
  const outcome = await runKeyImport(field, async () => {
    throw new Error(`invalid key ${KEY}`);
  });
  assert.equal(outcome, 'failed');
  assert.equal(field.value, '');
  assert.ok(!JSON.stringify(outcome).includes(KEY));
  assert.ok(!seen.some((s) => s.includes(KEY)));
});

test('an empty box imports nothing and calls nothing', async () => {
  let called = false;
  assert.equal(await runKeyImport({ value: '   ' }, async () => void (called = true)), 'empty');
  assert.equal(called, false);
});
