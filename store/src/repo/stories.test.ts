/**
 * ★ THE DIRECTION A MERGE MAY TRAVEL ACROSS PROVENANCE.
 *
 * `public.story.origin` is a fact about how a row came to exist, so nothing updates it —
 * 0016 says so, and `PgStoryRepo.upsert` leaves it out of its SET for the same reason it
 * leaves `created_at` alone. That immutability is what makes `merge` the one call in this
 * package that can move OBSERVED items under a FIXTURE story's allowlist: the survivor
 * keeps its origin, and `coinOriginsVisibleTo` lets a fixture story name invented coins.
 * The result is a fiction's provenance wrapped around content people actually posted.
 *
 * Nothing calls `merge` in the repository today. These tests exist anyway, on the argument
 * the asset repo's `chains()` makes about a hole today's data happens not to walk through:
 * the day a merge is wired is the day nobody is thinking about provenance.
 *
 * Against a fake `Db` that answers the origin lookup and records the rest, which is this
 * package's posture everywhere — no test here asks a runner for a database.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { StoryId } from '@insidor/contracts/ids.ts';
import type { StoryOrigin } from '@insidor/contracts/story.ts';

import type { Db } from '../client.ts';
import { PgStoryRepo } from './stories.ts';

/**
 * A Db that answers the origin lookup from the given table and records every statement.
 *
 * The origin read is told apart by its own text rather than by call order, so a future
 * statement added ahead of it does not silently turn this fake into one that answers the
 * wrong query with a list of origins.
 */
function fakeDb(origins: Readonly<Record<string, StoryOrigin>>): {
  db: Db;
  statements: () => readonly string[];
} {
  const seen: string[] = [];
  return {
    db: {
      query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
        seen.push(sql.replace(/\s+/g, ' ').trim());
        if (!sql.includes('select story_id, origin')) return [];
        const ids = (params?.[0] ?? []) as readonly string[];
        return ids
          .filter((id) => origins[id] !== undefined)
          .map((id) => ({ story_id: id, origin: origins[id] }) as R);
      },
    },
    statements: () => seen,
  };
}

const AT = 1_700_000_000_000 as Millis;
const id = (s: string): StoryId => s as unknown as StoryId;

test('★ an observed story may not be merged into a fixture story', async () => {
  /* THE DANGEROUS DIRECTION, AND THE ONLY ONE THAT IS REFUSED. The survivor would keep
     `origin = 'fixture'` while holding members that came from the world, and a fixture
     story may see fixture coins — so an invented coin would be named beside posts people
     actually wrote, with a cap next to it. That is the exact pairing every origin rule in
     this repository exists to make unsayable, arriving through the one call that moves
     members between rows without touching either row's origin. */
  const { db, statements } = fakeDb({ obs: 'observed', fix: 'fixture' });

  await assert.rejects(
    () => new PgStoryRepo(db).merge(id('obs'), id('fix'), AT),
    /refusing to merge observed story obs into fixture story fix/,
  );

  /* ★ AND IT IS REFUSED BEFORE ANYTHING IS WRITTEN. A guard that throws after the update
     has already run is not a guard, it is a log line — the merge would be committed and
     the exception would only tell somebody about it. */
  assert.equal(
    statements().some((sql) => sql.startsWith('update') || sql.startsWith('insert')),
    false,
    'the merge wrote before it refused',
  );
});

test('a fixture story merged into an observed story is allowed, and narrows', async () => {
  /* THE OTHER DIRECTION, WHICH IS NOT AN OVERSIGHT. The survivor stays 'observed', so it
     sees observed coins only and the demonstration members lose their demonstration coins.
     A demo showing less than it meant to is the direction this vocabulary is built to fail
     in — the same asymmetry `coinOriginsVisibleTo` is written around. */
  const { db, statements } = fakeDb({ obs: 'observed', fix: 'fixture' });
  await new PgStoryRepo(db).merge(id('fix'), id('obs'), AT);

  assert.equal(
    statements().some((sql) => sql.startsWith('update public.story')),
    true,
    'the allowed merge did not write',
  );
});

test('two stories of the same origin merge, in both vocabularies', async () => {
  /* The ordinary case, asserted so the guard is not accidentally a ban on merging. Both
     values of the vocabulary, because a rule tested on one of two members is a rule tested
     on half of itself. */
  for (const origin of ['observed', 'fixture'] as const) {
    const { db } = fakeDb({ a: origin, b: origin });
    await new PgStoryRepo(db).merge(id('a'), id('b'), AT);
  }
});

