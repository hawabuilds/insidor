/**
 * Embeddings from our own model (services/embed): the EmbedPort the hosted multimodal vendor
 * filled until 2026-10-24, when its account went negative and it refused every call. Pictures,
 * words, and a post's words and picture as one vector — the same three uses, in a space of its own.
 *
 * ★ A DIFFERENT SPACE, NOT A DROP-IN. The vectors are not comparable with the vendor's: a cosine
 * between the two is a well-formed number that means nothing. Every vector here carries SPACE or
 * POST_SPACE, and every stored-vector read filters on the policy's space (Policy.group.image), so
 * until the stored vectors are re-embedded (tools/reembed.ts) a lookup simply finds fewer
 * neighbours — the TIER 2 degrade the port promises — and never mixes the two. The bars are the
 * policy's too, measured for this space separately (copy test 2026-10-24).
 *
 * ★ STORED 1,024 WIDE. The model's vectors are 768 wide; every vector column is vector(1024)
 * (0027, 0052, 0069, 0074, 0076). The 768 values are followed by 256 zeros. A zero tail changes no
 * length and no dot product, so a cosine between two padded vectors is exactly the cosine between
 * the model's own, and no migration rewrites five tables of the vendor's vectors to make room.
 *
 * ★ THE SECOND POST SPACE IS 1,536 WIDE AND STORED AS IT IS (E5_POST_SPACE: another words model's
 * 768 values beside this model's picture's 768; services/embed/src/space.ts). It fits no 1,024
 * column, so the three post-vector tables' columns hold any width from 0137 on, and a row's width is
 * its space's: never padded, never cut. A port is built for ONE post space (`postSpace`), so the
 * fill can embed into the next space while the policy still reads the old one.
 *
 * ★ $0 A CALL, STILL METERED. The service is a fixed monthly cost, not a per-call one, so each call
 * is recorded at $0 — the meter still counts the calls, which is how a stalled or runaway caller
 * shows up on the owner's live meter.
 *
 * What breaks if changed carelessly: the reply's space is checked against SPACE/POST_SPACE before a
 * vector is believed. A service deployed with another model, precision or words weight names a
 * different space (services/embed/src/space.ts), and this refuses it — loudly, as an outage — rather
 * than writing vectors that look right and rank like noise.
 */

