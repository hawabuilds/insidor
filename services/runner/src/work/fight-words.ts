/**
 * THE MEME-WAR WORD SEARCH (`feed.fightWords`, policy.v158): each live meme war searched in each
 * side's own language for the other country's name — 土耳其 in Chinese and "çin" in Turkish for China
 * vs Turkey, "japon" in French and フランス in Japanese for France vs Japan — at a like floor, over the
 * last `lookbackMs`. Its posts are stored under the 'narrative_name' lane, judged like any found post,
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
 * is not searched: a count of posts naming a country is not yet a war (the riots of 18 Oct).
 *
 * What breaks if changed carelessly: the window. Each ask reads the last `lookbackMs` again, so a post
 * is billed on every ask while inside it; a window much longer than `everyMs` multiplies the bill.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { canonicalCountry, searchDayMayAsk } from '@insidor/core';
import { FIGHT_SEED_MODEL, type StoredNarrative } from '@insidor/store';

import { type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { LaneLedger } from './lane-ledger.ts';
import { laneSearch, type LaneAskEnd } from './lane-search.ts';

/** This search's own day in internal.lane_spend. */
export const FIGHT_WORDS_LANE = 'search:fight_words' as const;

/** One ask: a language and the word for the other country in it. */
export interface FightWord {
  readonly war: string;
  readonly lang: string;
  readonly word: string;
}

/**
 * The words a war is searched by: for each of its countries that is a language's home, the first
 * `wordsPerSide` words that language names each other country of the war with, `*` dropped. Pure.
 */
export function fightWords(war: { readonly id: string; readonly countries: readonly string[] }, p: Policy): readonly FightWord[] {
  const n = p.narrative.fight.native;
  const countries = new Set(war.countries.map((c) => canonicalCountry(c, p)));
  const out: FightWord[] = [];
  for (const [lang, home] of Object.entries(n.home)) {
    if (!countries.has(home)) continue;
    for (const [other, words] of Object.entries(n.names[lang] ?? {})) {
      if (other === home || !countries.has(other)) continue;
      const picked = [...new Set(words.map((w) => w.replace(/\*$/, '').trim()).filter((w) => w !== ''))].slice(0, p.feed.fightWords.wordsPerSide);
      for (const word of picked) out.push({ war: war.id, lang, word });
    }
  }
  return out;
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
  const wars = (await deps.narratives.fights(started - p.narrative.fight.activeMs))
    .filter((x) => x.shown && x.fightModel !== FIGHT_SEED_MODEL && (x.fight ?? []).length >= 2)
    .sort((a, b) => (b.newestPostAtMs ?? 0) - (a.newestPostAtMs ?? 0) || a.id.localeCompare(b.id))
    .slice(0, fw.maxWars);
  const words = wars.flatMap((x) => fightWords({ id: x.id, countries: x.fight ?? [] }, p));
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
      sinceMs: (now - fw.lookbackMs) as Millis,
      untilMs: null,
      limit: p.feed.pageLimit,
      cursor: null,
      filter: { minApproval: Math.round(fw.minApproval), mediaOnly: false, langs: [w.lang], excludeRebroadcasts: true },
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
