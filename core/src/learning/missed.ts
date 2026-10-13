/**
 * WHY WE MISSED A POST THE OWNER SAYS WE SHOULD HAVE SHOWN, and — when most were never found —
 * the change to the search that would have caught them, with what it would cost a day.
 *
 * Pure, in core, because it is a decision about our own pipeline made from recorded facts: the
 * runner gathers what we held of the post, the judge's answer, its view readings and when it was
 * shown (services/runner/src/work/missed-posts.ts), and this file names the step that let it go.
 * Tested on recorded facts beside it, so the order of claims below cannot drift unnoticed.
 *
 * ★ THE ORDER IS THE CLAIM, FIRST GATE FIRST. A post the catch-all search never returned is
 * `never_found` whatever the judge would have said, because no later gate ever saw it. Then: no
 * answer yet (`not_judged`), shown (`shown`, or `shown_late` when a coin of its name launched
 * before we showed it), the judge's answer kept it off (`rejected`), its views never cleared a bar
 * (`under_reach_bar`), and last `unsure`: every gate passed and yet it was never recorded as shown.
 * `unsure` is an answer, never a guess at one of the others.
 *
 * ★ WHY IT WAS NEVER FOUND IS THE RECALL MODEL'S (core/src/sources/recall.ts), asked of the post as
 * read now — the same model the daily recall check names its misses with. When the model says the
 * search WOULD have caught it, the answer is `unexplained`, not a reason picked to fit.
 *
 * ★ A SUGGESTION IS TEXT FOR THE OWNER, NEVER APPLIED. Its cost rests on stated assumptions —
 * posts returned over a floor fall as one over the floor, posts in a window grow with the window —
 * and is capped at what every page of every pass would cost. Each assumption is in the text.
 *
 * What breaks if changed carelessly: MISSED_DIAGNOSES and MISSED_FAILURES are the CHECK lists of
 * store/migrations/0055_missed_post.sql; services/runner/src/work/missed-posts.test.ts keeps them equal.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_DAY, MS_PER_MINUTE } from '../math.ts';
import { clearsReachBar, type ReachLevel } from '../qualify/reach-bar.ts';
import { postScoreReason } from '../qualify/post-score.ts';
import { approvalsAt, crossingAgeMin, searchFilter, verdict, type DiscoverySettings, type PostFacts } from '../sources/recall.ts';

export const MISSED_DIAGNOSES = ['never_found', 'not_judged', 'rejected', 'under_reach_bar', 'shown_late', 'shown', 'unsure'] as const;
export type MissedDiagnosis = (typeof MISSED_DIAGNOSES)[number];

/** Why a pasted link has nothing to diagnose. */
export const MISSED_FAILURES = ['not_a_post', 'unreadable', 'duplicate', 'no_source', 'no_line'] as const;
export type MissedFailure = (typeof MISSED_FAILURES)[number];

/** How the post's source is searched: approval-floor lanes, or a watch list of tags asked in turn. */
export type SearchKind = 'floor' | 'watch';

export interface MissedJudgeAnswer {
  readonly coinable: boolean;
  readonly confidence: number;
  readonly lookedAt: 'text' | 'videoFrame';
  readonly proposedName: string | null;
  readonly alternateNames: readonly string[];
  readonly judgedAtMs: number;
}

export interface MissedCase {
  readonly search: SearchKind;
  readonly postedAtMs: number | null;
  /** The post as read now, with its tags (lower case, no '#'). */
  readonly post: PostFacts & { readonly tags: readonly string[] };
  /** What we held BEFORE the paste: null when we never had it. `foundBy` null: held, but not from the catch-all. */
  readonly held: { readonly firstSeenAtMs: number; readonly foundBy: { readonly lane: string; readonly atMs: number } | null } | null;
  readonly judgement: MissedJudgeAnswer | null;
  /** Measured view readings, oldest first. */
  readonly reach: readonly ReachLevel[];
  readonly shownAtMs: number | null;
  /** The earliest launch among coins of its name launched after it; null when none was found. */
  readonly firstCoinAtMs: number | null;
}

export interface MissedContext {
  /** The floor search's settings as measured; null when they could not be (no growth curve yet). */
  readonly settings: DiscoverySettings | null;
  /** The tags the watch-list source is asked for. */
  readonly watchTags: readonly string[];
}

export interface Diagnosed {
  readonly diagnosis: MissedDiagnosis;
  readonly detail: Readonly<Record<string, unknown>>;
}

const minutes = (ms: number): number => Math.round(ms / MS_PER_MINUTE);
const minutesBetween = (fromMs: number | null, toMs: number | null): number | null => (fromMs === null || toMs === null ? null : minutes(toMs - fromMs));

/** When the readings first cleared For You's or Popular's bar, or null when they never did. */
export function crossedBarAt(reach: readonly ReachLevel[], postedAtMs: number | null, p: Policy): number | null {
  for (let i = 0; i < reach.length; i += 1) {
    const sofar = reach.slice(0, i + 1);
    if (clearsReachBar('fyp', sofar, postedAtMs, p) || clearsReachBar('popular', sofar, postedAtMs, p)) return reach[i]?.atMs ?? null;
  }
  return null;
}

