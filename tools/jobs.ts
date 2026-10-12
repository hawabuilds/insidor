/**
 * THE ONE-OFF PAID JOB: the stages that are left, in order, on a host that is not a laptop, and
 * then it stops.
 *
 *   node --env-file=.env.local --experimental-strip-types tools/jobs.ts push    laptop → database: the files the job starts from
 *   node --experimental-strip-types tools/jobs.ts run                           (Railway `jobs`) restore, run every stage, save, exit 0
 *   node --env-file=.env.local --experimental-strip-types tools/jobs.ts status  what ran, what it cost, when each file was saved
 *   node --env-file=.env.local --experimental-strip-types tools/jobs.ts pull    database → laptop: the files, to commit
 *
 * The stages: gold pictures (resumes: each coin is saved as it is read), picture pairs, the origin
 * eval report, the history pilot (`run --yes`; $25 in total across every run, internal.history_spend).
 *
 * ★ A CONTAINER'S FILES DIE WITH IT. Every file a stage writes is copied to internal.job_file
 * (0045) every thirty seconds while it runs and once more when it ends; `run` restores them before
 * the first stage. So a job stopped halfway, or redeployed, starts from what was saved and does
 * not pay for a picture twice — and the results are still there after the container is gone.
 *
 * ★ IT EXITS 0, ALWAYS, AND A FINISHED STAGE IS NEVER RUN AGAIN. Railway restarts a service on a
 * failed exit; a job that failed its last stage would otherwise be restarted ten times. A stage
 * that fails is retried once, recorded as failed in jobs/status.json, and the next stage runs.
 * A redeploy reads the status and skips what is done, so a finished job exits at once.
 *
 * ★ MONEY. Each stage spends under its own cap AND the owner's daily lines on the runner's ledger
 * (tools/lib/shared-meter.ts), so this job and the live runner together stay inside the day's
 * lines. Stages refuse to spend unless SPEND=live is set on this service.
 *
 * What breaks if changed carelessly: the restore must run before any stage. A stage started on
 * the repo's copy of coin-evidence.json would redo every picture since that commit.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { asDb, createPool, DB_ROLE, PgJobFileRepo } from '../store/src/index.ts';

const ROOT = join(import.meta.dirname, '..');
/** Every file a stage reads to resume or writes as a result. Repo-relative. */
const FILES = [
  'eval/src/gold/coin-evidence.json',
  'eval/src/gold/origin-eval-report.md',
  'var/history/coins.json',
  'var/history/vectors.json',
  'var/history/pairs.json',
] as const;
const STATUS = 'jobs/status.json';
const STAGES = [
  { name: 'gold-pictures', args: ['tools/gold-fetch.ts', 'images', '--yes'] },
  { name: 'gold-pairs', args: ['tools/gold-fetch.ts', 'pairs', '--yes'] },
  { name: 'eval-report', args: ['eval/src/gold/run-origin-eval.ts'] },
  { name: 'history-pilot', args: ['tools/history-pilot.ts', 'run', '--yes'] },
] as const;
const SYNC_MS = 30_000;
/** The end of a stage's output kept in the database: enough for its summary and its last error. */
const LOG_KEEP = 200_000;
const ATTEMPTS = 2;

interface StageStatus {
  readonly state: 'running' | 'done' | 'failed';
  readonly exit: number | null;
  readonly attempts: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
}
type Status = Record<string, StageStatus>;

const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-jobs' });
const files = new PgJobFileRepo(asDb(pool));
const abs = (path: string) => join(ROOT, path);

const seen = new Map<string, number>();
async function save(path: string, force = false): Promise<boolean> {
  if (!existsSync(abs(path))) return false;
  const mtime = statSync(abs(path)).mtimeMs;
  if (!force && seen.get(path) === mtime) return false;
  await files.put(path, readFileSync(abs(path), 'utf8'));
  seen.set(path, mtime);
  return true;
}
const saveAll = async (force = false) => {
  for (const path of FILES) await save(path, force);
};

