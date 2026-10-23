/** A tap's trail from the phone is logged as short plain values only (tap-diag.ts). */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { tapRows } from './tap-diag.ts';

test('★ the rows the phone sends are kept as they came, in order', () => {
  const rows = [
    { at: 1, by: 'sw', step: 'click', url: '/#/token/solana%3AAbc' },
    { at: 2, by: 'page', step: 'boot', hash: '#/', standalone: true },
  ];
  assert.deepEqual(tapRows({ rows }), rows);
});

test('★ only short plain values pass: objects, odd keys and long text are dropped or cut', () => {
  const [row] = tapRows({ rows: [{ step: 'x'.repeat(500), nested: { a: 1 }, 'bad key': 'v', n: Number.NaN, ok: false }] });
  assert.equal(row?.['step'], 'x'.repeat(160));
  assert.deepEqual(Object.keys(row ?? {}), ['step', 'ok']);
});

test('a body that is not a trail logs nothing, and a long trail only its newest rows', () => {
  assert.deepEqual(tapRows(null), []);
  assert.deepEqual(tapRows({ rows: 'no' }), []);
  assert.deepEqual(tapRows({ rows: [null, 3, [], {}] }), []);
  const many = Array.from({ length: 100 }, (_, i) => ({ at: i }));
  const kept = tapRows({ rows: many });
  assert.equal(kept.length, 60);
  assert.equal(kept[0]?.['at'], 40);
});
