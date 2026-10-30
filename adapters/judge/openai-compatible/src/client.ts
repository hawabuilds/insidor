/**
 * THE HTTP SURFACE OF AN OPEN-MODEL JUDGE: one chat-completions call on any host that speaks the
 * OpenAI-compatible API (by default the model router at openrouter.ai), and the read of a post's
 * picture to show it. Used by the tests of other models as the judge and, since 2026-10-16, by the
 * runner's feed judge as its fallback, its shadow, or its primary (Policy.judge.primary).
 *
 * ★ THE SAME QUESTION AS THE LIVE JUDGE, BYTE FOR BYTE. The request is built from the very
 * `JudgeRequest` the Anthropic adapter builds its body from — the same prompt files, the same
 * precedents list (its `precedentsOf`), the same stories JSON, the same "Picture for storyId"
 * lines, in the same order — only re-wrapped in the chat format: the system prompt as a system
 * message, each block as a text part, each picture as an `image_url` part. The picture is the
 * same bytes the live judge sends, as a data URL: the short-video source's covers are signed
 * addresses another host's fetcher may not be allowed to read, and "the model could not load the
 * picture" must not be measured as "the model said no". The answer shape is forced with the same
 * JSON schema (ANSWER_SCHEMA) through `response_format`, and only hosts that honour it are used
 * (`provider.require_parameters`), so no extra words about the format are added to the prompt.
 *
 * ★ THE SAME PARSER. The reply is put into the Anthropic reply's shape and read by that adapter's
 * own `decodeReply`, so "an answer" means exactly the same thing for both: a complete JSON
 * `answers` list after a normal stop, or nothing. The one thing done first: a reply wrapped in a
 * markdown code fence has the fence taken off — the JSON inside is still parsed whole or not at
 * all; nothing half-parsed is salvaged.
 *
 * ★ A MODEL THAT CANNOT READ PICTURES (`vision: false`) is sent no pictures and every story says
 * `frame: none`; index.ts then grades it as text and the run says `text-only`.
 *
 * ★ WHAT A CALL COST is the host's own figure (`usage.cost`, in dollars) when it gives one, and
 * otherwise null — the caller prices the tokens. Retries follow the live judge's rule: 429 and
 * 5xx are retried with the policy's backoff, any other status is not, a 402 or a credit message
 * is out of credit. A host may also answer 200 with an `error` object (the model behind it
 * failed): that is a vendor failure with that code, never an empty answer.
 *
 * `fetch` is injected, never read off `globalThis`, so a test cannot reach the network. The key
 * goes in the Authorization header and nowhere else, and is never in an error message.
 *
 * ★ WHICH OF THE ROUTER'S PROVIDERS ANSWERS IS NOT A DETAIL (measured 2026-10-16). The same model,
 * the same request at temperature 0: on some providers it closes the answer in ~120 tokens; on
 * others it repeats alternate names or pads whitespace inside the forced JSON until the token
 * limit, so the call is billed and every post comes back unanswered. With the learned block in the
 * prompt, 3 of 3 calls looped on Parasail, 2 of 2 on Nebius and 1 of 1 on DeepInfra (whose other
 * two asks were rate-limited), and 3 of 3 answered cleanly on NextBit (until its shared pool was
 * rate-limited). `providers` pins the order and turns the router's own fallback off. Capping the
 * names list in the schema did not help (the model then loops on whitespace), nor did a frequency
 * penalty; without the schema the model ignores the answer's shape. Later that evening, with the
 * open judge answering the live feed, the first provider's failures were hangs past the timeout and
 * minutes of 429s: a retry now starts at the NEXT pinned provider (`rotated`), and the answer budget
 * can be sized to the batch (`answerTokensPerSubject`) so a loop ends sooner.
 *
 * ★ THE ANSWER CAP IS CHECKED HERE, NOT TRUSTED (`answerCapProblem`): a body without `max_tokens`,
 * or with one above the client's budget, is refused before it is sent. An answer that reaches the
 * cap stops with `length` and is no answer at all (the parser above), so its posts are re-asked or
 * left unavailable, never filed as a verdict.
 *
 * What breaks if changed carelessly: anything added to or reworded in the content parts changes
 * the question, and the comparison with the live judge stops being one.
 */

