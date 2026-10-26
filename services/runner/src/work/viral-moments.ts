/**
 * THE VIRAL EXCEPTION, ASKED: each huge, fast post the judge turned down gets the viral-moment
 * question and, when that says yes, the kind question; both answers go to internal.viral_moment
 * (0138), which the projector's viral route reads (Policy.judge.viral, core viral.ts).
 *
 * Its own step, not part of score-posts.ts, because it asks about posts that file has finished
 * with: their first answer is a "no", or a politics or showbiz hold, and nothing there will ask
 * them again. It runs in the early loop beside the quote boost (early-judge.ts) — its own cadence,
 * never the discovery pass, whose stalls emptied the feed twice on 2026-10-16.
 *
 * ★ BOUNDED THREE WAYS, LIKE EARLY JUDGING: `maxPerPass` posts a pass (the biggest first), the early
 * loop's `everyMs` between passes, and `dailyUsd` a UTC day of both questions' spend, kept in
 * internal.lane_spend (lane 'viral', 0088) so a restart does not refill it. An unreadable ledger
 * asks nothing (fail closed). A post is asked once: the queue leaves out every post with a row.
 *
 * ★ THE OWNER'S LABELS FIRST, FOR FREE. A post at least `holdNotSimilarity` close to one the owner
 * called "not a meme" is filed as a "no" by rule (kind NOT_MEME_MATCH), with no question asked — as
 * score-posts.ts holds a near match. The precedents are read, never refreshed here: refreshing is
 * the discovery pass's, and two at once would embed the same new labels twice.
 *
 * ★ NO ANSWER IS NOT A NO. An outage, a budget pause or a dry run writes nothing and the post is
 * asked again next pass. A moment "yes" whose kind reply named no kind is written with its kind
 * null — it waits off the feed (core `passesAsViral`) — and the kind alone is asked again on later
 * passes, at most `maxKindAsks` times in all: on 2026-10-26 the open model's kind reply about the
 * Nicki Minaj post ran on inside its confidence number twice running, and asking both questions
 * again every minute would have paid for the moment answer over and over.
 *
 * ★ A QUOTE IS SHOWN WITH WHAT IT QUOTES. A post with no picture of its own that quotes another
 * (@elonmusk's "So beautiful") is sent with the quoted post's words and picture beside its own: that
 * is what the people coining it saw. The first question never does this; only this one does.
 *
 * What breaks if changed carelessly: the answers are matched back to posts by the subject id the
 * judge echoes (score-posts.ts `subjectIdFor`), never by position — a reply that skips one post
 * would otherwise file every later post's answer under its neighbour.
 */

