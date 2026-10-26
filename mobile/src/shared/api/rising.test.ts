/**
 * The For You and Popular feeds on the phone: the decoder enforces the coin rule a second
 * time (no coin without its narrative), and the sample feeds follow the server's own rule.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WireLeakError, decodeCoinLink, decodeRisingFeed, decodeRisingPost } from './decode.ts';
import { fixtureBoard, fixtureRising } from '../../test-fixtures/fixtures.ts';
import { quotePictureLeads, sharedByLabel } from './wire/rising.ts';

const COIN = {
  coinId: 'solana:abc', ticker: 'DOCK', name: 'dock', address: 'abc', venueLabel: 'Pump.fun', imageUrl: null,
  mintedAt: { at: 1 }, priceUsd: { v: 0.001 }, marketCapUsd: { v: 40_000 }, marketCapBasis: 'fully-diluted',
  liquidityUsd: { v: null, why: 'not_reported' }, priceChange24h: { v: 0.1 }, tradable: true,
};

const POST = {
  id: 'x:1', sourceLabel: 'X', authorLabel: '@hippofan', permalink: 'https://x.com/hippofan/status/1',
  excerpt: 'moo deng yawning', thumbUrl: null, postedAt: { at: 1_000 }, reach: { v: 6_200 }, readAt: { at: 2_000 },
  spark: { points: [], windowMs: 1_800_000 }, storyId: null, coins: null,
};

test('a post with no coin line yet (a row from before every post had one) is a dash, not "none"', () => {
  const post = decodeRisingPost(POST);
  assert.deepEqual(post.coins, { kind: 'pending' });
  assert.equal(post.storyId, null);
  assert.deepEqual(post.reach, { known: true, amount: 6_200 });
});

test('★ a confident coin decodes, with its narrative', () => {
  const post = decodeRisingPost({ ...POST, storyId: 'st_dock', coins: { kind: 'one', coin: COIN } });
  assert.equal(post.coins.kind === 'one' ? post.coins.coin.ticker : null, 'DOCK');
  assert.equal(post.storyId, 'st_dock');
});

test('searched with nothing back, searched with coins back, and not searched: three different lines', () => {
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'none' } }).coins, { kind: 'none' });
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'unsure', claimCount: 2 } }).coins, { kind: 'unsure', claimCount: 2 });
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'pending' } }).coins, { kind: 'pending' });
});

test('★ a post whose search could not finish decodes as unchecked; a narrative cannot carry it', () => {
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'unchecked' } }).coins, { kind: 'unchecked' });
  assert.throws(() => decodeCoinLink({ kind: 'unchecked' }));
});

test('★ a coin, or coins, without their narrative is a leak, not a Buy button', () => {
  assert.throws(() => decodeRisingPost({ ...POST, coins: { kind: 'one', coin: COIN } }), WireLeakError);
  assert.throws(() => decodeRisingPost({ ...POST, coins: { kind: 'several', coins: [COIN, COIN] } }), WireLeakError);
});

test('a video preview decodes with its play flag; a row from before the flag shows no play icon', () => {
  const video = decodeRisingPost({ ...POST, thumbUrl: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg', thumbIsVideo: true });
  assert.equal(video.thumbUrl, 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg');
  assert.equal(video.thumbIsVideo, true);
  assert.equal(decodeRisingPost(POST).thumbIsVideo, false);
  assert.throws(() => decodeRisingPost({ ...POST, thumbIsVideo: 'yes' }));
});

test("the poster's picture decodes when it is an https link; absent or anything else is no picture", () => {
  assert.equal(decodeRisingPost({ ...POST, authorPictureUrl: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg' }).authorPictureUrl, 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg');
  assert.equal(decodeRisingPost(POST).authorPictureUrl, null, 'a server from before the field');
  assert.equal(decodeRisingPost({ ...POST, authorPictureUrl: null }).authorPictureUrl, null);
  assert.equal(decodeRisingPost({ ...POST, authorPictureUrl: 'javascript:alert(1)' }).authorPictureUrl, null);
});

test('our stored copy of the post picture decodes only as a 32-hex name; absent is none', () => {
  const file = '0123456789abcdef0123456789abcdef';
  assert.equal(decodeRisingPost({ ...POST, thumbFile: file }).thumbFile, file);
  assert.equal(decodeRisingPost(POST).thumbFile, null, 'a server from before the field');
  assert.equal(decodeRisingPost({ ...POST, thumbFile: '../coin-logos/x' }).thumbFile, null);
});

test('a score on the wire is refused', () => {
  assert.throws(() => decodeRisingPost({ ...POST, score: 0.9 }), WireLeakError);
});

test('★ the sample feeds: each post carries its sample story\'s coin line', () => {
  const feed = decodeRisingFeed(fixtureRising('fyp'));
  const board = decodeRisingFeed(fixtureRising('popular'));
  assert.equal(feed.posts.length, board.posts.length);
  const rows = (fixtureBoard() as { rows: { id: string; coins: { kind: string } }[] }).rows;
  for (const post of feed.posts) {
    const story = rows.find((r) => `${r.id}:post` === post.id);
    assert.ok(story);
    assert.equal(post.coins.kind, story.coins.kind, post.id);
  }
});

test('the sample For You is newest first; Popular is most views first with unknown views last', () => {
  const fyp = decodeRisingFeed(fixtureRising('fyp')).posts;
  const times = fyp.map((p) => (p.postedAt.known ? p.postedAt.at : 0));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  const popular = decodeRisingFeed(fixtureRising('popular')).posts;
  const known = popular.filter((p) => p.reach.known).map((p) => (p.reach.known ? p.reach.amount : 0));
  assert.deepEqual(known, [...known].sort((a, b) => b - a));
  assert.equal(popular.at(-1)?.reach.known, false);
});

test('★ a post written in another language carries its English and language; a broken one is dropped, never the feed', () => {
  const t = decodeRisingPost({ ...POST, excerpt: 'o rato caiu', translation: { text: 'the rat fell', from: 'pt' } });
  assert.deepEqual(t.translation, { text: 'the rat fell', from: 'pt' });
  assert.equal(t.excerpt, 'o rato caiu');
  assert.equal('translation' in decodeRisingPost(POST), false);
  assert.equal('translation' in decodeRisingPost({ ...POST, translation: { text: '', from: 'pt' } }), false);
  assert.equal('translation' in decodeRisingPost({ ...POST, translation: { text: 'x', from: 'Portuguese' } }), false);
});

/* The owner's example (2026-10-24): a quote with no picture of its own; the server put the quoted
   post's picture on the card and the quoted post in `quote`. */
