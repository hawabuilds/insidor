/**
 * Which vendor the short-video source's re-reads and creator checks go to: the second vendor
 * (scrapecreators.ts) first, the first scraper (client.ts) as the automatic backup.
 *
 * The owner, 2026-10-15: "if ScrapeCreators errors or returns nothing for 2 runs in a row, switch back
 * to Apify and tell me", for a week. So:
 *   - `failAfter` failures in a row (an error, or an answer with nothing in it) move the work to the
 *     backup, and the switch is announced once (`onSwitch`), not on every failure after it;
 *   - a billing refusal (402, credits spent) moves it at once: an empty account will not answer the
 *     second time either, and nothing should stop while the owner tops up;
 *   - after `retryAfterMs` on the backup, one call is tried on the second vendor again. If it answers
 *     the work moves back (announced); if not, it stays on the backup for another `retryAfterMs`,
 *     without a second alert — the owner was already told;
 *   - from `backupUntilMs` on, there is no backup: failures are failures, as for any other source.
 *
 * WHY ONE ROUTE FOR THE PROCESS, NOT ONE PER ADAPTER. The runner builds this source's adapter more than
 * once (its finders build theirs every pass), and a count of failures that lived in an adapter would
 * reset with every build and never reach two. The route is a module-level object, configured once at
 * boot from policy (Policy.feed.secondVendor); unconfigured, it sends nothing to the second vendor, so a
 * tool or a test that never configures it behaves exactly as before.
 *
 * What breaks if changed carelessly: a work item that failed on the second vendor is still done on the
 * backup in the same call (index.ts), so a failure costs one wasted credit, never a missed re-read.
 * And `use` must stay cheap and synchronous: it is asked before every call.
 */

export interface RouteSettings {
  readonly on: boolean;
  readonly failAfter: number;
  readonly retryAfterMs: number;
  /** The first instant with no backup. */
  readonly backupUntilMs: number;
}

export type RouteEvent =
  | { readonly kind: 'backup'; readonly reason: string; readonly at: number }
  | { readonly kind: 'back'; readonly at: number; readonly backupSince: number };

export interface Route {
  configure(settings: RouteSettings): void;
  /** Whether the next call goes to the second vendor. A due retry is spent by this call. */
  use(now: number): boolean;
  /** The same answer without spending a retry: for a quote. */
  peek(now: number): boolean;
  /** The second vendor answered with something. */
  ok(now: number): void;
  /** It failed, or answered with nothing; `billing` for a refusal to pay, which switches at once. */
  failed(now: number, reason: string, billing?: boolean): void;
  /** Called on every switch. Returns the unsubscribe. */
  onSwitch(listener: (event: RouteEvent) => void): () => void;
  /** For a health line and the tests. */
  state(): { readonly on: boolean; readonly backupSince: number | null; readonly failures: number };
}

const OFF: RouteSettings = { on: false, failAfter: 2, retryAfterMs: 0, backupUntilMs: 0 };

export function route(): Route {
  let s: RouteSettings = OFF;
  let failures = 0;
  let backupSince: number | null = null;
  let lastTry = 0;
  const listeners = new Set<(event: RouteEvent) => void>();
  const emit = (event: RouteEvent): void => {
    for (const l of listeners) {
      try {
        l(event);
      } catch {
        /* A listener's failure never reaches a vendor call. */
      }
    }
  };
  return {
    configure(settings) {
      s = settings;
    },
    use(now) {
      if (!s.on) return false;
      if (backupSince === null || now >= s.backupUntilMs) return true;
      if (now - lastTry < s.retryAfterMs) return false;
      lastTry = now;
      return true;
    },
    peek(now) {
      if (!s.on) return false;
      return backupSince === null || now >= s.backupUntilMs || now - lastTry >= s.retryAfterMs;
    },
    ok(now) {
      failures = 0;
      if (backupSince !== null) {
        emit({ kind: 'back', at: now, backupSince });
        backupSince = null;
      }
    },
    failed(now, reason, billing = false) {
      failures += 1;
      if (backupSince !== null || now >= s.backupUntilMs) return;
      if (billing || failures >= s.failAfter) {
        backupSince = now;
        lastTry = now;
        emit({ kind: 'backup', reason, at: now });
      }
    },
    onSwitch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    state: () => ({ on: s.on, backupSince, failures }),
  };
}

/** The process's route: every adapter of this source built in the process shares it. */
export const SECOND_VENDOR_ROUTE: Route = route();

/**
 * ★ THE SECOND VENDOR'S BALANCE, as its last answer stated it. Every answer of that vendor carries
 * `credits_remaining`, so the balance is known without asking for it (the vendor's balance endpoint
 * is documented at a credit a call). The runner reads this each hour and tells the owner when it is
 * low (Policy.feed.secondVendor.lowCredits). Null until the first answer since the process started.
 */
export interface CreditReading {
  readonly credits: number;
  readonly at: number;
}
let lastCredits: CreditReading | null = null;
export function creditsSeen(body: Readonly<Record<string, unknown>>, at: number): void {
  const c = body['credits_remaining'];
  if (typeof c === 'number' && Number.isFinite(c)) lastCredits = { credits: c, at };
}
export const lastCreditReading = (): CreditReading | null => lastCredits;
