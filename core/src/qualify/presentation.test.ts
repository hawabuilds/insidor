/**
 * What a QUALIFY pass writes: the judge's name, or nothing, and the earliest post's own
 * picture, or nothing. Never a placeholder for either.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { Item, MediaRef } from '@insidor/contracts/vocabulary.ts';

import { presentationFor } from './presentation.ts';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const FEED = sourceId('feed-a');

const JUDGED: Judgement = {
  judgeId: 'judge:test@1',
  promptId: 'prompt.v1',
  judgedAt: NOW,
  coinable: true,
  confidence: 0.9,
  lookedAt: 'text',
  proposedName: '  small hippo ',
  alternateNames: [],
  subjectSpans: [],
  rationaleRef: null,
  costUsd: 0,
};

const image = (uri: string): MediaRef => ({ kind: 'image', uri, width: null, height: null, durationMs: null });

function post(id: string, postedAt: number | null, media: readonly MediaRef[]): Item {
  return {
    itemId: itemId(FEED, id),
    source: FEED,
    sourceItemId: id,
    origin: 'observed',
    authorKey: authorKey(FEED, id),
    postedAt,
    firstSeenAt: NOW,
    lang: null,
    text: '',
    media,
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: `local:test/${id}`,
  };
}

test("the title is the judge's proposed name, trimmed", () => {
  assert.equal(presentationFor(JUDGED, []).displayTitle, 'small hippo');
});

test('★ no name is a null title, so the board quotes a post instead of inventing one', () => {
  assert.equal(presentationFor({ ...JUDGED, proposedName: null }, []).displayTitle, null);
  assert.equal(presentationFor({ ...JUDGED, proposedName: '  ' }, []).displayTitle, null);
  assert.equal(presentationFor(null, []).displayTitle, null);
});

test('★ the picture is the earliest post that has an image, whatever order the posts arrive in', () => {
  const later = post('b', NOW - MINUTE, [image('https://example.invalid/later.jpg')]);
  const earlier = post('a', NOW - 9 * MINUTE, [image('https://example.invalid/first.jpg')]);
  const undated = post('c', null, [image('https://example.invalid/undated.jpg')]);
  assert.equal(presentationFor(JUDGED, [undated, later, earlier]).thumbUri, 'https://example.invalid/first.jpg');
});

test('a story whose posts carry no image has no picture', () => {
  const video: MediaRef = { kind: 'video', uri: 'https://example.invalid/clip.mp4', width: null, height: null, durationMs: 9000 };
  assert.equal(presentationFor(JUDGED, [post('a', NOW, [video])]).thumbUri, null);
});
