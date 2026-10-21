/**
 * Our copy of each post picture, named at read time: found by the link's path whatever its
 * signature, on a card, a narrative and each of its posts; nothing added where there is no copy;
 * and a database before 0119 sends every payload as projected.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { linkPath, PICTURE_FILES_SQL, withPictureFiles } from './post-pics.ts';

const F = '0123456789abcdef0123456789abcdef';
const SIGNED = 'https://p16.example/obj/a~cover.jpeg?x-expires=2&x-signature=new';

const db = (rows: Record<string, unknown>[], missing = false) => ({
  query: async (sql: string, params?: readonly unknown[]) => {
    if (sql !== PICTURE_FILES_SQL) return [];
    if (missing) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const asked = (params?.[0] ?? []) as string[];
    return rows.filter((r) => asked.includes(r['link_path'] as string)) as never[];
  },
});

test('★ a card finds its copy by the path of whatever signed link it carries', async () => {
  const [card] = await withPictureFiles(db([{ link_path: linkPath(SIGNED), file: F }]), [{ id: 'p', thumbUrl: SIGNED }]);
  assert.deepEqual(card, { id: 'p', thumbUrl: SIGNED, thumbFile: F });
});

test('a narrative and each of its posts get their own copy; a picture with none is left as projected', async () => {
  const story = { id: 's', thumbUrl: 'https://pbs.example/a.jpg', evidence: [{ evidenceId: 'x:1', thumbUrl: 'https://pbs.example/a.jpg' }, { evidenceId: 'x:2', thumbUrl: 'https://pbs.example/b.jpg' }, { evidenceId: 'x:3', thumbUrl: null }] };
  const [out] = (await withPictureFiles(db([{ link_path: 'https://pbs.example/a.jpg', file: F }]), [story])) as readonly Record<string, unknown>[];
  assert.equal(out?.['thumbFile'], F);
  const evidence = out?.['evidence'] as Record<string, unknown>[];
  assert.equal(evidence[0]?.['thumbFile'], F);
  assert.equal('thumbFile' in (evidence[1] ?? {}), false, 'no copy is no field, never a guess');
  assert.equal(evidence[2], story.evidence[2]);
});

test('★ nothing copied, a name that is not 32 hex, and a database before 0119 all send the payload untouched', async () => {
  const card = { id: 'p', thumbUrl: SIGNED };
  assert.equal((await withPictureFiles(db([]), [card]))[0], card);
  assert.equal((await withPictureFiles(db([{ link_path: linkPath(SIGNED), file: '../x' }]), [card]))[0], card);
  assert.equal((await withPictureFiles(db([], true), [card]))[0], card);
});
