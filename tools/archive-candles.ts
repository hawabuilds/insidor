/**
 * `node --env-file=.env.local --experimental-strip-types tools/archive-candles.ts [dry | run] [--days N]`
 *
 * EVERY MINUTE CANDLE KEPT FOREVER, IN THE PRIVATE BUCKET `candle-archive` (the owner, 2026-11-03: "i
 * want to keep candles never delete", then "move to cheap storage"; 0163).
 *
 *   dry   the default by hand: which finished UTC days are not yet copied, and their row counts. Reads
 *         only; uploads nothing.
 *   run   copies up to `--days` (default 2) of those days, oldest first: each day's rows of
 *         internal.coin_candle_1m with the coin's address, as gzip JSON lines in parts of at most
 *         PART_BYTES under 1m/<day>/<run>/, each part downloaded again and its SHA-256 and line count
 *         checked, the sum compared with the database's own count of the day before and after, then a
 *         manifest written and the day's row put in internal.candle_archive_day.
 *
 * ★ THIS TOOL NEVER DELETES. Writing the day's row is what lets chainwatch's weekly clean-up (store
 * coin-chart.ts `prune`) remove that day's minute rows from the database once they are over a week
 * old — and only that day's. A day whose copy failed any check gets no row and stays in the database.
 *
 * Same shape and safety as tools/archive-coin-vectors.ts, as its own tool rather than a shared helper:
 * a change made for one must never move the other. A folder per run, because a part re-uploaded to the
 * same path can come back from a cache.
 *
 * What breaks if changed carelessly: the order. The day's row in internal.candle_archive_day is the
 * last thing written, after every part was read back and the counts agreed; and only days that ended
 * SETTLED_MS ago are copied, so no late write to a minute changes it after its copy.
 */

import { createHash } from 'node:crypto';
import process from 'node:process';
import { gunzipSync, gzipSync } from 'node:zlib';

import { asDb, createPool, DB_ROLE, type Db } from '../store/src/index.ts';

const BUCKET = 'candle-archive';
const PREFIX = '1m';
const DAY_MS = 86_400_000;
/** A day is copied only once it ended this long ago: a minute's last deltas land within seconds. */
const SETTLED_MS = 2 * 3_600_000;
/** Rows read per page, along the bucket index. */
const ROWS_PER_READ = 20_000;
/** The largest part uploaded. */
const PART_BYTES = 40_000_000;
const STATEMENT_TIMEOUT_MS = 120_000;

const [cmd = 'dry', ...rest] = process.argv.slice(2);
if (cmd !== 'dry' && cmd !== 'run') throw new Error('usage: archive-candles.ts [dry | run] [--days N]');
const live = cmd === 'run';
const daysAt = rest.indexOf('--days');
const daysPerRun = daysAt === -1 ? 2 : Number(rest[daysAt + 1]);
if (!Number.isInteger(daysPerRun) || daysPerRun < 1) throw new Error('--days needs a whole number of at least 1');

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-archive-candles' });

async function inTransaction<T>(fn: (db: Db) => Promise<T>, write = false): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(write ? 'begin' : 'begin read only');
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
const dayStart = (day: string): string => `${day}T00:00:00Z`;
const dayEnd = (day: string): string => new Date(Date.parse(dayStart(day)) + DAY_MS).toISOString();

async function countDay(day: string): Promise<number> {
  const rows = await inTransaction((db) => db.query<{ n: string }>(`select count(*)::text as n from internal.coin_candle_1m where bucket >= $1 and bucket < $2`, [dayStart(day), dayEnd(day)]));
  return Number(rows[0]?.n ?? 0);
}

/** Finished, settled UTC days that hold minute rows and have no copy yet, oldest first. */
async function daysDue(): Promise<string[]> {
  const rows = await inTransaction((db) =>
    db.query<{ mn: string | null }>(`select to_char(min(bucket) at time zone 'UTC', 'YYYY-MM-DD') as mn from internal.coin_candle_1m`),
  );
  const first = rows[0]?.mn ?? null;
  if (first === null) return [];
  const done = new Set((await inTransaction((db) => db.query<{ d: string }>(`select to_char(day, 'YYYY-MM-DD') as d from internal.candle_archive_day`))).map((r) => r.d));
  const out: string[] = [];
  for (let t = Date.parse(dayStart(first)); t + DAY_MS <= Date.now() - SETTLED_MS; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (!done.has(day)) out.push(day);
  }
  return out;
}

const storageUrl = (process.env['SUPABASE_URL'] ?? '').trim().replace(/\/$/, '');
const storageKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
const auth = { Authorization: `Bearer ${storageKey}`, apikey: storageKey };

