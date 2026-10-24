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
 * ★ THE CATCH-UP (policy.v162): the caller also hands in, every `catchUpEveryMs`, the posts its words
 * search found back to each war's start, in a narrative or not, and the small narratives holding them:
 *
 *   window   a post joins war W only if it went up no earlier than `warLeadMs` before W's oldest own
 *            post (`startAtMs`, never an early one) and inside the active week; one older than that
 *            own post joins as EARLY, so the start never moves and the window cannot creep back day
 *            by day (the 17-19 Oct riots sit behind France vs Japan's lead and stay out)
 *   alike    a post that names two of W's countries but has no pair of W in its own language (an
 *            English post: English has no home country) joins only when its vector is at least
 *            `narrative.nameMeaning` from one of W's posts — the grouping's own bar for two posts
 *            sharing a name; with no vector it waits, never joins on the words alone
 *   quote    a post that quotes or links one of W's posts (`posts`), in the language of one of W's
 *            countries that is not the quoted post's own (a Japanese quote of a French war post),
 *            joins W though it names no country (`answersOn`, policy.v169): answering the other
 *            side's post is taking part. Same views bar, same window; a quote in the quoted post's
 *            own language, or in one with no home (English), does not join by this rule
 *   placed   a narrative all of whose posts are W's is merged into W (its link then leads there); one
 *            of at most `moveMaxPosts` posts gives up only its posts at the views bar that are W's.
 *            The caller never offers a war, a narrative the owner called on, or one he renamed
 *
 * What breaks if changed carelessly: the word match. A word without `*` matches only whole, so
 * Turkish "çin" is not "çini" (tile) or "çinko" (zinc); in a script written without spaces a word
 * matches anywhere, because there is no word edge to find (일본은, 土耳其人). And the quote rule's side:
 * a quote in the quoted post's own language joining would let one side's pile-on of its own post
 * (a French quote of a French post about Algeria) into the war with no word of the other country.
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
  /** Its words-and-picture vector (unit length); absent or null: none, so it cannot be alike. */
  readonly vector?: Float32Array | null;
  /** The posts it quotes or links; absent: none known, so it cannot join by a quote. */
  readonly refersTo?: readonly string[];
}

/** An open narrative a pair's posts could join. */
export interface FightNarrative {
  readonly id: string;
  /** Its countries as stored (the titler's spelling, the owner's, or a seed's). */
  readonly countries: readonly string[];
  readonly newestPostAtMs: number | null;
  /** Its oldest own post's time (never an early post's); absent or null: not known, the two-day read only. */
  readonly startAtMs?: number | null;
  /** Its posts' vectors, for the alike rule; absent: none. */
  readonly vectors?: readonly Float32Array[];
  /**
   * Its posts (own and early) and each one's language, for the quote rule; absent: no post joins it
   * by a quote. ★ The caller leaves this out for a seed still waiting for the titler: a count of
   * posts naming a country may be the news, and a quote of the news is not a war post.
   */
  readonly posts?: ReadonlyMap<string, string | null>;
}

/** A small narrative that is not a war, holding a post of the catch-up, with all its posts. */
export interface PlacedNarrative {
  readonly id: string;
  readonly members: readonly FightPost[];
}

