/**
 * THE HTTP SURFACE, AND NOTHING ELSE: one structured-output call to the Messages API, the
 * same calls sent together as a Message Batch (for one-off jobs, at half price), and the
 * fetch of a video frame to show it.
 *
 * The only file in this package that touches the network, and `fetch` is INJECTED, never
 * imported and never read off `globalThis` — for the X adapter's reason: a unit test that
 * CAN reach the network eventually does, and here that would be a test that costs money.
 *
 * Raw HTTP rather than the vendor SDK, on purpose: every adapter in this repository is a
 * thin client over an injected `fetch`, which is what lets the tests replace the transport
 * with a fake that records what was sent. An SDK would bring its own retries and its own
 * transport, and the retries are the part this file has to own (see below).
 *
 * ── ★ THREE THINGS THAT ARE DELIBERATE ─────────────────────────────────────
 *
 * 1. A MISSING OR MALFORMED CREDENTIAL IS NOT A VENDOR FAILURE. `JudgeNotConfigured` is
 *    thrown at construction, before any call, so "nobody configured this" and "the vendor
 *    is down" never arrive as the same error. The first is a person editing a file; the
 *    second is a retry.
 *
 * 2. RETRIES ARE BOUNDED, AND ONLY FOR WHAT A RETRY CAN FIX. 429, 500, 502, 503, 504, 529,
 *    a timeout and a dropped socket are retried, up to `maxAttempts` in all, waiting
 *    `backoffMs` and doubling, never longer than `maxWaitMs` even when the vendor's
 *    retry-after asks for more. 400, 401, 402, 403, 404 and 413 are not: asking again gets
 *    the same answer. The numbers are policy (`Policy.judge`), never literals here. The
 *    whole retried call is ONE metered call above this file, so the ledger sees one charge
 *    per batch however many attempts it took. The one exception: a lost reply to the
 *    request that CREATES a Message Batch is not retried, because the batch may exist and a
 *    second one would be billed twice.
 *
 * 3. A REPLY THAT DOES NOT PARSE IS AN ABSENT ANSWER, NEVER A GUESSED ONE. A refusal, a
 *    reply cut off at `max_tokens`, or text that is not the JSON we asked for returns an
 *    empty `answers` list — with the usage, because the tokens were still billed — and
 *    `to-judgement.ts` turns every subject that got no answer into `unavailable`. QUALIFY
 *    then abstains. Nothing here salvages a half-parsed answer.
 */

import type { JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';
import { headerValueProblem, httpUrlProblem, messageOf, snippet, trimTrailingSlash } from '@insidor/vendor-kit/http.ts';

import { sizedPictureUri, type PictureSize } from './pictures.ts';

export const VENDOR = 'anthropic';
export const MESSAGES_ENDPOINT = 'POST /v1/messages';
const MESSAGES_PATH = '/v1/messages';
export const BATCHES_ENDPOINT = '/v1/messages/batches';
const BATCHES_PATH = '/v1/messages/batches';

/**
 * How often a running Message Batch is asked whether it has ended, and how long it may run
 * before it is cancelled and what finished is kept. Adapter constants rather than policy
 * because only one-off jobs use batches; a caller may override both (`JudgeClientConfig`).
 * The vendor finishes most batches within minutes and promises 24 hours; an hour is as long
 * as a person running a tool should be kept waiting.
 */
const BATCH_POLL_MS = 15_000;
const BATCH_MAX_WAIT_MS = 60 * 60_000;

/** Where a request goes, and whether a lost reply to it may be retried. */
interface Route {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  /** The endpoint named on an error. */
  readonly label: string;
  /** False for a request that creates something: a lost reply may mean it was created. */
  readonly retryLost: boolean;
}
export const API_VERSION = '2023-06-01';

/**
 * Token counts as the vendor reports them. Cost is computed from these. `inputTokens` is the
 * FRESH input only: tokens written to or read from the prompt cache are reported apart and
 * priced apart (prices.ts), so the three never double-count. Absent cache counts mean none.
 */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens?: number;
  readonly cacheReadTokens?: number;
}

/** A frame the judge may be shown, already read and checked. */
export interface Frame {
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  readonly base64: string;
}

export interface JudgeRequest {
  readonly system: string;
  readonly instructions: string;
  readonly subjects: readonly JudgeSubject[];
  /** Keyed by story id. Only subjects judged on a video frame have one. */
  readonly frames: ReadonlyMap<string, Frame>;
}

export interface JudgeResponse {
  /** One entry per subject the model answered. Empty when the reply was unusable. */
  readonly answers: readonly unknown[];
  readonly usage: Usage;
}

