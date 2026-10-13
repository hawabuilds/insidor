/**
 * The kind question's hold, as the projector reads it: a held kind keeps a post off For You
 * whatever its picture or confidence, an OTHER answer holds nothing, and a held post's rejection
 * names the kind. Recorded cases from 2026-10-13: the tiger-mauling and Goliath posts, and the
 * two stray OTHER rows that hid two posts.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { kindDetail, postHeldKind, postStanding, type RisingRow } from './rising.ts';

const P = DEFAULT_POLICY;
const ROW: RisingRow = {
  item_id: 'x:2109759454858379456',
  source: 'x',
  source_item_id: '2109759454858379456',
  posted_at: new Date(1_755_079_200_000),
  first_seen_at: new Date(1_755_079_260_000),
  body: 'JUST IN: Man dies after falling out of the Goliath roller coaster at Six Flags',
  media: [],
  handle: 'someone',
  display_name: null,
  source_author_id: '1001',
  coinable: true,
  confidence: 0.85,
  looked_at: 'picture',
  proposed_name: 'GOLIATH',
  picture_similarity: 0.9,
  story_id: null,
};

test('★ a tragedy fails whatever the confidence and the picture (the Goliath coaster death, "yes" at 0.85)', () => {
  assert.equal(postStanding(ROW, P), 'passes', 'without its kind answer it passed');
  const held = { ...ROW, kind_label: 'TRAGEDY' };
  assert.equal(postStanding(held, P), 'not_memeable');
  assert.equal(postHeldKind(held), 'TRAGEDY');
});

test('★ the picture boost never lifts a "no" (the tiger-mauling post: "no" at 0.3, picture 0.9 alike)', () => {
  const tiger = { ...ROW, item_id: 'x:2109981393006559352', coinable: false, confidence: 0.3, proposed_name: null };
  assert.equal(postStanding(tiger, P), 'not_memeable');
});

test('★ the two stray OTHER rows hide nothing: an OTHER kind label leaves the first answer to decide', () => {
  const stray = { ...ROW, item_id: 'x:2109834323989774835', proposed_name: 'CHILLGUY', kind_label: 'OTHER' };
  assert.equal(postStanding(stray, P), 'passes');
  assert.equal(postHeldKind(stray), null);
});

test('a held post is recorded with its kind; anything else with no detail', () => {
  assert.equal(kindDetail('AD'), 'kind:AD');
  assert.equal(kindDetail(undefined), null);
});

test('the owner\'s "Is a meme" still wins over a held kind', () => {
  assert.equal(postStanding({ ...ROW, kind_label: 'SPORT', owner_call: 'meme' }, P), 'passes');
});
