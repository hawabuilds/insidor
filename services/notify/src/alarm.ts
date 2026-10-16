/**
 * THE OWNER'S OUTAGE ALARM: a push to his phone when For You stops taking new posts, when the
 * judge is asked but nothing it is asked is paid for, when the live coin stream stops, or when the
 * database cannot be read — once when it starts and once when it is back, never once a pass.
 *
 * ★ WHY HERE, IN THE ALERT SERVICE. On Thursday 2026-10-15 the board stood still five times
 * (the projector's frame timing out on a starved database, then throwing on one post's text) and
 * the judge was refused for two hours, the coin stream was down for eighteen, and nothing told the
 * owner. A watcher inside the runner or the projector dies with them, and its silence looks like
 * health. This service is neither: it
 * reads three facts from the database on its own minute and pushes through its own deliverer, so a
 * dead runner, a dead projector or a dead coin stream still reaches the phone. The supplier
 * account alert stays in the runner (billing-alerts.ts), at the vendor edge, where the refusal is
 * seen; this alarm is the second line that catches what that one cannot (the runner gone, a
 * refusal not classified as billing, a supplier down rather than empty).
 *
 * ★ THE CONDITIONS, each chosen so a quiet but healthy system cannot fire it:
 *
 *   fyp       the newest For You post was first shown FYP_SILENT_MS (45 min, the owner's number)
 *             ago or more. Backtested on 2026-10-13..16: the longest healthy gap was 33 minutes;
 *             it would have fired for each of Thursday's five stalls and nothing else. Back when a
 *             newer post is shown. No post ever shown (a new database): no claim either way.
 *   judge     in the last JUDGE_WINDOW_MS (15 min) the live judge was called at least
 *             JUDGE_MIN_CALLS (10) times and none of those calls was paid for. A refused call is
 *             recorded at $0, an answered one at its token cost, so this is "asked and refused";
 *             a quiet system makes no calls and never matches. Backtested over every judge call
 *             on record: it matches 22:33–00:21 UTC on Thursday, the 2026-10-13 credit outage and
 *             the first refused minutes of 2026-10-12, and no healthy minute. Back only when a
 *             PAID call is newer than the last one before the outage — if the calls simply stop
 *             (the runner died mid-outage), it stays down silently; the fyp alarm says the rest.
 *   stream    the live coin stream (chainwatch) has no watched window ending in the last
 *             STREAM_SILENT_MS (15 min). Not one of the owner's three, added for Thursday's
 *             longest outage: the stream failed to reach the starved database at 07:13 UTC and was
 *             down eighteen hours with nobody told. It reads every few seconds when alive; its one
 *             longer gap on record is that outage. Back when a newer window is recorded.
 *   database  every read this alarm made failed for DB_UNREADABLE_MS (10 min). With no database
 *             there is no queue and no device list to read, so this one is pushed straight to the
 *             owner's devices as last read (kept in memory each healthy pass); back goes through
 *             the queue like the rest. A restart while the database is unreadable knows no device
 *             and can only log it.
 *
 * ★ ONCE, ACROSS RESTARTS TOO. Each condition carries a mark — the evidence it was decided on (the
 * last post's time, the last paid call's time, when reads began failing). The "down" subject is
 * the mark, so a restart mid-outage queues the same subject and the deliverer's claim drops it;
 * the "back" subject is the mark of the outage it ends. A state change is committed only after its
 * pushes are queued, so a failed queue is tried again next minute, never lost.
 *
 * ★ THRESHOLDS ARE HERE, NOT IN POLICY. They are the owner's alarm lines for this service alone;
 * nothing else reads them. Moving them to Policy.notify is a one-line change if he wants them set
 * with the rest.
 *
 * Before migration 0087 the three reads are refused (no grant, no function): each is skipped with
 * one log line, and neither is counted as the database failing.
 *
 * What breaks if changed carelessly: clearing on "not down" instead of "mark moved". A judge that
 * stops being called is not a judge being paid again, and a "back" push for it would be a lie.
 */

import type { PushSender } from '@insidor/contracts/ports/people.ts';

import { queue, type Db } from './deliver.ts';
import type { Device } from './devices.ts';
import { alertText, type Facts } from './text.ts';

/** How often the alarm looks. */
export const ALARM_LOOP_MS = 60_000;
/** For You with no new post this long is down (the owner's 45 minutes). */
export const FYP_SILENT_MS = 45 * 60_000;
/** The judge's calls are counted over this window... */
export const JUDGE_WINDOW_MS = 15 * 60_000;
/** ...and at least this many with none paid is down; fewer is too little to say. */
export const JUDGE_MIN_CALLS = 10;
/** The live coin stream with no watched window ending in this long is down. */
export const STREAM_SILENT_MS = 15 * 60_000;
/** Every read failing this long is the database down. */
export const DB_UNREADABLE_MS = 10 * 60_000;
/* A read with no answer in this long counts as failed: an unreachable database can leave a query
   waiting for a connection forever, and a pass that never ends would never say so. */
