/**
 * ONE PUSH TO EVERY DEVICE A PERSON HAS, AND WHAT EACH DEVICE'S PUSH SERVICE SAID.
 *
 * The deliverer, the test route and the owner's test tool all send the same way: each device in
 * turn, a gone one (404/410) deleted, and the push service's answer written on the device's row
 * (people.push_subscription.last_status, 0078) — 201 taken, 403 a key it refused, 0 no answer.
 * Before this, "nothing arrives" had nothing to look at: a device that refused every push looked
 * exactly like one that took them.
 *
 * Its own file because the answer comes from the push adapter's report (filed by endpoint in
 * `answers`, main.ts) and has to be matched to the device it was for, in one place, the same for
 * every sender.
 *
 * ★ BEFORE 0078 the answer columns do not exist: writing them fails with 42703 and is skipped, so
 * a push still goes and is still counted.
 */

import type { PushMessage, PushSender } from '@insidor/contracts/ports/people.ts';

/* The deliverer's Db, said again here: deliver.ts imports this file, so this one cannot import it back. */
interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export interface Device {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface Answer {
  readonly status: number;
  readonly reason: string;
  readonly host: string;
}

/** The push adapter's last answer for each endpoint (filled by its report callback). */
export type Answers = ReadonlyMap<string, Answer>;

export const devicesOf = (db: Db, userId: string): Promise<Device[]> =>
  db.query<Device>('select endpoint, p256dh, auth from people.push_subscription where user_id = $1', [userId]);

/** Send to each device; returns how many took it and each device's answer (host and status, never the endpoint). */
export async function sendToDevices(db: Db, push: PushSender, answers: Answers, devices: readonly Device[], message: PushMessage, ttlS: number): Promise<{ readonly sent: number; readonly answers: readonly Answer[] }> {
  let sent = 0;
  const said: Answer[] = [];
  for (const d of devices) {
    const r = await push.send(d, message, ttlS);
    if (r === 'sent') sent += 1;
    const a = answers.get(d.endpoint) ?? { status: r === 'sent' ? 201 : 0, reason: '', host: '' };
    said.push(a);
    if (r === 'gone') {
      await db.query('delete from people.push_subscription where endpoint = $1', [d.endpoint]);
      continue;
    }
    try {
      await db.query('update people.push_subscription set last_status = $2, last_reason = $3, last_at = now() where endpoint = $1', [d.endpoint, a.status, a.reason === '' ? null : a.reason]);
    } catch (e) {
      if ((e as { code?: unknown }).code !== '42703') throw e;
    }
  }
  return { sent, answers: said };
}
