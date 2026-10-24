/**
 * A quote post's card: the quoted post inside it, and which picture leads the card. Shaped on the
 * owner's example (2026-10-24): a quote with no picture of its own, whose quoted post is the meme.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { mainPicture, type QuotedRow } from './quoted.ts';
import { projectQuote, projectRisingPost } from './rising.ts';

const QUOTE_ROW = {
  item_id: 'x:2113365660697084315',
  source: 'x',
  source_item_id: '2113365660697084315',
  posted_at: new Date(1_792_700_612_000),
  first_seen_at: new Date(1_792_715_026_719),
  body: 'Turned him into a exotic bengal cat',
  media: [],
  reproduction_of: 'x:2113297675160613289',
  handle: 'ApplaudAhhJones',
  display_name: 'Applaud',
  source_author_id: '615938424',
  coinable: true,
  confidence: 0.9,
  looked_at: 'text' as const,
  proposed_name: null,
  picture_similarity: null,
  story_id: null,
};

const QUOTED: QuotedRow = {
  item_id: 'x:2113297675160613289',
  source: 'x',
  source_item_id: '2113297675160613289',
  body: 'my cat after the groomer https://t.co/abc123',
  media: [{ kind: 'image', uri: 'https://pbs.twimg.com/media/cat.jpg', width: 900, height: 1200, durationMs: null }],
  posted_at: '2026-10-22T15:53:21Z',
  handle: 'catowner',
  display_name: 'Cat Owner',
};

const READINGS = [{ atMs: 1_792_716_000_000, fidelity: 'quantized' as const, rate: { kind: 'measured' as const, perMin: 75, overMs: 480_000, level: 269_527 } }];

test('★ a quote with no picture of its own leads with the quoted post\'s picture', () => {
  const card = projectRisingPost(QUOTE_ROW, READINGS, new Map(), 1_800_000, null, [], null, null, QUOTED);
  assert.equal(card.thumbUrl, 'https://pbs.twimg.com/media/cat.jpg', 'the meme is on the card at a glance');
  assert.equal(card.excerpt, 'Turned him into a exotic bengal cat', 'the card\'s words are still its own');
  assert.deepEqual(card.quote, {
    id: 'x:2113297675160613289',
    authorLabel: '@catowner',
    authorName: 'Cat Owner',
    permalink: 'https://x.com/catowner/status/2113297675160613289',
    excerpt: 'my cat after the groomer',
    thumbUrl: 'https://pbs.twimg.com/media/cat.jpg',
    thumbIsVideo: false,
    postedAt: { at: Date.parse('2026-10-22T15:53:21Z') },
  });
});

test('a quote with its own picture keeps it; the quoted picture stays in the inset', () => {
  const own = { ...QUOTE_ROW, media: [{ kind: 'image', uri: 'https://pbs.twimg.com/media/own.jpg' }] };
  const card = projectRisingPost(own, READINGS, new Map(), 1_800_000, null, [], null, null, QUOTED);
  assert.equal(card.thumbUrl, 'https://pbs.twimg.com/media/own.jpg');
  assert.equal(card.quote?.thumbUrl, 'https://pbs.twimg.com/media/cat.jpg');
});

test('a post that quotes nothing, or one we hold nothing of, has no quote key at all', () => {
  const card = projectRisingPost(QUOTE_ROW, READINGS, new Map(), 1_800_000);
  assert.equal('quote' in card, false);
  assert.equal(card.thumbUrl, null, 'and no picture is made up');
});

test('a quoted post with nothing to draw, or no account to name, is left out', () => {
  assert.equal(projectQuote({ ...QUOTED, body: 'https://t.co/abc123', media: [] }), null);
  assert.equal(projectQuote({ ...QUOTED, handle: null, display_name: null }), null);
  /* A name with no handle is shown, with no link: never a guessed one. */
  const named = projectQuote({ ...QUOTED, handle: null });
  assert.equal(named?.authorLabel, 'Cat Owner');
  assert.equal(named?.permalink, null);
});

test('a quoted post whose words carry a refused word goes out without the quote, never withholding the card', () => {
  const leaky = { ...QUOTED, body: 'bought on dexscreener' };
  assert.equal(projectQuote(leaky), null);
  const card = projectRisingPost(QUOTE_ROW, READINGS, new Map(), 1_800_000, null, [], null, null, leaky);
  assert.equal('quote' in card, false);
});

test('mainPicture: own first, a video still keeps its play icon, else the quote\'s, else none', () => {
  assert.deepEqual(mainPicture([{ kind: 'image', uri: 'https://a/own.jpg' }], { thumbUrl: 'https://a/q.jpg', thumbIsVideo: false }), { uri: 'https://a/own.jpg', isVideo: false });
  assert.deepEqual(mainPicture([], { thumbUrl: 'https://a/q.jpg', thumbIsVideo: true }), { uri: 'https://a/q.jpg', isVideo: true });
  assert.equal(mainPicture([], { thumbUrl: null, thumbIsVideo: false }), null);
  assert.equal(mainPicture([], null), null);
});

test('★ a post found deleted carries when on its card, as ms; one not known to be carries nothing', () => {
  const gone = projectRisingPost({ ...QUOTE_ROW, deleted_at: '2026-10-24T01:34:24.000Z' }, READINGS, new Map(), 1_800_000);
  assert.equal(gone.deletedAt, Date.parse('2026-10-24T01:34:24.000Z'));
  assert.equal(gone.excerpt, projectRisingPost(QUOTE_ROW, READINGS, new Map(), 1_800_000).excerpt, 'it keeps what we stored');
  assert.equal('deletedAt' in projectRisingPost(QUOTE_ROW, READINGS, new Map(), 1_800_000), false);
  assert.equal('deletedAt' in projectRisingPost({ ...QUOTE_ROW, deleted_at: null }, READINGS, new Map(), 1_800_000), false);
});
