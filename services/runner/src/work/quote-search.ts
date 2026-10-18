/**
 * THE QUOTE SEARCH ON BIG ACCOUNTS (`feed.reproductions`): a held post by an account with 10M+ followers
 * that passed 5,000 likes has its quotes searched at about 1 and 3 hours old, at a like floor, and
 * the quotes are credited to the 'quote' lane (0097), so they are judged and may reach For You.
 *
 * Why it exists: a giant account's post is often not the meme; a quote of it is, and that quote
 * carries none of the words or likes our lanes ask for in its first hour. The probe of 2026-10-17
 * found the Tesla 7:55 post by `quoted_tweet_id:2110222071229989249`; no lane had.
 *
 * Why at fixed ages, not on every pass: a quote needs time to collect likes, and asking every five
 * minutes would pay the source's one-post floor on each ask for the same few quotes. At about an
 * hour the first wave of quotes is there; at about three the ones that grew slowly. A post is asked
 * at an age when it is within `askGraceMin` past it, so a loop that was down asks late, not never,
 * and a post first held long after its ages is not asked at all.
 *
 * What one pass asks is bounded: `maxPostsPerPass` posts, most liked first, `maxPagesPerAsk` pages
 * each, `passDeadlineMs`, and the lane's day in internal.lane_spend (`cap`, work/lane-search.ts).
 * A post at an asking age whose newest reading is under the floor and older than `rereadAfterMin`
 * has its likes read again by id first, on the same ledger (see `rereadLikes`).
 *
 * What breaks if changed carelessly: the ages asked are kept in this process (`QuoteClock`); marking
 * an age before its ask answered would skip that age for good after a failure. A restart may ask a
 * post's current age once more — the only way this asks twice — and that ask is inside the cap.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { QuoteTarget } from '@insidor/store';

import { laneMayAsk } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { LaneLedger } from './lane-ledger.ts';
import { laneSearch, type LaneAskEnd } from './lane-search.ts';

const MS_PER_MINUTE = 60_000;

type QuotePolicy = Policy['feed']['reproductions'];

/** Which of `askAtMin` each post has been asked at, in this process, with when it was posted. */
export interface QuoteClock {
  readonly asked: Map<string, { readonly postedAtMs: number; readonly ages: Set<number> }>;
}

export const quoteClock = (): QuoteClock => ({ asked: new Map() });

/** The age (one of `askAtMin`) a post is due at now, or null. Pure. */
export function dueAge(postedAtMs: number, now: number, asked: ReadonlySet<number> | undefined, p: QuotePolicy): number | null {
  const ageMin = (now - postedAtMs) / MS_PER_MINUTE;
  for (const at of [...p.askAtMin].sort((a, b) => b - a)) {
    if (ageMin >= at && ageMin < at + p.askGraceMin) return asked?.has(at) === true ? null : at;
  }
  return null;
}

