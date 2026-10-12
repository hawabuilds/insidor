import test from 'node:test';
import assert from 'node:assert/strict';

import { TINY_PNG, UPLOADED } from './__fixtures__/upload.ts';
import { metadataDocument, readImage, supabaseStorage } from './index.ts';

test('a picture is stored first, then the document naming it; the coin points at the document', async () => {
  const sent: { url: string; type: string | null }[] = [];
  const s = supabaseStorage({
    url: 'https://proj.supabase.example', serviceKey: 'k', id: () => 'abc',
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, type: (init.headers as Record<string, string>)['content-type'] ?? null });
      return new Response(JSON.stringify(UPLOADED(String(url).split('/').pop() ?? '')));
    }) as unknown as typeof fetch,
  });
  const r = await s.upload({ name: 'Jimothy', symbol: 'JIM', description: 'a raccoon', imageDataUrl: TINY_PNG, links: { twitter: 'https://x.com/a/status/1', website: 'javascript:alert(1)' } });
  assert.deepEqual(sent.map((x) => x.type), ['image/png', 'application/json']);
  assert.equal(r.uri, 'https://proj.supabase.example/storage/v1/object/public/launch-metadata/abc.json');
  assert.equal(r.image, 'https://proj.supabase.example/storage/v1/object/public/launch-metadata/abc.png');
});

test('★ only a real picture under 2 MB, and only https links, are ever stored', () => {
  assert.throws(() => readImage('data:image/svg+xml;base64,PHN2Zy8+'), /PNG, JPEG, WebP or GIF/, 'an SVG can carry script');
  assert.throws(() => readImage('data:text/html;base64,PGgxPg=='), /Pick a picture/);
  assert.throws(() => readImage('not a picture'), /Pick a picture/);
  const doc = metadataDocument({ name: 'J', symbol: 'J', description: '', imageDataUrl: TINY_PNG, links: { twitter: 'https://x.com/a', telegram: 'http://t.me/x', website: 'javascript:alert(1)' } }, 'https://img');
  assert.equal(doc['twitter'], 'https://x.com/a');
  assert.equal('telegram' in doc, false);
  assert.equal('website' in doc, false);
});
