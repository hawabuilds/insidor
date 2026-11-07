/**
 * The one-coin candidate mirror (`PgOneCoinRepo` with `mirrorCandidates`): it answers
 * `openCandidates` and `candidatesOf` exactly as the table's own statements do, and after the first
 * read asks only for rows stamped since the newest it holds (less the overlap).
 *
 * Against a fake `Db` holding the table in memory and answering the mirror's statement by its
 * `updated_at` bound. The mirror was also checked against the live store, read only: the same 7,687
 * open rows, ~68 KB a catch-up read where the table's statement returned ~2.4 MB, and ~32 MB of
 * heap once a day's posts are held.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgOneCoinRepo } from './one-coin.ts';

interface Row { item_id: string; address: string; path: 'launch' | 'existing'; evidence: Record<string, unknown>; launched_at: string | null; found_at: string; updated: number }

function fakeDb(table: Row[]): { db: Db; bounds: (number | null)[]; asideReads: string[][] } {
  const bounds: (number | null)[] = [];
  const asideReads: string[][] = [];
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (!sql.includes('from internal.one_coin_candidate')) throw new Error(`unexpected statement: ${sql}`);
      /* The table's own open read (no mirror, or a window wider than it holds): every row, here. */
      if (sql.includes('order by max(found_at) desc')) {
        bounds.push(null);
        return table.map((r) => ({ ...r }) as R);
      }
      if (sql.includes('where item_id = any($1::text[])')) {
        const ids = (params?.[0] ?? []) as string[];
        asideReads.push(ids);
        return table.filter((r) => ids.includes(r.item_id)).map((r) => ({ ...r, u: r.updated }) as R);
      }
      const bound = (params?.[0] ?? null) as number | null;
      bounds.push(bound);
      return table.filter((r) => bound === null || r.updated >= bound).map((r) => ({ ...r, u: r.updated }) as R);
    },
  } as Db;
  return { db, bounds, asideReads };
}

const at = (ms: number): string => new Date(ms).toISOString();

test('the mirror answers like the table and catches up by updated_at', async () => {
  const T = 1_800_000_000_000;
  const table: Row[] = [
    { item_id: 'x:old', address: 'A', path: 'launch', evidence: { ties: ['name'] }, launched_at: at(T - 7_200_000), found_at: at(T - 7_200_000), updated: T - 7_200_000 },
    { item_id: 'x:1', address: 'B', path: 'launch', evidence: { ties: ['link'] }, launched_at: at(T - 60_000), found_at: at(T - 60_000), updated: T - 60_000 },
    { item_id: 'x:1', address: 'C', path: 'existing', evidence: { ties: ['existing'] }, launched_at: null, found_at: at(T - 7_000_000), updated: T - 7_000_000 },
    { item_id: 'x:2', address: 'D', path: 'launch', evidence: { ties: ['picture'] }, launched_at: at(T - 30_000), found_at: at(T - 30_000), updated: T - 30_000 },
  ];
  const { db, bounds } = fakeDb(table);
  const repo = new PgOneCoinRepo(db, { mirrorCandidates: true });

  const since = T - 3_600_000;
  const open = await repo.openCandidates(since, 10);
  /* Newest find first; x:1 brings its older coin too; x:old has nothing open. */
  assert.deepEqual(open.map((r) => `${r.itemId}/${r.address}`), ['x:2/D', 'x:1/B', 'x:1/C']);
  assert.deepEqual((await repo.openCandidates(since, 1)).map((r) => r.itemId), ['x:2']);
  assert.equal(bounds[0], null);
  /* After the first read, only rows stamped since the newest held, less two minutes. */
  assert.equal(bounds[1], T - 30_000 - 120_000);

  /* A widened row and a new post arrive; both are seen. */
  const one = table[1];
  if (one !== undefined) {
    one.evidence = { ties: ['link', 'picture'] };
    one.updated = T + 1_000;
  }
  table.push({ item_id: 'x:3', address: 'E', path: 'launch', evidence: {}, launched_at: at(T + 2_000), found_at: at(T + 2_000), updated: T + 2_000 });
  const again = await repo.openCandidates(since, 10);
  assert.deepEqual(again.map((r) => `${r.itemId}/${r.address}`), ['x:3/E', 'x:2/D', 'x:1/B', 'x:1/C']);
  assert.deepEqual(again.find((r) => r.address === 'B')?.evidence, { ties: ['link', 'picture'] });

  assert.deepEqual((await repo.candidatesOf(['x:old', 'x:none'])).map((r) => r.address), ['A']);
});

