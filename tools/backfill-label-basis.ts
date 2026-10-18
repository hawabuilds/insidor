/**
 * THE LABEL JOB'S COPY OF THE DAYS ARCHIVED BEFORE IT EXISTED (0103): reads each day of the
 * decision-archive bucket back and writes that day's internal.decision_label_basis rows.
 *
 * Days 12-16 October 2026 were moved to the bucket and dropped by tools/archive-decisions.ts before
 * that tool learned to keep the label job's copy, so services/label lost every subject decided about
 * on them. This puts them back from the archive itself: for each `<day>/manifest.json`, every part
 * it names is downloaded, its SHA-256 checked against the manifest, each NDJSON line fed to the same
 * `LabelBasisDay` the archive tool uses (store label-basis.ts), and the line count checked per part
 * and for the day. Any mismatch stops that day with nothing written.
 *
 * Dry by default: prints per day the rows read, the graded decisions, the subjects the basis would
 * hold, and whether the day is already listed. `--live` writes the rows and switches each day on
 * (source 'backfill'). Writing a day again writes the same values, so a second run changes nothing.
 * Read-only on the bucket: it never uploads or deletes.
 *
 * What breaks if changed carelessly: the SHA-256 check. A part that came back different is a day
 * the label job would grade from rows nobody wrote; without the check that is silent.
 *
 *   node --env-file=.env.local --experimental-strip-types tools/backfill-label-basis.ts [--live] [--day=2026-10-12]
 */

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { LabelBasisDay, writeLabelBasisDay } from '../store/src/repo/label-basis.ts';

const BUCKET = 'decision-archive';

const live = process.argv.includes('--live');
const onlyDay = process.argv.find((a) => a.startsWith('--day='))?.slice('--day='.length) ?? null;

const storageUrl = (process.env['SUPABASE_URL'] ?? '').trim().replace(/\/$/, '');
const storageKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
if (storageUrl === '' || storageKey === '') throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to read the archive');
const auth = { Authorization: `Bearer ${storageKey}`, apikey: storageKey };

interface Manifest {
  readonly table: string;
  readonly day: string;
  readonly rows: number;
  readonly files: readonly { path: string; rows: number; bytes: number; sha256: string }[];
}

async function download(path: string): Promise<Buffer> {
  const res = await fetch(`${storageUrl}/storage/v1/object/${BUCKET}/${path}`, { headers: auth });
  if (!res.ok) throw new Error(`download ${path} failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The bucket's top-level folders that are days. */
async function archivedDays(): Promise<string[]> {
  const res = await fetch(`${storageUrl}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!res.ok) throw new Error(`could not list ${BUCKET}: ${res.status}`);
  const entries = (await res.json()) as { name: string }[];
  return entries.map((e) => e.name).filter((n) => /^\d{4}-\d\d-\d\d$/.test(n)).sort();
}

/** Feeds every line of a gzip part (several gzip members end to end) to the basis; returns the count. */
async function feed(gz: Buffer, basis: LabelBasisDay): Promise<number> {
  const lines = createInterface({ input: Readable.from([gz]).pipe(createGunzip()), crlfDelay: Infinity });
  let n = 0;
  for await (const line of lines) {
    if (line === '') continue;
    basis.addJson(line);
    n += 1;
  }
  return n;
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-backfill-label-basis' });
const db = asDb(pool);

try {
  /* Before 0103 is applied the tables do not exist: a dry run still reads the archive and says so. */
  const applied = (await db.query<{ ok: boolean }>(`select to_regclass('internal.decision_label_basis_day') is not null as ok`))[0]?.ok === true;
  if (!applied && live) throw new Error('migration 0103 is not applied; apply it before --live');
  if (!applied) console.log('backfill-label-basis: migration 0103 is not applied yet; reading the archive only');
  const listed = new Map(
    applied
      ? (await db.query<{ day: string; subjects: number; source: string }>(`select day::text as day, subjects, source from internal.decision_label_basis_day`)).map((r) => [r.day, r])
      : [],
  );
  const days = (await archivedDays()).filter((d) => onlyDay === null || d === onlyDay);
  console.log(`backfill-label-basis: ${days.length} archived day(s): ${days.join(', ') || 'none'}${live ? '' : ' (dry run; --live writes)'}`);

  for (const day of days) {
    const manifest = JSON.parse((await download(`${day}/manifest.json`)).toString('utf8')) as Manifest;
    if (manifest.day !== day) throw new Error(`${day}: the manifest names day ${manifest.day}; nothing written`);
    const basis = new LabelBasisDay(day);
    let read = 0;
    for (const f of manifest.files) {
      const gz = await download(f.path);
      const digest = createHash('sha256').update(gz).digest('hex');
      if (digest !== f.sha256) throw new Error(`${day}: ${f.path} does not match its manifest sha256; nothing written`);
      const n = await feed(gz, basis);
      if (n !== f.rows) throw new Error(`${day}: ${f.path} holds ${n} lines, the manifest says ${f.rows}; nothing written`);
      read += n;
    }
    if (read !== manifest.rows || basis.logRows !== manifest.rows) {
      throw new Error(`${day}: read ${read} rows, the manifest says ${manifest.rows}; nothing written`);
    }
    const before = listed.get(day);
    const note = before === undefined ? 'not yet listed' : `already listed (${before.subjects} subjects, ${before.source})`;
    if (!live) {
      console.log(`  ${day}: ${read} rows, ${basis.decisions} graded, ${basis.size} subjects; ${note}; would write`);
      continue;
    }
    const w = await writeLabelBasisDay(db, basis, 'backfill');
    console.log(`  ${day}: ${read} rows, ${w.decisions} graded, ${w.subjects} subjects written and switched on (${note} before)`);
  }
  if (applied) {
    const [size] = await db.query<{ rows: string; bytes: string }>(
      `select (select count(*) from internal.decision_label_basis)::text as rows, pg_total_relation_size('internal.decision_label_basis')::text as bytes`,
    );
    console.log(`  internal.decision_label_basis: ${size?.rows ?? '?'} rows, ${(Number(size?.bytes ?? 0) / 1e6).toFixed(1)} MB`);
  }
} finally {
  await pool.end();
}
