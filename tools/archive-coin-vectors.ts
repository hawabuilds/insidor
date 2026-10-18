/**
 * `node --env-file=.env.local --experimental-strip-types tools/archive-coin-vectors.ts [dry | run] [--as-of <ISO time>]`
 *
 * COIN PICTURE VECTORS: 30 DAYS IN THE DATABASE, THE REST IN A PRIVATE BUCKET (the owner, 2026-10-18;
 * the rule is Policy.coinVectors, the queries store coin-vectors.ts). Coin vectors were about 84 MB of
 * internal.image_embedding's ~112 MB a day.
 *
 *   dry   the default by hand: what a run would delete and archive, read inside a READ ONLY
 *         transaction, so it cannot write whatever the code does. Nothing is uploaded either.
 *         `--as-of` pretends it is then, to see a future day's run.
 *   run   the live run, scheduled hourly by the projector service (tools/railway-start.mjs):
 *           each UTC day of coin vectors embedded wholly before now − `keepMs`, oldest first,
 *         `daysPerRun` a run — written as gzip JSON lines in parts of at most `partBytes` to the
 *         private bucket `vector-archive` under coin/<day>/<run>/, each part downloaded again and its
 *         SHA-256 and line count checked, the sum compared with the database's own count of the day,
 *         and only then a manifest written and the day's rows deleted in batches. Any mismatch or
 *         error stops that day with nothing deleted.
 *
 * The same safety as tools/archive-decisions.ts, as its own tool rather than a shared helper: that
 * file drops partitions and this one deletes rows, and a change made for one must never move the
 * other. A folder per run, because a part re-uploaded to the same path can come back from a cache.
 *
 * ★ A DELETE DOES NOT HAND DISK BACK. The rows' space (nearly all of it the vectors' out-of-line
 * storage) is reused by autovacuum for the next rows written, so the table stops GROWING once a day
 * leaves for every day that arrives; its size on disk does not drop without VACUUM FULL or pg_repack.
 * There is no nearest-neighbour index on the table (only its primary key), so a delete costs no
 * index rebuild.
 *
 * What breaks if changed carelessly: the order of the steps. The delete is the last thing, after
 * the bucket's copy is read back and counted; and only days wholly older than `keepMs` are touched —
 * the tool refuses a `keepMs` shorter than the origin check's windows.
 */

import { createHash } from 'node:crypto';
import process from 'node:process';
import { gunzipSync, gzipSync } from 'node:zlib';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { Millis } from '../contracts/src/index.ts';
import { asDb, createPool, DB_ROLE, PgCoinVectorRepo, type CoinVectorKey, type Db } from '../store/src/index.ts';

const BUCKET = 'vector-archive';
const PREFIX = 'coin';
const P = DEFAULT_POLICY.coinVectors;
const DAY_MS = 86_400_000;

const [cmd = 'dry', ...rest] = process.argv.slice(2);
if (cmd !== 'dry' && cmd !== 'run') {
  console.error('usage: tools/archive-coin-vectors.ts [dry | run] [--as-of <ISO time>]');
  process.exit(2);
}
const live = cmd === 'run';
const asOfAt = rest.indexOf('--as-of');
const now = (asOfAt === -1 ? Date.now() : Date.parse(rest[asOfAt + 1] ?? '')) as Millis;
if (!Number.isFinite(now)) throw new Error('--as-of needs an ISO time');
if (live && asOfAt !== -1) throw new Error('--as-of is for a dry run only');

/* The 30 days must cover every reader of a coin's vector (Policy.coinVectors). */
const longestReader = Math.max(DEFAULT_POLICY.universe.lookbackMs + DEFAULT_POLICY.universe.recheckAfterMs, DEFAULT_POLICY.universe.matchWindowMs);
if (P.keepMs < longestReader) throw new Error(`coinVectors.keepMs (${P.keepMs}) is shorter than the origin check's window (${longestReader}); nothing done`);

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-archive-coin-vectors' });

/** One short transaction with the policy's lock and statement limits; READ ONLY on a dry run. */
async function inTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(live ? 'begin' : 'begin read only');
    await client.query(`set local lock_timeout = ${Math.round(P.lockTimeoutMs)}`);
    await client.query(`set local statement_timeout = ${Math.round(P.statementTimeoutMs)}`);
    const out = await fn(asDb(client));
    await client.query(live ? 'commit' : 'rollback');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const log = (fields: Record<string, unknown>): void => console.log(JSON.stringify({ level: 'info', ...fields }));

/** On-disk bytes per row of the table, its out-of-line vectors and index included. */
async function bytesPerRow(): Promise<number> {
  const rows = await asDb(pool).query<{ b: string | null }>(
    `select (pg_total_relation_size(c.oid)::float8 / nullif(greatest(c.reltuples, 0), 0))::text as b from pg_class c where c.oid = to_regclass('internal.image_embedding')`,
  );
  return Number(rows[0]?.b ?? 0);
}

/* ── days older than keepMs, to the bucket, checked, then deleted ───────────────── */

const storageUrl = (process.env['SUPABASE_URL'] ?? '').trim().replace(/\/$/, '');
const storageKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
const auth = { Authorization: `Bearer ${storageKey}`, apikey: storageKey };

