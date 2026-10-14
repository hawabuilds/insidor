/**
 * THE TRANSLATOR ON THE CHEAP MODEL: a batch of feed posts' words, back in English with the
 * language each was written in (contracts ports/translate.ts, Policy.translate, 0081).
 *
 * Its own file, apart from prompts.ts and the namer, for the namer's reason: the judge's prompt
 * files are re-tuned twice a day, and a re-tune must never change these words, nor these words
 * the judge's prompt hash. The prompt is here, hashed into `promptId`, so every stored
 * translation names the exact wording that produced it.
 *
 * ★ ALWAYS HAIKU 4.5, WHATEVER JUDGE_MODEL SAYS. Translating a tweet is not a judgement and needs
 * no stronger model; pinning the cheapest one here means a later move of the judge to a dearer
 * model cannot multiply this line's cost unnoticed. Temperature 0, so the same words translate
 * the same way twice.
 *
 * ★ SAME TRANSPORT, SAME LEDGER, ITS OWN ENDPOINT. Sent through the judge client's `send` (its
 * retries, its key) and metered on the judge's vendor line as `translate`, so the day's
 * translations are countable apart from the day's judging and can never spend past the judge's
 * line. Priced before it leaves (every character at the judge's chars-per-token, the whole answer
 * ceiling), booked at the vendor's own token counts; an error the vendor answered with a status
 * is booked at $0, as the judge books it.
 *
 * ★ THE MODEL READS THE LANGUAGE, NOT THE SOURCE'S TAG. The short-video source tags English as
 * Somali often enough that "Translated from Somali" over "Cute haa" would be a false line. The
 * model says `en` for words already English and `zxx` for words with nothing to translate, and
 * those come back `kept`: the card shows the words as written, with no line.
 *
 * What breaks if changed carelessly: the refs. Each post is sent as `P1`, `P2`… and answers are
 * matched back by them, never by position. And the rules about handles, tickers, hashtags and
 * links: a translation that "translated" a $TICKER or a #tag would show a coin name the poster
 * never wrote.
 */

import { createHash } from 'node:crypto';

import type { Millis } from '@insidor/contracts';
import type { JudgePolicy, TranslatePolicy } from '@insidor/contracts/policy.ts';
import type { Budget, Meter, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import type { TranslateOutcome, TranslatePort, TranslateSubject } from '@insidor/contracts/ports/translate.ts';
import { mergeSpend, metered, type PriceBook } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';

import { VENDOR, temperatureFor, usageOf, type JudgeClient, type Usage } from './client.ts';
import { priceFor, usdForTokens } from './prices.ts';

const ENDPOINT = 'translate';

/** The model every translation is asked of (see the header). Must be in prices.ts. */
export const TRANSLATE_MODEL = 'claude-haiku-4-5';

export const TRANSLATE_SYSTEM = `You translate short social media posts into natural English, the way a fluent bilingual reader would say them. You only translate: you never explain, comment, summarise, censor or add anything.`;

export const TRANSLATE_INSTRUCTIONS = `For each post, give the language it is written in and its English translation.

Rules:
- "language": the two-letter ISO 639-1 code of the language most of the post is written in (a three-letter ISO 639-3 code only when there is no two-letter one), lower case. "en" when the post is already mostly English. "zxx" when there is nothing to translate: only names, hashtags, handles, tickers, links, numbers or emoji.
- "english": the whole post in English. "" when "language" is "en" or "zxx".
- Keep every @handle, $ticker, #hashtag, link, emoji and number exactly as written, in the same place. A hashtag stays in its own language even when its words are not English: copy it character for character, never translate it.
- Keep proper names, in Latin letters: a name written in another script is spelled the way English writes it. Keep the tone: slang stays slang, shouting in capitals stays in capitals, laughter like "kkkkk" or "jajaja" becomes "hahaha".
- Keep the line breaks.
- Translate only what is there. No notes, no quotes around it, no "Translation:".
- Answer once for each ref, with JSON only.`;

export const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          language: { type: 'string' },
          english: { type: 'string' },
        },
        required: ['ref', 'language', 'english'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
} as const;

/** The prompt's hash: a wording change files every translation after it under a new id. */
export const TRANSLATE_PROMPT_SHA = createHash('sha256').update(`${TRANSLATE_SYSTEM}\n${TRANSLATE_INSTRUCTIONS}\n${JSON.stringify(TRANSLATE_SCHEMA)}`).digest('hex').slice(0, 8);

export interface TranslatorDeps {
  readonly client: JudgeClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  readonly judge: Pick<JudgePolicy, 'charsPerToken'>;
  readonly translate: Pick<TranslatePolicy, 'perCall' | 'maxOutputTokens'>;
}

/** The request body, built without a socket so a test can read it. */
export function translateRequestBody(maxOutputTokens: number, subjects: readonly TranslateSubject[]): Record<string, unknown> {
  const posts = subjects.map((s, i) => ({ ref: `P${i + 1}`, words: s.text }));
  const effort = priceFor(TRANSLATE_MODEL)?.effort ?? null;
  return {
    model: TRANSLATE_MODEL,
    max_tokens: maxOutputTokens,
    ...temperatureFor({ effort }),
    system: [{ type: 'text', text: TRANSLATE_SYSTEM }],
    messages: [{ role: 'user', content: [
      { type: 'text', text: TRANSLATE_INSTRUCTIONS },
      { type: 'text', text: `Posts, as JSON. Answer once for each ref.\n${JSON.stringify(posts)}` },
    ] }],
    output_config: { format: { type: 'json_schema', schema: TRANSLATE_SCHEMA }, ...(effort === null ? {} : { effort }) },
  };
}

