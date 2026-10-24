/**
 * MEME-WAR POSTS BY THE COUNTRY THEY NAME (Policy.narrative.fight.native, the owner 2026-10-24): a
 * post in one country's language that names another country in that language — a French post
 * saying "Japon", a Japanese one saying フランス, a Chinese one saying 土耳其, a Turkish one saying
 * "Çin" — at For You's views, is a post of that pair's meme war.
 *
 * Why it exists apart from the regroup (narrative.ts): the regroup is made of the posts the judge
 * said yes to, and the judge asks whether a post is a coinable subject. A post mocking another
 * country is not one, so on 23-24 Oct none of the French posts of the France–Japan war (46k to
 * 316k views) and none of the Chinese or Turkish posts of theirs was ever grouped: the China–Turkey
 * narrative was its two pasted origin posts and English coin chatter, and France–Japan never
 * existed. This step reads the post's own words and language, nothing the judge said.
 *
 * Two outcomes, pure:
 *
 *   join   the post goes to the open narrative whose countries hold both of its pair and whose
 *          newest post is inside `fight.activeMs` (the newest such narrative when there are several)
 *   seed   a pair no narrative holds, with `seedMinPosts` posts from `seedMinAccounts` accounts
 *          inside `seedWithinMs`, becomes a new narrative of those posts. ★ The caller keeps it off
 *          the board until the titler names both countries: a count alone cannot tell a war from
 *          the news (on 18 Oct Japanese posts named France 40 times at 40k views, about the riots)
 *
 * ★ "WE CANNOT TELL" IS NOT A PAIR. A post in a language with no home country (English, Spanish,
 * Portuguese: many countries speak them) or naming no other country has no pair; a post with no
 * view count is not at the bar — an unknown is never read as viral.
 *
 * What breaks if changed carelessly: the word match. A word without `*` matches only whole, so
 * Turkish "çin" is not "çini" (tile) or "çinko" (zinc); in a script written without spaces a word
 * matches anywhere, because there is no word edge to find (일본은, 土耳其人).
 */

import type { Policy } from '@insidor/contracts/policy.ts';

type NativePolicy = Policy['narrative']['fight']['native'];

/** A stored post as this step reads it. */
export interface FightPost {
  readonly itemId: string;
  /** Who posted it; null: not known, counted as its own account. */
  readonly authorKey: string | null;
  /** The language the source gave it; null: none. */
  readonly lang: string | null;
  readonly text: string;
  readonly atMs: number;
  /** Its views as last read; null: never read. */
  readonly reach: number | null;
}

/** An open narrative a pair's posts could join. */
export interface FightNarrative {
  readonly id: string;
  /** Its countries as stored (the titler's spelling, the owner's, or a seed's). */
  readonly countries: readonly string[];
  readonly newestPostAtMs: number | null;
}

export interface FightPlan {
  /** Narrative → the posts that join it this pass. */
  readonly joins: ReadonlyMap<string, readonly string[]>;
  /** New narratives: the pair (alphabetical) and their posts, oldest first. */
  readonly seeds: readonly { readonly countries: readonly [string, string]; readonly members: readonly string[] }[];
}

/** Letters of a script written without spaces between words. */
const UNSPACED = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+$/u;
const LETTER = /[\p{L}\p{M}]/u;

const lower = (text: string, lang: string): string => {
  try {
    return text.normalize('NFC').toLocaleLowerCase(lang);
  } catch {
    return text.normalize('NFC').toLowerCase();
  }
};

/** Whether `word` (lower-cased; `*` at the end for any ending) is in `text` (lower-cased). */
function hasWord(text: string, word: string): boolean {
  const prefix = word.endsWith('*');
  const w = prefix ? word.slice(0, -1) : word;
  if (w === '') return false;
  if (UNSPACED.test(w)) return text.includes(w);
  for (let at = text.indexOf(w); at !== -1; at = text.indexOf(w, at + 1)) {
    const before = at === 0 ? '' : text[at - 1] ?? '';
    const after = text[at + w.length] ?? '';
    if (before !== '' && LETTER.test(before)) continue;
    if (prefix || after === '' || !LETTER.test(after)) return true;
  }
  return false;
}

/** Our name for a country the titler or the owner spelled another way; the name itself otherwise. */
export const canonicalCountry = (name: string, p: Policy): string => {
  const a = p.narrative.fight.native.aliases;
  const t = name.trim();
  return a[t] ?? Object.entries(a).find(([k]) => k.toLowerCase() === t.toLowerCase())?.[1] ?? t;
};

