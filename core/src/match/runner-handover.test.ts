/**
 * The runner hand-over on the 24 Oct baldcat case: $CAT held @2161466034's cat post from 21:50 with
 * nothing traded in its hour, and baldcat — launched 00:48 linking the post — read $52,785 cap and
 * $529,549 traded at 02:01. It takes the pick only with BOTH bars (running, three times the hour),
 * only as a coin made for the post, and the old coin takes it back only by the same test.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { runnerHandover, type HandoverCoin, type HandoverHeld } from './runner-handover.ts';

const BARS = { minVolume1hUsd: DEFAULT_POLICY.notify.savedPost.minVolume1hUsd, minTrades1h: DEFAULT_POLICY.notify.savedPost.minTrades1h, minCapUsd: DEFAULT_POLICY.oneCoin.minCapUsd, ratio: DEFAULT_POLICY.oneCoin.handOverRatio };
const H = 3_600_000;
const CAT: HandoverHeld = { address: 'CAT', launchedAtMs: 0, hour: { volume1hUsd: 0, trades1h: 0, capUsd: 36_009 }, handedFrom: null };
const BALDCAT: HandoverCoin = { address: 'BALDCAT', launchedAtMs: 3 * H, ties: ['link', 'picture'], hour: { volume1hUsd: 529_549, trades1h: 11_011, capUsd: 52_785 } };

test('★ a later coin made for the post that runs at three times the held hour takes the pick', () => {
  assert.deepEqual(runnerHandover(CAT, [BALDCAT], BARS), { kind: 'hand_over', to: 'BALDCAT', from: 'CAT', toHour: BALDCAT.hour, fromHour: CAT.hour });
  const stated = { ...BALDCAT, ties: ['name_stated'] as const };
  assert.equal(runnerHandover(CAT, [stated], BARS).kind, 'hand_over', 'the whole stated name ties as the link does');
});

test('★ one bar alone is not enough', () => {
  const busyHeld = { ...CAT, hour: { volume1hUsd: 200_000, trades1h: 4_000, capUsd: 300_000 } };
  assert.deepEqual(runnerHandover(busyHeld, [BALDCAT], BARS), { kind: 'keep', reason: 'under_ratio' }, 'running, but not three times the held coin');
  const quiet = { ...BALDCAT, hour: { volume1hUsd: BARS.minVolume1hUsd - 1, trades1h: 500, capUsd: 52_785 } };
  assert.deepEqual(runnerHandover(CAT, [quiet], BARS), { kind: 'keep', reason: 'no_runner' }, 'three times a dead coin, but under the dollar bar');
  const fewTrades = { ...BALDCAT, hour: { volume1hUsd: 50_000, trades1h: BARS.minTrades1h - 1, capUsd: 52_785 } };
  assert.equal(runnerHandover(CAT, [fewTrades], BARS).kind, 'keep', 'a few large fills are not a market');
  const churned = { ...BALDCAT, hour: { volume1hUsd: 72_934, trades1h: 1_794, capUsd: 3_025 } };
  assert.equal(runnerHandover(CAT, [churned], BARS).kind, 'keep', 'a $3K coin churned past the dollar bar is not running (24 Oct, $CHUNGUS)');
});

test('only a coin made for the post, launched after the held one', () => {
  assert.equal(runnerHandover(CAT, [{ ...BALDCAT, ties: ['name_judge', 'picture'] }], BARS).kind, 'keep', 'a shared name is the copycat problem, not its fix');
  assert.equal(runnerHandover(CAT, [{ ...BALDCAT, launchedAtMs: -H }], BARS).kind, 'keep', 'an earlier coin is not a later runner');
  assert.equal(runnerHandover(CAT, [{ ...BALDCAT, launchedAtMs: null }], BARS).kind, 'keep', 'an unknown launch cannot be said to be later');
  assert.deepEqual(runnerHandover({ ...CAT, launchedAtMs: null }, [BALDCAT], BARS), { kind: 'keep', reason: 'held_undated' });
});

test('★ an unread hour is not a quiet one', () => {
  assert.deepEqual(runnerHandover({ ...CAT, hour: null }, [BALDCAT], BARS), { kind: 'keep', reason: 'held_unread' });
  assert.equal(runnerHandover(CAT, [{ ...BALDCAT, hour: null }], BARS).kind, 'keep', 'a rival with no hour is not running');
});

test('★ no ping-pong: the old coin takes it back only by the same test against the new one', () => {
  const now: HandoverHeld = { address: 'BALDCAT', launchedAtMs: 3 * H, hour: BALDCAT.hour, handedFrom: 'CAT' };
  const catAgain: HandoverCoin = { address: 'CAT', launchedAtMs: 0, ties: ['link'], hour: { volume1hUsd: 1_000_000, trades1h: 9_000, capUsd: 400_000 } };
  assert.deepEqual(runnerHandover(now, [catAgain], BARS), { kind: 'keep', reason: 'under_ratio' }, 'the old coin running hard is not enough: three times the new one');
  const catRuns = { ...catAgain, hour: { volume1hUsd: 1_600_000, trades1h: 20_000, capUsd: 900_000 } };
  assert.equal(runnerHandover(now, [catRuns], BARS).kind, 'hand_over', 'and at three times it, it may');
  const other: HandoverCoin = { ...catRuns, address: 'OLDER', launchedAtMs: H };
  assert.equal(runnerHandover(now, [other], BARS).kind, 'keep', 'any other earlier coin never may');
});

test('two runners at once: the busier hour', () => {
  const second = { ...BALDCAT, address: 'AAA', hour: { volume1hUsd: 100_000, trades1h: 2_000, capUsd: 60_000 } };
  const r = runnerHandover(CAT, [second, BALDCAT], BARS);
  assert.equal(r.kind === 'hand_over' ? r.to : null, 'BALDCAT');
});
