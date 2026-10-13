/**
 * THE OWNER'S EARLY WARNING: a log line and an alert when a supplier's spend today reaches a
 * share of its daily line (Policy.budget.warnAt, 80% and 95%), once per supplier, level and UTC day.
 *
 * ★ READ FROM THE METER, NOT THE LEDGER. The meter is what refuses calls, and it already holds
 * today's spend from every process (refreshed each minute from the ledger). Warning from the same
 * numbers that enforce the line means the warning and the stop can never disagree about where
 * the line is. The check costs no query; it runs alongside the ledger refresh.
 *
 * ★ ONLY THE HIGHEST LEVEL CROSSED FIRES, as with a holding's multiples. A runner that boots into
 * a day already at 96% says "95%" once, not "80%" and then "95%" a second later; the lower level
 * is spent with it.
 *
 * ★ THE LOG LINE IS THE WARNING; THE ALERT IS ITS DELIVERY. The log fires whatever happens to the
 * alert. The alert goes to the profile signed in with OWNER_WALLET (the one trading wallet). With
 * no OWNER_WALLET, or no profile with it yet, it is logged only, and the queue is tried again
 * each minute: the owner who signs in at noon still gets the morning's warning, because it is
 * still a fact about today. The deliverer's claim (0044) is on the subject, which carries the
 * day, so a retry or a restart never pushes the same warning twice.
 *
 * Memory, not a table, says what was already logged: a restart may log a level again once. That
 * is a log line, not a push, and it is cheaper than a migration to remember it.
 *
 * What breaks if changed carelessly: the day in the subject. Without it the claim is spent for
 * good and the warning fires on the first day only.
 */

import type { BudgetLine } from '@insidor/contracts/ports/meter.ts';
import type { OwnerAlert } from '@insidor/store';

import type { Logger } from './log.ts';
import type { SupplierRole } from './vendor-lines.ts';

/** The owner's profiles and the queue, narrowed so the check is testable without a database. */
export interface OwnerQueue {
  ownerIds(wallets: readonly string[]): Promise<readonly string[]>;
  queue(userId: string, alert: OwnerAlert): Promise<void>;
}

export interface SupplierWarningDeps {
  readonly roles: readonly SupplierRole[];
  readonly line: (vendor: string) => Pick<BudgetLine, 'capUsd' | 'spentUsd'>;
  /** Policy.budget.warnAt: shares of a line, ascending or not. */
  readonly warnAt: readonly number[];
  /** OWNER_WALLET; empty: logged only. */
  readonly ownerWallets: readonly string[];
  readonly owner: OwnerQueue;
  readonly log: Logger;
  readonly now: () => number;
}

/** The highest level of `warnAt` this line has reached, or null below the first. A line with no cap warns at nothing. */
export function highestReached(line: Pick<BudgetLine, 'capUsd' | 'spentUsd'>, warnAt: readonly number[]): number | null {
  if (!(line.capUsd > 0) || !Number.isFinite(line.spentUsd)) return null;
  const share = line.spentUsd / line.capUsd;
  let hit: number | null = null;
  for (const level of warnAt) if (share >= level && (hit === null || level > hit)) hit = level;
  return hit;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const percent = (level: number): number => Math.round(level * 100);
const money = (usd: number): string => `$${usd.toFixed(2)}`;

export function supplierWarnings(deps: SupplierWarningDeps): { readonly check: () => Promise<void> } {
  /* "day|role|level" — what was logged, and what reached at least one owner profile. */
  const logged = new Set<string>();
  const queued = new Set<string>();
  let day = '';

  return {
    async check() {
      const today = utcDay(deps.now());
      if (today !== day) {
        day = today;
        logged.clear();
        queued.clear();
      }
      for (const { role, vendor } of deps.roles) {
        const line = deps.line(vendor);
        const level = highestReached(line, deps.warnAt);
        if (level === null) continue;
        const key = `${today}|${role}|${percent(level)}`;
        if (!logged.has(key)) {
          /* The levels below are spent with this one, so a later check does not log them. */
          for (const lower of deps.warnAt) if (lower <= level) logged.add(`${today}|${role}|${percent(lower)}`);
          deps.log.warn(`supplier line at ${percent(level)}%: ${role} ${money(line.spentUsd)} of ${money(line.capUsd)}`, {
            role,
            share: level,
            spentUsd: line.spentUsd,
            capUsd: line.capUsd,
            alert: deps.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : 'queued for the owner, once their profile exists',
          });
        }
        if (deps.ownerWallets.length === 0 || queued.has(key)) continue;
        try {
          const ids = await deps.owner.ownerIds(deps.ownerWallets);
          for (const userId of ids) {
            await deps.owner.queue(userId, {
              kind: 'supplier_warning',
              subject: `supplier|${role}|${today}`,
              rung: percent(level),
              facts: { role, share: level, spentUsd: line.spentUsd, capUsd: line.capUsd },
              href: '/#/alerts',
            });
          }
          /* No profile yet: not marked, so the next minute tries again. */
          if (ids.length > 0) for (const lower of deps.warnAt) if (lower <= level) queued.add(`${today}|${role}|${percent(lower)}`);
        } catch (e) {
          deps.log.error('a supplier warning could not be queued; trying again next minute', { role, err: e instanceof Error ? e.message : String(e) });
        }
      }
    },
  };
}
