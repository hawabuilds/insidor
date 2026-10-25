/**
 * THE MEME-WAR WORD SEARCH (`feed.fightWords`, policy.v158): each live meme war searched in each
 * side's own language for the other country's name — 土耳其 in Chinese and "çin" in Turkish for China
 * vs Turkey, "japon" in French and フランス in Japanese for France vs Japan — at a like floor (a
 * language's own in `byLang`: Japanese at 100, policy.v169), over the last `lookbackMs`. Its posts are stored under the 'narrative_name' lane, judged like any found post,
 * and joined to their war by the narratives pass (core group/fight-native.ts).
 *
 * Why it exists: on 23-24 Oct three of the owner's six missed war posts were never stored at all —
 * under every catch-all floor when the searches asked, or posted while they were out of money. The
 * catch-all search asks a language for everything at its floor; this asks it for one word, so a much
 * lower floor costs a few cents. The words are the native rule's own (`narrative.fight.native.names`),
 * so what is searched for is exactly what the join will accept.
 *
 * ★ THREE LIMITS, EACH CHECKED BEFORE EVERY ASK: the X search day's pace (`feed.searchDay`, the same
 * bill and pace the discover pass reads — an unreadable bill asks nothing), this search's own day
 * ('search:fight_words' in internal.lane_spend, `cap`) and the meter's line (both in work/lane-search.ts).
 * Nothing here raises any of them.
 *
 * ★ ONLY A WAR THE TITLER OR THE OWNER NAMED. A seed still waiting for the titler (`FIGHT_SEED_MODEL`)
 * is not searched: a count of posts naming a country is not yet a war (the riots of 18 Oct). The
 * wars of `narrative.fight.native.named` (policy.v175) are the owner's naming ahead of any narrative:
 * asked by their words whether a narrative holds them or not, so their posts are stored and can seed
 * one. A named war is asked once, as its narrative when one is live.
 *
 * ★ PHRASES (policy.v175 `narrative.fight.native.phrases`): a live war's phrases are asked too, a
 * phrase of several words as ONE ask holding them all (`allWords`: ベジータ アルジェリア lang:ja), the
 * first `phrasesPerSide` of each language. Only a war a narrative holds: a phrase joins nothing else.
 *
 * What breaks if changed carelessly: the window. Each ask reads the last `lookbackMs` again, so a post
 * is billed on every ask while inside it; a window much longer than `everyMs` multiplies the bill.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { canonicalCountry, homesOf, searchDayMayAsk } from '@insidor/core';
import { FIGHT_SEED_MODEL, type StoredNarrative } from '@insidor/store';

import { type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { LaneLedger } from './lane-ledger.ts';
import { laneSearch, type LaneAskEnd } from './lane-search.ts';

/** This search's own day in internal.lane_spend. */
export const FIGHT_WORDS_LANE = 'search:fight_words' as const;

/** One ask: a language, the word for the other country in it (or a war phrase), and the like floor it is asked at. */
export interface FightWord {
  readonly war: string;
  readonly lang: string;
  /** The word as asked; a phrase's words joined by a space. */
  readonly word: string;
  /** A phrase of several words: all of them, which a post must all hold. Absent: `word` alone. */
  readonly allWords?: readonly string[];
  readonly minApproval: number;
}

/**
 * The words a war is searched by: for each language one of whose homes is in the war, the first
 * `wordsPerSide` words that language names each other country of the war with, `*` dropped, at
 * `minApproval` likes — each the language's own in `byLang` when it has one; then, with `phrases`,
 * the first `phrasesPerSide` of the war's phrases in each language. Each ask once. Pure.
 */
