/**
 * SET EACH RAILWAY SERVICE'S VARIABLES FROM YOUR .env.local — run by you, once.
 *
 *   node tools/railway-env.mjs --check    which names each service gets, and which are missing
 *   node tools/railway-env.mjs            set them (no deploy is started)
 *
 * ★ VALUES NEVER PRINTED. Each value goes from .env.local straight to `railway variables --set`
 * for the one service that needs it; this prints names only. It is a script for the owner to
 * run, so a person's keys are moved by that person.
 *
 * Built here, not read: DATABASE_URL_PEOPLE (your DATABASE_URL_APP with insidor_people_user and
 * PEOPLE_DB_PASSWORD), the switches (SPEND=dry the FIRST time only — a runner already switched to
 * live is never put back to dry by running this again,
 * DISCOVER=on, DAILY_BUDGET_USD=21, NOTIFY=on, TRADING=on) and chainwatch's tuning numbers
 * (from .env.example). TRADING_ALLOWLIST is sent only if it is a real wallet address.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const parse = (file) => Object.fromEntries(readFileSync(join(ROOT, file), 'utf8').split('\n').flatMap((line) => {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  return m ? [[m[1], m[2].trim().replace(/^['"]|['"]$/g, '').trim()]] : [];
}));
const local = parse('.env.local');
const example = parse('.env.example');
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function peopleUrl() {
  const app = local.DATABASE_URL_APP;
  const password = local.PEOPLE_DB_PASSWORD;
  if (!app || !password) return undefined;
  const u = new URL(app);
  u.username = u.username.replace(/^insidor_app_user/, 'insidor_people_user');
  u.password = encodeURIComponent(password);
  return u.toString();
}

const fromLocal = (...names) => Object.fromEntries(names.map((n) => [n, local[n]]));
const fromExample = (...names) => Object.fromEntries(names.map((n) => [n, local[n] || example[n]]));
const people = peopleUrl();

const SERVICES = {
  read: { ...fromLocal('DATABASE_URL_APP', 'DATABASE_URL', 'HELIUS_API_KEY', 'COINGECKO_API_KEY', 'COINGECKO_API_PLAN') },
  social: { DATABASE_URL_PEOPLE: people, ...fromLocal('DATABASE_URL', 'HELIUS_API_KEY'), PRIVY_APP_ID: local.PRIVY_APP_ID || local.VITE_PRIVY_APP_ID },
  notify: { DATABASE_URL_PEOPLE: people, ...fromLocal('DATABASE_URL', 'HELIUS_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'), PRIVY_APP_ID: local.PRIVY_APP_ID || local.VITE_PRIVY_APP_ID, NOTIFY: 'on' },
  trade: {
    ...fromLocal('DATABASE_URL_APP', 'HELIUS_API_KEY', 'JUPITER_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'),
    TRADING: 'on',
    TRADING_ALLOWLIST: ADDRESS.test(local.TRADING_ALLOWLIST ?? '') ? local.TRADING_ALLOWLIST : undefined,
  },
  project: { ...fromLocal('DATABASE_URL', 'HELIUS_API_KEY', 'COINGECKO_API_KEY') },
  chainwatch: {
    ...fromLocal('DATABASE_URL'),
    ...fromExample('MINT_STREAM_URL', 'MINT_FEED_ID', 'MINT_FEED_CHAIN', 'MINT_FEED_TRANSPORT', 'MINT_OBSERVATION_LAG_S', 'MINT_STREAM_BUFFER_LIMIT', 'MINT_STREAM_STALE_MS', 'PAGE_LIMIT', 'POLL_INTERVAL_MS', 'BACKOFF_BASE_MS', 'BACKOFF_MAX_MS', 'COVERAGE_TOLERANCE_MS', 'SHUTDOWN_GRACE_MS', 'HEARTBEAT'),
  },
  runner: {
    ...fromLocal('DATABASE_URL', 'X_API_KEY', 'X_API_BASE', 'APIFY_TOKEN', 'TIKTOK_DISCOVERY_ACTOR_ID', 'TIKTOK_OBSERVE_ACTOR_ID', 'ANTHROPIC_API_KEY', 'JUDGE_MODEL', 'VOYAGE_API_KEY', 'HELIUS_API_KEY', 'COINGECKO_API_KEY', 'COINGECKO_API_PLAN', 'METADATA_GATEWAY', 'DISCOVER_TERMS'),
    ...fromExample('SHUTDOWN_GRACE_MS', 'HEARTBEAT'),
    SPEND: 'dry',
    DISCOVER: 'on',
    DAILY_BUDGET_USD: '21',
  },
};

/* A runner that already has SPEND keeps it: rerunning this to change a key must not stop spending. */
const current = spawnSync('railway', ['variables', '--service', 'runner', '--json'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
try {
  if (JSON.parse(current.stdout || '{}').SPEND) delete SERVICES.runner.SPEND;
} catch {
  /* Unknown: keep the dry default, the safe side. */
}

const check = process.argv.includes('--check');
let problems = 0;
for (const [service, vars] of Object.entries(SERVICES)) {
  const set = Object.entries(vars).filter(([, v]) => v !== undefined && v !== '');
  const missing = Object.entries(vars).filter(([, v]) => v === undefined || v === '').map(([k]) => k);
  console.log(`${service}: ${set.map(([k]) => k).join(', ')}${missing.length > 0 ? `\n  not in .env.local (left unset): ${missing.join(', ')}` : ''}`);
  if (check || set.length === 0) continue;
  const args = ['variables', '--service', service, '--skip-deploys', ...set.flatMap(([k, v]) => ['--set', `${k}=${v}`])];
  const r = spawnSync('railway', args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    problems += 1;
    console.log(`  ✗ railway refused for ${service} (exit ${r.status}); nothing printed from it, as it may echo values.`);
  } else console.log(`  ✓ set on ${service}`);
}
if (!check) console.log(problems === 0 ? '\nDone. Every service has its settings; deploy when ready.' : `\n${problems} service(s) failed. Run again, or set those in the Railway dashboard.`);
