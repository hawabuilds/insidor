/**
 * THE SHORT-VIDEO SEARCH'S EXTRA WORDS, AND WHO IT WATCHES: the trend list's rising tags, the tags,
 * sounds and creators of posts that were coined, the asks that search them newest first, and the
 * young videos read again more often (Policy.finders.trends / learned / creators / young).
 *
 * The owner, 2026-10-15: fixed search words cannot find viral short videos (many are tagged only
 * #fyp); search what is rising, learn from what got coined, and watch creators who were coined
 * before. Four parts, each behind its own switch and its own clock:
 *
 *   trends    once a day (the list is daily and two days behind): the source's rising tags for
 *             each region, into internal.search_word as origin 'trend'
 *   learned   once a day: every coined post of the last `lookbackMs` (coined_post_lead, 0083) counted
 *             by tag, sound and creator, the top ones as origin 'coined' — free, and the list the
 *             owner is shown (tools/coined-words.ts)
 *   asks      (`trends.asksOn`) every `trends.askEveryMs` slot: the next `wordsPerAsk` words (rising
 *             trend tags first, then learned tags), newest first, credited to the 'trend' lane;
 *             every `creators.askEveryMs` slot: the next `perAsk` learned creators' newest posts,
 *             the 'creator' lane. Both held to the watch list's age (arrivals.ts).
 *   young     every `young.runEveryMinutes`: the fastest-rising found videos under `maxAgeMin` old,
 *             read again by id, so their speed is measured in minutes, not half hours
 *
 * A sound is learned and listed, never searched: the source's search takes words, and a sound is
 * an id. The judge and the hold decide every post these asks find, as for any lane.
 *
 * What breaks if changed carelessly: the asks keep their slot in memory, so a restart may ask one
 * slot twice; the daily lists are dated in the database, so a restart never re-buys the trend list.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgFinderRepo, SearchWord } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';

const TAG = /#([\p{L}\p{N}_]+)/gu;
const CALL_DEADLINE_MS = 120_000;
const MS_PER_MINUTE = 60_000;

export interface SearchWordDeps {
  readonly finders: Pick<PgFinderRepo, 'searchWords' | 'replaceSearchWords' | 'searchWordsAt' | 'coinedPosts' | 'youngPosts'>;
  /** The live sources, on the live meter. */
  readonly sources: () => readonly PlatformAdapter[];
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

/** The slots each ask last went out in, kept by the loop between passes. */
export interface SearchWordClock {
  words: number | null;
  creators: number | null;
  young: number | null;
}

export const searchWordClock = (): SearchWordClock => ({ words: null, creators: null, young: null });

export interface SearchWordResult {
  readonly trendWords: number;
  readonly learnedWords: number;
  readonly asked: readonly string[];
  readonly stored: number;
  readonly youngRead: number;
  readonly usd: number;
}

/** The source asked by word: one with no catch-all that takes keywords (the short-video source). */
const wordSource = (sources: readonly PlatformAdapter[]): PlatformAdapter | null =>
  sources.find((a) => !a.capabilities.discovery.includes('catchall') && a.capabilities.discovery.includes('keyword')) ?? null;

/**
 * The tags, sounds and creators of the searched source's coined posts, counted: a tag or sound on at
 * least `minPosts` coined posts, a creator on any; the words in `skip` and bare numbers never. Pure;
 * exported for the report tool (tools/coined-words.ts).
 */
