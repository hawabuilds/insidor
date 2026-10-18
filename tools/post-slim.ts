/**
 * `node --env-file=.env.local --experimental-strip-types tools/post-slim.ts <status | dry | run> [options]`
 *
 * SLIMS THE POSTS THAT NEVER MADE FOR YOU, A WEEK AFTER WE FOUND THEM (the owner, 2026-10-18; the
 * rule and the keep list are store post-slim.ts and Policy.slim).
 *
 *   status   where the cursor is, how many posts are slimmed, how many are due. Reads only.
 *   dry      what the next run would remove, batch by batch, inside a READ ONLY transaction, so it
 *            cannot write whatever the code does. `--as-of <ISO time>` pretends it is then (to see a
 *            future day's run); `--from-start` ignores the saved cursor; `--batches <n>` caps it.
 *   run      the live run, scheduled hourly by the projector service (tools/railway-start.mjs).
 *            Does nothing but say so while Policy.slim.on is false.
 *
 * Its own tool, not a projector step, because the projector holds one transaction per frame and a
 * frame must not wait on a delete; this runs in the jobs lane, one batch per short transaction.
 *
 * What breaks if changed carelessly: `dry` must keep its READ ONLY transaction — it is how the owner
 * is shown the numbers before saying yes, and it is run against the live database.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { readCursor, runSlim, type InTransaction, type SlimBatch } from '../store/src/repo/post-slim.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = rest.indexOf(name);
  return i === -1 ? null : (rest[i + 1] ?? null);
};
const pool = createPool(DB_ROLE.service, { env: { DATABASE_URL_SERVICE: process.env['DATABASE_URL'] }, applicationName: 'insidor-post-slim' });
const db = asDb(pool);
const P = DEFAULT_POLICY.slim;

function transactions(readOnly: boolean): InTransaction {
  return async (fn) => {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? 'begin read only' : 'begin');
      const out = await fn(asDb(client));
      await client.query(readOnly ? 'rollback' : 'commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };
}

const MB = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

/** On-disk bytes per row, table and indexes, from the table's own size: a DELETE frees about this. */
async function diskPerRow(table: string): Promise<number> {
  const [r] = await db.query<{ b: string | null }>(
    `select (pg_total_relation_size(c.oid)::float8 / nullif(greatest(c.reltuples, 0), 0))::text as b from pg_class c where c.oid = to_regclass($1)`,
    [table],
  );
  return Number(r?.b ?? 0);
}

async function report(batches: readonly SlimBatch[], live: boolean, caughtUp: boolean): Promise<void> {
  const sum = (k: keyof Omit<SlimBatch, 'cursor'>) => batches.reduce((s, b) => s + b[k], 0);
  const obsRow = await diskPerRow('public.observation');
  const foundRow = await diskPerRow('internal.item_found_by');
  const readings = sum('readings');
  const search = sum('searchRecords');
  const disk = readings * obsRow + search * foundRow + sum('itemBytes');
  console.log(JSON.stringify({
    level: 'info',
    msg: live ? 'posts slimmed' : 'posts slimming would remove (dry)',
    batches: batches.length,
    decided: sum('decided'),
    kept: sum('kept'),
    slimmed: sum('slimmed'),
    readings,
    readingColumnMb: MB(sum('readingBytes')),
    searchRecords: search,
    rawCaptures: sum('rawCaptures'),
    itemColumnMb: MB(sum('itemBytes')),
    diskFreedMb: MB(disk),
    cursor: batches.at(-1)?.cursor ?? null,
    caughtUp,
  }));
}

try {
  if (cmd === 'status') {
    const cursor = await readCursor(db).catch(() => null);
    const [r] = await db.query<Record<string, unknown>>(
      `select (select count(*) from internal.post_slim)::int as slimmed,
              (select coalesce(sum(readings_dropped), 0) from internal.post_slim)::bigint as readings_dropped,
              (select count(*) from public.item where first_seen_at < now() - make_interval(secs => $1::float8 / 1000))::int as old_enough`,
      [P.afterMs],
    ).catch(() => [{ error: 'migration 0101 is not applied' }]);
    console.log(JSON.stringify({ on: P.on, afterDays: P.afterMs / 86_400_000, cursor, ...r }));
  } else if (cmd === 'dry' || cmd === 'run') {
    const live = cmd === 'run';
    if (live && !P.on) {
      console.log(JSON.stringify({ level: 'info', msg: 'post slimming is off (Policy.slim.on)' }));
    } else {
      const asOf = flag('--as-of');
      const nowMs = asOf === null ? Date.now() : Date.parse(asOf);
      if (Number.isNaN(nowMs)) throw new Error(`--as-of is not a time: ${asOf}`);
      const batches = flag('--batches');
      const policy = batches === null ? P : { ...P, batchesPerRun: Number(batches) };
      const from = rest.includes('--from-start') ? { from: { firstSeenAt: '-infinity', itemId: '' } } : {};
      const out = await runSlim(db, transactions(!live), policy, nowMs, live, from);
      if (out.kind === 'not_migrated') console.log(JSON.stringify({ level: 'error', msg: 'post slimming cannot run: tables missing', missing: out.missing }));
      else if (out.kind === 'busy') console.log(JSON.stringify({ level: 'info', msg: 'post slimming: another run holds the lock' }));
      else await report(out.batches, out.live, out.caughtUp);
    }
  } else {
    throw new Error(`unknown command: ${cmd} (status | dry | run)`);
  }
} finally {
  await pool.end();
}
