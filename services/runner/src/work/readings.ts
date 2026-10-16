/**
 * VIEW READINGS FOR THE SHEET'S CHART: one pass of the readings loop (Policy.feed.readings).
 *
 * The owner, 2026-10-16: "Store every view reading with its timestamp. For posts on FYP: every 1
 * minute while under 2 hours old, every 5 minutes up to 6 hours, every 15 minutes after. Plus a
 * reading whenever someone opens the post sheet, if the last one is over 1 minute old." Every
 * reading already lands in public.observation with the source's own time (append-only, never
 * pruned, 0003); what was missing was the cadence. This reads, on each pass:
 *   - every post on For You whose newest reading is older than its age's step (`cadence`, or
 *     `shortVideoCadence` for the short-video source), stalest first;
 *   - every post whose sheet was opened (internal.reading_ask, 0090) when its newest reading was
 *     over `openReadMinGapMs` old at the open, up to `openMaxPerPass`, newest open first;
 * and appends what came back exactly as TRACK does (core's `observationsFrom`).
 *
 * ★ ITS OWN LOOP, TIME AND MONEY. Not a tier inside TRACK and not a step after discovery: a slow
 * source here costs this loop its pass and nothing else (`passDeadlineMs`). Its dollars are its own
 * lane in internal.lane_spend ('readings'), read before each ask and FAILING CLOSED (lane-ledger.ts):
 * a ledger it cannot read means no ask. It also stops while the live book has under
 * `bookReserveUsd` left, so it never spends the money discovery and the judge run on.
 *
 * ★ A SOURCE BILLED BY THE RUN IS NOT READ HERE. When a source's quote for this pass is over
 * `maxUsdPerRead` a post — the short-video source on its backup scraper — it waits for TRACK, which
 * already reads it in rationed runs. A run a minute would cost more than the whole lane.
 *
 * What breaks if changed carelessly: an open with no reading at all is due, and a post with no
 * reading on For You is due at once: "never read" is the stalest there is, never "just read".
 * A post with no posting time is read at the slowest step — an unknown age is not a young one.
 */

import type { CounterSet, Millis, Policy } from '@insidor/contracts';
import type { ReadingCadence } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { latestCounters, observationsFrom } from '@insidor/core';
import type { PlatformRegistry } from '@insidor/platform-registry';
import type { PgObservationRepo, PgReadingsRepo, ReadingCandidate } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import { sourceHandles } from './handle-cache.ts';
import type { LaneLedger } from './lane-ledger.ts';

/** The source whose re-reads are paid credits, with a cadence of its own (as stages.ts names it). */
const SHORT_VIDEO_SOURCE = 'tiktok';

