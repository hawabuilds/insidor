/**
 * Narrow, defensive readers for vendor JSON.
 *
 * Every one of these returns null rather than throwing or defaulting, because
 * at this layer the difference between "absent" and "zero" is the whole
 * product: a missing liquidity object is not a drained pool, and a platform
 * with no reproduction concept is not a post nobody copied. A `?? 0` anywhere
 * below would reintroduce the two most expensive bugs in the build we replace.
 *
 * These live in one shared package so that three adapters cannot drift into
 * three slightly different definitions of "is this a number".
 */

export type Rec = Record<string, unknown>;

/** Anything that is not an object becomes an empty object, so `.a.b.c` is safe. */
export const rec = (v: unknown): Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {};

/** Empty string is treated as absent: vendors use '' where they mean null. */
export const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

export const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return v.trim().length > 0 && Number.isFinite(n) ? n : null;
  }
  return null;
};

export const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};

export const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
};

export const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/**
 * True when the KEY IS ABSENT — as opposed to present and null, or present and
 * zero. Three different facts that vendors express three different ways and
 * that a naive read collapses into one.
 */
export const missing = (o: Rec, key: string): boolean => !(key in o);

/**
 * Seconds → milliseconds, keeping null null. Vendors mix the two units freely
 * and a 1000× error in a timestamp reads as a plausible date in 1970.
 */
export const secondsToMillis = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 1000);
};

/** An ISO-8601 or RFC-2822 date string → millis. Parsing is not a clock read. */
export const dateToMillis = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
};
