/**
 * ONE SEARCH BACKWARDS WHEN A NARRATIVE FORMS (Policy.narrative.backSearch, on from 2026-10-18): a
 * shown narrative of at least `minPosts` posts, first shown in the last `formedWithinMs`, is
 * searched once on the text source by its narrative-name search name (work/narrative-names.ts
 * `chooseName`), from `lookbackMs` before its first post up to that post, in all languages at once.
 *
 * Why: the owner's missed post #16 (x:2110225239515041849, the Roadster's "Timing is everything"
 * quote of 14 Oct) was never found by a lane; we saved it only when he pasted it. The forward
 * name search (narrative-names.ts) asks from a narrative's last search onwards, so it can never
 * find what went up before the narrative formed. This asks that once.
 *
 * ★ ITS OWN DAY: charged to the 'narrative_back' ledger lane at `cap` ($0.50 a day, the owner),
 * apart from the forward name search's $0.35, so neither takes the other's room. Its posts are
 * still credited to the 'narrative_name' found-by lane (0097): a found-by lane of its own would
 * need the lane check rebuilt, and both are the same kind of find. They are judged like every
 * found post, and the ones that pass reach the narrative through the early posts (work/
 * narratives.ts step 6), which take stored posts up to seven days back.
 *
 * Biggest first: a pass asks the narratives with the most posts first, so a day's cap is spent on
 * the stories people are reading. Under `minPosts` a narrative is too small to name safely and
 * waits; it is asked if it reaches `minPosts` while still inside `formedWithinMs`.
 *
 * ★ ONCE PER NARRATIVE, kept in the process: a restart asks again the narratives formed in the
 * last `formedWithinMs`, inside the cap (mostly posts we already hold, so mostly the search bill,
 * at most $0.009 an ask). An ask that failed or was cut short is asked next pass.
 *
 * What breaks if changed carelessly: the window's end. `untilMs` is the narrative's earliest post
 * as we hold it, over ALL its posts (early ones included); leaving it open, or taking it from the
 * newest posts only, would ask the narrative's life again, which the forward search already pays
 * for.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { NarrativePostRow, StoredNarrative } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { LaneLedger } from './lane-ledger.ts';
import { laneSearch } from './lane-search.ts';
import { chooseName } from './narrative-names.ts';

export interface NarrativeBackDeps {
  readonly sources: () => readonly PlatformAdapter[];
  readonly narratives: {
    live(sinceMs: number): Promise<readonly StoredNarrative[]>;
    standingRows(itemIds: readonly string[]): Promise<readonly NarrativePostRow[]>;
  };
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly uncredited: (itemIds: readonly string[]) => Promise<number>;
  readonly ledger: LaneLedger;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface NarrativeBackResult {
  readonly due: number;
  readonly asked: number;
  readonly returned: number;
  readonly fresh: number;
  readonly usd: number;
}

const NONE: NarrativeBackResult = { due: 0, asked: 0, returned: 0, fresh: 0, usd: 0 };

/** The narratives asked in this process. */
export type NarrativeBackClock = Set<string>;

export async function narrativeBackPass(deps: NarrativeBackDeps, asked: NarrativeBackClock): Promise<NarrativeBackResult> {
  const b = deps.policy.narrative.backSearch;
  const names = deps.policy.feed.narrativeNames;
  if (!b.on) return NONE;
  const source = deps.sources().find((a) => a.capabilities.discovery.includes('keyword') && a.capabilities.narrowedSearch?.filter === true);
  if (source === undefined) return NONE;
  const started = deps.now();
  const deadline = (started + b.passDeadlineMs) as Millis;
  /* Live, and never one the rebuild restored: it already matched seven days of stored posts (0106). */
  const due = (await deps.narratives.live(started - b.formedWithinMs))
    .filter((n) => n.shown && (n.restoredAtMs ?? null) === null && n.members.length >= b.minPosts && n.firstShownAtMs !== null && n.firstShownAtMs >= started - b.formedWithinMs && !asked.has(n.id))
    .sort((x, y) => y.members.length - x.members.length || (y.firstShownAtMs ?? 0) - (x.firstShownAtMs ?? 0) || x.id.localeCompare(y.id))
    .slice(0, b.perPass);

  let n = 0;
  let returned = 0;
  let fresh = 0;
  let usd = 0;
  for (const nar of due) {
    let all: readonly NarrativePostRow[];
    try {
      all = await deps.narratives.standingRows([...nar.members]);
    } catch (e) {
      deps.log.warn("a narrative's posts could not be read; it is searched back next pass", { narrative: nar.id, err: errorText(e) });
      continue;
    }
    /* The name from its newest posts, as the forward search reads them; the window's end from all of them. */
    const name = chooseName(nar.title, [...all].sort((x, y) => x.atMs - y.atMs).slice(-names.membersRead), names);
    const first = Math.min(...all.map((r) => r.atMs));
    if (name === null || !Number.isFinite(first)) {
      asked.add(nar.id); // no safe name: never searched, as the forward search
      continue;
    }
    const query: DiscoveryQuery = {
      mode: 'keyword',
      term: name.name,
      sinceMs: (first - b.lookbackMs) as Millis,
      untilMs: first as Millis,
      limit: deps.policy.feed.pageLimit,
      cursor: null,
      /* All languages in one search: a filter naming several is asked once per language (lane-search.ts). */
      filter: { minApproval: Math.round(names.minApproval), mediaOnly: false, langs: [], excludeRebroadcasts: true },
    };
    const r = await laneSearch(deps, { adapter: source, query, lane: 'narrative_name', ledgerLane: 'narrative_back', cap: b.cap, maxPages: b.maxPagesPerAsk, deadline });
    usd += r.usd;
    returned += r.returned;
    fresh += r.fresh;
    if (r.pages > 0) n += 1;
    if (r.end === 'done' || r.end === 'pages') asked.add(nar.id);
    else if (r.end === 'failed') deps.log.warn('a backward name search failed; it is asked again next pass', { narrative: nar.id, name: name.name, err: r.error });
    else break; // capped, budget, deadline, dry, unreadable: the pass stops
  }
  const result: NarrativeBackResult = { due: due.length, asked: n, returned, fresh, usd };
  if (due.length > 0) deps.log.info('backward narrative-name search pass', { ...result, ms: deps.now() - started });
  return result;
}
