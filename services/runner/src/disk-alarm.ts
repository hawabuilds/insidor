/**
 * THE OWNER'S DISK AND BILL ALERTS (Policy.store, the owner 2026-10-18): every `everyMs` the
 * database's size is sampled into internal.disk_sample (0105), the host's disk replayed from every
 * sample (disk-model.ts), and three things queued for the owner as `outage` alerts through the same
 * OwnerQueue the language-drop alarm uses: usage passing `alertAt` of the disk, the disk inferred to
 * have grown, and the month's projected bill first passing `alertOverUsd`.
 *
 * ★ WHY. The owner let the disk grow past 8 GB rather than prune to stay under it. The host grows
 * it by itself and bills the provisioned size, and says nothing to us when it does; at 95% full
 * with no quota it turns the database read-only. Nothing we ran watched the size at all.
 *
 * ★ WHY IN THE RUNNER. It already reads and writes internal tables and queues owner alerts; the
 * sample needs no grant beyond 0105's. pg_database_size is readable by any role that can connect.
 * The file buckets' size needs SELECT on storage.objects, which the internal role may not have; the
 * repository stores NULL then and the bill says the files part is unknown.
 *
 * ★ ONCE PER CROSSING, ONCE PER GROW, ONCE PER MONTH, ACROSS RESTARTS. Crossings and grows are
 * replayed from the stored samples every pass, so a restart finds the same ones at the same hours;
 * the hour names the alert's subject and the deliverer's claim drops a second queue of it. Only one
 * within `announceWithinMs` is queued, so a deploy never pushes an old one. The bill's subject is
 * its month, so it is pushed the first pass the projection is over the line and never again that
 * month, even if it dips under and back.
 *
 * ★ AND THE MONTH'S TRANSFER (Policy.store.transfer, 0153, the owner 2026-10-29): the host restricts
 * the project when the plan's transfer is used up and the spend cap stays on, so the owner is told
 * once a month (`transfer|<month>`) when the estimate (transfer-model.ts) projects the month past
 * `alertShare` of it — in time to cut reads, not after the restriction.
 *
 * What breaks if changed carelessly: a subject without the crossing's hour pushes the 80% alert once
 * ever, never again at the next disk size; queueing every replayed crossing pushes the history on
 * each deploy. The bill alert fires from the first pass while `computeNetUsd` alone puts the month
 * over the line: that is the model saying so, and the alert names compute as unconfirmed.
 */

import type { StorePolicy } from '@insidor/contracts/policy.ts';

import { billParts, GB, growthOf, projectBill, replayDisk, type SizeSample } from './disk-model.ts';
import { projectTransfer } from './transfer-model.ts';
import { errorText, type Logger } from './log.ts';
import type { OwnerQueue } from './supplier-warnings.ts';

export interface DiskAlarmDeps {
  readonly policy: StorePolicy;
  /** Read the sizes now and write this hour's row (store PgDiskSampleRepo.sample). */
  readonly sample: () => Promise<unknown>;
  /** Every stored sample, oldest first (store PgDiskSampleRepo.since(0)). */
  readonly samples: () => Promise<readonly SizeSample[]>;
  readonly ownerWallets: readonly string[];
  readonly owner: OwnerQueue;
  readonly log: Logger;
  readonly now: () => number;
}

const iso = (ms: number): string => new Date(ms).toISOString();
const round = (x: number, places = 2): number => Math.round(x * 10 ** places) / 10 ** places;

