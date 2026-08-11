/**
 * Structured logging, one JSON object per line.
 *
 * WHY structured rather than a printf: the failure this whole service is shaped
 * around went unnoticed for seven hours. The thing that makes a dead stage
 * findable is a field you can filter on — `stage`, `outcome`, `runId` — not a
 * sentence you have to read. Lines are JSON so `jq` and the hosting provider's
 * log search both work without a parser.
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

/**
 * `catch (e)` is `unknown` under useUnknownInCatchVariables, and a thrown
 * non-Error is common enough (a rejected fetch, a string from a driver) that
 * every call site would otherwise repeat this cast.
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
