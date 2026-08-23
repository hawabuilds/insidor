/**
 * Rendering a discovery query into this vendor's search syntax — and PROVING that
 * the vendor honoured the one part of it that carries a correctness claim.
 *
 * The query names ONE mode and one term, because discovery verbs do not line up
 * across sources: a uniform `search(query)` returns an empty result on a source that
 * cannot search, and an empty result reads downstream as "nothing is happening" —
 * the exact failure the capability list exists to design out. So a mode this source
 * cannot express is an error here, not an empty page.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ THE ANTI-CONTAMINATION CUTOFF: THIS IS THE ONLY SOURCE THAT CAN HONOUR IT,
 *   WHICH IS WHY IT IS THE ONLY ONE THAT HAS TO PROVE IT DID.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `DiscoveryQuery.untilMs` says nothing published at or after that instant may be
 * returned, and that an adapter which cannot enforce it SERVER-SIDE must fail rather
 * than filter client-side — a result already counted against budget has already
 * leaked. Both other sources refuse the query outright. This one does not have to:
 * `until_time:` is a documented advanced-search operator taking UNIX SECONDS,
 * applied by the vendor before the page is assembled and before we are billed.
 *
 * ── WHY THAT IS NOT ENOUGH ON ITS OWN, AND WHAT THIS FILE ADDS ────────────
 *
 * The other source's refusal turns on a sentence worth repeating here: a safety
 * cutoff may not rest on a parameter whose WITHDRAWAL IS UNDETECTABLE. If a filter
 * silently stops being applied, the query still answers 200 with results, the
 * contamination is over-inclusive and invisible, and every backtest quietly becomes
 * worthless while looking green.
 *
 * A documented operator is not immune to that. Operators are retired, renamed, and
 * quietly dropped by resellers who re-implement a syntax they do not own. So the
 * operator is sent AND the answer is checked: every item that comes back under a
 * cutoff must carry a timestamp, and that timestamp must be before the instant we
 * asked for. A breach raises `CutoffNotHonoured` and the whole page is discarded.
 *
 * ★ AND THAT IS STILL NOT CLIENT-SIDE FILTERING, which the port forbids. Filtering
 * keeps the items that pass and returns them, so the run proceeds on a set that was
 * chosen after the fact; this returns NOTHING and fails the call. The distinction is
 * the whole point: nothing that arrived after the cutoff can reach a decision, and
 * the silent withdrawal the other source refuses to depend on becomes loud here.
 *
 * ── THE THREE THINGS THAT COST RECALL, EACH ON PURPOSE ────────────────────
 *
 *   1. The ceiling is rendered one second below the instant we mean. The operator
 *      takes whole seconds and its inclusivity AT the boundary second is not
 *      documented, so the last provably-safe value is the second before. The cost is
 *      under two seconds of recall at the end of the window; the alternative is a
 *      verification tolerance, and a tolerance is a hole with a number on it.
 *   2. An item with no readable timestamp fails the whole page rather than being
 *      dropped. Under a cutoff, "we cannot tell when this was posted" cannot be
 *      allowed to pass — that is the one place where the honest "unsure" has to
 *      become a refusal, because the entire value of a blind run is that nothing
 *      unverified is in it.
 *   3. `sinceMs` is treated completely differently and is deliberately NOT verified.
 *      It is a lower bound and carries no correctness claim: being too WIDE returns
 *      extra OLD items, and old items cannot know about anything that happened
 *      later. Being too narrow would silently hide real posts, which is why the
 *      rendering rounds outward.
 */

