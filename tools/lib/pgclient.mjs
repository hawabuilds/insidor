/**
 * HOW A SCRIPT IN tools/ GETS HOLD OF `pg`.
 *
 * `pg` is a dependency of @insidor/store, not of the workspace root, and pnpm's
 * node_modules is strict — the root has exactly the four devDependencies in the
 * root package.json and nothing else. So a bare `import 'pg'` from tools/ fails
 * with ERR_MODULE_NOT_FOUND on a correct install, which reads as "you forgot to
 * install" and is instead "you asked the wrong package".
 *
 * The fix is to resolve `pg` the way the package that actually depends on it
 * would: a require rooted at store/package.json. That keeps the dependency
 * declared in exactly one place (store/package.json, where it belongs, because
 * store is the only place SQL exists) instead of adding a second copy to the
 * root just so a CLI can open a connection.
 *
 * The bare specifier is still tried first, so this keeps working unchanged if
 * the root ever does grow a direct `pg` dependency.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The compose credentials from docker-compose.yml, spelled out rather than
 * assembled, so grepping for the connection string finds it.
 *
 * DATABASE_URL wins when it is set. The default is not a fallback for a missing
 * production value — nothing in services/ or store/ reads this module; it is the
 * local CLI's default and the whole point is that a fresh clone needs no .env.
 */
export const DEFAULT_URL = 'postgresql://insidor:insidor@127.0.0.1:5432/insidor';

/** The LOGIN user tools/db.mjs creates for the app role. Read-only, public only. */
export const APP_USER = 'insidor_app_user';
export const APP_PASSWORD = 'insidor_app';

export function databaseUrl(env = process.env) {
  return env['DATABASE_URL'] ?? DEFAULT_URL;
}

/** The same server, a different database. Used by `reset`, which cannot drop the one it is in. */
export function withDatabase(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

let cached;

/** The `pg` module namespace. Cached: resolving it twice would open two module instances. */
export async function loadPg() {
  if (cached) return cached;
  try {
    cached = await import('pg');
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    const require = createRequire(join(ROOT, 'store', 'package.json'));
    let entry;
    try {
      entry = require.resolve('pg');
    } catch {
      throw new Error(
        "cannot find 'pg'. It is a dependency of @insidor/store — run `pnpm install` at the repo root.",
      );
    }
    cached = await import(pathToFileURL(entry).href);
  }
  return cached;
}

/**
 * A connected client, or a diagnosis.
 *
 * ECONNREFUSED here means the container is not up, and saying so beats a stack
 * trace whose top frame is inside pg's socket code.
 */
export async function connect(url = databaseUrl()) {
  const pg = await loadPg();
  const Client = pg.default?.Client ?? pg.Client;
  const client = new Client({ connectionString: url, application_name: 'insidor-tools' });
  try {
    await client.connect();
  } catch (err) {
    if (err?.code === 'ECONNREFUSED') {
      throw new Error(
        `nothing is listening at ${redact(url)}.\n` +
          '  Start it with:  pnpm db:up',
      );
    }
    if (err?.code === '3D000') {
      throw new Error(
        `the database in ${redact(url)} does not exist.\n` +
          '  Create it with:  pnpm db:reset',
      );
    }
    throw err;
  }
  return client;
}

/** A connection string with the password removed, for printing. */
export function redact(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url;
  }
}