import type { Item, Millis } from '@insidor/contracts';
import type { ItemId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { NOT_MEME_MATCH, clearsViralBar, heldAsNotMeme, viralEligible } from '@insidor/core';
import type { PgItemRepo, PgViralMomentRepo, ViralRecord } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { CappedLane, LaneLedger } from './lane-ledger.ts';
import type { PrecedentSource } from './precedents.ts';
import { subjectIdFor } from './score-posts.ts';

/** Its row in the capped lanes' ledger (0088). */
export const VIRAL_LANE: CappedLane = 'viral';

/** How many posts the queue reads for each one a pass may ask: the pace check is core's, after. */
const PREFETCH_FACTOR = 5;

export interface ViralDeps {
  /** The viral-moment question; null when no judge is wired: nothing is asked. */
  readonly viralJudge: JudgePort | null;
  /** The feed's kind question; null: a moment "yes" is not written, and waits. */
  readonly kindJudge: JudgePort | null;
  readonly repo: Pick<PgViralMomentRepo, 'due' | 'record'> & Partial<Pick<PgViralMomentRepo, 'kindDue' | 'recordKind'>>;
  readonly items: Pick<PgItemRepo, 'byIds' | 'reachReadings'>;
  /** The owner's labels, for the not-a-meme hold; absent or null: nothing is held by it. */
  readonly precedents?: Pick<PrecedentSource, 'forPosts'> | null;
  readonly ledger: Pick<LaneLedger, 'spent' | 'add'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface ViralResult {
  /** Posts sent to the moment question, or filed by the not-a-meme rule. */
  readonly asked: number;
  /** Answers written. */
  readonly written: number;
  /** Of those, the moments the kind question let through (core `passesAsViral` decides on the feed). */
  readonly moments: number;
  readonly spentUsd: number;
  /** Why nothing was asked, when nothing was. */
  readonly held?: 'off' | 'no-judge' | 'ledger' | 'cap' | 'dry';
}

const nothing = (held?: ViralResult['held']): ViralResult => ({ asked: 0, written: 0, moments: 0, spentUsd: 0, ...(held === undefined ? {} : { held }) });

/** The post as this question is shown it: with the post it quotes when it has no picture of its own (see the header). */
export function viralSubject(item: Item, quoted: Item | null, p: Policy): JudgeSubject {
  const own = item.text.trim().slice(0, p.judge.maxCharsPerText);
  const theirs = quoted === null ? '' : quoted.text.trim().slice(0, p.judge.maxCharsPerText);
  const borrow = quoted !== null && item.media.length === 0;
  return {
    storyId: subjectIdFor(item),
    texts: [...(own === '' ? [] : [own]), ...(borrow && theirs !== '' ? [`Quoting: ${theirs}`] : [])],
    media: borrow ? quoted.media : item.media,
    distinctAuthors: 1,
    distinctSources: 1,
  };
}

/** These posts as this question is shown them, each with the post it quotes read alongside. */
async function subjectsOf(deps: ViralDeps, items: readonly Item[]): Promise<readonly JudgeSubject[]> {
  const quotedIds = items.flatMap((i) => (i.reproductionOf === null || i.media.length > 0 ? [] : [i.reproductionOf]));
  const quoted = quotedIds.length === 0 ? new Map<ItemId, Item>() : await deps.items.byIds(quotedIds);
  return items.map((i) => viralSubject(i, i.reproductionOf === null ? null : (quoted.get(i.reproductionOf) ?? null), deps.policy));
}

/** The kind label a judged answer named, upper-cased; null when it named none. */
const kindOf = (o: JudgeOutcome | undefined): string | null => (o?.kind === 'judged' ? (o.judgement.proposedName ?? '').trim().toUpperCase() || null : null);

/**
 * ★ THE KIND CATCH-UP: "yes" moments whose kind reply named nothing, asked the kind alone again (see
 * the header). Returns what it spent. Without the repository's two methods, or a kind judge, nothing.
 */
async function kindCatchUp(deps: ViralDeps, now: Millis): Promise<number> {
  const v = deps.policy.judge.viral;
  const find = deps.repo.kindDue?.bind(deps.repo);
  const write = deps.repo.recordKind?.bind(deps.repo);
  if (deps.kindJudge === null || find === undefined || write === undefined) return 0;
  const ids = await find({ since: (now - v.maxAgeMs) as Millis, maxAsks: v.maxKindAsks, limit: v.maxPerPass });
  if (ids.length === 0) return 0;
  const found = await deps.items.byIds(ids as ItemId[]);
  const items = ids.flatMap((id) => found.get(id as ItemId) ?? []);
  if (items.length === 0) return 0;
  const asked = await ask(deps, deps.kindJudge, items, await subjectsOf(deps, items), now);
  if (asked === null) return 0;
  const each = asked.usd / items.length;
  for (const item of items) {
    const kind = kindOf(asked.byItem.get(String(item.itemId)));
    try {
      await write(String(item.itemId), kind === null ? null : { judgeId: deps.kindJudge.id, kind }, each);
    } catch (e) {
      deps.log.warn('viral moments: a kind answer could not be written', { post: String(item.itemId), err: errorText(e) });
    }
  }
  deps.log.info('viral moments: kind asked again', { posts: items.length, named: items.filter((i) => kindOf(asked.byItem.get(String(i.itemId))) !== null).length, usd: Number(asked.usd.toFixed(6)) });
  return asked.usd;
}

/** One question to one batch, priced and metered first; the outcomes by post id, and what it cost. Null: not asked. */
async function ask(deps: ViralDeps, judge: JudgePort, items: readonly Item[], subjects: readonly JudgeSubject[], now: Millis): Promise<{ readonly byItem: ReadonlyMap<string, JudgeOutcome>; readonly usd: number } | null> {
  const estimate = judge.estimate(subjects);
  if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
    deps.log.warn('viral moments paused for budget; these posts wait', { posts: subjects.length, wouldSpendUsd: estimate.usd });
    return null;
  }
  const line = deps.meter.line(estimate.vendor);
  try {
    const result = await judge.judge(subjects, {
      capUsd: line.capUsd,
      spentUsd: line.spentUsd,
      maxCalls: null,
      deadline: (now + deps.policy.judge.timeoutMs * deps.policy.judge.maxAttempts) as Millis,
    });
    const byKey = new Map(items.map((item) => [String(subjectIdFor(item)), String(item.itemId)] as const));
    const byItem = new Map<string, JudgeOutcome>();
    for (const [index, outcome] of result.value.entries()) {
      const key = outcome.kind === 'judged' ? String(subjects[index]?.storyId) : String(outcome.storyId);
      const id = byKey.get(key);
      if (id !== undefined) byItem.set(id, outcome);
    }
    return { byItem, usd: result.spend.usd };
  } catch (e) {
    if (e instanceof BudgetRefused) deps.log.warn('viral moments paused for budget at the vendor edge; these posts wait', { posts: subjects.length });
    else deps.log.error('viral moments: the judge failed; these posts wait', { posts: subjects.length, err: errorText(e) });
    return null;
  }
}

/** One pass: see the header. Says once per day when the cap holds it. */
export function viralMoments(deps: ViralDeps): () => Promise<ViralResult> {
  let capSaidFor: string | null = null;
  return async () => {
    const p = deps.policy;
    const v = p.judge.viral;
    if (!v.on) return nothing('off');
    if (deps.viralJudge === null) return nothing('no-judge');
    if (deps.mode !== 'live') return nothing('dry');
    const now = deps.now();
    const spent = await deps.ledger.spent(VIRAL_LANE, now);
    if (spent === null) {
      deps.log.warn('viral moments: what it spent today cannot be read; it asks nothing until it can', { lane: VIRAL_LANE });
      return nothing('ledger');
    }
    if (spent >= v.dailyUsd) {
      const day = new Date(now).toISOString().slice(0, 10);
      if (capSaidFor !== day) {
        capSaidFor = day;
        deps.log.info('viral moments: the day\'s cap is spent; huge posts the judge turned down stay off For You', { spentUsd: Number(spent.toFixed(4)), capUsd: v.dailyUsd });
      }
      return nothing('cap');
    }
    const since = (now - v.maxAgeMs) as Millis;
    let caughtUp = 0;
    try {
      caughtUp = await kindCatchUp(deps, now);
    } catch (e) {
      deps.log.warn('viral moments: the kind catch-up could not run; tried again next pass', { err: errorText(e) });
    }
    let due: Awaited<ReturnType<ViralDeps['repo']['due']>>;
    try {
      due = await deps.repo.due({ since, minReach: v.minReach, liftsKinds: v.liftsKinds, heldKinds: p.judge.heldKinds, limit: v.maxPerPass * PREFETCH_FACTOR });
    } catch (e) {
      deps.log.warn('viral moments: the queue could not be read (0138 not applied?); nothing asked', { err: errorText(e) });
      return nothing();
    }
    if (due.length === 0) return caughtUp === 0 ? nothing() : { ...nothing(), spentUsd: await charged(deps, caughtUp) };
    const readings = await deps.items.reachReadings(due.map((d) => d.itemId as ItemId), since);
    const picked = due.filter((d) => viralEligible(d.firstCoinable, d.kindLabel, p) && clearsViralBar(readings.get(d.itemId) ?? [], d.postedAtMs, p)).slice(0, v.maxPerPass);
    if (picked.length === 0) return caughtUp === 0 ? nothing() : { ...nothing(), spentUsd: await charged(deps, caughtUp) };
    const found = await deps.items.byIds(picked.map((d) => d.itemId as ItemId));
    const items = picked.flatMap((d) => found.get(d.itemId as ItemId) ?? []);
    const records: ViralRecord[] = [];
    const at = (): Date => new Date(deps.now());

    /* ★ The owner's labels first: a near match to a "not a meme" is a no by rule, and is not asked. */
    const near = deps.precedents === undefined || deps.precedents === null ? new Map() : await deps.precedents.forPosts(items).catch(() => new Map());
    const toAsk: Item[] = [];
    for (const item of items) {
      const closest = near.get(String(item.itemId))?.closestNot ?? null;
      if (closest !== null && heldAsNotMeme(closest, p)) {
        records.push({ itemId: String(item.itemId), askedAt: at(), judgeId: `rule:not-meme-match@${p.judge.precedents.holdNotSimilarity}`, moment: false, confidence: Math.min(1, Math.max(0, closest)), name: null, kindJudgeId: null, kind: NOT_MEME_MATCH, kindAsks: 0, costUsd: 0 });
      } else toAsk.push(item);
    }

    let usd = 0;
    let moments = 0;
    const subjects = await subjectsOf(deps, toAsk);
    const subjectOf = new Map(toAsk.map((item, i) => [String(item.itemId), subjects[i]] as const));
    const first = toAsk.length === 0 ? null : await ask(deps, deps.viralJudge, toAsk, subjects, now);
    if (first !== null) {
      usd += first.usd;
      const yes: Item[] = [];
      for (const item of toAsk) {
        const o = first.byItem.get(String(item.itemId));
        if (o === undefined || o.kind !== 'judged') continue;
        if (o.judgement.coinable) yes.push(item);
        else records.push({ itemId: String(item.itemId), askedAt: at(), judgeId: deps.viralJudge.id, moment: false, confidence: o.judgement.confidence, name: null, kindJudgeId: null, kind: null, kindAsks: 0, costUsd: 0 });
      }
      /* ★ A moment "yes" meets the kind question: a tragedy, an ad or company news stays off. */
      const kinds = yes.length === 0 || deps.kindJudge === null ? null : await ask(deps, deps.kindJudge, yes, yes.flatMap((item) => subjectOf.get(String(item.itemId)) ?? []), now);
      if (kinds !== null) usd += kinds.usd;
      for (const item of yes) {
        const o = first.byItem.get(String(item.itemId));
        if (o === undefined || o.kind !== 'judged') continue;
        const kind = kindOf(kinds?.byItem.get(String(item.itemId)));
        if (kind !== null && v.passKinds.includes(kind)) moments += 1;
        records.push({ itemId: String(item.itemId), askedAt: at(), judgeId: deps.viralJudge.id, moment: true, confidence: o.judgement.confidence, name: o.judgement.proposedName, kindJudgeId: kind === null || deps.kindJudge === null ? null : deps.kindJudge.id, kind, kindAsks: kinds === null ? 0 : 1, costUsd: 0 });
      }
    }
    /* What the pass cost, spread over the answers it wrote, so a row says roughly what it cost. */
    const each = records.length === 0 ? 0 : usd / records.length;
    let written = 0;
    for (const r of records) {
      try {
        await deps.repo.record({ ...r, costUsd: r.judgeId.startsWith('rule:') ? 0 : each });
        written += 1;
      } catch (e) {
        deps.log.warn('viral moments: an answer could not be written; the post is asked again', { post: r.itemId, err: errorText(e) });
      }
    }
    await charged(deps, usd + caughtUp);
    deps.log.info('viral moments', { due: due.length, asked: items.length, written, moments, yes: records.filter((r) => r.moment).map((r) => `${r.itemId}:${r.name ?? ''}:${r.kind ?? '?'}`), usd: Number(usd.toFixed(6)) });
    return { asked: items.length, written, moments, spentUsd: usd + caughtUp };
  };
}

/** Charges the pass's spend to its lane; returns it. A ledger that cannot be written is said, not thrown. */
async function charged(deps: ViralDeps, usd: number): Promise<number> {
  if (usd <= 0) return usd;
  try {
    await deps.ledger.add(VIRAL_LANE, deps.now(), usd);
  } catch (e) {
    deps.log.error('viral moments could not record what it spent', { usd, err: errorText(e) });
  }
  return usd;
}
