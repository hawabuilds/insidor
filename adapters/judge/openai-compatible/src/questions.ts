/**
 * THE OPEN MODEL'S OTHER QUESTIONS: the coin names a post will be launched as, a post's words in
 * English, and whether two pictures show the same subject — the namer, the translator and the
 * same-subject question the main judge's adapter asks, asked of the open model instead (the owner,
 * 2026-10-16: "no Anthropic API at all from now on").
 *
 * Its own file, apart from index.ts (the feed's judging questions) and client.ts (the transport),
 * because these three are not judgements: each has its own answer shape, its own ledger endpoint
 * and its own port (contracts ports/names.ts, ports/translate.ts, ports/judge.ts `sameSubject`).
 *
 * ★ THE MAIN ADAPTER'S WORDS, NEVER A COPY. Each request is the main adapter's own body
 * (`nameRequestBody`, `translateRequestBody`, the same-subject prompt file) re-wrapped in the chat
 * format by `chatBodyFromMessages`: the system blocks as one system message, each text block as a
 * text part, each picture as a data-URL `image_url` part (the same bytes; a signed address another
 * host may not be allowed to read), the forced JSON schema as `response_format`. The reply is put
 * back into the main adapter's reply shape and read by ITS decoder, so "an answer" means the same
 * for both models, and the prompt hashes — and so the stored prompt ids — are the same. A stored
 * guess or translation says which model wrote it by its `model`, never by its prompt id.
 *
 * ★ PRICED BEFORE, BOOKED AFTER, as index.ts books a judging call: a pessimistic estimate (every
 * character at the judge policy's characters per token, every picture at its tokens per frame,
 * the whole answer budget) at the host's listed prices times ESTIMATE_MARGIN, checked against the
 * meter before the request leaves; afterwards the host's own dollar figure, or its token counts at
 * the listed prices. An error the host answered with a status is booked at $0.
 *
 * ★ A FAILED CALL SAYS SO, in the way the runner's failover reads it: names and translations come
 * back `absent` for every post in the call (with the reason); the same-subject question THROWS the
 * host's error after booking it, because its `null` already means "no usable answer" (an unreadable
 * picture, a garbled reply) and a caller must be able to tell "the host is down" from that.
 *
 * ★ A MODEL THAT CANNOT READ PICTURES is sent none: the namer asks on the words alone, and the
 * same-subject question — which is only pictures — answers null without a call.
 *
 * What breaks if changed carelessly: the refs. Posts go as `P1`, `P2`… (the main adapter's body)
 * and answers are matched back by them, never by position.
 */

