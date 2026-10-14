/**
 * WHETHER A FEED POST'S WORDS ARE SENT FOR TRANSLATION (Policy.translate, 0081).
 *
 * Pure and in core because two callers must agree on it exactly: the runner's step
 * (services/runner work/translate-posts.ts), which asks the model, and the one-off backfill
 * (tools/translate-backfill.ts), which prices the same set before spending anything. A backfill
 * that counted posts differently from the runner would quote the owner a cost the runner never
 * pays.
 *
 * ★ THE SOURCE'S TAG DECIDES ONLY THE CHEAP CASES. A post tagged English is never sent, and a
 * post tagged as having no words (media only, hashtags only, undetermined) is never sent. Every
 * other post — tagged with another language, or with no tag at all, as the short-video source
 * often sends — is counted by its letters: once hashtags, @handles, $tickers, links, digits and
 * emoji are taken out, fewer than `minLetters` letters is nothing to translate. Everything else
 * goes to the model, which reads the language itself and may answer "already English": the
 * short-video source tags "Cute haa" as Somali, and a wrong tag must never put a fake
 * "Translated from Somali" under English words.
 *
 * What breaks if changed carelessly: the tag is compared by its first part, lower-cased
 * ('en-GB' is English). Comparing the whole tag would send every regional English post to be
 * "translated" into itself.
 */

import type { TranslatePolicy } from '@insidor/contracts/policy.ts';

export type TranslateNeed = 'english' | 'no-words' | 'ask';

const LINK = /https?:\/\/\S+/giu;
/* A hashtag, @handle or $ticker: a word kept as written, never one to translate. */
const TAGGED = /[#@$][\p{L}\p{M}\p{N}_]+/gu;
const LETTER = /\p{L}/gu;

/** The letters left once links, tags, handles and tickers are gone: what a translation would carry. */
export function wordLetters(text: string): number {
  return (text.replace(LINK, ' ').replace(TAGGED, ' ').match(LETTER) ?? []).length;
}

export function translateNeed(text: string, lang: string | null, p: Pick<TranslatePolicy, 'minLetters' | 'englishCodes' | 'noWordsCodes'>): TranslateNeed {
  const tag = (lang ?? '').trim().toLowerCase().split(/[-_]/u)[0] ?? '';
  if (tag !== '' && p.englishCodes.includes(tag)) return 'english';
  if (tag !== '' && p.noWordsCodes.includes(tag)) return 'no-words';
  return wordLetters(text) < p.minLetters ? 'no-words' : 'ask';
}
