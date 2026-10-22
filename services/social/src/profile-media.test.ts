import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkedImage, mediaRoute, newFileName, typedName } from './profile-media.ts';

/* A real 1x1 PNG: the check reads the type from the data URL and the size from the bytes. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a file name is ours: 32 hex characters, new every time', () => {
  const a = newFileName();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, newFileName());
});

test('★ the type and the size are checked before anything is stored', () => {
  assert.equal(checkedImage({ image: PNG }).ok, true);
  assert.deepEqual(checkedImage({}), { ok: false, why: 'Pick a picture.' });
  assert.deepEqual(checkedImage({ image: 'data:image/svg+xml;base64,PHN2Zz4=' }), { ok: false, why: 'Use a PNG, JPEG, WebP or GIF picture.' });
  const big = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`;
  assert.deepEqual(checkedImage({ image: big }), { ok: false, why: 'That picture is over 2 MB. Pick a smaller one.' });
});

test('a typed name is trimmed and capped; empty goes back to the sign-in name', () => {
  assert.deepEqual(typedName('  Hawa   Van '), { name: 'Hawa Van' });
  assert.deepEqual(typedName(''), { name: null });
  assert.equal(typedName('x'.repeat(51)), null);
  assert.equal(typedName(3), null);
});

test('★ no storage: the upload says so and nothing is written', async () => {
  const writes: unknown[] = [];
  const db = { query: async (sql: string, params?: readonly unknown[]) => (writes.push([sql, params]), []) };
  const r = await mediaRoute('POST', 'banner', { image: PNG }, 'u1', { db, media: null });
  assert.equal(r.status, 503);
  assert.equal(writes.length, 0);
});

test('an upload stores the file under its new name, then points the profile at it', async () => {
  const stored: string[] = [];
  const writes: (readonly unknown[] | undefined)[] = [];
  const db = { query: async (_sql: string, params?: readonly unknown[]) => (writes.push(params), []) };
  const r = await mediaRoute('POST', 'picture', { image: PNG }, 'u1', { db, media: { put: async (file) => void stored.push(file) } });
  assert.equal(r.status, 200);
  const file = (JSON.parse(r.body) as { pictureFile: string }).pictureFile;
  assert.deepEqual(stored, [file]);
  assert.deepEqual(writes, [['u1', file]]);
});

test('a store that fails leaves the profile as it was', async () => {
  const writes: unknown[] = [];
  const db = { query: async () => (writes.push(1), []) };
  const r = await mediaRoute('POST', 'picture', { image: PNG }, 'u1', { db, media: { put: async () => { throw new Error('down'); } } });
  assert.equal(r.status, 503);
  assert.equal(writes.length, 0);
});
