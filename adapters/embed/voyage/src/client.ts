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

import { arr, num, outOfCredit, rec, vendorAnswered, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

export const VENDOR = 'voyage';
export const ENDPOINT_LABEL = 'POST /v1/multimodalembeddings';

/**
 * One input: an image by its public URL, a piece of text, or both read as one (a post's words
 * and its picture: the vendor puts the pair in one vector).
 */
export type EmbedInput = { readonly imageUrl: string; readonly text?: undefined } | { readonly text: string; readonly imageUrl?: string };

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
    /* Words first, then the picture, as one content list: one vector for the pair. */
    inputs: inputs.map((input) => ({
      content: [
        ...(input.text === undefined ? [] : [{ type: 'text', text: input.text }]),
        ...(input.imageUrl === undefined ? [] : [{ type: 'image_url', image_url: input.imageUrl }]),
      ],
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

/**
 * ★ A REFUSAL FOR BILLING, as a short reason we wrote, or null. 402 is "payment required"; a 4xx
 * (a 429 included: an account with no payment method is held to a reduced rate limit, and the
 * vendor's 429 says so) whose detail speaks of a payment method, billing, credit or funds. A plain
 * 429 is pacing, and a 400 about one picture is that picture. The body is matched, never quoted.
 */
export function billingReason(status: number, text: string): string | null {
  if (status < 400 || status >= 500 || status === 401) return null;
  const head = text.slice(0, 2000);
  if (/payment method/i.test(head)) return 'no payment method on file';
  if (/billing|insufficient (credit|fund|balance)|credit balance|out of credits?|payment|free tokens/i.test(head)) return 'billing refused';
  if (status === 402) return 'payment required';
  return null;
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
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const billing = billingReason(response.status, text);
        if (billing !== null) throw outOfCredit(VENDOR, ENDPOINT_LABEL, billing, response.status);
        throw new VendorUnavailable(VENDOR, ENDPOINT_LABEL, `responded ${response.status}`, response.status);
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new VendorUnavailable(VENDOR, ENDPOINT_LABEL, 'body was not JSON', response.status);
      }
      vendorAnswered(VENDOR);
      return readReply(parsed, inputs.length);
    },
  };
}
