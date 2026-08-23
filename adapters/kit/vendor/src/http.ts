/**
 * THE HTTP EDGE, SHARED: the small predicates that every vendor client needs and
 * that no two of them may own a private copy of.
 *
 * WHY THIS EXISTS SEPARATELY FROM `read.ts`. That file answers "what is this JSON
 * value"; this one answers "what did the transport say". They are different
 * questions with different failure modes — a bad field is a schema change, a bad
 * header is an edge rewriting a response it did not generate — and merging them
 * would put `Headers` into the import graph of the one module that is deliberately
 * about plain values.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY. `headerNumber` is the one function
 * here that has already been a bug: `Number('')` is 0, so a header that is PRESENT
 * AND BLANK — which is what a CDN emits when it rewrites a response it did not
 * generate — read back as a measured `remaining: 0`, "this client has no requests
 * left". That is a fabricated measurement in the one layer whose entire argument is
 * that we do not fabricate them. Loosening the predicate back to `Number` restores
 * it silently, in a direction nothing tests, on whichever vendor happens to sit
 * behind such an edge.
 *
 * ★ NULL IS NOT ZERO ANYWHERE IN THIS FILE. Every reader returns null for "we do
 * not have a reading", which is a different fact from every number including zero,
 * and callers are required to treat it as one.
 *
 * WHAT IS DELIBERATELY NOT HERE: a shared status taxonomy. What a 403 or a 404
 * MEANS is vendor knowledge — on one source a 404 is a community that has gone
 * private, on another it is a post that was deleted — and a shared `mapStatus`
 * would be the first place somebody made two vendors agree about something they do
 * not agree about. Each client owns its own, and says why, next to the status.
 */

/**
 * A quota window as the vendor reports it, or as much of it as the vendor reports.
 *
 * Every field is nullable because not every vendor publishes every part, and one of
 * ours publishes none of it. An absent reading is recorded as absent rather than
 * defaulted, for the reason in the header: a defaulted quota is a number somebody
 * eventually paces on.
 */
export interface QuotaReading {
  /** Requests consumed in the current window. */
  readonly used: number | null;
  /** Requests left in it. This is the one that matters. */
  readonly remaining: number | null;
  /** Seconds until the window rolls over. */
  readonly resetSeconds: number | null;
  /**
   * The vendor telling us when to come back, as opposed to describing the window.
   * Kept as the RAW STRING: `Retry-After` is defined as either a number of seconds
   * or an HTTP date, and collapsing both into a number here would either lose the
   * date form or invent a clock read inside a module that has no clock.
   */
  readonly retryAfter: string | null;
}

/** Which header carries which part. No two of our vendors agree, so it is a parameter. */
export interface QuotaHeaderNames {
  readonly used?: string;
  readonly remaining?: string;
  readonly resetSeconds?: string;
  readonly retryAfter?: string;
}

/**
 * The ONE spelling of a number we accept from a header: anchored, decimal,
 * optionally signed, optionally fractional.
 *
 * Deliberately narrower than `Number`, which is equally happy to read `''` as 0,
 * `'0x10'` as 16 and `'1e3'` as 1000 — none of which is a spelling a vendor uses for
 * a quota, and the first of which is the bug described in the file header.
 */
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;

/** A number from a header, or null when there is no honest reading to be had. */
export function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * A quota reading assembled from whichever headers this vendor publishes.
 *
 * A vendor that publishes none of them yields four nulls, and that is the correct
 * answer for it: "there is nothing to observe here" is itself a fact, and it is the
 * reason a published rate constant in a capabilities file is all such a source has.
 */
export function quotaFrom(headers: Headers, names: QuotaHeaderNames): QuotaReading {
  const number = (name: string | undefined): number | null =>
    name === undefined ? null : headerNumber(headers, name);
  const text = (name: string | undefined): string | null => {
    if (name === undefined) return null;
    const raw = headers.get(name);
    if (raw === null) return null;
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : bounded(trimmed, 64);
  };
  return {
    used: number(names.used),
    remaining: number(names.remaining),
    resetSeconds: number(names.resetSeconds),
    retryAfter: text(names.retryAfter),
  };
}

