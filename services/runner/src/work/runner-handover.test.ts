/**
 * The runner hand-over step over a fake store, on the 24 Oct baldcat case: the held $CAT pick goes to
 * baldcat once it runs at `switchRatio` times $CAT's hour — the evidence saying so — and not with one bar
 * alone, not over the owner's coin call, and not back again by the one-coin rule or the missed-runner
 * net: only by this rule's own test against the new coin.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { CoinHour } from '@insidor/core';
import type { CandidateRow, PickWrite, StoredPick } from '@insidor/store';

import type { Logger } from '../log.ts';
import { newOneCoinState, oneCoinPass, type OneCoinDeps } from './one-coin.ts';
import { RUNNER_HANDOVER, runnerHandoverPass, type RunnerHandoverDeps } from './runner-handover.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const MIN = 60_000;
const NOW = 10_000 * MIN;
const POST = 'x:2113665255088017698';

const cand = (address: string, launchedAtMs: number, ties: string[]): CandidateRow => ({ itemId: POST, address, path: 'launch', evidence: { ties }, launchedAtMs, foundAtMs: launchedAtMs });
const CANDS = [cand('CAT', NOW - 300 * MIN, ['link']), cand('BALDCAT', NOW - 73 * MIN, ['link', 'picture'])];
const catPick: StoredPick = { subjectId: POST, address: 'CAT', outcome: 'picked', decidedAtMs: NOW - 250 * MIN, evidence: { basis: 'trades' } };
const RUNNING: CoinHour = { volume1hUsd: 529_549, trades1h: 11_011, capUsd: 52_785 };
const DEAD: CoinHour = { volume1hUsd: 0, trades1h: 0, capUsd: 36_009 };

interface World {
  picks: Map<string, StoredPick>;
  hours: Map<string, CoinHour>;
  writes: PickWrite[];
  called: Set<string>;
}

const world = (hours: Record<string, CoinHour>, pick: StoredPick = catPick): World => ({ picks: new Map([[POST, pick]]), hours: new Map(Object.entries(hours)), writes: [], called: new Set() });

const deps = (w: World): RunnerHandoverDeps => ({
  heldPostPicks: async () => [...w.picks.values()].filter((p) => p.outcome === 'picked'),
  candidatesOf: async (ids) => CANDS.filter((c) => ids.includes(c.itemId)),
  lastHours: async (addresses) => new Map([...w.hours].filter(([a]) => addresses.includes(a))),
  ownerCalled: async (ids) => new Set(ids.filter((id) => w.called.has(id))),
  writePicks: async (picks) => {
    w.writes.push(...picks);
    for (const p of picks) w.picks.set(p.subjectId, { subjectId: p.subjectId, address: p.address, outcome: p.outcome, decidedAtMs: p.decidedAtMs, evidence: p.evidence });
    return picks.length;
  },
  policy: DEFAULT_POLICY,
  log: quiet,
  now: () => NOW,
});

test('★ both bars: the later runner takes the pick, with both hours and the reason recorded', async () => {
  const w = world({ CAT: DEAD, BALDCAT: RUNNING });
  const out = await runnerHandoverPass(deps(w));
  assert.deepEqual(out.map((h) => [h.from, h.to]), [['CAT', 'BALDCAT']]);
  const e = w.writes[0]?.evidence ?? {};
  assert.equal(w.writes[0]?.address, 'BALDCAT');
  assert.equal(w.writes[0]?.basis, 'market_readings');
  assert.equal(e['reason'], RUNNER_HANDOVER);
  assert.equal(e[RUNNER_HANDOVER], true);
  assert.equal(e['handedOverFrom'], 'CAT');
  assert.equal(e['toVolume1hUsd'], 529_549);
  assert.equal(e['fromVolume1hUsd'], 0);
});

test('★ one bar is not enough', async () => {
  const notRunning = world({ CAT: DEAD, BALDCAT: { volume1hUsd: 19_999, trades1h: 400, capUsd: 52_785 } });
  assert.equal((await runnerHandoverPass(deps(notRunning))).length, 0, 'three times a dead coin, under the dollar bar');
  const notAhead = world({ CAT: { volume1hUsd: 400_000, trades1h: 3_000, capUsd: 300_000 }, BALDCAT: RUNNING });
  assert.equal((await runnerHandoverPass(deps(notAhead))).length, 0, 'running, under 1.5 times the held hour');
  const unread = world({ BALDCAT: RUNNING });
  assert.equal((await runnerHandoverPass(deps(unread))).length, 0, 'the held coin unread: unknown, not quiet');
});

test('★ never over the owner\'s coin call', async () => {
  const w = world({ CAT: DEAD, BALDCAT: RUNNING });
  w.called.add(POST);
  assert.equal((await runnerHandoverPass(deps(w))).length, 0);
  assert.equal(w.writes.length, 0);
});

test('★ no ping-pong: the old coin back only by the same test against the new one', async () => {
  const w = world({ CAT: DEAD, BALDCAT: RUNNING });
  await runnerHandoverPass(deps(w));
  w.hours.set('CAT', { volume1hUsd: 700_000, trades1h: 9_000, capUsd: 400_000 });
  assert.equal((await runnerHandoverPass(deps(w))).length, 0, 'under 1.5 times the new one: stays');
  assert.equal(w.picks.get(POST)?.address, 'BALDCAT');
  w.hours.set('CAT', { volume1hUsd: 1_600_000, trades1h: 20_000, capUsd: 900_000 });
  const back = await runnerHandoverPass(deps(w));
  assert.deepEqual(back.map((h) => [h.from, h.to]), [['BALDCAT', 'CAT']], 'at 1.5 times it or more, back by the same rule');
});

test('★ the one-coin rule leaves a pick the hand-over wrote alone', async () => {
  const w = world({ CAT: DEAD, BALDCAT: RUNNING });
  await runnerHandoverPass(deps(w));
  const written: PickWrite[] = [];
  /* CAT bought far more in its first hour: judged by the one-coin rule, the pick would go back to it. */
  const repo = {
    recentLaunches: async () => [],
    recentPosts: async () => [],
    postsByIds: async () => [],
    similarities: async () => new Map(),
    unembedded: async () => new Set<string>(),
    upsertCandidates: async () => 0,
    watch: async () => true,
    openCandidates: async () => CANDS,
    candidatesOf: async (ids: readonly string[]) => CANDS.filter((c) => ids.includes(c.itemId)),
    narrativesOf: async () => new Map(),
    tradeFeedAt: async () => null,
    watched: async () => new Set<string>(),
    tradeFacts: async () => null,
    marketFacts: async () => new Map([['CAT', { capUsd: 400_000, peakCapUsd: 400_000, readAtMs: NOW, liquidityUsd: null }], ['BALDCAT', { capUsd: 52_785, peakCapUsd: 92_067, readAtMs: NOW, liquidityUsd: null }]]),
    coinsNamed: async () => [],
    coinsLaunchedBetween: async () => [],
    picks: async (_k: string, ids: readonly string[]) => new Map([...w.picks].filter(([id]) => ids.includes(id))),
    writePicks: async (_k: string, picks: readonly PickWrite[]) => (written.push(...picks), 0),
    appliedFit: async () => null,
  } as unknown as OneCoinDeps['repo'];
  await oneCoinPass({ repo, policy: DEFAULT_POLICY, log: quiet, now: () => NOW as Millis }, newOneCoinState());
  assert.equal(written.filter((p) => p.subjectId === POST).length, 0);
});
