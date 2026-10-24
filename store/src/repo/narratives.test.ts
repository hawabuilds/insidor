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

test('★ the titler never writes over a title the owner typed (0129): its update skips title_model owner', async () => {
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

test('★ the meme-war answer is written whoever wrote the title, and nothing before 0129', async () => {
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
