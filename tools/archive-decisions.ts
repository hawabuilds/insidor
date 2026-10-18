/**
 * THE DECISION LOG'S OLD DAYS, MOVED TO A PRIVATE BUCKET (the owner, 2026-10-18: "Move the decision
 * log to cheap storage … only then remove that day from the database"). internal.decisions is one
 * partition per UTC day and nothing ever dropped one, so it was 72% of the database's growth
 * (about 0.95 GB a day) and was about to fill the plan's 8 GB disk. The app never reads it.
 *
 * For each day whose partition ended more than `KEEP_DAYS` days ago, in order:
 *   1. every row is written as one JSON line, gzip-compressed, into parts of at most PART_BYTES
 *      (Storage refuses one upload over its file-size limit, so a day is several files plus a
 *      manifest naming them, their row counts and their SHA-256);
 *   2. each part is uploaded to the private bucket `BUCKET` under `<day>/`;
 *   3. each part is downloaded again, its SHA-256 and its line count checked, and the lines summed;
 *   4. only when that sum equals the partition's own count is the manifest written and the
 *      partition dropped. Dropping a partition frees its disk at once: no VACUUM FULL, no rewrite.
 * Any mismatch, upload error or download error stops that day with nothing removed.
 *
 * Why the DROP waits on a short lock_timeout and retries: dropping a partition takes a brief
 * exclusive lock on internal.decisions, and a lock queued behind a long reader would hold every
 * writer behind it. A timed-out attempt costs nothing and is tried again.
 *
 * What breaks if changed carelessly: today's and the last KEEP_DAYS days' partitions, and the
 * default partition, are never touched; the check in step 4 is the only thing standing between
 * this tool and losing a day of the log, so it must compare against the database's own count.
 *
 *   node --env-file=.env.local --experimental-strip-types tools/archive-decisions.ts [--dry] [--keep-days=3]
 */

import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const BUCKET = 'decision-archive';
const KEEP_DAYS_DEFAULT = 3;
const PART_BYTES = 40 * 1024 * 1024;
const BATCH_ROWS = 5000;
const DROP_TRIES = 20;

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};
const dry = process.argv.includes('--dry');
const keepDays = Number(arg('keep-days') ?? KEEP_DAYS_DEFAULT);
if (!Number.isInteger(keepDays) || keepDays < 2) throw new Error('--keep-days must be a whole number of at least 2');

const storageUrl = (process.env['SUPABASE_URL'] ?? '').trim().replace(/\/$/, '');
const storageKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
if (storageUrl === '' || storageKey === '') {
  console.log('archive-decisions: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set; nothing archived');
  process.exit(0);
}
const auth = { Authorization: `Bearer ${storageKey}`, apikey: storageKey };

