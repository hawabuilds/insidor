/**
 * The image embedding adapter against replies in the vendor's documented shape (hand-written
 * until a key exists — see __fixtures__/replies.ts): vectors placed by the vendor's index,
 * normalised once, metered on what the vendor billed, and nothing sent for a non-image.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Meter, Spend } from '@insidor/contracts/ports/meter.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

import { BAD_INDEX, TWO_IMAGES } from './__fixtures__/replies.ts';
import { DIMENSIONS, SPACE, readReply, voyageEmbed } from './index.ts';

const image = (uri: string): MediaRef => ({ kind: 'image', uri, width: null, height: null, durationMs: null });

function meter(): Meter & { spends: Spend[] } {
  const spends: Spend[] = [];
  return {
    spends,
    record: (s: Spend) => void spends.push(s),
    spentUsd: () => 0,
    mayspend: () => true,
    line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
  } as unknown as Meter & { spends: Spend[] };
}

test('★ vectors are placed by the vendor\'s index, never by their order in the reply', () => {
  const reply = readReply(TWO_IMAGES, 2);
  assert.equal(reply.vectors[0]?.[0], 3);
  assert.equal(reply.vectors[1]?.[1], 3);
  assert.equal(reply.totalTokens, 2_893);
});

test('an index outside the inputs sent is a shape error, not a vector on the wrong image', () => {
  assert.throws(() => readReply(BAD_INDEX, 1), VendorShapeError);
});

test('★ images are embedded, normalised, and billed on the tokens the vendor reported', async () => {
  const m = meter();
  const sent: unknown[] = [];
  const port = voyageEmbed({
    client: { embed: async (input) => (sent.push(input), readReply(TWO_IMAGES, input.inputs.length)) },
    meter: m,
    now: () => 1_800_000_000_000,
  });
  const result = await port.embedMedia!([image('https://example.invalid/a.jpg'), image('https://example.invalid/b.jpg')], {
    capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1_800_000_060_000,
  });
  const [a, b] = result.value;
  assert.equal(a?.space, SPACE);
  assert.equal(a?.dimensions, DIMENSIONS);
  assert.ok(Math.abs((a?.values[0] ?? 0) - 0.6) < 1e-6 && Math.abs((a?.values[1] ?? 0) - 0.8) < 1e-6, 'unit length');
  assert.ok(Math.abs((b?.values[2] ?? 0) - 0.8) < 1e-6);
  assert.equal(m.spends[0]?.units, 2_893);
  assert.ok(Math.abs((m.spends[0]?.usd ?? 0) - 2_893 * 0.12e-6) < 1e-12);
});

test('a video is not sent at all, and comes back null — not consulted, never "not alike"', async () => {
  let calls = 0;
  const port = voyageEmbed({ client: { embed: async () => ((calls += 1), readReply(TWO_IMAGES, 2)) }, meter: meter(), now: () => 0 });
  const video: MediaRef = { kind: 'video', uri: 'https://example.invalid/v.mp4', width: null, height: null, durationMs: 9_000 };
  const result = await port.embedMedia!([video], { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1 });
  assert.deepEqual(result.value, [null]);
  assert.equal(calls, 0);
});

test('★ one picture the vendor cannot fetch is null; the rest of the batch is still embedded', async () => {
  const dead = 'https://example.invalid/dead.jpg';
  const port = voyageEmbed({
    client: {
      embed: async ({ inputs }) => {
        if (inputs.some((i) => 'imageUrl' in i && i.imageUrl === dead)) throw new VendorUnavailable('voyage', 'embed', 'responded 400', 400);
        const one = Float32Array.from({ length: DIMENSIONS }, (_, k) => (k === 0 ? 1 : 0));
        return { vectors: inputs.map(() => one), totalTokens: 1_000 * inputs.length };
      },
    },
    meter: meter(),
    now: () => 0,
  });
  const urls = ['a', 'b', 'dead', 'c'].map((n) => image(n === 'dead' ? dead : `https://example.invalid/${n}.jpg`));
  const result = await port.embedMedia!(urls, { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1 });
  assert.equal(result.value[2], null);
  assert.deepEqual(result.value.map((v) => v !== null), [true, true, false, true]);
});

test('a batch refused in full is still an outage, never a column of nulls', async () => {
  const port = voyageEmbed({
    client: { embed: async () => { throw new VendorUnavailable('voyage', 'embed', 'responded 400', 400); } },
    meter: meter(),
    now: () => 0,
  });
  await assert.rejects(
    port.embedMedia!([image('https://example.invalid/a.jpg'), image('https://example.invalid/b.jpg')], { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1 }),
    VendorUnavailable,
  );
});
