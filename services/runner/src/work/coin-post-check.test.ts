/** The coin-and-post check: asked once a pair inside the day's cap, never dry, a failure not stored; only a name-only "no" drops a coin. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { CoinPostCheckPort, SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { CandidateRow, CoinPostDue } from '@insidor/store';

import type { Logger } from '../log.ts';
import { coinPostCheckPass } from './coin-post-check.ts';
import { withoutRefused } from './one-coin.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const NOW = 1_800_000_000_000 as Millis;

const due = (n: number): CoinPostDue[] =>
  Array.from({ length: n }, (_, i) => ({ itemId: `x:${i}`, address: `coin${i}`, coinName: 'vanilla', coinTicker: 'VANILLA', coinDescription: null, coinPicture: 'https://c', linkedText: null, postText: 'Vanilla the dog', postPicture: 'https://p' }));

function setup(answers: readonly (SameSubjectAnswer | null | 'throw')[], askedToday = 0) {
  const recorded: { itemId: string; address: string; answer: SameSubjectAnswer | null }[] = [];
  let limitAsked = -1;
  let i = 0;
  const judge: CoinPostCheckPort = {
    id: 'judge:test',
    promptId: 'coin-post@test',
    async check() {
      const a = answers[i++];
      if (a === 'throw') throw new Error('host down');
      return { value: a ?? null, spend: { usd: 0.0002 } as never };
    },
  };
  const repo = {
    due: async (_since: Millis, limit: number) => {
      limitAsked = limit;
      return due(Math.min(limit, answers.length));
    },
    record: async (itemId: string, address: string, answer: SameSubjectAnswer | null) => {
      recorded.push({ itemId, address, answer });
    },
    countSince: async () => askedToday,
  };
  return { judge, repo, recorded, limit: () => limitAsked };
}

test('★ each due pair is asked and its answer stored, "no"s counted; null is stored as nothing learned', async () => {
  const s = setup(['no', 'yes', null]);
  const r = await coinPostCheckPass({ judge: s.judge, repo: s.repo, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => NOW });
  assert.deepEqual([r.asked, r.no], [3, 1]);
  assert.deepEqual(s.recorded.map((x) => x.answer), ['no', 'yes', null]);
});

test('a failed host is not stored, so the pair is asked again on a later pass', async () => {
  const s = setup(['throw', 'yes']);
  const r = await coinPostCheckPass({ judge: s.judge, repo: s.repo, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => NOW });
  assert.equal(r.asked, 1);
  assert.deepEqual(s.recorded.map((x) => x.address), ['coin1']);
});

test('the day\'s cap: a pass asks only what is left of it, and nothing once it is reached', async () => {
  const P = DEFAULT_POLICY.oneCoin.postCheck;
  const near = setup(['yes', 'yes', 'yes', 'yes', 'yes', 'yes'], P.perDay - 2);
  await coinPostCheckPass({ judge: near.judge, repo: near.repo, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => NOW });
  assert.equal(near.limit(), 2);
  const full = setup(['yes'], P.perDay);
  assert.equal((await coinPostCheckPass({ judge: full.judge, repo: full.repo, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => NOW })).asked, 0);
  assert.equal(full.limit(), -1, 'the due pairs are not even read');
});

test('a dry run, no judge or the switch off asks nothing', async () => {
  const s = setup(['no']);
  assert.equal((await coinPostCheckPass({ judge: s.judge, repo: s.repo, mode: 'dry', policy: DEFAULT_POLICY, log: quiet, now: () => NOW })).asked, 0);
  assert.equal((await coinPostCheckPass({ judge: null, repo: s.repo, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => NOW })).asked, 0);
  const off = { ...DEFAULT_POLICY, oneCoin: { ...DEFAULT_POLICY.oneCoin, postCheck: { ...DEFAULT_POLICY.oneCoin.postCheck, on: false } } };
  assert.equal((await coinPostCheckPass({ judge: s.judge, repo: s.repo, mode: 'live', policy: off, log: quiet, now: () => NOW })).asked, 0);
  assert.equal(s.recorded.length, 0);
});

const row = (address: string, ties: string[]): CandidateRow => ({ itemId: 'x:vanilla', address, path: 'launch', evidence: { ties }, launchedAtMs: NOW, foundAtMs: NOW });

test('★ a name-only candidate the judge said "no" to is dropped; one tied by a link or a picture stays, as does every other', async () => {
  const rows = [row('afp', ['name_judge']), row('linked', ['name_judge', 'link']), row('pictured', ['picture']), row('other', ['name_judge'])];
  const asked: string[] = [];
  const refused = async (pairs: readonly { itemId: string; address: string }[]) => {
    asked.push(...pairs.map((p) => p.address));
    return new Set(['x:vanilla|afp', 'x:vanilla|linked', 'x:vanilla|pictured']);
  };
  const kept = await withoutRefused({ refused, log: quiet }, rows);
  assert.deepEqual(kept.map((r) => r.address), ['linked', 'pictured', 'other']);
  assert.deepEqual(asked, ['afp', 'other'], 'only name-only ties are looked up');
});

test('the answers unreadable: every candidate is judged, as before the check', async () => {
  const rows = [row('afp', ['name_judge'])];
  const kept = await withoutRefused({ refused: async () => { throw new Error('db'); }, log: quiet }, rows);
  assert.equal(kept.length, 1);
});
