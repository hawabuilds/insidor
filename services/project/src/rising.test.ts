/**
 * One single post on a feed: facts only, a coin only through a narrative, and a coin line
 * that tells "searched, nothing" from "not searched yet".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { projectRisingPost, withoutTrailingShortLinks } from './rising.ts';
import type { WireCoin, WireCoinLink } from './wire.ts';

const ROW = {
  item_id: 'x:1900000000000000001',
  source: 'x',
  source_item_id: '1900000000000000001',
  posted_at: new Date(1_755_079_200_000),
  first_seen_at: new Date(1_755_079_260_000),
  body: 'moo deng   yawning to the remix',
  media: [{ kind: 'image', uri: 'https://example.invalid/a.jpg' }],
  handle: 'hippofan',
  display_name: null,
  source_author_id: '1001',
  coinable: true,
  confidence: 0.9,
  looked_at: 'text' as const,
  proposed_name: 'CHILLGUY',
  story_id: 'story_seed-x-1',
};

const COIN = { coinId: 'solana:abc', ticker: 'MOODENG' } as unknown as WireCoin;

const READINGS = [
  { atMs: 1_755_079_300_000, fidelity: 'quantized' as const, rate: { kind: 'censored' as const, reason: 'no_prior' as const, lastLevel: 5_000 } },
  { atMs: 1_755_079_780_000, fidelity: 'quantized' as const, rate: { kind: 'measured' as const, perMin: 75, overMs: 480_000, level: 5_600 } },
];

test('★ the row is the thirteen facts and nothing else', () => {
  const post = projectRisingPost(ROW, READINGS, new Map(), 1_800_000);
  assert.deepEqual(Object.keys(post).sort(), [
    'authorLabel', 'coins', 'excerpt', 'id', 'permalink', 'postedAt', 'reach', 'readAt', 'sourceLabel', 'spark', 'storyId', 'thumbIsVideo', 'thumbUrl',
  ]);
  assert.equal(post.authorLabel, '@hippofan');
  assert.equal(post.permalink, 'https://x.com/hippofan/status/1900000000000000001');
  assert.equal(post.excerpt, 'moo deng yawning to the remix');
  assert.deepEqual(post.reach, { v: 5_600 });
  assert.deepEqual(post.readAt, { at: 1_755_079_780_000 });
  assert.equal(JSON.stringify(post).includes('0.9'), false, 'the score is never in the row');
});

test('★ the story decides: its one, several or unsure link travels with its story id', () => {
  const one: WireCoinLink = { kind: 'one', coin: COIN };
  const confident = projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, one]]), 1_800_000, { found: 0 });
  assert.equal(confident.storyId, ROW.story_id);
  assert.deepEqual(confident.coins, one, 'a search result never overrides the story');

  for (const link of [{ kind: 'unsure', claimCount: 3 }, { kind: 'several', coins: [COIN, COIN] }] as WireCoinLink[]) {
    const post = projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, link]]), 1_800_000);
    assert.deepEqual(post.coins, link);
    assert.equal(post.storyId, ROW.story_id);
  }
});

test('★ searched with nothing back is "none"; never searched is "pending", never "none"', () => {
  const lone = { ...ROW, story_id: null };
  assert.deepEqual(projectRisingPost(lone, READINGS, new Map(), 1_800_000, { found: 0 }).coins, { kind: 'none' });
  const unsearched = projectRisingPost(lone, READINGS, new Map(), 1_800_000);
  assert.deepEqual(unsearched.coins, { kind: 'pending' });
  assert.equal(unsearched.storyId, null);
});

test('★ a search that found coins is unsure with that count, never a coin on the post', () => {
  const post = projectRisingPost({ ...ROW, story_id: null }, READINGS, new Map(), 1_800_000, { found: 4 });
  assert.deepEqual(post.coins, { kind: 'unsure', claimCount: 4 });
  assert.equal(post.storyId, null);
});

test('a story searched with none, and the post not searched itself, is "none" through the story', () => {
  const post = projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, { kind: 'none' } as WireCoinLink]]), 1_800_000);
  assert.deepEqual(post.coins, { kind: 'none' });
  assert.equal(post.storyId, ROW.story_id);
  const pending = projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, { kind: 'pending' } as WireCoinLink]]), 1_800_000);
  assert.deepEqual(pending.coins, { kind: 'pending' });
  assert.equal(pending.storyId, null);
});

test('★ no search finished in time is "unchecked", never "none" and never a story\'s coin', () => {
  const lone = projectRisingPost({ ...ROW, story_id: null }, READINGS, new Map(), 1_800_000, { gaveUp: true });
  assert.deepEqual(lone.coins, { kind: 'unchecked' });
  assert.equal(lone.storyId, null);
  /* A story that settled its coins still decides; one searched with none still says none. */
  const one = { kind: 'one', coin: COIN } as WireCoinLink;
  assert.deepEqual(projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, one]]), 1_800_000, { gaveUp: true }).coins, one);
  assert.deepEqual(projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, { kind: 'none' } as WireCoinLink]]), 1_800_000, { gaveUp: true }).coins, { kind: 'none' });
  /* A story still pending does not hide that the post's own search never went through. */
  assert.deepEqual(projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, { kind: 'pending' } as WireCoinLink]]), 1_800_000, { gaveUp: true }).coins, { kind: 'unchecked' });
});

