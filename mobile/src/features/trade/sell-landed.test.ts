import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SellCard } from '../../shared/api/index.ts';
import { ASK_EVERY_MS, ASK_FOR_MS, sellLanded } from './sell-landed.ts';

const READ: SellCard = {
  kind: 'read',
  mint: 'M',
  ticker: 'KURIBO',
  name: null,
  boughtCapUsd: { v: 1, why: null },
  soldCapUsd: { v: 1, why: null },
  multiple: { v: 1, why: null },
  profitSol: { v: 0, why: null },
  post: null,
};

/** A clock that moves only when the loop waits, and the answers given in turn. */
function run(answers: readonly (SellCard | Error)[], signal = new AbortController().signal) {
  let clock = 0;
  let asked = 0;
  const result = sellLanded('sig', {
    ask: async () => {
      const a = answers[Math.min(asked++, answers.length - 1)] as SellCard | Error;
      if (a instanceof Error) throw a;
      return a;
    },
    wait: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    signal,
  });
  return { result, asked: () => asked };
}

test('★ a sell that lands opens the card: pending is asked again until it is read', async () => {
  const r = run([{ kind: 'pending' }, { kind: 'pending' }, READ]);
  assert.equal(await r.result, true);
  assert.equal(r.asked(), 3);
});

test('★ a failed or unknown sell never opens the card', async () => {
  assert.equal(await run([{ kind: 'pending' }, { kind: 'none' }]).result, false);
});

test('★ a sell never seen landing in time opens nothing', async () => {
  const r = run([{ kind: 'pending' }]);
  assert.equal(await r.result, false);
  assert.equal(r.asked(), Math.ceil(ASK_FOR_MS / ASK_EVERY_MS) + 1);
});

test('a dropped request is asked again, not taken as a failed sell', async () => {
  assert.equal(await run([new Error('offline'), READ]).result, true);
});

test('a wait abandoned (the ticket closed) answers false and asks nothing', async () => {
  const ac = new AbortController();
  ac.abort();
  const r = run([READ], ac.signal);
  assert.equal(await r.result, false);
  assert.equal(r.asked(), 0);
});