export function learnWords(posts: readonly { readonly source: string; readonly handle: string | null; readonly body: string; readonly formatIds: readonly string[] }[], wordSourceId: string, policy: Policy): readonly SearchWord[] {
  const l = policy.finders.learned;
  const skip = new Set(l.skip.map((w) => w.toLowerCase()));
  const tags = new Map<string, number>();
  const sounds = new Map<string, number>();
  const creators = new Map<string, number>();
  for (const p of posts) {
    /* The searched source's posts only: a text post's tags are the coin's promoters' (#solana,
       #memecoin), measured 2026-10-15, and say nothing about which videos get coined. */
    if (p.source !== wordSourceId) continue;
    for (const t of new Set([...p.body.matchAll(TAG)].map((m) => (m[1] ?? '').toLowerCase()).filter((t) => t !== '' && !/^\d+$/.test(t) && !skip.has(t)))) tags.set(t, (tags.get(t) ?? 0) + 1);
    for (const f of p.formatIds) if (f.includes(':sound:')) sounds.set(f, (sounds.get(f) ?? 0) + 1);
    if (p.handle !== null && p.handle !== '') creators.set(p.handle, (creators.get(p.handle) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, min: number, n: number) =>
    [...m].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
  return [
    ...top(tags, l.minPosts, l.topTags).map(([value, c], i): SearchWord => ({ origin: 'coined', kind: 'tag', source: wordSourceId, value, rank: i + 1, facts: { coinedPosts: c } })),
    ...top(sounds, l.minPosts, l.topSounds).map(([value, c], i): SearchWord => ({ origin: 'coined', kind: 'sound', source: wordSourceId, value, rank: i + 1, facts: { coinedPosts: c } })),
    ...top(creators, 1, l.topCreators).map(([value, c], i): SearchWord => ({ origin: 'coined', kind: 'creator', source: wordSourceId, value, rank: i + 1, facts: { coinedPosts: c } })),
  ];
}

/** The words asked in slot `slot`: the next `n` of the list, from the clock, so asks walk it. */
export function wordsForSlot(words: readonly string[], n: number, slot: number): readonly string[] {
  if (words.length === 0) return [];
  const k = Math.min(words.length, Math.max(1, Math.trunc(n)));
  const start = (slot * k) % words.length;
  return Array.from({ length: k }, (_, i) => words[(start + i) % words.length] ?? '').filter((w) => w !== '');
}

async function paid<T>(deps: SearchWordDeps, vendor: string, usd: number, what: string, call: () => Promise<T>): Promise<T | null> {
  if (deps.mode === 'dry') {
    deps.log.info(`DRY RUN — ${what} priced, not sent`, { wouldSpendUsd: usd });
    return null;
  }
  if (!deps.meter.mayspend(vendor, usd)) {
    deps.log.info(`${what} waits: the line is spent for today`, { wouldSpendUsd: usd });
    return null;
  }
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof BudgetRefused)) deps.log.warn(`${what} failed; tried again next slot`, { err: errorText(e) });
    return null;
  }
}

const budgetOf = (deps: SearchWordDeps, vendor: string) => {
  const line = deps.meter.line(vendor);
  return { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (deps.now() + CALL_DEADLINE_MS) as Millis };
};

