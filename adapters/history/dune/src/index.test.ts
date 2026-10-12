import test from 'node:test';
import assert from 'node:assert/strict';

import { DONE, FAILED, RESULTS, RUNNING, STARTED } from './__fixtures__/execution.ts';
import { duneClient, fillParameters } from './index.ts';

function client(replies: unknown[]) {
  const asked: string[] = [];
  const c = duneClient({
    apiKey: 'test', baseUrl: 'https://dune.example', timeoutMs: 1_000, pollMs: 100, sleep: async () => undefined,
    fetch: (async (url: string, init: RequestInit) => {
      asked.push(`${init.method} ${new URL(url).pathname}`);
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { c, asked };
}

test('★ a run waits for the execution to finish, then returns its rows and what it cost', async () => {
  const { c, asked } = client([STARTED, RUNNING, DONE, RESULTS]);
  const run = await c.run('select 1');
  assert.equal(run.rows[0]?.['graduated'], 190000);
  assert.equal(run.credits, 12.5);
  assert.deepEqual(asked, ['POST /api/v1/sql/execute', 'GET /api/v1/execution/01HEXAMPLEEXECUTION/status', 'GET /api/v1/execution/01HEXAMPLEEXECUTION/status', 'GET /api/v1/execution/01HEXAMPLEEXECUTION/results']);
});

test('★ a failed execution throws; it is never an empty result', async () => {
  const { c } = client([STARTED, FAILED]);
  await assert.rejects(c.run('select 1'), /QUERY_STATE_FAILED/);
});

test('a run still pending past its ceiling is abandoned, not read as empty', async () => {
  const { c } = client([STARTED, ...Array.from({ length: 20 }, () => RUNNING)]);
  await assert.rejects(c.run('select 1'), /still running/);
});

test('a query parameter is a plain value or a number, never SQL', () => {
  assert.equal(fillParameters("where t >= timestamp '{{start}}' and v >= {{bar}}", { start: '2026-01-01', bar: 50 }), "where t >= timestamp '2026-01-01' and v >= 50");
  assert.throws(() => fillParameters('{{x}}', { x: "1'; drop table x; --" }), /not a plain value/);
  assert.throws(() => fillParameters('{{missing}}', {}), /no value/);
});

test('a refusal carries Dune\'s own reason', async () => {
  const c = duneClient({
    apiKey: 'test', baseUrl: 'https://dune.example', timeoutMs: 1_000, pollMs: 100, sleep: async () => undefined,
    fetch: (async () => new Response(JSON.stringify({ error: 'Invalid performance tier' }), { status: 400 })) as unknown as typeof fetch,
  });
  await assert.rejects(c.run('select 1'), /400: Invalid performance tier/);
});

test('no engine tier is sent unless one is asked for', async () => {
  const bodies: unknown[] = [];
  const replies: unknown[] = [STARTED, DONE, RESULTS];
  const c = duneClient({
    apiKey: 'test', baseUrl: 'https://dune.example', timeoutMs: 1_000, pollMs: 100, sleep: async () => undefined,
    fetch: (async (_u: string, init: RequestInit) => {
      if (init.body !== undefined) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(replies.shift()));
    }) as unknown as typeof fetch,
  });
  await c.run('select 1');
  assert.deepEqual(bodies[0], { sql: 'select 1' });
});