test('★ an X video shows its preview picture, flagged as a video; a photo is not flagged', () => {
  const video = projectRisingPost(
    { ...ROW, media: [{ kind: 'video', uri: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg', width: 720, height: 1280, durationMs: 10_005 }] },
    READINGS, new Map(), 1_800_000,
  );
  assert.equal(video.thumbUrl, 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg');
  assert.equal(video.thumbIsVideo, true);
  const photo = projectRisingPost(ROW, READINGS, new Map(), 1_800_000);
  assert.equal(photo.thumbUrl, 'https://example.invalid/a.jpg');
  assert.equal(photo.thumbIsVideo, false);
});

test('a TikTok cover (an image with a duration) is a video preview; no media is no picture', () => {
  const cover = projectRisingPost(
    { ...ROW, source: 'tiktok', media: [{ kind: 'image', uri: 'https://example.invalid/cover.jpg', width: null, height: null, durationMs: 15_000 }] },
    READINGS, new Map(), 1_800_000,
  );
  assert.equal(cover.thumbUrl, 'https://example.invalid/cover.jpg');
  assert.equal(cover.thumbIsVideo, true);
  const none = projectRisingPost({ ...ROW, media: [] }, READINGS, new Map(), 1_800_000);
  assert.equal(none.thumbUrl, null);
  assert.equal(none.thumbIsVideo, false);
});

test('a Reddit video file is never used as a picture; its preview still is, with the play flag', () => {
  const file = { kind: 'video', uri: 'https://v.redd.it/abc/DASH_720.mp4?source=fallback', width: 720, height: 1280, durationMs: 9_000 };
  const onlyFile = projectRisingPost({ ...ROW, source: 'reddit', media: [file] }, READINGS, new Map(), 1_800_000);
  assert.equal(onlyFile.thumbUrl, null, 'an <img> cannot show an mp4: the empty tile is the honest render');
  const withStill = projectRisingPost(
    { ...ROW, source: 'reddit', media: [file, { kind: 'image', uri: 'https://preview.redd.it/abc.jpg', width: 720, height: 1280, durationMs: null }] },
    READINGS, new Map(), 1_800_000,
  );
  assert.equal(withStill.thumbUrl, 'https://preview.redd.it/abc.jpg');
  assert.equal(withStill.thumbIsVideo, true);
});

test('no handle means no link, never a guessed one; no reading means a dash with a reason', () => {
  const post = projectRisingPost({ ...ROW, handle: null }, [], new Map(), 1_800_000);
  assert.equal(post.permalink, null);
  assert.equal(post.reach.v, null);
  assert.equal(post.readAt.at, null);
});

test('★ the trailing t.co links are hidden and the words kept; a link mid-sentence stays', () => {
  const post = projectRisingPost({ ...ROW, body: 'A smile for your timeline.. 😊 https://t.co/KVHSZ51Lwk' }, READINGS, new Map(), 1_800_000);
  assert.equal(post.excerpt, 'A smile for your timeline.. 😊');
  assert.equal(withoutTrailingShortLinks('Listen\n\n#OnePrideWorldwide https://t.co/dcyykf70Ei https://t.co/abc123 '), 'Listen\n\n#OnePrideWorldwide');
  assert.equal(withoutTrailingShortLinks('read https://t.co/abc123 then laugh'), 'read https://t.co/abc123 then laugh');
  assert.equal(withoutTrailingShortLinks('https://t.co/abc123'), '');
  assert.equal(withoutTrailingShortLinks('no links here'), 'no links here');
});
