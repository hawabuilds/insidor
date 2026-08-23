/**
 * THE HTTP SURFACE, AND NOTHING ELSE. Two endpoints, both paid.
 *
 * Everything above this file is deterministic and testable without a network.
 * That separation is what lets the conformance suite run the whole adapter — its
 * capability claims, its translation, its fidelity — with both methods below
 * replaced by stubs that throw.
 *
 * `fetch` is INJECTED. It is never imported and never read off `globalThis`, for
 * the same reason the clock is: a test that CAN reach the network is a test that
 * fails when the network does, and a source that can be reached from a unit test
 * eventually is.
 *
 * ── THE AUTH, AND WHY THERE IS SO LITTLE OF IT ────────────────────────────
 *
 * One header, `X-API-Key`, on every call. No OAuth, no bearer, no token to mint,
 * cache or refresh. The single-flight token machinery in the reddit client has no
 * equivalent here and its absence is not a gap: there is no lifetime to read and
 * nothing to expire mid-call.
 *
 * ── ★ THE DIFFERENCE FROM REDDIT THAT CHANGES EVERY DECISION IN THIS FILE ──
 *
 * THIS SOURCE COSTS MONEY, PER ITEM, INCLUDING WHEN IT RETURNS NOTHING. The
 * vendor charges a floor of one item's price per request — "$0.00015 per request
 * (even if no data returned)". So an error path is not free here the way it is on
 * a free source: a 500 we retried three times is three real charges. This file
 * therefore does not retry ANYTHING. Retrying is a policy with a price, the price
 * is invisible from inside a client, and the meter above cannot record a decision
 * this file made privately. The one retry the reddit client permits itself exists
 * to recover an expired token; there are no tokens here, so there is nothing to
 * recover and no reason to spend twice.
 *
 * ── ★ THE PATH THAT MUST NOT EXIST ────────────────────────────────────────
 *
 * There is no branch anywhere below that turns a refusal into an empty result.
 * This vendor can answer HTTP 200 with `{"status":"error"}` in the body, and the
 * `tweets` array is then absent — so the single most natural piece of defensive
 * code that could be written here, `arr(body.tweets)` yielding `[]`, would report
 * a rejected API key as "these posts no longer exist". On the tracking path that
 * reads as every tracked post being deleted at once, which is a dramatic, precise,
 * completely fabricated measurement. The error envelope is checked BEFORE the
 * payload is decoded, on every response, and it raises unavailability.
 */

