/**
 * ONE SEARCH PER LANGUAGE: a query whose filter names several languages, as the searches that
 * name one each, and the order a pass pages them in.
 *
 * Why it exists: from about 23:15 UTC on 2026-10-16 the text supplier answers an OR group of
 * languages, `(lang:en OR lang:zxx OR … OR lang:ja)`, with the LAST language only, and still
 * answers 200 with full pages. Our English finds went from 8,811 a day to 46 while Japanese, last
 * in `feed.langs`, went from 0 to 5,335, and nothing failed. One language alone still works (the
 * paid probe of 2026-10-18). So every search that carries more than one language is asked as one
 * search per language, each with its own cursor, page count and empty run; the adapter now refuses
 * a group outright (adapters/platform/x/src/discover.ts).
 *
 * ★ SPLIT HERE, IN THE CALLER, NOT FANNED OUT IN THE ADAPTER. The caps live here: the meter's
 * line, the middle lane's $6, each `search:<name>` day and the narrative-name day are checked
 * before every page, and an adapter that asked five languages behind one call would spend five
 * pages under one check and hand back one cursor for five searches. Split here, a language is one
 * more ask under the same rules, the caps are totals across languages, and a language that fails
 * is one failed ask while the others carry on.
 *
 * ★ ROUND-ROBIN, BY PAGE (`roundOrder`). Every language gets its first page before any gets a
 * second, and the order turns by one each round, so a cap or deadline that closes a pass mid-round
 * takes the last page from a different language each time. Asked one language to its end and then
 * the next, the first language's deep pages would spend the lane's day before the others were
 * asked at all — exactly how Japanese took the whole search for two days, from the other side.
 *
 * What breaks if changed carelessly: sending the split queries with one shared cursor mixes one
 * language's position into another's search; checking a cap once per ask rather than per page
 * lets the languages after the first spend past it.
 */

import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';

/** One language's search: the query with that language alone, or the query as it was (no filter, or one language). */
export interface LanguageAsk {
  /** The language this search asks, or null when the query names none or one already. */
  readonly lang: string | null;
  readonly query: DiscoveryQuery;
}

/** The query as one search per language, in the filter's own order. One language or none: the query unchanged. */
export function languageAsks(query: DiscoveryQuery): readonly LanguageAsk[] {
  const langs = query.filter?.langs ?? [];
  if (query.filter === undefined || langs.length <= 1) return [{ lang: langs[0] ?? null, query }];
  return langs.map((lang) => ({ lang, query: { ...query, filter: { ...query.filter!, langs: [lang] } } }));
}

/** The order round `round` (from 0) asks its languages in: the list turned by `round` places. */
export function roundOrder<T>(xs: readonly T[], round: number): readonly T[] {
  if (xs.length === 0) return xs;
  const k = ((round % xs.length) + xs.length) % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
}