/** The same-subject answer about two pictures. Null when the reply carried no usable one. */
export type SameSubjectAnswer = 'yes' | 'no' | 'unsure';

export interface SameSubjectRequest {
  readonly a: Frame;
  readonly b: Frame;
  readonly prompt: string;
  readonly maxOutputTokens: number;
}

/** One request's outcome inside a Message Batch: its reply, or why there is none (not billed). */
export type BatchAnswer =
  | { readonly kind: 'answered'; readonly response: JudgeResponse }
  | { readonly kind: 'failed'; readonly note: string };

export interface JudgeClient {
  judge(request: JudgeRequest): Promise<JudgeResponse>;
  /**
   * The same requests through the Message Batches API, at half price and minutes-to-hours of
   * latency; answers in the order asked. Optional: a client without it is never asked. For
   * one-off jobs only — the live feed cannot wait for a batch.
   */
  judgeBatch?(requests: readonly JudgeRequest[]): Promise<readonly BatchAnswer[]>;
  /** Show both pictures with the same-subject prompt. Optional: a client without it is never asked. */
  sameSubject?(request: SameSubjectRequest): Promise<{ readonly answer: SameSubjectAnswer | null; readonly usage: Usage }>;
  /** Read a video frame to show the judge, or null when there is no usable image at `uri`. */
  frame(uri: string): Promise<Frame | null>;
}

export interface JudgeClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** From JUDGE_MODEL. Never defaulted here. */
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly effort: 'low' | null;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly maxWaitMs: number;
  readonly maxFrameBytes: number;
  /**
   * Ask the picture host for this smaller named size before showing a picture (pictures.ts),
   * falling back to the full one. Absent or null: the picture as the post links it. Off by
   * default because a smaller picture can change the answer; see pictures.ts.
   */
  readonly pictureSize?: PictureSize | null;
  /** Overrides BATCH_POLL_MS / BATCH_MAX_WAIT_MS (see there). */
  readonly batchPollMs?: number;
  readonly batchMaxWaitMs?: number;
  readonly fetch: typeof globalThis.fetch;
  /** Injected so a test can retry without waiting. */
  readonly sleep: (ms: number) => Promise<void>;
}

/* ── configuration errors ─────────────────────────────────────────────── */

export class JudgeNotConfigured extends Error {
  readonly variable: string;

  constructor(variable: string, note: string) {
    super(
      `judge is not configured: ${variable} ${note}. ANTHROPIC_API_KEY and JUDGE_MODEL go in ` +
        '.env.local, which is gitignored; neither has a default. JUDGE_MODEL must be a model ' +
        'listed in adapters/judge/anthropic/src/prices.ts, because a call that cannot be priced ' +
        'is refused rather than estimated. ★ THE JUDGE IS BILLED PER TOKEN, and every call goes ' +
        'through the meter and DAILY_BUDGET_USD.',
    );
    this.name = 'JudgeNotConfigured';
    this.variable = variable;
  }
}

/* ── the request, as a pure function ──────────────────────────────────── */

/**
 * What the model must answer with: one entry per story, keyed by the story id we sent, so
 * answers are matched back by id and never by position.
 */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          storyId: { type: 'string' },
          coinable: { type: 'boolean' },
          proposedName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          confidence: { type: 'number' },
          alternateNames: { type: 'array', items: { type: 'string' } },
          subjectSpans: { type: 'array', items: { type: 'string' } },
        },
        required: ['storyId', 'coinable', 'proposedName', 'confidence', 'alternateNames', 'subjectSpans'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
} as const;

/**
 * The body, built without a socket so it can be asserted on.
 *
 * The prompt files go in exactly as loaded and hashed: `system.txt` as the system prompt,
 * the other two as the first block of the user turn. Then the stories as JSON, then — only
 * for stories judged on a video frame — each frame, labelled with its story id. No counts
 * of views, likes or shares are sent: the prompt says why.
 *
 * ★ THE FIXED PART ENDS AT THE INSTRUCTIONS BLOCK, AND THAT BLOCK CARRIES THE CACHE MARK.
 * Everything up to it (the answer schema, the system prompt, the instructions) is byte-for-byte
 * the same on every call of one question, so it is marked `cache_control: ephemeral` and the
 * vendor may serve it from its prompt cache at a tenth of the input rate. Anything that varies
 * per call — the stories, the pictures — must stay AFTER the mark: a varying byte before it
 * makes every call a cache write, which costs MORE than no cache. The mark changes nothing the
 * model reads; below the model's minimum cacheable length it is silently ignored.
 */