export function fightWords(war: { readonly id: string; readonly countries: readonly string[] }, p: Policy, opts: { readonly phrases?: boolean } = {}): readonly FightWord[] {
  const n = p.narrative.fight.native;
  const fw = p.feed.fightWords;
  const countries = new Set(war.countries.map((c) => canonicalCountry(c, p)));
  const out: FightWord[] = [];
  const asked = new Set<string>();
  const ask = (lang: string, words: readonly string[], minApproval: number) => {
    const key = `${lang}:${words.join(' ')}`;
    if (words.length === 0 || asked.has(key)) return;
    asked.add(key);
    out.push({ war: war.id, lang, word: words.join(' '), ...(words.length > 1 ? { allWords: words } : {}), minApproval });
  };
  for (const lang of Object.keys(n.home)) {
    const homes = homesOf(lang, p).filter((h) => countries.has(h));
    if (homes.length === 0) continue;
    const bar = fw.byLang[lang] ?? fw;
    for (const [other, words] of Object.entries(n.names[lang] ?? {})) {
      if (!countries.has(other) || !homes.some((h) => h !== other)) continue;
      const picked = [...new Set(words.map((w) => w.replace(/\*$/, '').trim()).filter((w) => w !== ''))].slice(0, bar.wordsPerSide);
      for (const word of picked) ask(lang, [word], bar.minApproval);
    }
  }
  if (opts.phrases !== false) {
    for (const [key, byLang] of Object.entries(n.phrases)) {
      if (!key.split('|').every((c) => countries.has(canonicalCountry(c, p)))) continue;
      for (const [lang, list] of Object.entries(byLang)) {
        const bar = fw.byLang[lang];
        for (const phrase of list.slice(0, bar?.phrasesPerSide ?? fw.phrasesPerSide)) ask(lang, phrase.split(/\s+/u).filter((w) => w !== ''), bar?.minApproval ?? fw.minApproval);
      }
    }
  }
  return out;
}

/**
 * The wars this pass asks: the live ones the titler or the owner named, newest post first, then the
 * owner's `named` wars no live one holds (no narrative yet, so no phrases), at most `maxWars` in all.
 */
export function fightWarsToAsk(stored: readonly StoredNarrative[], p: Policy): readonly { readonly id: string; readonly countries: readonly string[]; readonly phrases: boolean }[] {
  const live = stored
    .filter((x) => x.shown && x.fightModel !== FIGHT_SEED_MODEL && (x.fight ?? []).length >= 2)
    .sort((a, b) => (b.newestPostAtMs ?? 0) - (a.newestPostAtMs ?? 0) || a.id.localeCompare(b.id))
    .map((x) => ({ id: x.id, countries: x.fight ?? [], phrases: true }));
  const holds = live.map((w) => new Set(w.countries.map((c) => canonicalCountry(c, p))));
  const named = p.narrative.fight.native.named
    .map((pair) => pair.map((c) => canonicalCountry(c, p)).sort())
    .filter((pair) => !holds.some((h) => pair.every((c) => h.has(c))))
    .map((pair) => ({ id: `named:${pair.join('|')}`, countries: pair, phrases: false }));
  return [...live, ...named].slice(0, p.feed.fightWords.maxWars);
}