import type { Millis } from '@insidor/contracts';
import type { JudgePolicy, NamesPolicy, TranslatePolicy } from '@insidor/contracts/policy.ts';
import type { Budget, CostEstimate, Meter, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import type { SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';
import type { NameOutcome, NamePort, NameSubject } from '@insidor/contracts/ports/names.ts';
import type { TranslateOutcome, TranslatePort, TranslateSubject } from '@insidor/contracts/ports/translate.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import type { Frame } from '@insidor/judge-anthropic';
import { SAME_SUBJECT_SCHEMA, decodeSameSubject } from '@insidor/judge-anthropic/client.ts';
import { NAME_INSTRUCTIONS, NAME_PROMPT_SHA, NAME_SYSTEM, decodeNames, namePosts, nameRequestBody } from '@insidor/judge-anthropic/name-guess.ts';
import { SAME_SUBJECT_PROMPT } from '@insidor/judge-anthropic/prompts.ts';
import { TRANSLATE_PROMPT_SHA, decodeTranslations, outcomeOf, translateRequestBody } from '@insidor/judge-anthropic/translate.ts';
import { mergeSpend, metered, type PriceBook } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';

import { routerFields, unfenced } from './client.ts';
import type { HostModel } from './models.ts';

/** The ledger's endpoints, the main adapter's names for the same questions. */
export const OPEN_NAMES_ENDPOINT = 'names';
export const OPEN_TRANSLATE_ENDPOINT = 'translate';
export const OPEN_PAIR_ENDPOINT = 'same-subject';
/** As index.ts: an open model may count a picture as more tokens than the policy's figure. */
const MARGIN = 2;

/** What these questions need of the client: one chat call with its retries, and a picture read. */
export interface OpenAsk {
  send(payload: Record<string, unknown>): Promise<unknown>;
  frame(uri: string): Promise<Frame | null>;
}

export interface OpenQuestionDeps {
  readonly client: OpenAsk;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** The host's model, from its model list: the id, whether it reads pictures, its prices. */
  readonly model: HostModel;
  readonly vendor: string;
  /** The router's providers, in order, and no others; empty: the router chooses (client.ts). */
  readonly providers: readonly string[];
  /** False: a host of its own, sent no router-only fields (client.ts `routerFields`). Absent: the router. */
  readonly router?: boolean;
  readonly judge: Pick<JudgePolicy, 'charsPerToken' | 'tokensPerFrame' | 'pairMaxOutputTokens'>;
}

/* ── the request and the reply, as pure functions ─────────────────────── */

type Part = Record<string, unknown>;

/**
 * A Messages-API body (the main adapter's) as a chat body for `model`: system blocks joined into
 * one system message, text parts kept, pictures as data URLs (left out for a text-only model), the
 * output schema as `response_format`, temperature 0, the providers pinned as client.ts pins them.
 */
export function chatBodyFromMessages(body: Record<string, unknown>, to: { readonly model: string; readonly vision: boolean; readonly providers: readonly string[]; readonly router?: boolean | undefined; readonly schemaName: string }): Record<string, unknown> {
  const system = (Array.isArray(body['system']) ? (body['system'] as Part[]) : [])
    .map((b) => (typeof b['text'] === 'string' ? b['text'] : ''))
    .join('\n\n');
  const messages = (Array.isArray(body['messages']) ? (body['messages'] as Part[]) : []).map((m) => ({
    role: m['role'],
    content: (Array.isArray(m['content']) ? (m['content'] as Part[]) : []).flatMap((p): Part[] => {
      if (p['type'] === 'text') return [{ type: 'text', text: p['text'] }];
      const src = (p['source'] ?? {}) as Part;
      if (p['type'] === 'image' && to.vision) return [{ type: 'image_url', image_url: { url: `data:${String(src['media_type'])};base64,${String(src['data'])}` } }];
      return [];
    }),
  }));
  const schema = ((body['output_config'] ?? {}) as Part)['format'] as Part | undefined;
  return {
    model: to.model,
    max_tokens: body['max_tokens'],
    temperature: 0,
    messages: [...(system === '' ? [] : [{ role: 'system', content: system }]), ...messages],
    ...(schema?.['schema'] === undefined ? {} : { response_format: { type: 'json_schema', json_schema: { name: to.schemaName, strict: true, schema: schema['schema'] } } }),
    ...routerFields(to.router, to.providers),
  };
}

/**
 * A chat reply in the Messages-API reply shape the main adapter's decoders read: a normal stop
 * (`stop`) is its `end_turn`, anything else is not; a reply in one code fence is unwrapped. With
 * the host's own dollar figure for the call, or null.
 */
export function messagesReplyOf(body: unknown): { readonly reply: Record<string, unknown>; readonly costUsd: number | null; readonly inputTokens: number; readonly outputTokens: number } {
  const r = (typeof body === 'object' && body !== null ? body : {}) as Part;
  const u = (typeof r['usage'] === 'object' && r['usage'] !== null ? r['usage'] : {}) as Part;
  const choice = (Array.isArray(r['choices']) ? r['choices'][0] : null) as Part | null | undefined;
  const raw = ((choice?.['message'] ?? {}) as Part)['content'];
  const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw as Part[]).map((p) => (typeof p?.['text'] === 'string' ? p['text'] : '')).join('') : '';
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const cost = u['cost'];
  return {
    reply: {
      stop_reason: choice?.['finish_reason'] === 'stop' ? 'end_turn' : String(choice?.['finish_reason'] ?? 'none'),
      content: [{ type: 'text', text: unfenced(String(text)) }],
      usage: { input_tokens: n(u['prompt_tokens']), output_tokens: n(u['completion_tokens']) },
    },
    costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
    inputTokens: n(u['prompt_tokens']),
    outputTokens: n(u['completion_tokens']),
  };
}

/* ── shared plumbing ──────────────────────────────────────────────────── */

function pricing(deps: OpenQuestionDeps) {
  const inP = deps.model.usdPerInputToken;
  const outP = deps.model.usdPerOutputToken;
  if (inP === null || outP === null) throw new RangeError(`open questions: the host lists no price for ${deps.model.id}, and an unpriced call is refused`);
  const usd = (input: number, output: number): number => input * inP + output * outP;
  return {
    /** Every character at charsPerToken, a picture at tokensPerFrame, the whole answer budget, times the margin. */
    estimate: (chars: number, pictures: number, maxOut: number): number => usd(Math.ceil(chars / deps.judge.charsPerToken) + pictures * deps.judge.tokensPerFrame, maxOut) * MARGIN,
    actual: (r: ReturnType<typeof messagesReplyOf>): number => r.costUsd ?? usd(r.inputTokens, r.outputTokens),
  };
}

const bookFor = (vendor: string, endpoint: string, usd: number, unitName: string): PriceBook => ({
  [`${vendor}:${endpoint}`]: { vendor, endpoint, unit: 'per-call', usdPerUnit: usd, unitName, measuredAt: 'estimated per call from the host model list prices' },
});

/** One metered chat call: the parsed reply, or null with the host's error when it answered with a status ($0). */
type Asked = { readonly reply: ReturnType<typeof messagesReplyOf> | null; readonly refused: VendorUnavailable | null };
async function ask(deps: OpenQuestionDeps, endpoint: string, unitName: string, usd: number, at: Millis, payload: Record<string, unknown>): Promise<Metered<Asked>> {
  const p = pricing(deps);
  const spec = { vendor: deps.vendor, endpoint, unit: 'per-call' as const, estUnits: 1, at };
  return metered<Asked>(deps.meter, bookFor(deps.vendor, endpoint, usd, unitName), spec, async () => {
    try {
      const reply = messagesReplyOf(await deps.client.send(payload));
      return { value: { reply, refused: null }, units: 1, usdActual: p.actual(reply) };
    } catch (error) {
      if (error instanceof VendorUnavailable && error.status !== undefined) return { value: { reply: null, refused: error }, units: 0, usdActual: 0 };
      throw error;
    }
  });
}

/* ── the namer ────────────────────────────────────────────────────────── */

/**
 * A guess's name as the model wrote it, without a ticker it copied after it from the examples'
 * "Name ($TICKER)" format — the ticker is its own field, and the card would show it twice.
 */
export const bareName = (name: string): string => name.replace(/\s*\(\s*\$[A-Za-z0-9]+\s*\)\s*$/u, '').trim();

/**
 * ★ ONE POST A CALL BY DEFAULT (`names.openPerCall`): the open model asked about ten posts with
 * their pictures answers the first one or two and stops (measured, see NamesPolicy).
 */
export function openNamer(deps: OpenQuestionDeps & { readonly names: Pick<NamesPolicy, 'openPerCall' | 'openParallel' | 'maxOutputTokens'> }): NamePort {
  const p = pricing(deps);
  return {
    id: `names:${deps.vendor}/${deps.model.id}@${NAME_PROMPT_SHA}`,
    promptId: `names@${NAME_PROMPT_SHA}`,
    model: deps.model.id,

    async guess(subjects: readonly NameSubject[], _budget: Budget): Promise<Metered<readonly NameOutcome[]>> {
      const at = deps.now();
      const spec = { vendor: deps.vendor, endpoint: OPEN_NAMES_ENDPOINT, unit: 'per-call' as const, estUnits: 1, at };
      const outcomes = new Map<string, NameOutcome>();
      const spends: Spend[] = [];
      const per = Math.max(1, deps.names.openPerCall);
      const batches: NameSubject[][] = [];
      for (let i = 0; i < subjects.length; i += per) batches.push(subjects.slice(i, i + per));
      const one = async (batch: readonly NameSubject[]): Promise<void> => {
        /* Pictures first, before any money moves; one that cannot be read leaves the post on its words. */
        const frames = new Map<string, Frame>();
        if (deps.model.vision) {
          await Promise.all(batch.map(async (s) => {
            if (s.picture === null) return;
            const f = await deps.client.frame(s.picture).catch(() => null);
            if (f !== null) frames.set(s.ref, f);
          }));
        }
        const chars = NAME_SYSTEM.length + NAME_INSTRUCTIONS.length + JSON.stringify(namePosts(batch, new Set())).length;
        const body = chatBodyFromMessages(nameRequestBody(deps.model.id, deps.names.maxOutputTokens, null, batch, frames), { model: deps.model.id, vision: deps.model.vision, providers: deps.providers, router: deps.router, schemaName: 'name_guesses' });
        try {
          const call = await ask(deps, OPEN_NAMES_ENDPOINT, 'batched names call', p.estimate(chars, frames.size, deps.names.maxOutputTokens), at, body);
          spends.push(call.spend);
          const byRef = call.value.reply === null ? null : decodeNames(call.value.reply.reply).byRef;
          batch.forEach((s, j) => {
            const a = byRef?.get(`P${j + 1}`);
            outcomes.set(s.ref, a === undefined || a.guesses.length === 0
              ? { kind: 'absent', ref: s.ref, detail: byRef === null ? (call.value.refused?.message ?? 'the host refused the call') : 'no usable answer for this post' }
              : { kind: 'guessed', ref: s.ref, guesses: a.guesses.map((g) => ({ name: bareName(g.name), ticker: g.ticker })), seen: a.seen.trim() === '' ? null : a.seen.trim() });
          });
        } catch (error) {
          if (error instanceof BudgetRefused) throw error;
          for (const s of batch) outcomes.set(s.ref, { kind: 'absent', ref: s.ref, detail: error instanceof Error ? error.message : String(error) });
        }
      };
      /* `openParallel` calls at once, each taking the next batch: one post a call would otherwise
         make a pass of forty posts take minutes. A budget refusal stops the rest and is rethrown. */
      let next = 0;
      let refused: unknown = null;
      const worker = async (): Promise<void> => {
        while (refused === null && next < batches.length) {
          const b = batches[next];
          next += 1;
          if (b === undefined) return;
          try {
            await one(b);
          } catch (error) {
            refused = error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(deps.names.openParallel, batches.length)) }, worker));
      if (refused !== null) throw refused;
      return { value: subjects.map((s) => outcomes.get(s.ref) ?? { kind: 'absent', ref: s.ref, detail: 'no outcome' }), spend: mergeSpend(spends, spec, 'per-call') };
    },
  };
}

