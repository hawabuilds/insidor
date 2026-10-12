/**
 * ★ A QUOTE OF A POST WE NEVER SAW IS STORED, POINTER AND ALL (0031).
 *
 * The catch-all search keeps quotes, and the quoted post is usually older than the window or
 * under the floor. Storing the quote used to fail on the pointer's foreign key and take the
 * rest of its page down with it. Real schema (PGlite), the real item repo.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
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
