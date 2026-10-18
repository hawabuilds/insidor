/**
 * THE COIN LOGOS THE APP WILL NEVER SHOW, LISTED, THE LIST KEPT, THEN REMOVED (the owner,
 * 2026-10-18: "Remove ones we'll never show, after copying the list"). Until that day the logo
 * mirror copied a picture for every coin we hold, so about 115,000 of the bucket's 120,000 logos,
 * about 5.8 GB, are coins no surface draws. The mirror now copies only the shown set
 * (services/project/src/coin-logos.ts SHOWN_PARTS); this removes what it copied before.
 *
 * DRY BY DEFAULT. Without `--live` it reads the database and the bucket's listing, writes the full
 * list (path, coin, bytes, reason) as CSV and JSON into `--out` (the current folder by default),
 * prints the counts, and changes nothing anywhere.
 *
 * With `--live`, in order, stopping at the first failure:
 *   1. the list is uploaded to the PRIVATE bucket `logo-archive-lists` (created private if missing;
 *      refused if it is public), read back, and its SHA-256 compared: nothing is deleted before the
 *      list is safely kept;
 *   2. the files are deleted in batches of `--batch` (500). Before each batch the shown set is read
 *      again, and a coin that has become shown since the list was made is left alone; each path is
 *      checked against the two logo shapes once more just before it is sent;
 *   3. the mirror's ledger rows of the coins whose logo was removed are deleted, so a coin shown
 *      later is copied again instead of being taken as stored (internal.coin_logo).
 *
 * ★ ONLY LOGO PATHS. The same public bucket holds every Insidor coin's launch picture and metadata
 * document at its root, which the chain points at forever, and the posters' faces under
 * author-pics/. Only `coin-logos/<address>` and `coin-logos/64/<address>` are listed, and only
 * those can be deleted (logo-prune.ts LOGO_PATH); the root and author-pics/ are never even listed.
 *
 * ★ IT REFUSES TO RUN ON A PARTIAL PICTURE OF THE APP. The shown set must include the watchlist
 * (the people schema readable), and the frame, the scroll and the coin lists must not be empty: a
 * projector caught mid-outage would otherwise make nearly every logo look unshown. A file written
 * in the last `--min-age-hours` (24) is kept, so a coin the next frame shows is not caught.
 *
 * What breaks if changed carelessly: step order. The list is the only record of what was removed;
 * deleting before it is uploaded and verified loses that record.
 *
 *   node --env-file=.env.local --experimental-strip-types tools/logo-prune.ts [--live] [--out=<dir>] [--min-age-hours=24] [--batch=500]
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { peopleReadable, shownSetSql } from '../services/project/src/coin-logos.ts';
import { assertLogoPath, logoCoin, planRemoval, removalCsv, type StoredFile } from '../services/project/src/logo-prune.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const BUCKET = 'launch-metadata';
const LIST_BUCKET = 'logo-archive-lists';
/** The only folders listed. Never the bucket's root: the launch files live there. */
const FOLDERS = ['coin-logos/', 'coin-logos/64/'] as const;
const PAGE = 1000;
/** The storage API takes at most 1000 paths in one delete. */
const MAX_BATCH = 1000;

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};
const live = process.argv.includes('--live');
const outDir = arg('out') ?? '.';
const minAgeHours = Number(arg('min-age-hours') ?? 24);
const batchSize = Number(arg('batch') ?? 500);
if (!Number.isFinite(minAgeHours) || minAgeHours < 1) throw new Error('--min-age-hours must be at least 1');
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) throw new Error(`--batch must be a whole number from 1 to ${MAX_BATCH}`);

const storageUrl = (process.env['SUPABASE_URL'] ?? '').trim().replace(/\/+$/, '');
const storageKey = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').trim();
if (storageUrl === '' || storageKey === '') throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set: the bucket is listed with the service key');
const auth = { Authorization: `Bearer ${storageKey}`, apikey: storageKey };

