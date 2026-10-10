/**
 * Every sample story's picture exists, and every picture is credited. A missing file is a
 * broken image on a public page; an uncredited one is a photo nobody can trace back to its
 * licence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeBoardTick, decodeStory } from './decode.ts';
import { fixtureBoard, fixtureStory, sampleNarrativeIds } from './fixtures.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public');
const CREDITS = readFileSync(join(PUBLIC, 'sample', 'CREDITS.md'), 'utf8');

test('every sample story has its own picture, present on disk and credited', () => {
  const ids = [...decodeBoardTick(fixtureBoard()).order, ...sampleNarrativeIds()];
  for (const id of ids) {
    const url = decodeStory(fixtureStory(id)).thumbUrl;
    assert.ok(url !== null && url.startsWith('/sample/'), `${id} has no sample picture`);
    const file = url.slice('/sample/'.length);
    assert.ok(existsSync(join(PUBLIC, 'sample', file)), `${id}: ${file} is missing`);
    assert.ok(CREDITS.includes(`\`${file}\``), `${id}: ${file} is not in CREDITS.md`);
  }
});

test('no two cards on the feed share a picture', () => {
  const urls = decodeBoardTick(fixtureBoard()).rows.map((r) => r.thumbUrl);
  assert.equal(new Set(urls).size, urls.length);
});