/** A quota reading as one clause of an error message. Unknown says unknown. */
export const quotaNote = (quota: QuotaReading): string =>
  `quota used ${quota.used ?? 'unknown'}, remaining ${quota.remaining ?? 'unknown'}, ` +
  `resets in ${quota.resetSeconds ?? 'unknown'}s` +
  (quota.retryAfter === null ? '' : `, vendor says retry after ${quota.retryAfter}`);

/**
 * A vendor string, cut to a length we chose.
 *
 * ★ EVERY STRING THAT CROSSES THIS EDGE IS WRITTEN BY SOMEBODY ELSE — a post's
 * author, a scraper's author, or whatever is in front of the vendor today. An
 * unbounded one ends up whole in an exception message, and an exception message
 * ends up whole in a log line, a metric label, and eventually on a screen. Bounding
 * at the point of USE rather than trusting the source is the only version of this
 * rule that survives the next call site.
 *
 * The ellipsis sits outside the quotes on purpose: a reader has to be able to see
 * that a value was cut, rather than wonder whether the vendor sent something odd.
 */
export const bounded = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

/** A response body as a quoted, bounded fragment, for an error a person reads. */
export const snippet = (text: string, max = 160): string =>
  text.length <= max ? JSON.stringify(text) : `${JSON.stringify(text.slice(0, max))}…`;

/**
 * The message off a caught value. `useUnknownInCatchVariables` is on, and the
 * alternative every codebase reaches for — `JSON.stringify(error)` — is how a
 * vendor SDK's decorations end up in a log, including whatever it attached to the
 * object on the way past.
 */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/* ── configuration predicates ─────────────────────────────────────────── */

/** Space, tab, newline, and the C0/C1 control ranges. Nothing that may sit in a header. */
const UNSAFE_IN_HEADER = /[\s\u0000-\u001F\u007F-\u009F]/;

/**
 * What is wrong with a value we are about to put in a request header, or null.
 *
 * ★ WHITESPACE AND CONTROL CHARACTERS ARE REFUSED, NOT TRIMMED AWAY, AND THAT IS A
 * SECURITY PROPERTY RATHER THAN TIDINESS. A newline inside a header value is header
 * injection: the request that goes out is not the request this code wrote. A key
 * pasted out of a terminal with a trailing newline is the ordinary way that happens,
 * so it is caught at construction with a message naming the cause, rather than as a
 * 401 that sends somebody off to re-issue a key that was fine.
 *
 * Returns a NOTE rather than throwing, because each adapter throws its own
 * not-configured class and that class is the thing callers branch on.
 */
export function headerValueProblem(value: string): string | null {
  if (value.trim().length === 0) return 'is empty';
  if (UNSAFE_IN_HEADER.test(value)) {
    return (
      'contains whitespace or a control character, which cannot go in a request header ' +
      '(a value pasted with a trailing newline is the usual cause)'
    );
  }
  return null;
}

/**
 * What is wrong with a value we are about to use as the root of every URL, or null.
 *
 * A base URL carrying a query string or a fragment silently changes every request
 * built on it — the parameters we append land after a `?` that is already there — so
 * it is refused rather than normalised. Refusing is the whole point: a base URL we
 * quietly rewrote is a base URL the operator cannot reason about from the file they
 * edited.
 */
export function httpUrlProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'is empty';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return `is not a URL (${snippet(trimmed, 60)})`;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `is not an http(s) URL (protocol ${JSON.stringify(url.protocol)})`;
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return 'carries a query string or a fragment, which would silently change every request built on it';
  }
  return null;
}

/** A base URL with trailing slashes removed, so joining a path is unambiguous. */
export const trimTrailingSlash = (value: string): string => value.trim().replace(/\/+$/, '');
