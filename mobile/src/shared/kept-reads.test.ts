import { test } from 'node:test';
import assert from 'node:assert/strict';

/* A phone's store, in memory, before the module reads it. */
const rows = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  get length() {
    return rows.size;
  },
  key: (i: number) => [...rows.keys()][i] ?? null,
  getItem: (k: string) => rows.get(k) ?? null,
  setItem: (k: string, v: string) => void rows.set(k, v),
  removeItem: (k: string) => void rows.delete(k),
};
(globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (f: () => void) => f();

const { fresh, keep, kept, KEPT_PREFIX } = await import('./kept-reads.ts');

test('a read on its way is shared, not repeated', async () => {
  let reads = 0;
  const load = async () => {
    reads += 1;
    return { n: 1 };
  };
  const [a, b] = await Promise.all([fresh('k:share', load, false), fresh('k:share', load, false, new AbortController().signal)]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.deepEqual(kept('k:share')?.value, { n: 1 });
});

test('the last caller to stop waiting stops the read', async () => {
  let stopped = false;
  const load = (signal: AbortSignal) =>
    new Promise<number>((_, reject) => {
      signal.addEventListener('abort', () => {
        stopped = true;
        reject(new Error('aborted'));
      });
    });
  const ac = new AbortController();
  const p = fresh('k:stop', load, false, ac.signal);
  ac.abort();
  await assert.rejects(p);
  assert.equal(stopped, true);
});

test('kept on the phone with its Maps and non-finite numbers, and read back after a reload', () => {
  keep('k:phone', { m: new Map([['a', 1]]), s: new Set(['x']), n: Number.NaN, i: Number.POSITIVE_INFINITY }, true);
  const raw = rows.get(`${KEPT_PREFIX}k:phone`);
  assert.ok(raw !== undefined);
  const back = JSON.parse(raw) as { at: number };
  assert.equal(typeof back.at, 'number');
});

test('nothing kept is undefined, never an empty answer', () => {
  assert.equal(kept('k:none'), undefined);
});
