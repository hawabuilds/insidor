/**
 * `node --env-file=.env.local --experimental-strip-types tools/send-test-alert.ts [--dry]`
 *
 * ONE TEST ALERT TO THE OWNER'S PHONE, THROUGH THE SAME ROAD THE ALARMS TAKE (the owner,
 * 2026-10-16: "push me a test alert now"). It queues one row in people.alert_queue for the owner —
 * every profile signed in with a wallet in Policy.owner.wallets — and the running alert service
 * (notify) delivers it like an outage or Not-a-meme alarm: claimed, listed in Notifications, pushed.
 * So a test that arrives proves the alarm road end to end: the queue, the deliverer, the push keys
 * and the saved device. Then it waits up to a minute for the deliverer's answer and prints it.
 *
 * ★ LABELLED A TEST, AND ONLY ONE (the owner's earlier call: "only one test notification labelled
 * clearly as test"). Its kind is push_test with facts { test: 'alarm' }, which the alert text
 * words as "Test alert from Insidor — alarms are working" (services/notify text.ts) — never the
 * words of a real alarm. It refuses to queue a second within an hour of the last, queued or
 * delivered, so a re-run by mistake does not put two on the lock screen.
 *
 * What it needs: DATABASE_URL (a role that may write people.alert_queue), and the notify service
 * running with NOTIFY=on — nothing here pushes by itself. With push off, in quiet hours or with no
 * device, the row is listed in Notifications and not pushed, and this prints which. Free: web push costs nothing.
 *
 * What breaks if changed carelessly: the subject. It carries the time, so each test has its own
 * claim; a fixed subject would be claimed once and every later test silently dropped as "already".
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { connect } from './lib/pgclient.mjs';

/** One test an hour at most. */
const ONCE_PER_MS = 60 * 60_000;
/** How long to wait for the deliverer's answer before saying it is still queued. */
const WAIT_MS = 60_000;
const POLL_MS = 3_000;
const SUBJECT_PREFIX = 'alarm-test|';

const dry = process.argv.includes('--dry');
const client = await connect();
const q = async <R>(sql: string, params: readonly unknown[] = []): Promise<R[]> => (await client.query(sql, params as unknown[])).rows as R[];

try {
  const owners = await q<{ userId: string; name: string | null }>('select user_id as "userId", name from people.profile where wallet = any($1::text[])', [[...DEFAULT_POLICY.owner.wallets]]);
  if (owners.length === 0) {
    console.log('No profile is signed in with the owner wallet. Sign in on the phone first.');
    process.exitCode = 1;
  } else {
    const ids = owners.map((o) => o.userId);
    const since = new Date(Date.now() - ONCE_PER_MS);
    const [recent] = await q<{ at: Date | null }>(
      `select max(at) as at from (
         select queued_at as at from people.alert_queue where user_id = any($1::text[]) and kind = 'push_test' and subject like $2 and queued_at > $3
         union all
         select claimed_at from people.alert_claim where user_id = any($1::text[]) and kind = 'push_test' and subject like $2 and claimed_at > $3
       ) t`,
      [ids, `${SUBJECT_PREFIX}%`, since],
    );
    const devices = await q<{ n: number }>('select count(*)::int as n from people.push_subscription where user_id = any($1::text[])', [ids]);
    if (recent?.at != null) {
      const mins = Math.ceil((recent.at.getTime() + ONCE_PER_MS - Date.now()) / 60_000);
      console.log(`A test alert was already sent at ${recent.at.toISOString().slice(11, 16)} UTC. Not sending another for ${mins} more minute${mins === 1 ? '' : 's'}.`);
      process.exitCode = 1;
    } else if (dry) {
      console.log(`Would queue one test alert for ${owners.map((o) => o.name ?? o.userId).join(', ')} (${devices[0]?.n ?? 0} device(s) saved). Nothing sent (--dry).`);
    } else {
      const subject = `${SUBJECT_PREFIX}${new Date().toISOString()}`;
      for (const userId of ids) {
        await q('insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ($1, $2, $3, 0, $4, $5)', [userId, 'push_test', subject, JSON.stringify({ test: 'alarm' }), '/#/alerts']);
      }
      console.log(`Queued one test alert (${subject}) for ${owners.length} profile${owners.length === 1 ? '' : 's'}, ${devices[0]?.n ?? 0} device(s) saved. Waiting for the alert service...`);
      const until = Date.now() + WAIT_MS;
      let done: { delivery: string }[] = [];
      while (Date.now() < until) {
        done = await q<{ delivery: string }>('select delivery from people.alert where user_id = any($1::text[]) and kind = $2 and subject = $3', [ids, 'push_test', subject]);
        if (done.length >= ids.length) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      if (done.length === 0) console.log('Still queued after a minute: the alert service (notify) is not delivering. Check it is running with NOTIFY=on.');
      else
        for (const d of done)
          console.log(
            d.delivery === 'push' ? 'Delivered: pushed to the phone. Check the lock screen.'
            : d.delivery === 'no-device' ? 'Listed in Notifications, not pushed: no device is saved, or push is off on the alert service (NOTIFY or its keys).'
            : d.delivery === 'refused' ? "Listed in Notifications, not pushed: the phone's push service refused it. Turn Feed notifications off and on again."
            : d.delivery === 'quiet' ? 'Listed in Notifications, not pushed: inside your quiet hours.'
            : `Listed in Notifications, not pushed (${d.delivery}).`,
          );
    }
  }
} finally {
  await client.end();
}