import type { Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { billedUnits, CAPABILITIES, SOURCE } from './capabilities.ts';
import type { XClient } from './client.ts';
import { toItem } from './to-item.ts';

/**
 * The vendor's own warning, honoured: "please don't use
 * since:2021-12-31_23:59:59_UTC and until:2021-12-31_23:59:59_UTC, it's not
 * supported now!!!". That names the DATETIME form of the day-granularity operators.
 * We use neither of them — both bounds below are rendered with the `_time` operators
 * that take unix seconds, which are exact, symmetric with each other, and
 * unambiguously not the spelling the vendor disowned.
 */
const seconds = (ms: Millis): number => Math.floor(ms / 1000);

/**
 * The value actually sent as the ceiling: the last whole second that is provably
 * entirely before `untilMs` under either an inclusive or an exclusive reading of the
 * operator. Exported because the arithmetic is the safety property, and a safety
 * property with no test is a comment.
 */
export const cutoffSecond = (untilMs: Millis): number => Math.max(0, seconds(untilMs) - 1);

/**
 * The vendor returned something published at or after the cutoff we asked for.
 *
 * ★ ITS OWN CLASS, AND NEITHER OF THE TWO IT RESEMBLES. It is not
 * `VendorUnavailable`: the vendor is up, it answered, and retrying will produce the
 * same contaminated page — so a caller that retries on unavailability would spend
 * money in a loop for nothing. It is not `VendorShapeError`: the shape is fine, the
 * fields are all there, and pointing the next reader at a schema change would send
 * them to the wrong file. What it means is narrower and worse than both: a search
 * operator this repository's only blind-replay capability rests on has stopped being
 * applied, so every historical run built on this source since it stopped is suspect.
 * That deserves a name somebody can grep for.
 */
export class CutoffNotHonoured extends Error {
  readonly source: string;
  /** The instant nothing was allowed to be published at or after. */
  readonly untilMs: Millis;
  /** The offending item's timestamp, or null when it had none to check. */
  readonly postedAt: Millis | null;
  readonly sourceItemId: string;

  constructor(untilMs: Millis, postedAt: Millis | null, sourceItemId: string) {
    super(
      `${String(SOURCE)} returned an item the anti-contamination cutoff excluded: item ` +
        `${sourceItemId} is stamped ${postedAt === null ? 'with no readable timestamp' : String(postedAt)} ` +
        `against a cutoff of ${untilMs}. The until_time: operator was sent and was not applied, or the ` +
        'item carries a timestamp we cannot read. Either way this page is discarded rather than ' +
        'filtered: a blind historical run cannot be assembled from results that were chosen after ' +
        'the fact. Treat every replay produced on this source since this started as contaminated.',
    );
    this.name = 'CutoffNotHonoured';
    this.source = String(SOURCE);
    this.untilMs = untilMs;
    this.postedAt = postedAt;
    this.sourceItemId = sourceItemId;
  }
}

/**
 * Renders a query into this vendor's search syntax, or refuses.
 *
 * Exported and pure so every refusal above is unit-testable with no network at all —
 * which matters more than usual here, because the most important thing this function
 * does is bound a paid, contaminating query.
 */
export function toSearchQuery(query: DiscoveryQuery): string {
  if (!CAPABILITIES.discovery.includes(query.mode)) {
    throw new NotImplemented(`x:discover:${query.mode}`, 'this source has no such entry point');
  }

  const term = query.term.trim();
  if (term.length === 0) {
    throw new NotImplemented('x:discover', 'this source has no "everything" feed');
  }

  const parts: string[] = [];
  parts.push(query.mode === 'account' ? `from:${term}` : term.includes(' ') ? `"${term}"` : term);
  // A language filter is expressible and deliberately NOT applied: pinning it to one
  // language is what made every non-English story invisible.
  //
  // The lower bound rounds DOWN to the second, which widens it. Wide is safe here for
  // the reason in the header, and `since_time:` is used rather than the day-granularity
  // `since:` so both bounds speak the same units and neither is the spelling the vendor
  // has publicly disowned.
  if (query.sinceMs !== null) parts.push(`since_time:${seconds(query.sinceMs)}`);
  // The cutoff is pushed into the query, never applied to the response. Filtering after
  // the fact still spends budget on results we must not look at, and a result that
  // reached this process has already had the chance to leak into a decision.
  //
  // Day granularity would not do: a coin minted at 09:02 would still see everything else
  // posted that day, which is up to 24 hours of the crowd reacting to the coin — precisely
  // the contamination the cutoff exists to prevent.
  if (query.untilMs !== null) parts.push(`until_time:${cutoffSecond(query.untilMs)}`);
  return parts.join(' ');
}

/**
 * Every item on the page proved to be older than the cutoff, or the page rejected.
 *
 * Exported and pure: this is the check the port's ★ requires, and it must be
 * testable against a page the vendor never sent.
 */
export function requireCutoffHonoured(items: readonly Item[], untilMs: Millis): void {
  for (const item of items) {
    // `postedAt === null` fails here on purpose. Everywhere else in this repository an
    // unknown is carried as an unknown; under a cutoff it cannot be, because the claim
    // being made about the whole page is that nothing in it is from after the instant,
    // and an item we cannot date is an item we cannot make that claim about.
    if (item.postedAt === null || item.postedAt >= untilMs) {
      throw new CutoffNotHonoured(untilMs, item.postedAt, item.sourceItemId);
    }
  }
}

/** One page of search results, translated. The client is the only paid line. */
export async function searchPage(
  client: XClient,
  query: DiscoveryQuery,
  at: Millis,
): Promise<{
  readonly items: readonly Item[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly units: number;
}> {
  const page = await client.search(toSearchQuery(query), query.cursor);
  // A client-side slice, which is safe because it caps how much of an already-paid-for
  // page we translate rather than filtering for correctness.
  const items = page.items.slice(0, query.limit).map((raw) => toItem(raw, at));

  /* Checked on the translated items rather than the raw payloads, because `toItem` is
     the only file allowed to know which field carries the timestamp — and checking a
     field name here would be a second place that knowledge lived.

     ★ AND CHECKED AFTER THE SLICE, WHICH IS THE STRONGER TEST RATHER THAN THE LAZIER
     ONE. Two reasons. The correctness property is about what LEAVES this function —
     an item we never return cannot contaminate a decision — so the returned set is
     exactly the right set to make the claim over. And for DETECTION the slice helps:
     `queryType` is pinned to `Latest`, so the page arrives newest-first, and the head
     of it is precisely where an unapplied ceiling would show up first. Checking the
     tail instead would be checking the items least likely to breach. */
  if (query.untilMs !== null) requireCutoffHonoured(items, query.untilMs);

  return {
    items,
    cursor: page.cursor,
    // The vendor said so, or it did not. We never infer it from a page size — this
    // vendor documents that a page can be short without being last.
    hasMore: page.hasMore,
    // Billed per item returned with a floor of one, so this is measured from the
    // response rather than estimated — which is the entire point of reporting it here
    // and not from the estimate the meter was given up front.
    units: billedUnits(page.items.length),
  };
}
