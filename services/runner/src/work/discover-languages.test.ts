/**
 * One search per language (work/languages.ts), against a source that answers each language on its
 * own, the way the posts supplier must be asked since it stopped honouring an OR of languages
 * (2026-10-16 23:15 UTC). The claims: every search the discover pass and the lane searches make
 * carries one language; each language pages on its own cursor, to its own end, empty run and page
 * limit; the caps (the middle lane's day, a search's own day, the meter) are totals across the
 * languages and are checked before every page of every language; the pages go round-robin, so a
 * language with endless pages (Japanese, the last two days) cannot take the others' share; a
 * language that fails is said by name and the others are stored; a band keeps each language's
 * window on its own clock.
 *
 * The source is a fake at the adapter's edge, scripted per language, recording every ask. It
 * refuses an OR of languages the way the adapter does, so a regression fails here too.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis, Policy } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Budget, CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';
import { BudgetRefused } from '@insidor/vendor-kit';

import type { Logger } from '../log.ts';
import { bandKey, discoverPass, memoryFreshClock, slowSliceQueries, type FreshClock } from './discover.ts';
import { memoryLaneLedger, type LaneLedger } from './lane-ledger.ts';
import { laneSearch } from './lane-search.ts';
import { languageAsks, roundOrder } from './languages.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const USD_PER_POST = 0.00015;
/* These tests are about splitting by language, so they pin the five languages they were written for. */
const P5 = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, langs: ['en', 'zxx', 'pt', 'qme', 'ja'] } } as typeof DEFAULT_POLICY;
const LANGS = P5.feed.langs;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/** What one language's page `page` (from 0) answers: a count of posts with more to come or not, or a throw. */
type Page = { readonly n: number; readonly more: boolean } | 'throw' | 'refuse';
type Script = (lang: string, page: number, q: DiscoveryQuery) => Page;

const isMiddle = (q: DiscoveryQuery): boolean => q.filter?.minApproval === P5.feed.middle.minApproval && q.untilMs === NOW - P5.feed.middle.minAgeMin * MIN;

