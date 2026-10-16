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
 *   sounds    every `sounds.askEveryMs` slot: the next `perAsk` learned sounds' posts, one page each
 *             on the source's sound endpoint (`soundPosts`), the 'trend' lane like the learned words
 *   learned tags  (`learnedTags`) every `learnedTags.askEveryMs` slot: the next `wordsPerAsk` of the
 *             top tags the coined-video training set teaches, as the latest re-tune recorded them,
 *             newest first, the 'learned_tag' lane (0088), inside its own daily cap
 *
 * The source's search takes words and a sound is an id, so a sound is asked on its own endpoint
 * (since 2026-10-16; before, sounds were learned and listed only). The judge and the hold decide
 * every post these asks find, as for any lane.
 *
 * What breaks if changed carelessly: the asks keep their slot in memory, so a restart may ask one
 * slot twice; the daily lists are dated in the database, so a restart never re-buys the trend list.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgFinderRepo, SearchWord } from '@insidor/store';
import { laneJudgeUsd, laneMayAsk } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { LaneLedger } from './lane-ledger.ts';

const TAG = /#([\p{L}\p{N}_]+)/gu;
const CALL_DEADLINE_MS = 120_000;
const MS_PER_MINUTE = 60_000;

export interface SearchWordDeps {
  readonly finders: Pick<PgFinderRepo, 'searchWords' | 'replaceSearchWords' | 'searchWordsAt' | 'coinedPosts' | 'youngPosts' | 'postsTurning'>;
  /** The live sources, on the live meter. */
  readonly sources: () => readonly PlatformAdapter[];
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
  /**
   * The learned-tag lane (`finders.learnedTags`): the tags the latest re-tune learned, most coined
   * first; its ledger (0088); and how many of a run's videos no lane holds yet. Absent: not asked.
   */
  readonly learnedTags?: {
    readonly tags: () => Promise<readonly string[]>;
    readonly ledger: LaneLedger;
    readonly uncredited: (itemIds: readonly string[]) => Promise<number>;
  };
}

/** The slots each ask last went out in, kept by the loop between passes. */
export interface SearchWordClock {
  words: number | null;
  creators: number | null;
  young: number | null;
  sounds: number | null;
  learnedTags: number | null;
}

export const searchWordClock = (): SearchWordClock => ({ words: null, creators: null, young: null, sounds: null, learnedTags: null });

/**
 * The words the learned-tag lane walks: the re-tune's tags in its order, lower-cased, without the
 * owner's own words (the watch list asks those) or the skip list, at most `learnedTags.topTags`.
 * Pure; exported for its test.
 */
