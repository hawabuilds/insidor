/**
 * The one place a database row becomes vocabulary, and vice versa.
 *
 * Two conversions live here rather than being repeated per repository, because
 * both are easy to get subtly wrong in a way nothing catches:
 *
 *   - TIME. The vocabulary is epoch milliseconds, always. The database is
 *     `timestamptz`, always. Never a `Date` in a domain object: a Date is mutable,
 *     is not JSON, and serialises differently depending on who does it.
 *   - IDENTITY. Branded ids are opaque by design, so somewhere a plain string has
 *     to become one. That somewhere is here and nowhere else — the database is the
 *     only place an id legitimately arrives untyped, having been typed on the way
 *     in.
 */

import type { Millis } from '@insidor/contracts';

/** A `timestamptz` as pg returns it. */
export type TimestampColumn = Date | string | null;

export function toMillis(value: TimestampColumn): Millis | null {
  if (value === null) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Same, for a column the schema declares NOT NULL. Throws rather than defaulting. */
export function toMillisRequired(value: TimestampColumn, column: string): Millis {
  const millis = toMillis(value);
  if (millis === null) throw new TypeError(`column '${column}' is NOT NULL but arrived null`);
  return millis;
}

export function toTimestamp(value: Millis | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value);
}

/**
 * Re-brand a string read out of the database.
 *
 * This cast is deliberate and deliberately confined. Every id was constructed by a
 * contracts-side constructor before it was written; reading it back is the only
 * moment the brand has to be reasserted rather than earned. Doing it in a named
 * function makes every occurrence greppable, which a bare `as` would not be.
 */
export function reBrand<T extends string>(value: string): T {
  return value as unknown as T;
}

/**
 * Convert a hash carrier's opaque key into a Postgres bit-string literal.
 *
 * The contract with adapters: a fingerprint that declares a `bits` width carries
 * its value as lowercase hex of exactly `bits / 4` characters. Nothing about that
 * is inherent — it is a convention — so it is asserted loudly here rather than
 * assumed, because a silently mis-sized hash produces an index that returns
 * plausible neighbours for the wrong reason.
 */
export function toBitLiteral(key: string, bits: number): string {
  const expectedHexChars = bits / 4;
  if (!Number.isInteger(expectedHexChars)) {
    throw new TypeError(`fingerprint width ${bits} is not a whole number of hex characters`);
  }
  if (key.length !== expectedHexChars || !/^[0-9a-f]+$/.test(key)) {
    throw new TypeError(
      `fingerprint key must be ${expectedHexChars} lowercase hex characters for a ${bits}-bit hash`,
    );
  }
  let out = '';
  for (const char of key) {
    out += Number.parseInt(char, 16).toString(2).padStart(4, '0');
  }
  return out;
}