interface ListEntry {
  readonly name: string;
  readonly id: string | null;
  readonly updated_at?: string | null;
  readonly created_at?: string | null;
  readonly metadata?: { readonly size?: number } | null;
}

async function listFolder(prefix: string): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${storageUrl}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`listing ${prefix} at ${offset} failed: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as ListEntry[];
    for (const e of page) {
      if (e.id === null) continue; /* a folder, such as 64/ inside coin-logos/ */
      const written = Date.parse(e.updated_at ?? e.created_at ?? '');
      out.push({ path: `${prefix}${e.name}`, bytes: e.metadata?.size ?? 0, writtenMs: Number.isFinite(written) ? written : null });
    }
    if (page.length < PAGE) return out;
  }
}

const pool = createPool(DB_ROLE.service, { applicationName: 'insidor-logo-prune', env: { DATABASE_URL_SERVICE: process.env['DATABASE_URL_SERVICE'] || process.env['DATABASE_URL'] } });
const db = asDb(pool);

/** The shown set now, or a refusal when the picture of the app is partial. */
async function shownSet(): Promise<Set<string>> {
  if (!(await peopleReadable(db))) throw new Error('the watchlist tables (people.watch_coin, people.post_watch, people.alert) are not readable with this database URL; refusing, since their coins would look unshown');
  for (const table of ['public.rising_row', 'public.feed_post', 'public.same_name_coin']) {
    const [row] = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    if ((row?.n ?? 0) === 0) throw new Error(`${table} is empty; refusing, since a projector mid-outage would make nearly every logo look unshown`);
  }
  const rows = await db.query<{ address: string }>(`select distinct address from (${shownSetSql(true)}) s(address) where address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`);
  return new Set(rows.map((r) => r.address));
}

async function ensurePrivateBucket(): Promise<void> {
  const got = await fetch(`${storageUrl}/storage/v1/bucket/${LIST_BUCKET}`, { headers: auth });
  if (got.ok) {
    const b = (await got.json()) as { public?: boolean };
    if (b.public !== false) throw new Error(`bucket ${LIST_BUCKET} is not private; the list is not uploaded there`);
    return;
  }
  const made = await fetch(`${storageUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: LIST_BUCKET, name: LIST_BUCKET, public: false }),
  });
  if (!made.ok) throw new Error(`could not create bucket ${LIST_BUCKET}: ${made.status} ${await made.text()}`);
}

