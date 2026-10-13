/**
 * The runner's one way into the people schema: find the owner's profile by wallet, and queue an
 * alert for it. Used for the supplier warnings (services/runner/src/supplier-warnings.ts).
 *
 * ★ QUEUE ONLY. The runner adds a row to `people.alert_queue` and nothing else; the notify
 * service's deliverer is still the one place that claims the level, reads the owner's settings,
 * writes the list row and pushes (0044). So the once-per-level rule and mute hold for this alert
 * exactly as for every other, and a second queue of the same warning is dropped as "already".
 *
 * ★ WHY THE PIPELINE TOUCHES `people` AT ALL. 0043 keeps people's data away from the pipeline's
 * roles, and that still holds for everyone else's rows. But the warning is about the runner's own
 * spend, which only the runner's meter knows the minute it happens; handing it to notify through
 * a second table would add a hop and a migration to say the same thing. The runner connects with
 * DATABASE_URL (the database owner), so no grant is needed today. If the runner is ever moved to
 * the `insidor_internal` login role, it needs exactly `select (user_id, wallet)` on
 * `people.profile` and `insert` on `people.alert_queue` (and its sequence) — a migration, or the
 * warnings fail as a logged error and the spending carries on.
 *
 * What breaks if changed carelessly: `ownerIds` matches the wallet exactly. A case-folded or
 * prefix match on a base58 address would match a different wallet.
 */

import type { Db } from '../client.ts';

export interface OwnerAlert {
  readonly kind: string;
  readonly subject: string;
  readonly rung: number;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly href: string;
}

export class PgOwnerAlertRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** The profiles signed in with one of these wallets. Empty until the owner has signed in once. */
  async ownerIds(wallets: readonly string[]): Promise<readonly string[]> {
    if (wallets.length === 0) return [];
    const rows = await this.#db.query<{ user_id: string }>('select user_id from people.profile where wallet = any($1::text[])', [[...wallets]]);
    return rows.map((r) => r.user_id);
  }

  async queue(userId: string, a: OwnerAlert): Promise<void> {
    await this.#db.query(
      'insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ($1, $2, $3, $4, $5, $6)',
      [userId, a.kind, a.subject, a.rung, JSON.stringify(a.facts), a.href],
    );
  }
}
