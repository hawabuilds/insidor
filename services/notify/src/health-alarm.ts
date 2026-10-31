/**
 * THE HEALTH CHECK, AROUND THE CLOCK: the bars of tools/health.ts that a service can read for
 * itself, every five minutes, pushed to the owner's phone once when one breaks and once when it is
 * back — through the same outage alarm, the same queue and the same once-only rule as alarm.ts.
 *
 * ★ WHY (2026-10-29). Picture storage was cut off at 01:00 UTC for going over its transfer allowance
 * and every coin logo, poster and post picture stopped loading. tools/health.ts would have said so
 * at once, but it runs by hand around deploys, and nobody noticed for 13 hours.
 *
 * ★ WHY HERE AND NOT IN THE WATCHDOG. services/watchdog is not deployed, pages by Telegram only, and
 * reads as a role that may write nothing; the owner's channel is people.alert_queue, which this
 * service already writes for alarm.ts. Adding these here costs no new machine.
 *
 * ★ THE CONDITIONS (bars in health-bars.ts, shared with tools/health.ts):
 *
 *   pictures  the newest stored coin logo, fetched from picture storage the way the app fetches it,
 *             does not answer 200 — on two passes in a row (a single blip is not an outage). No
 *             stored logo yet: no claim.
 *   logos     more than half of the last hour's coin-logo copies failed (at least 5 copies).
 *   tape      the read service's running coins strip is empty, or does not answer, for 30 minutes:
 *             the strip can be briefly empty at a quiet moment, so one pass is not enough.
 *   judged    fewer than 10 posts judged in the last 30 minutes. alarm.ts's judge alarm catches the
 *             judge being asked and refused; this one catches nothing being asked at all.
 *   names     name guesses in the last 3 hours under half the usual (the larger of the same hours one
 *   matching  and two days before), when the usual is at least 30; the same for coin-to-post ties.
 *             ★ These watch OUTPUT. On 30 Oct the namer ran on every pass and named almost nothing
 *             (empty pictures after a picture change), and every bar above stayed green for a day.
 *
 *   For You adding no post is alarm.ts's `fyp` (45 minutes, stricter than the tool's 60), so it is
 *   not repeated here. Service error counts need `railway logs` and stay in the tool.
 *
 * ★ ONCE EACH WAY. A condition is down from when it was first seen broken (`badSince`); that time is
 * its mark, so the down push's subject is fixed for the outage and the deliverer's claim drops a
 * repeat, and "back" is said once, when a pass sees it healthy. The mark is held in memory: a
 * restart in the middle of an outage says it once more, as the database alarm does.
 *
 * Before migration 0152 the two database reads are refused (no function): each is skipped with one
 * log line; the Tape is still fetched, and the picture fetch waits for a stored logo to try.
 *
 * What breaks if changed carelessly: dropping the two-pass rule on pictures or the 30 minutes on the
 * Tape, and the owner's phone buzzes for a dropped connection.
 */

import { minutesSince, optional, ownerIds, stepAlarms, type AlarmId, type Reading, type Tracked } from './alarm.ts';
import { queue, type Db } from './deliver.ts';
import { FLOW_WINDOW_HOURS, flowFallen, flowUsual, JUDGED_WINDOW_MS, judgingBroken, logoFailPct, logosBroken, LOGO_WINDOW_MS, picturesBroken, tapeBroken, type FlowStep } from './health-bars.ts';
import type { Facts } from './text.ts';

/** How often the health alarm looks. */
export const HEALTH_LOOP_MS = 5 * 60_000;

export type HealthId = Extract<AlarmId, 'pictures' | 'logos' | 'tape' | 'judged' | 'names' | 'matching'>;

/** How long a condition must have been seen broken before it is down (0: on the first pass). */
export const CONFIRM_MS: Readonly<Record<HealthId, number>> = { pictures: HEALTH_LOOP_MS, logos: 0, tape: 30 * 60_000, judged: 0, names: 0, matching: 0 };

/* A fetch with no answer in this long has failed: storage that hangs is as broken as one that refuses. */
const FETCH_TIMEOUT_MS = 10_000;

/** What one pass saw. A field left out was not read this pass and changes nothing. */
export interface HealthSeen {
  /** The stored logo's status; null when there is no stored logo; 0 when there was no answer. */
  readonly pictureStatus?: number | null | undefined;
  readonly logos?: { readonly failed: number; readonly copies: number } | undefined;
  /** Coins on the strip; null when the read service did not answer. */
  readonly tapeCoins?: number | null | undefined;
  readonly judged?: number | undefined;
  /** Each step's output in the window and the same window one and two days before. */
  readonly flow?: ReadonlyMap<FlowStep, { readonly recent: number; readonly dayBefore: number; readonly twoDaysBefore: number }> | undefined;
}

export interface HealthMemory {
  tracked: Tracked;
  /** When each condition was first seen broken in the current run of broken passes. */
  readonly badSince: Map<HealthId, number>;
  readonly notYet: Set<string>;
}

export const healthMemory = (): HealthMemory => ({ tracked: new Map(), badSince: new Map(), notYet: new Set() });

const iso = (ms: number): string => new Date(ms).toISOString();

function reading(id: HealthId, broken: boolean, facts: Facts, badSince: Map<HealthId, number>, nowMs: number): Reading {
  if (broken) {
    if (!badSince.has(id)) badSince.set(id, nowMs);
  } else badSince.delete(id);
  const since = badSince.get(id);
  return {
    id,
    down: since !== undefined && nowMs - since >= CONFIRM_MS[id],
    mark: since === undefined ? 'ok' : iso(since),
    facts: { what: id, ...facts, minutes: since === undefined ? null : minutesSince(since, nowMs), lastAt: since === undefined ? null : iso(since) },
  };
}

