/**
 * Dune's execution replies in its documented shape (status, then results), hand-written for one
 * counts query; no network. Numbers are illustrative, not measured.
 */
export const STARTED = { execution_id: '01HEXAMPLEEXECUTION', state: 'QUERY_STATE_PENDING' };
export const RUNNING = { execution_id: '01HEXAMPLEEXECUTION', query_id: 0, state: 'QUERY_STATE_EXECUTING', is_execution_finished: false };
export const DONE = { execution_id: '01HEXAMPLEEXECUTION', query_id: 0, state: 'QUERY_STATE_COMPLETED', is_execution_finished: true, execution_cost_credits: 12.5 };
export const RESULTS = {
  execution_id: '01HEXAMPLEEXECUTION',
  state: 'QUERY_STATE_COMPLETED',
  result: { rows: [{ launched: 17500000, graduated: 190000, first_launch: '2024-01-19 00:00:00.000 UTC', last_launch: '2026-10-12 00:00:00.000 UTC' }], metadata: { column_names: ['launched', 'graduated', 'first_launch', 'last_launch'], row_count: 1 } },
};
export const FAILED = { execution_id: '01HEXAMPLEEXECUTION', state: 'QUERY_STATE_FAILED', error: { message: 'table not found' } };
