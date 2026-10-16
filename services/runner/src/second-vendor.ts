/**
 * THE SHORT-VIDEO SOURCE'S SECOND VENDOR, SEEN FROM THE RUNNER: its route configured from policy at
 * boot, the owner told when the work moves to the backup vendor and back, and told when the prepaid
 * balance is low (Policy.feed.secondVendor).
 *
 * WHY HERE AND NOT IN THE ADAPTER. The adapter decides, call by call, which vendor answers (route.ts in
 * the short-video adapter), and that must stay synchronous and quiet. What the owner hears goes through
 * the runner's one alert queue (billing-alerts.ts `notice`), which the adapter cannot reach.
 *
 * ★ A BALANCE THAT REACHES ZERO MOVES THE WORK AT ONCE. The vendor answers a spent account with 402,
 * which the adapter already treats as a switch; reading zero off an answer switches before the next
 * call has to fail. Either way nothing stops while the owner tops up.
 *
 * ★ ONE LOW-BALANCE ALERT A UTC DAY: the subject carries the day, so the queue's claim keeps a restart
 * from pushing it twice, and a balance still low tomorrow is said again tomorrow.
 *
 * What breaks if changed carelessly: `backupUntil` is parsed here; an unparsable instant is taken as
 * "no backup" (the safe reading would be the opposite, but a typo must not keep a fallback forever
 * either), and it is logged at boot so it is seen.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import type { BillingAlerts } from './billing-alerts.ts';
import type { Logger } from './log.ts';

export interface SecondVendorDeps {
  readonly vendor: string;
  readonly backup: string;
  readonly route: {
    configure(s: { on: boolean; failAfter: number; retryAfterMs: number; backupUntilMs: number }): void;
    failed(now: number, reason: string, billing?: boolean): void;
    onSwitch(l: (e: { kind: 'backup'; reason: string; at: number } | { kind: 'back'; at: number; backupSince: number }) => void): () => void;
  };
  readonly credits: () => { readonly credits: number; readonly at: number } | null;
  readonly alerts: Pick<BillingAlerts, 'notice'>;
  readonly names: Readonly<Record<string, { readonly supplier: string }>>;
  readonly policy: Policy;
  readonly log: Logger;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Configures the route and subscribes the alerts; returns the hourly balance check. */
export function secondVendorWatch(deps: SecondVendorDeps): { readonly checkBalance: (now: number) => void } {
  const p = deps.policy.feed.secondVendor;
  const until = Date.parse(p.backupUntil);
  deps.route.configure({ on: p.on, failAfter: p.failAfter, retryAfterMs: p.retryAfterMs, backupUntilMs: Number.isFinite(until) ? until : 0 });
  deps.log.info('short-video second vendor', { on: p.on, backupUntil: Number.isFinite(until) ? new Date(until).toISOString() : 'unreadable: no backup' });
  const backupName = deps.names[deps.backup]?.supplier ?? deps.backup;
  const retryMinutes = Math.round(p.retryAfterMs / 60_000);
  deps.route.onSwitch((e) => {
    if (e.kind === 'backup') {
      deps.alerts.notice(deps.vendor, `backup|${deps.vendor}|${new Date(e.at).toISOString()}`, 'backup', { backup: backupName, reason: e.reason, retryMinutes });
    } else {
      deps.alerts.notice(deps.vendor, `backup|${deps.vendor}|back|${new Date(e.backupSince).toISOString()}`, 'back', { backup: backupName, backupMinutes: Math.round((e.at - e.backupSince) / 60_000) });
    }
  });
  return {
    checkBalance(now) {
      if (!p.on) return;
      const reading = deps.credits();
      if (reading === null) return;
      if (reading.credits <= 0) deps.route.failed(now, 'credits spent', true);
      if (reading.credits < p.lowCredits) deps.alerts.notice(deps.vendor, `low|${deps.vendor}|${day(now)}`, 'low', { credits: reading.credits, backup: backupName });
    },
  };
}