export interface ReadingsDeps {
  readonly platforms: Pick<PlatformRegistry, 'get' | 'has'>;
  readonly readings: Pick<PgReadingsRepo, 'candidates' | 'answered' | 'expire'>;
  readonly observations: Pick<PgObservationRepo, 'latestForItems' | 'append'>;
  /** Absent: the lane cannot count its money, so it asks nothing. */
  readonly ledger: LaneLedger | undefined;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface ReadingsResult {
  /** Posts owed a reading this pass, after the per-pass caps. */
  readonly due: number;
  /** Of those, how many were owed one because their sheet was opened. */
  readonly opened: number;
  readonly asked: number;
  readonly answered: number;
  readonly spentUsd: number;
  readonly wouldSpendUsd: number;
  /** Why a source was not asked, when one was not: off, ledger, cap, book, meter, price, deadline. */
  readonly held: readonly string[];
}

const NONE: ReadingsResult = { due: 0, opened: 0, asked: 0, answered: 0, spentUsd: 0, wouldSpendUsd: 0, held: [] };

/** How often a post this old is read: the first step it is younger than, else `thenEveryMs`. */
export function stepFor(ageMs: number | null, cadence: ReadingCadence): number {
  if (ageMs === null) return cadence.thenEveryMs;
  for (const step of cadence.steps) if (ageMs < step.underMs) return step.everyMs;
  return cadence.thenEveryMs;
}

export const cadenceOf = (source: string, p: Policy): ReadingCadence =>
  source === SHORT_VIDEO_SOURCE ? p.feed.readings.shortVideoCadence : p.feed.readings.cadence;

/** For You's cadence owes this post a reading now. */
export function cadenceDue(c: ReadingCandidate, now: number, p: Policy): boolean {
  if (!c.onForYou) return false;
  if (c.lastReadAt === null) return true;
  const step = stepFor(c.postedAt === null ? null : now - c.postedAt, cadenceOf(c.source, p));
  return now - c.lastReadAt >= step - p.feed.readings.dueSlackMs;
}

/** An opened sheet owes this post a reading: nothing was read within `openReadMinGapMs` before the open, nor since. */
export function openDue(c: ReadingCandidate, p: Policy): boolean {
  if (c.openedAt === null) return false;
  return c.lastReadAt === null || c.lastReadAt < c.openedAt - p.feed.readings.openReadMinGapMs;
}

/** The posts to read this pass, in the order they are owed: opened sheets first, then For You stalest first. */
export function dueReadings(candidates: readonly ReadingCandidate[], now: number, p: Policy): { readonly posts: readonly ReadingCandidate[]; readonly opened: number } {
  const r = p.feed.readings;
  const opened = candidates
    .filter((c) => openDue(c, p))
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
    .slice(0, r.openMaxPerPass);
  const taken = new Set(opened.map((c) => c.itemId));
  const cadence = candidates
    .filter((c) => !taken.has(c.itemId) && cadenceDue(c, now, p))
    .sort((a, b) => (a.lastReadAt ?? -Infinity) - (b.lastReadAt ?? -Infinity));
  const posts = [...opened, ...cadence].slice(0, r.maxPostsPerPass);
  return { posts, opened: Math.min(opened.length, posts.length) };
}

/** What the loop remembers between passes: which held reasons it has already said, so a quiet day is not a log line a pass. */
export interface ReadingsMemory {
  readonly said: Set<string>;
}

export const readingsMemory = (): ReadingsMemory => ({ said: new Set() });

export async function readingsPass(deps: ReadingsDeps, memory: ReadingsMemory = readingsMemory()): Promise<ReadingsResult> {
  const p = deps.policy;
  const r = p.feed.readings;
  const started = deps.now();
  const deadline = started + r.passDeadlineMs;
  const held: string[] = [];
  const hold = (why: string, fields: Record<string, unknown> = {}): void => {
    held.push(why);
    if (memory.said.has(why)) return;
    memory.said.add(why);
    deps.log.info('readings held; nothing asked for these posts', { why, ...fields });
  };

  if (!r.on) {
    hold('off');
    return { ...NONE, held };
  }
  if (deps.ledger === undefined) {
    hold('ledger');
    return { ...NONE, held };
  }

  let candidates: readonly ReadingCandidate[];
  try {
    candidates = await deps.readings.candidates(new Date(started - r.openAskMaxAgeMs));
  } catch (e) {
    /* Before 0090 the opens cannot be read; For You's cadence does not need them. */
    deps.log.warn('opened sheets could not be read; For You alone this pass', { err: errorText(e) });
    try {
      candidates = await deps.readings.candidates(new Date(started), true);
    } catch (e2) {
      deps.log.warn('posts to read could not be listed; tried again next pass', { err: errorText(e2) });
      return NONE;
    }
  }
  await deps.readings.expire(new Date(started - r.openAskMaxAgeMs)).catch(() => 0);

  const { posts, opened } = dueReadings(candidates, started, p);
  if (posts.length === 0) return NONE;

  let asked = 0;
  let answered = 0;
  let spentUsd = 0;
  let wouldSpendUsd = 0;
  const previous = await deps.observations.latestForItems(posts.map((c) => c.itemId as never));

  for (const source of new Set(posts.map((c) => c.source))) {
    const mine = posts.filter((c) => c.source === source);
    if (!deps.platforms.has(source as never)) {
      hold(`no-adapter:${source}`, { source });
      continue;
    }
    if (deps.now() >= deadline) {
      hold('deadline', { source, posts: mine.length });
      continue;
    }
    const adapter = deps.platforms.get(source as never);
    sourceHandles.warm(source, mine.flatMap((c) => (c.handle === null ? [] : [[c.sourceItemId, c.handle] as const])));
    const ids = mine.map((c) => c.sourceItemId);
    const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: ids });
    if (estimate.usd / ids.length > r.maxUsdPerRead) {
      hold(`price:${source}`, { source, usdPerRead: estimate.usd / ids.length, vendor: estimate.vendor });
      continue;
    }
    const spent = await deps.ledger.spent('readings', started);
    if (spent === null) {
      held.push('ledger');
      continue;
    }
    if (spent + estimate.usd > r.dailyUsd) {
      hold('cap', { spentUsd: spent, capUsd: r.dailyUsd });
      continue;
    }
    if (deps.meter.line().remainingUsd - estimate.usd < r.bookReserveUsd) {
      hold('book', { remainingUsd: deps.meter.line().remainingUsd, reserveUsd: r.bookReserveUsd });
      continue;
    }
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      hold(`meter:${estimate.vendor}`, { vendor: estimate.vendor, wouldSpendUsd: estimate.usd });
      continue;
    }
    if (deps.mode === 'dry') {
      wouldSpendUsd += estimate.usd;
      continue;
    }

    asked += ids.length;
    const askedAt = deps.now();
    let read: ReadonlyMap<string, CounterSet>;
    try {
      const line = deps.meter.line(estimate.vendor);
      const result = await adapter.observe(ids, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: deadline as Millis });
      read = result.value;
      spentUsd += result.spend.usd;
      await deps.ledger.add('readings', deps.now(), result.spend.usd);
    } catch (e) {
      if (e instanceof BudgetRefused) hold(`meter:${estimate.vendor}`, { vendor: estimate.vendor });
      else deps.log.warn('readings failed for this source; asked again next pass', { source, posts: ids.length, err: errorText(e) });
      continue;
    }

    const done: string[] = [];
    for (const c of mine) {
      const counters = read.get(c.sourceItemId);
      if (counters === undefined) continue;
      const capturedAt = Math.max(...Object.values(counters).map((k) => k?.observedAt ?? 0)) as Millis;
      await deps.observations.append(observationsFrom(c.itemId as never, counters, latestCounters(previous.get(c.itemId as never) ?? []), capturedAt, p.kinetics));
      answered += 1;
      if (c.openedAt !== null) done.push(c.itemId);
    }
    /* Only the opens a stored reading answered; an open asked while the read was out stays. */
    if (done.length > 0) await deps.readings.answered(done, new Date(askedAt)).catch((e: unknown) => deps.log.warn('answered opens could not be cleared; they expire', { err: errorText(e) }));
  }

  /* Once a hold clears, say it again the next time it happens. */
  for (const why of [...memory.said]) if (!held.includes(why)) memory.said.delete(why);

  if (deps.mode === 'dry') deps.log.info('DRY RUN — readings priced, not taken', { due: posts.length, opened, wouldSpendUsd: Number(wouldSpendUsd.toFixed(6)) });
  else if (asked > 0) deps.log.info('readings taken', { due: posts.length, opened, asked, answered, usd: Number(spentUsd.toFixed(6)), ms: deps.now() - started });
  return { due: posts.length, opened, asked, answered, spentUsd, wouldSpendUsd, held };
}
