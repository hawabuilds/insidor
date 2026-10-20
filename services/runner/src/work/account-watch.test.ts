/**
 * The account watch (work/account-watch.ts): which groups are asked, from when, under which lane,
 * and that it stops where its cap and its switch say. No network and no database: the source pages
 * through a fixed number of posts (lane-search-fakes.ts) and the list is a plain function.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Policy } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { WatchAccount } from '@insidor/store';

import type { Logger } from '../log.ts';
import { accountWatchPass, accountWatchState, groupSince, turnedGroups, type AccountWatchDeps } from './account-watch.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { NOW, openMeter, pagingSource } from './lane-search-fakes.ts';

const P = DEFAULT_POLICY.feed.accountWatch;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const list = (n: number): WatchAccount[] => Array.from({ length: n }, (_v, k) => ({ handle: `acct${k}`, coinedPosts: n - k }));

function deps(seen: DiscoveryQuery[], lanes: unknown[], over: Partial<AccountWatchDeps> & { readonly policy?: Policy; readonly accountsRead?: number[] } = {}): AccountWatchDeps {
  return {
    sources: () => [
      /* The short-video source asks accounts too, but has no catch-all: it must never be the one asked. */
      pagingSource([], () => 0, { discovery: ['account'] }),
      pagingSource(seen, () => 2, { discovery: ['keyword', 'catchall', 'account'] }),
    ],
    accounts: {
      coinedAccounts: async () => {
        over.accountsRead?.push(1);
        return list(32);
      },
    },
    store: async (items, _a, lane) => {
      lanes.push(lane);
      return items.length;
    },
    uncredited: async (ids) => ids.length,
    ledger: memoryLaneLedger(),
    meter: openMeter,
    mode: 'live',
    policy: DEFAULT_POLICY,
    log: quiet,
    now: () => NOW,
    ...over,
  };
}

test('the list is cut into groups of accountsPerAsk, and each group turns one place every ask', () => {
  const handles = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(turnedGroups(handles, 2, 1000, 0), [['a', 'b'], ['c', 'd'], ['e']]);
  assert.deepEqual(turnedGroups(handles, 2, 1000, 1000), [['b', 'a'], ['d', 'c'], ['e']]);
  /* Over a group's length of asks, every account is last once. */
  const lasts = [0, 1, 2].map((k) => turnedGroups(['a', 'b', 'c'], 3, 1000, k * 1000)[0]?.at(-1));
  assert.deepEqual([...lasts].sort(), ['a', 'b', 'c']);
});

test("a group asks from its accounts' oldest start, one cadence back for a new account, never past the window", () => {
  const since = new Map([['a', NOW - 60_000], ['b', NOW - 120_000]]);
  assert.equal(groupSince(['a', 'B'], since, NOW, P), NOW - 120_000);
  assert.equal(groupSince(['a', 'new'], since, NOW, P), NOW - P.everyMs);
  assert.equal(groupSince(['a'], new Map([['a', NOW - 10 * P.maxWindowMs]]), NOW, P), NOW - P.maxWindowMs);
});

test('every group of the list is asked on the text source as accounts, credited to the account lane', async () => {
  const seen: DiscoveryQuery[] = [];
  const lanes: unknown[] = [];
  const state = accountWatchState();
  const r = await accountWatchPass(deps(seen, lanes), state);
  const groups = Math.ceil(32 / P.accountsPerAsk);
  assert.equal(r.accounts, 32);
  assert.equal(r.groups, groups);
  assert.equal(seen.length, groups);
  for (const q of seen) {
    assert.equal(q.mode, 'account');
    assert.ok((q.terms?.length ?? 0) <= P.accountsPerAsk);
    assert.equal(q.term, q.terms?.[0]);
    assert.equal(q.filter, undefined);
    assert.equal(q.sinceMs, NOW - P.everyMs);
  }
  assert.deepEqual(new Set(seen.flatMap((q) => q.terms ?? [])).size, 32);
  assert.ok(lanes.every((l) => l === 'account'));
  /* Each account's next ask starts where this one began. */
  assert.equal(state.since.get('acct0'), NOW);
});

test('the list is read once per listEveryMs, and a failed read keeps the last list', async () => {
  const reads: number[] = [];
  const state = accountWatchState();
  let now = NOW;
  const d = deps([], [], { accountsRead: reads, now: () => now });
  await accountWatchPass(d, state);
  now = NOW + P.everyMs;
  await accountWatchPass(d, state);
  assert.equal(reads.length, 1);
  now = NOW + P.listEveryMs;
  const failing = { ...d, accounts: { coinedAccounts: async () => Promise.reject(new Error('db away')) } };
  const r = await accountWatchPass(failing, state);
  assert.equal(r.accounts, 32);
});

test('a spent day asks nothing, and off reads and asks nothing at all', async () => {
  const seen: DiscoveryQuery[] = [];
  const reads: number[] = [];
  const spent = await accountWatchPass(deps(seen, [], { ledger: memoryLaneLedger({ account: P.cap.dailyUsd }) }), accountWatchState());
  assert.equal(spent.stopped, 'capped');
  assert.equal(seen.length, 0);
  const off: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, accountWatch: { ...P, on: false } } };
  const r = await accountWatchPass(deps(seen, [], { policy: off, accountsRead: reads }), accountWatchState());
  assert.equal(r.asked, 0);
  assert.equal(reads.length, 0);
  assert.equal(seen.length, 0);
});
