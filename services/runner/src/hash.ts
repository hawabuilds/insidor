/**
 * Two hashes this service needs before it can talk to anything, and neither of
 * them is a product decision.
 *
 * THE POLICY HASH is the one that matters. Every decision row carries it, and it
 * is the only thing that makes a past decision auditable after a threshold moves:
 * without it, "was this judged against the old bar or the new one" is
 * unanswerable, and every replay silently compares two different systems. It is
 * taken over a CANONICAL serialisation — keys sorted at every depth — so that
 * reordering a field in the policy literal does not mint a new policy version
 * that nothing actually changed.
 *
 * THE LOCK KEY is bookkeeping: Postgres keys advisory locks by a bigint and
 * configuration names the lock in words, so the name has to become a number
 * somewhere. Doing it here, deterministically, means two runners reading the same
 * `SINGLETON_LOCK_NAME` compete for the same lock across restarts and deploys —
 * which is the entire point of the guard.
 */

import { createHash } from 'node:crypto';
import type { Policy } from '@insidor/contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON with every object's keys in sorted order. `undefined` members are dropped
 * exactly as `JSON.stringify` drops them, so a present-but-undefined field and an
 * absent one hash the same — which is what `exactOptionalPropertyTypes` already
 * says they are.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((element: unknown) => canonicalJson(element)).join(',')}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  // Functions and undefined are not serialisable; a policy contains neither, and
  // 'null' is the honest answer rather than the string "undefined".
  return JSON.stringify(value) ?? 'null';
}

/** sha256 over the canonical body. Full digest: a truncation nobody chose is a collision nobody expects. */
export function policyHash(policy: Policy): string {
  return createHash('sha256').update(canonicalJson(policy)).digest('hex');
}

/**
 * A stable 32-bit key for `pg_try_advisory_lock`. Unsigned, so it stays well
 * inside the bigint the function takes and reads the same in `pg_locks`.
 */
export function advisoryLockKey(name: string): number {
  return createHash('sha256').update(name).digest().readUInt32BE(0);
}