export interface FightPlan {
  /** Narrative → the posts that join it this pass. */
  readonly joins: ReadonlyMap<string, readonly string[]>;
  /** Narrative → the posts that join it as early posts: older than its own oldest post. */
  readonly early: ReadonlyMap<string, readonly string[]>;
  /** New narratives: the pair (alphabetical) and their posts, oldest first. */
  readonly seeds: readonly { readonly countries: readonly [string, string]; readonly members: readonly string[] }[];
  /** Small narratives wholly a war's: merged into it. */
  readonly merges: readonly { readonly from: string; readonly into: string }[];
  /** A war's posts that leave a small mixed narrative for it. */
  readonly moves: readonly { readonly itemId: string; readonly from: string; readonly into: string }[];
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

/** Every country a post's language table names in it (alphabetical), its own included; empty when the language has no table. */
export function countriesIn(lang: string | null, text: string, p: Policy): readonly string[] {
  const table = lang === null ? undefined : p.narrative.fight.native.names[lang];
  if (lang === null || table === undefined) return [];
  const body = lower(text, lang);
  const out = Object.entries(table)
    .filter(([, words]) => words.some((w) => hasWord(body, lower(w, lang))))
    .map(([country]) => country);
  return [...new Set(out)].sort();
}

/** The other countries a post names in its own language (alphabetical); empty when its language has no home country. */
export function countriesNamed(lang: string | null, text: string, p: Policy): readonly string[] {
  const n: NativePolicy = p.narrative.fight.native;
  const home = lang === null ? undefined : n.home[lang];
  if (home === undefined) return [];
  return countriesIn(lang, text, p).filter((c) => c !== home);
}

/**
 * The live wars' words per language, for the catch-up's search (store `fightWarPosts`): in a war's
 * own languages the other side's names, in a language with no home every side's. A trailing `*` is
 * dropped: the search is only a first sift, `hasWord` decides. Languages alphabetical, words once.
 */
export function warWords(wars: readonly Pick<FightNarrative, 'countries'>[], p: Policy): readonly { readonly lang: string; readonly words: readonly string[] }[] {
  const n: NativePolicy = p.narrative.fight.native;
  const out = new Map<string, Set<string>>();
  for (const w of wars) {
    const holds = new Set(w.countries.map((c) => canonicalCountry(c, p)));
    if (holds.size < 2) continue;
    for (const [lang, table] of Object.entries(n.names)) {
      const home = n.home[lang];
      if (home !== undefined && !holds.has(home)) continue;
      for (const [country, words] of Object.entries(table)) {
        if (country === home || !holds.has(country)) continue;
        const set = out.get(lang) ?? new Set<string>();
        for (const word of words) set.add(word.endsWith('*') ? word.slice(0, -1) : word);
        out.set(lang, set);
      }
    }
  }
  return [...out].sort(([a], [b]) => a.localeCompare(b)).map(([lang, words]) => ({ lang, words: [...words].sort() }));
}

/** The post's pairs: its language's country with each country it names, each pair alphabetical. */
export function fightPairsOf(post: Pick<FightPost, 'lang' | 'text'>, p: Policy): readonly (readonly [string, string])[] {
  const home = post.lang === null ? undefined : p.narrative.fight.native.home[post.lang];
  if (home === undefined) return [];
  return countriesNamed(post.lang, post.text, p).map((c) => (home < c ? [home, c] as const : [c, home] as const));
}

const pairKey = (pair: readonly [string, string]): string => `${pair[0]}|${pair[1]}`;

const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
};

type LiveWar = FightNarrative & { readonly holds: ReadonlySet<string> };

/** The live war `post` is a post of, and whether it joins as an early post; null for none (see the header). */
function warOf(post: FightPost, live: readonly LiveWar[], nowMs: number, p: Policy): { readonly war: LiveWar; readonly early: boolean } | null {
  const f = p.narrative.fight;
  const n = f.native;
  const within = (w: LiveWar): boolean => {
    const lead = w.startAtMs === null || w.startAtMs === undefined ? Number.POSITIVE_INFINITY : w.startAtMs - n.warLeadMs;
    return post.atMs <= nowMs && post.atMs >= Math.max(nowMs - f.activeMs, Math.min(nowMs - n.lookbackMs, lead));
  };
  const as = (w: LiveWar) => ({ war: w, early: w.startAtMs !== null && w.startAtMs !== undefined && post.atMs < w.startAtMs });
  const pairs = fightPairsOf(post, p);
  const native = live.find((w) => within(w) && pairs.some(([a, b]) => w.holds.has(a) && w.holds.has(b)));
  if (native !== undefined) return as(native);
  /* ★ The quote rule: the other side answering a war post, in its own language (see the header). */
  const side = post.lang === null ? undefined : n.home[post.lang];
  if (n.answersOn && side !== undefined && (post.refersTo ?? []).length > 0) {
    const answers = (w: LiveWar): boolean => w.holds.has(side) && (post.refersTo ?? []).some((ref) => {
      if (w.posts === undefined || !w.posts.has(ref)) return false;
      const lang = w.posts.get(ref) ?? null;
      return (lang === null ? undefined : n.home[lang]) !== side;
    });
    const quoted = live.find((w) => within(w) && answers(w));
    if (quoted !== undefined) return as(quoted);
  }
  const v = post.vector;
  if (v === null || v === undefined) return null;
  const named = new Set(countriesIn(post.lang, post.text, p).map((c) => canonicalCountry(c, p)));
  let best: { readonly war: LiveWar; readonly meaning: number } | null = null;
  for (const w of live) {
    if (!within(w) || [...w.holds].filter((c) => named.has(c)).length < 2) continue;
    const meaning = Math.max(Number.NEGATIVE_INFINITY, ...(w.vectors ?? []).map((x) => dot(v, x)));
    if (meaning >= p.narrative.nameMeaning && (best === null || meaning > best.meaning)) best = { war: w, meaning };
  }
  return best === null ? null : as(best.war);
}

