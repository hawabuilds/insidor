/**
 * The service's two routes: POST /embed (words, a picture, or both, as one unit vector each) and
 * GET /health.
 *
 * Separate from main.ts so the routes are tested with a stand-in encoder and a stand-in fetch:
 * the request shape, the secret, the caps and the per-input nulls are all decided here.
 *
 * ★ ONE BAD INPUT IS ONE NULL. A picture that cannot be fetched or decoded is a null slot (or,
 * with words beside it, the words alone, marked `picture: 'unread'`), never a failed request: the
 * hosted vendor refused a whole batch over one dead link and that cost a pass of thousands
 * (2026-10-16). A request that is itself wrong — no secret, bad JSON, too many inputs — is a 4xx.
 *
 * ★ THE SECRET IS COMPARED IN CONSTANT TIME AND NEVER LOGGED, nor are picture addresses (they are
 * signed and not ours to keep); the log carries counts by reason.
 *
 * What breaks if changed carelessly: the reply's `space` and `postSpace` are what the adapter
 * checks before it believes a vector. Sending vectors without them, or with a space this code did
 * not compute, removes the one guard against comparing two models' vectors.
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Encoder } from './model.ts';
import { fetchPicture, type Lookup, type PictureLimits, type Unread } from './picture.ts';
import { MODEL_DIMENSIONS, MODEL_ID, POST_SPACE, POST_TEXT_WEIGHT, SPACE } from './space.ts';
import { combine } from './vectors.ts';

export interface EmbedInput {
  readonly text?: string;
  readonly imageUrl?: string;
}

export type PictureState = 'none' | 'read' | 'unread';

export interface EmbedReply {
  readonly model: string;
  /** The space of a lone text or a lone picture. */
  readonly space: string;
  /** The space of a words-and-picture input. */
  readonly postSpace: string;
  readonly dimensions: number;
  readonly vectors: readonly (readonly number[] | null)[];
  readonly pictures: readonly PictureState[];
}

export interface ServiceDeps {
  /** Null while the model is still loading: /embed answers 503, /health says so. */
  readonly encoder: () => Encoder | null;
  readonly secret: string;
  readonly pictures: PictureLimits;
  readonly maxInputs: number;
  readonly maxBodyBytes: number;
  readonly maxTextChars: number;
  /** Pictures fetched at once per request. */
  readonly fetchConcurrency: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly lookup?: Lookup;
  readonly log: (line: Record<string, unknown>) => void;
  readonly rssBytes: () => number;
}

export class BadRequest extends Error {}

/** Read and check the body's shape. Exported for the tests. */
export function readInputs(raw: unknown, maxInputs: number, maxTextChars: number): EmbedInput[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { inputs?: unknown }).inputs)) throw new BadRequest('body must be {"inputs": [...]}');
  const inputs = (raw as { inputs: unknown[] }).inputs;
  if (inputs.length > maxInputs) throw new BadRequest(`at most ${maxInputs} inputs per request`);
  return inputs.map((input, i) => {
    if (typeof input !== 'object' || input === null) throw new BadRequest(`inputs[${i}] must be an object`);
    const { text, imageUrl } = input as { text?: unknown; imageUrl?: unknown };
    if (text !== undefined && typeof text !== 'string') throw new BadRequest(`inputs[${i}].text must be a string`);
    if (imageUrl !== undefined && typeof imageUrl !== 'string') throw new BadRequest(`inputs[${i}].imageUrl must be a string`);
    const t = typeof text === 'string' && text.trim() !== '' ? text.trim().slice(0, maxTextChars) : undefined;
    const u = typeof imageUrl === 'string' && imageUrl.trim() !== '' ? imageUrl.trim() : undefined;
    return { ...(t === undefined ? {} : { text: t }), ...(u === undefined ? {} : { imageUrl: u }) };
  });
}

/** Run `work` over `items` with at most `limit` running at once, results in input order. */
async function bounded<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await work(items[i] as T);
    }
  });
  await Promise.all(lanes);
  return out;
}

const round = (v: Float32Array): number[] => Array.from(v, (x) => Math.round(x * 1e7) / 1e7);

export async function embed(inputs: readonly EmbedInput[], encoder: Encoder, deps: ServiceDeps): Promise<EmbedReply> {
  const unread: Partial<Record<Unread | 'decode', number>> = {};
  const pictureVectors = await bounded(inputs, deps.fetchConcurrency, async (input) => {
    if (input.imageUrl === undefined) return null;
    const got = await fetchPicture(input.imageUrl, deps.pictures, deps.fetch, deps.lookup);
    if ('unread' in got) {
      unread[got.unread] = (unread[got.unread] ?? 0) + 1;
      return null;
    }
    const vector = await encoder.embedPicture(got.bytes);
    if (vector === null) unread.decode = (unread.decode ?? 0) + 1;
    return vector;
  });
  const texted = inputs.flatMap((input, i) => (input.text === undefined ? [] : [{ i, text: input.text }]));
  const textVectors: (Float32Array | null)[] = inputs.map(() => null);
  const read = await encoder.embedTexts(texted.map((t) => t.text));
  texted.forEach((t, j) => (textVectors[t.i] = read[j] ?? null));

  const vectors = inputs.map((input, i) => {
    const text = textVectors[i] ?? null;
    const picture = pictureVectors[i] ?? null;
    if (text !== null && picture !== null) return combine(text, picture, POST_TEXT_WEIGHT);
    return text ?? picture;
  });
  const pictures = inputs.map((input, i): PictureState => (input.imageUrl === undefined ? 'none' : pictureVectors[i] === null ? 'unread' : 'read'));
  deps.log({ msg: 'embedded', inputs: inputs.length, texts: texted.length, pictures: pictures.filter((p) => p !== 'none').length, unread });
  return {
    model: MODEL_ID,
    space: SPACE,
    postSpace: POST_SPACE,
    dimensions: MODEL_DIMENSIONS,
    vectors: vectors.map((v) => (v === null ? null : round(v))),
    pictures,
  };
}

function secretMatches(given: string | undefined, secret: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new BadRequest(`body over ${max} bytes`);
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** The header the shared secret travels in. */
export const SECRET_HEADER = 'x-embed-key';

export function handler(deps: ServiceDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0];
      if (req.method === 'GET' && path === '/health') {
        const loaded = deps.encoder() !== null;
        send(res, loaded ? 200 : 503, { ok: loaded, model: MODEL_ID, space: SPACE, postSpace: POST_SPACE, rssMB: Math.round(deps.rssBytes() / 1e6) });
        return;
      }
      if (path !== '/embed') return send(res, 404, { error: 'not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      const given = req.headers[SECRET_HEADER];
      if (!secretMatches(Array.isArray(given) ? given[0] : given, deps.secret)) return send(res, 401, { error: 'missing or wrong key' });
      const encoder = deps.encoder();
      if (encoder === null) return send(res, 503, { error: 'model loading' });
      let inputs: EmbedInput[];
      try {
        inputs = readInputs(JSON.parse(await readBody(req, deps.maxBodyBytes)), deps.maxInputs, deps.maxTextChars);
      } catch (error) {
        return send(res, 400, { error: error instanceof BadRequest ? error.message : 'body is not JSON' });
      }
      const started = Date.now();
      const reply = await embed(inputs, encoder, deps);
      deps.log({ msg: 'request', inputs: inputs.length, ms: Date.now() - started });
      send(res, 200, reply);
    })().catch((error: unknown) => {
      deps.log({ msg: 'request failed', error: error instanceof Error ? error.message : 'unknown' });
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  };
}
