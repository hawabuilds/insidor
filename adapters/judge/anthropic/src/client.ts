/**
 * THE HTTP SURFACE, AND NOTHING ELSE: one structured-output call to the Messages API, and
 * the fetch of a video frame to show it.
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
 *    per batch however many attempts it took.
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

export const VENDOR = 'anthropic';
export const MESSAGES_ENDPOINT = 'POST /v1/messages';
const MESSAGES_PATH = '/v1/messages';
export const API_VERSION = '2023-06-01';

/** Token counts as the vendor reports them. Cost is computed from these. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
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

export interface JudgeClient {
  judge(request: JudgeRequest): Promise<JudgeResponse>;
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
    { type: 'text', text: request.instructions },
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
    system: request.system,
    messages: [{ role: 'user', content }],
    output_config: {
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
      ...(config.effort === null ? {} : { effort: config.effort }),
    },
  };
}

/* ── the reply, as a pure function ────────────────────────────────────── */

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * The answers and the usage out of a reply body.
 *
 * Usage is read whatever else is wrong, because the tokens were billed whatever else is
 * wrong. Anything short of a complete JSON answer — a refusal, a reply cut off at
 * `max_tokens`, text that does not parse, an `answers` that is not a list — is no answers.
 */
export function decodeReply(body: unknown): JudgeResponse {
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const u = (typeof r['usage'] === 'object' && r['usage'] !== null ? r['usage'] : {}) as Record<string, unknown>;
  const usage: Usage = { inputTokens: count(u['input_tokens']), outputTokens: count(u['output_tokens']) };

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
  const u = (typeof r['usage'] === 'object' && r['usage'] !== null ? r['usage'] : {}) as Record<string, unknown>;
  const usage: Usage = { inputTokens: count(u['input_tokens']), outputTokens: count(u['output_tokens']) };
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
  const url = `${trimTrailingSlash(config.baseUrl)}${MESSAGES_PATH}`;

  /** One attempt. Returns the status and body, or throws for a transport failure. */
  const attempt = async (body: string): Promise<{ status: number; headers: Headers; text: string }> => {
    const response = await config.fetch(url, {
      method: 'POST',
      // The key goes in a header and nowhere else: a keyed URL ends up in a proxy log.
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': API_VERSION, 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    // Always drained, even on a status we are about to reject, so the socket is freed.
    return { status: response.status, headers: response.headers, text: await response.text() };
  };

  /** POST one body, with the policy's retries, and return the parsed reply. */
  const send = async (payload: Record<string, unknown>): Promise<unknown> => {
      const body = JSON.stringify(payload);
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
          res = await attempt(body);
        } catch (error) {
          lastNote = `request failed: ${messageOf(error)}`;
          lastStatus = undefined;
          continue;
        }
        if (res.status >= 200 && res.status < 300) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(res.text);
          } catch {
            /* Not JSON at all is a broken transport, not an answer. Thrown, so the meter
               charges the estimate rather than recording a call that cost nothing. */
            throw new VendorShapeError(VENDOR, 'body', `is not JSON: ${snippet(res.text)}`);
          }
          return parsed;
        }
        if (!RETRYABLE.has(res.status)) {
          throw new VendorUnavailable(VENDOR, MESSAGES_ENDPOINT, `answered ${res.status}: ${snippet(res.text)}`, res.status);
        }
        lastNote = `answered ${res.status}`;
        lastStatus = res.status;
        const asked = retryAfterMs(res.headers);
        if (asked !== null) wait = Math.min(config.maxWaitMs, asked);
      }
      throw new VendorUnavailable(VENDOR, MESSAGES_ENDPOINT, `gave up after ${config.maxAttempts} attempts: ${lastNote}`, lastStatus);
  };

  return {
    async judge(request) {
      return decodeReply(await send(buildRequestBody(config, request)));
    },

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
      if (httpUrlProblem(uri) !== null) return null;
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
    },
  };
}
