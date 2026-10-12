/**
 * Reading a simulation: "it would land", or why not, in words the order sheet shows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { UNFUNDED_BUY } from './__fixtures__/simulation.ts';
import { describeSimulationFailure, readSimulation } from './client.ts';

test('★ a recorded failure: an unfunded wallet is told to fund it, and nothing passes', () => {
  assert.deepEqual(readSimulation(UNFUNDED_BUY), { ok: false, message: 'This wallet has no SOL yet. Fund it and try again.', logs: [] });
});

test('no error is a pass', () => {
  assert.deepEqual(readSimulation({ jsonrpc: '2.0', id: 1, result: { value: { err: null, logs: ['Program log: ok'] } } }), { ok: true });
});

test('the common failures are said by name; anything else shows the program\'s own last lines', () => {
  assert.match(describeSimulationFailure({ InstructionError: [2, { Custom: 6002 }] }, ['Program log: slippage: Too much SOL required to buy the given amount of tokens.']), /slippage/);
  assert.match(describeSimulationFailure({}, ['Transfer: insufficient lamports 100, need 200']), /Not enough SOL/);
  assert.equal(describeSimulationFailure({}, ['a', 'Program X failed: custom program error: 0x99']), 'Program X failed: custom program error: 0x99');
});
