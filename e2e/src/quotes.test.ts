/**
 * ★ A QUOTE OF A POST WE NEVER SAW IS STORED, POINTER AND ALL (0031).
 *
 * The catch-all search keeps quotes, and the quoted post is usually older than the window or
 * under the floor. Storing the quote used to fail on the pointer's foreign key and take the
 * rest of its page down with it. Real schema (PGlite), the real item repo.
 *
 * ★ AND THE QUOTED POST THE QUOTE'S PAYLOAD CARRIED IS KEPT BESIDE IT (0128), never as a post row,
 * and read back for the card: the post row when a search found it too, else the copy.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { toItem } from '@insidor/platform-x/to-item.ts';
import { loadQuotedPosts } from '@insidor/project/src/quoted.ts';
import { withQuoteFaces } from '@insidor/read/src/quote-faces.ts';
import { PgItemRepo } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const X = sourceId('x');

function post(n: number, quotes: number | null): Item {
  return {
    itemId: itemId(X, `${n}`), source: X, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(X, `a${n}`),
    postedAt: NOW, firstSeenAt: NOW, lang: 'en', text: `post ${n}`, media: [], counters: {}, fingerprints: [],
    rebroadcastOf: null, reproductionOf: quotes === null ? null : itemId(X, `${quotes}`), formatIds: [], rawRef: `x/${n}`,
  };
}

test('★ a quote of an unseen post is stored with its pointer, and the rest of the page with it', async () => {
  const items = new PgItemRepo(await migratedDb());
  assert.equal(await items.upsert([post(1, 999), post(2, null)]), 2);
  const stored = await items.byIds([itemId(X, '1'), itemId(X, '2')]);
  assert.equal(stored.get(itemId(X, '1'))?.reproductionOf, itemId(X, '999'), 'the pointer is kept as the source wrote it');
  assert.ok(stored.has(itemId(X, '2')), 'and the next post on the page was stored too');
});

/* The owner's example (2026-10-24), as the source returns it: the quote has no picture, the quoted post does. */
const QUOTE_PAYLOAD = {
  id: '2113365660697084315',
  text: 'Turned him into a exotic bengal cat',
  createdAt: 'Thu Oct 22 20:23:32 +0000 2026',
  author: { id: '615938424', userName: 'ApplaudAhhJones' },
  quoted_tweet: {
    id: '2113297675160613289',
    text: 'my cat after the groomer',
    createdAt: 'Thu Oct 22 15:53:21 +0000 2026',
    author: { id: '777', userName: 'catowner', name: 'Cat Owner', profilePicture: 'https://pbs.twimg.com/profile_images/1/me_normal.jpg' },
    extendedEntities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/cat.jpg' }] },
  },
};

/* The adapter's phrases are folded into one hash by the runner before storing (arrivals.ts); not this test's subject. */
const read = (raw: unknown, at: Millis): Item => ({ ...toItem(raw, at), fingerprints: [] });

test('★ the quoted post a quote carries is kept beside it, never as a post row, and read back for the card', async () => {
  const db = await migratedDb();
  const items = new PgItemRepo(db);
  await items.upsert([read(QUOTE_PAYLOAD, NOW)]);
  const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.item where item_id = 'x:2113297675160613289'`);
  assert.equal(rows[0]?.n, 0, 'a post seen only inline is not a post row: nothing judges, counts or groups it');

  const quoted = await loadQuotedPosts(db, ['x:2113297675160613289']);
  const q = quoted.get('x:2113297675160613289');
  assert.equal(q?.body, 'my cat after the groomer');
  assert.equal(q?.handle, 'catowner');
  assert.equal(q?.display_name, 'Cat Owner');
  assert.deepEqual((q?.media as { uri: string }[]).map((m) => m.uri), ['https://pbs.twimg.com/media/cat.jpg']);

  /* The read service finds the quoted account's face through the copy. */
  const [card] = await withQuoteFaces(db as never, [{ id: 'x:2113365660697084315', quote: { id: 'x:2113297675160613289' } }]);
  assert.equal((card as { quote: Record<string, unknown> }).quote['authorPictureUrl'], 'https://pbs.twimg.com/profile_images/1/me_400x400.jpg');

  /* An older read of the same quoted post never overwrites a newer one. */
  const older = { ...QUOTE_PAYLOAD, id: '3', quoted_tweet: { ...QUOTE_PAYLOAD.quoted_tweet, text: 'an older read' } };
  await items.upsert([read(older, (NOW - 60_000) as Millis)]);
  assert.equal((await loadQuotedPosts(db, ['x:2113297675160613289'])).get('x:2113297675160613289')?.body, 'my cat after the groomer');
});

test('the post row wins when a search found the quoted post too; a slimmed row with no picture falls back to the copy', async () => {
  const db = await migratedDb();
  const items = new PgItemRepo(db);
  await items.upsert([read(QUOTE_PAYLOAD, NOW)]);
  const own: Item = { ...post(5, null), itemId: itemId(X, '2113297675160613289'), sourceItemId: '2113297675160613289', rawRef: 'x/2113297675160613289', text: 'my cat after the groomer, read fresh', media: [] };
  await items.upsert([own]);
  const q = (await loadQuotedPosts(db, ['x:2113297675160613289'])).get('x:2113297675160613289');
  assert.equal(q?.body, 'my cat after the groomer, read fresh', 'the post row\'s words');
  assert.deepEqual((q?.media as { uri: string }[]).map((m) => m.uri), ['https://pbs.twimg.com/media/cat.jpg'], 'its emptied picture is never shown over the copy\'s');
});
