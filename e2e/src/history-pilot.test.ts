/**
 * ★ THE HISTORY PILOT'S PAID STEP, ON THE REAL SCHEMA: the cap stops the run before a call that
 * would cross it, across runs; a second run resumes and pays for nothing already done; a post
 * after launch is kept as "went viral after launch" and never becomes the origin; a same-name
 * coin with a different picture is a narrative of its own.
 *
 * Real schema (PGlite), the real step and ledger. The suppliers are stand-ins that charge a
 * fixed price per call, so every number below is exact.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { runPilot, type PilotCoin, type PilotPorts } from '@insidor/runner/src/work/history-pilot.ts';
import { PgHistoryRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const DAY = 86_400_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const PRICE = { picture: 0.001, confirm: 0.003, creator: 0.0002, search: 0.01 };

let db: Db;
beforeEach(async () => {
  db = await migratedDb();
});

const coin = (address: string, over: Partial<PilotCoin> = {}): PilotCoin => ({
  address, name: 'Moo Deng', ticker: 'MOODENG', launchedAt: (NOW - 300 * DAY) as Millis, marketCapUsd: 200_000, imageUri: 'https://ipfs.io/ipfs/x', socialLink: null, ...over,
});

function ports(over: Partial<PilotPorts> = {}, calls: string[] = []): PilotPorts {
  return {
    pictureSimilarity: async (a, b) => {
      calls.push(`picture:${a.address}-${b.address}`);
      return { value: 0.99, charges: [{ supplier: 'embed', step: 'picture', usd: PRICE.picture }] };
    },
    confirmPair: async () => {
      calls.push('confirm');
      return { value: 'yes', charges: [{ supplier: 'judge', step: 'confirm', usd: PRICE.confirm }] };
    },
    creator: async (c) => {
      calls.push(`creator:${c.address}`);
      return { value: { check: { kind: 'fallThrough', why: 'no post' }, post: null, gap: null }, charges: [{ supplier: 'x', step: 'creator_post', usd: PRICE.creator }] };
    },
    searchBack: async (term) => {
      calls.push(`search:${term}`);
      return { value: [], charges: [{ supplier: 'x', step: 'search', usd: PRICE.search }] };
    },
    peak: async (c) => (c.marketCapUsd === null ? null : c.marketCapUsd * 3),
    ...over,
  };
}

const deps = (p: PilotPorts, cap: number) => {
  const policy: Policy = { ...DEFAULT_POLICY, universe: { ...DEFAULT_POLICY.universe, history: { ...DEFAULT_POLICY.universe.history, pilotUsd: cap } } };
  return { ports: p, reserve: { pictures: PRICE.picture, confirm: PRICE.confirm, creator: PRICE.creator, search: PRICE.search }, history: new PgHistoryRepo(db), policy, log: quiet, now: () => NOW };
};

const narratives = async () => db.query<{ narrative_id: string; origin_gap: string | null; origin_post: Record<string, unknown> | null }>(`select narrative_id, origin_gap, origin_post from public.history_narrative order by narrative_id`, []);

test('★ the cap stops the run before the call that would cross it, and the ledger says what was spent', async () => {
  const calls: string[] = [];
  /* Three unrelated coins: three narratives, three searches of $0.01; the cap allows two. */
  const coins = [coin('A', { name: 'One', ticker: 'ONE' }), coin('B', { name: 'Two', ticker: 'TWO' }), coin('C', { name: 'Three', ticker: 'THR' })];
  const r = await runPilot(coins, deps(ports({}, calls), 0.025));
  assert.equal(r.stopped, 'cap');
  assert.equal(calls.filter((c) => c.startsWith('search')).length, 2);
  assert.ok(r.spentUsd <= 0.025);
  const ledger = await db.query<{ usd: string }>(`select sum(usd) as usd from internal.history_spend`, []);
  assert.equal(Number(ledger[0]?.usd), 0.02);
  assert.equal(r.remaining, 1);
  /* A restart under the same cap cannot spend it twice. */
  const again = await runPilot(coins, deps(ports({}, calls), 0.025));
  assert.equal(again.stopped, 'cap');
  assert.equal(calls.filter((c) => c.startsWith('search')).length, 2);
});

test('★ resume pays for nothing already done: grouped coins are not compared again, searched narratives not searched again', async () => {
  const calls: string[] = [];
  const coins = [coin('A'), coin('B'), coin('C', { name: 'Other', ticker: 'OTH' })];
  const first = await runPilot(coins, deps(ports({}, calls), PRICE.picture + PRICE.search));
  assert.equal(first.stopped, 'cap');
  const before = [...calls];
  const second = await runPilot(coins, deps(ports({}, calls), 1));
  assert.equal(second.stopped, null);
  const after = calls.slice(before.length);
  assert.equal(after.some((c) => c.startsWith('picture')), false, 'the grouping is not paid for twice');
  assert.equal(after.filter((c) => c.startsWith('search')).length, 1, 'only the narrative not searched yet');
  assert.equal(second.remaining, 0);
});

test('★ a post after launch is "went viral after launch", never the origin', async () => {
  const launchedAt = (NOW - 300 * DAY) as Millis;
  const late = { postId: 'x:late', postedAt: (launchedAt + DAY) as Millis, text: 'moo deng is the best hippo', picture: 'near' as const, shown: { postId: 'x:late', authorLabel: '@zoo', permalink: 'https://x.com/zoo/status/1', postedAt: (launchedAt + DAY) as Millis } };
  const p = ports({ searchBack: async () => ({ value: [late], charges: [] }) });
  await runPilot([coin('A', { launchedAt })], deps(p, 1));
  const [n] = await narratives();
  assert.equal(n?.origin_gap, null);
  assert.equal(n?.origin_post?.['afterLaunch'], true);
  assert.equal(n?.origin_post?.['authorLabel'], '@zoo');
});

test('a post before launch with the same name and picture is the origin', async () => {
  const launchedAt = (NOW - 300 * DAY) as Millis;
  const early = { postId: 'x:early', postedAt: (launchedAt - DAY) as Millis, text: 'meet moo deng', picture: 'near' as const, shown: { postId: 'x:early', authorLabel: '@zoo', permalink: null, postedAt: (launchedAt - DAY) as Millis } };
  await runPilot([coin('A', { launchedAt })], deps(ports({ searchBack: async () => ({ value: [early], charges: [] }) }), 1));
  const [n] = await narratives();
  assert.equal(n?.origin_post?.['afterLaunch'], false);
});

test('★ a same-name coin with a different picture is not grouped in', async () => {
  const p = ports({
    pictureSimilarity: async (a, b) => ({ value: a.address === 'C' || b.address === 'C' ? 0.2 : 0.99, charges: [] }),
  });
  await runPilot([coin('A'), coin('B'), coin('C')], deps(p, 1));
  const rows = await db.query<{ narrative_id: string; n: number }>(`select narrative_id, count(*)::int as n from public.history_coin group by narrative_id order by n desc`, []);
  assert.deepEqual(rows.map((r) => r.n), [2, 1]);
});

test('nothing found is said as "origin not found", and a dead creator link as "possibly deleted"', async () => {
  const p = ports({ creator: async () => ({ value: { check: { kind: 'fallThrough', why: 'unreadable' }, post: null, gap: 'possibly_deleted' }, charges: [] }) });
  await runPilot([coin('A', { socialLink: 'https://x.com/a/status/1' }), coin('Z', { name: 'Zed', ticker: 'ZED' })], deps(p, 1));
  const gaps = (await narratives()).map((n) => n.origin_gap).sort();
  assert.deepEqual(gaps, ['origin_not_found', 'possibly_deleted']);
});