function item(lang: string, i: number): Item {
  return {
    itemId: itemId(sourceId('x'), `${lang}${i}`), source: sourceId('x'), sourceItemId: `${lang}${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: NOW - 60 * MIN, firstSeenAt: NOW, lang, text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

interface Seen {
  readonly lang: string;
  readonly page: number;
  readonly q: DiscoveryQuery;
}

/** Answers each language from `script`; a cursor is `<lang>:<page>`, and one sent to another language is recorded. */
function source(seen: Seen[], script: Script, crossed: string[] = []): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
    narrowedSearch: { filter: true, reproductionsOf: true },
  };
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      const langs = q.filter?.langs ?? [];
      if (langs.length !== 1) throw new Error(`asked ${langs.length} languages in one search: ${langs.join(' OR ')}`);
      const lang = langs[0]!;
      const [owner, at] = q.cursor === null ? [lang, '0'] : q.cursor.split(':');
      if (owner !== lang) crossed.push(`${lang} sent ${q.cursor}`);
      const page = Number(at);
      seen.push({ lang, page, q });
      const answer = script(lang, page, q);
      if (answer === 'refuse') throw new BudgetRefused('x', 'discover', 'soft stop reached');
      if (answer === 'throw') throw new Error(`${lang} is down`);
      const items = Array.from({ length: answer.n }, (_v, k) => item(lang, 1_000 * page + k + (q.sinceMs ?? 0) % 1_000));
      const more = answer.more;
      return { value: { items, authors: [], cursor: more ? `${lang}:${page + 1}` : null, hasMore: more }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: Math.max(1, answer.n), usd: Math.max(1, answer.n) * USD_PER_POST, at: NOW } } as unknown as Metered<Discovered>;
    },
    observe: async () => { throw new Error('not used'); },
    estimate: (call: PlannedCall): CostEstimate => {
      const units = call.kind === 'discover' ? call.query.limit : call.sourceItemIds.length;
      return { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', estUnits: units, usd: units * USD_PER_POST };
    },
    toItem: () => item('en', 0),
    baselineKey: () => 'x',
  };
}

const registry = (adapter: PlatformAdapter) => ({ get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] }) as unknown as PlatformRegistry;
const openMeter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;
const withFeed = (feed: Partial<Policy['feed']>): Policy => ({ ...P5, feed: { ...P5.feed, ...feed } });
const MIDDLE_ONLY = withFeed({ middle: { ...P5.feed.middle, on: true } });

function pass(adapter: PlatformAdapter, policy: Policy, opts: { middle?: LaneLedger; fresh?: FreshClock; meter?: Meter; only?: 'middle'; mode?: 'live' | 'dry'; lanes?: readonly ('all' | 'media' | 'slow')[] } = {}) {
  const stored: { lane: unknown; langs: string[] }[] = [];
  const result = discoverPass({
    platforms: registry(adapter),
    store: async (items, _a, lane) => {
      stored.push({ lane, langs: items.map((i) => i.lang ?? '-') });
      return items.length;
    },
    plan: { terms: [], cadenceMs: 120_000 },
    policy, meter: opts.meter ?? openMeter, mode: opts.mode ?? 'live', log: quiet, now: () => NOW, signal: new AbortController().signal,
    floors: { floors: async () => ({}), set: async () => undefined },
    dailyCapUsd: 1,
    ...(opts.middle === undefined ? {} : { middle: { ledger: opts.middle, uncredited: async () => 0 } }),
    ...(opts.fresh === undefined ? {} : { fresh: opts.fresh }),
    ...(opts.only === undefined ? {} : { only: opts.only }),
    ...(opts.lanes === undefined ? {} : { lanes: opts.lanes }),
  });
  return { result, stored };
}

const endless: Script = () => ({ n: 20, more: true });
const quietPage: Script = () => ({ n: 0, more: false });

test('languageAsks splits a filter of several languages into one search each; one or none is left alone', () => {
  const q: DiscoveryQuery = { mode: 'catchall', term: '', sinceMs: null, untilMs: null, limit: 20, cursor: null, filter: { minApproval: 50, mediaOnly: false, langs: ['en', 'pt', 'ja'], excludeRebroadcasts: true } };
  assert.deepEqual(languageAsks(q).map((a) => [a.lang, a.query.filter?.langs]), [['en', ['en']], ['pt', ['pt']], ['ja', ['ja']]]);
  assert.deepEqual(languageAsks({ ...q, filter: { ...q.filter!, langs: ['en'] } }).map((a) => a.lang), ['en']);
  assert.deepEqual(languageAsks({ ...q, filter: { ...q.filter!, langs: [] } }).map((a) => a.lang), [null]);
  const { filter: _none, ...plain } = q;
  assert.deepEqual(languageAsks(plain).map((a) => a.query), [plain]);
  assert.deepEqual(roundOrder(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
  assert.deepEqual(roundOrder(['a', 'b', 'c'], 1), ['b', 'c', 'a']);
  assert.deepEqual(roundOrder(['a', 'b', 'c'], 5), ['c', 'a', 'b']);
});

test('★ the discover pass as shipped asks every fresh band once per language, the late band in its own languages, never an OR', async () => {
  const seen: Seen[] = [];
  const { result, stored } = pass(source(seen, (lang) => ({ n: lang === 'en' ? 7 : 2, more: false })), P5, { fresh: memoryFreshClock() });
  const r = await result;
  assert.equal(r.failed, 0);
  /* The fresh bands (6, 50 minutes) in all five languages; the late band (five hours) in its own
     (`fresh.late.langs`: the slow lane's, Arabic and Korean from policy.v185, Indonesian from v203, Thai from v223). */
  const lateLangs = P5.feed.fresh.late.langs ?? P5.feed.slow.langs ?? LANGS;
  assert.deepEqual(lateLangs, ['en', 'fr', 'ja', 'tr', 'zh', 'es', 'pt', 'ar', 'ko', 'zxx', 'qme', 'in', 'th']);
  /* Every late band (five hours; eight from policy.v196) asks the late languages. */
  const lateBands = P5.feed.fresh.late.bands.length;
  assert.equal(seen.length, 2 * LANGS.length + lateBands * lateLangs.length);
  const windows = [...new Set(seen.map((s) => s.q.untilMs))];
  assert.equal(windows.length, 2 + lateBands);
  for (const window of windows) {
    /* Each band asks each of its languages once. In what order is the longest-waited first: on a first pass
       that is the one whose first ask reaches back furthest (its own spacing, core langBandWindow). */
    const langs = seen.filter((s) => s.q.untilMs === window).map((s) => s.lang);
    const sorted = JSON.stringify([...langs].sort());
    assert.ok(sorted === JSON.stringify([...LANGS].sort()) || sorted === JSON.stringify([...lateLangs].sort()), `each band asks each of its languages once: ${langs.join(',')}`);
    assert.equal(new Set(langs).size, langs.length);
  }
  assert.equal(r.itemsSeen, 2 * (7 + 2 * (LANGS.length - 1)) + lateBands * (7 + 2 * (lateLangs.length - 1)));
  assert.equal(stored.filter((s) => [...new Set(s.langs)].sort().join() === [...LANGS].sort().join()).length, 2, 'one store per fresh band, holding every language');
});

test('★ round-robin: every language gets its first page before any gets a second, and the order turns each round', async () => {
  const seen: Seen[] = [];
  const policy = withFeed({ middle: { ...P5.feed.middle, on: true, maxPages: 3 } });
  await pass(source(seen, endless), policy, { middle: memoryLaneLedger(), only: 'middle' }).result;
  assert.deepEqual(seen.map((s) => `${s.lang}${s.page}`), [
    'en0', 'zxx0', 'pt0', 'qme0', 'ja0',
    'zxx1', 'pt1', 'qme1', 'ja1', 'en1',
    'pt2', 'qme2', 'ja2', 'en2', 'zxx2',
  ]);
});

test('★ each language pages on its own cursor, and never on another language\'s', async () => {
  const seen: Seen[] = [];
  const crossed: string[] = [];
  /* Different depths: en 4 pages, pt 2, the rest 1. */
  const depth: Record<string, number> = { en: 4, pt: 2 };
  await pass(source(seen, (lang, page) => ({ n: 5, more: page + 1 < (depth[lang] ?? 1) }), crossed), MIDDLE_ONLY, { middle: memoryLaneLedger(), only: 'middle' }).result;
  assert.deepEqual(crossed, []);
  for (const lang of LANGS) {
    const mine = seen.filter((s) => s.lang === lang);
    assert.equal(mine.length, depth[lang] ?? 1, `${lang} read to its own end`);
    assert.deepEqual(mine.map((s) => s.q.cursor), mine.map((_s, i) => (i === 0 ? null : `${lang}:${i}`)));
  }
});

test('★ the middle cap is one total across languages, checked before every page of every language', async () => {
  const seen: Seen[] = [];
  const pageUsd = 20 * USD_PER_POST;
  const cap = MIDDLE_ONLY.feed.middle.cap.dailyUsd;
  /* Room for seven and a half pages: the first is checked at the gate, the rest inside the loop. */
  const ledger = memoryLaneLedger({ middle: cap - 7.5 * pageUsd });
  await pass(source(seen, endless), MIDDLE_ONLY, { middle: ledger, only: 'middle' }).result;
  assert.equal(seen.length, 7);
  assert.ok(((await ledger.spent('middle', NOW)) ?? 0) <= cap + 1e-12, 'the day never goes past its cap');
  /* Round-robin: all five first pages, then two second pages. */
  assert.deepEqual(seen.map((s) => `${s.lang}${s.page}`), ['en0', 'zxx0', 'pt0', 'qme0', 'ja0', 'zxx1', 'pt1']);
});

test('★ Japanese with endless pages cannot crowd out the others: they all read to their end first', async () => {
  const seen: Seen[] = [];
  const pageUsd = 20 * USD_PER_POST;
  const cap = MIDDLE_ONLY.feed.middle.cap.dailyUsd;
  /* en, zxx, pt and qme have two pages each; ja never ends. Room for 12 pages. */
  const ledger = memoryLaneLedger({ middle: cap - 12.5 * pageUsd });
  const { stored, result } = pass(source(seen, (lang, page) => ({ n: 20, more: lang === 'ja' || page === 0 })), MIDDLE_ONLY, { middle: ledger, only: 'middle' });
  await result;
  for (const lang of ['en', 'zxx', 'pt', 'qme']) assert.equal(seen.filter((s) => s.lang === lang).length, 2, `${lang} got both its pages`);
  assert.equal(seen.filter((s) => s.lang === 'ja').length, 4, 'Japanese had the rest of the day, and no more');
  const langs = stored.flatMap((s) => s.langs);
  assert.equal(langs.filter((l) => l === 'en').length, 40);
});

test('★ the meter is checked before every page of every language: once it says no, no language is asked', async () => {
  const seen: Seen[] = [];
  let left = 3;
  const meter = { ...openMeter, mayspend: () => left-- > 0 } as unknown as Meter;
  const { result, stored } = pass(source(seen, endless), MIDDLE_ONLY, { middle: memoryLaneLedger(), only: 'middle', meter });
  const r = await result;
  /* The gate's check, then one before each later page: two more pages, then the refusal. */
  assert.deepEqual(seen.map((s) => s.lang), ['en', 'zxx', 'pt']);
  assert.equal(r.answered, 1);
  assert.equal(stored.flatMap((s) => s.langs).length, 60, 'what was asked is stored');
});

test('★ a refusal at the vendor edge ends every language; what came back before it is kept', async () => {
  const seen: Seen[] = [];
  const { result, stored } = pass(source(seen, (lang) => (lang === 'pt' ? 'refuse' : { n: 3, more: false })), MIDDLE_ONLY, { middle: memoryLaneLedger(), only: 'middle' });
  const r = await result;
  assert.deepEqual(seen.map((s) => s.lang), ['en', 'zxx', 'pt']);
  assert.equal(r.failed, 0, 'our own refusal is not a vendor failure');
  assert.deepEqual(stored.flatMap((s) => s.langs), ['en', 'en', 'en', 'zxx', 'zxx', 'zxx']);
});

test('★ an empty run ends that language alone: the others page on', async () => {
  const seen: Seen[] = [];
  /* zxx says there is more forever and never has anything; the rest have four pages. */
  const { result } = pass(source(seen, (lang, page) => (lang === 'zxx' ? { n: 0, more: true } : { n: 4, more: page < 3 })), MIDDLE_ONLY, { middle: memoryLaneLedger(), only: 'middle' });
  await result;
  assert.equal(seen.filter((s) => s.lang === 'zxx').length, MIDDLE_ONLY.feed.paging.maxEmptyRun);
  for (const lang of ['en', 'pt', 'qme', 'ja']) assert.equal(seen.filter((s) => s.lang === lang).length, 4, `${lang} read to its end`);
});

test('★ on the old rule a short page ends that language only', async () => {
  const seen: Seen[] = [];
  const policy = withFeed({ fresh: { ...P5.feed.fresh, enabled: false }, middle: { ...P5.feed.middle, on: false } });
  /* The 'all' lane: en's pages are full (20) with more, the others' short. */
  await pass(source(seen, (lang) => ({ n: lang === 'en' ? 20 : 3, more: true })), policy, { lanes: ['all'] }).result;
  assert.equal(seen.filter((s) => s.lang === 'en').length, policy.feed.maxPagesPerLane, 'English reads its full pages');
  for (const lang of ['zxx', 'pt', 'qme', 'ja']) assert.equal(seen.filter((s) => s.lang === lang).length, 1, `${lang}'s short page ends it`);
});

