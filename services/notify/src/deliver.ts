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
 *      and only with NOTIFY on and VAPID keys present; otherwise it is listed, never lost. A saved
 *      post's coin is not counted toward anyone's hourly limit (core UNCOUNTED_PUSH_KINDS), and a
 *      daily cap counts only its own kind, so it never costs a launch push either. A coin that already
 *      reached the person's phone as one of the two coin pushes (a saved post's, the launch push) is
 *      listed `already-pushed` when the other comes for it: one coin, one push.
 *
 * Pure decisions come from core (deliveryFor, spentWith); this is the database and the push.
 * What breaks if changed carelessly: the order of 1 and 2. Claiming before reading the switch
 * would spend a level for someone who had the alert off, and they would never get it once on.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';
import type { PushSender } from '@insidor/contracts/ports/people.ts';
import { deliveryFor, GROUPED_KINDS, groupDue, normalisePrefs, pacedScope, pacingOf, spentWith, UNCOUNTED_PUSH_KINDS, wants, type AlertKind, type AlertPrefs, type Pacing, type PushedOfKind } from '@insidor/core';

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
const COIN_KINDS: readonly AlertKind[] = ['coin_launched', 'fyp_coin', 'fyp_proven', 'watch_coin', 'starred_first_coin', 'watched_first_coin', 'holding_down', 'creator_buyers'];
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

/* The person's pushes in the last hour, for the hourly limit — less the kinds that use up no allowance (core UNCOUNTED_PUSH_KINDS: a saved post's coin). */
const HOURLY_SQL = `select count(*)::int as n from people.alert where user_id = $1 and delivery = 'push' and at > now() - interval '1 hour' and kind <> all($2::text[])`;

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
    const [pushed] = await deps.db.query<{ n: number }>(HOURLY_SQL, [q.userId, UNCOUNTED_PUSH_KINDS]);
    const pacing = pacingOf(q.kind, deps.policy);
    const ofKind = pacing === null ? undefined : await pushedOfKind(deps.db, q.userId, q.kind, q.subject, pacing);
    const decision = deliveryFor({ kind: q.kind, prefs, localMinutes: localMinutes(deps.now(), prefs.timezone), pushedLastHour: pushed?.n ?? 0, devices: deps.pushOn && deps.push.configured ? devices.length : 0, policy: deps.policy, ...(ofKind === undefined ? {} : { ofKind }) });
    const text = alertText(q.kind, facts);
    /* 'held': listed now, pushed with the rest of its group by `deliverGroups`. */
    let delivery = decision.kind === 'push' ? 'push' : decision.kind === 'list' ? decision.why : decision.kind === 'hold' ? 'held' : 'off';
    /* One coin, one push per person: a saved post's push and the launch push for the same coin never both reach a phone. */
    if (decision.kind === 'push' && (await alreadyPushedCoin(deps.db, q.userId, q.kind, facts))) delivery = 'already-pushed';
    if (delivery === 'push') {
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

/** The two pushes about one launched coin (launch.ts, saved-post.ts): whichever reaches a person first, the other is listed. */
const SAME_COIN_KINDS: readonly AlertKind[] = ['coin_launched', 'watched_first_coin'];

/** Whether this coin already reached this person's phone in the last day by the other of the two kinds. */
async function alreadyPushedCoin(db: Db, userId: string, kind: AlertKind, facts: Facts): Promise<boolean> {
  const address = facts['address'];
  if (!SAME_COIN_KINDS.includes(kind) || typeof address !== 'string' || address === '') return false;
  const rows = await db.query(`select 1 from people.alert where user_id = $1 and kind = any($2::text[]) and delivery = 'push' and facts ->> 'address' = $3 and at > now() - interval '1 day' limit 1`, [userId, SAME_COIN_KINDS, address]);
  return rows.length > 0;
}

/** How many of a paced kind reached this person's phone in the last day, and how long ago the last did — of the kind, or of this narrative. */
async function pushedOfKind(db: Db, userId: string, kind: AlertKind, subject: string, pacing: Pacing): Promise<PushedOfKind> {
  const scope = pacing.per === 'narrative' ? pacedScope(subject) : null;
  const [r] = await db.query<{ n: number; ago: number | null }>(
    `select count(*) filter (where at > now() - make_interval(secs => $3::float8 / 1000))::int as n, (extract(epoch from now() - max(at)) * 1000)::float8 as ago
       from people.alert where user_id = $1 and kind = $2 and delivery = 'push' and ($4::text is null or split_part(subject, '|', 1) = $4)`,
    [userId, kind, pacing.dayMs, scope],
  );
  return { lastDay: r?.n ?? 0, sinceLastMs: r?.ago === null || r?.ago === undefined ? null : Number(r.ago) };
}

/** Each grouped kind's rule (Policy.notify.grouped). */
const groupRule = (kind: AlertKind, P: NotifyPolicy) => (kind === 'follow' ? P.grouped.follow : P.grouped.useful);

/**
 * ★ THE GROUP PASS: new followers and likes go to the phone as one push ("3 new followers", "12
 * people liked your comment"). Each was listed as it came, `held`. For each person and grouped
 * kind whose oldest held row has waited `waitMs`, and whose last group push was `gapMs` ago or
 * more, this decides once — mute, the switch, quiet hours, the hourly limit, a device — and writes
 * the outcome on the newest held row (`push`, or why not) and `grouped` on the rest. So the hourly
 * count sees one push, the list keeps every follower, and nothing held is pushed twice.
 * Only rows held since this pass existed can be held: nothing listed before is replayed.
 */
export async function deliverGroups(deps: DeliverDeps): Promise<readonly { readonly userId: string; readonly kind: AlertKind; readonly count: number; readonly outcome: string }[]> {
  const held = await deps.db.query<{ alertId: number; userId: string; kind: AlertKind; subject: string; facts: Facts | string; href: string; ago: number }>(
    `select alert_id::int as "alertId", user_id as "userId", kind, subject, facts, href, (extract(epoch from now() - at) * 1000)::float8 as ago
       from people.alert where delivery = 'held' and kind = any($1::text[]) order by alert_id`,
    [[...GROUPED_KINDS]],
  );
  const groups = new Map<string, typeof held>();
  for (const h of held) groups.set(`${h.userId}\u0000${h.kind}`, [...(groups.get(`${h.userId}\u0000${h.kind}`) ?? []), h]);
  const out: { userId: string; kind: AlertKind; count: number; outcome: string }[] = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const newest = rows[rows.length - 1];
    if (first === undefined || newest === undefined) continue;
    const [last] = await deps.db.query<{ ago: number | null }>(`select (extract(epoch from now() - max(at)) * 1000)::float8 as ago from people.alert where user_id = $1 and kind = $2 and delivery = 'push'`, [first.userId, first.kind]);
    const sinceLast = last?.ago === null || last?.ago === undefined ? null : Number(last.ago);
    if (!groupDue(Math.max(...rows.map((r) => Number(r.ago))), sinceLast, groupRule(first.kind, deps.policy))) continue;
    const prefs = await prefsOf(deps.db, first.userId, deps.policy);
    const devices = await deps.db.query<{ endpoint: string; p256dh: string; auth: string }>('select endpoint, p256dh, auth from people.push_subscription where user_id = $1', [first.userId]);
    const [pushed] = await deps.db.query<{ n: number }>(HOURLY_SQL, [first.userId, UNCOUNTED_PUSH_KINDS]);
    const decision = deliveryFor({ kind: first.kind, prefs, localMinutes: localMinutes(deps.now(), prefs.timezone), pushedLastHour: pushed?.n ?? 0, devices: deps.pushOn && deps.push.configured ? devices.length : 0, grouped: true });
    const facts = groupFacts(first.kind, rows.map((r) => (typeof r.facts === 'string' ? (JSON.parse(r.facts) as Facts) : r.facts)));
    let outcome = decision.kind === 'push' ? 'push' : decision.kind === 'list' ? decision.why : decision.kind === 'skip' ? decision.why : 'held';
    if (decision.kind === 'push') {
      const text = alertText(first.kind, facts);
      /* One person's follow opens their profile; a group opens the list, where every one of them is. */
      const url = rows.length === 1 ? newest.href : NOTIFICATIONS_HREF;
      const { sent } = await sendToDevices(deps.db, deps.push, deps.answers ?? new Map(), devices, { title: text.title, body: text.body, url, ...picturesOf(first.kind, facts), tag: `${first.kind}:group` }, deps.policy.pushTtlS);
      if (sent === 0) outcome = 'refused';
    }
    await deps.db.query(`update people.alert set delivery = 'grouped' where alert_id = any($1::int[])`, [rows.slice(0, -1).map((r) => r.alertId)]);
    await deps.db.query(`update people.alert set delivery = $2 where alert_id = $1`, [newest.alertId, outcome]);
    out.push({ userId: first.userId, kind: first.kind, count: rows.length, outcome });
  }
  return out;
}

