/**
 * One single post on a feed: facts only, a coin only through a narrative, and a coin line
 * that tells "searched, nothing" from "not searched yet".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { clearsReachBar } from '@insidor/core';

import { barReadings, postCoins, projectRisingPost, withoutTrailingShortLinks } from './rising.ts';
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
  picture_similarity: null,
  story_id: 'story_seed-x-1',
};

const COIN = { coinId: 'solana:abc', ticker: 'MOODENG' } as unknown as WireCoin;

const READINGS = [
  { atMs: 1_755_079_300_000, fidelity: 'quantized' as const, rate: { kind: 'censored' as const, reason: 'no_prior' as const, lastLevel: 5_000 } },
  { atMs: 1_755_079_780_000, fidelity: 'quantized' as const, rate: { kind: 'measured' as const, perMin: 75, overMs: 480_000, level: 5_600 } },
];

test('★ the row is the fourteen facts and nothing else', () => {
  const post = projectRisingPost(ROW, READINGS, new Map(), 1_800_000);
  assert.deepEqual(Object.keys(post).sort(), [
    'authorLabel', 'coins', 'excerpt', 'id', 'permalink', 'postedAt', 'reach', 'readAt', 'runningOlder', 'sourceLabel', 'spark', 'storyId', 'thumbIsVideo', 'thumbUrl',
  ]);
  assert.deepEqual(post.runningOlder, [], 'no older coin running is an empty list, never absent');
  assert.equal(post.authorLabel, '@hippofan');
  assert.equal(post.permalink, 'https://x.com/hippofan/status/1900000000000000001');
  assert.equal(post.excerpt, 'moo deng yawning to the remix');
  assert.deepEqual(post.reach, { v: 5_600 });
  assert.deepEqual(post.readAt, { at: 1_755_079_780_000 });
  assert.equal(JSON.stringify(post).includes('0.9'), false, 'the score is never in the row');
});

test('★ the story decides: its one, several or unsure link travels with its story id', () => {
  const one: WireCoinLink = { kind: 'one', coin: COIN };
  const confident = projectRisingPost(ROW, READINGS, new Map([[ROW.story_id, one]]), 1_800_000, { coins: [], more: false });
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
  assert.deepEqual(projectRisingPost(lone, READINGS, new Map(), 1_800_000, { coins: [], more: false }).coins, { kind: 'none' });
  const unsearched = projectRisingPost(lone, READINGS, new Map(), 1_800_000);
  assert.deepEqual(unsearched.coins, { kind: 'pending' });
  assert.equal(unsearched.storyId, null);
});

test('★ a search that found coins is unsure with that count, never a coin on the post', () => {
  const found = { coins: ['A1', 'B2', 'C3', 'D4'], more: false };
  const post = projectRisingPost({ ...ROW, story_id: null }, READINGS, new Map(), 1_800_000, found);
  assert.deepEqual(post.coins, { kind: 'unsure', claimCount: 4 });
  assert.equal(post.storyId, null);
  assert.equal(JSON.stringify(post).includes('A1'), false, 'the addresses are listed elsewhere, never on the row');
});

test('★ the count on an unsure post is the length of the list written beside it', () => {
  const found = { coins: ['A1', 'B2', 'C3'], more: false };
  const coins = postCoins(undefined, found);
  assert.deepEqual(coins.sameName, found.coins);
  assert.equal(coins.coins.kind === 'unsure' ? coins.coins.claimCount : -1, coins.sameName.length);
  /* A story that is unsure lists its own coins (the frame writes them); the post adds none. */
  assert.deepEqual(postCoins({ kind: 'unsure', claimCount: 2 }, found).sameName, []);
  /* Nothing to list for any other state. */
  assert.deepEqual(postCoins(undefined, { coins: [], more: false }).sameName, []);
  assert.deepEqual(postCoins(undefined, { gaveUp: true }).sameName, []);
});

