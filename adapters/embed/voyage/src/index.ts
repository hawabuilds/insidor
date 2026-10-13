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
 * One picture the vendor cannot fetch (a deleted post image, a dead host) makes it refuse the
 * whole request with a 400. The batch is halved until that picture stands alone, and it comes
 * back null like any other unread picture, so one dead link no longer stops a run of thousands.
 * A batch refused in full still throws: that is a broken request, not a dead picture.
 *
 * A post's words and picture can also be read as ONE vector (`embedPosts`, space POST_SPACE): the
 * feed's judge is shown the owner's labelled posts closest to each post it is asked about, and
 * most posts are words, a picture, or both — a picture-only vector would miss every text post.
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

import { OutOfCredit, VendorUnavailable } from '@insidor/vendor-kit';

import { VENDOR, type EmbedInput, type EmbedReply, type VoyageClient } from './client.ts';

export { VENDOR };
export { httpClient, readReply } from './client.ts';
export type { VoyageClient, VoyageClientConfig } from './client.ts';

export const MODEL = 'voyage-multimodal-3';
/** The representation's identity, as policy names it. */
export const SPACE = 'multimodal-3.1024';
/**
 * A POST's vector: its words and picture read together (`embedPosts`). The same model, but a
 * different thing embedded, so a space of its own: a post vector is never compared with a
 * picture-only vector in internal.image_embedding, whose bars were tuned on pictures alone.
 */
export const POST_SPACE = 'multimodal-3.1024.post';
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

/* A billing refusal is never one bad picture, whatever its status: halving the batch over it would
   turn an empty account into a column of nulls. */
const refusedInput = (error: unknown): boolean => error instanceof VendorUnavailable && !(error instanceof OutOfCredit) && error.status === 400;

/** Ask for a batch; on a 400, halve it until each refused input stands alone and is null. */
async function embedAround(client: VoyageClient, inputs: readonly EmbedInput[]): Promise<EmbedReply> {
  try {
    return await client.embed({ model: MODEL, inputs });
  } catch (error) {
    if (!refusedInput(error)) throw error;
    if (inputs.length === 1) return { vectors: [null], totalTokens: 0 };
    const mid = Math.ceil(inputs.length / 2);
    const left = await embedAround(client, inputs.slice(0, mid));
    const right = await embedAround(client, inputs.slice(mid));
    return { vectors: [...left.vectors, ...right.vectors], totalTokens: left.totalTokens + right.totalTokens };
  }
}

export function voyageEmbed(deps: VoyageEmbedDeps): EmbedPort {
  const prices = deps.prices ?? PRICES;

  async function run(
    inputs: readonly (EmbedInput | null)[],
    reserve: (input: EmbedInput) => number,
    space: string = SPACE,
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
          const inputs = batch.map((b) => b.input);
          const reply = await embedAround(deps.client, inputs);
          /* Every input refused is the request itself at fault: say so rather than return nulls. */
          if (inputs.length > 1 && reply.vectors.every((v) => v === null)) {
            throw new VendorUnavailable(VENDOR, 'POST /v1/multimodalembeddings', 'refused every input in the batch', 400);
          }
          const embeddings = reply.vectors.map((values): Embedding | null =>
            values === null || values.length !== DIMENSIONS ? null : { space, dimensions: DIMENSIONS, values: l2Normalize(values) },
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
        (input) => (input.text === undefined ? RESERVED_TOKENS_PER_IMAGE : Math.ceil(input.text.length / 4)),
      );
    },

    postSpace: POST_SPACE,

    /**
     * A post's words and picture as one vector. A picture the vendor cannot fetch (a dead or
     * expired link) comes back null from the halving above; such a post is asked once more with
     * its words alone, so a dead picture costs the post its picture, not its vector.
     */
    async embedPosts(posts, _budget) {
      const inputOf = (p: { readonly text: string; readonly picture: string | null }, withPicture: boolean): EmbedInput | null => {
        const text = p.text.trim();
        const picture = withPicture && p.picture !== null && p.picture.trim() !== '' ? p.picture : null;
        if (picture === null) return text === '' ? null : { text };
        return text === '' ? { imageUrl: picture } : { text, imageUrl: picture };
      };
      const reserve = (input: EmbedInput): number => (input.text === undefined ? 0 : Math.ceil(input.text.length / 4)) + (input.imageUrl === undefined ? 0 : RESERVED_TOKENS_PER_IMAGE);
      const first = await run(posts.map((p) => inputOf(p, true)), reserve, POST_SPACE);
      const retry = posts.map((p, i) => (first.value[i] === null && p.picture !== null ? inputOf(p, false) : null));
      if (retry.every((r) => r === null)) return first;
      const second = await run(retry, reserve, POST_SPACE);
      return {
        value: first.value.map((v, i) => v ?? second.value[i] ?? null),
        spend: mergeSpend([first.spend, second.spend], { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-item-returned', estUnits: 0, at: deps.now() }, 'per-item-returned'),
      };
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