async function ensureBucket(): Promise<void> {
  const got = await fetch(`${storageUrl}/storage/v1/bucket/${BUCKET}`, { headers: auth });
  if (got.ok) {
    const b = (await got.json()) as { public?: boolean };
    if (b.public === true) throw new Error(`bucket ${BUCKET} is public; the decision log must never be`);
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
  const res = await fetch(`${storageUrl}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': type, 'x-upsert': 'true' },
    body,
  });
  if (!res.ok) throw new Error(`upload ${path} refused: ${res.status} ${await res.text()}`);
}

async function download(path: string): Promise<Buffer> {
  const res = await fetch(`${storageUrl}/storage/v1/object/${BUCKET}/${path}`, { headers: auth });
  if (!res.ok) throw new Error(`download ${path} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const lineCount = (gz: Buffer): number => {
  const text = gunzipSync(gz);
  let n = 0;
  for (const byte of text) if (byte === 10) n++;
  return n;
};

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-archive-decisions' });
const db = asDb(pool);

try {
  const todayMs = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const cutoffMs = todayMs - keepDays * 86_400_000;
  const parts = await db.query<{ relname: string }>(
    `select c.relname from pg_inherits i
       join pg_class c on c.oid = i.inhrelid
       join pg_class p on p.oid = i.inhparent
       join pg_namespace n on n.oid = p.relnamespace
      where n.nspname = 'internal' and p.relname = 'decisions' and c.relname ~ '^decisions_[0-9]{8}$'
      order by c.relname`,
  );
  const due = parts
    .map((r) => ({ name: r.relname, day: `${r.relname.slice(10, 14)}-${r.relname.slice(14, 16)}-${r.relname.slice(16, 18)}` }))
    .filter((p) => Date.parse(`${p.day}T00:00:00Z`) + 86_400_000 <= cutoffMs);
  console.log(`archive-decisions: ${due.length} day(s) older than ${keepDays} days: ${due.map((d) => d.day).join(', ') || 'none'}${dry ? ' (dry run)' : ''}`);
  if (due.length > 0 && !dry) await ensureBucket();

  for (const { name, day } of due) {
    const t0 = Date.now();
    const [{ n: counted = '0', bytes = '0' } = {}] = await db.query<{ n: string; bytes: string }>(`select count(*)::text as n, pg_total_relation_size('internal.${name}')::text as bytes from internal.${name}`);
    const expected = Number(counted);
    if (dry) {
      console.log(`  ${day}: ${expected} rows, ${(Number(bytes) / 1e6).toFixed(0)} MB on disk; would archive and drop`);
      continue;
    }
    const files: { path: string; rows: number; bytes: number; sha256: string }[] = [];
    /* A folder per run: a part re-uploaded to the same path can be served back from a cache, so a
       retried day never reads an earlier attempt's file as its own. */
    const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
    let part: Buffer[] = [];
    let partBytes = 0;
    let partRows = 0;
    const flush = async (): Promise<void> => {
      if (partRows === 0) return;
      const body = Buffer.concat(part);
      const path = `${day}/${runStamp}/part-${String(files.length + 1).padStart(3, '0')}.ndjson.gz`;
      await upload(path, body, 'application/gzip');
      files.push({ path, rows: partRows, bytes: body.byteLength, sha256: sha(body) });
      part = [];
      partBytes = 0;
      partRows = 0;
    };
    let lastId = '-9223372036854775808';
    for (;;) {
      const rows = await db.query<{ id: string; j: string }>(`select id::text as id, row_to_json(d)::text as j from internal.${name} d where d.id > $1::bigint order by d.id limit ${BATCH_ROWS}`, [lastId]);
      if (rows.length === 0) break;
      /* Each batch is its own gzip member; members laid end to end are one valid gzip file. */
      const member = gzipSync(Buffer.from(rows.map((r) => r.j).join('\n') + '\n'));
      if (partBytes + member.byteLength > PART_BYTES) await flush();
      part.push(member);
      partBytes += member.byteLength;
      partRows += rows.length;
      lastId = rows[rows.length - 1]?.id ?? lastId;
    }
    await flush();

    /* Step 3: read every part back and count it, before anything is removed. */
    let verified = 0;
    for (const f of files) {
      const back = await download(f.path);
      if (sha(back) !== f.sha256) throw new Error(`${day}: ${f.path} came back different (sha256); nothing removed`);
      const n = lineCount(back);
      if (n !== f.rows) throw new Error(`${day}: ${f.path} holds ${n} lines, ${f.rows} written; nothing removed`);
      verified += n;
    }
    const [{ n: again = '-1' } = {}] = await db.query<{ n: string }>(`select count(*)::text as n from internal.${name}`);
    if (verified !== expected || Number(again) !== expected) {
      throw new Error(`${day}: the bucket holds ${verified} rows, the database ${expected} (now ${again}); nothing removed`);
    }
    await upload(`${day}/manifest.json`, Buffer.from(JSON.stringify({ table: `internal.${name}`, day, rows: expected, files, archivedAt: new Date().toISOString() }, null, 2)), 'application/json');

    /* Step 4: the partition goes, on a short lock so no writer ever queues behind us. */
    let dropped = false;
    for (let i = 0; i < DROP_TRIES && !dropped; i++) {
      try {
        await db.query(`do $$ begin set local lock_timeout = '3s'; execute 'drop table internal.${name}'; end $$`);
        dropped = true;
      } catch (e) {
        if (!String(e).includes('lock timeout')) throw e;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    if (!dropped) throw new Error(`${day}: archived and checked, but the partition could not be dropped in ${DROP_TRIES} tries; it is kept and the next run drops it`);
    console.log(`  ${day}: ${expected} rows in ${files.length} file(s), ${(files.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(1)} MB compressed, ${(Number(bytes) / 1e6).toFixed(0)} MB freed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
} finally {
  await pool.end();
}