async function ensureBucket(): Promise<void> {
  const got = await fetch(`${storageUrl}/storage/v1/bucket/${BUCKET}`, { headers: auth });
  if (got.ok) {
    const b = (await got.json()) as { public?: boolean };
    if (b.public === true) throw new Error(`bucket ${BUCKET} is public; the archive must never be`);
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

interface Row {
  readonly bucket: string;
  readonly coin_id: number;
  readonly line: string;
}

async function archiveDay(day: string): Promise<void> {
  const t0 = Date.now();
  const expected = await countDay(day);
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = `${PREFIX}/${day}/${runStamp}`;
  const files: { path: string; rows: number; bytes: number; sha256: string }[] = [];
  let part: Buffer[] = [];
  let partBytes = 0;
  let partRows = 0;
  const flush = async (): Promise<void> => {
    if (partRows === 0) return;
    const body = Buffer.concat(part);
    const path = `${folder}/part-${String(files.length + 1).padStart(3, '0')}.ndjson.gz`;
    await upload(path, body, 'application/gzip');
    files.push({ path, rows: partRows, bytes: body.byteLength, sha256: sha(body) });
    part = [];
    partBytes = 0;
    partRows = 0;
  };
  /* Keyset along (bucket, coin_id): the bucket index finds the day, the pair is unique. */
  let after: { bucket: string; coinId: number } | null = null;
  for (;;) {
    const cursor = after;
    const rows: readonly Row[] = await inTransaction((db) =>
      db.query<Row>(
        `select m.bucket::text as bucket, m.coin_id,
                json_build_object('address', c.address, 'bucket', to_char(m.bucket at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                  'o', m.o, 'h', m.h, 'l', m.l, 'c', m.c, 'volumeUsd', m.volume_usd,
                                  'buys', m.buys, 'sells', m.sells, 'oMs', m.o_ms, 'cMs', m.c_ms)::text as line
           from internal.coin_candle_1m m join internal.chart_coin c on c.id = m.coin_id
          where m.bucket >= $1 and m.bucket < $2
            and ($3::timestamptz is null or (m.bucket, m.coin_id) > ($3::timestamptz, $4::int))
          order by m.bucket, m.coin_id
          limit $5`,
        [dayStart(day), dayEnd(day), cursor?.bucket ?? null, cursor?.coinId ?? 0, ROWS_PER_READ],
      ),
    );
    if (rows.length === 0) break;
    /* Each page is its own gzip member; members laid end to end are one valid gzip file. */
    const member = gzipSync(Buffer.from(rows.map((r) => r.line).join('\n') + '\n'));
    if (partBytes + member.byteLength > PART_BYTES) await flush();
    part.push(member);
    partBytes += member.byteLength;
    partRows += rows.length;
    const last = rows[rows.length - 1]!;
    after = { bucket: last.bucket, coinId: Number(last.coin_id) };
  }
  await flush();

  /* Read every part back and count it, before the day is marked copied. */
  let verified = 0;
  for (const f of files) {
    const back = await download(f.path);
    if (sha(back) !== f.sha256) throw new Error(`${day}: ${f.path} came back different (sha256); the day is not marked copied`);
    const n = lineCount(back);
    if (n !== f.rows) throw new Error(`${day}: ${f.path} holds ${n} lines, ${f.rows} written; the day is not marked copied`);
    verified += n;
  }
  const again = await countDay(day);
  if (verified !== expected || again !== expected) throw new Error(`${day}: the bucket holds ${verified} rows, the database ${expected} (now ${again}); the day is not marked copied`);
  const bytes = files.reduce((s, f) => s + f.bytes, 0);
  await upload(`${folder}/manifest.json`, Buffer.from(JSON.stringify({ table: 'internal.coin_candle_1m', day, rows: expected, files, archivedAt: new Date().toISOString() }, null, 2)), 'application/json');
  await inTransaction(
    (db) => db.query(`insert into internal.candle_archive_day (day, rows, parts, bytes, folder) values ($1, $2, $3, $4, $5) on conflict (day) do nothing`, [day, expected, files.length, bytes, folder]),
    true,
  );
  log({ msg: 'minute candles copied to the archive', day, rows: expected, parts: files.length, compressedMb: (bytes / 1e6).toFixed(1), folder, seconds: Math.round((Date.now() - t0) / 1000) });
}

try {
  const due = await daysDue();
  if (!live) {
    const counted = [];
    for (const day of due) counted.push({ day, rows: await countDay(day) });
    log({ msg: 'minute candle days not yet copied (dry)', days: counted });
  } else if (due.length === 0) {
    log({ msg: 'every finished day of minute candles is copied' });
  } else if (storageUrl === '' || storageKey === '') {
    log({ level: 'warn', msg: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set; nothing copied', due: due.length });
  } else {
    await ensureBucket();
    for (const day of due.slice(0, daysPerRun)) {
      const rows = await countDay(day);
      if (rows === 0) {
        log({ msg: 'minute candle day holds no rows; nothing to copy', day });
        continue;
      }
      await archiveDay(day);
    }
  }
} finally {
  await pool.end();
}
