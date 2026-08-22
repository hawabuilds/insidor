#!/usr/bin/env node
/**
 * THE LOCAL DATABASE, END TO END, IN ONE FILE.
 *
 *   node tools/db.mjs up        container up, then wait for it to be HEALTHY
 *   node tools/db.mjs migrate   apply store/migrations/*.sql, then make the app login user
 *   node tools/db.mjs reset     drop the database, recreate it, migrate  (destructive)
 *   node tools/db.mjs seed      domain facts only            (tools/seed.mjs)
 *   node tools/db.mjs market    read markets, append rows    (services/market)
 *   node tools/db.mjs project   derive the wire projection   (services/project)
 *   node tools/db.mjs pairs     derive the pairs projection  (services/project)
 *   node tools/db.mjs sources   derive the source indicator  (services/project)
 *   node tools/db.mjs decide    run the stages, write decisions (services/runner)
 *   node tools/db.mjs psql      an interactive shell in the container
 *
 * WHY THIS EXISTS ALONGSIDE store/src/migrate.ts. That one is the deployable
 * migrator: it checksums every file, refuses to run when a checksum drifted or a
 * pending file sorts before an applied one, and connects as the `internal` role
 * through DATABASE_URL_INTERNAL. It is correct and it is also four environment
 * variables away from working on a laptop with an empty .env. This is the laptop
 * path — same files, same order, one transaction per file, recorded in the same
 * table so the two are interchangeable and neither re-applies the other's work.
 *
 * ★ THE PART THAT IS NOT CONVENIENCE: `migrate` ends by creating a LOGIN user and
 * granting it insidor_app, and nothing else. That is the second half of the
 * product's central claim. The first half is the wire types — the app cannot
 * *name* a score. This half is that the connection the read service holds cannot
 * *reach* one: no USAGE on `internal`, no USAGE on `raw`, no SELECT on
 * public.observation. If the read service ever grows a query that would leak, it
 * gets `permission denied` from Postgres rather than a rendered number. Running
 * the read service as the owner locally would make that guarantee untested
 * everywhere except production, which is the one place nobody wants to find out.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  APP_PASSWORD,
  APP_USER,
  ROOT,
  connect,
  databaseUrl,
  redact,
  withDatabase,
} from './lib/pgclient.mjs';

const MIGRATIONS_DIR = join(ROOT, 'store', 'migrations');
const CONTAINER = 'insidor-db';
const HEALTH_TIMEOUT_MS = 60_000;

/* ── output ───────────────────────────────────────────────────────────────
   Plain stderr, no colour library. The one thing that is shouted is `reset`,
   because it is the only command in this file that destroys an append-only
   table, and a destructive command that scrolls past looking like the others is
   a destructive command someone runs by muscle memory. */

const say = (msg) => process.stderr.write(`${msg}\n`);
const step = (msg) => say(`  ${msg}`);

function shout(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  say('');
  say('!'.repeat(width));
  for (const line of lines) say(`! ${line.padEnd(width - 4)} !`);
  say('!'.repeat(width));
  say('');
}

function die(message) {
  say(`\ndb: ${message}\n`);
  process.exit(1);
}

/* ── docker ───────────────────────────────────────────────────────────────── */

