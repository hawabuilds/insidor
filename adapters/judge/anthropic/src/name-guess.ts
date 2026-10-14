/**
 * THE NAMER ON THE JUDGE'S MODEL: each post, with its closest known post → coin pairs, asked for
 * the five names and tickers people are likeliest to launch for it, best first (contracts
 * ports/names.ts, Policy.names).
 *
 * Its own file, apart from prompts.ts and the judge's questions, because it is a different
 * question with a different answer, and because the judge's prompt files are re-tuned twice a
 * day: a re-tune must never change the namer's wording, and the namer's wording must never
 * change the judge's prompt hash. The prompt is here, hashed into `promptId`, so every stored
 * guess names the exact words that produced it.
 *
 * ★ SAME TRANSPORT, SAME LEDGER, ITS OWN ENDPOINT. The call goes through the judge client's
 * `send` (its retries, its key) and is metered under the judge's vendor line as `names`, so the
 * day's guesses are countable apart from the day's judging and can never spend past the judge's
 * line. Priced before it leaves (a pessimistic estimate), booked at the vendor's own token counts.
 * An error the vendor answered with a status is booked at $0, as the judge books it.
 *
 * ★ A PICTURE IS SHOWN WHEN IT CAN BE READ. The animal or character in a picture is how half of
 * these coins are named, and the words often do not say it. A picture that cannot be fetched
 * leaves the post asked on its words; it is never a reason to skip the post.
 *
 * ★ NO ANSWER IS NOT "NO NAMES". A failed call, a refusal or a reply that does not parse is
 * `absent` for every post in it; the runner asks again on a later pass.
 *
 * What breaks if changed carelessly: the refs. Each post is sent as `P1`, `P2`… and answers are
 * matched back by them, never by position; and the cleaning of names into tickers is core's
 * (`cleanGuesses`), applied by the caller — this file passes the model's strings through.
 */

import { createHash } from 'node:crypto';

import type { Millis } from '@insidor/contracts';
import type { JudgePolicy, NamesPolicy } from '@insidor/contracts/policy.ts';
import type { Budget, Meter, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import type { NameOutcome, NamePort, NameSubject } from '@insidor/contracts/ports/names.ts';
import { mergeSpend, metered, type PriceBook } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';

import { VENDOR, temperatureFor, usageOf, type Frame, type JudgeClient, type Usage } from './client.ts';
import { priceFor, usdForTokens } from './prices.ts';

const ENDPOINT = 'names';

export const NAME_SYSTEM = `You predict the names crypto traders will give a meme coin launched about a social media post, minutes after it goes viral. You know how they name coins on memecoin launchpads, and you learn their habits from real examples: posts and the coins people actually made of them.`;

export const NAME_INSTRUCTIONS = `For each post, give the 5 coins (name and ticker) people are most likely to launch for it, most likely first.

How people actually name these coins:
- The main word: the subject's own name as the post spells it (an animal's name, a person's nickname, a product, a place, a slang word). Most coins are just this, and the ticker is the same word: Mochi the Cat is $MOCHI, a raccoon called Bandit is $BANDIT.
- The full name or phrase, with a ticker of its key word or of the phrase run together: "Stay humble" is $STAYHUMBLE, "Moon Deng memes" is $DENG.
- RIP + the name when something died, ended, was cancelled or discontinued: "Rest In Vine" is $RIP or $RIPVINE.
- A nickname, the meme word the internet uses for it, a catchphrase or a famous quote from the post or the video.
- The animal, character or object in the picture when the subject has no name of its own: a heron that looks smug is "Smug Heron" $HERON.
- A name plus its number or year for an event or a sequel: $SEQUEL2.
- The words people would type first, minutes after seeing it: short, obvious, the post's own words before clever ones.

Use the examples shown with each post: they are the closest posts people already coined, with every name they used. When an example is about the same subject, people usually launch the same name again, so put that name first. Otherwise copy their habits, not their names.

Rules for the answer:
- Tickers are capital letters and digits only, no $, at most 10 characters.
- Five different coins: different names or tickers, not five spellings of one.
- "seen": up to 12 words on what the post's picture shows; "" when no picture is shown.
- Answer once for each ref, with JSON only.`;

export const NAME_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          seen: { type: 'string' },
          guesses: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, ticker: { type: 'string' } },
              required: ['name', 'ticker'],
              additionalProperties: false,
            },
          },
        },
        required: ['ref', 'seen', 'guesses'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
} as const;

