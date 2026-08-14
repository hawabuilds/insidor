/**
 * Structured logging, one JSON object per line. The same shape as
 * services/runner/src/log.ts, copied rather than shared because this package
 * deliberately declares no workspace dependency at all — see queries.ts for why
 * that isolation is the point.
 *
 * It matters more here than in the runner. This is the only service whose errors
 * are DELIBERATELY uninformative to the caller: every failure answers the browser
 * with a fixed string that names no table, no statement and no stack. The detail
 * has to go somewhere, and this is the somewhere. A 500 with an opaque body and no
 * log line is not a safe service, it is an undebuggable one.
 */

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/**
 * `catch (e)` is `unknown` under useUnknownInCatchVariables, and a rejected `pg`
 * query is not always an Error instance.
 */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

function emit(level: 'info' | 'error', msg: string, fields?: LogFields): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, svc: 'read', msg, ...fields });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(): Logger {
  return {
    info: (msg, fields) => emit('info', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

/** Discards everything. Used by tests, which assert on replies rather than on stderr. */
export const SILENT: Logger = { info: () => {}, error: () => {} };
