/**
 * ★ The judge's cost alarm reads one endpoint's billed calls in buckets counted back from now
 * (services/runner judge-cost-alarm.ts). Proven against a fake database: the query is asked for
 * the exact endpoint with billed rows only, and numeric dollars come back as numbers.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { PgSpendRepo } from './spend.ts';

const H = 3_600_000;

test('★ callBuckets asks for one endpoint\'s billed calls, counted back from the end, and reads dollars as numbers', async () => {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      seen.push({ sql, params });
      return [{ k: 0, calls: '119', usd: '1.13880000' }, { k: '2', calls: 150, usd: 0.18 }];
    },
  } as unknown as Db;
  const out = await new PgSpendRepo(db).callBuckets('judge-open', (10 * H) as Millis, (20 * H) as Millis, H);
  assert.deepEqual(out, [{ ago: 0, calls: 119, usd: 1.1388 }, { ago: 2, calls: 150, usd: 0.18 }]);
  assert.match(seen[0]?.sql ?? '', /endpoint = \$1 and units > 0/, 'a refusal booked at $0 is no call');
  assert.equal(seen[0]?.params[0], 'judge-open');
  assert.equal(seen[0]?.params[3], H);
});

test('a dollar figure that is not a number stops the read rather than reading as zero', async () => {
  const db = { query: async () => [{ k: 0, calls: 3, usd: 'abc' }] } as unknown as Db;
  await assert.rejects(new PgSpendRepo(db).callBuckets('judge-open', 0 as Millis, H as Millis, H), /not a finite number/);
});
