/**
 * `node --env-file=.env.local --experimental-strip-types tools/archive-launches.ts [dry | run] [--hours N]`
 *
 * THE LAUNCHES ALREADY IN THE DATABASE, COPIED TO THE PRIVATE ARCHIVE BUCKET (the owner, 2026-11-08:
 * keep the launch data for smart wallets, "make sure it goes to cheap storage", and never add database
 * load). internal.launch_open keeps a launch 14 days; this copies every finished hour not yet in the
 * bucket, so the nightly smart-wallet job can read a month of launches without touching the database.
 *
 *   dry   the default by hand: which hours are missing from the bucket. Reads the bucket's list only.
 *   run   copies up to `--hours` (default: all) missing hours, oldest first: one indexed range read of
 *         the hour (launch_open_launched_idx), written as launches/<day>/<HH>.jsonl.gz, downloaded again
 *         and its line count checked against the rows read. Graduations seen so far go to one file.
 *
 * ★ READ ONLY, ONE HOUR AT A TIME. Each hour is its own `begin read only` with a statement timeout and a
 * pause after it: about 1,900 rows a read, never a scan of the table. Nothing is written to the database
 * and nothing is deleted anywhere.
 *
 * ★ AN HOUR ALREADY IN THE BUCKET IS LEFT ALONE. Chainwatch writes hours as they finish, with the
 * creator wallet this copy cannot know; an exported hour never replaces one of those.
 *
 * What breaks if changed carelessly: SETTLED_MS. A launch's row is written when its first minute is
 * over, so an hour copied before that misses its last launches and is then never copied again.
 */

import process from 'node:process';

import { asDb, createPool, DB_ROLE, type Db } from '../store/src/index.ts';
import { archiveGet, archiveList, archivePut, readArchiveConfig } from '../adapters/storage/supabase/src/r2-archive.ts';
import { decodeLaunches, encodeRecords, graduationsPath, launchesPath, type GraduationRecord, type LaunchRecord } from '../adapters/storage/supabase/src/launch-archive.ts';

const HOUR_MS = 3_600_000;
/** An hour is copied only once its last launch's first minute is surely written. */
const SETTLED_MS = 15 * 60_000;
const STATEMENT_TIMEOUT_MS = 20_000;
const PAUSE_MS = 150;

const [cmd = 'dry', ...rest] = process.argv.slice(2);
if (cmd !== 'dry' && cmd !== 'run') throw new Error('usage: archive-launches.ts [dry | run] [--hours N]');
const hoursAt = rest.indexOf('--hours');
const hoursPerRun = hoursAt === -1 ? Number.POSITIVE_INFINITY : Number(rest[hoursAt + 1]);
if (hoursAt !== -1 && (!Number.isInteger(hoursPerRun) || hoursPerRun < 1)) throw new Error('--hours needs a whole number of at least 1');

const archive = readArchiveConfig(process.env);
if (archive === null) throw new Error('archive not configured: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_ARCHIVE_BUCKET are needed');

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-archive-launches', max: 1 });

async function readOnly<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const out = await fn(asDb(client));
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const log = (fields: Record<string, unknown>): void => console.log(JSON.stringify({ level: 'info', ...fields }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  address: string; launched_at: Date; pool: string | null; buyers: number; buys: number;
  dev_buy_usd: number | null; dev_buy_sol: number | null; block_share: number | null;
  first_buyers: string[] | null; dev_sold: boolean | null;
}

const toRecord = (r: Row): LaunchRecord => ({
  address: r.address, launchedAt: r.launched_at.getTime(), pool: r.pool, creator: null, buyers: r.buyers, buys: r.buys,
  devBuyUsd: r.dev_buy_usd, devBuySol: r.dev_buy_sol, blockShare: r.block_share, firstBuyers: r.first_buyers, devSold: r.dev_sold,
  name: null, symbol: null, metadataUri: null, minuteBuys: null,
});

try {
  const first = await readOnly((db) => db.query<{ t: Date | null }>('select min(launched_at) as t from internal.launch_open'));
  const firstMs = first[0]?.t?.getTime() ?? null;
  if (firstMs === null) { log({ msg: 'no launches in the database' }); process.exit(0); }
  const lastHour = Math.floor((Date.now() - SETTLED_MS) / HOUR_MS) * HOUR_MS - HOUR_MS;
  const have = new Set(await archiveList(archive, fetch, 'launches/'));
  const missing: number[] = [];
  for (let h = Math.floor(firstMs / HOUR_MS) * HOUR_MS; h <= lastHour; h += HOUR_MS) if (!have.has(launchesPath(h))) missing.push(h);
  log({ msg: 'hours', first: new Date(firstMs).toISOString(), inBucket: have.size, missing: missing.length, mode: cmd });

  if (cmd === 'run') {
    let copied = 0;
    let rowsCopied = 0;
    for (const h of missing.slice(0, hoursPerRun)) {
      const rows = await readOnly((db) => db.query<Row>(
        `select address, launched_at, pool, buyers, buys, dev_buy_usd, dev_buy_sol, block_share, first_buyers, dev_sold
           from internal.launch_open where launched_at >= $1 and launched_at < $2`,
        [new Date(h).toISOString(), new Date(h + HOUR_MS).toISOString()],
      ));
      const path = launchesPath(h);
      await archivePut(archive, fetch, path, encodeRecords(rows.map(toRecord)), 'application/gzip');
      const back = await archiveGet(archive, fetch, path);
      const n = back === null ? -1 : decodeLaunches(back).length;
      if (n !== rows.length) throw new Error(`${path}: wrote ${rows.length} launches, read back ${n}`);
      copied += 1;
      rowsCopied += rows.length;
      if (copied % 24 === 0) log({ msg: 'progress', hours: copied, launches: rowsCopied, at: path });
      await sleep(PAUSE_MS);
    }
    const grads = await readOnly((db) => db.query<{ address: string; graduated_seen_at: Date }>(
      'select address, graduated_seen_at from internal.launch_open where graduated_seen_at is not null',
    ));
    const gradRecords: GraduationRecord[] = grads.map((g) => ({ address: g.address, seenAt: g.graduated_seen_at.getTime(), pool: null }));
    if (gradRecords.length > 0) await archivePut(archive, fetch, graduationsPath(0).replace('1970-01-01/00', 'from-database'), encodeRecords(gradRecords), 'application/gzip');
    log({ msg: 'done', hours: copied, launches: rowsCopied, graduations: gradRecords.length });
  }
} finally {
  await pool.end();
}