function neverFound(c: MissedCase, ctx: MissedContext): Diagnosed {
  const base = { held: c.held !== null, approvals: c.post.approvals, lang: c.post.lang };
  if (c.search === 'watch') {
    const watched = c.post.tags.filter((t) => ctx.watchTags.includes(t));
    return watched.length === 0
      ? { diagnosis: 'never_found', detail: { ...base, why: 'not_in_search', filter: 'tag', tags: c.post.tags } }
      : { diagnosis: 'never_found', detail: { ...base, why: 'between_checks', tags: c.post.tags, watched } };
  }
  const s = ctx.settings;
  if (s === null) return { diagnosis: 'never_found', detail: { ...base, why: 'unsure' } };
  const filter = searchFilter(c.post, null, s);
  if (filter !== null) return { diagnosis: 'never_found', detail: { ...base, why: 'not_in_search', filter } };
  const v = verdict(c.post, s);
  if (v.kind === 'caught') return { diagnosis: 'never_found', detail: { ...base, why: 'unexplained', lane: v.lane, modelMinutes: Math.round(v.delayMin) } };
  const main = s.lanes.find((l) => l.lane === 'all') ?? s.lanes[0];
  const crossedMin = main === undefined ? null : crossingAgeMin(c.post.approvals, main.floor, s.tauMin);
  return {
    diagnosis: 'never_found',
    detail: {
      ...base,
      why: v.reason,
      floor: main?.floor ?? null,
      reachMinutes: main?.reachMin ?? null,
      crossedFloorMinutes: crossedMin === null || !Number.isFinite(crossedMin) ? null : Math.round(crossedMin),
    },
  };
}

export function diagnoseMissed(c: MissedCase, ctx: MissedContext, p: Policy): Diagnosed {
  if (c.held === null || c.held.foundBy === null) return neverFound(c, ctx);

  const found = { foundMinutes: minutesBetween(c.postedAtMs, c.held.foundBy.atMs), lane: c.held.foundBy.lane };
  if (c.judgement === null) return { diagnosis: 'not_judged', detail: found };

  if (c.shownAtMs !== null) {
    const barAt = crossedBarAt(c.reach, c.postedAtMs, p);
    const shown = {
      ...found,
      shownMinutes: minutesBetween(c.postedAtMs, c.shownAtMs),
      crossedBarMinutes: minutesBetween(c.postedAtMs, barAt),
      barToShownMinutes: minutesBetween(barAt, c.shownAtMs),
    };
    if (c.firstCoinAtMs !== null && c.shownAtMs > c.firstCoinAtMs) return { diagnosis: 'shown_late', detail: { ...shown, afterCoinMinutes: minutes(c.shownAtMs - c.firstCoinAtMs) } };
    return { diagnosis: 'shown', detail: { ...shown, beforeCoinMinutes: c.firstCoinAtMs === null ? null : minutes(c.firstCoinAtMs - c.shownAtMs) } };
  }

  const said = postScoreReason(c.judgement, p);
  const judge = {
    said,
    coinable: c.judgement.coinable,
    confidence: c.judgement.confidence,
    lookedAt: c.judgement.lookedAt,
    name: c.judgement.proposedName,
    alternates: c.judgement.alternateNames,
    judgedAtMs: c.judgement.judgedAtMs,
  };
  if (said !== 'passes') return { diagnosis: 'rejected', detail: { ...found, judge } };

  const fyp = clearsReachBar('fyp', c.reach, c.postedAtMs, p);
  const popular = clearsReachBar('popular', c.reach, c.postedAtMs, p);
  const read = c.reach.filter((r): r is { atMs: number; reach: number } => r.reach !== null);
  const most = read.reduce<{ atMs: number; reach: number } | null>((m, r) => (m === null || r.reach > m.reach ? r : m), null);
  const seen = { mostReach: most?.reach ?? null, mostReachMinutes: minutesBetween(c.postedAtMs, most?.atMs ?? null), readings: read.length, fypBar: p.rising.fypMinReach };
  if (!fyp && !popular) return { diagnosis: 'under_reach_bar', detail: { ...found, judge, ...seen } };
  return { diagnosis: 'unsure', detail: { ...found, judge, ...seen, crossedBarMinutes: minutesBetween(c.postedAtMs, crossedBarAt(c.reach, c.postedAtMs, p)) } };
}

/* ── the suggestion ───────────────────────────────────────────────── */

export interface SuggestionInput {
  /** Every diagnosed missed post: its source's search kind, the diagnosis and its facts. */
  readonly rows: readonly { readonly search: SearchKind; readonly diagnosis: string; readonly detail: Readonly<Record<string, unknown>> }[];
  readonly settings: DiscoverySettings | null;
  /** What the floor search cost on the live book in the last day, measured. Null when unread. */
  readonly searchUsdPerDay: number | null;
  /** What one post returned by the floor search costs. */
  readonly usdPerPost: number | null;
}

export interface Suggestion {
  /** Null when most missed posts were found: no search change is the answer then. */
  readonly text: string | null;
  readonly facts: Readonly<Record<string, unknown>>;
}