test('a post unwritten for a day leaves the mirror, is read from the table, and is held whole again when written', async () => {
  const T = 1_800_000_000_000;
  const DAY = 86_400_000;
  const table: Row[] = [
    { item_id: 'x:old', address: 'A', path: 'launch', evidence: { ties: ['name'] }, launched_at: at(T - 2 * DAY), found_at: at(T - 2 * DAY), updated: T - 2 * DAY },
    { item_id: 'x:old', address: 'B', path: 'existing', evidence: {}, launched_at: null, found_at: at(T - 2 * DAY), updated: T - 2 * DAY },
    { item_id: 'x:new', address: 'C', path: 'launch', evidence: {}, launched_at: at(T), found_at: at(T), updated: T },
  ];
  const { db, bounds } = fakeDb(table);
  const repo = new PgOneCoinRepo(db, { mirrorCandidates: true });
  assert.deepEqual((await repo.openCandidates(T - 3_600_000, 10)).map((r) => r.address), ['C']);
  /* x:old is pruned now and read from the table when asked about. */
  const asked = bounds.length;
  assert.deepEqual((await repo.candidatesOf(['x:old', 'x:new'])).map((r) => r.address).sort(), ['A', 'B', 'C']);
  assert.ok(bounds.length > asked);
  /* A wider window than the mirror holds goes to the table. */
  assert.deepEqual((await repo.openCandidates(T - 3 * DAY, 10)).map((r) => r.itemId).sort(), ['x:new', 'x:old', 'x:old']);
  /* A new candidate on x:old: the post is held whole again, its old coins with it. */
  table.push({ item_id: 'x:old', address: 'D', path: 'launch', evidence: {}, launched_at: at(T + 1_000), found_at: at(T + 1_000), updated: T + 1_000 });
  const open = await repo.openCandidates(T - 3_600_000, 10);
  assert.deepEqual(open.map((r) => `${r.itemId}/${r.address}`).sort(), ['x:new/C', 'x:old/A', 'x:old/B', 'x:old/D']);
});

test('a pruned post asked about is read once and held while it is asked about, then pruned again', async () => {
  const T = 1_800_000_000_000;
  const DAY = 86_400_000;
  const table: Row[] = [
    { item_id: 'x:old', address: 'A', path: 'launch', evidence: { ties: ['name'] }, launched_at: at(T - 2 * DAY), found_at: at(T - 2 * DAY), updated: T - 2 * DAY },
    { item_id: 'x:new', address: 'C', path: 'launch', evidence: {}, launched_at: at(T), found_at: at(T), updated: T },
  ];
  const { db, asideReads } = fakeDb(table);
  const repo = new PgOneCoinRepo(db, { mirrorCandidates: true });
  await repo.openCandidates(T - 3_600_000, 10);
  /* Asked every pass: one read of the table, then served from the mirror. */
  for (let i = 0; i < 5; i += 1) assert.deepEqual((await repo.candidatesOf(['x:old', 'x:new'])).map((r) => r.address), ['A', 'C']);
  assert.deepEqual(asideReads, [['x:old']]);
  /* Not asked for over an hour (the table's clock moves with new writes): pruned again at the next prune, then read again once. */
  for (const step of [1, 2, 3]) {
    table.push({ item_id: `x:t${step}`, address: `T${step}`, path: 'launch', evidence: {}, launched_at: at(T + step * 3_600_000), found_at: at(T + step * 3_600_000), updated: T + step * 3_600_000 });
    await repo.openCandidates(T + step * 3_600_000 - 60_000, 10);
  }
  assert.deepEqual((await repo.candidatesOf(['x:old'])).map((r) => r.address), ['A']);
  assert.deepEqual(asideReads, [['x:old'], ['x:old']]);
});

test('without the mirror every read goes to the table', async () => {
  const { db, bounds } = fakeDb([]);
  const repo = new PgOneCoinRepo(db);
  await repo.openCandidates(0, 10);
  await repo.openCandidates(0, 10);
  assert.equal(bounds.length, 2);
});

test('the waiting sweep reads a pick\'s evidence only when its row changed', async () => {
  const picks = [
    { id: 'x:1', decided_at: at(1_800_000_000_000), v: '10', evidence: { ties: ['name'] } },
    { id: 'x:2', decided_at: at(1_800_000_000_000), v: '11', evidence: { ties: ['link'] } },
  ];
  const evidenceRead: string[][] = [];
  const db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes("p.outcome = 'waiting'")) {
        assert.ok(!sql.includes('p.evidence'));
        return picks.map(({ id, decided_at, v }) => ({ id, decided_at, v })) as R[];
      }
      const ids = (params?.[0] ?? []) as string[];
      evidenceRead.push(ids);
      return picks.filter((p) => ids.includes(p.id)).map(({ id, v, evidence }) => ({ id, v, evidence })) as R[];
    },
  } as Db;
  const repo = new PgOneCoinRepo(db);
  const first = await repo.waitingPostPicks(0, 10, 1);
  assert.deepEqual(first.map((p) => [p.subjectId, p.evidence]), [['x:1', { ties: ['name'] }], ['x:2', { ties: ['link'] }]]);
  assert.deepEqual(await repo.waitingPostPicks(0, 10, 1), first);
  assert.deepEqual(evidenceRead, [['x:1', 'x:2']]);
  /* x:2 rewritten: only its evidence crosses again. */
  picks[1] = { ...picks[1]!, v: '12', evidence: { ties: ['link', 'picture'] } };
  assert.deepEqual((await repo.waitingPostPicks(0, 10, 1)).map((p) => p.evidence), [{ ties: ['name'] }, { ties: ['link', 'picture'] }]);
  assert.deepEqual(evidenceRead, [['x:1', 'x:2'], ['x:2']]);
});