import { VendorShapeError, VendorUnavailable, outOfCredit, vendorAnswered } from '@insidor/vendor-kit';
import { headerValueProblem, httpUrlProblem, messageOf, snippet, trimTrailingSlash } from '@insidor/vendor-kit/http.ts';
import { ANSWER_SCHEMA, decodeReply, precedentsOf, sharedField, sizedPictureUri, type Frame, type JudgeClient, type JudgeRequest, type JudgeResponse, type PictureSize } from '@insidor/judge-anthropic';

export const DEFAULT_VENDOR = 'openrouter';
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const CHAT_PATH = '/chat/completions';
export const CHAT_ENDPOINT = 'POST /chat/completions';

export interface OpenChatConfig {
  /** The name the meter and every error carry. */
  readonly vendor: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  /** The host's model id, as its model list spells it. */
  readonly model: string;
  /** False: no picture is ever sent (the model takes text only). */
  readonly vision: boolean;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly maxWaitMs: number;
  readonly maxFrameBytes: number;
  /** As the live judge: ask the picture host for this size first (the Anthropic adapter's pictures.ts). */
  readonly pictureSize?: PictureSize | null;
  /**
   * Send a picture on a public host (`LINKABLE_HOSTS`) as its address instead of its bytes (2026-10-30):
   * the runner uploaded ~13 GB a day of pictures to the model host, most of its 708 GB of Railway egress
   * (~$35 of a $77 bill). The host fetches the same public picture itself. A signed or private address
   * is still sent as bytes — another host may not be allowed to read it. Absent or false: bytes, as before.
   */
  readonly linkPictures?: boolean;
  /**
   * The router's providers for the model, in order, and no others; absent or empty: the router
   * chooses. See the header: some providers loop on this schema until the token limit.
   */
  readonly providers?: readonly string[] | null;
  /**
   * The answer budget per post asked, one post's worth spare; capped at `maxOutputTokens`. Absent
   * or null: `maxOutputTokens` whatever the batch. A model that loops runs to this limit, so a
   * budget sized to the batch ends a runaway answer in a third of the time (index.ts asks those
   * posts again).
   */
  readonly answerTokensPerSubject?: number | null;
  /** False: a host of its own, sent no router-only fields (`provider`, `usage`). Absent: the router. */
  readonly router?: boolean;
  readonly fetch: typeof globalThis.fetch;
  readonly sleep: (ms: number) => Promise<void>;
}

/** A reply, with the host's own dollar figure for it when it gave one. */
export interface OpenJudgeResponse extends JudgeResponse {
  readonly costUsd: number | null;
}

export class OpenJudgeNotConfigured extends Error {
  readonly variable: string;
  constructor(variable: string, note: string) {
    super(`open-model judge is not configured: ${variable} ${note}. The key goes in .env.local, which is gitignored.`);
    this.name = 'OpenJudgeNotConfigured';
    this.variable = variable;
  }
}

/* ── the request, as a pure function ──────────────────────────────────── */

/**
 * The chat body for one judge request: the live body's parts in the live body's order. With
 * `vision` false the pictures are left out and every story says `frame: none`.
 */
/** Hosts whose pictures are public and stable: the model host can fetch them itself. X's image servers only. */
export const LINKABLE_HOSTS: ReadonlySet<string> = new Set(['pbs.twimg.com']);
export const linkable = (uri: string): boolean => {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' && LINKABLE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
};

