/**
 * Structured logging. Duplicated rather than shared, and this service is the
 * reason the duplication exists at all.
 *
 * The watchdog's whole value is that it has nothing in common with the things
 * it watches. A shared logging package would be a shared module, a shared
 * version, a shared bad publish, and one shared reason to be broken at the same
 * moment. Twenty lines is the correct price for that independence.
 */

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: LogFields): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, svc: 'watchdog', msg, ...fields });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(): Logger {
  return {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