export function buildRequestBody(
  config: Pick<JudgeClientConfig, 'model' | 'maxOutputTokens' | 'effort'>,
  request: JudgeRequest,
): Record<string, unknown> {
  const stories = request.subjects.map((s) => ({
    storyId: String(s.storyId),
    posts: s.texts,
    distinctAuthors: s.distinctAuthors,
    distinctSources: s.distinctSources,
    frame: request.frames.has(String(s.storyId)) ? 'shown below' : 'none',
  }));

  const content: unknown[] = [
    { type: 'text', text: request.instructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Stories to judge, as JSON. Answer once for each storyId.\n${JSON.stringify(stories)}` },
  ];
  for (const s of request.subjects) {
    const frame = request.frames.get(String(s.storyId));
    if (frame === undefined) continue;
    content.push({ type: 'text', text: `Picture for storyId ${String(s.storyId)} (a still picture, or a frame from its video):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: frame.mediaType, data: frame.base64 } });
  }

  return {
    model: config.model,
    max_tokens: config.maxOutputTokens,
    system: [{ type: 'text', text: request.system }],
    messages: [{ role: 'user', content }],
    output_config: {
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
      ...(config.effort === null ? {} : { effort: config.effort }),
    },
  };
}

/* ── the reply, as a pure function ────────────────────────────────────── */

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** The usage block of a reply, cache counts included, whatever else the reply holds. */
export function usageOf(body: unknown): Usage {
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const u = (typeof r['usage'] === 'object' && r['usage'] !== null ? r['usage'] : {}) as Record<string, unknown>;
  return {
    inputTokens: count(u['input_tokens']),
    outputTokens: count(u['output_tokens']),
    cacheWriteTokens: count(u['cache_creation_input_tokens']),
    cacheReadTokens: count(u['cache_read_input_tokens']),
  };
}

/**
 * The answers and the usage out of a reply body.
 *
 * Usage is read whatever else is wrong, because the tokens were billed whatever else is
 * wrong. Anything short of a complete JSON answer — a refusal, a reply cut off at
 * `max_tokens`, text that does not parse, an `answers` that is not a list — is no answers.
 */
