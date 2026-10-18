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
 * refused. `deadline`: the pass ran out of time. `dry`: priced, not sent. `failed`: a page threw.
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
  let cursor: string | null = null;
  let pages = 0;
  let returned = 0;
  let fresh = 0;
  let usd = 0;
  const result = (end: LaneAskEnd, error: string | null = null): LaneAskResult => ({ end, pages, returned, fresh, usd, error });

  for (;;) {
    if (pages >= ask.maxPages) return result('pages');
    const now = deps.now();
    if (now >= ask.deadline) return result('deadline');
    const query: DiscoveryQuery = { ...ask.query, cursor };
    const quote = adapter.estimate({ kind: 'discover', query });
    const spent = await deps.ledger.spent(lane, now);
    if (spent === null) return result('unreadable');
    /* Room for the page at its most: every post billed and every post new and judged. */
    if (!laneMayAsk(spent, quote.usd + laneJudgeUsd(query.limit, cap), cap)) return result('capped');
    if (!deps.meter.mayspend(quote.vendor, quote.usd)) return result('budget');
    if (deps.mode === 'dry') {
      deps.log.info('DRY RUN — a lane search priced, not sent', { lane, wouldSpendUsd: quote.usd });
      return result('dry');
    }

    let page;
    try {
      const line = deps.meter.line(quote.vendor);
      page = await adapter.discover(query, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Math.min(ask.deadline, now + PAGE_DEADLINE_MS) as Millis });
    } catch (e) {
      if (!(e instanceof BudgetRefused)) {
        usd += quote.usd;
        await deps.ledger.add(lane, now, quote.usd);
      }
      return result(e instanceof BudgetRefused ? 'budget' : 'failed', errorText(e));
    }
    pages += 1;
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
        return result('failed', errorText(e));
      }
    }
    cursor = page.value.cursor;
    if (!page.value.hasMore || cursor === null || items.length === 0) return result('done');
  }
}
