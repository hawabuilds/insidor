/**
 * The curve account, decoded from bytes laid out as the chain holds them (a live curve's values,
 * recorded 2026-10-12): believed only when the launchpad's program owns it and it carries the
 * curve marker; progress measured as tokens sold.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { INITIAL_REAL_TOKEN_UNITS, PROGRAM_ID, curveProgressOf, readCurveAccount } from './curve-account.ts';

function account(fields: { vToken: bigint; vSol: bigint; rToken: bigint; rSol: bigint; complete: boolean }): Uint8Array {
  const b = new Uint8Array(166);
  b.set([0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60], 0);
  const v = new DataView(b.buffer);
  [fields.vToken, fields.vSol, fields.rToken, fields.rSol, 1_000_000_000_000_000n].forEach((n, i) => v.setBigUint64(8 + i * 8, n, true));
  b[48] = fields.complete ? 1 : 0;
  return b;
}

const LIVE = { vToken: 899_902_613_359_807n, vSol: 35_770_544_630n, rToken: 620_002_613_359_807n, rSol: 5_770_544_630n, complete: false };

test('★ a live curve: its reserves, and progress as tokens sold out of 793.1M', () => {
  const curve = readCurveAccount(account(LIVE), PROGRAM_ID);
  assert.equal(curve?.realSolLamports, 5_770_544_630n);
  assert.equal(curve?.virtualTokenUnits !== undefined && curve.virtualTokenUnits - curve.realTokenUnits, 279_900_000_000_000n, 'the account checks itself: 1,073M virtual less 793.1M for sale');
  assert.equal(Math.round((curve === null ? 0 : curveProgressOf(curve)) * 1000) / 10, 21.8);
  assert.equal(curveProgressOf({ ...curve!, complete: true }), 1);
  assert.equal(curveProgressOf({ ...curve!, realTokenUnits: INITIAL_REAL_TOKEN_UNITS }), 0);
});

test('★ an account the launchpad does not own, or without the curve marker, is not a curve', () => {
  assert.equal(readCurveAccount(account(LIVE), 'SomeOtherProgram1111111111111111111111111111'), null);
  const wrong = account(LIVE);
  wrong[0] = 0;
  assert.equal(readCurveAccount(wrong, PROGRAM_ID), null);
  assert.equal(readCurveAccount(new Uint8Array(20), PROGRAM_ID), null);
});

test('the account is asked for by address and decoded; an address with nothing there is null', async () => {
  const { chainClient } = await import('./client.ts');
  const replies = [
    { jsonrpc: '2.0', id: 1, result: { value: { owner: PROGRAM_ID, data: [Buffer.from(account(LIVE)).toString('base64'), 'base64'] } } },
    { jsonrpc: '2.0', id: 1, result: { value: null } },
  ];
  const fetch = (async () => new Response(JSON.stringify(replies.shift()), { status: 200 })) as unknown as typeof globalThis.fetch;
  const chain = chainClient({ launchpadBaseUrl: '', rpcUrl: 'https://rpc.invalid', fetch });
  assert.equal((await chain.curveAccount('Curve1'))?.realTokenUnits, LIVE.rToken);
  assert.equal(await chain.curveAccount('Nothing1'), null);
});
