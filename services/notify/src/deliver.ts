/**
 * THE ONE DELIVERER. Every alert — a follow from the social service, a price level from the
 * market check, a rising post from the pipeline check — arrives as a row in `people.alert_queue`.
 * This takes them in order and, for each:
 *
 *   1. reads the person's settings; muted or switched off → dropped, nothing claimed;
 *   2. claims the level (unique row); already claimed → dropped, it fired before;
 *      a multiple also spends every switched-on level below it, so 5× never fires after 10×;
 *   3. writes the list row with how it was delivered;
 *   4. pushes, unless quiet hours, the hourly limit, a list-only kind or no device says not to —
 *      and only with NOTIFY on and VAPID keys present; otherwise it is listed, never lost.
 *
 * Pure decisions come from core (deliveryFor, spentWith); this is the database and the push.
 * What breaks if changed carelessly: the order of 1 and 2. Claiming before reading the switch
 * would spend a level for someone who had the alert off, and they would never get it once on.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';
import type { PushSender } from '@insidor/contracts/ports/people.ts';
import { deliveryFor, normalisePrefs, spentWith, wants, type AlertKind, type AlertPrefs } from '@insidor/core';

import { sendToDevices, type Answers } from './devices.ts';
import { alertText, type Facts } from './text.ts';

export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export interface DeliverDeps {
  readonly db: Db;
  readonly push: PushSender;
  /** NOTIFY=on. Off: everything is listed, nothing is pushed. */
  readonly pushOn: boolean;
  readonly policy: NotifyPolicy;
  readonly now: () => number;
  /** The push service's last answer per device (main.ts); empty in tests. */
  readonly answers?: Answers;
}

/** The kinds about a coin: their small picture is the coin's logo when we have one. */
const COIN_KINDS: readonly AlertKind[] = ['fyp_coin', 'fyp_proven', 'watch_coin'];
const httpsFact = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);

/**
 * The pictures a push carries, from its facts: `image`, the post's picture or video frame (the big
 * one, where the platform draws it); `icon`, the coin's logo for a coin, else the poster's face.
 */
export function picturesOf(kind: AlertKind, facts: Facts): { readonly image: string | null; readonly icon: string | null } {
  const face = httpsFact(facts['picture']);
  const logo = httpsFact(facts['logo']);
  return { image: httpsFact(facts['image']), icon: COIN_KINDS.includes(kind) ? (logo ?? face) : face };
}

const MULTIPLE_KINDS: readonly AlertKind[] = ['holding_multiple', 'watchlist_multiple'];

export async function prefsOf(db: Db, userId: string, P: NotifyPolicy): Promise<AlertPrefs> {
  const [row] = await db.query<{ prefs: unknown }>('select prefs from people.alert_prefs where user_id = $1', [userId]);
  const raw = typeof row?.prefs === 'string' ? JSON.parse(row.prefs) : (row?.prefs ?? {});
  return normalisePrefs(raw as Partial<AlertPrefs>, P);
}

/** The minute of the day in a timezone; null when the zone is unknown (then never quiet). */
export function localMinutes(nowMs: number, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    return Number.isFinite(h) && Number.isFinite(m) ? (h % 24) * 60 + m : null;
  } catch {
    return null;
  }
}

interface Queued {
  queueId: number;
  userId: string;
  kind: AlertKind;
  subject: string;
  rung: number;
  facts: Facts;
  href: string;
}

/** Deliver up to `limit` queued alerts. Returns what happened to each, for the log and the tests. */
export async function deliverQueued(deps: DeliverDeps, limit = 200): Promise<readonly { readonly queueId: number; readonly outcome: string }[]> {
  const rows = await deps.db.query<Queued>(
    `delete from people.alert_queue where queue_id in (select queue_id from people.alert_queue order by queue_id limit $1)
     returning queue_id::int as "queueId", user_id as "userId", kind, subject, rung, facts, href`,
    [limit],
  );
  const out: { queueId: number; outcome: string }[] = [];
  for (const q of rows.sort((a, b) => a.queueId - b.queueId)) {
    const facts: Facts = typeof q.facts === 'string' ? JSON.parse(q.facts) : q.facts;
    const prefs = await prefsOf(deps.db, q.userId, deps.policy);
    if (prefs.muted || !wants(prefs, q.kind)) {
      out.push({ queueId: q.queueId, outcome: prefs.muted ? 'muted' : 'off' });
      continue;
    }
    if (MULTIPLE_KINDS.includes(q.kind) && !prefs.multiples.includes(q.rung)) {
      out.push({ queueId: q.queueId, outcome: 'off' });
      continue;
    }
    const claimed = await deps.db.query('insert into people.alert_claim (user_id, kind, subject, rung) values ($1, $2, $3, $4) on conflict do nothing returning 1', [q.userId, q.kind, q.subject, q.rung]);
    if (claimed.length === 0) {
      out.push({ queueId: q.queueId, outcome: 'already' });
      continue;
    }
    if (MULTIPLE_KINDS.includes(q.kind)) {
      for (const lower of spentWith(q.rung, prefs.multiples)) {
        await deps.db.query('insert into people.alert_claim (user_id, kind, subject, rung) values ($1, $2, $3, $4) on conflict do nothing', [q.userId, q.kind, q.subject, lower]);
      }
    }
    const devices = await deps.db.query<{ endpoint: string; p256dh: string; auth: string }>('select endpoint, p256dh, auth from people.push_subscription where user_id = $1', [q.userId]);
    const [pushed] = await deps.db.query<{ n: number }>(`select count(*)::int as n from people.alert where user_id = $1 and delivery = 'push' and at > now() - interval '1 hour'`, [q.userId]);
    const decision = deliveryFor({ kind: q.kind, prefs, localMinutes: localMinutes(deps.now(), prefs.timezone), pushedLastHour: pushed?.n ?? 0, devices: deps.pushOn && deps.push.configured ? devices.length : 0 });
    const text = alertText(q.kind, facts);
    let delivery = decision.kind === 'push' ? 'push' : decision.kind === 'list' ? decision.why : 'off';
    if (decision.kind === 'push') {
      /* The tag is the claim's own key: a repeat on the device replaces, never stacks. */
      const { sent } = await sendToDevices(deps.db, deps.push, deps.answers ?? new Map(), devices, { title: text.title, body: text.body, url: q.href, ...picturesOf(q.kind, facts), tag: `${q.kind}:${q.subject}` }, deps.policy.pushTtlS);
      /* Every device refused it (the push service's answer is on each device row): said as that, not as "no device". */
      if (sent === 0) delivery = 'refused';
    }
    await deps.db.query(
      'insert into people.alert (user_id, kind, subject, rung, title, body, href, facts, delivery) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [q.userId, q.kind, q.subject, q.rung, text.title, text.body, q.href, JSON.stringify(facts), delivery],
    );
    out.push({ queueId: q.queueId, outcome: delivery });
  }
  return out;
}

/** Queue one alert for one person. Producers call only this. */
export async function queue(db: Db, a: { userId: string; kind: AlertKind; subject: string; rung: number; facts: Facts; href: string }): Promise<void> {
  await db.query('insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ($1, $2, $3, $4, $5, $6)', [a.userId, a.kind, a.subject, a.rung, JSON.stringify(a.facts), a.href]);
}