async function ensureBucket(): Promise<void> {
  const got = await fetch(`${storageUrl}/storage/v1/bucket/${BUCKET}`, { headers: auth });
  if (got.ok) {
    const b = (await got.json()) as { public?: boolean };
    if (b.public === true) throw new Error(`bucket ${BUCKET} is public; the vectors must never be`);
    return;
  }
  const made = await fetch(`${storageUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (!made.ok) throw new Error(`could not create bucket ${BUCKET}: ${made.status} ${await made.text()}`);
}

async function upload(path: string, body: Buffer, type: string): Promise<void> {
  const res = await fetch(`${storageUrl}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { ...auth, 'Content-Type': type, 'x-upsert': 'true' }, body: new Uint8Array(body) });
  if (!res.ok) throw new Error(`upload ${path} refused: ${res.status} ${await res.text()}`);
}

async function download(path: string): Promise<Buffer> {
  const res = await fetch(`${storageUrl}/storage/v1/object/${BUCKET}/${path}`, { headers: auth });
  if (!res.ok) throw new Error(`download ${path} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const lineCount = (gz: Buffer): number => {
  let n = 0;
  for (const byte of gunzipSync(gz)) if (byte === 10) n++;
  return n;
};

async function archiveDay(day: string): Promise<void> {
  const t0 = Date.now();
  const expected = await inTransaction((db) => new PgCoinVectorRepo(db).countDay(day));
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const files: { path: string; rows: number; bytes: number; sha256: string }[] = [];
  let part: Buffer[] = [];
  let partBytes = 0;
  let partRows = 0;
  const flush = async (): Promise<void> => {
    if (partRows === 0) return;
    const body = Buffer.concat(part);
    const path = `${PREFIX}/${day}/${runStamp}/part-${String(files.length + 1).padStart(3, '0')}.ndjson.gz`;
    await upload(path, body, 'application/gzip');
    files.push({ path, rows: partRows, bytes: body.byteLength, sha256: sha(body) });
    part = [];
    partBytes = 0;
    partRows = 0;
  };
  let after: CoinVectorKey | null = null;
  for (;;) {
    const cursor: CoinVectorKey | null = after;
    const rows: readonly { readonly key: CoinVectorKey; readonly json: string }[] = await inTransaction((db) => new PgCoinVectorRepo(db).dayPage(day, cursor, P.rowsPerRead));
    if (rows.length === 0) break;
    /* Each page is its own gzip member; members laid end to end are one valid gzip file. */
    const member = gzipSync(Buffer.from(rows.map((r) => r.json).join('\n') + '\n'));
    if (partBytes + member.byteLength > P.partBytes) await flush();
    part.push(member);
    partBytes += member.byteLength;
    partRows += rows.length;
    after = rows[rows.length - 1]?.key ?? after;
  }
  await flush();

  /* Read every part back and count it, before anything is removed. */
  let verified = 0;
  for (const f of files) {
    const back = await download(f.path);
    if (sha(back) !== f.sha256) throw new Error(`${day}: ${f.path} came back different (sha256); nothing removed`);
    const n = lineCount(back);
    if (n !== f.rows) throw new Error(`${day}: ${f.path} holds ${n} lines, ${f.rows} written; nothing removed`);
    verified += n;
  }
  /* No row is ever written with an old embedded_at, so a day this old cannot gain rows; a count that
     moved means something else touched it, and the day waits. */
  const again = await inTransaction((db) => new PgCoinVectorRepo(db).countDay(day));
  if (verified !== expected || again !== expected) throw new Error(`${day}: the bucket holds ${verified} rows, the database ${expected} (now ${again}); nothing removed`);
  await upload(`${PREFIX}/${day}/${runStamp}/manifest.json`, Buffer.from(JSON.stringify({ table: 'internal.image_embedding', subjectKind: 'asset', day, rows: expected, files, archivedAt: new Date().toISOString() }, null, 2)), 'application/json');

  let deleted = 0;
  for (;;) {
    let n: number;
    try {
      n = await inTransaction((db) => new PgCoinVectorRepo(db).deleteDayBatch(day, P.rowsPerDelete));
    } catch (e) {
      throw new Error(`${day}: archived and checked, ${deleted} of ${expected} deleted, then a batch did not finish (${e instanceof Error ? e.message : String(e)}); the next run archives the rest again and deletes it`);
    }
    if (n === 0) break;
    deleted += n;
  }
  log({ msg: 'coin vectors archived', day, rows: expected, files: files.length, compressedMb: (files.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(1), deleted, seconds: Math.round((Date.now() - t0) / 1000) });
}

async function archive(): Promise<void> {
  /* Whole UTC days only: a day is due when it ended before now − keepMs. */
  const before = (Math.floor((now - P.keepMs) / DAY_MS) * DAY_MS) as Millis;
  const days = await inTransaction((db) => new PgCoinVectorRepo(db).daysBefore(before, P.daysPerRun));
  if (!live) {
    const perRow = await bytesPerRow();
    log({ msg: 'coin vector days due for the archive (dry)', before: new Date(before).toISOString(), days: days.map((d) => ({ day: d.day, rows: d.rows, mb: ((d.rows * perRow) / 1e6).toFixed(0) })) });
    return;
  }
  if (days.length === 0) {
    log({ msg: 'no coin vector day is due for the archive', before: new Date(before).toISOString() });
    return;
  }
  if (storageUrl === '' || storageKey === '') {
    log({ level: 'warn', msg: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set; nothing archived', due: days.length });
    return;
  }
  await ensureBucket();
  for (const { day } of days) await archiveDay(day);
}

try {
  await archive();
} finally {
  await pool.end();
}