const READ_TIMEOUT_MS = 30_000;

export type AlarmId = 'fyp' | 'judge' | 'stream' | 'database';

/** One condition as read this pass: down or not, and the evidence it was decided on. */
export interface Reading {
  readonly id: AlarmId;
  readonly down: boolean;
  /** The evidence watermark; "back" is only said when it has moved. */
  readonly mark: string;
  readonly facts: Facts;
}

export interface AlarmEvent {
  readonly id: AlarmId;
  readonly state: 'down' | 'back';
  readonly subject: string;
  readonly facts: Facts;
}

/** The conditions that are down now, by the mark they went down on. */
export type Tracked = ReadonlyMap<AlarmId, { readonly mark: string; readonly sinceMs: number }>;

/* No evidence (no paid call within the day the read looks back): never a reason to say "back". */
const NO_MARK = 'none';
const iso = (ms: number): string => new Date(ms).toISOString();
const minutesSince = (fromMs: number, nowMs: number): number => Math.max(0, Math.round((nowMs - fromMs) / 60_000));

export function fypReading(lastShownMs: number | null, nowMs: number): Reading | null {
  if (lastShownMs === null) return null;
  return {
    id: 'fyp',
    down: nowMs - lastShownMs >= FYP_SILENT_MS,
    mark: iso(lastShownMs),
    facts: { what: 'fyp', minutes: minutesSince(lastShownMs, nowMs), lastAt: iso(lastShownMs) },
  };
}

export function judgeReading(r: { readonly calls: number; readonly paid: number; readonly lastPaidMs: number | null }): Reading {
  return {
    id: 'judge',
    down: r.calls >= JUDGE_MIN_CALLS && r.paid === 0,
    mark: r.lastPaidMs === null ? NO_MARK : iso(r.lastPaidMs),
    facts: { what: 'judge', calls: r.calls, windowMinutes: Math.round(JUDGE_WINDOW_MS / 60_000), lastAt: r.lastPaidMs === null ? null : iso(r.lastPaidMs) },
  };
}

export function streamReading(lastReadMs: number | null, nowMs: number): Reading | null {
  if (lastReadMs === null) return null;
  return {
    id: 'stream',
    down: nowMs - lastReadMs >= STREAM_SILENT_MS,
    mark: iso(lastReadMs),
    facts: { what: 'stream', minutes: minutesSince(lastReadMs, nowMs), lastAt: iso(lastReadMs) },
  };
}

export function databaseReading(failingSinceMs: number | null, nowMs: number): Reading {
  return {
    id: 'database',
    down: failingSinceMs !== null && nowMs - failingSinceMs >= DB_UNREADABLE_MS,
    mark: failingSinceMs === null ? 'reading' : iso(failingSinceMs),
    facts: { what: 'database', minutes: failingSinceMs === null ? null : minutesSince(failingSinceMs, nowMs) },
  };
}

/**
 * The transitions this pass, and the tracked set after them. Pure. A condition not read this pass
 * (its read was refused, or the database is down) keeps whatever it was.
 */
export function stepAlarms(tracked: Tracked, readings: readonly Reading[], nowMs: number): { readonly next: Tracked; readonly events: readonly AlarmEvent[] } {
  const next = new Map(tracked);
  const events: AlarmEvent[] = [];
  for (const r of readings) {
    const was = next.get(r.id);
    if (was === undefined) {
      if (!r.down) continue;
      next.set(r.id, { mark: r.mark, sinceMs: nowMs });
      events.push({ id: r.id, state: 'down', subject: `${r.id}|${r.mark}`, facts: { ...r.facts, state: 'down' } });
      continue;
    }
    if (r.down || r.mark === was.mark || r.mark === NO_MARK) continue;
    next.delete(r.id);
    /* How long it was down: from the evidence it went down on when that is a time, else from when we saw it. */
    const from = Date.parse(was.mark);
    events.push({ id: r.id, state: 'back', subject: `${r.id}|back|${was.mark}`, facts: { ...r.facts, state: 'back', minutes: minutesSince(Number.isFinite(from) ? from : was.sinceMs, nowMs) } });
  }
  return { next, events };
}

/* ── the database and the push around it ─────────────────────────────── */

export interface AlarmMemory {
  tracked: Tracked;
  /** When reads began failing; null while they work. */
  failingSince: number | null;
  /** The owner's devices as last read, for the one push that cannot go through the queue. */
  devices: readonly Device[];
  /** Reads refused before 0087, each logged once. */
  readonly notYet: Set<string>;
}

