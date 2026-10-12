/**
 * Image embeddings from a hosted multimodal model: one vector per post image (and per coin
 * image), in one space with text, so an edited copy of a picture — cropped, captioned,
 * filtered, redrawn — lands near the original where a pixel hash would not.
 *
 * This is the paid tier of GROUP's representation channel. It must DEGRADE grouping when
 * it is down, never stop it: a missing vector is null, and core reads null as "not
 * consulted", never as "not alike" (see core/src/group/match.ts).
 *
 * `SPACE` names the representation, not the vendor, because policy keys its similarity bars
 * by it and policy may not name a vendor. Two spaces never compare.
 *
 * What breaks if changed carelessly: vectors are L2-normalised here, once, so a cosine is a
 * dot product everywhere downstream. A vector stored unnormalised would make every
 * similarity bar mean something different for that row.
 */

import type { Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Embedding, EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { Price, PriceBook } from '@insidor/meter';

import { VENDOR, type EmbedInput, type VoyageClient } from './client.ts';

export { VENDOR };
export { httpClient, readReply } from './client.ts';
export type { VoyageClient, VoyageClientConfig } from './client.ts';

export const MODEL = 'voyage-multimodal-3';
/** The representation's identity, as policy names it. */
export const SPACE = 'multimodal-3.1024';
export const DIMENSIONS = 1024;
/** Inputs per request. Well under the vendor's own limit, so one slow image delays few. */
export const MAX_BATCH = 32;
/**
 * Tokens reserved per image before the call. The vendor counts an image as one token per
 * 560 pixels; a 1200×675 post image is about 1,450. Reserving 3,000 covers a 1.6 MP image,
 * and the reply's real count is what is recorded.
 */
export const RESERVED_TOKENS_PER_IMAGE = 3_000;

const ENDPOINT = 'embed';

const price: Price = {
  vendor: VENDOR,
  endpoint: ENDPOINT,
  unit: 'per-item-returned',
  /** Dollars per token: $0.12 per million, text and image alike. */
  usdPerUnit: 0.12 / 1e6,
  unitName: 'token (text, or 560 image pixels)',
  measuredAt: '2026-10-12',
};

export const PRICES: PriceBook = { [`${VENDOR}:${ENDPOINT}`]: price };

function l2Normalize(values: Float32Array): Float32Array {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) return values;
  return values.map((v) => v / norm);
}

export interface VoyageEmbedDeps {
  readonly client: VoyageClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  readonly prices?: PriceBook;
}

export function voyageEmbed(deps: VoyageEmbedDeps): EmbedPort {
  const prices = deps.prices ?? PRICES;

  async function run(
    inputs: readonly (EmbedInput | null)[],
    reserve: (input: EmbedInput) => number,
  ): Promise<Metered<readonly (Embedding | null)[]>> {
    const at = deps.now();
    const out: (Embedding | null)[] = inputs.map(() => null);
    const spends = [];
    /* Only real inputs are sent; a null (a video with no still, an empty text) stays null. */
    const asked = inputs.flatMap((input, index) => (input === null ? [] : [{ input, index }]));
    for (let i = 0; i < asked.length; i += MAX_BATCH) {
      const batch = asked.slice(i, i + MAX_BATCH);
      const call = await metered(
        deps.meter,
        prices,
        { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-item-returned', estUnits: batch.reduce((n, b) => n + reserve(b.input), 0), at },
        async () => {
          const reply = await deps.client.embed({ model: MODEL, inputs: batch.map((b) => b.input) });
          const embeddings = reply.vectors.map((values): Embedding | null =>
            values === null || values.length !== DIMENSIONS ? null : { space: SPACE, dimensions: DIMENSIONS, values: l2Normalize(values) },
          );
          return { value: embeddings, units: reply.totalTokens };
        },
      );
      call.value.forEach((embedding, j) => {
        const slot = batch[j];
        if (slot !== undefined) out[slot.index] = embedding;
      });
      spends.push(call.spend);
    }
    return {
      value: out,
      spend: mergeSpend(spends, { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-item-returned', estUnits: 0, at }, 'per-item-returned'),
    };
  }

  return {
    id: `embed:${VENDOR}/${MODEL}`,
    space: SPACE,
    dimensions: DIMENSIONS,
    maxBatch: MAX_BATCH,

    embedText(texts: readonly string[], _budget: Budget) {
      return run(
        texts.map((text) => (text.trim() === '' ? null : { text })),
        (input) => ('text' in input ? Math.ceil(input.text.length / 4) : RESERVED_TOKENS_PER_IMAGE),
      );
    },

    /** Images only. A video or audio reference is null: this space was not asked about it. */
    embedMedia(media: readonly MediaRef[], _budget: Budget) {
      return run(
        media.map((m) => (m.kind === 'image' && m.uri.trim() !== '' ? { imageUrl: m.uri } : null)),
        () => RESERVED_TOKENS_PER_IMAGE,
      );
    },
  };
}