export function diskAlarm(deps: DiskAlarmDeps): { readonly check: () => Promise<number> } {
  const logged = new Set<string>();
  const queued = new Set<string>();

  const push = async (subject: string, facts: Record<string, unknown>, line: string, sent: { n: number }): Promise<void> => {
    if (!logged.has(subject)) {
      logged.add(subject);
      deps.log.warn(line, { ...facts, subject, alert: deps.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : 'queued for the owner' });
    }
    if (deps.ownerWallets.length === 0 || queued.has(subject)) return;
    try {
      const ids = await deps.owner.ownerIds(deps.ownerWallets);
      for (const userId of ids) await deps.owner.queue(userId, { kind: 'outage', subject, rung: 0, facts, href: '/#/alerts' });
      if (ids.length > 0) {
        queued.add(subject);
        sent.n += ids.length;
      }
    } catch (e) {
      deps.log.error('a disk or bill alert could not be queued; trying again next pass', { subject, err: errorText(e) });
    }
  };

  return {
    /** One pass: sample, replay, queue what is new. Returns how many alerts were queued. Never throws. */
    async check() {
      const p = deps.policy;
      if (!p.disk.on && !p.bill.on && !p.transfer.on) return 0;
      const sent = { n: 0 };
      try {
        await deps.sample();
      } catch (e) {
        /* A missed sample is a missed hour, not a size of 0: the replay carries on from the rows it has. */
        deps.log.warn('the database size could not be sampled; trying again next pass', { err: errorText(e) });
      }
      let samples: readonly SizeSample[];
      try {
        samples = await deps.samples();
      } catch (e) {
        deps.log.warn('the database size samples could not be read; trying again next pass', { err: errorText(e) });
        return 0;
      }
      const now = deps.now();
      const replay = replayDisk(samples, p.disk);
      const last = replay.last;
      if (last === null) return 0;
      const dbGb = round(last.dbBytes / GB);
      const growth = growthOf(samples, p.disk.growthDays);
      const perDay = growth === null ? null : round(growth.bytesPerDay / GB, 3);

      if (p.disk.on) {
        for (const c of replay.crossings.filter((x) => x.atMs > now - p.disk.announceWithinMs)) {
          const facts = { what: 'disk', state: 'over', dbGb, provisionedGb: round(c.provisionedGb), percent: Math.round(100 * c.share), gbPerDay: perDay, growAtPercent: Math.round(100 * p.disk.growAt), at: iso(c.atMs) };
          await push(`disk|over|${round(c.provisionedGb)}|${iso(c.atMs)}`, facts, `the database is ${facts.percent}% of the ${facts.provisionedGb} GB disk`, sent);
        }
        for (const g of replay.grows.filter((x) => x.atMs > now - p.disk.announceWithinMs)) {
          const facts = { what: 'disk', state: 'grew', fromGb: round(g.fromGb), toGb: round(g.toGb), dbGb, at: iso(g.atMs) };
          await push(`disk|grew|${round(g.toGb)}|${iso(g.atMs)}`, facts, `the disk has probably grown to ${facts.toGb} GB`, sent);
        }
      }
      if (p.bill.on) {
        const bill = projectBill(samples, now, p);
        if (bill.totalUsd > p.bill.alertOverUsd) {
          const facts = {
            what: 'bill',
            month: bill.month,
            projectedUsd: round(bill.totalUsd),
            overUsd: p.bill.alertOverUsd,
            planUsd: round(bill.planUsd),
            computeUsd: round(bill.computeUsd),
            computeConfirmed: bill.computeConfirmed,
            diskUsd: round(bill.diskUsd),
            storageUsd: bill.storageUsd === null ? null : round(bill.storageUsd),
            diskEndGb: round(bill.diskEndGb),
          };
          await push(`bill|${bill.month}`, facts, `the database bill for ${bill.month} is heading for ${billParts(bill)}`, sent);
        }
      }
      if (p.transfer.on) {
        const t = projectTransfer(samples, now, p.transfer);
        if (t !== null && t.projectedGb >= p.transfer.alertShare * p.transfer.includedGb) {
          const facts = {
            what: 'transfer',
            month: t.month,
            projectedGb: round(t.projectedGb, 1),
            includedGb: p.transfer.includedGb,
            percent: Math.round((100 * t.projectedGb) / p.transfer.includedGb),
            alertPercent: Math.round(100 * p.transfer.alertShare),
            soFarGb: round(t.gbSoFar, 1),
            gbPerDay: round(t.gbPerDay, 2),
            knownHours: t.knownHours,
            elapsedHours: t.elapsedHours,
          };
          await push(`transfer|${t.month}`, facts, `the database transfer for ${t.month} is heading for about ${facts.projectedGb} GB of the ${facts.includedGb} GB plan`, sent);
        }
      }
      return sent.n;
    },
  };
}
