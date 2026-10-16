/**
 * THE OWNER'S ALARM FOR AN EMPTY SUPPLIER ACCOUNT: when a supplier refuses a call for billing (out
 * of credit, over its monthly usage limit, payment required), an error log line "supplier out of
 * credit" and an owner alert `supplier_account`; when the same supplier answers a call again, one
 * more alert saying so.
 *
 * ★ WHY THIS EXISTS. On 2026-10-13 at 15:30 UTC the judge's account ran out of credit. Every call
 * came back 400 "credit balance is too low", the judge adapter turned each into an `unavailable`
 * answer as it should, and the runner logged "posts scored … scored=0" for half an hour with no
 * error line and no alert. Nothing was wrong with the degrade path; the fact that an account was
 * empty simply had nowhere to go.
 *
 * ★ FED BY THE VENDOR EDGE, NOT BY THE CALLERS. Each adapter's client classifies the vendor's own
 * billing signal into `OutOfCredit` and, as it builds that error, tells every listener in the
 * process (vendor-kit `onOutOfCredit`). The wiring subscribes this registry once. So every caller
 * that swallows an outage — the judge's per-post `unavailable`, the embedding degrade, a discovery
 * "source failed", a market read served from what was kept — still reaches the owner, and no
 * caller has to remember to rethrow.
 *
 * ★ ONE PUSH PER OUTAGE, ONE LOG LINE AN HOUR. A dead account is refused on every call, hundreds an
 * hour. The error line fires for the first refusal in each UTC hour, so a log reader sees the
 * outage is still going; the refusals in between are counted and the count rides on the next
 * hour's line. The owner is pushed once, on the first refusal of an outage (the subject carries
 * the hour the outage began, so the deliverer's claim drops a second queue after a restart within
 * that hour), and once more on the first successful answer after it. Hourly pushes for an account
 * the owner already knows is empty were noise; the owner's rule is once per supplier per outage.
 *
 * ★ THE OWNER, AS FOR THE SPEND WARNING. Queued for the profile signed in with OWNER_WALLET
 * through the same OwnerQueue. No wallet: logged only. No profile yet: the alert stays pending and
 * is tried again on `flush` (each minute, beside the spend warnings) until it is delivered or the
 * supplier answers again, which replaces it with the recovery.
 *
 * ★ TWO MORE THINGS THE OWNER IS TOLD ABOUT A SUPPLIER, through the same queue (`notice`): the
 * short-video source's work moving to its backup vendor and back (the owner, 2026-10-15: "switch back
 * to Apify and tell me"), and a prepaid balance running low. Each is one alert, its subject chosen by
 * the caller so a restart or a retry never pushes it twice.
 *
 * What breaks if changed carelessly: `refused` and `answered` are called inside the adapters'
 * request paths, synchronously. They must never throw and never await; everything slow happens in
 * `flush`, which is started without being awaited and catches its own errors.
 */

import type { OutOfCredit } from '@insidor/vendor-kit';

import type { Logger } from './log.ts';
import type { OwnerQueue } from './supplier-warnings.ts';

/** What the owner calls a supplier, and what it is used for here. */
export interface SupplierName {
  readonly supplier: string;
  readonly uses: string;
}

/** The suppliers we pay, by the vendor id their adapter bills as. Others are named by that id. */
export const SUPPLIER_NAMES: Readonly<Record<string, SupplierName>> = {
  anthropic: { supplier: 'Anthropic', uses: 'the judge' },
  'twitterapi.io': { supplier: 'twitterapi.io', uses: 'X posts' },
  apify: { supplier: 'Apify', uses: 'TikTok videos' },
  scrapecreators: { supplier: 'ScrapeCreators', uses: 'TikTok re-reads, creators and the For You feed' },
  voyage: { supplier: 'Voyage', uses: 'picture matching' },
  geckoterminal: { supplier: 'CoinGecko', uses: 'coin prices' },
  gemini: { supplier: 'Gemini', uses: 'embeddings' },
};

export interface BillingAlertDeps {
  /** OWNER_WALLET; empty: logged only. */
  readonly ownerWallets: readonly string[];
  readonly owner: OwnerQueue;
  readonly log: Logger;
  readonly now: () => number;
  readonly names?: Readonly<Record<string, SupplierName>>;
}

export interface BillingAlerts {
  /** A supplier refused a call for billing. Synchronous, never throws. */
  refused(error: Pick<OutOfCredit, 'vendor' | 'endpoint' | 'reason' | 'status'>): void;
  /** A supplier answered a call. Synchronous, never throws; cheap when nothing is down. */
  answered(vendor: string): void;
  /** Queue whatever is pending for the owner. Safe to call at any time; catches its own errors. */
  flush(): Promise<void>;
  /** The suppliers refused since their last answer, for a health line. */
  down(): readonly string[];
  /**
   * Any other fact about a supplier the owner must hear once: `state` says which (notify text.ts),
   * `subject` is the alert's claim, so the same subject is never pushed twice. Synchronous, never throws.
   */
  notice(vendor: string, subject: string, state: string, facts: Readonly<Record<string, unknown>>): void;
}

