/**
 * One capped lane search (work/lane-search.ts): pages while the source says there is more, stores
 * each page under the lane, charges the ledger per page (search plus its new posts' judging), and
 * stops at the page limit, the cap, an unreadable ledger, the deadline, or a dry run — asking
 * nothing past any of them.
 *
 * The source is a fake that pages through a fixed number of posts, 20 a page, and records each query.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { LaneCapPolicy } from '@insidor/contracts/policy.ts';
import { laneJudgeUsd } from '@insidor/core';

import type { Logger } from '../log.ts';
import { memoryLaneLedger, type LaneLedger } from './lane-ledger.ts';
import { laneSearch, type LaneSearchDeps } from './lane-search.ts';
import { NOW, openMeter, pagingSource, USD_PER_POST } from './lane-search-fakes.ts';

const PAGE = 20;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const CAP: LaneCapPolicy = { dailyUsd: 1, judgeUsdPerPost: 0.001, judgedShare: 1 };

const QUERY: DiscoveryQuery = { mode: 'keyword', term: 'tesla roadster', sinceMs: null, untilMs: null, limit: PAGE, cursor: null };

function deps(ledger: LaneLedger, stored: { lane: unknown; n: number }[], over: Partial<LaneSearchDeps> = {}): LaneSearchDeps {
  return {
    meter: openMeter,
    mode: 'live',
    ledger,
    uncredited: async (ids) => ids.length,
    store: async (items, _a, lane) => {
      stored.push({ lane, n: items.length });
      return items.length;
    },
    log: quiet,
    now: () => NOW,
    ...over,
  };
}

test('pages while the source says there is more, stores each page under the lane, and charges search plus judging', async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: { lane: unknown; n: number }[] = [];
  const ledger = memoryLaneLedger();
  const r = await laneSearch(deps(ledger, stored), { adapter: pagingSource(seen, () => 45), query: QUERY, lane: 'narrative_name', cap: CAP, maxPages: 5, deadline: (NOW + 60_000) as Millis });
  assert.equal(r.end, 'done');
  assert.equal(r.pages, 3);
  assert.deepEqual(seen.map((q) => q.cursor), [null, '20', '40']);
  assert.deepEqual(stored, [{ lane: 'narrative_name', n: 20 }, { lane: 'narrative_name', n: 20 }, { lane: 'narrative_name', n: 5 }]);
  const expected = 45 * USD_PER_POST + laneJudgeUsd(45, CAP);
  assert.ok(Math.abs(r.usd - expected) < 1e-9);
  assert.ok(Math.abs(((await ledger.spent('narrative_name', NOW)) ?? 0) - expected) < 1e-9);
});

test('an empty answer is one billed ask and the end, and posts another lane holds are not charged as judging', async () => {
  const seen: DiscoveryQuery[] = [];
  const ledger = memoryLaneLedger();
  const empty = await laneSearch(deps(ledger, []), { adapter: pagingSource(seen, () => 0), query: QUERY, lane: 'quote', cap: CAP, maxPages: 3, deadline: (NOW + 60_000) as Millis });
  assert.equal(empty.end, 'done');
  assert.equal(seen.length, 1);
  assert.ok(Math.abs(empty.usd - USD_PER_POST) < 1e-12);
  const held = await laneSearch(deps(memoryLaneLedger(), [], { uncredited: async () => 0 }), { adapter: pagingSource([], () => 10), query: QUERY, lane: 'quote', cap: CAP, maxPages: 3, deadline: (NOW + 60_000) as Millis });
  assert.equal(held.fresh, 0);
  assert.ok(Math.abs(held.usd - 10 * USD_PER_POST) < 1e-12);
});

test('stops at the page limit, the cap, an unreadable ledger, the deadline and a dry run, asking nothing past them', async () => {
  const at = (n: number) => ({ adapter: pagingSource([], () => 1000), query: QUERY, lane: 'narrative_name' as const, cap: CAP, maxPages: n, deadline: (NOW + 60_000) as Millis });

  const pages = await laneSearch(deps(memoryLaneLedger(), []), at(2));
  assert.equal(pages.end, 'pages');
  assert.equal(pages.pages, 2);

  const seen: DiscoveryQuery[] = [];
  const spent = await laneSearch(deps(memoryLaneLedger({ narrative_name: CAP.dailyUsd }), []), { ...at(5), adapter: pagingSource(seen, () => 1000) });
  assert.equal(spent.end, 'capped');
  assert.equal(seen.length, 0);

  const unreadable: LaneLedger = { spent: async () => null, add: async () => undefined };
  const blind = await laneSearch(deps(unreadable, []), { ...at(5), adapter: pagingSource(seen, () => 1000) });
  assert.equal(blind.end, 'unreadable');
  assert.equal(seen.length, 0);

  const late = await laneSearch(deps(memoryLaneLedger(), []), { ...at(5), adapter: pagingSource(seen, () => 1000), deadline: NOW });
  assert.equal(late.end, 'deadline');
  assert.equal(seen.length, 0);

  const dry = await laneSearch(deps(memoryLaneLedger(), [], { mode: 'dry' }), { ...at(5), adapter: pagingSource(seen, () => 1000) });
  assert.equal(dry.end, 'dry');
  assert.equal(seen.length, 0);
});

test('a page that throws is charged its quote and ends the ask as failed', async () => {
  const ledger = memoryLaneLedger();
  const broken: PlatformAdapter = { ...pagingSource([], () => 10), discover: async () => { throw new Error('503'); } };
  const r = await laneSearch(deps(ledger, []), { adapter: broken, query: QUERY, lane: 'quote', cap: CAP, maxPages: 3, deadline: (NOW + 60_000) as Millis });
  assert.equal(r.end, 'failed');
  assert.ok(((await ledger.spent('quote', NOW)) ?? 0) > 0);
});