/** The bell's Notifications list (mobile shared/route.ts, `#/feed/notifications`). */
export const NOTIFICATIONS_HREF = '/#/feed/notifications';

/**
 * A group's facts, from its members': how many, who (the newest first) and, for likes, how many
 * comments they were on and the newest one's words. Counts are of rows held, each one person's
 * follow or one like.
 */
export function groupFacts(kind: AlertKind, members: readonly Facts[]): Facts {
  const newest = members[members.length - 1] ?? {};
  if (kind === 'follow') {
    const names = [...members].reverse().flatMap((m) => (typeof m['who'] === 'string' ? [m['who']] : []));
    return { who: names[0] ?? null, others: [...new Set(names)].slice(1, 3), count: members.length, picture: newest['picture'] ?? null, grouped: true };
  }
  const comments = new Set(members.map((m) => (typeof m['excerpt'] === 'string' ? m['excerpt'] : '')));
  return { count: members.length, comments: comments.size, excerpt: newest['excerpt'] ?? null, grouped: true };
}

/** Queue one alert for one person. Producers call only this. */
export async function queue(db: Db, a: { userId: string; kind: AlertKind; subject: string; rung: number; facts: Facts; href: string }): Promise<void> {
  await db.query('insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ($1, $2, $3, $4, $5, $6)', [a.userId, a.kind, a.subject, a.rung, JSON.stringify(a.facts), a.href]);
}
