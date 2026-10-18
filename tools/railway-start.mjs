/**
 * HOW EACH SERVICE STARTS ON RAILWAY — one launcher, one argument per service, so the seven
 * Railway services differ only in that word (railway/<service>.json).
 *
 *   node tools/railway-start.mjs runner | chainwatch | read | trade | social | notify | project | jobs
 *   (or with no word: the service named by Railway's RAILWAY_SERVICE_NAME)
 *
 * ★ RAILWAY'S PORT, EACH SERVICE'S OWN NAME FOR IT. Railway gives every service PORT and checks
 * health on it. The runner and chainwatch answer /health on HEALTH_PORT; read and trade listen on
 * PORT; social and notify on their own *_PORT locally and PORT here. This maps PORT to whichever
 * the service reads, so a health check always lands on a server that answers it.
 *
 * ★ THE PROJECTOR IS A SCHEDULE, NOT A PROCESS. `project` runs the one-shot jobs (`db.mjs
 * project` every minute; coin logos every two; `market`, `pairs` and the source indicator every five; `label`, the post slimming and the coin vector archive hourly; the
 * daily recall check and the twice-daily judge re-tune, both detached; the namer's watch every ten
 * minutes; and, when a judge's answer has landed, the quick For You frame) in three lanes — the full
 * frame, the quick frame, everything else — each one job at a time, and answers /health on PORT: 200 while the board was rebuilt in the last five minutes, 503
 * otherwise — so Railway restarts it when the board stops moving, not just when it crashes.
 *
 * Nothing here holds a setting of its own: every value is the service's environment, set by the
 * owner in Railway. A child that exits takes this process with it (Railway restarts on failure).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
/* The word on the command line, or the Railway service's own name — so one root railway.json
   serves all seven, each starting as what Railway calls it. */
const service = process.argv[2] ?? process.env['RAILWAY_SERVICE_NAME'] ?? '';
const port = process.env['PORT'] ?? '';

const MAIN = {
  runner: { file: 'services/runner/src/main.ts', env: { HEALTH_PORT: process.env['HEALTH_PORT'] ?? port, SINGLETON_LOCK_NAME: process.env['SINGLETON_LOCK_NAME'] ?? 'insidor.runner' } },
  chainwatch: { file: 'services/chainwatch/src/main.ts', env: { HEALTH_PORT: process.env['HEALTH_PORT'] ?? port, SINGLETON_LOCK_NAME: process.env['SINGLETON_LOCK_NAME'] ?? 'insidor.chainwatch' } },
  read: { file: 'services/read/src/main.ts', env: {} },
  trade: { file: 'services/trade/src/main.ts', env: {} },
  social: { file: 'services/social/src/main.ts', env: {} },
  notify: { file: 'services/notify/src/main.ts', env: {} },
  /* The one-off paid job: runs its stages, saves, exits 0 — never restarted (tools/jobs.ts). */
  jobs: { file: 'tools/jobs.ts', args: ['run'], env: {} },
};