const money = (usd: number): string => `$${usd.toFixed(2)}`;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function counted(values: readonly string[]): readonly [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function missedSuggestion(input: SuggestionInput, p: Policy): Suggestion {
  const total = input.rows.length;
  const never = input.rows.filter((r) => r.diagnosis === 'never_found');
  const facts = { total, neverFound: never.length };
  if (total === 0 || never.length * 2 <= total) return { text: null, facts };

  const s = input.settings;
  const main = s?.lanes.filter((l) => l.lane !== 'slow') ?? [];
  const all = main.find((l) => l.lane === 'all') ?? main[0] ?? null;
  /* The most the main lanes could cost a day: every page of every pass full. The cap on each
     cost below — the adaptive floor keeps the real bill inside the posts line in any case. */
  const ceilingUsd =
    all === null || input.usdPerPost === null ? null : (MS_PER_DAY / (all.everyMin * MS_PER_MINUTE)) * main.length * p.feed.maxPagesPerLane * p.feed.pageLimit * input.usdPerPost;
  const today = input.searchUsdPerDay;
  const more = (ratio: number): string => {
    if (today === null) return 'cost unknown: the search spend of the last day could not be read';
    const extra = Math.max(0, today * (ratio - 1));
    const capped = ceilingUsd === null ? extra : Math.min(extra, Math.max(0, ceilingUsd - today));
    return `about ${money(capped)} a day more (today ${money(today)})`;
  };

  const lines: string[] = [];
  const floorRows = never.filter((r) => r.search === 'floor');
  const by = (why: string) => floorRows.filter((r) => str(r.detail['why']) === why);

  const language = by('not_in_search').filter((r) => str(r.detail['filter']) === 'language');
  if (language.length > 0) {
    const langs = counted(language.map((r) => str(r.detail['lang']) ?? 'none'));
    const cost = today === null || ceilingUsd === null ? 'cost unknown' : `at most ${money(Math.max(0, ceilingUsd - today))} a day more if every page filled (today ${money(today)})`;
    lines.push(`${language.length} were in a language the search leaves out (${langs.map(([l, n]) => `${l} ${n}`).join(', ')}): add ${langs.map(([l]) => `'${l}'`).join(', ')} to feed.langs. Cost: ${cost}; the floor rises to hold the posts line.`);
  }

  const under = by('under_floor');
  if (under.length > 0 && all !== null && s !== null) {
    /* The floor each would have crossed while the main lane still reached it. */
    const needed = under
      .map((r) => num(r.detail['approvals']))
      .filter((a): a is number => a !== null)
      .map((a) => approvalsAt(a, all.reachMin - all.everyMin / 2, s.tauMin));
    const floor = Math.floor(Math.min(...needed));
    if (needed.length > 0 && floor >= 1 && floor < all.floor) {
      lines.push(`${under.length} never reached the main lane's floor of ${all.floor} approvals in its ${all.reachMin} minutes: a floor of ${floor} would have caught them. Cost, if posts over a floor fall as one over the floor: ${more(all.floor / floor)}.`);
    } else {
      lines.push(`${under.length} never reached the main lane's floor of ${all.floor} approvals; no floor the lane can send would have caught them in its ${all.reachMin} minutes.`);
    }
  }

  const late = by('between_checks');
  if (late.length > 0 && all !== null) {
    const crossed = late.map((r) => num(r.detail['crossedFloorMinutes'])).filter((m): m is number => m !== null);
    if (crossed.length > 0) {
      const window = Math.ceil(Math.max(...crossed) + all.everyMin / 2);
      lines.push(`${late.length} crossed the floor after the main lane stopped looking back (${all.reachMin} minutes): looking back ${window} minutes (feed.windowMin) would have caught them. Cost, if posts in a window grow with the window: ${more(window / Math.max(all.reachMin, 1))}.`);
    }
  }

  const tagRows = never.filter((r) => r.search === 'watch' && str(r.detail['why']) === 'not_in_search');
  if (tagRows.length > 0) {
    const tags = counted(tagRows.flatMap((r) => (Array.isArray(r.detail['tags']) ? r.detail['tags'].filter((t): t is string => typeof t === 'string') : [])));
    /* The tags most of them carried, or the commonest one when none is shared by most. */
    const shared = tags.filter(([, n]) => n * 2 > tagRows.length);
    const top = (shared.length > 0 ? shared : tags.slice(0, 1)).map(([t]) => `#${t}`);
    if (top.length > 0) lines.push(`${tagRows.length} short videos carried no watched tag: watching ${top.join(', ')} (feed.hashtags) would have asked for them. Cost: no more a day, since the watch asks one tag a turn; each tag is asked less often.`);
  }

  const unexplained = never.filter((r) => str(r.detail['why']) === 'unexplained' || str(r.detail['why']) === 'unsure').length;
  if (unexplained > 0) lines.push(`${unexplained} the model says the search would have caught, or could not tell: no search change is suggested for them.`);

  const head = `${never.length} of ${total} missed posts were never found by the search.`;
  return { text: [head, ...lines].join(' '), facts: { ...facts, ceilingUsd, searchUsdPerDay: today } };
}