const CODE = /^[a-z]{2,3}$/u;
/* The codes that mean "show the words as written". */
const KEPT = new Set(['en', 'zxx']);

/** The answers by ref out of a reply; empty for anything short of the JSON asked for. */
export function decodeTranslations(body: unknown): { readonly byRef: ReadonlyMap<string, { readonly language: string; readonly english: string }>; readonly usage: Usage } {
  const usage = usageOf(body);
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const byRef = new Map<string, { language: string; english: string }>();
  if (r['stop_reason'] !== 'end_turn') return { byRef, usage };
  const text = (Array.isArray(r['content']) ? r['content'] : [])
    .map((b) => (typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text' ? (b as Record<string, unknown>)['text'] : null))
    .filter((t): t is string => typeof t === 'string')
    .join('');
  try {
    const answers = (JSON.parse(text) as { answers?: unknown } | null)?.answers;
    if (!Array.isArray(answers)) return { byRef, usage };
    for (const a of answers as Record<string, unknown>[]) {
      if (typeof a?.['ref'] !== 'string' || typeof a['language'] !== 'string' || typeof a['english'] !== 'string') continue;
      byRef.set(a['ref'], { language: a['language'].trim().toLowerCase(), english: a['english'].trim() });
    }
  } catch {
    return { byRef: new Map(), usage };
  }
  return { byRef, usage };
}

/** One answer as an outcome: a code we cannot read, or a translation with no words, is no answer. */
export function outcomeOf(ref: string, a: { readonly language: string; readonly english: string } | undefined): TranslateOutcome {
  if (a === undefined || !CODE.test(a.language)) return { kind: 'absent', ref, detail: 'no usable answer for this post' };
  if (KEPT.has(a.language)) return { kind: 'kept', ref, from: a.language };
  if (a.english === '') return { kind: 'absent', ref, detail: `answered ${a.language} with no English` };
  return { kind: 'translated', ref, from: a.language, text: a.english };
}

export function anthropicTranslator(deps: TranslatorDeps): TranslatePort {
  const price = priceFor(TRANSLATE_MODEL);
  if (price === null) throw new RangeError(`translate: no price for model ${TRANSLATE_MODEL} in prices.ts`);
  const usdOf = (u: Usage) => usdForTokens(price, u.inputTokens, u.outputTokens, u.cacheWriteTokens ?? 0, u.cacheReadTokens ?? 0);
  const estimateUsd = (subjects: readonly TranslateSubject[]): number =>
    usdOf({
      inputTokens: Math.ceil(JSON.stringify(translateRequestBody(deps.translate.maxOutputTokens, subjects)).length / deps.judge.charsPerToken),
      outputTokens: deps.translate.maxOutputTokens,
    });
  const book = (usd: number): PriceBook => ({
    [`${VENDOR}:${ENDPOINT}`]: { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call', usdPerUnit: usd, unitName: 'batched translate call', measuredAt: 'estimated per call from token rates in prices.ts' },
  });

  return {
    id: `translate:${VENDOR}/${TRANSLATE_MODEL}@${TRANSLATE_PROMPT_SHA}`,
    promptId: `translate@${TRANSLATE_PROMPT_SHA}`,
    model: TRANSLATE_MODEL,

    async translate(subjects: readonly TranslateSubject[], _budget: Budget): Promise<Metered<readonly TranslateOutcome[]>> {
      const at = deps.now();
      const spec = { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call' as const, estUnits: 1, at };
      const send = deps.client.send;
      const outcomes = new Map<string, TranslateOutcome>();
      const spends: Spend[] = [];
      if (send === undefined) {
        return { value: subjects.map((s) => ({ kind: 'absent', ref: s.ref, detail: 'this client cannot send a translate call' })), spend: mergeSpend([], spec, 'per-call') };
      }
      for (let i = 0; i < subjects.length; i += deps.translate.perCall) {
        const batch = subjects.slice(i, i + deps.translate.perCall);
        try {
          const call = await metered(deps.meter, book(estimateUsd(batch)), spec, async () => {
            try {
              const reply = decodeTranslations(await send.call(deps.client, translateRequestBody(deps.translate.maxOutputTokens, batch)));
              return { value: reply.byRef, units: 1, usdActual: usdOf(reply.usage) };
            } catch (error) {
              if (error instanceof VendorUnavailable && error.status !== undefined) return { value: null, units: 0, usdActual: 0 };
              throw error;
            }
          });
          spends.push(call.spend);
          batch.forEach((s, j) => {
            outcomes.set(s.ref, call.value === null ? { kind: 'absent', ref: s.ref, detail: 'the vendor refused the call' } : outcomeOf(s.ref, call.value.get(`P${j + 1}`)));
          });
        } catch (error) {
          if (error instanceof BudgetRefused) throw error;
          for (const s of batch) outcomes.set(s.ref, { kind: 'absent', ref: s.ref, detail: error instanceof Error ? error.message : String(error) });
        }
      }
      return {
        value: subjects.map((s) => outcomes.get(s.ref) ?? { kind: 'absent', ref: s.ref, detail: 'no outcome' }),
        spend: mergeSpend(spends, spec, 'per-call'),
      };
    },
  };
}