/** The other countries a post names in its own language (alphabetical); empty when its language has no home country. */
export function countriesNamed(lang: string | null, text: string, p: Policy): readonly string[] {
  const n: NativePolicy = p.narrative.fight.native;
  if (lang === null) return [];
  const home = n.home[lang];
  const table = n.names[lang];
  if (home === undefined || table === undefined) return [];
  const body = lower(text, lang);
  const out = Object.entries(table)
    .filter(([country, words]) => country !== home && words.some((w) => hasWord(body, lower(w, lang))))
    .map(([country]) => country);
  return [...new Set(out)].sort();
}

/** The post's pairs: its language's country with each country it names, each pair alphabetical. */
export function fightPairsOf(post: Pick<FightPost, 'lang' | 'text'>, p: Policy): readonly (readonly [string, string])[] {
  const home = post.lang === null ? undefined : p.narrative.fight.native.home[post.lang];
  if (home === undefined) return [];
  return countriesNamed(post.lang, post.text, p).map((c) => (home < c ? [home, c] as const : [c, home] as const));
}

const pairKey = (pair: readonly [string, string]): string => `${pair[0]}|${pair[1]}`;

/**
 * Which posts join which war, and which pairs become a new narrative (see the header). `posts` are
 * stored posts in no narrative; `narratives` the open ones with two countries or more.
 */
export function planFights(input: { readonly posts: readonly FightPost[]; readonly narratives: readonly FightNarrative[]; readonly nowMs: number }, p: Policy): FightPlan {
  const f = p.narrative.fight;
  const n = f.native;
  const joins = new Map<string, string[]>();
  if (!f.on || !n.on) return { joins, seeds: [] };
  const live = input.narratives
    .filter((x) => x.newestPostAtMs !== null && input.nowMs - x.newestPostAtMs <= f.activeMs)
    .map((x) => ({ ...x, holds: new Set(x.countries.map((c) => canonicalCountry(c, p))) }))
    .sort((a, b) => (b.newestPostAtMs ?? 0) - (a.newestPostAtMs ?? 0) || a.id.localeCompare(b.id));
  const viral = input.posts
    .filter((x) => x.reach !== null && x.reach >= n.minReach && input.nowMs - x.atMs <= n.lookbackMs && x.atMs <= input.nowMs)
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0) || a.itemId.localeCompare(b.itemId));
  const unplaced = new Map<string, FightPost[]>();
  let joined = 0;
  for (const post of viral) {
    const pairs = fightPairsOf(post, p);
    if (pairs.length === 0) continue;
    const target = live.find((x) => pairs.some(([a, b]) => x.holds.has(a) && x.holds.has(b)));
    if (target !== undefined) {
      if (joined >= n.perPass) continue;
      joins.set(target.id, [...(joins.get(target.id) ?? []), post.itemId]);
      joined += 1;
      continue;
    }
    for (const pair of pairs) unplaced.set(pairKey(pair), [...(unplaced.get(pairKey(pair)) ?? []), post]);
  }
  const used = new Set<string>();
  const seeds: { countries: readonly [string, string]; members: readonly string[] }[] = [];
  for (const [key, list] of [...unplaced].sort(([a], [b]) => a.localeCompare(b))) {
    const recent = list.filter((x) => input.nowMs - x.atMs <= n.seedWithinMs && !used.has(x.itemId)).slice(0, n.seedMaxPosts);
    const accounts = new Set(recent.map((x) => x.authorKey ?? `post:${x.itemId}`)).size;
    if (recent.length < n.seedMinPosts || accounts < n.seedMinAccounts) continue;
    for (const x of recent) used.add(x.itemId);
    const [a, b] = key.split('|') as [string, string];
    seeds.push({ countries: [a, b], members: [...recent].sort((x, y) => x.atMs - y.atMs || x.itemId.localeCompare(y.itemId)).map((x) => x.itemId) });
  }
  return { joins, seeds };
}

/** Whether a titler's answer names both countries of a seed's pair (in any spelling the aliases know). */
export function answerHoldsPair(answer: readonly string[], pair: readonly string[], p: Policy): boolean {
  const said = new Set(answer.map((c) => canonicalCountry(c, p)));
  return pair.length >= 2 && pair.every((c) => said.has(canonicalCountry(c, p)));
}