/* ── the translator ───────────────────────────────────────────────────── */

const squashed = (t: string): string => t.replace(/\s+/gu, ' ').trim().toLowerCase();

/**
 * A "translation" that is the post's own words back is not one: kept, with the language the model
 * read. Measured 2026-10-16: the open model "translated" a German hashtag line and "Eu/acc" into
 * themselves, where the main model said there was nothing to translate; shown, the card would say
 * "Translated from German" over the words as written.
 */
export function unchanged(words: string, o: TranslateOutcome): TranslateOutcome {
  return o.kind === 'translated' && squashed(o.text) === squashed(words) ? { kind: 'kept', ref: o.ref, from: o.from } : o;
}

export function openTranslator(deps: OpenQuestionDeps & { readonly translate: Pick<TranslatePolicy, 'perCall' | 'maxOutputTokens'> }): TranslatePort {
  const p = pricing(deps);
  return {
    id: `translate:${deps.vendor}/${deps.model.id}@${TRANSLATE_PROMPT_SHA}`,
    promptId: `translate@${TRANSLATE_PROMPT_SHA}`,
    model: deps.model.id,

    async translate(subjects: readonly TranslateSubject[], _budget: Budget): Promise<Metered<readonly TranslateOutcome[]>> {
      const at = deps.now();
      const spec = { vendor: deps.vendor, endpoint: OPEN_TRANSLATE_ENDPOINT, unit: 'per-call' as const, estUnits: 1, at };
      const outcomes = new Map<string, TranslateOutcome>();
      const spends: Spend[] = [];
      for (let i = 0; i < subjects.length; i += deps.translate.perCall) {
        const batch = subjects.slice(i, i + deps.translate.perCall);
        const messages = translateRequestBody(deps.translate.maxOutputTokens, batch);
        const body = chatBodyFromMessages(messages, { model: deps.model.id, vision: false, providers: deps.providers, router: deps.router, schemaName: 'translations' });
        try {
          const call = await ask(deps, OPEN_TRANSLATE_ENDPOINT, 'batched translate call', p.estimate(JSON.stringify(messages).length, 0, deps.translate.maxOutputTokens), at, body);
          spends.push(call.spend);
          const reply = call.value.reply;
          batch.forEach((s, j) => {
            outcomes.set(s.ref, reply === null ? { kind: 'absent', ref: s.ref, detail: call.value.refused?.message ?? 'the host refused the call' } : unchanged(s.text, outcomeOf(s.ref, decodeTranslations(reply.reply).byRef.get(`P${j + 1}`))));
          });
        } catch (error) {
          if (error instanceof BudgetRefused) throw error;
          for (const s of batch) outcomes.set(s.ref, { kind: 'absent', ref: s.ref, detail: error instanceof Error ? error.message : String(error) });
        }
      }
      return { value: subjects.map((s) => outcomes.get(s.ref) ?? { kind: 'absent', ref: s.ref, detail: 'no outcome' }), spend: mergeSpend(spends, spec, 'per-call') };
    },
  };
}