test('★ a language that fails is said by name, and the others are asked, stored and charged', async () => {
  const seen: Seen[] = [];
  const ledger = memoryLaneLedger();
  const { result, stored } = pass(source(seen, (lang) => (lang === 'pt' ? 'throw' : { n: 2, more: false })), MIDDLE_ONLY, { middle: ledger, only: 'middle' });
  const r = await result;
  assert.deepEqual(seen.map((s) => s.lang), [...LANGS]);
  assert.equal(r.answered, 1);
  assert.equal(r.failed, 1);
  const failed = r.outcomes.find((o) => o.kind === 'failed');
  assert.ok(failed !== undefined && failed.kind === 'failed' && failed.reason.startsWith('lang pt:') && failed.lane === 'middle', JSON.stringify(failed));
  assert.deepEqual([...new Set(stored.flatMap((s) => s.langs))].sort(), ['en', 'ja', 'qme', 'zxx']);
  /* Four answered pages of 2 posts, and the failed page charged its quote of 20. */
  assert.ok(Math.abs(((await ledger.spent('middle', NOW)) ?? 0) - (8 * USD_PER_POST + 20 * USD_PER_POST)) < 1e-12);
});

test('★ every language failing is one failed ask, charged, and nothing stored', async () => {
  const seen: Seen[] = [];
  const ledger = memoryLaneLedger();
  const { result, stored } = pass(source(seen, () => 'throw'), MIDDLE_ONLY, { middle: ledger, only: 'middle' });
  const r = await result;
  assert.equal(seen.length, LANGS.length);
  assert.equal(r.failed, 1);
  assert.equal(r.answered, 0);
  assert.equal(stored.length, 0);
  assert.ok(Math.abs(((await ledger.spent('middle', NOW)) ?? 0) - LANGS.length * 20 * USD_PER_POST) < 1e-12);
});

