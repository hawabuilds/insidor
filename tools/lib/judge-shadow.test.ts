/** The shadow report's arithmetic: each side by its judge id (not live or shadow), each held to its own model's cutoff, unanswered rows out of the agreement, disagreements newest first. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import { answerPolicies } from '../../services/project/src/judge-cutoff.ts';
import { summarise, type ShadowRow, type Side } from './judge-shadow.ts';

const MAIN = 'judge:anthropic/claude-haiku-4-5@a';
const OPEN = 'judge:openrouter/google/gemma-3-27b-it@a';
const side = (judgeId: string, coinable: boolean, confidence: number): Side => ({ judgeId, coinable, confidence, lookedAt: 'text', name: 'CAT', costUsd: judgeId === MAIN ? 0.0012 : 0.0002, sPerPost: judgeId === MAIN ? 0.7 : 2.8 });
const row = (n: number, live: Side, shadow: Side | null): ShadowRow => ({ itemId: `x:${n}`, askedAt: new Date(n * 1000), text: `post ${n}`, link: `https://x.com/i/status/${n}`, live, shadow, shadowCostUsd: shadow?.costUsd ?? 0, detail: shadow === null ? 'answered 500' : null });

test('agreement, the table, cost and speed, and the examples each way', () => {
  const policies = answerPolicies({ ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, cutoffs: { primary: 0.7, fallback: 0.85 } } }, { cutoff: 0.71, chosenOn: null });
  const rows = [
    row(1, side(MAIN, true, 0.9), side(OPEN, true, 0.9)),
    /* The open model says yes at 0.8, under its own 0.85: a no. */
    row(2, side(MAIN, true, 0.8), side(OPEN, true, 0.8)),
    /* After the switch the live side is the open model; it is still the open side. */
    row(3, side(OPEN, true, 0.9), side(MAIN, false, 0.9)),
    row(4, side(MAIN, false, 0.9), null),
  ];
  const s = summarise(rows, policies, 10);
  assert.equal(s.pairs, 3);
  assert.equal(s.unanswered, 1);
  assert.deepEqual(s.table, { bothYes: 1, mainYesOpenNo: 1, mainNoOpenYes: 1, bothNo: 0 });
  assert.equal(s.agree, 1);
  assert.equal(s.coinableAgree, 2);
  assert.equal(s.mainYesOpenNo[0]?.row.itemId, 'x:2');
  assert.equal(s.mainNoOpenYes[0]?.row.itemId, 'x:3');
  assert.equal(s.main.answers, 4);
  assert.equal(s.open.answers, 3);
  assert.equal(s.open.medianSPerPost, 2.8);
});
