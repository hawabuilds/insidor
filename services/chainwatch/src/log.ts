/**
 * Structured logging, one JSON object per line.
 *
 * Duplicated from the runner rather than shared. A shared logging package would
 * be a shared dependency between the runner, the mint watcher and — eventually,
 * by the same reasoning — the watchdog, and the watchdog is explicitly forbidden
 * one. Twenty lines of duplication is cheaper than the precedent.
 */

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
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

function emit(level: 'info' | 'warn' | 'error', base: LogFields, msg: string, fields?: LogFields): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...base, ...fields });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(base: LogFields): Logger {
  return {
    info: (msg, fields) => emit('info', base, msg, fields),
    warn: (msg, fields) => emit('warn', base, msg, fields),
    error: (msg, fields) => emit('error', base, msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}