export function buildChatBody(config: Pick<OpenChatConfig, 'model' | 'maxOutputTokens' | 'vision' | 'providers' | 'answerTokensPerSubject' | 'router'>, request: JudgeRequest): Record<string, unknown> {
  const providers = config.providers ?? [];
  const frames: ReadonlyMap<string, Frame> = config.vision ? request.frames : new Map();
  const shown = precedentsOf(request);
  const stories = request.subjects.map((s) => ({
    storyId: String(s.storyId),
    posts: s.texts,
    distinctAuthors: s.distinctAuthors,
    distinctSources: s.distinctSources,
    frame: frames.has(String(s.storyId)) ? 'shown below' : 'none',
    ...(shown === null ? {} : { labelledLike: (s.precedents ?? []).flatMap((p) => shown.refOf.get(p.ref) ?? []) }),
    ...sharedField(s),
  }));
  const content: unknown[] = [{ type: 'text', text: request.instructions }];
  if (shown !== null) content.push({ type: 'text', text: `${request.precedentsIntro ?? ''}\n${JSON.stringify(shown.list)}` });
  content.push({ type: 'text', text: `Stories to judge, as JSON. Answer once for each storyId.\n${JSON.stringify(stories)}` });
  for (const s of request.subjects) {
    const frame = frames.get(String(s.storyId));
    if (frame === undefined) continue;
    content.push({ type: 'text', text: `Picture for storyId ${String(s.storyId)} (a still picture, or a frame from its video):` });
    content.push({ type: 'image_url', image_url: { url: frame.url ?? `data:${frame.mediaType};base64,${frame.base64}` } });
  }
  const per = config.answerTokensPerSubject ?? null;
  return {
    model: config.model,
    max_tokens: per === null ? config.maxOutputTokens : Math.min(config.maxOutputTokens, per * (request.subjects.length + 1)),
    /* The live judge's setting (the Anthropic adapter's temperatureFor): the same post, the same answer. */
    temperature: 0,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'judge_answers', strict: true, schema: ANSWER_SCHEMA } },
    /* Only hosts that honour the schema and the temperature (and, when named, only those, in that
       order: a provider that is down is an error, which the runner's failover answers, rather than
       a hand-off to one that loops); and the cost of the call in the reply. */
    ...routerFields(config.router, providers, config.model),
  };
}

/**
 * The pinned providers for attempt `n` (0 first): the list started from its n-th entry, the ones
 * before it moved to the end. A retry is asked of the NEXT provider first: on 2026-10-16 the first
 * provider's failures were hangs and rate limits that lasted minutes, so asking it again was the
 * same wait, while the router's own fallback (still on, in this order) only moves on after an error
 * it is shown, never after our timeout.
 */
export function rotated(providers: readonly string[], n: number): readonly string[] {
  if (providers.length < 2) return providers;
  const k = n % providers.length;
  return [...providers.slice(k), ...providers.slice(0, k)];
}

/**
 * The router-only request fields: only hosts that honour the schema and the temperature, the pinned
 * providers in order and no others, and the call's cost in the reply. None for a host of its own
 * (`router: false`), which is sent the plain chat-completions body — a host that does not know a
 * field may refuse the whole request for it — with one field of its own:
 *
 * ★ REASONING OFF ON A HOST OF ITS OWN (Together, measured 2026-10-16). Its serverless vision
 * models think before they answer unless told not to: with the forced answer shape and 300 tokens,
 * Nemotron 3.5 Super VL spent all 300 on `reasoning_content` and returned no answer (cut off), and
 * Qwen3.5-9B the same; with `reasoning: { enabled: false }` each answered the JSON in about 30
 * tokens and half a second. A thinking judge is a judge whose answer budget is spent before it
 * answers. Together accepts the field for a model that does not think (MiniMax M3 answered the same
 * with it).
 */
export function routerFields(router: boolean | undefined, providers: readonly string[], model?: string): Record<string, unknown> {
  if (router === false) return { reasoning: { enabled: false } };
  return {
    provider: providers.length === 0 ? { require_parameters: true } : { require_parameters: true, order: [...providers], allow_fallbacks: false },
    usage: { include: true },
    /* A thinking model on the router is told not to think, as on a host of its own (above): measured
       2026-10-19, Nemotron there spent its whole answer budget reasoning and returned nothing; with
       `reasoning: { enabled: false }` it answered at once. Only for models that think, because the
       router's require_parameters would drop a provider that does not know the field. */
    ...(model !== undefined && THINKING_MODEL.test(model) ? { reasoning: { enabled: false } } : {}),
  };
}

