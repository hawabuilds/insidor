/**
 * Dune: run one SQL query over the chain's decoded history and read its rows. The history
 * import's only window onto coins launched before chainwatch ran (docs/coin-universe-history-plan.md).
 *
 * A vendor edge, so it holds the key, the endpoints and the reply shapes and nothing else: which
 * query to run, and what its rows mean, is the caller's (tools/history-pilot.ts).
 *
 * ★ EVERY RUN COSTS CREDITS, AND THE CREDITS ARE REPORTED. Dune bills each execution by engine
 * size and each result by its size; `run` returns what the execution said it cost so the caller
 * can log it beside the rows. A query that fails or is cancelled throws — an empty result is a
 * query that ran and found nothing, never an outage.
 *
 * What breaks if changed carelessly: `run` polls until the execution finishes, with a ceiling.
 * Without the ceiling a stuck execution holds a terminal forever; without the poll the caller
 * reads a pending result as empty.
 */

import { arr, num, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

const VENDOR = 'dune';
const EXECUTE = 'POST /api/v1/sql/execute';
const STATUS = 'GET /api/v1/execution/{id}/status';
const RESULTS = 'GET /api/v1/execution/{id}/results';

export interface DuneConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  /** How long one run may take before it is abandoned. */
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface DuneRun {
  readonly rows: readonly Record<string, unknown>[];
  /** What the execution reported it cost, when it said. */
  readonly credits: number | null;
}

/** The execution's state, read from a status reply. */
export function readState(raw: unknown): { readonly state: string; readonly credits: number | null } {
  const r = rec(raw);
  return { state: str(r.state) ?? 'unknown', credits: num(r.execution_cost_credits) ?? num(rec(r.result_metadata).execution_cost_credits) };
}

/** The rows of a finished execution. */
export function readRows(raw: unknown): readonly Record<string, unknown>[] {
  return arr(rec(rec(raw).result).rows).map((row) => rec(row));
}

/** `{{name}}` → its value, for a query kept in tools/dune with parameters. A value is never SQL. */
export function fillParameters(sql: string, values: Readonly<Record<string, string | number>>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`query parameter {{${name}}} has no value`);
    if (typeof v === 'number') return String(v);
    if (!/^[\w\-: .]+$/.test(v)) throw new Error(`query parameter {{${name}}} is not a plain value`);
    return v;
  });
}

export function duneClient(config: DuneConfig) {
  const call = async (method: 'GET' | 'POST', path: string, label: string, body?: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: { 'x-dune-api-key': config.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new VendorUnavailable(VENDOR, label, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    if (!response.ok) throw new VendorUnavailable(VENDOR, label, `responded ${response.status}`, response.status);
    return response.json();
  };

  return {
    async run(sql: string, performance: 'medium' | 'large' = 'medium'): Promise<DuneRun> {
      const started = rec(await call('POST', '/api/v1/sql/execute', EXECUTE, { sql, performance }));
      const id = str(started.execution_id);
      if (id === null) throw new VendorUnavailable(VENDOR, EXECUTE, 'no execution id in the reply');
      for (let waited = 0; waited <= config.timeoutMs; waited += config.pollMs) {
        const { state, credits } = readState(await call('GET', `/api/v1/execution/${encodeURIComponent(id)}/status`, STATUS));
        if (state === 'QUERY_STATE_COMPLETED') {
          return { rows: readRows(await call('GET', `/api/v1/execution/${encodeURIComponent(id)}/results`, RESULTS)), credits };
        }
        if (state === 'QUERY_STATE_FAILED' || state === 'QUERY_STATE_CANCELLED' || state === 'QUERY_STATE_EXPIRED') {
          throw new VendorUnavailable(VENDOR, STATUS, `execution ${state}`);
        }
        await config.sleep(config.pollMs);
      }
      throw new VendorUnavailable(VENDOR, STATUS, `still running after ${config.timeoutMs} ms`);
    },
  };
}