async function keepList(path: string, body: Buffer, type: string): Promise<void> {
  const put = await fetch(`${storageUrl}/storage/v1/object/${LIST_BUCKET}/${path}`, { method: 'POST', headers: { ...auth, 'Content-Type': type, 'x-upsert': 'false' }, body });
  if (!put.ok) throw new Error(`upload of ${path} refused: ${put.status} ${await put.text()}`);
  const back = await fetch(`${storageUrl}/storage/v1/object/${LIST_BUCKET}/${path}`, { headers: auth });
  if (!back.ok) throw new Error(`read-back of ${path} failed: ${back.status}`);
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  if (sha(Buffer.from(await back.arrayBuffer())) !== sha(body)) throw new Error(`read-back of ${path} does not match what was uploaded`);
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

try {
  const nowMs = Date.now();
  const shown = await shownSet();
  const held = new Set((await db.query<{ address: string }>(`select address from public.coin_name union select address from public.asset where chain = 'solana'`)).map((r) => r.address));
  const files: StoredFile[] = [];
  for (const folder of FOLDERS) for (const f of await listFolder(folder)) files.push(f);
  const plan = planRemoval(files, shown, held, nowMs, minAgeHours * 3_600_000);
  const removeBytes = plan.remove.reduce((s, r) => s + r.bytes, 0);
  const byReason = new Map<string, number>();
  for (const r of plan.remove) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);

  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const summary = {
    at: new Date(nowMs).toISOString(),
    live,
    minAgeHours,
    shownCoins: shown.size,
    files: files.length,
    bytes: files.reduce((s, f) => s + f.bytes, 0),
    keptShown: plan.keptShown,
    keptYoung: plan.keptYoung,
    remove: { files: plan.remove.length, bytes: removeBytes, byReason: Object.fromEntries(byReason) },
    skippedNotLogoPaths: plan.skipped,
  };
  mkdirSync(outDir, { recursive: true });
  const csv = Buffer.from(removalCsv(plan.remove));
  const json = Buffer.from(JSON.stringify({ summary, remove: plan.remove }));
  const csvPath = join(outDir, `logo-prune-${stamp}.csv`);
  writeFileSync(csvPath, csv);
  writeFileSync(join(outDir, `logo-prune-${stamp}.json`), json);

  console.log(`logo-prune${live ? '' : ' (dry run: nothing is changed)'}`);
  console.log(`  listed       ${files.length} files under ${FOLDERS.join(' and ')}, ${mb(summary.bytes)}`);
  console.log(`  shown coins  ${shown.size}; their files kept: ${plan.keptShown.files}, ${mb(plan.keptShown.bytes)}`);
  console.log(`  kept young   ${plan.keptYoung.files} written in the last ${minAgeHours} h, ${mb(plan.keptYoung.bytes)}`);
  console.log(`  to remove    ${plan.remove.length} files, ${mb(removeBytes)}: ${[...byReason].map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log(`  not a logo   ${plan.skipped.length} (never removed)`);
  console.log(`  list         ${csvPath} (+ .json)`);
  if (live) await removeAll(plan.remove, csv, json, stamp);
} finally {
  await pool.end();
}

async function removeAll(remove: ReturnType<typeof planRemoval>['remove'], csv: Buffer, json: Buffer, stamp: string): Promise<void> {
  await ensurePrivateBucket();
  await keepList(`${stamp}/logo-prune.csv`, csv, 'text/csv');
  await keepList(`${stamp}/logo-prune.json`, json, 'application/json');
  console.log(`  list kept    ${LIST_BUCKET}/${stamp}/logo-prune.csv and .json, read back and matched`);

  let removed = 0;
  let removedBytes = 0;
  let spared = 0;
  const gone = new Set<string>();
  for (let i = 0; i < remove.length; i += batchSize) {
    const now = await shownSet();
    const batch = remove.slice(i, i + batchSize).filter((r) => {
      if (!now.has(r.coin)) return true;
      spared += 1;
      return false;
    });
    if (batch.length === 0) continue;
    for (const r of batch) {
      assertLogoPath(r.path);
      if (logoCoin(r.path) !== r.coin) throw new Error(`path ${r.path} is not coin ${r.coin}'s`);
    }
    const res = await fetch(`${storageUrl}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: batch.map((r) => r.path) }),
    });
    if (!res.ok) throw new Error(`delete batch at ${i} refused: ${res.status} ${await res.text()}`);
    const deleted = new Set(((await res.json()) as { name?: string }[]).flatMap((o) => (typeof o.name === 'string' ? [o.name] : [])));
    for (const r of batch) {
      if (!deleted.has(r.path)) continue;
      removed += 1;
      removedBytes += r.bytes;
      if (!r.path.startsWith('coin-logos/64/')) gone.add(r.coin);
    }
    console.log(`  removed      ${removed} of ${remove.length} (${mb(removedBytes)})${spared > 0 ? `, ${spared} spared: shown since the list was made` : ''}`);
    if (removed === 0 && i + batchSize >= Math.min(remove.length, 3 * batchSize)) throw new Error('the storage API reports nothing deleted in the first batches; stopping to look');
  }
  const coins = [...gone];
  for (let i = 0; i < coins.length; i += PAGE) {
    await db.query(`delete from internal.coin_logo where outcome = 'stored' and address = any($1::text[])`, [coins.slice(i, i + PAGE)]);
  }
  console.log(`  ledger       ${coins.length} coins no longer recorded as stored; the mirror copies one again if it is shown`);
}