function run(args, extraEnv = {}) {
  return spawn(process.execPath, ['--experimental-strip-types', ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

if (service in MAIN) {
  const { file, args = [], env } = MAIN[service];
  const child = run([file, ...args], Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else if (service === 'project') {
  /* ★ THREE LANES, EACH ONE AT A TIME (the owner, 2026-10-18: "don't let a full rebuild block it").
     Until then every job here ran in one queue, so the full frame, meant every minute, waited behind
     whatever else was due: the market read (about 60 s), the logos (about 50 s, every two minutes),
     the pairs (20 s), the re-tune check (60 s) and, once an hour, the labels (15 minutes) — full
     frames came 263 s apart at the median and up to 21 minutes apart, and the quick frame waited in
     the same queue. Now:
       frames  the full frame, every minute from its last start (it takes about two of them);
       quick   the quick frame, asked every second (quick-wake.ts), beside a running full frame —
               the two take For You's write lock only to write (services/project for-you-lock.ts);
       jobs    everything else, in the old order and on the old clocks.
     Three children at most at any moment, none of them sharing a table they both write but For You,
     which the lock covers. */
  /* `sources` runs only the indicator's projector, not `db.mjs sources`: that command also
     DECLARES the sources from its own environment, and this service holds no platform key —
     every five minutes it would overwrite the runner's declaration with "dormant". On Railway
     the runner, which holds the keys, declares at boot (declare-sources.ts explains the split). */
  const FRAME = { name: 'project', everyMs: 60_000, args: ['tools/db.mjs', 'project'] };
  const JOBS = [
    { name: 'market', everyMs: 300_000, args: ['tools/db.mjs', 'market'] },
    { name: 'pairs', everyMs: 300_000, args: ['tools/db.mjs', 'pairs'] },
    { name: 'sources', everyMs: 300_000, args: ['services/project/src/sources-main.ts'] },
    /* Copies the logos of coins on screen into our storage (services/project/src/logos-main.ts).
       Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on this service; without them it says so and exits. */
    { name: 'logos', everyMs: 120_000, args: ['services/project/src/logos-main.ts'] },
    { name: 'label', everyMs: 3_600_000, args: ['tools/db.mjs', 'label'] },
    /* The decision log's days older than one move to the private decision-archive bucket, checked
       row for row before each day's partition is dropped (tools/archive-decisions.ts). Hourly so a
       day is moved soon after it is due; a pass with nothing due is one catalogue query. */
    { name: 'archive', everyMs: 3_600_000, args: ['tools/archive-decisions.ts'] },
    /* Coin picture vectors: days older than 30 to the private vector-archive bucket, read back and
       counted before they are deleted (tools/archive-coin-vectors.ts, Policy.coinVectors). Hourly;
       seconds when nothing is due. */
    { name: 'coin-vectors', everyMs: 3_600_000, args: ['tools/archive-coin-vectors.ts', 'run'] },
    /* Once a day: did discovery hold each bonded coin's linked X post before it launched
       (internal.recall_check). Detached, because a day's reads outlast the board's health bar. */
    { name: 'recall', everyMs: 86_400_000, args: ['tools/recall-check.ts', 'daily', '--yes', '--detach'] },
    /* The judge learns from the owner at 00:00 and 12:00 London (Policy.learning): asked every ten
       minutes whether the latest slot has run; the run itself is detached, like the recall check,
       because a batch of a hundred-odd posts outlasts the board's health bar. */
    { name: 'retune', everyMs: 600_000, args: ['tools/retune.ts', 'due', '--yes', '--detach'] },
    /* The namer's first day, watched (tools/name-watch.ts): coins it adds to feed cards, the owner's
       Wrong coin / No coin calls on them, and its veto if wrong coins go up. Free; database only. */
    { name: 'name-watch', everyMs: 600_000, args: ['tools/name-watch.ts', 'run'] },
    /* Posts that never made For You, slimmed a week after we found them (tools/post-slim.ts,
       Policy.slim): a minute or so a run, one short transaction per 500 posts. Says "off" and exits
       while Policy.slim.on is false. */
    { name: 'slim', everyMs: 3_600_000, args: ['tools/post-slim.ts', 'run'] },
  ];
  /* A quick frame that has not finished in this long is stopped: it is seconds of work, and a hung
     one would stop this lane until the service restarts (the health check watches the full frame). */
  const QUICK_KILL_AFTER_MS = 120_000;
  const last = new Map();
  const started = new Map();
  const due = (job, now) => now - (started.get(job.name) ?? 0) >= job.everyMs;
  const once = (job, killAfterMs = null) =>
    new Promise((resolve) => {
      const child = run(job.args);
      const timer = killAfterMs === null ? null : setTimeout(() => child.kill('SIGKILL'), killAfterMs);
      child.on('exit', (code) => {
        if (timer !== null) clearTimeout(timer);
        resolve(code === 0);
      });
    });
  const ran = (job, at, ok) => {
    last.set(job.name, { at: Date.now(), ok });
    console.log(JSON.stringify({ level: ok ? 'info' : 'error', msg: 'job ran', job: job.name, ok, ms: Date.now() - at }));
  };
  const runJob = async (job) => {
    const at = Date.now();
    started.set(job.name, at);
    ran(job, at, await once(job));
  };
  /* ★ THE QUICK FRAME (services/project/src/quick-wake.ts, Policy.rising.quickFrame): its own lane,
     asked every second, so a judge's answer reaches For You without waiting for the full frame or
     any other job. Without it (the module fails to load) the full frame runs as before. */
  const quick = await import('../services/project/src/quick-wake.ts')
    .then((m) =>
      m.openQuickWake(
        process.env,
        async (from) => {
          const ok = await once({ args: ['services/project/src/quick-main.ts', String(from.answerId), String(from.atMs)] }, QUICK_KILL_AFTER_MS);
          last.set('project-quick', { at: Date.now(), ok });
          return ok;
        },
        (fields) => console.log(JSON.stringify(fields)),
      ),
    )
    .catch((e) => {
      console.log(JSON.stringify({ level: 'error', msg: 'quick frame off: its wake could not start', err: e instanceof Error ? e.message : String(e) }));
      return null;
    });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => (stopping = true, process.exit(0)));
  const tick = () => new Promise((r) => setTimeout(r, 1_000));
  const lane = async (step) => {
    while (!stopping) {
      try {
        await step();
      } catch (e) {
        console.log(JSON.stringify({ level: 'error', msg: 'project lane step failed', err: e instanceof Error ? e.message : String(e) }));
      }
      await tick();
    }
  };
  void lane(async () => {
    if (due(FRAME, Date.now())) await runJob(FRAME);
  });
  void lane(async () => {
    for (const job of JOBS) if (due(job, Date.now())) await runJob(job);
  });
  if (quick !== null) void lane(() => quick.maybe());
  createServer((req, res) => {
    const board = last.get('project');
    const fresh = board !== undefined && board.ok && Date.now() - board.at < 300_000;
    const starting = board === undefined;
    res.writeHead(fresh || starting ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: fresh || starting, jobs: Object.fromEntries([...last].map(([k, v]) => [k, { ok: v.ok, at: new Date(v.at).toISOString() }])) }));
  }).listen(Number(port || 8080));
} else {
  console.error(`railway-start: unknown service "${service}". One of: ${[...Object.keys(MAIN), 'project'].join(', ')}`);
  process.exit(2);
}
