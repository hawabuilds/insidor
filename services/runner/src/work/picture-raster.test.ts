import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashBytes, isRaster } from './picture-hash.ts';

test('★ an SVG never reaches the image library: its native reader aborts the process on a bad file', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  assert.equal(isRaster(svg), false);
  assert.equal(await hashBytes(svg), null);
  assert.equal(isRaster(new TextEncoder().encode('<?xml version="1.0"?><svg/>')), false);
  assert.equal(isRaster(new TextEncoder().encode('<html>not found</html>')), false);
});

test('the raster formats a logo comes in are recognised by their opening bytes', () => {
  const b = (...v: number[]) => Uint8Array.from([...v, ...new Array(16).fill(0)]);
  const s = (t: string) => Uint8Array.from([...t].map((c) => c.charCodeAt(0)));
  assert.ok(isRaster(b(0x89, 0x50, 0x4e, 0x47)));
  assert.ok(isRaster(b(0xff, 0xd8, 0xff, 0xe0)));
  assert.ok(isRaster(s('GIF89a....')));
  assert.ok(isRaster(s('RIFF\0\0\0\0WEBPVP8 ')));
  assert.ok(isRaster(s('\0\0\0\x1cftypavif....')));
});