function docker(args, opts = {}) {
  return spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

/**
 * Is the daemon reachable at all?
 *
 * `docker compose up` against a stopped daemon prints a message about a socket
 * path, which is true and unhelpful. Every one of these needs a different action
 * from the person reading it, so they get different messages.
 */
function assertDockerRunning() {
  const cli = docker(['--version']);
  if (cli.error?.code === 'ENOENT') {
    die(
      'the `docker` command was not found.\n' +
        '  Install Docker Desktop:  https://docs.docker.com/desktop/install/mac-install/',
    );
  }

  const info = docker(['info', '--format', '{{.ServerVersion}}']);
  if (info.status !== 0) {
    die(
      'the Docker daemon is not running (the `docker` CLI is installed, but nothing answered it).\n' +
        '  Start Docker Desktop, wait for the whale in the menu bar to stop animating, then:\n' +
        '    pnpm db:up\n\n' +
        `  What docker said:\n    ${(info.stderr || info.stdout || '').trim().split('\n').join('\n    ')}`,
    );
  }
}

function health() {
  const res = docker(['inspect', '--format', '{{.State.Health.Status}}', CONTAINER]);
  if (res.status !== 0) return 'missing';
  return res.stdout.trim();
}

async function up() {
  assertDockerRunning();

  step(`docker compose up -d  (image pgvector/pgvector:pg17)`);
  const res = docker(['compose', 'up', '-d'], { stdio: 'inherit', encoding: undefined });
  if (res.status !== 0) die('`docker compose up -d` failed — see the output above.');

  step(`waiting for ${CONTAINER} to report healthy (up to ${HEALTH_TIMEOUT_MS / 1000}s)`);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    const status = health();
    if (status === 'healthy') {
      step(`healthy. ${redact(databaseUrl())}`);
      say('\nNext:  pnpm db:migrate\n');
      return;
    }
    if (status === 'missing') {
      die(`container ${CONTAINER} does not exist after \`docker compose up\`. Check docker-compose.yml.`);
    }
    if (Date.now() > deadline) {
      const logs = docker(['logs', '--tail', '30', CONTAINER]);
      die(
        `${CONTAINER} was still "${status}" after ${HEALTH_TIMEOUT_MS / 1000}s.\n\n` +
          `  Last 30 log lines:\n    ${(logs.stdout + logs.stderr).trim().split('\n').join('\n    ')}\n\n` +
          '  If initdb is looping, the volume is probably from a different image:\n' +
          '    docker compose down -v && pnpm db:up',
      );
    }
    await sleep(500);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── migrate ──────────────────────────────────────────────────────────────── */

/**
 * The ledger.
 *
 * Created with the two columns this CLI needs, then widened with the three
 * store/src/migrate.ts requires — nullable, so a row written here is legal under
 * that file's stricter table and a row written there is legal here. `add column
 * if not exists` is a no-op when the strict table already exists, so whichever
 * migrator runs first, the other one still works and neither re-applies a file.
 */
const LEDGER = `
create schema if not exists internal;
create table if not exists internal.schema_migration (
  filename   text primary key,
  applied_at timestamptz not null default now()
);
alter table internal.schema_migration add column if not exists ordinal     integer;
alter table internal.schema_migration add column if not exists checksum    text;
alter table internal.schema_migration add column if not exists duration_ms integer;
`;

/**
 * The LOGIN user for the app role, created after the migrations because
 * `insidor_app` does not exist until 0001 has run.
 *
 * It is granted the group role and NOTHING directly. Every privilege it has is
 * one somebody wrote by hand in a migration — six `grant select` lines across
 * 0002, 0004 and 0005 — and public.observation is deliberately not among them.
 */
const APP_LOGIN = `
do $$
begin
  if exists (select 1 from pg_roles where rolname = '${APP_USER}') then
    alter role ${APP_USER} with login password '${APP_PASSWORD}';
  else
    create role ${APP_USER} with login password '${APP_PASSWORD}';
  end if;
end
$$;
grant insidor_app to ${APP_USER};
`;

/**
 * What the browser's role can actually reach, read back from the catalogue.
 *
 * ★ COUNTED, NEVER TYPED, AND THAT IS THE WHOLE REASON THIS IS A FUNCTION. The line
 * below used to read "select on six public tables, nothing else". It was written when
 * six was true and was never touched again; by 0017 the real number was fourteen, so
 * the one sentence in this tool that describes the app role's blast radius had been
 * quietly wrong for five migrations. A number typed into a summary goes stale the next
 * time somebody adds a `grant select` line — and every one of those lines is written by
 * hand precisely BECAUSE forgetting must fail closed, which means they arrive one at a
 * time and nobody thinks to come back here.
 *
 * A summary of a security boundary that nobody can trust is worse than no summary: it
 * is the sentence an operator reads instead of checking. Asked of the catalogue it
 * cannot drift, and it costs one query on a command that has just run migrations.
 *
 * ★ AND "NOTHING ELSE" IS MEASURED TOO, not asserted. The interesting half of the claim
 * is not how many tables the app can read; it is that it can do nothing but read. So
 * every privilege is counted, not only SELECT, and anything beyond SELECT is named in
 * the line rather than silently folded into a reassuring total.
 *
 * `count(distinct table_name)` because the catalogue records a grant per privilege per
 * grantor, so one table can appear more than once for one privilege.
 */
async function appGrants(client) {
  const { rows } = await client.query(
    `select privilege_type, count(distinct table_name)::int as tables
       from information_schema.role_table_grants
      where grantee = 'insidor_app' and table_schema = 'public'
      group by privilege_type
      order by privilege_type`,
  );
  return rows;
}

function appReach(rows) {
  const select = rows.find((r) => r.privilege_type === 'SELECT')?.tables ?? 0;
  const beyond = rows.filter((r) => r.privilege_type !== 'SELECT');
  const read = `select on ${select} public table${select === 1 ? '' : 's'}`;
  /* Loud rather than tidy. A write privilege on the browser's role is not a detail to
     mention in passing — it is the thing 0001 arranged the whole role split to prevent,
     and the operator running migrations is the last person positioned to catch it. */
  if (beyond.length === 0) return `${read}, nothing else`;
  return `${read}, AND ${beyond
    .map((r) => `${r.privilege_type} on ${r.tables}`)
    .join(', ')} — the app role should only ever read; check the newest migration`;
}

async function migrate({ quiet = false } = {}) {
  const client = await connect();
  try {
    await client.query(LEDGER);

    const applied = new Set(
      (await client.query('select filename from internal.schema_migration')).rows.map(
        (r) => r.filename,
      ),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    if (files.length === 0) die(`no .sql files in ${MIGRATIONS_DIR}`);

    let ran = 0;
    for (const filename of files) {
      if (applied.has(filename)) {
        if (!quiet) step(`· ${filename}  (already applied)`);
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const ordinal = Number.parseInt(filename.slice(0, 4), 10);
      const startedAt = Date.now();

      /* ONE TRANSACTION PER FILE, never one for the whole run. A file that fails
         leaves the ones before it applied and recorded, so a fix is "re-run"
         rather than "re-run everything and hope every earlier file is idempotent
         a second time" — and 0001's `create role` is not. */
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          `insert into internal.schema_migration (filename, ordinal, checksum, duration_ms)
           values ($1, $2, $3, $4)
           on conflict (filename) do nothing`,
          [filename, ordinal, checksum, Date.now() - startedAt],
        );
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        die(
          `${filename} failed and was rolled back.\n\n    ${String(err.message).split('\n').join('\n    ')}\n\n` +
            (String(err.message).includes('extension "vector"')
              ? '  That error means the container is NOT pgvector/pgvector:pg17.\n' +
                '  Stock postgres:17 has no vector extension. Fix docker-compose.yml, then:\n' +
                '    docker compose down -v && pnpm db:up && pnpm db:migrate'
              : ''),
        );
      }
      step(`✓ ${filename}  (${Date.now() - startedAt}ms)`);
      ran += 1;
    }

    step(ran === 0 ? 'schema already current' : `${ran} migration${ran === 1 ? '' : 's'} applied`);

    await client.query(APP_LOGIN);
    step(`✓ login user ${APP_USER} → group role insidor_app (${appReach(await appGrants(client))})`);
  } finally {
    await client.end();
  }
}

/* ── reset ────────────────────────────────────────────────────────────────── */

async function reset() {
  const url = databaseUrl();
  const name = new URL(url).pathname.replace(/^\//, '');

  shout([
    'DROPPING THE DATABASE',
    '',
    `database : ${name}`,
    `server   : ${redact(url)}`,
    '',
    'public.observation is append-only and is never backfillable.',
    'Everything in it is gone. Locally that is only seeded rows.',
  ]);

  const admin = await connect(withDatabase(url, 'postgres'));
  try {
    step('terminating open connections');
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    );
    step(`drop database ${name}`);
    await admin.query(`drop database if exists ${quoteIdent(name)}`);
    step(`create database ${name}`);
    await admin.query(`create database ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }

  say('');
  step('migrating the fresh database');
  await migrate({ quiet: true });
  say('\nNext:  pnpm db:seed\n');
}

/** Only ever applied to a database name we parsed out of our own URL, but say it anyway. */
function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    die(`refusing to interpolate the database name "${name}" — rename it or quote it by hand.`);
  }
  return `"${name}"`;
}

/* ── the two child processes ──────────────────────────────────────────────── */

function run(argv, label, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, {
      cwd: ROOT,
      stdio: 'inherit',
      /* The caller's environment still wins: `extraEnv` is a floor, not an override,
         so `SINGLETON_LOCK_NAME=... pnpm db:decide` does what it looks like it does. */
      env: { ...extraEnv, ...process.env, DATABASE_URL: databaseUrl() },
    });
    child.on('exit', (code) => {
      if (code !== 0) die(`${label} exited with code ${code}`);
      resolve();
    });
  });
}

const SEED = join(ROOT, 'tools', 'seed.mjs');

/**
 * The market reader's entrypoint. It runs as the SERVICE role too, and for the
 * mirror-image reason the projector does: it must INSERT into public.market_reading,
 * which the app role has no privilege on at all — 0010 writes no grant line, so the
 * browser's connection cannot read a market reading, let alone write one.
 *
 * It goes BEFORE `project` in any sensible sequence — seed, market, project — because
 * the projector reads the latest reading per coin and a projection run before the first
 * read is a board of honest dashes.
 */
const MARKET = join(ROOT, 'services', 'market', 'src', 'main.ts');

async function market() {
  if (!existsSync(MARKET)) {
    die(
      `no market reader at ${MARKET}.\n` +
        '  services/market is the one process that asks a venue what a coin is worth and\n' +
        '  appends what it said to public.market_reading, with the reason attached wherever\n' +
        '  there was no number. Until it runs, every market figure the projector publishes is\n' +
        '  an absence — which is honest, and is also every figure on the board.',
    );
  }
  await run(['--experimental-strip-types', MARKET], 'the market reader');
}

/**
 * The projector's entrypoint. It runs as the SERVICE role, because it is the one
 * process that must read public.observation in order to censor it — which is
 * exactly why the read service may not.
 */
const PROJECTOR = join(ROOT, 'services', 'project', 'src', 'main.ts');

async function project() {
  if (!existsSync(PROJECTOR)) {
    die(
      `no projector at ${PROJECTOR}.\n` +
        '  services/project is the only place the wire shape is constructed: it reads the\n' +
        '  domain rows, censors once, and upserts finished jsonb into public.board_row /\n' +
        '  public.story_view. Until it exists there is nothing for the read service to select.',
    );
  }
  await run(['--experimental-strip-types', PROJECTOR], 'the projector');
}

/**
 * The pairs projector, which is a SECOND entrypoint into the same package and not a
 * flag on the first.
 *
 * The board suppresses a market reading older than the policy's freshness window
 * entirely, because every board row carries a Buy button on it. The pairs screen
 * publishes the reading it holds together with the instant it was taken at, and says
 * the age beside every figure — it has no trade affordance, so suppressing there
 * would delete the evidence rather than protect anybody.
 *
 * Both calls are right for their own screen. The reason they are two PROCESSES is
 * that one process holding both rules would sooner or later hold one options object
 * with a mode field on it, and then the board's five minutes would be a parameter
 * somebody could pass differently. Run it after `market`, for the reason `project`
 * gives: the projection reads the latest reading per coin, and a run before the first
 * market pass has nothing to read.
 */
const PAIR_PROJECTOR = join(ROOT, 'services', 'project', 'src', 'pairs-main.ts');

async function pairs() {
  if (!existsSync(PAIR_PROJECTOR)) {
    die(
      `no pairs projector at ${PAIR_PROJECTOR}.\n` +
        '  It writes public.pair_view / public.pair_row: the mints that reached a market,\n' +
        '  the count of how few of them there are, and when a mint was last heard. Until it\n' +
        '  runs, GET /pairs/:feedId answers 404 and the screen says so.',
    );
  }
  await run(['--experimental-strip-types', PAIR_PROJECTOR], 'the pairs projector');
}

/**
 * The source indicator, which is a THIRD entrypoint into the same package.
 *
 * It answers one question — which of the sources we ingest from are answering — and it is
 * separate for a reason the other two do not have: it reads a table the ingest side owns,
 * on a schedule nobody else keeps. What it reports changes when somebody adds a credential
 * or a vendor starts erroring, not when the market moves, so bolting it onto the board's
 * run would either project it hundreds of times an hour for nothing or let a change on
 * somebody else's table stop the board from projecting at all.
 *
 * It can be run at any point and needs neither `seed` nor `market`: it reads nothing the
 * other two write. Run it after `migrate` and the indicator stops saying it has never been
 * projected; run it before the ingest side exists and it honestly publishes an empty frame,
 * which the app reads as "nothing is ingesting" — true, on a machine where nothing is.
 */
const SOURCE_PROJECTOR = join(ROOT, 'services', 'project', 'src', 'sources-main.ts');

async function sources() {
  if (!existsSync(SOURCE_PROJECTOR)) {
    die(
      `no source projector at ${SOURCE_PROJECTOR}.\n` +
        '  It writes public.source_view: per source, a display label, the three-way state and\n' +
        '  when it was last heard from. Until it runs, GET /sources/:viewId answers 404 and the\n' +
        '  corner of the nav says nothing has recorded which sources are answering.',
    );
  }
  await run(['--experimental-strip-types', SOURCE_PROJECTOR], 'the source projector');
}

/**
 * ★ THE DECISION LOG, FILLED FROM A LAPTOP.
 *
 * `internal.decisions` and `internal.labels` are the two tables in this system that
 * cannot be backfilled: the decision happens in minutes and the answer arrives in
 * days, and every feature you would try to recompute afterwards has moved by then.
 * Until this command existed the only way to write a decision row was to boot the
 * whole runner against a live pipeline, which is why the sequence behind
 * `internal.decisions.id` had never been advanced — not once, on a database that had
 * been up for three days.
 *
 * ★ IT RUNS THE REAL SERVICE, NOT A COPY OF IT. `services/runner/src/decide-once.ts`
 * calls the same `withRuntime`, takes the same singleton advisory lock, records the
 * same policy body under the same hash, and awaits the same seven `Loop` objects the
 * supervisor drives in production. Anything this writes, the runner writes.
 *
 * WHY THE ENVIRONMENT IS ASSEMBLED HERE. `config.ts` is the only module in that
 * service permitted to read `process.env`, and it refuses to start on a missing key
 * rather than inventing a default — which is correct, and which means a laptop needs
 * six variables set to run a one-shot. They are set here, once, with the values that
 * are true of a one-shot: no heartbeat (there is nobody to page for a program that
 * exits), its own lock name, so this and a running runner refuse each other instead
 * of both draining the same queue, and discovery off.
 *
 * ★ AND WHY EVERY ONE OF THEM HAS TO BE LISTED HERE RATHER THAN DEFAULTED THERE. The
 * day `DISCOVER` became required, this command stopped working — it assembles its own
 * environment and had no line for the new key, so `pnpm db:decide` failed at config
 * load with a message about a variable nobody running it had ever heard of. That is
 * the standing cost of "silence must be chosen", and it is the right cost: the fix is
 * one line here declaring the choice, never a default over there that would let a
 * production runner ingest nothing and look healthy doing it.
 */
const DECIDE = join(ROOT, 'services', 'runner', 'src', 'decide-once.ts');

async function decide() {
  if (!existsSync(DECIDE)) {
    die(
      `no one-shot decider at ${DECIDE}.\n` +
        '  services/runner/src/decide-once.ts runs each stage loop exactly once over what is\n' +
        '  already in the database and writes every Decision to internal.decisions. Until it\n' +
        '  runs, the log is empty — and an empty decision log is not a system waiting to be\n' +
        '  switched on, it is training data that never existed and cannot be bought.',
    );
  }
  await run(['--experimental-strip-types', DECIDE], 'the one-shot decider', {
    /* Never bound. `decide-once.ts` starts no health server — there is nothing to
       probe in a program that exits — but `config.ts` requires the key and refuses a
       default, which is the right rule and means a value has to be supplied. This one
       satisfies the reader; no socket is opened at it. */
    HEALTH_PORT: '9999',
    SHUTDOWN_GRACE_MS: '1000',
    /* ★ ITS OWN LOCK NAME, DIFFERENT FROM THE RUNNER'S ON PURPOSE. Sharing one would
       mean this refuses to run whenever a runner is up, which is the safe direction
       but the wrong reason: the guarantee that matters is that two DECIDERS do not
       drain the same queue, and this and the runner both hold it against themselves.
       Two copies of this command race each other and one loses, loudly. */
    SINGLETON_LOCK_NAME: 'insidor-decide-once',
    HEARTBEAT: 'off',
    /* ★ OFF, AND IT IS A TRUE DECLARATION RATHER THAN A CONVENIENCE. This command runs
       the seven DECISION loops over what is already in the database; `decide-once.ts`
       does not construct the discovery loop at all. Declaring `on` here would be a
       claim this program cannot honour, and leaving it unset is refused by `config.ts`
       on purpose — a defaulted-off discovery is a pipeline that runs, reports healthy
       and ingests nothing. Off is the honest answer for a program that exits.

       It does NOT make the sources dark: `withRuntime` still resolves them from the
       environment and still writes `internal.source_health`, so a laptop that has
       filled in a credential block sees the indicator light up after this command
       exactly as it would under the real runner. What is switched off is the asking,
       not the accounting. */
    DISCOVER: 'off',
  });
}

function psql() {
  assertDockerRunning();
  if (health() === 'missing') die(`container ${CONTAINER} is not running. Try:  pnpm db:up`);
  const res = spawnSync(
    'docker',
    ['exec', '-it', CONTAINER, 'psql', '-U', 'insidor', '-d', 'insidor'],
    { cwd: ROOT, stdio: 'inherit' },
  );
  process.exit(res.status ?? 1);
}

/* ── argv ─────────────────────────────────────────────────────────────────── */

const COMMANDS = {
  up,
  migrate: () => migrate(),
  reset,
  seed: () => run([SEED], 'the seed'),
  market,
  project,
  pairs,
  sources,
  decide,
  psql: async () => psql(),
};

const cmd = process.argv[2];
if (!cmd || !Object.hasOwn(COMMANDS, cmd)) {
  say(
    `\nusage: node tools/db.mjs <${Object.keys(COMMANDS).join('|')}>\n\n` +
      `  DATABASE_URL   ${redact(databaseUrl())}\n`,
  );
  process.exit(cmd ? 1 : 0);
}

try {
  await COMMANDS[cmd]();
} catch (err) {
  die(String(err?.message ?? err));
}
