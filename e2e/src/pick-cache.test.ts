/**
 * The one-coin repo's held picks against a real Postgres: what a repo holds after writing a pick is
 * what a fresh read of the table gives, so the next pass reads nothing whole — the property that lets
 * the runner stop reading back the evidence it just wrote (store one-coin.ts writePicks, 2026-11-07).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { PgOneCoinRepo, type Db } from '@insidor/store';
import { canonical } from '@insidor/store/repo/one-coin.ts';

import { migratedDb } from './db.ts';

/* Evidence the way the runner builds it: live numbers with long fractions, an undefined field, nesting. */
const evidence = (cap: number) => ({ mode: 'live', basis: 'trades', note: undefined, standings: [{ address: 'A', share: 0.1 + 0.2, capUsd: cap, rank: 1 }, { address: 'B', share: 1 / 3, capUsd: null }], handedOverFrom: null });

function counting(db: Db): { db: Db; whole: () => number } {
  let whole = 0;
  return {
    db: { query: async (sql, params) => { if (/, evidence from/.test(sql)) whole += 1; return db.query(sql, params); } } as Db,
    whole: () => whole,
  };
}

test('★ a written pick is held exactly as a fresh read gives it, so the next read reads nothing whole', async () => {
  const db = await migratedDb();
  const c = counting(db);
  const repo = new PgOneCoinRepo(c.db);
  const now = Date.parse('2026-11-07T12:00:00.123Z');
  for (const kind of ['post', 'narrative'] as const) {
    const picks = [
      { subjectId: `${kind}:1`, address: 'A', outcome: 'picked' as const, decidedAtMs: now - 60_000, evidence: evidence(12_345.678901234567), basis: 'trades' as const },
      { subjectId: `${kind}:2`, address: null, outcome: 'waiting' as const, decidedAtMs: now, evidence: evidence(99), basis: null },
    ];
    await repo.writePicks(kind, picks, new Map(), 'live', now);
    const before = c.whole();
    const held = await repo.picks(kind, picks.map((p) => p.subjectId));
    assert.equal(c.whole(), before, `${kind}: held as written, nothing read whole`);
    const fresh = await new PgOneCoinRepo(db).picks(kind, picks.map((p) => p.subjectId));
    assert.equal(canonical(Object.fromEntries(held)), canonical(Object.fromEntries(fresh)), `${kind}: the held picks are what the table holds`);

    /* A second pass with the evidence moved: written whole again, and again held as stored. */
    const moved = picks.map((p) => ({ ...p, evidence: evidence(13_000.5) }));
    await repo.writePicks(kind, moved, held, 'live', now + 10_000);
    const again = await repo.picks(kind, picks.map((p) => p.subjectId));
    assert.equal(c.whole(), before, `${kind}: still nothing read whole`);
    assert.equal(canonical(Object.fromEntries(again)), canonical(Object.fromEntries(await new PgOneCoinRepo(db).picks(kind, picks.map((p) => p.subjectId)))));
  }
  const heldPicks = await repo.heldPostPicks(now - 3_600_000, 10);
  assert.equal(c.whole(), 0, 'the held sweep finds its evidence held too');
  assert.deepEqual(heldPicks.map((p) => p.subjectId), ['post:1']);
});