async function restore(): Promise<void> {
  for (const path of FILES) {
    const held = await files.get(path);
    if (held === null) continue;
    mkdirSync(dirname(abs(path)), { recursive: true });
    writeFileSync(abs(path), held.body);
    seen.set(path, statSync(abs(path)).mtimeMs);
    console.log(`restored ${path} (saved ${held.savedAt.toISOString()})`);
  }
}

async function readStatus(): Promise<Status> {
  const held = await files.get(STATUS);
  return held === null ? {} : (JSON.parse(held.body) as Status);
}

function runStage(args: readonly string[], log: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', ...args], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (chunk: Buffer, to: NodeJS.WriteStream) => {
      to.write(chunk);
      log.push(chunk.toString('utf8'));
    };
    child.stdout.on('data', (c: Buffer) => keep(c, process.stdout));
    child.stderr.on('data', (c: Buffer) => keep(c, process.stderr));
    for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => child.kill(signal));
    child.on('exit', (code, signal) => resolve(code ?? (signal === null ? 0 : 1)));
  });
}

async function run(): Promise<void> {
  let current = 'starting';
  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, stage: current }));
  }).listen(Number(process.env['PORT'] || 8080)).unref();

  await restore();
  const status = await readStatus();
  const putStatus = async () => files.put(STATUS, `${JSON.stringify(status, null, 1)}\n`);

  for (const stage of STAGES) {
    if (status[stage.name]?.state === 'done') {
      console.log(`${stage.name}: done before, skipped`);
      continue;
    }
    current = stage.name;
    const startedAt = new Date().toISOString();
    const log: string[] = [];
    let exit = 1;
    let attempts = 0;
    while (attempts < ATTEMPTS && exit !== 0) {
      attempts += 1;
      status[stage.name] = { state: 'running', exit: null, attempts, startedAt, endedAt: null };
      await putStatus();
      console.log(`=== ${stage.name} (attempt ${attempts})`);
      const timer = setInterval(() => void saveAll().catch((e: unknown) => console.warn(`saving files failed: ${String(e)}`)), SYNC_MS);
      exit = await runStage(stage.args, log);
      clearInterval(timer);
      await saveAll(true);
    }
    status[stage.name] = { state: exit === 0 ? 'done' : 'failed', exit, attempts, startedAt, endedAt: new Date().toISOString() };
    await files.put(`jobs/${stage.name}.log`, log.join('').slice(-LOG_KEEP));
    await putStatus();
    console.log(`=== ${stage.name}: ${status[stage.name]?.state} (exit ${exit})`);
  }
  current = 'finished';
  console.log('every stage has run; the job is finished');
}

async function push(): Promise<void> {
  for (const path of FILES) console.log(`${(await save(path, true)) ? 'saved' : 'absent'} ${path}`);
}

async function pull(): Promise<void> {
  for (const row of await files.list()) {
    const held = await files.get(row.path);
    if (held === null) continue;
    const to = row.path.startsWith('jobs/') ? join(ROOT, 'var', row.path) : abs(row.path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, held.body);
    console.log(`wrote ${to.slice(ROOT.length + 1)} (saved ${held.savedAt.toISOString()})`);
  }
}

async function showStatus(): Promise<void> {
  console.log(JSON.stringify(await readStatus(), null, 1));
  for (const row of await files.list()) console.log(`${row.path.padEnd(40)} ${String(row.bytes).padStart(8)} bytes  ${row.savedAt.toISOString()}`);
}

const command = process.argv[2];
const commands: Record<string, () => Promise<void>> = { run, push, pull, status: showStatus };
const chosen = command === undefined ? undefined : commands[command];
if (chosen === undefined) {
  console.log('usage: tools/jobs.ts push | run | status | pull');
  process.exitCode = 1;
} else {
  try {
    await chosen();
  } finally {
    await pool.end();
  }
  /* Exit 0 even after a failed stage: see the ★ block on restarts. */
  if (command === 'run') process.exit(0);
}
