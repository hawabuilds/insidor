/**
 * THE NARRATIVE TITLER ON THE OPEN MODEL: a narrative's posts in, a short clear title out
 * (contracts ports/titles.ts; the owner, 2026-10-16: "Short clear title (cheap model)").
 *
 * Its own file, apart from questions.ts, because the other open questions re-wrap the main
 * adapter's own prompts, and this one has no main-adapter twin: there is no Anthropic call to
 * mirror (the owner: "no Anthropic at all"), so its words are written here and hashed here.
 *
 * ★ WORDS ONLY, ONE NARRATIVE A CALL. A title is about what the posts say; sending their pictures
 * would multiply a call's price by ten for a few words. One narrative a call keeps an answer from
 * being matched to the wrong narrative, and a pass asks at most Policy.narrative.title.perPass.
 *
 * ★ PRICED BEFORE, BOOKED AFTER, as questions.ts books every open question: a pessimistic estimate
 * at the host's listed prices checked against the meter before the request leaves, then the host's
 * own dollar figure (or its token counts at the listed prices). An error the host answered with a
 * status is booked at $0 and the narrative is `absent`, asked again on a later pass.
 *
 * ★ A TITLE THAT IS NOT ONE IS NOT KEPT: empty, longer than `maxTitleChars`, a hashtag, a $ticker
 * or a coin address is `absent`, and the narrative keeps its judge's name.
 *
 * What breaks if changed carelessly: the prompt's words. They are hashed into the port id, so a
 * change files new titles under a new id — that is the point; editing them without a new hash
 * would make two wordings indistinguishable in the ledger.
 */

import { createHash } from 'node:crypto';

import type { Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import type { TitleOutcome, TitlePort, TitleSubject } from '@insidor/contracts/ports/titles.ts';
import { mergeSpend, metered } from '@insidor/meter';
import { BudgetRefused, VendorUnavailable } from '@insidor/vendor-kit';

import { routerFields } from './client.ts';
import type { HostModel } from './models.ts';
import { messagesReplyOf, type OpenAsk } from './questions.ts';

export const OPEN_TITLE_ENDPOINT = 'narrative-title';
/** As questions.ts: an estimate taken high, so the meter refuses before the host can overspend. */
const MARGIN = 2;

const SYSTEM = [
  'You name stories that are spreading on social media.',
  'You are given several posts about one story and the names people gave its subject.',
  'Write a short, clear title for the story: two to six plain words naming who or what it is about and what happened.',
  'No hashtags, no emoji, no quotation marks, no $tickers, no coin talk, no clickbait. Title case.',
  'Answer only with JSON: {"title": "..."}',
].join(' ');

export const TITLE_PROMPT_SHA = createHash('sha256').update(SYSTEM).digest('hex').slice(0, 8);

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
};

export interface OpenTitlerDeps {
  readonly client: Pick<OpenAsk, 'send'>;
  readonly meter: Meter;
  readonly now: () => Millis;
  readonly model: HostModel;
  readonly vendor: string;
  readonly providers: readonly string[];
  readonly router?: boolean;
  readonly charsPerToken: number;
  readonly maxOutputTokens: number;
  readonly maxTitleChars: number;
}

/** The user message: the posts, numbered, then the names. */
export function titleRequestText(s: TitleSubject): string {
  const posts = s.posts.map((p, i) => `${i + 1}. ${p.replace(/\s+/g, ' ').trim()}`).join('\n');
  const names = s.names.length === 0 ? '' : `\nNames people gave it: ${s.names.join(', ')}`;
  return `Posts:\n${posts}${names}`;
}

/** A model's answer as a title, or null when it is not one we would show. */
export function cleanTitle(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').trim();
  if (t === '' || t.length > maxChars) return null;
  if (/[#$]|https?:\/\//i.test(t) || /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(t)) return null;
  return t;
}

export function openTitler(deps: OpenTitlerDeps): TitlePort {
  const inP = deps.model.usdPerInputToken;
  const outP = deps.model.usdPerOutputToken;
  return {
    id: `titles:${deps.vendor}/${deps.model.id}@${TITLE_PROMPT_SHA}`,
    model: deps.model.id,

    async title(subjects: readonly TitleSubject[], _budget: Budget): Promise<Metered<readonly TitleOutcome[]>> {
      const at = deps.now();
      const spec = { vendor: deps.vendor, endpoint: OPEN_TITLE_ENDPOINT, unit: 'per-call' as const, estUnits: 1, at };
      if (inP === null || outP === null) throw new RangeError(`titles: the host lists no price for ${deps.model.id}, and an unpriced call is refused`);
      const spends: Spend[] = [];
      const out: TitleOutcome[] = [];
      for (const s of subjects) {
        const text = titleRequestText(s);
        const estimate = ((SYSTEM.length + text.length) / deps.charsPerToken * inP + deps.maxOutputTokens * outP) * MARGIN;
        const body = {
          model: deps.model.id,
          max_tokens: deps.maxOutputTokens,
          temperature: 0,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
          response_format: { type: 'json_schema', json_schema: { name: 'narrative_title', strict: true, schema: SCHEMA } },
          ...routerFields(deps.router, deps.providers),
        };
        const book = { [`${deps.vendor}:${OPEN_TITLE_ENDPOINT}`]: { vendor: deps.vendor, endpoint: OPEN_TITLE_ENDPOINT, unit: 'per-call' as const, usdPerUnit: estimate, unitName: 'narrative title call', measuredAt: 'estimated per call from the host model list prices' } };
        try {
          const call = await metered(deps.meter, book, spec, async () => {
            try {
              const reply = messagesReplyOf(await deps.client.send(body));
              return { value: reply as ReturnType<typeof messagesReplyOf> | null, units: 1, usdActual: reply.costUsd ?? reply.inputTokens * inP + reply.outputTokens * outP };
            } catch (error) {
              if (error instanceof VendorUnavailable && error.status !== undefined) return { value: null, units: 0, usdActual: 0 };
              throw error;
            }
          });
          spends.push(call.spend);
          const reply = call.value;
          if (reply === null) {
            out.push({ kind: 'absent', ref: s.ref, detail: 'the host refused the call' });
            continue;
          }
          const content = reply.reply['content'];
          const said = Array.isArray(content) ? String((content[0] as { text?: unknown } | undefined)?.text ?? '') : '';
          let parsed: unknown = null;
          try {
            parsed = (JSON.parse(said) as { title?: unknown }).title;
          } catch {
            parsed = null;
          }
          const title = cleanTitle(parsed, deps.maxTitleChars);
          out.push(title === null ? { kind: 'absent', ref: s.ref, detail: 'no usable title in the answer' } : { kind: 'titled', ref: s.ref, title });
        } catch (error) {
          if (error instanceof BudgetRefused) throw error;
          out.push({ kind: 'absent', ref: s.ref, detail: error instanceof Error ? error.message : String(error) });
        }
      }
      return { value: out, spend: mergeSpend(spends, spec, 'per-call') };
    },
  };
}
