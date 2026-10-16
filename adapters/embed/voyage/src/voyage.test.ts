/**
 * The image embedding adapter against replies in the vendor's documented shape (hand-written
 * until a key exists — see __fixtures__/replies.ts): vectors placed by the vendor's index,
 * normalised once, metered on what the vendor billed, and nothing sent for a non-image.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Meter, Spend } from '@insidor/contracts/ports/meter.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { OutOfCredit, VendorShapeError, VendorUnavailable, onOutOfCredit } from '@insidor/vendor-kit';

import { BAD_INDEX, TWO_IMAGES } from './__fixtures__/replies.ts';
import { DIMENSIONS, SPACE, readReply, voyageEmbed } from './index.ts';
import { billingReason, httpClient, pictureRefusal, PictureRefused } from './client.ts';

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

test('★ a batch whose every picture could not be fetched is a column of nulls, not an outage (2026-10-16)', async () => {
  let calls = 0;
  const port = voyageEmbed({
    client: { embed: async () => { calls += 1; throw new PictureRefused('embed'); } },
    meter: meter(),
    now: () => 0,
  });
  const urls = Array.from({ length: 8 }, (_, i) => image(`https://example.invalid/cover-${i}.jpeg`));
  const result = await port.embedMedia!(urls, { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1 });
  assert.deepEqual(result.value, Array.from({ length: 8 }, () => null));
  assert.equal(calls, 15, 'halved down to each picture alone');
});

test('the vendor\'s "could not fetch this picture" 400 is told from any other 400, and from billing', async () => {
  /* The body as the vendor sent it on 2026-10-16, the signed address shortened. */
  const recorded = JSON.stringify({ detail: "Request to model 'voyage-multimodal-3' failed. The image URL you have provided is invalid. Please verify the URL and try again.: https://cdn.example/cover.jpeg?x-signature=abc - For more information on input limitations, please see the documentation." });
  assert.equal(pictureRefusal(400, recorded), true);
  assert.equal(pictureRefusal(400, JSON.stringify({ detail: 'Unable to fetch image from URL' })), true);
  assert.equal(pictureRefusal(400, JSON.stringify({ detail: 'Invalid model name' })), false);
  assert.equal(pictureRefusal(500, recorded), false);
  assert.equal(billingReason(400, recorded), null);
  const client = httpClient({ apiKey: 'k', baseUrl: 'https://embed.invalid', fetch: (async () => new Response(recorded, { status: 400 })) as typeof fetch });
  await assert.rejects(client.embed({ model: 'm', inputs: [{ imageUrl: 'https://cdn.example/cover.jpeg' }] }), (e: unknown) => e instanceof PictureRefused && !String((e as Error).message).includes('signature'));
});

test('★ a billing refusal is its own error, heard by the listener, and never halved into a column of nulls', async () => {
  const heard: string[] = [];
  const off = onOutOfCredit({ refused: (e) => heard.push(e.reason) });
  try {
    /* The vendor's recorded error shape: `{ detail }`. */
    for (const [status, detail] of [
      [429, 'You have not yet added your payment method in the billing page and will have reduced rate limits of 3 RPM.'],
      [402, 'Request refused'],
      [403, 'Your account billing is past due (org org_x1).'],
    ] as const) {
      const client = httpClient({ apiKey: 'k', baseUrl: 'https://embed.invalid', fetch: (async () => new Response(JSON.stringify({ detail }), { status })) as typeof fetch });
      await assert.rejects(client.embed({ model: 'm', inputs: [{ text: 'a' }] }), (e: unknown) => {
        assert.ok(e instanceof OutOfCredit && e instanceof VendorUnavailable);
        assert.doesNotMatch(e.message, /org_x1|3 RPM/);
        return true;
      });
    }
    assert.deepEqual(heard, ['no payment method on file', 'payment required', 'billing refused']);
  } finally {
    off();
  }
  assert.equal(billingReason(429, JSON.stringify({ detail: 'Rate limit exceeded' })), null, 'pacing is not billing');
  assert.equal(billingReason(400, JSON.stringify({ detail: 'Unable to fetch image from URL' })), null, 'one bad picture is not billing');

  let calls = 0;
  const port = voyageEmbed({
    client: { embed: async () => { calls += 1; throw new OutOfCredit('voyage', 'embed', 'billing refused', 400); } },
    meter: meter(),
    now: () => 0,
  });
  await assert.rejects(port.embedMedia!([image('https://example.invalid/a.jpg'), image('https://example.invalid/b.jpg')], { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1 }), OutOfCredit);
  assert.equal(calls, 1, 'not split and asked again');
});

test('★ a post is its words and picture as one input, in the post space; a dead picture leaves the words alone', async () => {
  const dead = 'https://example.invalid/dead.jpg';
  const sent: unknown[] = [];
  const port = voyageEmbed({
    client: {
      embed: async ({ inputs }) => {
        sent.push(...inputs);
        if (inputs.some((i) => i.imageUrl === dead)) throw new VendorUnavailable('voyage', 'embed', 'responded 400', 400);
        const one = Float32Array.from({ length: DIMENSIONS }, (_, k) => (k === 0 ? 1 : 0));
        return { vectors: inputs.map(() => one), totalTokens: 100 * inputs.length };
      },
    },
    meter: meter(),
    now: () => 0,
  });
  const r = await port.embedPosts!(
    [{ text: 'a hippo', picture: 'https://example.invalid/a.jpg' }, { text: 'words only', picture: null }, { text: 'its picture is gone', picture: dead }, { text: ' ', picture: null }],
    { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1 },
  );
  assert.deepEqual(sent[0], { text: 'a hippo', imageUrl: 'https://example.invalid/a.jpg' });
  assert.deepEqual(r.value.map((v) => v?.space ?? null), [port.postSpace, port.postSpace, port.postSpace, null]);
  assert.ok(sent.some((i) => JSON.stringify(i) === JSON.stringify({ text: 'its picture is gone' })), 'asked again with its words alone');
  assert.notEqual(port.postSpace, SPACE, 'never compared with a picture-only vector');
});