test('★ a search that kept fewer coins than it found says so: the count is "at least"', () => {
  const coins = postCoins(undefined, { coins: ['A1', 'B2'], more: true }).coins;
  assert.deepEqual(coins, { kind: 'unsure', claimCount: 2, more: true });
  assert.equal('more' in postCoins(undefined, { coins: ['A1'], more: false }).coins, false, 'absent, never false, when the list is whole');
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

test('★ a post whose coins were weighed lists them strongest first; one settled by evidence is matched, with its facts', () => {
  const evidence = new Map([['B2', { linksPost: null, samePicture: true, launchedAfterMs: 60_000 }]]);
  const unsure = postCoins(undefined, { coins: ['A1', 'B2', 'C3'], more: false, match: { kind: 'unsure', order: ['B2', 'C3', 'A1'], evidence } });
  assert.deepEqual(unsure.sameName, ['B2', 'C3', 'A1']);
  const one = { kind: 'one', coin: { coinId: 'solana:B2', address: 'B2' } } as unknown as { kind: 'one'; coin: never };
  const matched = postCoins(undefined, { coins: ['A1', 'B2'], more: false, match: { kind: 'matched', coin: one.coin, evidence: { linksPost: true, samePicture: null, launchedAfterMs: 60_000 } } });
  assert.equal(matched.coins.kind, 'matched');
  assert.equal(matched.fromStory, false);
  assert.deepEqual(matched.sameName, ['B2', 'A1'], 'the settled coin first, then the others with the name, for the post sheet');
});

test("★ the owner's coin wins over the story's link and the evidence, and says the owner checked it", () => {
  const owned = { ...COIN, address: 'Own1' } as unknown as WireCoin;
  const evidence = { linksPost: true, samePicture: null, launchedAfterMs: 1_080_000, ownerChecked: true } as const;
  const lookup = { coins: ['B2', 'Own1'], more: false, match: { kind: 'matched' as const, coin: owned, evidence, owner: true as const } };
  const r = postCoins({ kind: 'one', coin: COIN }, lookup);
  assert.deepEqual(r.coins, { kind: 'matched', coin: owned, evidence });
  assert.equal(r.fromStory, false, 'the owner named it, not the narrative');
  assert.deepEqual(r.sameName, ['Own1', 'B2'], 'the owner\'s coin first, every other coin with the name after it');
  /* Without the owner's mark, a matched coin still yields to the story. */
  const plain = postCoins({ kind: 'one', coin: COIN }, { ...lookup, match: { kind: 'matched', coin: owned, evidence } });
  assert.equal(plain.fromStory, true);
});

test("the views bars: measured readings only, or every readable count with rising.feedBarCountsEveryReading", () => {
  const POSTED = 1_800_000_000_000;
  const MIN = 60_000;
  const readings = [
    /* The first reading has no earlier one to take a rate from: censored, though the count was read. */
    { atMs: POSTED + 6 * MIN, fidelity: 'quantized' as const, rate: { kind: 'censored' as const, reason: 'no_prior' as const, lastLevel: null }, count: 12_425 },
    { atMs: POSTED + 7 * MIN, fidelity: 'quantized' as const, rate: { kind: 'measured' as const, perMin: 691, overMs: 60_000, level: 13_116 }, count: 13_116 },
    { atMs: POSTED + 8 * MIN, fidelity: 'absent' as const, rate: { kind: 'censored' as const, reason: 'no_prior' as const, lastLevel: null }, count: null },
  ];
  const on = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, feedBarCountsEveryReading: true } };
  const off = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, feedBarCountsEveryReading: false } };
  assert.deepEqual(barReadings(readings, off).map((r) => r.reach), [null, 13_116, null]);
  assert.deepEqual(barReadings(readings, on).map((r) => r.reach), [12_425, 13_116, null]);
  /* 12,425 at six minutes is 2,071 a minute: the scorer's fast path, which the measured readings never show. */
  assert.equal(clearsReachBar('fyp', barReadings(readings, off), POSTED, off), false);
  assert.equal(clearsReachBar('fyp', barReadings(readings, on), POSTED, on), true);
  /* A reading loaded without its count keeps its measured level either way. */
  const { count: _drop, ...noCount } = readings[1]!;
  assert.deepEqual(barReadings([noCount], on).map((r) => r.reach), [13_116]);
});