test('★ a band keeps each language\'s window on its own clock: a failed language is asked again from where it stood', async () => {
  const clock = memoryFreshClock();
  const policy = withFeed({ middle: { ...P5.feed.middle, on: false }, fresh: { ...P5.feed.fresh, late: { ...P5.feed.fresh.late, on: false } } });
  await pass(source([], (lang) => (lang === 'pt' ? 'throw' : { n: 1, more: false })), policy, { fresh: clock }).result;
  for (const age of policy.feed.fresh.bandAgesMin) {
    assert.equal(clock.lastUntil(bandKey('x', age, 'pt')), null, 'pt failed: its window stays open');
    for (const lang of ['en', 'zxx', 'qme', 'ja']) assert.equal(clock.lastUntil(bandKey('x', age, lang)), NOW - age * MIN);
  }
  /* The next pass, two minutes on: pt reaches back its whole window, the others only the two minutes. */
  const seen: Seen[] = [];
  const later = (NOW + 2 * MIN) as Millis;
  await discoverPass({
    platforms: registry(source(seen, () => ({ n: 0, more: false }))), store: async () => 0, plan: { terms: [], cadenceMs: 120_000 },
    policy, meter: openMeter, mode: 'live', log: quiet, now: () => later, signal: new AbortController().signal,
    floors: { floors: async () => ({}), set: async () => undefined }, dailyCapUsd: 1, fresh: clock,
  });
  const band6 = seen.filter((s) => s.q.untilMs === later - 6 * MIN);
  /* pt never answered, so its ask is a first one: back the band cap and its own spacing, at most the spacing's ceiling. */
  const ptSince = band6.find((s) => s.lang === 'pt')?.q.sinceMs ?? Number.NaN;
  assert.ok(ptSince <= later - 6 * MIN - policy.feed.fresh.maxWindowMin * MIN, 'at least the band cap');
  assert.ok(ptSince >= later - 6 * MIN - policy.feed.fresh.maxWindowMin * MIN - policy.feed.langSplit.maxEveryMs, 'no further than the spacing allows');
  assert.equal(band6.find((s) => s.lang === 'en')?.q.sinceMs, NOW - 6 * MIN);
});

