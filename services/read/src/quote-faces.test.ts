/** The quoted account's face on a card: added from the account row or the quote's own copy, nothing when none, never a 500 before 0128. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { withFile } from './post-pics.ts';
import { QUOTE_FACES_ITEMS_SQL, QUOTE_FACES_SQL, withQuoteFaces } from './quote-faces.ts';
import type { Row } from './queries.ts';

const CARD = { id: 'x:1', thumbUrl: 'https://p/cat.jpg', quote: { id: 'x:2', authorLabel: '@catowner', thumbUrl: 'https://p/cat.jpg' } };
const FILE = '0123456789abcdef0123456789abcdef';

test('★ the quoted account\'s picture and our copy of it are put on the quote', async () => {
  const db = { query: async (sql: string): Promise<readonly Row[]> => (sql === QUOTE_FACES_SQL ? [{ id: 'x:2', picture_url: 'https://p/me.jpg', picture_copy: FILE }] : []) };
  const [card] = await withQuoteFaces(db, [CARD, { id: 'x:3' }]);
  assert.deepEqual((card as typeof CARD & { quote: Record<string, unknown> }).quote, { ...CARD.quote, authorPictureUrl: 'https://p/me.jpg', authorPictureFile: FILE });
});

test('★ the huge account that just shared the post gets its face too, beside the quote\'s, from one read', async () => {
  const shared = { ...CARD, sharedBy: { id: 'x:9', authorLabel: '@elonmusk', how: 'quoted' } };
  let reads = 0;
  const db = {
    query: async (sql: string, params?: readonly unknown[]): Promise<readonly Row[]> => {
      reads += 1;
      assert.deepEqual(params?.[0], ['x:2', 'x:9']);
      return sql === QUOTE_FACES_SQL ? [{ id: 'x:2', picture_url: 'https://p/me.jpg', picture_copy: null }, { id: 'x:9', picture_url: 'https://p/elon.jpg', picture_copy: FILE }] : [];
    },
  };
  const [card] = (await withQuoteFaces(db, [shared])) as (typeof shared & { quote: Record<string, unknown>; sharedBy: Record<string, unknown> })[];
  assert.equal(reads, 1);
  assert.deepEqual(card?.sharedBy, { ...shared.sharedBy, authorPictureUrl: 'https://p/elon.jpg', authorPictureFile: FILE });
  assert.equal(card?.quote['authorPictureUrl'], 'https://p/me.jpg');
});

test('a card with no quote, or no face held, is sent as projected; a bad file name is none', async () => {
  const none = { query: async (): Promise<readonly Row[]> => [] };
  const cards = [CARD, { id: 'x:3' }];
  assert.equal(await withQuoteFaces(none, cards), cards);
  const odd = { query: async (): Promise<readonly Row[]> => [{ id: 'x:2', picture_url: 'http://p/me.jpg', picture_copy: '../x' }] };
  assert.equal((await withQuoteFaces(odd, cards))[0], CARD, 'an http link and a non-hex name are not a face');
});

test('before 0128 the face is read through the quoted post\'s row alone, never a 500', async () => {
  const db = {
    query: async (sql: string): Promise<readonly Row[]> => {
      if (sql === QUOTE_FACES_SQL) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return sql === QUOTE_FACES_ITEMS_SQL ? [{ id: 'x:2', picture_url: 'https://p/me.jpg', picture_copy: null }] : [];
    },
  };
  const [card] = await withQuoteFaces(db, [CARD]);
  assert.equal((card as { quote: Record<string, unknown> }).quote['authorPictureUrl'], 'https://p/me.jpg');
});

test('our copy of the quoted picture is named on the quote, beside the card\'s own', () => {
  const out = withFile(CARD, new Map([['https://p/cat.jpg', FILE]])) as typeof CARD & { thumbFile: string; quote: { thumbFile: string } };
  assert.equal(out.thumbFile, FILE);
  assert.equal(out.quote.thumbFile, FILE);
});
