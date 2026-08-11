/**
 * Where replayed decisions come from.
 *
 * A source is an async iterable, not an array, because the decision log is
 * roughly 150,000 rows a day and a 90-day replay must not be an out-of-memory
 * error. The harness consumes rows one at a time and holds only counters.
 *
 * The store's repository could implement this directly, and `services` would
 * pass one in. eval does not import store here for a smaller reason than the
 * dependency rule: a replay that requires a database is a replay that nobody
 * runs on a plane, and the JSONL export costs one `\copy`.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Decision } from '@insidor/contracts';

export type DecisionSource = AsyncIterable<Decision> | Iterable<Decision>;

/** For tests and for small hand-built populations. */
export function fromArray(rows: readonly Decision[]): DecisionSource {
  return rows;
}

export class DecisionParseError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = 'DecisionParseError';
    this.line = line;
  }
}

/**
 * One JSON object per line, as produced by
 *
 *   \copy (select row_to_json(d) from internal.decisions d where …) to 'log.jsonl'
 *
 * Malformed lines THROW rather than being skipped. A replay that silently drops
 * 3% of its input reports a number about a population nobody can name, which is
 * the failure this whole directory exists to prevent.
 */
export async function* fromJsonl(path: string): AsyncGenerator<Decision> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e: unknown) {
      throw new DecisionParseError(n, e instanceof Error ? e.message : 'unparseable');
    }
    yield asDecision(parsed, n);
  }
}

/**
 * The minimum a row must carry to be replayable. Deliberately not a full
 * validation of `Decision`: the harness reads exactly these fields, and
 * pretending to check the rest would be theatre.
 */
export function asDecision(raw: unknown, line: number): Decision {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const need = (key: string): unknown => {
    if (r[key] === undefined) throw new DecisionParseError(line, `missing "${key}"`);
    return r[key];
  };

  need('stage');
  need('verdict');
  need('reason');
  need('featureSet');

  const features = need('features');
  if (typeof features !== 'object' || features === null || Array.isArray(features)) {
    throw new DecisionParseError(line, '"features" is not an object; the frozen vector is the whole input');
  }

  return raw as Decision;
}