/** The prompt's hash: a wording change files every guess after it under a new id. */
export const NAME_PROMPT_SHA = createHash('sha256').update(`${NAME_SYSTEM}\n${NAME_INSTRUCTIONS}\n${JSON.stringify(NAME_SCHEMA)}`).digest('hex').slice(0, 8);

export interface NameGuesserDeps {
  readonly client: JudgeClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** The judge's model (JUDGE_MODEL), already checked against the price book. */
  readonly model: string;
  readonly judge: Pick<JudgePolicy, 'charsPerToken' | 'tokensPerFrame'>;
  readonly names: Pick<NamesPolicy, 'perCall' | 'maxOutputTokens'>;
  /** The temperature-0 rule of the judge's client (client.ts `temperatureFor`). */
  readonly effort: 'low' | null;
}

/** The posts as sent: refs `P1`…, words, whether a picture follows, and their examples. */
export function namePosts(subjects: readonly NameSubject[], pictured: ReadonlySet<string>): readonly Record<string, unknown>[] {
  return subjects.map((s, i) => ({
    ref: `P${i + 1}`,
    words: s.text === '' ? '(no words: a picture only)' : s.text,
    picture: pictured.has(s.ref) ? 'shown below' : 'none',
    examples: s.examples.map((e) => ({
      words: e.text === '' ? '(no words: a picture only)' : e.text,
      ...(e.seen === null || e.seen === '' ? {} : { picture: e.seen }),
      coins: e.coins.map((c) => `${c.name} ($${c.ticker})`),
    })),
  }));
}

/** The request body, built without a socket so a test can read it. */
export function nameRequestBody(model: string, maxOutputTokens: number, effort: 'low' | null, subjects: readonly NameSubject[], frames: ReadonlyMap<string, Frame>): Record<string, unknown> {
  const posts = namePosts(subjects, new Set(frames.keys()));
  const content: unknown[] = [
    { type: 'text', text: NAME_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Posts, as JSON. Answer once for each ref.\n${JSON.stringify(posts)}` },
  ];
  subjects.forEach((s, i) => {
    const f = frames.get(s.ref);
    if (f === undefined) return;
    content.push({ type: 'text', text: `Picture for ref P${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } });
  });
  return {
    model,
    max_tokens: maxOutputTokens,
    ...temperatureFor({ effort }),
    system: [{ type: 'text', text: NAME_SYSTEM }],
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: NAME_SCHEMA }, ...(effort === null ? {} : { effort }) },
  };
}

