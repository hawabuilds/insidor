/**
 * Rendering a discovery query into this source's actor input, or refusing.
 *
 * The query names ONE mode and one term, because discovery verbs do not line up
 * across sources: a uniform `search(query)` returns an empty result on a source that
 * cannot search, and an empty result reads downstream as "nothing is happening" —
 * the exact failure the capability list exists to design out. So a mode this source
 * cannot express is an error here, not an empty page.
 *
 * WHY THIS IS ITS OWN FILE, given it used to sit in `index.ts`. The most important
 * thing in it is a REFUSAL, and a refusal is only worth anything if it has a test.
 * The other two sources split their query rendering out for exactly this reason, and
 * the refusal below was the one thing in this package with no test at all.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ THE ANTI-CONTAMINATION CUTOFF: REFUSED, AND THE REASON IS NOT THE OBVIOUS ONE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `DiscoveryQuery.untilMs` says nothing published at or after that instant may be
 * returned, and that an adapter which cannot enforce it SERVER-SIDE must fail rather
 * than filter client-side. This source refuses it. The wording of that refusal used
 * to be "this source cannot bound discovery by time", and THAT IS NOT TRUE — a
 * reader holding the scraper's input schema will find `newestPostDate` ("only videos
 * uploaded before or on this date will be scraped"), conclude the refusal is a stale
 * mistake, and remove it. So the true reasons, all four, in the order that matters:
 *
 *   1. ★ IT IS THE SCRAPER'S FILTER, NOT THE PLATFORM'S, AND THAT IS DECISIVE ON ITS
 *      OWN. The candidate set is whatever the hashtag or profile feed shows AT RUN
 *      TIME — a ranking computed from all engagement to date, including everything
 *      that happened after the cutoff. Filtering that set by upload date afterwards
 *      does not make the run blind. It makes a contaminated selection LOOK blind,
 *      which is strictly worse than an obviously contaminated one, because nobody
 *      goes looking for the flaw in a run that appears clean.
 *
 *   2. ★ WHICH ACTOR IS CONFIGURED IS NOT KNOWABLE TO THIS CODE. The actor id is a
 *      swappable environment variable with no default, on purpose. `newestPostDate`
 *      is ONE actor family's input key; an actor that does not declare it typically
 *      IGNORES the unknown key and answers 200 with unfiltered results. That is the
 *      same disqualification the other cutoff-less source wrote down — a safety
 *      cutoff may not rest on a parameter whose withdrawal is undetectable — except
 *      worse, because here the parameter's support depends on an unvalidated
 *      environment variable rather than on a vendor's changelog.
 *
 *   3. GRANULARITY. The documented form is an ISO date, optionally with a time, or a
 *      relative expression in days. The other source rejected day granularity in
 *      writing: a coin minted at 09:02 would still see everything else posted that
 *      day. Nothing available here is better than what was already rejected there.
 *
 *   4. FAILURE DIRECTION. If the filter is silently not applied, the run answers 200
 *      with results, the contamination is over-inclusive and INVISIBLE, and every
 *      backtest quietly becomes worthless while looking green.
 *
 * The consequence is real and intended: a blind historical run cannot be built on
 * this source, so nobody can accidentally produce one that looks blind and is not.
 *
 * ── ★ AND WHY `resultsPerPage` IS SENT ANYWAY, WHICH LOOKS LIKE THE OPPOSITE ──
 *
 * It is the same kind of parameter — one actor family's key, unverifiable, silently
 * ignorable — and it is sent, because the FAILURE DIRECTION is the reverse. If a
 * cutoff is ignored, the result is over-inclusive and contaminates a decision. If a
 * size bound is ignored, the result is over-inclusive and costs a little more
 * scraping, and the caller slices it to `limit` regardless. One is a correctness
 * claim we would be unable to keep; the other is a hint about how much work to do.
 * That asymmetry — not the parameter's provenance — is what decides whether an
 * unverifiable bound may be relied on.
 */

import type { Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { CAPABILITIES } from './capabilities.ts';
import type { TikTokClient } from './client.ts';
import { toItem } from './to-item.ts';

/** What the actor is asked to do. Keys are this scraper family's; nothing else knows them. */
export interface ActorInput {
  readonly hashtags?: readonly string[];
  readonly accounts?: readonly string[];
  /** A hint, not a guarantee — see the header's last section for why that is fine. */
  readonly resultsPerPage?: number;
}

/**
 * Renders a query into actor input, or refuses.
 *
 * Exported and pure so every refusal above is unit-testable with no network at all —
 * which matters more than usual here, because the most important thing this function
 * does is throw.
 */
export function toActorInput(query: DiscoveryQuery): ActorInput {
  if (!CAPABILITIES.discovery.includes(query.mode)) {
    throw new NotImplemented(`tiktok:discover:${query.mode}`, 'this source has no such entry point');
  }

  const term = query.term.trim();
  if (term.length === 0) throw new NotImplemented('tiktok:discover', 'no hashtag or account to enter by');

  if (query.untilMs !== null) {
    // See the ★ block at the top of this file. This is a refusal, not a gap, and the
    // message states the reason that survives somebody reading the scraper's schema.
    throw new NotImplemented(
      'tiktok:discover:cutoff',
      'no cutoff reachable here can make a run blind: the candidate set is chosen by a ' +
        'present-day ranking before any date filter is applied, and which actor is ' +
        'configured — hence whether such a filter is honoured at all — is not knowable to ' +
        'this code. A blind historical run is not available on this source',
    );
  }

  // A cap on how much of a feed we ask the actor to scrape, not a correctness filter.
  const resultsPerPage = Math.max(1, Math.trunc(query.limit));

  return query.mode === 'account'
    ? { accounts: [term], resultsPerPage }
    : { hashtags: [term], resultsPerPage };
}

/**
 * One run, translated. The client call is the only line that costs anything, and it
 * costs the same whether it returns a thousand items or none.
 */
export async function discoverRun(
  client: TikTokClient,
  query: DiscoveryQuery,
  at: Millis,
): Promise<{ readonly items: readonly Item[]; readonly runId: string | null }> {
  const run = await client.runDiscovery(toActorInput(query));
  return {
    // A client-side slice, which is safe because it caps how much of an
    // already-paid-for run we translate rather than filtering for correctness.
    items: run.items.slice(0, query.limit).map((raw) => toItem(raw, at)),
    runId: run.runId,
  };
}
