/**
 * Our own embedding service's HTTP surface (services/embed): one POST of up to 32 inputs, one
 * vector per input in input order, and the space the service says it computed them in.
 *
 * Separate from index.ts so the port is tested with this replaced by a recorded reply, and so the
 * one file that knows the service's field names and its secret header is this one.
 *
 * ★ RETRIED, BRIEFLY. Unlike a vendor's API this service is one process on one machine: a deploy
 * or a restart is a few seconds of refused connections or a 503 while the model loads. A request
 * is retried twice, a second and then three seconds later, on a network error, a timeout, a 5xx
 * or a 503; a 4xx is our request's fault and is never retried. After that it is an outage, thrown
 * as VendorUnavailable, which every caller already degrades on (the port is TIER 2).
 *
 * What breaks if changed carelessly: the secret travels in `x-embed-key` and nowhere else — not in
 * the address, not in an error message. A 401 is reported as "refused the key", never with it.
 */

import { arr, num, rec, str, vendorAnswered, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

export const VENDOR = 'embed-service';
export const ENDPOINT_LABEL = 'POST /embed';

/** Words, a picture by its public address, or both read as one post vector. */
export type EmbedInput = { readonly imageUrl: string; readonly text?: undefined } | { readonly text: string; readonly imageUrl?: string };

export interface EmbedReply {
  /** The space of a lone text or lone picture, as the service names it. */
  readonly space: string;
  /** The space of a words-and-picture input. */
  readonly postSpace: string;
  readonly dimensions: number;
  /** One vector per input, in input order; null for an input it could not embed. */
  readonly vectors: readonly (Float32Array | null)[];
  /** Per input: 'none' (no picture asked), 'read', or 'unread' (fetch or decode failed). */
  readonly pictures: readonly string[];
}

export interface SelfEmbedClient {
  embed(inputs: readonly EmbedInput[]): Promise<EmbedReply>;
}

export interface SelfEmbedClientConfig {
  readonly baseUrl: string;
  readonly secret: string;
  readonly fetch: typeof globalThis.fetch;
  /** Per attempt. Default 60 s: 32 pictures fetched and encoded on a shared CPU. */
  readonly timeoutMs?: number;
  /** Waits before each retry; default one and three seconds. Tests pass zeros. */
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Read the reply. Exported so the shape is tested against a recorded reply with no network. */
export function readReply(raw: unknown, expected: number): EmbedReply {
  const r = rec(raw);
  const space = str(r.space);
  const postSpace = str(r.postSpace);
  const dimensions = num(r.dimensions);
  if (space === null || postSpace === null) throw new VendorShapeError(VENDOR, 'space', 'is missing');
  if (dimensions === null || !Number.isInteger(dimensions) || dimensions <= 0) throw new VendorShapeError(VENDOR, 'dimensions', `is ${String(r.dimensions)}`);
  const list = arr(r.vectors);
  if (list.length !== expected) throw new VendorShapeError(VENDOR, 'vectors', `has ${list.length} entries for ${expected} inputs`);
  const vectors = list.map((entry, i) => {
    if (entry === null) return null;
    const values = arr(entry).map((v, j) => {
      const n = num(v);
      if (n === null) throw new VendorShapeError(VENDOR, `vectors[${i}][${j}]`, 'is not a number');
      return n;
    });
    if (values.length !== dimensions) throw new VendorShapeError(VENDOR, `vectors[${i}]`, `is ${values.length} wide, not ${dimensions}`);
    return Float32Array.from(values);
  });
  const pictures = Array.isArray(r.pictures) ? r.pictures.map((p) => (typeof p === 'string' ? p : 'none')) : vectors.map(() => 'none');
  return { space, postSpace, dimensions, vectors, pictures };
}

const transient = (status: number): boolean => status >= 500 || status === 429;

export function httpClient(config: SelfEmbedClientConfig): SelfEmbedClient {
  const delays = config.retryDelaysMs ?? [1_000, 3_000];
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const url = `${config.baseUrl.replace(/\/+$/, '')}/embed`;

  async function once(inputs: readonly EmbedInput[]): Promise<{ readonly reply: EmbedReply } | { readonly retry: VendorUnavailable }> {
    let response: Response;
    try {
      response = await config.fetch(url, {
        method: 'POST',
        headers: { 'x-embed-key': config.secret, 'content-type': 'application/json' },
        body: JSON.stringify({ inputs }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
      });
    } catch (error) {
      return { retry: new VendorUnavailable(VENDOR, ENDPOINT_LABEL, `request failed: ${error instanceof Error ? error.name : 'unknown'}`) };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401) throw new VendorUnavailable(VENDOR, ENDPOINT_LABEL, 'refused the key', 401);
      const error = new VendorUnavailable(VENDOR, ENDPOINT_LABEL, `responded ${response.status}`, response.status);
      if (transient(response.status)) return { retry: error };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { retry: new VendorUnavailable(VENDOR, ENDPOINT_LABEL, 'body was not JSON', response.status) };
    }
    vendorAnswered(VENDOR);
    return { reply: readReply(parsed, inputs.length) };
  }

  return {
    async embed(inputs) {
      for (let attempt = 0; ; attempt += 1) {
        const got = await once(inputs);
        if ('reply' in got) return got.reply;
        const wait = delays[attempt];
        if (wait === undefined) throw got.retry;
        await sleep(wait);
      }
    },
  };
}
