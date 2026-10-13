/**
 * THE ALERT ROUTES, for the phone app. Every route needs a signed-in person; each reads or
 * writes only that person's rows.
 *
 *   GET    /alerts                  the list, newest first, with which are unread
 *   POST   /alerts/seen             everything up to now is read
 *   GET    /prefs                   settings, the multiples offered, the hourly ceiling, push state
 *   PUT    /prefs { prefs }         saved as normalised (core): a bad value is corrected, not stored
 *   POST   /push/subscribe { endpoint, keys }     DELETE the same to stop this device
 *   POST   /push/test               "Notifications are on", to this person's devices only
 *   PUT    /watch { stories }       the narratives this person stars, mirrored for alerts
 *
 * ★ PUSH STATE IS TOLD AS IT IS. `push.on` is NOTIFY; `push.configured` is whether VAPID keys are
 * present. The app shows "alerts are listed but not pushed" from these, rather than a switch that
 * does nothing.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';
import type { IdentityCheck, Person, PushSender } from '@insidor/contracts/ports/people.ts';
import { normalisePrefs, type AlertPrefs } from '@insidor/core';

import { prefsOf, type Db } from './deliver.ts';
import { json, type Reply, type Request } from './http.ts';

export interface NotifyDeps {
  readonly db: Db;
  readonly identity: IdentityCheck;
  readonly push: PushSender;
  readonly pushOn: boolean;
  readonly policy: NotifyPolicy;
  readonly now: () => number;
  readonly pace: (client: string, now: number) => boolean;
}

const bad = (error: string, status = 400): Reply => json(status, { error });
const STORY = /^[A-Za-z0-9:_\-.]{1,200}$/;
const MAX_WATCHED = 500;

async function ensureProfile(db: Db, p: Person): Promise<void> {
  await db.query('insert into people.profile (user_id, name, wallet) values ($1, $2, $3) on conflict (user_id) do nothing', [p.userId, p.name, p.wallets.find((w) => w.kind === 'embedded')?.address ?? null]);
}

export async function handle(req: Request, deps: NotifyDeps): Promise<Reply> {
  if (!deps.pace(req.client, deps.now())) return bad('Too many requests. Wait a moment.', 429);
  const url = new URL(req.url, 'http://local');
  const seg = url.pathname.split('/').filter((s) => s !== '');
  const m = req.method;
  if (m === 'GET' && seg.length === 0) return json(200, { service: 'notify' });
  if (m === 'GET' && seg[0] === 'health') return json(200, { ok: true });
  if (m === 'GET' && seg[0] === 'push' && seg[1] === 'key') return json(200, { publicKey: deps.push.publicKey, on: deps.pushOn });

  const me = req.token === null ? null : await deps.identity.verify(req.token);
  if (me === null) return bad('Sign in first.', 401);
  await ensureProfile(deps.db, me);
  const P = deps.policy;
  const path = seg.join('/');

  if (m === 'GET' && path === 'alerts') {
    const [seen] = await deps.db.query<{ seenAt: string }>('select seen_at as "seenAt" from people.alert_seen where user_id = $1', [me.userId]);
    const seenAt = seen === undefined ? 0 : new Date(seen.seenAt).getTime();
    const rows = await deps.db.query<{ id: number; kind: string; title: string; body: string; href: string; at: string; facts: unknown }>(
      /* Nothing about a post or narrative the feeds have since hidden (0050): the alert stays in
         the table, it is just not listed. A coin match's subject is "story id|coin". */
      `select a.alert_id::int as id, a.kind, a.title, a.body, a.href, a.at, a.facts from people.alert a
        where a.user_id = $1
          and not exists (select 1 from public.feed_rejection r where r.subject_id = split_part(a.subject, '|', 1))
        order by a.at desc, a.alert_id desc limit $2`,
      [me.userId, P.inboxLimit],
    );
    const alerts = rows.map((r) => {
      const facts = (typeof r.facts === 'string' ? JSON.parse(r.facts) : r.facts) as Record<string, unknown>;
      const at = new Date(r.at).getTime();
      return { id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, at, unread: at > seenAt, symbol: typeof facts['symbol'] === 'string' ? facts['symbol'] : null, rank: typeof facts['rank'] === 'string' ? facts['rank'] : null, season: typeof facts['season'] === 'number' ? facts['season'] : null };
    });
    return json(200, { unread: alerts.filter((a) => a.unread).length, alerts });
  }
  if (m === 'POST' && path === 'alerts/seen') {
    await deps.db.query('insert into people.alert_seen (user_id, seen_at) values ($1, now()) on conflict (user_id) do update set seen_at = now()', [me.userId]);
    return json(200, { seen: true });
  }

  if (path === 'prefs' && (m === 'GET' || m === 'PUT')) {
    if (m === 'PUT') {
      const raw = (req.body as { prefs?: unknown } | null)?.prefs;
      if (typeof raw !== 'object' || raw === null) return bad('bad request');
      const prefs: AlertPrefs = normalisePrefs(raw as Partial<AlertPrefs>, P);
      await deps.db.query('insert into people.alert_prefs (user_id, prefs) values ($1, $2) on conflict (user_id) do update set prefs = excluded.prefs, updated_at = now()', [me.userId, JSON.stringify(prefs)]);
    }
    const [devices] = await deps.db.query<{ n: number }>('select count(*)::int as n from people.push_subscription where user_id = $1', [me.userId]);
    return json(200, {
      prefs: await prefsOf(deps.db, me.userId, P),
      multiplesOffered: P.milestones,
      maxPerHour: P.maxPerHour,
      push: { on: deps.pushOn, configured: deps.push.configured, publicKey: deps.push.publicKey, devices: devices?.n ?? 0 },
    });
  }

  if (path === 'push/subscribe') {
    const b = (req.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (typeof b.endpoint !== 'string' || !b.endpoint.startsWith('https://') || b.endpoint.length > 1_000) return bad('bad request');
    if (m === 'DELETE') {
      await deps.db.query('delete from people.push_subscription where endpoint = $1 and user_id = $2', [b.endpoint, me.userId]);
      return json(200, { subscribed: false });
    }
    if (m !== 'POST' || typeof b.keys?.p256dh !== 'string' || typeof b.keys.auth !== 'string') return bad('bad request');
    await deps.db.query(
      `insert into people.push_subscription (endpoint, user_id, p256dh, auth, user_agent) values ($1, $2, $3, $4, '')
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      [b.endpoint, me.userId, b.keys.p256dh, b.keys.auth],
    );
    return json(200, { subscribed: true });
  }

  if (m === 'POST' && path === 'push/test') {
    if (!deps.pushOn) return json(200, { sent: 0, why: 'Push is off on this server (NOTIFY).' });
    if (!deps.push.configured) return json(200, { sent: 0, why: 'Push keys are not set on this server.' });
    const devices = await deps.db.query<{ endpoint: string; p256dh: string; auth: string }>('select endpoint, p256dh, auth from people.push_subscription where user_id = $1', [me.userId]);
    let sent = 0;
    for (const d of devices) {
      const r = await deps.push.send(d, { title: 'Notifications are on', body: 'You will hear about your coins, the narratives you watch, and replies.', url: '/#/alerts' }, P.pushTtlS);
      if (r === 'sent') sent += 1;
      if (r === 'gone') await deps.db.query('delete from people.push_subscription where endpoint = $1', [d.endpoint]);
    }
    return json(200, { sent, why: sent === 0 ? 'No device of yours took the push. Turn notifications on again on this phone.' : null });
  }

  if (m === 'PUT' && path === 'watch') {
    const stories = (req.body as { stories?: unknown } | null)?.stories;
    if (!Array.isArray(stories) || stories.length > MAX_WATCHED || !stories.every((s) => typeof s === 'string' && STORY.test(s))) return bad('bad request');
    await deps.db.query('delete from people.watch where user_id = $1 and not (story_id = any($2::text[]))', [me.userId, stories]);
    await deps.db.query('insert into people.watch (user_id, story_id) select $1, unnest($2::text[]) on conflict do nothing', [me.userId, stories]);
    return json(200, { watching: stories.length });
  }

  return bad('not found', 404);
}