/** The answers by ref out of a reply; empty for anything short of the JSON asked for. */
export function decodeNames(body: unknown): { readonly byRef: ReadonlyMap<string, { readonly seen: string; readonly guesses: readonly { name: string; ticker: string }[] }>; readonly usage: Usage } {
  const usage = usageOf(body);
  const r = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const byRef = new Map<string, { seen: string; guesses: { name: string; ticker: string }[] }>();
  if (r['stop_reason'] !== 'end_turn') return { byRef, usage };
  const text = (Array.isArray(r['content']) ? r['content'] : [])
    .map((b) => (typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text' ? (b as Record<string, unknown>)['text'] : null))
    .filter((t): t is string => typeof t === 'string')
    .join('');
  try {
    const answers = (JSON.parse(text) as { answers?: unknown } | null)?.answers;
    if (!Array.isArray(answers)) return { byRef, usage };
    for (const a of answers as Record<string, unknown>[]) {
      if (typeof a?.['ref'] !== 'string' || !Array.isArray(a['guesses'])) continue;
      const guesses = (a['guesses'] as Record<string, unknown>[]).flatMap((g) => (typeof g?.['name'] === 'string' && typeof g['ticker'] === 'string' ? [{ name: g['name'], ticker: g['ticker'] }] : []));
      byRef.set(a['ref'], { seen: typeof a['seen'] === 'string' ? a['seen'] : '', guesses });
    }
  } catch {
    return { byRef: new Map(), usage };
  }
  return { byRef, usage };
}

export function anthropicNamer(deps: NameGuesserDeps): NamePort {
  const price = priceFor(deps.model);
  if (price === null) throw new RangeError(`names: no price for model ${deps.model} in prices.ts`);
  const promptId = `names@${NAME_PROMPT_SHA}`;
  const usdOf = (u: Usage) => usdForTokens(price, u.inputTokens, u.outputTokens, u.cacheWriteTokens ?? 0, u.cacheReadTokens ?? 0);
  /* Every character at charsPerToken, a picture at tokensPerFrame, the whole answer ceiling. */
  const estimateUsd = (subjects: readonly NameSubject[], pictures: number): number =>
    usdOf({
      inputTokens: Math.ceil((NAME_SYSTEM.length + NAME_INSTRUCTIONS.length + JSON.stringify(namePosts(subjects, new Set())).length) / deps.judge.charsPerToken) + pictures * deps.judge.tokensPerFrame,
      outputTokens: deps.names.maxOutputTokens,
    });
  const book = (usd: number): PriceBook => ({
    [`${VENDOR}:${ENDPOINT}`]: { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call', usdPerUnit: usd, unitName: 'batched names call', measuredAt: 'estimated per call from token rates in prices.ts' },
  });

  return {
    id: `names:${VENDOR}/${deps.model}@${NAME_PROMPT_SHA}`,
    promptId,
    model: deps.model,

    async guess(subjects: readonly NameSubject[], _budget: Budget): Promise<Metered<readonly NameOutcome[]>> {
      const at = deps.now();
      const spec = { vendor: VENDOR, endpoint: ENDPOINT, unit: 'per-call' as const, estUnits: 1, at };
      const send = deps.client.send;
      const outcomes = new Map<string, NameOutcome>();
      const spends: Spend[] = [];
      if (send === undefined) {
        return { value: subjects.map((s) => ({ kind: 'absent', ref: s.ref, detail: 'this client cannot send a names call' })), spend: mergeSpend([], spec, 'per-call') };
      }
      for (let i = 0; i < subjects.length; i += deps.names.perCall) {
        const batch = subjects.slice(i, i + deps.names.perCall);
        /* Pictures first, before any money moves; one that cannot be read leaves the post on its words. */
        const frames = new Map<string, Frame>();
        await Promise.all(batch.map(async (s) => {
          if (s.picture === null) return;
          const f = await deps.client.frame(s.picture).catch(() => null);
          if (f !== null) frames.set(s.ref, f);
        }));
        try {
          const call = await metered(deps.meter, book(estimateUsd(batch, frames.size)), spec, async () => {
            try {
              const reply = decodeNames(await send.call(deps.client, nameRequestBody(deps.model, deps.names.maxOutputTokens, deps.effort, batch, frames)));
              return { value: reply.byRef, units: 1, usdActual: usdOf(reply.usage) };
            } catch (error) {
              if (error instanceof VendorUnavailable && error.status !== undefined) return { value: null, units: 0, usdActual: 0 };
              throw error;
            }
          });
          spends.push(call.spend);
          batch.forEach((s, j) => {
            const a = call.value?.get(`P${j + 1}`);
            outcomes.set(s.ref, a === undefined || a.guesses.length === 0
              ? { kind: 'absent', ref: s.ref, detail: call.value === null ? 'the vendor refused the call' : 'no usable answer for this post' }
              : { kind: 'guessed', ref: s.ref, guesses: a.guesses, seen: a.seen.trim() === '' ? null : a.seen.trim() });
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
