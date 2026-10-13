/**
 * The image embedding step, with the real Voyage port over a reply in the vendor's shape:
 * dry runs send nothing, live runs store each vector once, a refused budget leaves posts
 * without vectors rather than failing anything, and only pictures something will read are sent.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { ItemId } from '@insidor/contracts/ids.ts';
import type { UnembeddedImage } from '@insidor/store';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { readReply, voyageEmbed } from '@insidor/embed-voyage';
import { TWO_IMAGES } from '@insidor/embed-voyage/__fixtures__/replies.ts';
import { BudgetRefused } from '@insidor/vendor-kit';

import type { Logger } from '../log.ts';
import { embedImages } from './embed-images.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const passed: NonNullable<UnembeddedImage['judgement']> = { coinable: true, confidence: 0.9, lookedAt: 'picture', proposedName: 'RACCOON' };
const QUEUE: readonly UnembeddedImage[] = [
  { itemId: 'x:1' as ItemId, uri: 'https://example.invalid/a.jpg', inNarrative: false, judgement: passed },
  { itemId: 'x:2' as ItemId, uri: 'https://example.invalid/b.jpg', inNarrative: true, judgement: null },
];

function setup(allow = true, queue: readonly UnembeddedImage[] = QUEUE) {
  let calls = 0;
  const recorded: string[] = [];
  const meter = {
    record: () => undefined,
    spentUsd: () => 0,
    mayspend: () => allow,
    line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
  } as unknown as Meter;
  const embed = voyageEmbed({
    client: { embed: async (input) => ((calls += 1), readReply(TWO_IMAGES, input.inputs.length)) },
    meter,
    now: () => 0 as Millis,
  });
  const images = {
    unembedded: async () => queue,
    record: async (_k: 'item' | 'asset', id: string) => void recorded.push(id),
  };
  return { embed, images, recorded, calls: () => calls };
}

test('★ a live pass embeds each queued picture once and stores it', async () => {
  const s = setup();
  const result = await embedImages({ embed: s.embed, images: s.images, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => 1 as Millis });
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.recorded, ['x:1', 'x:2']);
  assert.equal(result.embedded, 2);
});

test('a dry run sends nothing and stores nothing', async () => {
  const s = setup();
  await embedImages({ embed: s.embed, images: s.images, mode: 'dry', policy: DEFAULT_POLICY, log: quiet, now: () => 1 as Millis });
  assert.equal(s.calls(), 0);
  assert.deepEqual(s.recorded, []);
});

test('★ a refused budget leaves the posts without vectors and fails nothing', async () => {
  const s = setup(false);
  const result = await embedImages({ embed: s.embed, images: s.images, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => 1 as Millis });
  assert.equal(result.embedded, 0);
  assert.deepEqual(s.recorded, []);
  assert.ok(BudgetRefused);
});

test('with no vendor configured nothing is asked', async () => {
  const s = setup();
  assert.deepEqual(await embedImages({ embed: null, images: s.images, mode: 'live', policy: DEFAULT_POLICY, log: quiet, now: () => 1 as Millis }), { queued: 0, embedded: 0 });
});

test('★ a picture that can never reach a screen is not paid for: a failed name test, an unsure yes', async () => {
  const P = DEFAULT_POLICY;
  const longName = { ...passed, proposedName: 'one two three four five six' };
  const unsureYes = { ...passed, confidence: P.qualify.minJudgeConfidence.picture - 0.1 };
  const unsureNo = { coinable: false, confidence: P.rising.boostMaxNoConfidence, lookedAt: 'picture' as const, proposedName: null };
  const s = setup(true, [
    { itemId: 'x:1' as ItemId, uri: 'https://example.invalid/a.jpg', inNarrative: false, judgement: longName },
    { itemId: 'x:2' as ItemId, uri: 'https://example.invalid/b.jpg', inNarrative: false, judgement: unsureYes },
    { itemId: 'x:3' as ItemId, uri: 'https://example.invalid/c.jpg', inNarrative: false, judgement: unsureNo },
    { itemId: 'x:4' as ItemId, uri: 'https://example.invalid/d.jpg', inNarrative: true, judgement: longName },
  ]);
  const result = await embedImages({ embed: s.embed, images: s.images, mode: 'live', policy: P, log: quiet, now: () => 1 as Millis });
  assert.equal(result.queued, 2, 'the unsure no (for the picture boost) and the narrative post');
  assert.deepEqual(s.recorded, ['x:3', 'x:4']);
});