export async function searchWordsPass(deps: SearchWordDeps, clock: SearchWordClock): Promise<SearchWordResult> {
  const f = deps.policy.finders;
  const now = deps.now();
  const source = wordSource(deps.sources());
  let usd = 0;
  let trendWords = 0;
  let learnedWords = 0;
  let stored = 0;
  let youngRead = 0;
  const asked: string[] = [];
  if (source === null) return { trendWords, learnedWords, asked, stored, youngRead, usd };
  const sourceId = String(source.id);

  /* 1. The trend list, once a day. */
  if (f.trends.on && source.trendWords !== undefined && source.estimateTrendWords !== undefined) {
    const at = await deps.finders.searchWordsAt('trend');
    if (at === null || now - at >= f.trends.everyMs) {
      const ask = { regions: f.trends.regions, perRegion: f.trends.perKind };
      const quote = source.estimateTrendWords(ask);
      const got = await paid(deps, quote.vendor, quote.usd, 'the trend list', () => source.trendWords!(ask, budgetOf(deps, quote.vendor)));
      if (got !== null) {
        usd += got.spend.usd;
        /* Rising first, then by the list's own rank; one row per word across regions. */
        const words = [...got.value].sort((a, b) => Number(b.rising === true) - Number(a.rising === true) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
        await deps.finders.replaceSearchWords('trend', words.map((w, i) => ({ origin: 'trend', kind: w.kind, source: sourceId, value: w.value.toLowerCase(), rank: i + 1, facts: { ...w.facts, region: w.region, rising: w.rising } })), now);
        trendWords = words.length;
      }
    }
  }

  /* 2. The learned words, once a day; free. */
  if (f.learned.on) {
    const at = await deps.finders.searchWordsAt('coined');
    if (at === null || now - at >= f.learned.everyMs) {
      const learned = learnWords(await deps.finders.coinedPosts((now - f.learned.lookbackMs) as Millis), sourceId, deps.policy);
      if (deps.mode === 'live') await deps.finders.replaceSearchWords('coined', learned, now);
      learnedWords = learned.length;
      deps.log.info('words learned from coined posts', { tags: learned.filter((w) => w.kind === 'tag').map((w) => w.value), creators: learned.filter((w) => w.kind === 'creator').length });
    }
  }

  const all = f.trends.on || f.learned.on || f.creators.on ? await deps.finders.searchWords(['trend', 'coined']) : [];
  const own = new Set(deps.policy.feed.hashtags.map((w) => w.toLowerCase()));

  /* 3. The word asks: rising trend tags first, then learned tags, never the owner's own words. */
  const tagWords = !f.trends.asksOn ? [] : [...new Set([...all.filter((w) => w.origin === 'trend' && f.trends.on), ...all.filter((w) => w.origin === 'coined' && f.learned.on)].filter((w) => w.kind === 'tag' && w.source === sourceId).map((w) => w.value))].filter((w) => !own.has(w));
  const wordSlot = Math.floor(now / f.trends.askEveryMs);
  if (tagWords.length > 0 && clock.words !== wordSlot) {
    clock.words = wordSlot;
    const words = wordsForSlot(tagWords, f.trends.wordsPerAsk, wordSlot);
    const query: DiscoveryQuery = { mode: 'keyword', term: words[0] ?? '', terms: words, sinceMs: null, untilMs: null, limit: deps.policy.feed.hashtagResults, cursor: null };
    const quote = source.estimate({ kind: 'discover', query });
    const got = await paid(deps, quote.vendor, quote.usd, 'the trend and learned words', () => source.discover(query, budgetOf(deps, quote.vendor)));
    if (got !== null) {
      usd += got.spend.usd;
      stored += await deps.store(got.value.items, got.value.authors, 'trend');
      asked.push(...words);
    }
  }

  /* 4. The creators with a coined post before: their newest posts. */
  const creators = f.creators.on ? all.filter((w) => w.origin === 'coined' && w.kind === 'creator' && w.source === sourceId).map((w) => w.value) : [];
  const creatorSlot = Math.floor(now / f.creators.askEveryMs);
  if (creators.length > 0 && clock.creators !== creatorSlot && source.capabilities.discovery.includes('account')) {
    clock.creators = creatorSlot;
    for (const handle of wordsForSlot(creators, f.creators.perAsk, creatorSlot)) {
      const query: DiscoveryQuery = { mode: 'account', term: handle, sinceMs: null, untilMs: null, limit: f.creators.postsPerCreator, cursor: null };
      const quote = source.estimate({ kind: 'discover', query });
      const got = await paid(deps, quote.vendor, quote.usd, 'a coined creator\'s newest posts', () => source.discover(query, budgetOf(deps, quote.vendor)));
      if (got === null) continue;
      usd += got.spend.usd;
      stored += await deps.store(got.value.items, got.value.authors, 'creator');
      asked.push(`@${handle}`);
    }
  }

  /* 5. Young videos read again sooner. */
  const youngSlot = Math.floor(now / (f.young.runEveryMinutes * MS_PER_MINUTE));
  if (f.young.on && clock.young !== youngSlot && source.lookup !== undefined) {
    clock.young = youngSlot;
    const ids = await deps.finders.youngPosts(sourceId, (now - f.young.maxAgeMin * MS_PER_MINUTE) as Millis, f.young.maxPosts);
    if (ids.length > 0) {
      const quote = source.estimate({ kind: 'observe', sourceItemIds: ids });
      const got = await paid(deps, quote.vendor, quote.usd, 'young videos read again', () => source.lookup!(ids, budgetOf(deps, quote.vendor)));
      if (got !== null) {
        usd += got.spend.usd;
        /* Stored with no lane: the reading is what is wanted, and arrivals.ts saves it as an observation. */
        await deps.store(got.value.items, got.value.authors, null);
        youngRead = got.value.items.length;
      }
    }
  }

  if (trendWords + learnedWords + asked.length + youngRead > 0) deps.log.info('search words pass', { trendWords, learnedWords, asked, stored, youngRead, usd });
  return { trendWords, learnedWords, asked, stored, youngRead, usd };
}