export interface FightWordsDeps {
  readonly sources: () => readonly PlatformAdapter[];
  readonly narratives: { fights(sinceMs: number): Promise<readonly StoredNarrative[]> };
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly uncredited: (itemIds: readonly string[]) => Promise<number>;
  readonly ledger: LaneLedger;
  /** The X search day's bill since its start (`feed.searchDay`); null: unreadable. */
  readonly searchDay: { spent(vendor: string, now: Millis): Promise<number | null> };
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface FightWordsResult {
  readonly wars: number;
  readonly asked: number;
  readonly returned: number;
  readonly fresh: number;
  readonly usd: number;
  readonly stopped: LaneAskEnd | 'day' | null;
}

/**
 * ★ A NAMED WAR'S FIRST LOOK REACHES BACK (the owner, 2026-10-25: Saudi Arabia vs Argentina's posts of
 * 479k, 193k and 123k views went up between 02:00 and 06:00 UTC, the search was named at 14:50 and
 * reads ninety minutes, so none was ever stored and the war never seeded). A named war with no
 * narrative yet is asked once per process over `narrative.fight.native.lookbackMs` (two days, the
 * regroup's window), then over `lookbackMs` like every war. Once per process, not per pass: a named
 * war that never seeds would otherwise pay two days of posts every half hour inside the search's own
 * day cap and starve the live wars. A restart asks it once more, which is the only repeat.
 */
const lookedBack = new Set<string>();

/** For a test: forget which named wars already had their first look. */
export function forgetFirstLooks(): void {
  lookedBack.clear();
}

const NONE: FightWordsResult = { wars: 0, asked: 0, returned: 0, fresh: 0, usd: 0, stopped: null };
const PASS_ENDS: ReadonlySet<LaneAskEnd> = new Set(['capped', 'unreadable', 'budget', 'deadline', 'dry']);

export async function fightWordsPass(deps: FightWordsDeps): Promise<FightWordsResult> {
  const p = deps.policy;
  const fw = p.feed.fightWords;
  if (!fw.on || !p.narrative.fight.on) return NONE;
  const source = deps.sources().find((a) => a.capabilities.discovery.includes('keyword') && a.capabilities.narrowedSearch?.filter === true);
  if (source === undefined) return NONE;
  const started = deps.now();
  const deadline = (started + fw.passDeadlineMs) as Millis;
  const wars = fightWarsToAsk(await deps.narratives.fights(started - p.narrative.fight.activeMs), p);
  const words = wars.flatMap((x) => fightWords(x, p, { phrases: x.phrases }));
  const firstLook = new Set(wars.filter((x) => x.id.startsWith('named:') && !lookedBack.has(x.id)).map((x) => x.id));
  let asked = 0;
  let returned = 0;
  let fresh = 0;
  let usd = 0;
  let stopped: FightWordsResult['stopped'] = null;
  for (const w of words) {
    const now = deps.now();
    const query: DiscoveryQuery = {
      mode: 'keyword',
      term: w.word,
      ...(w.allWords === undefined ? {} : { allWords: w.allWords }),
      sinceMs: (now - (firstLook.has(w.war) ? p.narrative.fight.native.lookbackMs : fw.lookbackMs)) as Millis,
      untilMs: null,
      limit: p.feed.pageLimit,
      cursor: null,
      filter: { minApproval: Math.round(w.minApproval), mediaOnly: false, langs: [w.lang], excludeRebroadcasts: true },
    };
    /* ★ The X search day's pace first, as the discover pass checks it: an unreadable bill asks nothing. */
    if (p.feed.searchDay.on) {
      const quote = source.estimate({ kind: 'discover', query });
      const spent = await deps.searchDay.spent(quote.vendor, now);
      if (spent === null || !searchDayMayAsk(spent, quote.usd * fw.maxPagesPerAsk, now, p)) {
        stopped = 'day';
        break;
      }
    }
    const r = await laneSearch(deps, { adapter: source, query, lane: 'narrative_name', ledgerLane: FIGHT_WORDS_LANE, cap: fw.cap, maxPages: fw.maxPagesPerAsk, deadline });
    usd += r.usd;
    returned += r.returned;
    fresh += r.fresh;
    if (r.pages > 0) asked += 1;
    /* Its first look is spent once one of its words was answered; a pass stopped before it asks again. */
    if (r.pages > 0 && firstLook.has(w.war)) lookedBack.add(w.war);
    if (r.end === 'failed') deps.log.warn('a meme-war word search failed; the next pass reads its window again', { war: w.war, lang: w.lang, word: w.word, err: r.error });
    if (PASS_ENDS.has(r.end)) {
      stopped = r.end;
      break;
    }
  }
  const result: FightWordsResult = { wars: wars.length, asked, returned, fresh, usd, stopped };
  if (wars.length > 0) deps.log.info('meme-war word search pass', { ...result, ms: deps.now() - started });
  return result;
}
