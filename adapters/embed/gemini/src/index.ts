/**
 * Embeddings from a hosted API.
 *
 * WHY HOSTED, briefly, because the intuition runs the other way: at this volume
 * a local encoder measured 780 MB resident, which moves the worker from a
 * ~$3/month machine to an ~$11/month one — about $7/month to avoid a
 * $0.33/month bill, plus a few hundred megabytes of dependencies and a
 * five-second cold start on every deploy.
 *
 * WHAT MAKES THAT SAFE: an embedding is TIER 2. The free tiers — perceptual
 * image hash, near-duplicate text, format ids, lineage pointers — are local,
 * deterministic and language-blind, and do most of the grouping work. An
 * embedding outage must DEGRADE grouping to those tiers, never stop it. That
 * stays true only as long as nothing makes an embedding a PRECONDITION for
 * joining a story; the moment something does, this justification evaporates.
 *
 * `space` is the identity of the representation, not just of the model. Two
 * vectors from different spaces never compare, and a similarity bar calibrated
 * against one space merges nearly everything behind a differently-shaped one —
 * a real, expensive, previously-shipped bug.
 */

import type { Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Embedding, EmbedPort } from '@insidor/contracts/ports/embed.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { Price, PriceBook } from '@insidor/meter';
import { NotImplemented } from '@insidor/vendor-kit';

import { assertDimension, l2Normalize } from './normalize.ts';

export const VENDOR = 'gemini';
export const MODEL = 'gemini-embedding-001';
export const SPACE = 'text.gemini-embedding-001.768';
export const DIMENSIONS = 768;
/** The vendor's own cap on inputs per request. */
export const MAX_BATCH = 100;

const ENDPOINT = 'embed';

const price: Price = {
  vendor: VENDOR,
  endpoint: ENDPOINT,
  unit: 'per-item-returned',
  /** Dollars per input token. Roughly $0.15 per million. */
  usdPerUnit: 0.15 / 1e6,
  unitName: 'input token',
  measuredAt: '2026-08-05',
};

export const PRICES: PriceBook = { [`${VENDOR}:${ENDPOINT}`]: price };

export interface EmbedClient {
  /** One raw vector per input, in input order, plus the tokens consumed. */
  batchEmbed(input: {
    readonly model: string;
    readonly texts: readonly string[];
    readonly dimensions: number;
  }): Promise<{ readonly vectors: readonly (Float32Array | null)[]; readonly inputTokens: number }>;
}

export interface EmbedClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}

export function httpClient(_config: EmbedClientConfig): EmbedClient {
  return {
    batchEmbed: async (_input) => {
      // POST {baseUrl}/v1beta/models/gemini-embedding-001:batchEmbedContents
      //   ?key=… — up to MAX_BATCH requests per call, one embedding each,
      //   returned in request order. Order is the only thing tying a vector to
      //   its text, so a short response must be a failure, not a shift.
      throw new NotImplemented('POST /v1beta/models/{model}:batchEmbedContents');
    },
  };
}

export interface GeminiEmbedDeps {
  readonly client: EmbedClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  readonly prices?: PriceBook;
}

export function geminiEmbed(deps: GeminiEmbedDeps): EmbedPort {
  const prices = deps.prices ?? PRICES;

  return {
    id: `embed:${VENDOR}/${MODEL}`,
    space: SPACE,
    dimensions: DIMENSIONS,
    maxBatch: MAX_BATCH,

    async embedText(
      texts: readonly string[],
      _budget: Budget,
    ): Promise<Metered<readonly (Embedding | null)[]>> {
      const at = deps.now();
      const out: (Embedding | null)[] = [];
      const spends = [];

      for (let i = 0; i < texts.length; i += MAX_BATCH) {
        const batch = texts.slice(i, i + MAX_BATCH);

        const call = await metered(
          deps.meter,
          prices,
          {
            vendor: VENDOR,
            endpoint: ENDPOINT,
            unit: 'per-item-returned',
            // Estimated from length; the response reports the real count and
            // that is what gets recorded.
            estUnits: batch.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
            at,
          },
          async () => {
            const result = await deps.client.batchEmbed({ model: MODEL, texts: batch, dimensions: DIMENSIONS });
            if (result.vectors.length !== batch.length) {
              // A short response would silently pair vectors with the wrong
              // texts, because order is the only thing linking them.
              throw new NotImplemented('embed:partial-response', 'the vendor returned fewer vectors than texts');
            }
            const embeddings = result.vectors.map((values): Embedding | null => {
              // A null slot is a text this vendor could not embed. Tier 1 still
              // groups it; a zero vector would put it near everything.
              if (values === null) return null;
              assertDimension(values, DIMENSIONS);
              return { space: SPACE, dimensions: DIMENSIONS, values: l2Normalize(values) };
            });
            return { value: embeddings, units: result.inputTokens };
          },
        );

        out.push(...call.value);
        spends.push(call.spend);
      }

      return {
        value: out,
        spend: mergeSpend(
          spends,
          { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-item-returned', estUnits: 0, at },
          'per-item-returned',
        ),
      };
    },

    // embedMedia is deliberately not implemented. Declaring it and throwing
    // would cost a call to find out; leaving it undefined is checkable.
  };
}

export { l2Normalize, assertDimension } from './normalize.ts';
