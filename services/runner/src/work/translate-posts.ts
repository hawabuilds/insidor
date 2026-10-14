/**
 * THE TRANSLATE STEP: every post on For You, Popular or the scroll whose words are not English,
 * translated once into English and stored (Policy.translate, 0081 public.post_translation), so the
 * card and the post sheet can show the English with "Translated from <language>" under it.
 *
 * Rides the refill loop (every half minute), not the discovery pass: a post is read in the app the
 * moment the projector puts it on a feed, and the discovery pass can be minutes away. A quiet pass
 * is one query and opens no meter.
 *
 * Each pass: the feed posts with no row yet, most recently shown first, at most `perPass`; core's
 * `translateNeed` sorts them — tagged English, or no words once tags, handles, tickers, links and
 * emoji are out → a row with no English, written without asking anyone; the rest → the translator
 * (the cheap model, on the judge's line under `translate`), and its answer written: the English
 * and the language, or "kept" (it read them as English or wordless) as a row with no English.
 *
 * ★ OFF IS OFF, AND MISSING IS QUIET. With the switch off, no translator, a dry run, or 0081 not
 * applied, the step does nothing and says why in its result; every card shows its own words, as
 * before. A failed or refused call writes nothing for its posts, so they are asked again next pass
 * — never stored as "nothing to translate".
 *
 * What breaks if changed carelessly: the words sent are the card's words before it trims them —
 * the trailing short links the projector drops are dropped here too (services/project rising.ts
 * `withoutTrailingShortLinks`), so the English never carries a link the original card hides.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { TranslatePort, TranslateSubject } from '@insidor/contracts/ports/translate.ts';
import type { PgTranslationRepo, TranslationRow } from '@insidor/store';
import { translateNeed } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

import type { Logger } from '../log.ts';

/** The prompt id of a row written without asking a model: the words were tags, links or emoji. */
export const NO_WORDS_PROMPT = 'no-words';

export interface TranslateDeps {
  readonly translator: TranslatePort | null;
  readonly translations: Pick<PgTranslationRepo, 'candidates' | 'put'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface TranslateResult {
  readonly skipped: string | null;
  /** Posts read from the feed this pass. */
  readonly due: number;
  readonly translated: number;
  /** Rows written with no English: already English, or nothing to translate. */
  readonly kept: number;
  readonly absent: number;
  readonly usd: number;
}

/** The words as the model is shown them: the card's own, trailing short links gone, cut to `maxChars`. */
export function wordsToTranslate(body: string, maxChars: number): string {
  const text = body.replace(/(?:\s*https?:\/\/t\.co\/[A-Za-z0-9]+)+\s*$/i, '').trim();
  return Array.from(text).slice(0, maxChars).join('');
}

export async function translatePosts(deps: TranslateDeps): Promise<TranslateResult> {
  const p = deps.policy.translate;
  const none = (skipped: string): TranslateResult => ({ skipped, due: 0, translated: 0, kept: 0, absent: 0, usd: 0 });
  if (!p.on) return none('switched off (Policy.translate.on)');
  const translator = deps.translator;
  if (translator === null) return none('no translator: the judge is not configured');
  if (deps.mode !== 'live') return none('dry run');

  const due = await deps.translations.candidates(p.windowMs, p.perPass);
  if (due.length === 0) return { skipped: null, due: 0, translated: 0, kept: 0, absent: 0, usd: 0 };

  const rows: TranslationRow[] = [];
  const subjects: TranslateSubject[] = [];
  for (const c of due) {
    const words = wordsToTranslate(c.text, p.maxChars);
    const need = translateNeed(words, c.lang, p);
    if (need === 'ask') subjects.push({ ref: c.itemId, text: words });
    else rows.push({ itemId: c.itemId, from: need === 'english' ? 'en' : 'zxx', textEn: null, model: null, promptId: NO_WORDS_PROMPT });
  }

  let translated = 0;
  let kept = rows.length;
  let absent = 0;
  let usd = 0;
  if (subjects.length > 0) {
    try {
      const line = deps.meter.line();
      const r = await translator.translate(subjects, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (deps.now() + deps.policy.judge.timeoutMs) as Millis });
      usd = r.spend.usd;
      for (const o of r.value) {
        if (o.kind === 'absent') {
          absent += 1;
        } else if (o.kind === 'kept') {
          kept += 1;
          rows.push({ itemId: o.ref, from: o.from, textEn: null, model: translator.model, promptId: translator.promptId });
        } else {
          translated += 1;
          rows.push({ itemId: o.ref, from: o.from, textEn: o.text, model: translator.model, promptId: translator.promptId });
        }
      }
    } catch (e) {
      if (!(e instanceof BudgetRefused)) throw e;
      deps.log.info('translations paused: the judge line is spent for today', { posts: subjects.length });
      absent = subjects.length;
    }
  }
  if (!(await deps.translations.put(rows))) return none('0081 not applied: nowhere to keep translations');
  if (subjects.length > 0) deps.log.info('feed posts translated', { translated, kept, absent, usd: Math.round(usd * 1e4) / 1e4 });
  return { skipped: null, due: due.length, translated, kept, absent, usd };
}