/**
 * Which posts join which war, which small narratives fold into one, and which pairs become a new
 * narrative (see the header). `posts` are stored posts in no narrative; `narratives` the open ones
 * with two countries or more; `placed` the small narratives (not wars) holding a catch-up post, whole.
 */
export function planFights(input: { readonly posts: readonly FightPost[]; readonly narratives: readonly FightNarrative[]; readonly nowMs: number; readonly placed?: readonly PlacedNarrative[] }, p: Policy): FightPlan {
  const f = p.narrative.fight;
  const n = f.native;
  const joins = new Map<string, string[]>();
  const early = new Map<string, string[]>();
  const merges: { from: string; into: string }[] = [];
  const moves: { itemId: string; from: string; into: string }[] = [];
  if (!f.on || !n.on) return { joins, early, seeds: [], merges, moves };
  const live: LiveWar[] = input.narratives
    .filter((x) => x.newestPostAtMs !== null && input.nowMs - x.newestPostAtMs <= f.activeMs)
    .map((x) => ({ ...x, holds: new Set(x.countries.map((c) => canonicalCountry(c, p))) }))
    .sort((a, b) => (b.newestPostAtMs ?? 0) - (a.newestPostAtMs ?? 0) || a.id.localeCompare(b.id));
  const atBar = (x: FightPost): boolean => x.reach !== null && x.reach >= n.minReach;
  const byReach = (a: FightPost, b: FightPost): number => (b.reach ?? 0) - (a.reach ?? 0) || a.itemId.localeCompare(b.itemId);
  const viral = input.posts.filter((x) => atBar(x) && x.atMs <= input.nowMs).sort(byReach);
  const unplaced = new Map<string, FightPost[]>();
  const taken = new Set<string>();
  let joined = 0;
  const add = (to: Map<string, string[]>, war: string, id: string) => to.set(war, [...(to.get(war) ?? []), id]);
  for (const post of viral) {
    if (taken.has(post.itemId)) continue;
    const target = warOf(post, live, input.nowMs, p);
    if (target !== null) {
      if (joined >= n.perPass) continue;
      add(target.early ? early : joins, target.war.id, post.itemId);
      taken.add(post.itemId);
      joined += 1;
      continue;
    }
    /* ★ Only the two-day read's posts seed: a seed is a pair starting now, never the catch-up's old posts. */
    if (input.nowMs - post.atMs > n.lookbackMs) continue;
    for (const pair of fightPairsOf(post, p)) unplaced.set(pairKey(pair), [...(unplaced.get(pairKey(pair)) ?? []), post]);
  }
  /* The small narratives: wholly the war's, merged; mixed and small, its viral war posts move. */
  for (const nar of [...(input.placed ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    if (nar.members.length === 0 || live.some((w) => w.id === nar.id)) continue;
    const of = nar.members.map((m) => ({ m, w: warOf(m, live, input.nowMs, p) }));
    const lead = of.filter((x) => x.w !== null && atBar(x.m) && !taken.has(x.m.itemId)).sort((a, b) => byReach(a.m, b.m))[0];
    if (lead === undefined || lead.w === null) continue;
    const into = lead.w.war.id;
    if (of.every((x) => x.w !== null && x.w.war.id === into && !taken.has(x.m.itemId))) {
      if (joined + nar.members.length > n.perPass) continue;
      merges.push({ from: nar.id, into });
      for (const x of nar.members) taken.add(x.itemId);
      joined += nar.members.length;
      continue;
    }
    if (nar.members.length > n.moveMaxPosts) continue;
    for (const x of of) {
      if (x.w === null || x.w.war.id !== into || !atBar(x.m) || taken.has(x.m.itemId) || joined >= n.perPass) continue;
      moves.push({ itemId: x.m.itemId, from: nar.id, into });
      taken.add(x.m.itemId);
      joined += 1;
    }
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
  return { joins, early, seeds, merges, moves };
}

/** Whether a titler's answer names both countries of a seed's pair (in any spelling the aliases know). */
export function answerHoldsPair(answer: readonly string[], pair: readonly string[], p: Policy): boolean {
  const said = new Set(answer.map((c) => canonicalCountry(c, p)));
  return pair.length >= 2 && pair.every((c) => said.has(canonicalCountry(c, p)));
}
