/**
 * IMPORTING A WALLET BY ITS PRIVATE KEY — the one function in this repository a key passes
 * through, and the rules it keeps:
 *
 *   ★ FROM THE BOX STRAIGHT TO THE PROVIDER'S SDK. The key is read from the input element, the
 *     element is emptied in the same breath, and the key goes to the vendor's import call as its
 *     only argument. It is never sent to our servers, stored, logged, put in component or app
 *     state, analytics or an error report.
 *   ★ AN OUTCOME IS A WORD. Imported, failed or empty; the vendor's error is not kept, because
 *     an error about a key can quote the key.
 *
 * Pure (no React), so the rules are tested on their own (key-import.test.ts) — including that
 * nothing reaches `fetch` or the console while it runs.
 */

export type ImportOutcome = 'imported' | 'failed' | 'empty';

export async function runKeyImport(field: { value: string }, importWallet: (input: { privateKey: string }) => Promise<unknown>): Promise<ImportOutcome> {
  const privateKey = field.value.trim();
  field.value = '';
  if (privateKey === '') return 'empty';
  try {
    await importWallet({ privateKey });
    return 'imported';
  } catch {
    return 'failed';
  }
}