/** The readings of one pass. Updates `badSince`; pure otherwise. */
export function healthReadings(seen: HealthSeen, badSince: Map<HealthId, number>, nowMs: number): readonly Reading[] {
  const out: Reading[] = [];
  if (seen.pictureStatus !== undefined && seen.pictureStatus !== null) {
    out.push(reading('pictures', picturesBroken(seen.pictureStatus), { status: seen.pictureStatus }, badSince, nowMs));
  }
  if (seen.logos !== undefined) {
    const { failed, copies } = seen.logos;
    out.push(reading('logos', logosBroken(failed, copies), { failed, copies, percent: logoFailPct(failed, copies), windowMinutes: Math.round(LOGO_WINDOW_MS / 60_000) }, badSince, nowMs));
  }
  if (seen.tapeCoins !== undefined) out.push(reading('tape', tapeBroken(seen.tapeCoins), { coins: seen.tapeCoins }, badSince, nowMs));
  if (seen.judged !== undefined) {
    out.push(reading('judged', judgingBroken(seen.judged), { judged: seen.judged, windowMinutes: Math.round(JUDGED_WINDOW_MS / 60_000) }, badSince, nowMs));
  }
  for (const [step, c] of seen.flow ?? []) {
    const usual = flowUsual(c.dayBefore, c.twoDaysBefore);
    out.push(reading(step, flowFallen(c.recent, usual), { recent: c.recent, usual, windowHours: FLOW_WINDOW_HOURS }, badSince, nowMs));
  }
  return out;
}

export interface HealthDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly fetch: typeof globalThis.fetch;
  /** Picture storage's public address (R2_PUBLIC_BASE): what the app's pictures start with. */
  readonly pictureBase: string;
  /** The read service, whose /running/coins is the Tape the app shows. */
  readonly readUrl: string;
  /** Policy.owner.wallets: whose phone this is. */
  readonly ownerWallets: readonly string[];
  readonly log: (level: 'info' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}

async function pictureStatus(deps: HealthDeps, address: string | null): Promise<number | null> {
  if (address === null) return null;
  try {
    const res = await deps.fetch(`${deps.pictureBase}/coin-logos/${address}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

async function tapeCoins(deps: HealthDeps): Promise<number | null> {
  try {
    const res = await deps.fetch(`${deps.readUrl}/running/coins`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const coins = ((await res.json()) as { coins?: unknown }).coins;
    return Array.isArray(coins) ? coins.length : null;
  } catch {
    return null;
  }
}

const toInt = (v: unknown): number => Number(v ?? 0);

/** One pass: read, step, queue for the owner. Returns how many alerts were queued. A failed database read throws and changes nothing. */
export async function checkHealth(deps: HealthDeps, mem: HealthMemory): Promise<number> {
  const now = deps.now();
  const pic = await optional('picture_health', mem, deps, () =>
    deps.db.query<{ copies: unknown; failed: unknown; stored_address: string | null }>('select copies, failed, stored_address from internal.picture_health($1)', [new Date(now - LOGO_WINDOW_MS)]),
  );
  const judged = await optional('judged_since', mem, deps, () => deps.db.query<{ n: unknown }>('select internal.judged_since($1) as n', [new Date(now - JUDGED_WINDOW_MS)]));
  const flowRows = await optional('flow_counts', mem, deps, () =>
    deps.db.query<{ step: string; recent: unknown; day_before: unknown; two_days_before: unknown }>('select step, recent, day_before, two_days_before from internal.flow_counts($1, $2)', [new Date(now), FLOW_WINDOW_HOURS]),
  );
  const p = pic?.[0];
  const [status, coins] = await Promise.all([p === undefined ? Promise.resolve(undefined) : pictureStatus(deps, p.stored_address), tapeCoins(deps)]);
  const seen: HealthSeen = {
    pictureStatus: status,
    logos: p === undefined ? undefined : { failed: toInt(p.failed), copies: toInt(p.copies) },
    tapeCoins: coins,
    judged: judged?.[0] === undefined ? undefined : toInt(judged[0].n),
    flow: flowRows === undefined || flowRows === null
      ? undefined
      : new Map(flowRows.flatMap((r) => (r.step === 'names' || r.step === 'matching' ? [[r.step, { recent: toInt(r.recent), dayBefore: toInt(r.day_before), twoDaysBefore: toInt(r.two_days_before) }] as const] : []))),
  };

  const { next, events } = stepAlarms(mem.tracked, healthReadings(seen, mem.badSince, now), now);
  const owners = events.length === 0 ? [] : await ownerIds(deps.db, deps.ownerWallets);
  let queued = 0;
  for (const e of events) {
    deps.log(e.state === 'down' ? 'error' : 'info', e.state === 'down' ? 'health alarm: down' : 'health alarm: back', { alarm: e.id, subject: e.subject, ...e.facts });
    for (const userId of owners) {
      await queue(deps.db, { userId, kind: 'outage', subject: e.subject, rung: 0, facts: e.facts, href: '/#/alerts' });
      queued += 1;
    }
  }
  /* Committed only now: a queue that threw above leaves the state as it was, to try again next pass. */
  mem.tracked = next;
  return queued;
}