export function decodeReply(body: unknown): JudgeResponse {
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const usage = usageOf(body);

  if (r['stop_reason'] !== 'end_turn') return { answers: [], usage };
  const blocks = Array.isArray(r['content']) ? r['content'] : [];
  const text = blocks
    .map((b) => (typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text' ? (b as Record<string, unknown>)['text'] : null))
    .filter((t): t is string => typeof t === 'string')
    .join('');
  try {
    const parsed: unknown = JSON.parse(text);
    const answers = (parsed as Record<string, unknown> | null)?.['answers'];
    return { answers: Array.isArray(answers) ? answers : [], usage };
  } catch {
    return { answers: [], usage };
  }
}

/* ── the same-subject question ────────────────────────────────────────── */

export const SAME_SUBJECT_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string', enum: ['yes', 'no', 'unsure'] } },
  required: ['answer'],
  additionalProperties: false,
} as const;

/** The answer out of a reply, or null for anything short of one of the three words. Usage always. */
export function decodeSameSubject(body: unknown): { readonly answer: SameSubjectAnswer | null; readonly usage: Usage } {
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const usage = usageOf(body);
  if (r['stop_reason'] !== 'end_turn') return { answer: null, usage };
  const blocks = Array.isArray(r['content']) ? r['content'] : [];
  const text = blocks
    .map((b) => (typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text' ? (b as Record<string, unknown>)['text'] : null))
    .filter((t): t is string => typeof t === 'string')
    .join('');
  try {
    const answer = (JSON.parse(text) as Record<string, unknown> | null)?.['answer'];
    return { answer: answer === 'yes' || answer === 'no' || answer === 'unsure' ? answer : null, usage };
  } catch {
    return { answer: null, usage };
  }
}

/* ── the client ───────────────────────────────────────────────────────── */

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const FRAME_TYPES = new Set<Frame['mediaType']>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * ★ A PICTURE'S ADDRESS IS NOT A BASE URL. `httpUrlProblem` refuses a query string because every
 * request built on a base address would silently carry it; a picture is fetched once, as is, and
 * the short-video source's covers are signed addresses whose query string IS the permission to
 * read them. Refusing it showed the judge no picture for every TikTok video, so none was ever
 * judged (2026-10-13). A picture needs only to be a well-formed https address.
 */
function pictureUrlProblem(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return 'not a URL';
  }
  return url.protocol === 'https:' ? null : 'not https';
}

/** Seconds from a retry-after header, or null. The date form is ignored rather than guessed at. */
function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null || !/^\d+(\.\d+)?$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 1_000;
}

export function httpClient(config: JudgeClientConfig): JudgeClient {
  const keyProblem = headerValueProblem(config.apiKey);
  if (keyProblem !== null) throw new JudgeNotConfigured('ANTHROPIC_API_KEY', keyProblem);
  const urlProblem = httpUrlProblem(config.baseUrl);
  if (urlProblem !== null) throw new JudgeNotConfigured('ANTHROPIC_BASE_URL', urlProblem);
  if (config.model.trim() === '') throw new JudgeNotConfigured('JUDGE_MODEL', 'is empty');
  if (config.maxAttempts < 1) throw new RangeError('judge client: maxAttempts must be at least 1');
  const root = trimTrailingSlash(config.baseUrl);

  /** One attempt. Returns the status and body, or throws for a transport failure. */
  const attempt = async (route: Route, body: string | undefined): Promise<{ status: number; headers: Headers; text: string }> => {
    const response = await config.fetch(`${root}${route.path}`, {
      method: route.method,
      // The key goes in a header and nowhere else: a keyed URL ends up in a proxy log.
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': API_VERSION,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    // Always drained, even on a status we are about to reject, so the socket is freed.
    return { status: response.status, headers: response.headers, text: await response.text() };
  };

  /** One exchange, with the policy's retries; the body text of a 2xx reply. */
  const exchange = async (route: Route, payload?: Record<string, unknown>): Promise<string> => {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      let lastNote = 'no attempt was made';
      /* The status of the last attempt when the vendor answered it, undefined when the
         last attempt got no answer at all. Carried on the final error, because an answered
         error is not billed and a lost reply may have been. */
      let lastStatus: number | undefined;
      let wait = 0;
      for (let n = 0; n < config.maxAttempts; n += 1) {
        if (n > 0) await config.sleep(wait);
        /* The next wait, if this attempt fails: the policy backoff, doubling — or the
           vendor's own retry-after when it gives one — never longer than maxWaitMs. */
        wait = Math.min(config.maxWaitMs, config.backoffMs * 2 ** n);

        let res: { status: number; headers: Headers; text: string };
        try {
          res = await attempt(route, body);
        } catch (error) {
          lastNote = `request failed: ${messageOf(error)}`;
          lastStatus = undefined;
          /* A lost reply to a request that CREATES something is not retried: it may have
             been created, and a second one would be billed twice. */
          if (!route.retryLost) break;
          continue;
        }
        if (res.status >= 200 && res.status < 300) return res.text;
        if (!RETRYABLE.has(res.status)) {
          throw new VendorUnavailable(VENDOR, route.label, `answered ${res.status}: ${snippet(res.text)}`, res.status);
        }
        lastNote = `answered ${res.status}`;
        lastStatus = res.status;
        const asked = retryAfterMs(res.headers);
        if (asked !== null) wait = Math.min(config.maxWaitMs, asked);
      }
      throw new VendorUnavailable(VENDOR, route.label, `gave up after ${config.maxAttempts} attempts: ${lastNote}`, lastStatus);
  };

  /** A 2xx body as JSON. Not JSON at all is a broken transport, not an answer. */
  const asJson = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      /* Thrown, so the meter charges the estimate rather than recording a call that cost nothing. */
      throw new VendorShapeError(VENDOR, 'body', `is not JSON: ${snippet(text)}`);
    }
  };

  /** POST one body to the Messages API, with the policy's retries, and return the parsed reply. */
  const send = async (payload: Record<string, unknown>): Promise<unknown> =>
    asJson(await exchange({ method: 'POST', path: MESSAGES_PATH, label: MESSAGES_ENDPOINT, retryLost: true }, payload));

  /**
   * Several judge requests as ONE Message Batch: created, polled until it ends, its results
   * read and matched back by custom id (never by position — results come in any order).
   *
   * ★ ONCE THE BATCH EXISTS, EVERY FAILURE IS "MAYBE BILLED". A create the vendor refused with
   * a status made nothing and is thrown with that status ($0 above this file). Anything after
   * a successful create — a poll or a result read that fails — is rethrown WITHOUT a status,
   * so the meter charges the estimate: the batch is running and will be billed whether or not
   * we hear back. A batch still running at `batchMaxWaitMs` is cancelled and what finished is
   * kept; a request that errored, was cancelled or expired is not billed and is no answer.
   */
  const judgeBatch = async (requests: readonly JudgeRequest[]): Promise<readonly BatchAnswer[]> => {
    if (requests.length === 0) return [];
    const created = asJson(
      await exchange(
        { method: 'POST', path: BATCHES_PATH, label: BATCHES_ENDPOINT, retryLost: false },
        { requests: requests.map((r, i) => ({ custom_id: `r${i}`, params: buildRequestBody(config, r) })) },
      ),
    ) as Record<string, unknown> | null;
    const id = created?.['id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new VendorUnavailable(VENDOR, BATCHES_ENDPOINT, `created a batch with no usable id: ${snippet(JSON.stringify(created))}`);
    }
    const at = `${BATCHES_PATH}/${id}`;
    try {
      const pollMs = config.batchPollMs ?? BATCH_POLL_MS;
      const polls = Math.max(1, Math.ceil((config.batchMaxWaitMs ?? BATCH_MAX_WAIT_MS) / pollMs));
      const status = async (): Promise<unknown> =>
        (asJson(await exchange({ method: 'GET', path: at, label: BATCHES_ENDPOINT, retryLost: true })) as Record<string, unknown> | null)?.['processing_status'];
      let ended = (created?.['processing_status'] ?? null) === 'ended';
      for (let n = 0; n < polls && !ended; n += 1) {
        await config.sleep(pollMs);
        ended = (await status()) === 'ended';
      }
      if (!ended) {
        await exchange({ method: 'POST', path: `${at}/cancel`, label: BATCHES_ENDPOINT, retryLost: true });
        for (let n = 0; n < polls && !ended; n += 1) {
          await config.sleep(pollMs);
          ended = (await status()) === 'ended';
        }
        if (!ended) throw new Error(`batch ${id} did not end after it was cancelled`);
      }
      const byId = new Map<string, BatchAnswer>();
      const text = await exchange({ method: 'GET', path: `${at}/results`, label: BATCHES_ENDPOINT, retryLost: true });
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        const row = asJson(line) as Record<string, unknown> | null;
        const result = (row?.['result'] ?? {}) as Record<string, unknown>;
        const customId = row?.['custom_id'];
        if (typeof customId !== 'string') continue;
        byId.set(
          customId,
          result['type'] === 'succeeded'
            ? { kind: 'answered', response: decodeReply(result['message']) }
            : { kind: 'failed', note: `batch request ${String(result['type'])}: ${snippet(JSON.stringify(result['error'] ?? null))}` },
        );
      }
      return requests.map((_, i) => byId.get(`r${i}`) ?? { kind: 'failed', note: 'batch returned no result for this request' });
    } catch (error) {
      throw new VendorUnavailable(VENDOR, BATCHES_ENDPOINT, `batch ${id} was created but not read back, and may be billed: ${messageOf(error)}`);
    }
  };

  /**
   * One picture read and checked, or null when there is no usable image at `uri`. `sized` is
   * an address pictures.ts built from one that already passed the check below, and differs
   * from it only by the size query it added — so it is let through with that query.
   */
  const readFrame = async (uri: string, sized = false): Promise<Frame | null> => {
    if (!sized && pictureUrlProblem(uri) !== null) return null;
    try {
      const response = await config.fetch(uri, { signal: AbortSignal.timeout(config.timeoutMs) });
      const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!response.ok || !FRAME_TYPES.has(type as Frame['mediaType'])) {
        await response.body?.cancel();
        return null;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > config.maxFrameBytes) return null;
      return { mediaType: type as Frame['mediaType'], base64: Buffer.from(bytes).toString('base64') };
    } catch {
      return null;
    }
  };

  return {
    async judge(request) {
      return decodeReply(await send(buildRequestBody(config, request)));
    },

    judgeBatch,

    async sameSubject(request) {
      const parsed = await send({
        model: config.model,
        max_tokens: request.maxOutputTokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: request.a.mediaType, data: request.a.base64 } },
              { type: 'image', source: { type: 'base64', media_type: request.b.mediaType, data: request.b.base64 } },
              { type: 'text', text: request.prompt },
            ],
          },
        ],
        output_config: {
          format: { type: 'json_schema', schema: SAME_SUBJECT_SCHEMA },
          ...(config.effort === null ? {} : { effort: config.effort }),
        },
      });
      return decodeSameSubject(parsed);
    },

    async frame(uri) {
      const size = config.pictureSize ?? null;
      if (size !== null) {
        const smaller = sizedPictureUri(uri, size);
        if (smaller !== uri && pictureUrlProblem(uri) === null) {
          const small = await readFrame(smaller, true);
          if (small !== null) return small;
        }
      }
      return readFrame(uri);
    },
  };
}
