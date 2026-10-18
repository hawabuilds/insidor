/**
 * ONE CAPPED, PAGED SEARCH FOR A LANE OUTSIDE THE DISCOVER PASS: ask a page, store what came back
 * under the lane, charge the lane's ledger, and ask the next page while the source says there is
 * one — until the lane's cap, the pass's deadline or the ask's page limit says stop.
 *
 * Its own file because two lanes in two loops ask this way — the narrative-name search
 * (work/narrative-names.ts) and the quote search (work/quote-search.ts) — and both must stop the
 * same way. It is not the discover pass's paging (work/discover.ts): that pass serves every
 * catch-all lane and ends with the judge, and the owner's rule for these lanes is that nothing they
 * do may slow it. The paging rule is the same one, though: continue while the source said
 * `hasMore` with a cursor and the last page was not empty, never inferred from a page's size.
 *
 * ★ THE LEDGER IS READ BEFORE EVERY PAGE AND ADDED TO AFTER IT (internal.lane_spend, 0088), so a
 * restart mid-day starts from what was spent, and an unreadable ledger asks nothing (lane-ledger.ts
 * fails closed). A page is asked only when the day has room for it at its most (every post billed,
 * new and judged), so the cap is a ceiling and not a trigger; it then charges what it was billed
 * plus the judging its new posts bring in (`laneJudgeUsd` over the posts no lane held before it),
 * the same charge the middle lane makes.
 *
 * ★ ONE SEARCH PER LANGUAGE (work/languages.ts, 2026-10-18): the supplier answers an OR of languages
 * with the last one only, so a filter naming several is asked as one search per language, each on
 * its own cursor and to `maxPages` pages, round-robin by page, the lane's day one total checked
 * before each. A language whose page throws ends alone and the ask's end is `failed`, so its caller
 * asks the window again; the others' posts are stored and charged as usual.
 *
 * What breaks if changed carelessly: storing before counting the new posts would count none of
 * them new (the store writes the credit), and the lane would never be charged for its judging.
 * A page that threw is charged its quote unless the meter refused it (then nothing went out).
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { LaneCapPolicy } from '@insidor/contracts/policy.ts';
import { laneJudgeUsd, laneMayAsk } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { CappedLane, LaneLedger } from './lane-ledger.ts';
import { languageAsks, roundOrder } from './languages.ts';

/** How long one page may take before the vendor call is abandoned. */
const PAGE_DEADLINE_MS = 60_000;

export interface LaneSearchDeps {
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly ledger: LaneLedger;
  /** How many of these posts no lane has found yet — counted before the store credits them. */
  readonly uncredited: (itemIds: readonly string[]) => Promise<number>;
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface LaneAsk {
  readonly adapter: PlatformAdapter;
  readonly query: DiscoveryQuery;
  readonly lane: CappedLane & FoundLane;
  readonly cap: LaneCapPolicy;
  readonly maxPages: number;
  /** No page is started at or after this instant. */
  readonly deadline: Millis;
}

/**
 * Why the ask stopped. `done`: the source had no more. `pages`: the ask's page limit. `capped`: the
 * lane's day is spent. `unreadable`: the ledger could not be read. `budget`: the source's line
 * refused. `deadline`: the pass ran out of time. `dry`: priced, not sent. `failed`: a page threw (of
 * any one language: the others were still asked).
 */
export type LaneAskEnd = 'done' | 'pages' | 'capped' | 'unreadable' | 'budget' | 'deadline' | 'dry' | 'failed';

export interface LaneAskResult {
  readonly end: LaneAskEnd;
  readonly pages: number;
  readonly returned: number;
  /** Of `returned`, the posts no lane held before. */
  readonly fresh: number;
  readonly usd: number;
  readonly error: string | null;
}

export async function laneSearch(deps: LaneSearchDeps, ask: LaneAsk): Promise<LaneAskResult> {
  const { adapter, lane, cap } = ask;
  /* ★ ONE SEARCH PER LANGUAGE (work/languages.ts), each on its own cursor and to `maxPages` pages,
     paged round-robin under the lane's one day: every page of every language is checked first. */
  const threads = languageAsks(ask.query).map((l) => ({ lang: l.lang, query: l.query, cursor: null as string | null, pages: 0, open: true, end: 'done' as 'done' | 'pages' | 'failed' }));
  let pages = 0;
  let returned = 0;
  let fresh = 0;
  let usd = 0;
  let error: string | null = null;
  const result = (end: LaneAskEnd, err: string | null = error): LaneAskResult => ({ end, pages, returned, fresh, usd, error: err });

  for (let round = 0; ; round += 1) {
    const open = roundOrder(threads, round).filter((t) => t.open);
    if (open.length === 0) {
      /* Every language ended: one that failed makes the ask's end `failed` (its window is asked again). */
      return result(threads.some((t) => t.end === 'failed') ? 'failed' : threads.some((t) => t.end === 'pages') ? 'pages' : 'done');
    }
    for (const t of open) {
      if (t.pages >= ask.maxPages) {
        t.open = false;
        t.end = 'pages';
        continue;
      }
      const now = deps.now();
      if (now >= ask.deadline) return result('deadline');
      const query: DiscoveryQuery = { ...t.query, cursor: t.cursor };
      const quote = adapter.estimate({ kind: 'discover', query });
      const spent = await deps.ledger.spent(lane, now);
      if (spent === null) return result('unreadable');
      /* Room for the page at its most: every post billed and every post new and judged. */
      if (!laneMayAsk(spent, quote.usd + laneJudgeUsd(query.limit, cap), cap)) return result('capped');
      if (!deps.meter.mayspend(quote.vendor, quote.usd)) return result('budget');
      if (deps.mode === 'dry') {
        deps.log.info('DRY RUN — a lane search priced, not sent', { lane, languages: threads.length, wouldSpendUsd: quote.usd * threads.length });
        return result('dry');
      }

      let page;
      try {
        const line = deps.meter.line(quote.vendor);
        page = await adapter.discover(query, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Math.min(ask.deadline, now + PAGE_DEADLINE_MS) as Millis });
      } catch (e) {
        if (e instanceof BudgetRefused) return result('budget', errorText(e));
        /* A page that threw was still billed. It ends its language only; the others are asked. */
        usd += quote.usd;
        await deps.ledger.add(lane, now, quote.usd);
        error ??= `${t.lang === null ? '' : `lang ${t.lang}: `}${errorText(e)}`;
        t.open = false;
        t.end = 'failed';
        continue;
      }
      pages += 1;
      t.pages += 1;
      const items = page.value.items;
      returned += items.length;
      let pageFresh = items.length;
      if (items.length > 0) {
        try {
          pageFresh = await deps.uncredited(items.map((i) => String(i.itemId)));
        } catch (e) {
          deps.log.warn("could not count a lane's new posts; charging it for all of them", { lane, err: errorText(e) });
        }
        fresh += pageFresh;
      }
      const charge = page.spend.usd + laneJudgeUsd(items.length === 0 ? 0 : pageFresh, cap);
      usd += charge;
      await deps.ledger.add(lane, now, charge);
      if (items.length > 0) {
        try {
          await deps.store(items, page.value.authors, lane);
        } catch (e) {
          /* Our database, not the source: every language would fail the same, so the ask ends. */
          return result('failed', errorText(e));
        }
      }
      t.cursor = page.value.cursor;
      if (!page.value.hasMore || t.cursor === null || items.length === 0) t.open = false;
    }
  }
}