test('the held picks read their evidence only when the row changed', async () => {
  const picks = [{ id: 'x:1', address: 'A', decided_at: at(1_800_000_000_000), v: '10', evidence: { ties: ['name'] } }];
  let evidenceReads = 0;
  const db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes("outcome = 'picked'")) {
        assert.ok(!sql.includes('evidence'));
        return picks.map(({ id, address, decided_at, v }) => ({ id, address, decided_at, v })) as R[];
      }
      evidenceReads += 1;
      const ids = (params?.[0] ?? []) as string[];
      return picks.filter((p) => ids.includes(p.id)).map(({ id, v, evidence }) => ({ id, v, evidence })) as R[];
    },
  } as Db;
  const repo = new PgOneCoinRepo(db);
  for (let i = 0; i < 3; i += 1) assert.deepEqual((await repo.heldPostPicks(0, 10)).map((p) => [p.subjectId, p.address, p.evidence]), [['x:1', 'A', { ties: ['name'] }]]);
  assert.equal(evidenceReads, 1);
});

test('watched sends back only the coins whose answer is not the one held', async () => {
  const watching = new Set(['A', 'B']);
  const returned: string[][] = [];
  const db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      assert.ok(sql.includes('a.held is distinct from'));
      const asked = (params?.[0] ?? []) as string[];
      const held = (params?.[2] ?? []) as (boolean | null)[];
      const rows = asked.flatMap((address, i) => (held[i] === watching.has(address) ? [] : [{ address, ok: watching.has(address) }]));
      returned.push(rows.map((r) => r.address));
      return rows as R[];
    },
  } as Db;
  const repo = new PgOneCoinRepo(db);
  assert.deepEqual([...(await repo.watched(['A', 'B', 'C', 'A'], 1))].sort(), ['A', 'B']);
  assert.deepEqual([...(await repo.watched(['A', 'B', 'C'], 2))].sort(), ['A', 'B']);
  /* B's measurement ended and C's began: only those two cross again. */
  watching.delete('B');
  watching.add('C');
  assert.deepEqual([...(await repo.watched(['A', 'B', 'C'], 3))].sort(), ['A', 'C']);
  assert.deepEqual(returned, [['A', 'B', 'C'], [], ['B', 'C']]);
});

test('★ writePicks: a pick the same as the one stored only moves updated_at; one that differs is written whole', async () => {
  const sent: { sql: string; params: readonly unknown[] }[] = [];
  const db: Db = { query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => { sent.push({ sql, params: params ?? [] }); return [] as R[]; } } as Db;
  const repo = new PgOneCoinRepo(db);
  const evidence = { mode: 'live', standings: [{ address: 'A', share: 0.5 }], note: undefined, basis: 'trades' };
  const stored = new Map([
    ['n1', { subjectId: 'n1', address: 'A', outcome: 'picked' as const, decidedAtMs: 1_000, evidence: { basis: 'trades', standings: [{ share: 0.5, address: 'A' }], mode: 'live' } }],
    ['n2', { subjectId: 'n2', address: 'A', outcome: 'picked' as const, decidedAtMs: 1_000, evidence: { mode: 'live' } }],
  ]);
  const picks = [
    { subjectId: 'n1', address: 'A', outcome: 'picked' as const, decidedAtMs: 1_000, evidence, basis: 'trades' as const },
    { subjectId: 'n2', address: 'A', outcome: 'picked' as const, decidedAtMs: 1_000, evidence, basis: 'trades' as const },
    { subjectId: 'n3', address: 'B', outcome: 'picked' as const, decidedAtMs: 2_000, evidence, basis: 'trades' as const },
  ];
  const changed = await repo.writePicks('narrative', picks, stored, 'live', 5_000);
  const insert = sent.find((s) => s.sql.includes('insert into internal.narrative_coin_pick'));
  const stamp = sent.find((s) => s.sql.startsWith('update internal.narrative_coin_pick set updated_at'));
  assert.deepEqual(insert?.params[0], ['n2', 'n3'], 'different evidence, and never stored: written whole');
  assert.deepEqual(stamp?.params[0], ['n1'], 'the same in every field, key order aside: only stamped');
  assert.equal(stamp?.params[1], new Date(5_000).toISOString());
  assert.equal(changed, 1, 'the coin changed for n3 only');
});