import { arr, rec, str, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';
/* The transport half of the kit, imported by its own path rather than through the
   barrel. Two vendors need these predicates and neither may own a private copy —
   `Number('')` being 0 is a bug that was paid for once already. */
import {
  bounded,
  headerValueProblem,
  httpUrlProblem,
  messageOf,
  quotaFrom,
  quotaNote,
  snippet,
  trimTrailingSlash,
} from '@insidor/vendor-kit/http.ts';
import type { QuotaReading } from '@insidor/vendor-kit/http.ts';

import { VENDOR } from './capabilities.ts';

/* ── endpoint labels ──────────────────────────────────────────────────── */

/**
 * Labels for errors and for the ledger. They carry NO host, no key and no query,
 * which is what makes them safe to put in an exception message that will end up in
 * a log somebody else reads.
 */
export const SEARCH_ENDPOINT = 'GET /twitter/tweet/advanced_search';
export const LOOKUP_ENDPOINT = 'GET /twitter/tweets';

const SEARCH_PATH = '/twitter/tweet/advanced_search';
const LOOKUP_PATH = '/twitter/tweets';

/**
 * ★ PINNED, AND DELIBERATELY NOT ON THE INTERFACE.
 *
 * `queryType` is a required parameter with two values. `Latest` is reverse
 * chronological, which is a FACT about the result set; `Top` is the vendor's
 * opinion, it is recomputed between two pages so an item can be seen twice or
 * missed entirely, and it is computed from exactly the engagement we are trying to
 * measure. It is fixed here rather than exposed on `XClient.search`, because a
 * caller that CAN choose `Top` is a caller that can contaminate a run — and the
 * same argument already fixes `sort=new` on the other keyword-capable source.
 */
export const QUERY_TYPE = 'Latest';

/**
 * The batch lookup's ceiling.
 *
 * ★ THIS NUMBER IS AN UNVERIFIED ASSUMPTION AND IS LABELLED AS ONE. The vendor's
 * own endpoint documentation states no maximum for `tweet_ids` and describes no
 * behaviour for exceeding one; 100 is corroborated only by secondary sources. It
 * is kept because a ceiling we guessed and enforce ourselves fails LOUDLY — the
 * `RangeError` below is a caller bug with a stack trace — whereas a ceiling the
 * vendor enforces silently truncates the list and returns a short array, which
 * `observe.ts` correctly reads as "those ids returned nothing", i.e. as a batch of
 * deleted posts. Guessing low in the direction of a loud failure is the only safe
 * way to hold an unverified limit.
 */
export const MAX_IDS_PER_CALL = 100;

/**
 * A post id on this source: a decimal snowflake, and nothing that can address a
 * path or split a list.
 *
 * ★ ONE DEFINITION, TWO HAZARDS. The lookup endpoint joins ids with a comma, so an
 * id containing one would become two ids and shift every result after it — the
 * same class of hole the other source's fullname check closes. And the same string
 * arrives here from our own store, where it was written from a vendor payload, so
 * "we minted it" is not by itself a guarantee about its contents.
 */
const POST_ID = /^[0-9]{1,25}$/;

export const isPostId = (value: string): boolean => POST_ID.test(value);

/**
 * How long a pagination cursor may be before we refuse to carry it.
 *
 * The cursor is opaque and round-tripped verbatim, so its CONTENT is none of our
 * business — but its size is: it goes into a URL, and a vendor or an edge that
 * starts returning a megabyte here would build a request that fails in a way that
 * looks like our bug. Refused rather than truncated, because a truncated cursor is
 * a request for a page that does not exist, answered plausibly.
 */
const MAX_CURSOR_LENGTH = 4096;

/* ── what a caller gets back ──────────────────────────────────────────── */

export interface SearchPage {
  readonly items: readonly unknown[];
  readonly cursor: string | null;
  /** From the vendor. Never inferred from whether the page looked full. */
  readonly hasMore: boolean;
}

export interface XClient {
  /** Query-syntax search. This source is the only one of ours that has it. */
  search(query: string, cursor: string | null): Promise<SearchPage>;
  /** Re-read by id, up to `capabilities.observeBatchSize` per call. */
  lookup(ids: readonly string[]): Promise<readonly unknown[]>;
}

export interface XClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Injected so the conformance suite never needs a real one. */
  readonly fetch: typeof globalThis.fetch;
  /**
   * Optional wall-clock ceiling for one request. Optional because a deadline is a
   * policy and policies belong to the caller; a hung socket in a polling loop is
   * indistinguishable from a slow vendor, which is why it is offered at all.
   */
  readonly timeoutMs?: number;
  /**
   * Called with every quota reading the vendor reports. OBSERVATION ONLY: this file
   * never waits, retries or paces on it.
   *
   * ★ ON THIS VENDOR IT WILL USUALLY BE FOUR NULLS, AND THAT IS THE FINDING RATHER
   * THAN A DEFECT. It documents a client-wide ceiling ("up to 200 QPS") and
   * publishes no per-response quota headers at all, so there is nothing to measure
   * — unlike the free source, which reports its remaining budget on every response.
   * The hook is wired anyway: the headers below are read opportunistically, so the
   * day the vendor starts sending them the reading appears with no code change,
   * and until then the honest answer travels as null rather than as a zero.
   */
  readonly onQuota?: (reading: QuotaReading, endpoint: string) => void;
}

/**
 * Header names read opportunistically. None of these is documented by this vendor;
 * they are the conventional spellings, and an absent one yields null rather than a
 * number. See `onQuota` above for why reading undocumented headers is safe when
 * absence is a first-class answer and nothing paces on the result.
 */
const QUOTA_HEADERS = {
  used: 'x-ratelimit-used',
  remaining: 'x-ratelimit-remaining',
  resetSeconds: 'x-ratelimit-reset',
  retryAfter: 'retry-after',
} as const;

/* ── configuration errors ─────────────────────────────────────────────── */

/**
 * ★ A MISSING OR MALFORMED CREDENTIAL IS NOT A VENDOR FAILURE AND MUST NOT ARRIVE
 * AS ONE.
 *
 * It is its own class so a caller failing closed can tell "we were never configured
 * to call this source" from "this source is down". They demand opposite responses:
 * the first is a person editing a file, the second is a retry. Collapsing them is
 * how a permanently unconfigured source spends weeks looking like an intermittently
 * flaky one — and here it would also cost money, because the retry is billed.
 *
 * The registry builds every adapter inside a `try` and turns this throw into
 * `misconfigured`, so a half-filled environment and a rejected credential reach
 * `services/runner/src/sources.ts` in the same shape and read as the same fault.
 */