interface Pending {
  readonly vendor: string;
  readonly subject: string;
  readonly facts: Readonly<Record<string, unknown>>;
}

const utcHour = (ms: number): string => new Date(ms).toISOString().slice(0, 13);

export function billingAlerts(deps: BillingAlertDeps): BillingAlerts {
  const names = deps.names ?? SUPPLIER_NAMES;
  const nameOf = (vendor: string): SupplierName => names[vendor] ?? { supplier: vendor, uses: '' };
  /* vendor → the hour of its last log line, when the outage began, and the refusals since that line. */
  const down = new Map<string, { hour: string; since: number; reason: string; refusedSinceLine: number }>();
  const pending = new Map<string, Pending>();
  let flushing: Promise<void> | null = null;

  const kick = (): void => {
    void api.flush();
  };

  const api: BillingAlerts = {
    refused(error) {
      try {
        const at = deps.now();
        const hour = utcHour(at);
        const was = down.get(error.vendor);
        if (was !== undefined && was.hour === hour) {
          was.refusedSinceLine += 1;
          return;
        }
        const { supplier, uses } = nameOf(error.vendor);
        deps.log.error('supplier out of credit', {
          vendor: error.vendor,
          supplier,
          endpoint: error.endpoint,
          reason: error.reason,
          status: error.status ?? null,
          /* The refusals in the last hour that did not get their own line. */
          refusedSinceLastLine: was?.refusedSinceLine ?? 0,
          downSince: new Date(was?.since ?? at).toISOString(),
          alert: deps.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : was === undefined ? 'pushing the owner' : 'owner already pushed for this outage',
        });
        down.set(error.vendor, { hour, since: was?.since ?? at, reason: error.reason, refusedSinceLine: 0 });
        /* Only the first refusal of an outage is pushed; the hours after it are log lines. */
        if (was !== undefined) return;
        /* A recovery not yet delivered is superseded: the account is empty again. */
        pending.set(error.vendor, {
          vendor: error.vendor,
          subject: `billing|${error.vendor}|${hour}`,
          facts: { supplier, uses, reason: error.reason, state: 'refused', vendor: error.vendor },
        });
        kick();
      } catch {
        /* Never into the adapter's error path. */
      }
    },

    answered(vendor) {
      if (down.size === 0) return;
      try {
        const was = down.get(vendor);
        if (was === undefined) return;
        down.delete(vendor);
        const at = deps.now();
        const { supplier, uses } = nameOf(vendor);
        deps.log.info('supplier answering again', { vendor, supplier, downSince: new Date(was.since).toISOString(), downMinutes: Math.round((at - was.since) / 60_000) });
        pending.set(vendor, {
          vendor,
          subject: `billing|${vendor}|recovered|${new Date(was.since).toISOString()}`,
          facts: { supplier, uses, state: 'recovered', vendor },
        });
        kick();
      } catch {
        /* As above. */
      }
    },

    async flush() {
      if (flushing !== null) return flushing;
      /* ★ RESET AFTER THE ASSIGNMENT, NEVER INSIDE THE BODY. With nothing pending the body returns
         before its first await, so a `finally` inside it ran BEFORE `flushing` was assigned and the
         settled promise stayed in `flushing` for good: the minute timer's first empty flush at boot
         turned every later flush into a no-op, and from 2026-10-13 to 2026-10-16 the log said
         "queued for the owner" for every empty account while nothing was ever queued. */
      const run = async (): Promise<void> => {
        try {
          if (pending.size === 0 || deps.ownerWallets.length === 0) return;
          const ids = await deps.owner.ownerIds(deps.ownerWallets);
          /* No profile yet: kept, tried again next flush. */
          if (ids.length === 0) return;
          /* A pending refusal stays true for as long as the account is down, and a recovery however
             late it is delivered, so neither expires; a recovery replaces an undelivered refusal. */
          for (const [vendor, p] of [...pending]) {
            for (const userId of ids) await deps.owner.queue(userId, { kind: 'supplier_account', subject: p.subject, rung: 0, facts: p.facts, href: '/#/alerts' });
            if (pending.get(vendor) === p) pending.delete(vendor);
          }
        } catch (e) {
          deps.log.error('a supplier billing alert could not be queued; trying again next minute', { err: e instanceof Error ? e.message : String(e) });
        }
      };
      const current = run().finally(() => {
        if (flushing === current) flushing = null;
      });
      flushing = current;
      return current;
    },

    down: () => [...down.keys()],

    notice(vendor, subject, state, facts) {
      try {
        const { supplier, uses } = nameOf(vendor);
        deps.log.warn('supplier notice', { vendor, supplier, state, ...facts, alert: deps.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : 'queued for the owner' });
        /* Keyed apart from the billing alert of the same vendor, which it must not replace. */
        pending.set(`${vendor}|${state}`, { vendor, subject, facts: { supplier, uses, ...facts, state, vendor } });
        kick();
      } catch {
        /* Never into the caller's path. */
      }
    },
  };
  return api;
}