export const alarmMemory = (): AlarmMemory => ({ tracked: new Map(), failingSince: null, devices: [], notYet: new Set() });

export interface AlarmDeps {
  readonly db: Db;
  readonly now: () => number;
  /** Policy.owner.wallets: whose phone this is. */
  readonly ownerWallets: readonly string[];
  readonly push: PushSender;
  readonly ttlS: number;
  readonly log: (level: 'info' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}

/* A read this role may not make yet (no grant, no function, no table): skipped, not the database down. */
const NOT_YET = new Set(['42501', '42883', '42P01']);

async function optional<T>(name: string, mem: AlarmMemory, deps: AlarmDeps, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code !== 'string' || !NOT_YET.has(code)) throw e;
    if (!mem.notYet.has(name)) {
      mem.notYet.add(name);
      deps.log('info', 'outage alarm: a reading is not available yet (migration 0087)', { reading: name, code });
    }
    return null;
  }
}

function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const toMs = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : null);

/** One pass: read, step, push. Returns how many alerts were queued or pushed. Never throws for a failed read. */
export async function checkAlarms(deps: AlarmDeps, mem: AlarmMemory): Promise<number> {
  const now = deps.now();
  const readings: Reading[] = [];
  let owners: readonly string[] = [];
  const read = async (): Promise<void> => {
    const fyp = await optional('fyp', mem, deps, () => deps.db.query<{ at: unknown }>(`select max(first_shown_at) as at from public.feed_post where feed_id = 'fyp'`));
    const f = fyp === null ? null : fypReading(toMs(fyp[0]?.at), now);
    if (f !== null) readings.push(f);
    const judge = await optional('judge', mem, deps, () => deps.db.query<{ calls: number; paid: number; last_paid_at: unknown }>('select calls, paid, last_paid_at from internal.judge_pay($1)', [new Date(now - JUDGE_WINDOW_MS)]));
    const j = judge?.[0];
    if (j !== undefined) readings.push(judgeReading({ calls: Number(j.calls), paid: Number(j.paid), lastPaidMs: toMs(j.last_paid_at) }));
    const stream = await optional('stream', mem, deps, () => deps.db.query<{ at: unknown }>('select internal.coin_stream_read_at() as at'));
    const c = stream === null ? null : streamReading(toMs(stream[0]?.at), now);
    if (c !== null) readings.push(c);
    owners = deps.ownerWallets.length === 0 ? [] : (await deps.db.query<{ userId: string }>('select user_id as "userId" from people.profile where wallet = any($1::text[])', [[...deps.ownerWallets]])).map((o) => o.userId);
    mem.devices = owners.length === 0 ? [] : await deps.db.query<Device>('select endpoint, p256dh, auth from people.push_subscription where user_id = any($1::text[])', [[...owners]]);
  };
  try {
    await within(READ_TIMEOUT_MS, read());
    mem.failingSince = null;
  } catch (e) {
    if (mem.failingSince === null) mem.failingSince = now;
    deps.log('error', 'outage alarm: the database could not be read', { err: e instanceof Error ? e.message : String(e), failingMinutes: minutesSince(mem.failingSince, now) });
  }
  readings.push(databaseReading(mem.failingSince, now));

  const { next, events } = stepAlarms(mem.tracked, readings, now);
  let sent = 0;
  for (const e of events) {
    deps.log(e.state === 'down' ? 'error' : 'info', e.state === 'down' ? 'outage alarm: down' : 'outage alarm: back', { alarm: e.id, subject: e.subject, ...e.facts });
    if (mem.failingSince !== null) {
      /* No database: no queue, no claim. Straight to the devices last read (the header says why). */
      const text = alertText('outage', e.facts);
      for (const d of mem.devices) {
        try {
          if ((await deps.push.send(d, { title: text.title, body: text.body, url: '/#/alerts', tag: `outage:${e.subject}` }, deps.ttlS)) === 'sent') sent += 1;
        } catch (err) {
          deps.log('error', 'outage alarm: a direct push failed', { alarm: e.id, err: err instanceof Error ? err.message : String(err) });
        }
      }
      if (mem.devices.length === 0) deps.log('error', 'outage alarm: no device known to push to', { alarm: e.id });
      continue;
    }
    if (deps.ownerWallets.length === 0) continue;
    for (const userId of owners) {
      await queue(deps.db, { userId, kind: 'outage', subject: e.subject, rung: 0, facts: e.facts, href: '/#/alerts' });
      sent += 1;
    }
  }
  /* Committed only now: a queue that threw above leaves the state as it was, to try again next minute. */
  mem.tracked = next;
  return sent;
}