export function learnedTagWords(tags: readonly string[], policy: Policy): readonly string[] {
  const not = new Set([...policy.feed.hashtags, ...policy.finders.learned.skip].map((w) => w.trim().toLowerCase()));
  const kept = [...new Set(tags.map((t) => t.trim().replace(/^#/, '').toLowerCase()))].filter((t) => t !== '' && !not.has(t));
  return kept.slice(0, Math.max(0, Math.trunc(policy.finders.learnedTags.topTags)));
}

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

  const all = f.trends.on || f.learned.on || f.creators.on || f.sounds.on ? await deps.finders.searchWords(['trend', 'coined']) : [];
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

  /* 3b. The learned-tag lane: the training set's tags, newest first, inside its own cap. */
  const lt = f.learnedTags;
  const ltSlot = Math.floor(now / lt.askEveryMs);
  if (lt.on && deps.learnedTags !== undefined && clock.learnedTags !== ltSlot) {
    let tags: readonly string[] = [];
    try {
      tags = learnedTagWords(await deps.learnedTags.tags(), deps.policy);
    } catch (e) {
      deps.log.warn('the learned tags could not be read; the lane waits for the next slot', { err: errorText(e) });
    }
    if (tags.length > 0) {
      clock.learnedTags = ltSlot;
      const words = wordsForSlot(tags, lt.wordsPerAsk, ltSlot);
      const query: DiscoveryQuery = { mode: 'keyword', term: words[0] ?? '', terms: words, sinceMs: null, untilMs: null, limit: deps.policy.feed.hashtagResults, cursor: null };
      const quote = source.estimate({ kind: 'discover', query });
      /* An unreadable ledger (null, logged by the ledger) asks nothing it cannot count. */
      const spent = await deps.learnedTags.ledger.spent('learned_tag', now);
      if (spent !== null && !laneMayAsk(spent, quote.usd, lt.cap)) {
        deps.log.info('the learned-tag lane has spent its day; not asked', { spentUsd: spent, capUsd: lt.cap.dailyUsd });
      } else if (spent !== null) {
        const got = await paid(deps, quote.vendor, quote.usd, 'the learned tags', () => source.discover(query, budgetOf(deps, quote.vendor)));
        if (got !== null) {
          usd += got.spend.usd;
          /* Only videos young enough to be credited bring judging in (arrivals.ts holds the lane to the watch list's age). */
          const young = got.value.items.filter((i) => i.postedAt !== null && now - i.postedAt <= deps.policy.feed.watchMaxAgeMs);
          let fresh = young.length;
          try {
            fresh = await deps.learnedTags.uncredited(young.map((i) => String(i.itemId)));
          } catch (e) {
            deps.log.warn('could not count the learned-tag lane\'s new videos; charging it for all of them', { err: errorText(e) });
          }
          await deps.learnedTags.ledger.add('learned_tag', now, got.spend.usd + laneJudgeUsd(fresh, lt.cap));
          stored += await deps.store(got.value.items, got.value.authors, 'learned_tag');
          asked.push(...words.map((w) => `#${w}`));
          deps.log.info('learned-tag lane', { words, returned: got.value.items.length, new: fresh, searchUsd: got.spend.usd, spentBeforeUsd: spent, capUsd: lt.cap.dailyUsd });
        }
      }
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

  /* 4b. The learned sounds: their posts, one page a sound. */
  const sounds = f.sounds.on && source.soundPosts !== undefined ? all.filter((w) => w.origin === 'coined' && w.kind === 'sound' && w.source === sourceId).map((w) => w.value) : [];
  const soundSlot = Math.floor(now / f.sounds.askEveryMs);
  if (sounds.length > 0 && clock.sounds !== soundSlot) {
    clock.sounds = soundSlot;
    for (const sound of wordsForSlot(sounds, f.sounds.perAsk, soundSlot)) {
      const quote = source.estimateSoundPosts?.(sound);
      if (quote === undefined) break;
      const got = await paid(deps, quote.vendor, quote.usd, 'a learned sound\'s posts', () => source.soundPosts!(sound, budgetOf(deps, quote.vendor)));
      if (got === null) continue;
      usd += got.spend.usd;
      stored += await deps.store(got.value.items, got.value.authors, 'trend');
      asked.push(sound);
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
    /* 5b. The videos turning 6 and 50 minutes old since the last run, and the late check's slow growers. */
    const span = f.young.runEveryMinutes * MS_PER_MINUTE;
    const turning = [
      ...(f.young.atAges.on ? f.young.atAges.ages.map((age) => ({ age, minReach: 0, max: f.young.atAges.maxPosts })) : []),
      ...(f.young.late.on ? [{ age: f.young.late.ageMin, minReach: f.young.late.minReach, max: f.young.late.maxPosts }] : []),
    ];
    const due = new Set<string>(ids);
    for (const t of turning) {
      const to = (now - t.age * MS_PER_MINUTE) as Millis;
      for (const id of await deps.finders.postsTurning(sourceId, (to - span) as Millis, to, t.minReach, (now - span) as Millis, t.max)) due.add(id);
    }
    const more = [...due].filter((id) => !ids.includes(id));
    if (more.length > 0) {
      const quote = source.estimate({ kind: 'observe', sourceItemIds: more });
      const got = await paid(deps, quote.vendor, quote.usd, 'videos read at their band ages', () => source.lookup!(more, budgetOf(deps, quote.vendor)));
      if (got !== null) {
        usd += got.spend.usd;
        await deps.store(got.value.items, got.value.authors, null);
        youngRead += got.value.items.length;
      }
    }
  }

  if (trendWords + learnedWords + asked.length + youngRead > 0) deps.log.info('search words pass', { trendWords, learnedWords, asked, stored, youngRead, usd });
  return { trendWords, learnedWords, asked, stored, youngRead, usd };
}
