/**
 * Reading a simulation: "it would land", or why not, in words the order sheet shows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { UNFUNDED_BUY } from './__fixtures__/simulation.ts';
import { describeSimulationFailure, readSimulation, readTokenBalance, UNKNOWN_FAILURE } from './client.ts';

test('★ a recorded failure: an unfunded wallet is told to fund it, and nothing passes', () => {
  assert.deepEqual(readSimulation(UNFUNDED_BUY), { ok: false, message: 'This wallet has no SOL yet. Fund it and try again.', logs: [] });
});

test('no error is a pass', () => {
  assert.deepEqual(readSimulation({ jsonrpc: '2.0', id: 1, result: { value: { err: null, logs: ['Program log: ok'] } } }), { ok: true });
});

test('the common failures are said by name; anything else is said plainly, never in the program\'s words', () => {
  assert.match(describeSimulationFailure({ InstructionError: [2, { Custom: 6002 }] }, ['Program log: slippage: Too much SOL required to buy the given amount of tokens.']), /slippage/);
  assert.match(describeSimulationFailure({}, ['Transfer: insufficient lamports 100, need 200']), /Not enough SOL/);
  assert.match(describeSimulationFailure({ InstructionError: [3, { Custom: 6001 }] }, ['Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1771']), /slippage/, "the aggregator's own slippage miss");
  assert.equal(describeSimulationFailure({}, ['a', 'Program X failed: custom program error: 0x99']), UNKNOWN_FAILURE);
});

test('★ the owner\'s Buy on a stock-pair curve: plain words, no Anchor error, no program address', () => {
  /* The lines the order sheet showed on 23 Oct 2026, buying 2Nyb…pump (curve priced in TTWo…bKo). */
  const logs = [
    'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
    'Program log: Instruction: Buy',
    'Program log: AnchorError caused by account: bonding_curve. Error Code: UnsupportedQuoteMint. Error Number: 6063. Error Message: Unsupported quote mint.',
    'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P failed: custom program error: 0x17af',
  ];
  const said = describeSimulationFailure({ InstructionError: [2, { Custom: 6063 }] }, logs);
  assert.equal(said, "This coin can't be bought here yet.");
  assert.doesNotMatch(said, /Anchor|Program|0x|6EF8/);
});

test('an error number inside a base64 data line is not read as that error', () => {
  /* "6001" by chance inside an event's bytes: not a slippage miss. */
  assert.equal(describeSimulationFailure({}, ['Program data: vdt/6001AAAA', 'Program return: X 6001', 'Program Y failed: custom program error: 0x99']), UNKNOWN_FAILURE);
});

test('a balance is the sum of the wallet\'s accounts for the coin; none held is zero', () => {
  const account = (amount: string) => ({ pubkey: 'A', account: { data: { parsed: { info: { tokenAmount: { amount, decimals: 6, uiAmountString: '0' } } } } } });
  assert.deepEqual(readTokenBalance({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: [account('1500000'), account('500000')] } }), { amount: '2000000', decimals: 6 });
  assert.deepEqual(readTokenBalance({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: [] } }), { amount: '0', decimals: 0 });
});
