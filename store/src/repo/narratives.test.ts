/**
 * The narrative page queue's turns (`fairTurns`, used by `pagesDue`): the projector writes 25 older
 * pages a frame, and until 2026-10-23 the pages never written always went first — about 115 that
 * the listing rule dropped every frame took every place, and 751 of 957 pages went over an hour
 * unwritten. These hold that neither side can take every place while the other waits.
 *
 * Pure: the two lists are what the two reads return; no database is asked (as the rest of this
 * package's tests).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fairTurns, OWNER_TITLE_MODEL, PgNarrativeRepo } from './narratives.ts';
import type { Db } from '../client.ts';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('★ never-written pages take at most half the places; the oldest-written get the rest', () => {
  const out = fairTurns(ids('new', 115), ids('old', 900), 25);
  assert.equal(out.length, 25);
  assert.equal(out.filter((x) => x.startsWith('new')).length, 13);
  assert.deepEqual(out.filter((x) => x.startsWith('old')), ids('old', 12), 'the longest since written, in order');
});

test('a side short of its share gives its places to the other', () => {
  assert.deepEqual(fairTurns(ids('new', 3), ids('old', 900), 25), [...ids('new', 3), ...ids('old', 22)]);
  assert.deepEqual(fairTurns(ids('new', 115), ids('old', 4), 25), [...ids('new', 21), ...ids('old', 4)]);
  assert.deepEqual(fairTurns([], [], 25), []);
});

test('★ the titler never writes over a title the owner typed (0130): its update skips title_model owner', async () => {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const db = { query: async (sql: string, params: readonly unknown[] = []) => (seen.push({ sql, params }), []) } as unknown as Db;
  await new PgNarrativeRepo(db).setTitle('n-x:1', 'Cat Meme War', 12, 'nvidia/nemotron');
  assert.match(seen[0]?.sql ?? '', /title_model is distinct from \$5/);
  assert.deepEqual(seen[0]?.params, ['n-x:1', 'Cat Meme War', 12, 'nvidia/nemotron', OWNER_TITLE_MODEL]);
  assert.equal(OWNER_TITLE_MODEL, 'owner', 'the same mark services/social writes');
});

test('★ an owner\'s add moves the post\'s one row into his narrative (stored posts and open narratives only), and both are recounted', async () => {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      seen.push({ sql, params });
      if (/ as ok/.test(sql)) return [{ ok: true }];
      if (sql.includes('select narrative_id from internal.narrative_member where item_id')) return [{ narrative_id: 'n-cat' }];
      if (sql.includes('returning item_id')) return [{ item_id: params[0] }];
      return [];
    },
  } as unknown as Db;
  assert.equal(await new PgNarrativeRepo(db).save({ narratives: [], retired: [], added: [{ itemId: 'x:9', into: 'n-war' }] }), true);
  const move = seen.find((q) => q.sql.includes('on conflict (item_id) do update'));
  assert.ok(move !== undefined);
  assert.match(move.sql, /exists \(select 1 from public\.item i where i\.item_id = \$1\)/, 'a post not stored yet waits');
  assert.match(move.sql, /t\.state = 'open'/);
  assert.deepEqual(move.params, ['x:9', 'n-war']);
  const recount = seen.find((q) => q.sql.includes('set member_count'));
  assert.deepEqual([...((recount?.params[0] as string[]) ?? [])].sort(), ['n-cat', 'n-war']);
});

test('★ the meme-war answer is written whoever wrote the title, and nothing before 0130', async () => {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const has = (ok: boolean) => ({ query: async (sql: string, params: readonly unknown[] = []) => (seen.push({ sql, params }), / as ok/.test(sql) ? [{ ok }] : []) }) as unknown as Db;
  await new PgNarrativeRepo(has(true)).setFight('n-war', ['China', 'Turkey'], 'nvidia/nemotron');
  const write = seen.find((q) => q.sql.includes('set fight'));
  assert.deepEqual(write?.params, ['n-war', ['China', 'Turkey'], 'nvidia/nemotron', OWNER_TITLE_MODEL]);
  assert.doesNotMatch(write?.sql ?? '', /title_model/, 'an owner title does not stop it');
  assert.match(write?.sql ?? '', /fight_model is distinct from \$4/, 'the owner\'s own answer does');
  seen.length = 0;
  await new PgNarrativeRepo(has(false)).setFight('n-war', [], 'm');
  assert.equal(seen.some((q) => q.sql.includes('set fight')), false);
  assert.deepEqual(await new PgNarrativeRepo(has(false)).fightUnasked(0, 10), []);
});

test('★ once listed, listed (0135): a written page marks its narrative the first time only, and a listed one without a page goes first', async () => {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const db = { query: async (sql: string, params: readonly unknown[] = []) => (seen.push({ sql, params }), / as ok/.test(sql) ? [{ ok: true }] : []) } as unknown as Db;
  const repo = new PgNarrativeRepo(db);
  await repo.markListed(['n-x:1']);
  const mark = seen.find((s) => s.sql.includes('set listed_at'));
  assert.match(mark?.sql ?? '', /and listed_at is null/, 'never moved once set');
  assert.deepEqual(mark?.params, [['n-x:1']]);
  await repo.pagesDue(25, []);
  const never = seen.find((s) => s.sql.includes('not exists (select 1 from public.story_view'));
  assert.match(never?.sql ?? '', /order by \(n\.listed_at is null\), n\.updated_at/);
});

test('the owner\'s narrative calls are held and only the newer ones read', async () => {
  const table = [
    { id: 1, at: new Date(1000), item_id: 'n1', verdict: 'merge', other_id: 'n2', coin_address: null, members: null, other_members: null },
    { id: 2, at: new Date(2000), item_id: 'n3', verdict: 'hide', other_id: null, coin_address: null, members: null, other_members: null },
  ];
  const reads: string[] = [];
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes('to_regclass')) return [{ ok: true } as R];
      if (sql.includes('count(*)::int as n')) return [{ n: table.length, m: String(Math.max(...table.map((r) => r.id))) } as R];
      if (sql.includes('id > $1')) {
        reads.push(`after ${String(params?.[0])}`);
        return table.filter((r) => r.id > Number(params?.[0])) as R[];
      }
      reads.push('whole');
      return [...table].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id) as R[];
    },
  };
  const ids = async () => (await new PgNarrativeRepo(db).calls()).map((c) => c.id);
  assert.deepEqual(await ids(), [1, 2]);
  assert.deepEqual(await ids(), [1, 2]);
  assert.deepEqual(reads, ['whole']);
  table.push({ id: 3, at: new Date(3000), item_id: 'n4', verdict: 'hide', other_id: null, coin_address: null, members: null, other_members: null });
  assert.deepEqual(await ids(), [1, 2, 3]);
  assert.deepEqual(reads, ['whole', 'after 2']);
  /* A lower id that committed late: the count still differs after the catch-up, so all is read again. */
  table.push({ id: 5, at: new Date(5000), item_id: 'n5', verdict: 'hide', other_id: null, coin_address: null, members: null, other_members: null });
  await ids();
  table.push({ id: 4, at: new Date(4000), item_id: 'n6', verdict: 'hide', other_id: null, coin_address: null, members: null, other_members: null });
  assert.deepEqual(await ids(), [1, 2, 3, 4, 5]);
  assert.deepEqual(reads, ['whole', 'after 2', 'after 3', 'after 5', 'whole']);
});