/* ── the same-subject question ────────────────────────────────────────── */

/** The same-subject part of a judge port (contracts ports/judge.ts), for the open model. */
export interface OpenSameSubject {
  readonly id: string;
  readonly sameSubjectPromptId: string;
  estimateSameSubject(): CostEstimate;
  sameSubject(a: MediaRef, b: MediaRef, budget: Budget): Promise<Metered<SameSubjectAnswer | null>>;
}

export function openSameSubject(deps: OpenQuestionDeps): OpenSameSubject {
  const p = pricing(deps);
  const estimateUsd = (): number => p.estimate(SAME_SUBJECT_PROMPT.text.length, 2, deps.judge.pairMaxOutputTokens);
  return {
    id: `judge:${deps.vendor}/${deps.model.id}@same-subject-${SAME_SUBJECT_PROMPT.sha}`,
    /* The main judge's id for the same words: a pair already answered is not asked again. */
    sameSubjectPromptId: `same-subject@${SAME_SUBJECT_PROMPT.sha}`,
    estimateSameSubject: () => ({ vendor: deps.vendor, endpoint: OPEN_PAIR_ENDPOINT, unit: 'per-call', estUnits: 1, usd: estimateUsd() }),

    /**
     * Both pictures read first, before any money moves: a pair with an unreadable picture, or a
     * model that reads none, comes back null with no call. A host error is booked ($0 when it
     * answered with a status) and then THROWN (see the header).
     */
    async sameSubject(a, b, _budget) {
      const at = deps.now();
      const nothing = { value: null, spend: mergeSpend([], { vendor: deps.vendor, endpoint: OPEN_PAIR_ENDPOINT, unit: 'per-call', estUnits: 1, at }, 'per-call') };
      if (!deps.model.vision || a.kind !== 'image' || b.kind !== 'image') return nothing;
      const [fa, fb] = [await deps.client.frame(a.uri), await deps.client.frame(b.uri)];
      if (fa === null || fb === null) return nothing;
      const messages = {
        max_tokens: deps.judge.pairMaxOutputTokens,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: fa.mediaType, data: fa.base64 } },
          { type: 'image', source: { type: 'base64', media_type: fb.mediaType, data: fb.base64 } },
          { type: 'text', text: SAME_SUBJECT_PROMPT.text },
        ] }],
        output_config: { format: { type: 'json_schema', schema: SAME_SUBJECT_SCHEMA } },
      };
      const body = chatBodyFromMessages(messages, { model: deps.model.id, vision: true, providers: deps.providers, router: deps.router, schemaName: 'same_subject' });
      const call = await ask(deps, OPEN_PAIR_ENDPOINT, 'same-subject question', estimateUsd(), at, body);
      if (call.value.reply === null) throw call.value.refused ?? new Error('same-subject: no reply and no error');
      return { value: decodeSameSubject(call.value.reply.reply).answer, spend: call.spend };
    },
  };
}
