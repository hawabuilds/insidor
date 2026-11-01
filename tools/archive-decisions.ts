/**
 * THE DECISION LOG'S OLD DAYS, MOVED TO A PRIVATE BUCKET (the owner, 2026-10-18: "Move the decision
 * log to cheap storage … only then remove that day from the database"). internal.decisions is one
 * partition per UTC day and nothing ever dropped one, so it was 72% of the database's growth
 * (about 0.95 GB a day) and was about to fill the plan's 8 GB disk. The app never reads it.
 *
 * For each day whose partition ended more than `KEEP_DAYS` days ago (1, the owner, 2026-10-18: "keep only 1 day in the database"), in order:
 *   1. every row is written as one JSON line, gzip-compressed, into parts of at most PART_BYTES
 *      (Storage refuses one upload over its file-size limit, so a day is several files plus a
 *      manifest naming them, their row counts and their SHA-256);
 *   2. each part is uploaded to the private bucket `BUCKET` under `<day>/`;
 *   3. each part is downloaded again, its SHA-256 and its line count checked, and the lines summed;
 *   4. only when that sum equals the partition's own count is the manifest written and the
 *      partition dropped. Dropping a partition frees its disk at once: no VACUUM FULL, no rewrite.
 *
 * ★ AND BEFORE ANY OF THAT LEAVES THE DATABASE, THE LABEL JOB'S COPY (the owner, 2026-10-18:
 * "Before each day of the decision log is archived, copy just the columns the 30-day label job
 * needs into a small table that stays in the database"). The same pass that writes the parts feeds
 * each row to a `LabelBasisDay` (store label-basis.ts); after the parts are uploaded, its rows are
 * written to internal.decision_label_basis in short batches, counted back, and the day switched on
 * in internal.decision_label_basis_day. Its counts must equal the partition's, or nothing is
 * dropped. A day already switched on and dropped is never revisited, so this is written once a day.
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
import { LABEL_BASIS_COLUMNS, LABEL_BASIS_KINDS, LabelBasisDay, writeLabelBasisDay } from '../store/src/repo/label-basis.ts';
import type { LabelBasisSource } from '../store/src/repo/label-basis.ts';

const BUCKET = 'decision-archive';
const KEEP_DAYS_DEFAULT = 1;
const PART_BYTES = 40 * 1024 * 1024;
const BATCH_ROWS = 5000;
const DROP_TRIES = 20;

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};
const dry = process.argv.includes('--dry');
const keepDays = Number(arg('keep-days') ?? KEEP_DAYS_DEFAULT);
if (!Number.isInteger(keepDays) || keepDays < 1) throw new Error('--keep-days must be a whole number of at least 1');

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

/*
 * ★ THE WHOLE-DAY COUNTS GET THEIR OWN TIME LIMIT (2026-11-01). A day's partition is 1.3-2.1 GB and
 * each count reads all of it; on a disk-bound database that takes longer than the login's 5-minute
 * statement limit (`alter role postgres set statement_timeout = 300s`), and the limit this pool asks
 * for at connect is dropped by the pooler (store client.ts). From 24 Oct every hourly run was
 * cancelled at its first count (ok=false ms=300527), nothing was archived, and eight days (13 GB)
 * piled up in the database, which made the next count slower still. The counts are the safety check
 * (step 4), so they are kept and given time instead: each runs in its own short transaction with the
 * limit raised by SET LOCAL, which holds in the pooler's transaction mode (the server's) and session
 * mode (a laptop's) alike, and ends with the count.
 */
const COUNT_LIMIT = '30min';
const DAYS_PER_RUN = 1;
const longCount = async <T extends Record<string, string>>(sql: string, params: unknown[] = []): Promise<T[]> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local statement_timeout = '${COUNT_LIMIT}'`);
    const rows = (await client.query(sql, params)).rows as T[];
    await client.query('commit');
    return rows;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
};

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

  /* ★ ONE DAY PER RUN (the owner, 2026-11-01: "i want the app working and fixes made same time"). After
     the 24 Oct - 1 Nov stall, seven 1.3-2.1 GB days were due at once; moving them in one run would hold
     the disk for hours while the runner competes for it. One day per hourly run spreads the catch-up
     over the day. Caught up, one day falls due a day, so this changes nothing in normal running. */
  for (const { name, day } of due.slice(0, DAYS_PER_RUN)) {
    const t0 = Date.now();
    const [{ n: counted = '0', bytes = '0' } = {}] = await longCount<{ n: string; bytes: string }>(`select count(*)::text as n, pg_total_relation_size('internal.${name}')::text as bytes from internal.${name}`);
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
    const basis = new LabelBasisDay(day);
    let lastId = '-9223372036854775808';
    for (;;) {
      const rows = await db.query<{ id: string; j: string } & LabelBasisSource>(`select id::text as id, row_to_json(d)::text as j, ${LABEL_BASIS_COLUMNS} from internal.${name} d where d.id > $1::bigint order by d.id limit ${BATCH_ROWS}`, [lastId]);
      if (rows.length === 0) break;
      for (const r of rows) basis.addRow(r);
      /* Each batch is its own gzip member; members laid end to end are one valid gzip file. */
      const member = gzipSync(Buffer.from(rows.map((r) => r.j).join('\n') + '\n'));
      if (partBytes + member.byteLength > PART_BYTES) await flush();
      part.push(member);
      partBytes += member.byteLength;
      partRows += rows.length;
      lastId = rows[rows.length - 1]?.id ?? lastId;
    }
    await flush();

    /* The label job's copy, checked against the partition's own counts before anything is removed. */
    const [{ graded = '-1' } = {}] = await longCount<{ graded: string }>(`select count(*)::text as graded from internal.${name} where subject_kind = any($1::text[])`, [LABEL_BASIS_KINDS]);
    if (basis.logRows !== expected || basis.decisions !== Number(graded)) {
      throw new Error(`${day}: read ${basis.logRows} rows (${basis.decisions} graded) for the label basis, the partition holds ${expected} (${graded}); nothing removed`);
    }
    const kept = await writeLabelBasisDay(db, basis, 'archive');
    const [{ basisBytes = '0' } = {}] = await db.query<{ basisBytes: string }>(`select pg_total_relation_size('internal.decision_label_basis')::text as "basisBytes"`);

    /* Step 3: read every part back and count it, before anything is removed. */
    let verified = 0;
    for (const f of files) {
      const back = await download(f.path);
      if (sha(back) !== f.sha256) throw new Error(`${day}: ${f.path} came back different (sha256); nothing removed`);
      const n = lineCount(back);
      if (n !== f.rows) throw new Error(`${day}: ${f.path} holds ${n} lines, ${f.rows} written; nothing removed`);
      verified += n;
    }
    const [{ n: again = '-1' } = {}] = await longCount<{ n: string }>(`select count(*)::text as n from internal.${name}`);
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
    console.log(`  ${day}: ${expected} rows in ${files.length} file(s), ${(files.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(1)} MB compressed, ${(Number(bytes) / 1e6).toFixed(0)} MB freed, ${((Date.now() - t0) / 1000).toFixed(0)} s; label basis kept ${kept.subjects} subjects for ${kept.decisions} decisions (table now ${(Number(basisBytes) / 1e6).toFixed(1)} MB)`);
  }
} finally {
  await pool.end();
}