export class XNotConfigured extends Error {
  readonly variable: string;

  constructor(variable: string, note: string) {
    super(
      `x adapter is not configured: ${variable} ${note}. ` +
        'X_API_KEY is required and has no default — a defaulted credential authenticates ' +
        'as somebody else. Get one from the reseller at https://twitterapi.io (the key is a ' +
        'single value sent as an X-API-Key header; there is no OAuth and no account password ' +
        'anywhere in this package). Put it in .env.local, which is gitignored. X_API_BASE is ' +
        'optional and defaults to the reseller host; override it only to point at a staging ' +
        'or recorded endpoint. ★ THIS SOURCE IS BILLED PER POST RETURNED, WITH A MINIMUM ' +
        'CHARGE PER REQUEST, so a misconfigured client that keeps being retried costs money.',
    );
    this.name = 'XNotConfigured';
    this.variable = variable;
  }
}

/* ── pure helpers, exported because they are worth testing without a socket ── */

const shapeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`);

/**
 * The vendor's own pagination token, checked for the only property we care about.
 *
 * Exported for the same reason `decodeSearchPage` is: it is the shape half of the
 * file, and it deserves a test that needs no socket.
 */
export function decodeCursor(value: unknown, endpoint: string): string | null {
  // `str` already treats an empty string as absent, which is what this vendor sends
  // on the last page — so "no more cursor" and "no cursor field" collapse correctly.
  const cursor = str(value);
  if (cursor === null) return null;
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw new VendorShapeError(
      VENDOR,
      'next_cursor',
      `is ${cursor.length} characters, over the ${MAX_CURSOR_LENGTH} we will carry (from ${endpoint})`,
    );
  }
  return cursor;
}

/**
 * One search response envelope, decoded.
 *
 * ★ `has_next_page` IS REQUIRED AND IS NEVER INFERRED. This vendor documents that a
 * page can be SHORT without being last — "sometimes less than 20, because we will
 * filter out ads" — so `items.length === limit` is not merely a weaker signal here,
 * it is a wrong one. An absent field is therefore a schema change and is raised as
 * one. The two ways of guessing both look like working code: `false` stops a page
 * early and quietly halves recall, `true` pages forever against a metered vendor.
 */
export function decodeSearchPage(body: unknown, endpoint: string): SearchPage {
  const envelope = rec(body);

  if (!Array.isArray(envelope.tweets)) {
    throw new VendorShapeError(
      VENDOR,
      'tweets',
      `is ${shapeOf(envelope.tweets)}, expected an array (from ${endpoint})`,
    );
  }

  const hasMore = envelope.has_next_page;
  if (typeof hasMore !== 'boolean') {
    throw new VendorShapeError(
      VENDOR,
      'has_next_page',
      `is ${shapeOf(hasMore)}, expected a boolean — this field is the ONLY honest end-of-results ` +
        `signal on this vendor, because a short page is documented not to mean the last page ` +
        `(from ${endpoint})`,
    );
  }

  return { items: arr(envelope.tweets), cursor: decodeCursor(envelope.next_cursor, endpoint), hasMore };
}

/**
 * One lookup response envelope, decoded.
 *
 * ★ IDS THAT COME BACK WITH NO PAYLOAD ARE SIMPLY NOT IN THIS ARRAY, and that
 * absence is preserved all the way up: `observe.ts` omits them from its map rather
 * than mapping them to zeros, because a deleted post and an unread post are
 * different facts and only one of them is a measurement.
 */
export function decodeLookup(body: unknown, endpoint: string): readonly unknown[] {
  const envelope = rec(body);
  if (!Array.isArray(envelope.tweets)) {
    throw new VendorShapeError(
      VENDOR,
      'tweets',
      `is ${shapeOf(envelope.tweets)}, expected an array (from ${endpoint})`,
    );
  }
  return arr(envelope.tweets);
}

/* ── the client ───────────────────────────────────────────────────────── */

interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

function requireKey(value: string): string {
  const problem = headerValueProblem(value);
  if (problem !== null) throw new XNotConfigured('X_API_KEY', problem);
  return value;
}

function requireBaseUrl(value: string): string {
  const problem = httpUrlProblem(value);
  if (problem !== null) throw new XNotConfigured('X_API_BASE', problem);
  return trimTrailingSlash(value);
}

export function httpClient(config: XClientConfig): XClient {
  /* ★ Validated HERE, at construction, and not on first use. A client built from a
     half-filled .env that only fails when somebody finally calls it turns a one-line
     configuration mistake into an incident with a stack trace in the middle of a
     discovery run — and on this source, into a bill. This is also the constructor
     path the registry's try/catch exists to serve: until it could throw, this source
     had no way to reach the `misconfigured` verdict at all. */
  const apiKey = requireKey(config.apiKey);
  const baseUrl = requireBaseUrl(config.baseUrl);

  const requestInit = (init: RequestInit): RequestInit =>
    config.timeoutMs === undefined ? init : { ...init, signal: AbortSignal.timeout(config.timeoutMs) };

  /**
   * ★ A PATH GATE ON A FILE THAT BUILDS NO PATHS FROM VENDOR STRINGS.
   *
   * Both paths here are literals, so today this can only reject a programming
   * mistake. It is kept because that is exactly what it is for: the gate a future
   * second caller cannot forget. The other source's equivalent was written after a
   * caller-supplied community name reached a URL, where a stray `/` or `?` does not
   * fail — it silently changes WHICH request is made, which is the one class of bad
   * input a URL builder must never pass through.
   */
  const urlFor = (path: string, query: Readonly<Record<string, string>>): string => {
    if (!/^\/[A-Za-z0-9/_.-]*$/.test(path)) {
      throw new RangeError(`x client: path '${path}' is not a safe request path`);
    }
    return `${baseUrl}${path}?${new URLSearchParams(query).toString()}`;
  };

  const send = async (url: string, endpoint: string): Promise<RawResponse> => {
    let response: Response;
    try {
      response = await config.fetch(
        url,
        requestInit({
          method: 'GET',
          // The whole of the auth. Never a query parameter: a keyed URL ends up in
          // a proxy log and a browser history, and this one is a credential.
          headers: { 'X-API-Key': apiKey, accept: 'application/json' },
        }),
      );
    } catch (error) {
      // No status: DNS, socket, or the abort above. Deliberately NOT the same error
      // as "the vendor said no" — a caller failing closed has to be able to tell an
      // outage from an answer it did not like.
      throw new VendorUnavailable(VENDOR, endpoint, `request failed: ${messageOf(error)}`);
    }

    const quota = quotaFrom(response.headers, QUOTA_HEADERS);
    // Reported before anything can throw, because the response carrying the most
    // interesting quota reading is the one we are about to reject.
    config.onQuota?.(quota, endpoint);

    let text: string;
    try {
      // Always drained, even on a status we are about to reject. An unread body
      // holds its socket, and a client that leaks one per error leaks fastest during
      // the incident that is producing the errors.
      text = await response.text();
    } catch (error) {
      throw new VendorUnavailable(VENDOR, endpoint, `body could not be read: ${messageOf(error)}`, response.status);
    }

    return { status: response.status, headers: response.headers, text };
  };

  /**
   * A response turned into JSON, or into the right kind of failure.
   *
   * Every status below is a decision about what that status MEANS on this vendor,
   * and the shared rule behind all of them is the product's: an outage is not a
   * claim. None of these paths may ever be turned into an empty result.
   */
  const json = async (endpoint: string, url: string): Promise<unknown> => {
    const response = await send(url, endpoint);

    if (response.status === 401) {
      /* The key was rejected. Not transient and not worth retrying — and a retry
         here is billed. Reported with the status attached so the distinction
         survives into a log, and deliberately WITHOUT the body, which echoes
         nothing useful and could echo something we sent. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        'rejected our API key — check X_API_KEY against the reseller dashboard',
        401,
      );
    }

    if (response.status === 402 || response.status === 403) {
      /* ★ AN OUTAGE, NOT AN EMPTY RESULT, AND THE BODY IS NEVER PARSED FOR CONTENT.
         On a metered reseller this is the shape a lapsed subscription or an
         exhausted balance takes, and it is the single most likely non-2xx we will
         ever see. Mapping it to "no posts" would report an unpaid invoice as a
         quiet internet, forever, with nothing to object to. Enough of the body is
         attached to recognise the page on sight, and no attempt is made to read
         anything out of it. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `refused the request (content-type ${response.headers.get('content-type') ?? 'absent'}): ` +
          `${snippet(response.text)}`,
        response.status,
      );
    }

    if (response.status === 429) {
      /* The rate limit, surfaced as an event rather than absorbed. This client does
         not wait on it: pacing decided inside a client is pacing nobody above it can
         see or budget for. Whatever the vendor said about the window goes into the
         message, because a caller that WANTS to back off cannot if the only place
         those numbers appeared was a response we discarded — and on this vendor they
         are usually absent, which `quotaNote` renders as "unknown" rather than as a
         number nobody measured. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `rate limited — ${quotaNote(quotaFrom(response.headers, QUOTA_HEADERS))}`,
        429,
      );
    }

    if (response.status === 404) {
      /* Every non-2xx INCLUDING 404. A path that moved, a reseller that retired an
         endpoint, and a gateway with no route all arrive here, and none of them is
         "this query matched nothing". */
      throw new VendorUnavailable(VENDOR, endpoint, 'responded 404 — no such endpoint, or it moved', 404);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new VendorUnavailable(VENDOR, endpoint, `responded ${response.status}`, response.status);
    }

    let body: unknown;
    try {
      body = JSON.parse(response.text) as unknown;
    } catch {
      /* ★ 200 WITH A BODY THAT IS NOT JSON IS AN OUTAGE WEARING A SUCCESS CODE. A
         reseller sits behind an edge, and an edge serves HTML interstitials with a
         200 on them. Calling this a shape error would send the next person hunting a
         schema change; it is unavailability, with a snippet so the page is
         recognisable at a glance. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `responded ${response.status} with a body that is not JSON ` +
          `(content-type ${response.headers.get('content-type') ?? 'absent'}): ${snippet(response.text)}`,
        response.status,
      );
    }

    /* ★ AN ERROR ENVELOPE UNDER A 200, WHICH IS THIS VENDOR'S DOCUMENTED FAILURE
       SHAPE AND THE MOST DANGEROUS ONE IN THE FILE. `status` and `message` appear on
       error responses only; on such a response `tweets` is absent, so any decoder
       that reached for it defensively would produce an empty array and report a
       broken key as "these posts vanished". Checked before the payload is decoded,
       on every response, and raised as unavailability — the status is 200, so the
       status is recorded as 200 rather than invented. */
    const envelope = rec(body);
    if (str(envelope.status) === 'error') {
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `answered ${response.status} carrying an error envelope: ` +
          `${bounded(str(envelope.message) ?? '(no message)', 200)}`,
        response.status,
      );
    }

    return body;
  };

  return {
    search: async (query, cursor) => {
      const params: Record<string, string> = { query, queryType: QUERY_TYPE };
      /* Omitted rather than sent empty for the first page. The vendor documents the
         parameter as optional and an empty string as the first-page value; omitting
         is the same request with one fewer assumption in it. The cursor itself is
         opaque and round-tripped verbatim — it goes through `URLSearchParams`, so
         there is nothing in it that could change which request is made. */
      if (cursor !== null) params.cursor = cursor;

      const page = decodeSearchPage(await json(SEARCH_ENDPOINT, urlFor(SEARCH_PATH, params)), SEARCH_ENDPOINT);

      /* ★ A CURSOR THAT DOES NOT ADVANCE IS AN INFINITE LOOP AGAINST A METERED
         VENDOR, and this is the only place that can see it: the caller holds the
         cursor it sent, the vendor sends the next one, and nothing else in the stack
         has both. Left alone it is not a hang — it is a paging loop re-buying the
         same page until the daily cap stops it, with the ledger showing real spend
         against duplicate items.

         It is raised rather than repaired. Answering `hasMore: false` would repair
         it silently, and silently truncating a result set is exactly the class of
         plausible-and-wrong this adapter refuses everywhere else. */
      if (cursor !== null && page.cursor === cursor && page.hasMore) {
        throw new VendorUnavailable(
          VENDOR,
          SEARCH_ENDPOINT,
          'returned the same pagination cursor it was given while still claiming more pages, ' +
            'which would page the same result set forever against a per-item bill',
          200,
        );
      }

      return page;
    },

    lookup: async (ids) => {
      if (ids.length === 0) {
        throw new RangeError('x client: asked to look up no ids; a batch of nothing is a caller bug');
      }
      if (ids.length > MAX_IDS_PER_CALL) {
        throw new RangeError(
          `x client: ${ids.length} ids exceeds the ${MAX_IDS_PER_CALL} this endpoint is assumed to accept`,
        );
      }
      for (const id of ids) {
        // The batch separator is a comma, so an id containing one would become two
        // ids and shift every result after it. Rejected rather than encoded: an id
        // that is not an id on this source is not a post we know about.
        if (!isPostId(id)) {
          throw new RangeError(`x client: '${bounded(id, 64)}' is not a post id on this source`);
        }
      }

      return decodeLookup(
        await json(LOOKUP_ENDPOINT, urlFor(LOOKUP_PATH, { tweet_ids: ids.join(',') })),
        LOOKUP_ENDPOINT,
      );
    },
  };
}