const CAT = 'https://pbs.twimg.com/media/cat.jpg';
const QUOTE = {
  id: 'x:2113297675160613289', authorLabel: '@catowner', authorName: 'Cat Owner',
  authorPictureUrl: 'https://pbs.twimg.com/profile_images/1/me_400x400.jpg', authorPictureFile: '0123456789abcdef0123456789abcdef',
  permalink: 'https://x.com/catowner/status/2113297675160613289', excerpt: 'my cat after the groomer',
  thumbUrl: CAT, thumbFile: 'abcdefabcdefabcdefabcdefabcdef01', thumbIsVideo: false, postedAt: { at: 500 },
};

test('★ a quoted post decodes with its face, words and picture, and leads the card when the post has no picture', () => {
  const post = decodeRisingPost({ ...POST, thumbUrl: CAT, quote: QUOTE });
  assert.deepEqual(post.quote, { ...QUOTE, postedAt: { known: true, at: 500 } });
  assert.equal(quotePictureLeads(post), true, 'the card\'s picture is the quoted one: the inset shows no second copy');
  const own = decodeRisingPost({ ...POST, thumbUrl: 'https://pbs.twimg.com/media/own.jpg', quote: QUOTE });
  assert.equal(quotePictureLeads(own), false, 'a picture of its own leads; the quoted one shows in the inset');
});

test('a quote that cannot be drawn is dropped, never the card; a bad face or file is none', () => {
  assert.equal(decodeRisingPost(POST).quote, undefined, 'no quote: no key');
  assert.equal(decodeRisingPost({ ...POST, quote: { ...QUOTE, id: '' } }).quote, undefined);
  assert.equal(decodeRisingPost({ ...POST, quote: { ...QUOTE, excerpt: '', thumbUrl: null } }).quote, undefined, 'nothing to draw');
  assert.equal(decodeRisingPost({ ...POST, quote: 'junk' }).quote, undefined);
  const odd = decodeRisingPost({ ...POST, quote: { ...QUOTE, authorPictureUrl: 'http://x/me.jpg', authorPictureFile: '../x', thumbFile: 'nope', postedAt: 'junk' } }).quote;
  assert.equal(odd?.authorPictureUrl, null);
  assert.equal(odd?.authorPictureFile, null);
  assert.equal(odd?.thumbFile, null);
  assert.deepEqual(odd?.postedAt, { known: false, pending: 'not_reported' });
});

test('★ a post deleted from its source decodes with when; anything else is not deleted, and never refuses the card', () => {
  assert.equal(decodeRisingPost({ ...POST, deletedAt: 1_800_000_000_000 }).deletedAt, 1_800_000_000_000);
  assert.equal('deletedAt' in decodeRisingPost(POST), false, 'absent: not known to be deleted');
  for (const bad of [null, 0, -5, 1.5, '1800000000000', true, {}]) {
    assert.equal('deletedAt' in decodeRisingPost({ ...POST, deletedAt: bad }), false, `${JSON.stringify(bad)} is not a time`);
  }
});

test('★ a post a huge account just shared decodes who, how and when; a share it cannot read is dropped, never the card', () => {
  const share = {
    id: 'x:2114612551787147343', authorLabel: '@elonmusk', authorName: 'Elon Musk', how: 'quoted', at: { at: 1_800_000_000_000 },
    permalink: 'https://x.com/elonmusk/status/2114612551787147343', authorPictureUrl: 'https://pbs.example/e.jpg', authorPictureFile: null,
  };
  const post = decodeRisingPost({ ...POST, sharedBy: share });
  assert.equal(post.sharedBy?.authorLabel, '@elonmusk');
  assert.equal(post.sharedBy?.how, 'quoted');
  assert.deepEqual(post.sharedBy?.at, decodeRisingPost({ ...POST, postedAt: { at: 1_800_000_000_000 } }).postedAt);
  assert.equal(post.sharedBy?.authorPictureUrl, 'https://pbs.example/e.jpg');
  assert.equal(sharedByLabel(post.sharedBy!), 'Quoted by @elonmusk');
  assert.equal(sharedByLabel({ how: 'samePicture', authorLabel: '@a' }), 'Shared by @a');
  assert.equal('sharedBy' in decodeRisingPost(POST), false, 'absent: no share');
  for (const bad of [null, {}, { ...share, id: '' }, { ...share, authorLabel: 'Elon Musk' }, { ...share, how: 'retweeted' }]) {
    assert.equal('sharedBy' in decodeRisingPost({ ...POST, sharedBy: bad }), false, `${JSON.stringify(bad)} is no share`);
  }
  assert.notEqual(decodeRisingPost({ ...POST, sharedBy: { ...share, at: 'soon' } }).sharedBy, undefined, 'an unreadable time keeps the share');
});
