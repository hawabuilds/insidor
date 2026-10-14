/**
 * The poster-picture copier with a stand-in database and storage: a link is fetched once, a
 * re-read of the same picture copies nothing, a refused link keeps the copy there is, and before
 * migration 0079 nothing is fetched at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { posterFile, posterPass, type PosterDeps } from './poster-pics.ts';

const LINK = 'https://p16.example/avt/abc~300.jpeg?x-expires=1&x-signature=a';

function deps(rows: Record<string, unknown>[], over: Partial<PosterDeps> = {}, migrated = true) {
  const recorded: unknown[][] = [];
  const copied: string[] = [];
  const d: PosterDeps = {
    db: {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('information_schema')) return (migrated ? [{ '?column?': 1 }] : []) as never[];
        if (sql.includes('update public.author')) recorded.push([...(params ?? [])]);
        if (sql.includes('with shown')) return rows as never[];
        return [] as never[];
      },
    },
    elapsedMs: () => 0,
    copy: async (file) => void copied.push(file),
    log: () => {},
    ...over,
  };
  return { d, recorded, copied };
}

test('★ the name ignores the signature, so a re-read of the same picture is the same file', () => {
  const again = LINK.replace('signature=a', 'signature=b');
  assert.equal(posterFile('s:1', LINK), posterFile('s:1', again));
  assert.match(posterFile('s:1', LINK), /^[0-9a-f]{32}$/);
  assert.notEqual(posterFile('s:1', LINK), posterFile('s:1', LINK.replace('abc', 'new')), 'a new picture is a new file');
  assert.notEqual(posterFile('s:1', LINK), posterFile('s:2', LINK));
});

test('a new link is copied and recorded with its name', async () => {
  const { d, recorded, copied } = deps([{ author_key: 's:1', picture_url: LINK, picture_copy: null }]);
  assert.equal((await posterPass(d)).copied, 1);
  assert.deepEqual(copied, [posterFile('s:1', LINK)]);
  assert.deepEqual(recorded, [['s:1', LINK, posterFile('s:1', LINK)]]);
});

test('the same picture under a fresh signature is recorded without fetching', async () => {
  const { d, copied } = deps([{ author_key: 's:1', picture_url: LINK, picture_copy: posterFile('s:1', LINK) }]);
  assert.equal((await posterPass(d)).same, 1);
  assert.deepEqual(copied, []);
});

test('★ a refused link is taken up (not fetched again) and keeps the copy there is', async () => {
  const { d, recorded } = deps([{ author_key: 's:1', picture_url: LINK, picture_copy: 'old' }], {
    copy: async () => {
      throw new Error('not a PNG, JPEG, WebP or GIF');
    },
  });
  assert.equal((await posterPass(d)).refused, 1);
  assert.deepEqual(recorded, [['s:1', LINK, null]], 'null keeps picture_copy as it was');
});

test('before migration 0079 nothing is fetched', async () => {
  const { d, copied } = deps([{ author_key: 's:1', picture_url: LINK, picture_copy: null }], {}, false);
  assert.deepEqual(await posterPass(d), { copied: 0, same: 0, refused: 0, skippedForTime: 0 });
  assert.deepEqual(copied, []);
});