test('a merge naming a story that does not exist is a throw, not a skipped check', async () => {
  /* The version of this guard that shrugs at a missing origin is the version that passes
     when the read failed — and it would pass in the direction that permits the merge. An
     absent row is already wrong, so it fails here rather than proceeding on a `undefined`
     that compares unequal to 'fixture' and therefore looks safe. */
  const { db } = fakeDb({ obs: 'observed' });

  await assert.rejects(
    () => new PgStoryRepo(db).merge(id('obs'), id('ghost'), AT),
    /story ghost does not exist to merge into/,
  );
  await assert.rejects(
    () => new PgStoryRepo(db).merge(id('ghost'), id('obs'), AT),
    /story ghost does not exist to be merged/,
  );
});

test('a story still cannot be merged into itself, and that check runs first', async () => {
  /* Unchanged behaviour, kept under test because the provenance guard was inserted directly
     beneath it and a self-merge would otherwise reach the origin lookup — where both ids
     resolve to the same row, the origins match, and the merge would be permitted. */
  const { db, statements } = fakeDb({ a: 'observed' });
  await assert.rejects(
    () => new PgStoryRepo(db).merge(id('a'), id('a'), AT),
    /a story cannot be merged into itself/,
  );
  assert.deepEqual(statements(), [], 'the self-merge check reached the database');
});

/* ★ HELD READS. `openSince` and `membersForStories` read versions every time and rows only for
   what changed. Checked against the live store, read only: the same 2,000 stories and 973
   members on three passes, ~15–20% of the bytes once held. */
test('openSince and membersForStories read a story or its members whole only when they changed', async () => {
  const stories = new Map([
    ['st_a', { v: '1', count: 2 }],
    ['st_b', { v: '1', count: 1 }],
  ]);
  const members = new Map([
    ['st_a', ['x:1', 'x:2']],
    ['st_b', ['x:3']],
  ]);
  const wholeStories: string[][] = [];
  const wholeMembers: string[][] = [];
  const at = new Date(AT);
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes('select story_id, xmin::text as v')) return [...stories].map(([story_id, s]) => ({ story_id, v: s.v }) as R);
      if (sql.includes('from public.story where story_id = any')) {
        const ids = (params?.[0] ?? []) as string[];
        wholeStories.push(ids);
        return ids.map((story_id) => ({
          story_id, origin: 'observed', created_at: at, earliest_post_at: at, promoted_at: null, last_member_at: at, state: 'candidate',
          carriers: [], merged_into: null, member_count: stories.get(story_id)?.count ?? 0, distinct_authors: 1, distinct_sources: 1, v: stories.get(story_id)?.v,
        }) as R);
      }
      if (sql.includes("count(*)::text || '/'")) {
        const ids = (params?.[0] ?? []) as string[];
        return ids.flatMap((sid) => (members.has(sid) ? [{ story_id: sid, v: `${members.get(sid)?.length}` } as R] : []));
      }
      if (sql.includes('from public.story_member m')) {
        const ids = (params?.[0] ?? []) as string[];
        wholeMembers.push(ids);
        return ids.flatMap((sid) => (members.get(sid) ?? []).map((item_id) => ({
          story_id: sid, item_id, author_key: 'x:a', source: 'x', posted_at: at, joined_at: at, evidence_kind: 'seed',
          carrier_kind: null, carrier_key: null, carrier_distance: null, carrier_weight: null, lineage_via: null, lineage_to_item: null,
          representation_similarity: null, representation_space: null, adjudicated_by: null, adjudicated_at: null,
          name_key: null, image_similarity: null, image_space: null, image_confirmed: null,
        }) as R));
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  const repo = new PgStoryRepo(db);
  const page = async () => (await repo.openSince(AT, 10)).map((s) => `${s.storyId}:${s.memberCount}`);
  const lists = async () => Object.fromEntries([...(await repo.membersForStories([id('st_a'), id('st_b'), id('st_none')]))].map(([k, v]) => [k, v.map((m) => m.itemId)]));

  assert.deepEqual(await page(), ['st_a:2', 'st_b:1']);
  assert.deepEqual(await lists(), { st_a: ['x:1', 'x:2'], st_b: ['x:3'] });
  assert.deepEqual(await page(), ['st_a:2', 'st_b:1']);
  assert.deepEqual(await lists(), { st_a: ['x:1', 'x:2'], st_b: ['x:3'] });
  assert.equal(wholeStories.length, 1);
  assert.equal(wholeMembers.length, 1);

  /* st_b gains a member: its row and its member list are read again, st_a's are not. */
  stories.set('st_b', { v: '2', count: 2 });
  members.set('st_b', ['x:3', 'x:4']);
  assert.deepEqual(await page(), ['st_a:2', 'st_b:2']);
  assert.deepEqual(await lists(), { st_a: ['x:1', 'x:2'], st_b: ['x:3', 'x:4'] });
  assert.deepEqual(wholeStories[1], ['st_b']);
  assert.deepEqual(wholeMembers[1], ['st_b']);
});