/** Models that reason before answering unless told not to (measured 2026-10-16 and 2026-10-19). */
const THINKING_MODEL = /nemotron|qwen3/i;

/* ── the reply, as a pure function ────────────────────────────────────── */

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** A whole reply wrapped in one markdown code fence, unwrapped; anything else as it is. */
export const unfenced = (text: string): string => {
  const m = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return m === null ? text : (m[1] ?? '');
};

/**
 * The answers, the token counts and the host's dollar figure out of a chat reply, read by the
 * Anthropic adapter's own `decodeReply`: a normal stop (`stop`) is its `end_turn`, anything else
 * (cut off at the token limit, a content filter) is no answers, with the usage, which was billed.
 */
export function decodeChatReply(body: unknown): OpenJudgeResponse {
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const u = (typeof r['usage'] === 'object' && r['usage'] !== null ? r['usage'] : {}) as Record<string, unknown>;
  const choice = (Array.isArray(r['choices']) ? r['choices'][0] : null) as Record<string, unknown> | null | undefined;
  const message = (choice?.['message'] ?? {}) as Record<string, unknown>;
  const raw = message['content'];
  const text = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw.map((p) => (typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>)['text'] === 'string' ? (p as Record<string, unknown>)['text'] : '')).join('')
      : '';
  const decoded = decodeReply({
    stop_reason: choice?.['finish_reason'] === 'stop' ? 'end_turn' : String(choice?.['finish_reason'] ?? 'none'),
    content: [{ type: 'text', text: unfenced(String(text)) }],
    usage: { input_tokens: count(u['prompt_tokens']), output_tokens: count(u['completion_tokens']) },
  });
  const cost = u['cost'];
  return { ...decoded, costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null };
}

/* ── the client ───────────────────────────────────────────────────────── */

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const FRAME_TYPES = new Set<Frame['mediaType']>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * ★ NO CALL LEAVES WITHOUT AN ANSWER CAP, AND NONE ABOVE ITS CLIENT'S (2026-10-20). A body without
 * `max_tokens` lets the host answer up to the model's whole window: a provider that ignores
 * `reasoning: { enabled: false }`, or loops inside the forced JSON (header), would then bill tens of
 * thousands of tokens for one call. Every question built here sets it, but four files build bodies
 * (this one, questions.ts, titles.ts and a tool), so the client checks the one thing they must all
 * agree on before anything is sent: a whole number from 1 to the `maxOutputTokens` the client was
 * built with, which is the policy's number for that question. Why, or null when the body is fine.
 */
export function answerCapProblem(payload: Record<string, unknown>, maxOutputTokens: number): string | null {
  const cap = payload['max_tokens'];
  if (typeof cap !== 'number' || !Number.isInteger(cap)) return 'max_tokens is not set to a whole number';
  if (cap < 1) return `max_tokens is ${cap}`;
  if (cap > maxOutputTokens) return `max_tokens is ${cap}, over this client's ${maxOutputTokens}`;
  return null;
}

/** Out of credit, from the host's own words or a 402; null otherwise. The body is read, never repeated. */
export function billingReason(status: number, text: string): string | null {
  if (status === 402) return 'payment required';
  if (status < 400 || status >= 500 || status === 429) return null;
  /* A key whose own spending limit is reached answers 403 "Key limit exceeded": as empty an account as no credit. */
  return /credit|insufficient (funds|balance)|billing|key limit exceeded/i.test(text.slice(0, 2_000)) ? 'credit or key limit refused' : null;
}

/** A picture's address needs only to be well-formed https: a signed address's query is its permission. */
function pictureUrlProblem(uri: string): string | null {
  try {
    return new URL(uri).protocol === 'https:' ? null : 'not https';
  } catch {
    return 'not a URL';
  }
}