import type { Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Embedding, EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { Price, PriceBook } from '@insidor/meter';
import { VendorUnavailable } from '@insidor/vendor-kit';

import { ENDPOINT_LABEL, VENDOR, type EmbedInput, type SelfEmbedClient } from './client.ts';

export { VENDOR };
export { httpClient, readReply } from './client.ts';
export type { SelfEmbedClient, SelfEmbedClientConfig } from './client.ts';

/** The representation's identity, as the service names it and policy reads it. */
export const SPACE = 'siglip2-b16-224.768';
export const POST_SPACE = `${SPACE}.post`;
/** Another words model's vector beside this model's picture vector (services/embed space.ts). */
export const E5_POST_SPACE = 'me5-base+siglip2-b16-224.1536.post';
/** Its width, stored as is. */
export const E5_POST_DIMENSIONS = 1536;
/** The post spaces a port can be built for. */
export const POST_SPACES: readonly string[] = [POST_SPACE, E5_POST_SPACE];
/** The model's own width. */
export const MODEL_DIMENSIONS = 768;
/** The stored width: the model's values, then zeros (see the header). */
export const DIMENSIONS = 1024;
/** Inputs per request: the service's queue is one inference at a time, so one request stays short. */
export const MAX_BATCH = 32;

const ENDPOINT = 'embed';

const price: Price = {
  vendor: VENDOR,
  endpoint: ENDPOINT,
  unit: 'per-item-returned',
  /* A fixed monthly machine, not a per-call price. */
  usdPerUnit: 0,
  unitName: 'input embedded',
  measuredAt: '2026-10-24',
};

export const PRICES: PriceBook = { [`${VENDOR}:${ENDPOINT}`]: price };

export interface SelfEmbedDeps {
  readonly client: SelfEmbedClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  readonly prices?: PriceBook;
  /** The post space `embedPosts` writes in (one of POST_SPACES); POST_SPACE when absent. */
  readonly postSpace?: string;
}

/** The model's unit vector, zero-padded to the stored width. Null if it is not the model's width. */
export function padded(values: Float32Array): Float32Array | null {
  if (values.length !== MODEL_DIMENSIONS) return null;
  const out = new Float32Array(DIMENSIONS);
  out.set(values);
  return out;
}

export function selfEmbed(deps: SelfEmbedDeps): EmbedPort {
  const prices = deps.prices ?? PRICES;
  const postSpace = deps.postSpace ?? POST_SPACE;
  if (!POST_SPACES.includes(postSpace)) throw new Error(`no post space ${postSpace} in this adapter (${POST_SPACES.join(', ')})`);

  /** `space`: what the vectors are tagged with; a call for E5_POST_SPACE asks the service for it by name. */
  async function run(inputs: readonly (EmbedInput | null)[], space: string): Promise<Metered<readonly (Embedding | null)[]>> {
    const named = space === E5_POST_SPACE ? E5_POST_SPACE : undefined;
    const expectPost = named ?? POST_SPACE;
    const expectWidth = named === undefined ? MODEL_DIMENSIONS : E5_POST_DIMENSIONS;
    const at = deps.now();
    const out: (Embedding | null)[] = inputs.map(() => null);
    const spends = [];
    const asked = inputs.flatMap((input, index) => (input === null ? [] : [{ input, index }]));
    for (let i = 0; i < asked.length; i += MAX_BATCH) {
      const batch = asked.slice(i, i + MAX_BATCH);
      const call = await metered(
        deps.meter,
        prices,
        { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-item-returned', estUnits: batch.length, at },
        async () => {
          const reply = await deps.client.embed(batch.map((b) => b.input), named);
          /* The guard the header describes: a vector from any other space is never believed. */
          if (reply.space !== SPACE || reply.postSpace !== expectPost || reply.dimensions !== expectWidth) {
            throw new VendorUnavailable(VENDOR, ENDPOINT_LABEL, `answered in space ${reply.space}/${reply.postSpace}/${reply.dimensions}, expected ${SPACE}/${expectPost}/${expectWidth}`);
          }
          const embeddings = reply.vectors.map((values): Embedding | null => {
            if (named !== undefined) return values === null || values.length !== E5_POST_DIMENSIONS ? null : { space, dimensions: E5_POST_DIMENSIONS, values };
            const v = values === null ? null : padded(values);
            return v === null ? null : { space, dimensions: DIMENSIONS, values: v };
          });
          return { value: embeddings, units: embeddings.filter((e) => e !== null).length };
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
    id: postSpace === POST_SPACE ? `embed:${VENDOR}/${SPACE}` : `embed:${VENDOR}/${SPACE}+${postSpace}`,
    space: SPACE,
    dimensions: DIMENSIONS,
    maxBatch: MAX_BATCH,

    embedText(texts: readonly string[], _budget: Budget) {
      return run(texts.map((text) => (text.trim() === '' ? null : { text })), SPACE);
    },

    postSpace,

    /**
     * A post's words and picture as one vector. A picture the service cannot fetch costs the post
     * its picture, not its vector: the service answers with the words alone (and says so), as the
     * vendor adapter did by asking twice.
     */
    embedPosts(posts, _budget) {
      return run(
        posts.map((p): EmbedInput | null => {
          const text = p.text.trim();
          const picture = p.picture !== null && p.picture.trim() !== '' ? p.picture : null;
          if (picture === null) return text === '' ? null : { text };
          return text === '' ? { imageUrl: picture } : { text, imageUrl: picture };
        }),
        postSpace,
      );
    },

    /** Images only. A video or audio reference is null: this space was not asked about it. */
    embedMedia(media: readonly MediaRef[], _budget: Budget) {
      return run(media.map((m) => (m.kind === 'image' && m.uri.trim() !== '' ? { imageUrl: m.uri } : null)), SPACE);
    },
  };
}
