/**
 * The multimodal embedding vendor's HTTP surface: one endpoint, images by URL or text, one
 * vector per input in input order.
 *
 * Separate from index.ts so the port can be tested with this replaced by a recorded reply,
 * and so the one file that knows the vendor's field names is this one.
 *
 * What breaks if changed carelessly: the vendor answers with `data[i].index`. Vectors are
 * placed by that index, never by array position; a response reordered in transit would
 * otherwise pin one post's vector on another post's image.
 */

import { arr, num, rec, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

export const VENDOR = 'voyage';
export const ENDPOINT_LABEL = 'POST /v1/multimodalembeddings';

/** One input: an image by its public URL, or a piece of text. */
export type EmbedInput = { readonly imageUrl: string } | { readonly text: string };

export interface EmbedReply {
  /** One vector per input, in input order; null for an input the vendor did not embed. */
  readonly vectors: readonly (Float32Array | null)[];
  /** What the vendor billed: text tokens plus image pixels counted as tokens. */
  readonly totalTokens: number;
}

export interface VoyageClient {
  embed(input: { readonly model: string; readonly inputs: readonly EmbedInput[] }): Promise<EmbedReply>;
}

export interface VoyageClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

function body(model: string, inputs: readonly EmbedInput[]): string {
  return JSON.stringify({
    model,
    inputs: inputs.map((input) => ({
      content: ['imageUrl' in input ? { type: 'image_url', image_url: input.imageUrl } : { type: 'text', text: input.text }],
    })),
    /* `document`: these are what later posts are compared against, the vendor's own term. */
    input_type: 'document',
  });
}

/** Read the reply. Exported so the shape is tested against a recorded reply with no network. */
export function readReply(raw: unknown, expected: number): EmbedReply {
  const r = rec(raw);
  const vectors: (Float32Array | null)[] = Array.from({ length: expected }, () => null);
  for (const [i, entry] of arr(r.data).entries()) {
    const e = rec(entry);
    const index = num(e.index);
    if (index === null || !Number.isInteger(index) || index < 0 || index >= expected) {
      throw new VendorShapeError(VENDOR, `data[${i}].index`, `is ${String(e.index)}`);
    }
    const values = arr(e.embedding).map((v, j) => {
      const n = num(v);
      if (n === null) throw new VendorShapeError(VENDOR, `data[${i}].embedding[${j}]`, 'is not a number');
      return n;
    });
    vectors[index] = Float32Array.from(values);
  }
  const usage = rec(r.usage);
  const totalTokens = num(usage.total_tokens);
  if (totalTokens === null) throw new VendorShapeError(VENDOR, 'usage.total_tokens', 'is missing');
  return { vectors, totalTokens };
}

export function httpClient(config: VoyageClientConfig): VoyageClient {
  return {
    async embed({ model, inputs }) {
      let response: Response;
      try {
        response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/multimodalembeddings`, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
          body: body(model, inputs),
          ...(config.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(config.timeoutMs) }),
        });
      } catch (error) {
        throw new VendorUnavailable(VENDOR, ENDPOINT_LABEL, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      if (!response.ok) throw new VendorUnavailable(VENDOR, ENDPOINT_LABEL, `responded ${response.status}`, response.status);
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new VendorUnavailable(VENDOR, ENDPOINT_LABEL, 'body was not JSON', response.status);
      }
      return readReply(parsed, inputs.length);
    },
  };
}