export interface QuoteSearchDeps {
  readonly sources: () => readonly PlatformAdapter[];
  readonly targets: { due(args: { source: string; minFollowers: number; postedAfterMs: number; postedBeforeMs: number; limit: number }): Promise<readonly QuoteTarget[]> };
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly uncredited: (itemIds: readonly string[]) => Promise<number>;
  readonly ledger: LaneLedger;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface QuoteSearchResult {
  /** Held big-account posts inside an asking window. */
  readonly candidates: number;
  /** Of those at an asking age, the ones whose likes were read again first (their reading was old and under the floor). */
  readonly reread: number;
  readonly asked: number;
  readonly returned: number;
  readonly fresh: number;
  readonly usd: number;
  readonly stopped: LaneAskEnd | null;
}

const NONE: QuoteSearchResult = { candidates: 0, reread: 0, asked: 0, returned: 0, fresh: 0, usd: 0, stopped: null };
const PASS_ENDS: ReadonlySet<LaneAskEnd> = new Set(['capped', 'unreadable', 'budget', 'deadline', 'dry']);

export async function quoteSearchPass(deps: QuoteSearchDeps, clock: QuoteClock): Promise<QuoteSearchResult> {
  const p = deps.policy.feed.reproductions;
  if (!p.on || p.askAtMin.length === 0) return NONE;
  const source = deps.sources().find((a) => a.capabilities.discovery.includes('keyword') && a.capabilities.narrowedSearch?.reproductionsOf === true);
  if (source === undefined) {
    deps.log.info('quote search skipped: no source can search a post\'s quotes');
    return NONE;
  }
  const started = deps.now();
  const deadline = (started + p.passDeadlineMs) as Millis;
  const youngest = Math.min(...p.askAtMin);
  const oldest = Math.max(...p.askAtMin) + p.askGraceMin;

  let targets: readonly QuoteTarget[];
  try {
    targets = await deps.targets.due({
      source: String(source.id),
      minFollowers: p.minFollowers,
      postedAfterMs: started - oldest * MS_PER_MINUTE,
      postedBeforeMs: started - youngest * MS_PER_MINUTE,
      limit: p.maxCandidates,
    });
  } catch (e) {
    deps.log.warn('quote search could not read its posts; nothing asked this pass', { err: errorText(e) });
    return NONE;
  }
  /* Forget posts past every age: the map stays the size of a few hours' big posts. */
  for (const [id, seen] of clock.asked) if (started - seen.postedAtMs >= oldest * MS_PER_MINUTE) clock.asked.delete(id);

  const atAge = targets.flatMap((t) => {
    const age = dueAge(t.postedAtMs, started, clock.asked.get(t.itemId)?.ages, p);
    return age === null ? [] : [{ t, age }];
  });
  const settle = (t: QuoteTarget, age: number) => {
    const seen = clock.asked.get(t.itemId) ?? { postedAtMs: t.postedAtMs, ages: new Set<number>() };
    /* Settled at this age: every younger age is behind it too. */
    for (const a of p.askAtMin) if (a <= age) seen.ages.add(a);
    clock.asked.set(t.itemId, seen);
  };

  let usd = 0;
  let stopped: LaneAskEnd | null = null;
  const past = atAge.filter(({ t }) => t.approvals >= p.minApproval);
  /* ★ A STALE READING UNDER THE FLOOR IS READ AGAIN FIRST. 469 of 1,053 big posts held over the three
     days to 2026-10-18 had no reading after their first hour and were under 5,000 in it — the post the
     Tesla 7:55 post quoted among them (703 likes, read four minutes after it went up). Their likes are
     read by id, on the lane's ledger, and the ones past the floor are asked; the rest are settled at
     this age, so a post is read again at most once an age. A fresh reading under the floor waits. */
  const stale = atAge.filter(({ t }) => t.approvals < p.minApproval && started - t.readAtMs >= p.rereadAfterMin * MS_PER_MINUTE).slice(0, p.maxRereadsPerPass);
  let reread = 0;
  if (stale.length > 0) {
    const got = await rereadLikes(deps, source, stale.map(({ t }) => t.sourceItemId), p, deadline);
    if (got.kind === 'stopped') stopped = got.end;
    else {
      usd += got.usd;
      reread = stale.length;
      for (const { t, age } of stale) {
        const likes = got.likes.get(t.sourceItemId);
        if (likes !== undefined && likes >= p.minApproval) past.push({ t: { ...t, approvals: likes }, age });
        else if (got.answered) settle(t, age);
      }
    }
  }
  const due = past.sort((a, b) => b.t.approvals - a.t.approvals).slice(0, stopped === null ? p.maxPostsPerPass : 0);

  let asked = 0;
  let returned = 0;
  let fresh = 0;
  for (const { t, age } of due) {
    const query: DiscoveryQuery = {
      mode: 'keyword',
      term: '',
      reproductionsOf: t.sourceItemId,
      sinceMs: null,
      untilMs: null,
      limit: deps.policy.feed.pageLimit,
      cursor: null,
      filter: { minApproval: Math.round(p.reproductionMinApproval), mediaOnly: false, langs: [], excludeRebroadcasts: true },
    };
    const r = await laneSearch(deps, { adapter: source, query, lane: 'quote', cap: p.cap, maxPages: p.maxPagesPerAsk, deadline });
    usd += r.usd;
    returned += r.returned;
    fresh += r.fresh;
    if (r.pages > 0) asked += 1;
    if (r.end === 'done' || r.end === 'pages') settle(t, age);
    if (r.end === 'failed') deps.log.warn("a post's quote search failed; asked again next pass", { post: t.itemId, err: r.error });
    if (PASS_ENDS.has(r.end)) {
      stopped = r.end;
      break;
    }
  }
  const result: QuoteSearchResult = { candidates: targets.length, reread, asked, returned, fresh, usd, stopped };
  if (due.length > 0 || stopped !== null) deps.log.info('quote search pass', { ...result, due: due.length, ms: deps.now() - started });
  return result;
}

type Reread =
  | { readonly kind: 'read'; readonly likes: ReadonlyMap<string, number>; readonly usd: number; readonly answered: boolean }
  | { readonly kind: 'stopped'; readonly end: LaneAskEnd };

/**
 * These posts' likes read again by id, priced first and charged to the quote lane's ledger. Stops the
 * pass (`stopped`) when the ledger cannot be read, the lane or the line has no room, or on a dry run;
 * a failed read is logged and answers nothing, so the posts are tried again next pass.
 */
async function rereadLikes(deps: QuoteSearchDeps, source: PlatformAdapter, ids: readonly string[], p: QuotePolicy, deadline: Millis): Promise<Reread> {
  const now = deps.now();
  const quote = source.estimate({ kind: 'observe', sourceItemIds: ids });
  const spent = await deps.ledger.spent('quote', now);
  if (spent === null) return { kind: 'stopped', end: 'unreadable' };
  if (!laneMayAsk(spent, quote.usd, p.cap)) return { kind: 'stopped', end: 'capped' };
  if (!deps.meter.mayspend(quote.vendor, quote.usd)) return { kind: 'stopped', end: 'budget' };
  if (deps.mode === 'dry') {
    deps.log.info("DRY RUN — big posts' likes re-read priced, not sent", { posts: ids.length, wouldSpendUsd: quote.usd });
    return { kind: 'stopped', end: 'dry' };
  }
  try {
    const line = deps.meter.line(quote.vendor);
    const got = await source.observe(ids, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline });
    await deps.ledger.add('quote', now, got.spend.usd);
    const likes = new Map<string, number>();
    for (const [id, counters] of got.value) {
      const v = counters.approval?.value;
      if (typeof v === 'number') likes.set(id, v);
    }
    return { kind: 'read', likes, usd: got.spend.usd, answered: true };
  } catch (e) {
    if (!(e instanceof BudgetRefused)) await deps.ledger.add('quote', now, quote.usd);
    deps.log.warn("big posts' likes could not be read again; tried next pass", { posts: ids.length, err: errorText(e) });
    return { kind: 'read', likes: new Map(), usd: 0, answered: false };
  }
}