export function openChatClient(config: OpenChatConfig): JudgeClient & { judge(request: JudgeRequest): Promise<OpenJudgeResponse>; send(payload: Record<string, unknown>): Promise<unknown> } {
  const keyProblem = headerValueProblem(config.apiKey);
  if (keyProblem !== null) throw new OpenJudgeNotConfigured('the API key', keyProblem);
  const urlProblem = httpUrlProblem(config.baseUrl);
  if (urlProblem !== null) throw new OpenJudgeNotConfigured('the base URL', urlProblem);
  if (config.model.trim() === '') throw new OpenJudgeNotConfigured('the model', 'is empty');
  if (config.maxAttempts < 1) throw new RangeError('open judge client: maxAttempts must be at least 1');
  const root = trimTrailingSlash(config.baseUrl);
  const V = config.vendor;

  /* Attempt n asks the pinned providers starting from the n-th (see `rotated`). */
  const send = async (payloadFor: (attempt: number) => Record<string, unknown>): Promise<unknown> => {
    let lastNote = 'no attempt was made';
    let lastStatus: number | undefined;
    let wait = 0;
    for (let n = 0; n < config.maxAttempts; n += 1) {
      if (n > 0) await config.sleep(wait);
      wait = Math.min(config.maxWaitMs, config.backoffMs * 2 ** n);
      const payload = payloadFor(n);
      const capProblem = answerCapProblem(payload, config.maxOutputTokens);
      if (capProblem !== null) throw new RangeError(`open judge client: refused before sending: ${capProblem}`);
      let res: { status: number; text: string };
      try {
        const response = await config.fetch(`${root}${CHAT_PATH}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        res = { status: response.status, text: await response.text() };
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
          throw new VendorShapeError(V, 'body', `is not JSON: ${snippet(res.text)}`);
        }
        /* A 200 that carries an error: the model behind the router failed. Its code, when numeric, is the status. */
        const err = (parsed as Record<string, unknown> | null)?.['error'];
        if (typeof err === 'object' && err !== null) {
          const code = (err as Record<string, unknown>)['code'];
          const status = typeof code === 'number' ? code : 502;
          lastNote = `answered with an error: ${snippet(JSON.stringify(err))}`;
          lastStatus = status;
          if (RETRYABLE.has(status)) continue;
          throw new VendorUnavailable(V, CHAT_ENDPOINT, lastNote, status);
        }
        vendorAnswered(V);
        return parsed;
      }
      const billing = billingReason(res.status, res.text);
      if (billing !== null) throw outOfCredit(V, CHAT_ENDPOINT, billing, res.status);
      if (!RETRYABLE.has(res.status)) throw new VendorUnavailable(V, CHAT_ENDPOINT, `answered ${res.status}: ${snippet(res.text)}`, res.status);
      lastNote = `answered ${res.status}`;
      lastStatus = res.status;
    }
    throw new VendorUnavailable(V, CHAT_ENDPOINT, `gave up after ${config.maxAttempts} attempts: ${lastNote}`, lastStatus);
  };

  const readFrame = async (uri: string, sized = false): Promise<Frame | null> => {
    if (!sized && pictureUrlProblem(uri) !== null) return null;
    /* A public picture is checked (status and type, its first bytes only) and sent as its address. */
    if (config.linkPictures === true && linkable(uri)) {
      try {
        const response = await config.fetch(uri, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(config.timeoutMs) });
        const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        await response.body?.cancel();
        if (!response.ok || !FRAME_TYPES.has(type as Frame['mediaType'])) return null;
        return { mediaType: type as Frame['mediaType'], base64: '', url: uri };
      } catch {
        return null;
      }
    }
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
      return decodeChatReply(await send((attempt) => buildChatBody({ ...config, providers: rotated(config.providers ?? [], attempt) }, request)));
    },
    /* One chat body built by another question's file (questions.ts: names, translations, the
       same-subject pictures), with this client's retries and error rules; the parsed reply. */
    send: (payload) => send(() => payload),
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
