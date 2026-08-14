/**
 * Configuration, read exactly once, at boot, in exactly one place.
 *
 * ★ THE ONE LINE IN THIS PACKAGE THAT MATTERS: this service connects with
 * DATABASE_URL_APP and there is no other branch. That credential is the app role,
 * which has no USAGE on `internal` or `raw` and no SELECT on `public.observation`.
 * Its safety is therefore not a promise made in a code review, it is a property of
 * the connection the process holds: a bug in this package — a stray join, an
 * accidental `select *` against the wrong table, a route someone adds in a hurry —
 * cannot read a decision, a policy, a label or a censor reason, because the
 * database refuses the role, not the query.
 *
 * That property survives exactly as long as nobody adds a fallback. So:
 *
 *   1. A missing DATABASE_URL_APP FAILS THE PROCESS AT BOOT. It never falls back to
 *      DATABASE_URL. DATABASE_URL is the internal role — the one that can read every
 *      judgement the system has ever made — and a browser-facing service holding it
 *      is one templating mistake away from publishing the machinery the whole product
 *      rule exists to keep off screen. A read service that will not start is a
 *      five-minute outage; a read service holding the wrong role is unrecoverable,
 *      because you cannot un-serve a payload.
 *
 *   2. DATABASE_URL_APP being byte-identical to DATABASE_URL is also refused. That is
 *      the same mistake wearing the right variable name, and it is the likely one: a
 *      shell that exports one URL for every service, or a deploy config filled in by
 *      copy and paste. The check costs nothing and catches the version of the failure
 *      that would otherwise look correctly configured.
 *
 * PORT and READ_ALLOWED_ORIGINS DO have defaults, unlike every value in
 * services/runner/src/config.ts, and the difference is worth stating because it is
 * not laziness. A defaulted cadence or a defaulted "alerts off" fails SILENTLY —
 * the process runs, looks healthy, and does nothing. A wrong port or a wrong CORS
 * origin fails INSTANTLY and visibly, in the browser's console, on the first
 * request, before anything has been served. Defaults are only dangerous where the
 * wrong value is quiet.
 */

/** Port 8787 by default: the app's dev server is on 5173 and the two must not collide. */
const DEFAULT_PORT = 8787;

/** The Vite dev server's origin. See app/vite.config.ts, which pins `server.port`. */
const DEFAULT_ORIGIN = 'http://localhost:5173';

export interface ReadConfig {
  /**
   * The APP role's connection string, from DATABASE_URL_APP. Read-only, `public`
   * only, and denied `public.observation`. Never DATABASE_URL.
   */
  readonly databaseUrl: string;
  readonly port: number;
  /**
   * Exact origins allowed to read this surface, matched whole — never a prefix and
   * never a wildcard. A prefix match on "http://localhost:5173" also admits
   * "http://localhost:51731.evil.example", which is a real registrable host.
   */
  readonly allowedOrigins: readonly string[];
}

export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`configuration is not usable; the read service will not start:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function trimmed(env: Env, key: string): string | null {
  const raw = env[key];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

export function loadReadConfig(env: Env): ReadConfig {
  const problems: string[] = [];

  const databaseUrl = trimmed(env, 'DATABASE_URL_APP');
  const internalUrl = trimmed(env, 'DATABASE_URL');

  if (databaseUrl === null) {
    problems.push(
      'DATABASE_URL_APP is required and was not set. This service is only safe because it ' +
        'holds the app role, which cannot reach internal.*, raw.* or public.observation. ' +
        'Do NOT point it at DATABASE_URL to get it started — that hands the browser-facing ' +
        'process the role that can read every judgement we have ever recorded.',
    );
  } else if (internalUrl !== null && databaseUrl === internalUrl) {
    problems.push(
      'DATABASE_URL_APP is identical to DATABASE_URL, so the read service would connect as ' +
        'the internal role under the app role\'s name. Create a separate LOGIN user granted ' +
        'insidor_app and point DATABASE_URL_APP at that.',
    );
  }

  let port = DEFAULT_PORT;
  const rawPort = trimmed(env, 'PORT');
  if (rawPort !== null) {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      problems.push(`PORT must be an integer in [1, 65535], got ${JSON.stringify(rawPort)}`);
    } else {
      port = parsed;
    }
  }

  const rawOrigins = trimmed(env, 'READ_ALLOWED_ORIGINS');
  const allowedOrigins =
    rawOrigins === null
      ? [DEFAULT_ORIGIN]
      : rawOrigins
          .split(',')
          .map((o) => o.trim())
          .filter((o) => o !== '');
  if (allowedOrigins.length === 0) {
    problems.push('READ_ALLOWED_ORIGINS was set but listed no origin. Unset it to accept the dev origin, or name one.');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  /* Non-null by construction: `problems` is non-empty whenever databaseUrl is null,
     and the throw above is unconditional. Stated rather than asserted, because a
     non-null assertion here would be the one place a misconfigured URL could pass. */
  return { databaseUrl: databaseUrl ?? '', port, allowedOrigins };
}
