/**
 * HOW EACH SERVICE STARTS ON RAILWAY — one launcher, one argument per service, so the seven
 * Railway services differ only in that word (railway/<service>.json).
 *
 *   node tools/railway-start.mjs runner | chainwatch | read | trade | social | notify | project
 *   (or with no word: the service named by Railway's RAILWAY_SERVICE_NAME)
 *
 * ★ RAILWAY'S PORT, EACH SERVICE'S OWN NAME FOR IT. Railway gives every service PORT and checks
 * health on it. The runner and chainwatch answer /health on HEALTH_PORT; read and trade listen on
 * PORT; social and notify on their own *_PORT locally and PORT here. This maps PORT to whichever
 * the service reads, so a health check always lands on a server that answers it.
 *
 * ★ THE PROJECTOR IS A SCHEDULE, NOT A PROCESS. `project` runs the one-shot jobs (`db.mjs
 * project` every minute; `market`, `pairs` and the source indicator every five; `label` hourly), one at a time,
 * and answers /health on PORT: 200 while the board was rebuilt in the last five minutes, 503
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
};

function run(args, extraEnv = {}) {
  return spawn(process.execPath, ['--experimental-strip-types', ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

if (service in MAIN) {
  const { file, env } = MAIN[service];
  const child = run([file], Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else if (service === 'project') {
  /* `sources` runs only the indicator's projector, not `db.mjs sources`: that command also
     DECLARES the sources from its own environment, and this service holds no platform key —
     every five minutes it would overwrite the runner's declaration with "dormant". On Railway
     the runner, which holds the keys, declares at boot (declare-sources.ts explains the split). */
  const JOBS = [
    { name: 'project', everyMs: 60_000, args: ['tools/db.mjs', 'project'] },
    { name: 'market', everyMs: 300_000, args: ['tools/db.mjs', 'market'] },
    { name: 'pairs', everyMs: 300_000, args: ['tools/db.mjs', 'pairs'] },
    { name: 'sources', everyMs: 300_000, args: ['services/project/src/sources-main.ts'] },
    { name: 'label', everyMs: 3_600_000, args: ['tools/db.mjs', 'label'] },
  ];
  const last = new Map();
  const due = (job, now) => now - (last.get(job.name)?.at ?? 0) >= job.everyMs;
  const once = (job) =>
    new Promise((resolve) => {
      const child = run(job.args);
      child.on('exit', (code) => resolve(code === 0));
    });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => (stopping = true, process.exit(0)));
  (async () => {
    while (!stopping) {
      for (const job of JOBS) {
        if (!due(job, Date.now())) continue;
        const ok = await once(job);
        last.set(job.name, { at: Date.now(), ok });
        console.log(JSON.stringify({ level: ok ? 'info' : 'error', msg: 'job ran', job: job.name, ok }));
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  })();
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