test('a dry run prices one first page a language and asks nobody', async () => {
  const seen: Seen[] = [];
  const r = await pass(source(seen, endless), MIDDLE_ONLY, { middle: memoryLaneLedger(), only: 'middle', mode: 'dry' }).result;
  assert.equal(seen.length, 0);
  const planned = r.outcomes.find((o) => o.kind === 'planned');
  assert.ok(planned !== undefined && planned.kind === 'planned' && planned.estUnits === LANGS.length * P5.feed.pageLimit);
});

test('★ the lane search (narrative names) asks each language on its own cursor under one day, round-robin, a failure ending only its language', async () => {
  const seen: Seen[] = [];
  const crossed: string[] = [];
  const stored: string[] = [];
  const ledger = memoryLaneLedger();
  const query: DiscoveryQuery = { mode: 'keyword', term: 'tesla roadster', sinceMs: NOW - 60 * MIN, untilMs: null, limit: 20, cursor: null, filter: { minApproval: 1_000, mediaOnly: false, langs: LANGS, excludeRebroadcasts: true } };
  const script: Script = (lang, page) => (lang === 'qme' ? 'throw' : lang === 'ja' ? { n: 20, more: true } : { n: 5, more: page === 0 && lang === 'en' });
  const cap = { dailyUsd: 1, judgeUsdPerPost: 0.001, judgedShare: 1 };
  const r = await laneSearch(
    { meter: openMeter, mode: 'live', ledger, uncredited: async (ids) => ids.length, store: async (items) => { stored.push(...items.map((i) => i.lang ?? '-')); return items.length; }, log: quiet, now: () => NOW },
    { adapter: source(seen, script, crossed), query, lane: 'narrative_name', cap, maxPages: 3, deadline: (NOW + 60_000) as Millis },
  );
  assert.deepEqual(crossed, []);
  assert.deepEqual(seen.map((s) => `${s.lang}${s.page}`), ['en0', 'zxx0', 'pt0', 'qme0', 'ja0', 'ja1', 'en1', 'ja2']);
  assert.equal(r.end, 'failed', 'qme failed, so the window is asked again next pass');
  assert.equal(r.error?.startsWith('lang qme:'), true);
  assert.equal(r.pages, 7);
  assert.deepEqual([...new Set(stored)].sort(), ['en', 'ja', 'pt', 'zxx']);

  /* The lane's day is a total: room for two pages at their most, whatever their language. */
  const tight = memoryLaneLedger({ narrative_name: cap.dailyUsd - 2.5 * (20 * USD_PER_POST + 20 * cap.judgeUsdPerPost) });
  const few: Seen[] = [];
  const capped = await laneSearch(
    { meter: openMeter, mode: 'live', ledger: tight, uncredited: async (ids) => ids.length, store: async (items) => items.length, log: quiet, now: () => NOW },
    { adapter: source(few, endless), query, lane: 'narrative_name', cap, maxPages: 3, deadline: (NOW + 60_000) as Millis },
  );
  assert.equal(capped.end, 'capped');
  assert.deepEqual(few.map((s) => s.lang), ['en', 'zxx']);
  assert.ok(((await tight.spent('narrative_name', NOW)) ?? 0) <= cap.dailyUsd + 1e-12);
});

test('a quiet window is one billed page a language and the end', async () => {
  const seen: Seen[] = [];
  const r = await pass(source(seen, quietPage), MIDDLE_ONLY, { middle: memoryLaneLedger(), only: 'middle' }).result;
  assert.deepEqual(seen.map((s) => s.lang), [...LANGS]);
  assert.equal(r.answered, 1);
  assert.ok(seen.every((s) => isMiddle(s.q)));
});

test('★ the slow lane asks its own languages, so its slices do not multiply with the searched ones', () => {
  const slices = slowSliceQueries({ all: 500, media: 500, slow: 10_000 }, NOW, P5);
  assert.ok(slices.length > 0);
  for (const q of slices) assert.deepEqual(languageAsks(q).map((a) => a.lang), ['en', 'fr', 'ja', 'tr', 'zh', 'es', 'pt'], 'one search a slice in each of its own languages, not each searched one');
  const every = { ...P5, feed: { ...P5.feed, slow: { ...P5.feed.slow, langs: null } } };
  for (const q of slowSliceQueries({ all: 500, media: 500, slow: 10_000 }, NOW, every)) assert.equal(languageAsks(q).length, LANGS.length, 'unset: every searched language');
});
