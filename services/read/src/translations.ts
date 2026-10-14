/**
 * THE FEED'S TRANSLATIONS, PUT ON EACH CARD AT READ TIME (0081 public.post_translation): a post
 * written in another language carries `translation: { text, from }` — its words in English, cut
 * the way the projector cuts the card's own words, and the language's code — and the phone shows
 * the English with "Translated from <language>" under it and the original one tap away.
 *
 * ★ ADDED HERE, NOT IN THE PROJECTED PAYLOAD, for the poster picture's reason (queries.ts): the
 * runner writes a translation within a minute of a post reaching a feed, and a scroll member's
 * card may not be projected again for hours. Read here, the English is on the card at the next
 * fetch. One indexed read per reply, for the ids already in hand.
 *
 * ★ NO TRANSLATION IS NO FIELD. A post in English, one with nothing to translate, one not
 * translated yet, the switch off, and a database without 0081 all send the card exactly as
 * projected; the phone shows the original words. A missing table is never a 500.
 *
 * What breaks if changed carelessly: the cut must stay the projector's (services/project
 * rising.ts `trimTo` at EXCERPT_MAX_CHARS). A longer English than the card's own words would push
 * the card taller only when translated, and a shorter one would hide words the original shows.
 */

import type { Db } from './queries.ts';

/** The card's words, at most (services/project rising.ts EXCERPT_MAX_CHARS). */
const EXCERPT_MAX_CHARS = 280;

export const TRANSLATIONS_SQL = `
select item_id, lang_from, text_en from public.post_translation
 where item_id = any($1::text[]) and text_en is not null`;

/** The projector's cut: whitespace collapsed, at most the card's length, at a word, with '…'. */
export function cardText(text: string, max: number = EXCERPT_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const points = Array.from(collapsed);
  if (points.length <= max) return collapsed;
  const cut = points.slice(0, max).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Each card with its post's English beside it, when there is one; every other card untouched. */
export async function withTranslations<T>(db: Db, payloads: readonly T[]): Promise<readonly T[]> {
  const ids = payloads.flatMap((p) => (isObj(p) && typeof p['id'] === 'string' ? [p['id']] : []));
  if (ids.length === 0) return payloads;
  let rows: readonly Record<string, unknown>[];
  try {
    rows = await db.query(TRANSLATIONS_SQL, [ids]);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return payloads;
    throw e;
  }
  const byId = new Map<string, { text: string; from: string }>();
  for (const r of rows) {
    const text = typeof r['text_en'] === 'string' ? cardText(r['text_en']) : '';
    if (typeof r['item_id'] === 'string' && typeof r['lang_from'] === 'string' && text !== '') byId.set(r['item_id'], { text, from: r['lang_from'] });
  }
  if (byId.size === 0) return payloads;
  return payloads.map((p) => {
    if (!isObj(p) || typeof p['id'] !== 'string') return p;
    const t = byId.get(p['id']);
    return t === undefined ? p : ({ ...p, translation: t } as T);
  });
}
