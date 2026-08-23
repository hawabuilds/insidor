/**
 * THE VENDOR SURFACE: ACTOR RUNS, NOT ENDPOINTS.
 *
 * This vendor bills per RUN, and a run returns however many items it returns. That
 * is why the meter is told `billing: 'per-run'` and `units: 1` per call — counting
 * items here would produce a plausible dollar figure computed by arithmetic that
 * means nothing.
 *
 * `fetch` is INJECTED, never imported and never read off `globalThis`, so a unit
 * test cannot reach the network by construction.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ WHY THIS TAKES THREE REQUESTS WHERE THE VENDOR OFFERS ONE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * There is a one-shot endpoint — `run-sync-get-dataset-items` — and this file
 * deliberately does not use it. It POSTs the actor input, blocks, and returns the
 * dataset as a BARE JSON ARRAY. Two things are missing from that response and both
 * of them are load-bearing here:
 *
 *   1. THE RUN ID. `RunResult.runId` exists so a charge on an invoice can be
 *      reconciled to a call in our ledger. The sync response carries it in no
 *      documented field and no documented header, so under that path the field is
 *      permanently null and the reconciliation it exists for never happens. On a
 *      free source that would be a nice-to-have; on one billed per run it is the
 *      only way to answer "what did we pay for".
 *
 *   2. ★ THE RUN'S TERMINAL STATUS — AND THIS IS THE DECISIVE ONE. Whether a FAILED
 *      run answers non-2xx or an empty 200 array is NOT DOCUMENTED. I could not
 *      establish it and will not guess, and that ambiguity is intolerable in exactly
 *      this place: an empty array read as "this hashtag has no posts" is an outage
 *      rendered as a claim, on a paid source, which is the failure this whole
 *      rebuild exists to remove. Under the async path the run object carries an
 *      explicit status, so FAILED / TIMED-OUT / ABORTED become unavailability and
 *      SUCCEEDED-with-an-empty-dataset is the ONLY thing allowed to mean "nothing
 *      was found".
 *
 * The cost is three-plus HTTP requests per billed run. Requests are free here and
 * runs are not, so the trade is not close.
 *
 * `waitForFinish` does the waiting SERVER-SIDE — the vendor holds the connection
 * open for up to sixty seconds — which is why this file needs no timer, no sleep and
 * no clock. A poll loop with a client-side delay would have needed all three
 * injected to stay testable, and the deterministic version is simply better.
 *
 * ── ★ WHAT HAPPENS TO A RUN WE STOP WAITING FOR ───────────────────────────
 *
 * It keeps running, and it keeps billing. So the run is created with an explicit
 * `timeout`, which is the VENDOR stopping it rather than us hoping. Without it, a
 * wedged actor bills until somebody notices it in a dashboard, and nothing in our
 * ledger would ever mention it — the worst kind of cost, the kind that is invisible
 * from inside the system that caused it.
 *
 * ── THE PATH SPELLING ─────────────────────────────────────────────────────
 *
 * `/v2/actors/…`, not `/v2/acts/…`. The latter is a deprecated alias documented as
 * routing to the same handler; it works today and is the wrong thing to write into
 * a new integration.
 */

import { arr, rec, str, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';
/* The transport half of the kit, imported by its own path rather than through the
   barrel. Two vendors need these predicates and neither may own a private copy. */
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
 * Labels for errors and for the ledger. They carry NO host, no token and no actor
 * id, which is what makes them safe to put in an exception message that will end up
 * in a log somebody else reads.
 */
export const RUN_ENDPOINT = 'POST /v2/actors/{actorId}/runs';
export const RUN_STATUS_ENDPOINT = 'GET /v2/actor-runs/{runId}';
export const DATASET_ENDPOINT = 'GET /v2/datasets/{datasetId}/items';

/* ── the run lifecycle, as the vendor defines it ──────────────────────── */

/**
 * ★ THE FOUR TERMINAL STATUSES, AND THE FACT THAT ONLY ONE OF THEM MEANS "ASK THE
 * DATASET WHAT IT FOUND".
 *
 * The others are the reason this client uses the async path at all. A FAILED run and
 * a run that found nothing are the same empty dataset; only the status tells them
 * apart, and getting that wrong turns an outage into the claim "this hashtag is
 * quiet". Listed exhaustively rather than as "not RUNNING", so a status the vendor
 * adds later is treated as still-in-progress and eventually times out here, rather
 * than being silently accepted as a success.
 */
const TERMINAL = ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'] as const;
const SUCCEEDED = 'SUCCEEDED';

/** Seconds the vendor will hold one request open waiting for the run. Its own ceiling is 60. */
const DEFAULT_WAIT_FOR_FINISH_S = 60;

/**
 * How many times we re-ask after the initial blocking create. With the wait above,
 * the effective ceiling is (1 + this) minutes of waiting before we give up on a run.
 * A COUNT rather than a deadline, deliberately: a count needs no clock, so this whole
 * file stays deterministic and a test can exhaust the loop instantly.
 */
const DEFAULT_MAX_STATUS_POLLS = 4;

/**
 * What we tell the VENDOR to stop the run at. Slightly beyond our own waiting
 * ceiling, so that a run we are still waiting on is not killed underneath us, and a
 * run we have given up on is killed rather than left billing.
 */
const DEFAULT_RUN_TIMEOUT_S = 360;

/**
 * The most dataset items we will pull in one read.
 *
 * A ceiling rather than "everything", because a dataset is produced by a
 * third-party scraper whose size we do not control and a paid run that went wrong
 * can produce a very large one. Set far above any batch we ask for, so in practice
 * it never binds — and when it does bind it is reported, below, rather than silently
 * truncating.
 */
const DEFAULT_DATASET_LIMIT = 1000;

/* ── what a caller gets back ──────────────────────────────────────────── */

export interface RunResult {
  readonly items: readonly unknown[];
  /** The vendor's own run id, kept so a charge can be reconciled to a call. */
  readonly runId: string | null;
}

export interface TikTokClient {
  /** Hashtag / feed / account actor. No keyword search exists on this source. */
  runDiscovery(input: {
    readonly hashtags?: readonly string[];
    readonly accounts?: readonly string[];
    readonly resultsPerPage?: number;
  }): Promise<RunResult>;
  /** Re-read by URL, batched. The actor takes a list, not an id list. */
  runObserve(urls: readonly string[]): Promise<RunResult>;
}

export interface TikTokClientConfig {
  readonly token: string;
  readonly baseUrl: string;
  readonly discoveryActorId: string;
  readonly observeActorId: string;
  readonly fetch: typeof globalThis.fetch;
  /** Seconds the vendor holds one request open. Its documented ceiling is 60. */
  readonly waitForFinishSeconds?: number;
  /** Re-asks after the initial create before we give up. See the constant above. */
  readonly maxStatusPolls?: number;
  /** Handed to the vendor so it kills a wedged run rather than billing it forever. */
  readonly runTimeoutSeconds?: number;
  readonly datasetLimit?: number;
  /**
   * Optional wall-clock ceiling for one HTTP request. Note this bounds the REQUEST,
   * not the run: a run is bounded by `runTimeoutSeconds`, server-side, because that
   * is the only bound that also stops the meter running.
   */
  readonly timeoutMs?: number;
  /**
   * Called with every quota reading the vendor reports. OBSERVATION ONLY: this file
   * never waits, retries or paces on it. This vendor documents rate limits (60 req/s
   * per resource, 400 for actor runs) and a 429 with exponential-backoff guidance,
   * but publishes no remaining-quota headers, so most readings here are nulls — which
   * is the honest answer and not a zero.
   */
  readonly onQuota?: (reading: QuotaReading, endpoint: string) => void;
}

/**
 * Header names read opportunistically. Undocumented on this vendor; an absent one
 * yields null rather than a number, and nothing paces on the result.
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
 * Its own class so a caller failing closed can tell "we were never configured to
 * call this source" from "this source is down". They demand opposite responses: the
 * first is a person editing a file, the second is a retry.
 *
 * ★ AND THIS IS THE SOURCE WHERE IT MATTERS MOST, BECAUSE IT IS THE ONLY ONE WITH
 * THREE SECRETS. A token with no actor ids, or actor ids with no token, is somebody
 * who turned this on and got it wrong — which the credential reader already reports
 * as `misconfigured` rather than as dormant. This class covers the half of that
 * judgement the reader cannot make: whether the values somebody DID supply are
 * usable. The two live in different files on purpose and must not restate each
 * other; "is this present" is the reader's question and "is this well formed" is
 * this file's, because the second needs vendor knowledge and the first must never
 * be laxer than the constructor.
 */
export class TikTokNotConfigured extends Error {
  readonly variable: string;

  constructor(variable: string, note: string) {
    super(
      `tiktok adapter is not configured: ${variable} ${note}. ` +
        'This source needs THREE values, not one: APIFY_TOKEN, TIKTOK_DISCOVERY_ACTOR_ID and ' +
        'TIKTOK_OBSERVE_ACTOR_ID. None of them has a default — the token because a defaulted ' +
        'credential authenticates as somebody else, and the actor ids because a plausible wrong ' +
        'id constructs happily, runs, IS BILLED, and returns a dataset in a shape we cannot read. ' +
        'The token comes from the scraper platform console; the actor ids identify which ' +
        'third-party scraper we run and are written in the API form "username~actor-name" or as ' +
        'the bare generated id. TIKTOK_API_BASE is optional and defaults to the public host. ' +
        'Put the three secrets in .env.local, which is gitignored.',
    );
    this.name = 'TikTokNotConfigured';
    this.variable = variable;
  }
}

/* ── pure helpers, exported because they are worth testing without a socket ── */

const shapeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`);

/**
 * An actor id, as it may appear in a URL PATH.
 *
 * ★ THE FORM WITH A SLASH IS REFUSED, AND THAT IS THE WHOLE POINT OF THIS GATE. The
 * platform's console shows an actor as `username/actor-name`, and its API addresses
 * the same actor as `username~actor-name`. Pasting the console form into the
 * environment would produce a path with an extra segment in it — a request that is
 * valid, wrong, and answered with a 404 that reads like a retired actor. Worse, this
 * value is an ENVIRONMENT VARIABLE interpolated into a URL, which is the same class
 * of hole a caller-supplied community name opened on the other source: a stray `/`
 * or `?` does not fail, it silently changes WHICH request is made.
 */
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}(?:~[A-Za-z0-9][A-Za-z0-9_.-]{0,63})?$/;

export const isActorId = (value: string): boolean => ACTOR_ID.test(value);

/**
 * An id the VENDOR minted — a run id or a dataset id — as it may appear in a path.
 *
 * Gated for the same reason as the actor id and one more: these arrive in a response
 * body. A vendor string interpolated into the next request's path is the shortest
 * route there is from "the vendor was compromised or confused" to "we made a request
 * nobody wrote", and it costs one regular expression to close.
 */
const VENDOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What a handle or a post id may contain if we are going to splice it into a URL.
 *
 * ★ THIS IS THE MOST DANGEROUS STRING IN THE PACKAGE, because it is the only one that
 * is USER-WRITTEN. It arrives from our own store, where it was written from a scraper
 * payload, where it was written by whoever registered the account. A `/` or a `?` in
 * it does not fail — it silently changes WHICH request is made, and on the projection
 * side the same class of value once built a citation that opened cleanly and pointed
 * at somebody else's post.
 *
 * ★ AND IT IS RFC 3986'S UNRESERVED SET AND NOT THE PLATFORM'S USERNAME POLICY, ON
 * PURPOSE. The hazard here is what a URL does with a character, not what the platform
 * allows in a name — those are different questions and only the first one is ours.
 * Writing the username policy instead would make this rule STRICTER than the
 * projector's identical gate in `services/project/src/permalinks.ts`, and a second,
 * stricter copy of one predicate is worse than a shared one: the projector would pass
 * a handle its own rule accepts, this would throw, and a throw inside a projection
 * takes the whole frame down. Same hazard, same set, no drift.
 *
 * Refused rather than encoded, for the reason the other source's community check
 * gives: percent-encoding it would produce a request that is valid, wrong, and
 * answered in a way that reads as "this post is gone".
 *
 * DELIBERATELY NOT LENGTH-BOUNDED. Length is a resource question, not a routing one,
 * and it is bounded where it can actually cost something — `observe.ts`, which puts
 * these strings into an actor input we pay to run.
 */
const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

export const isPathSegment = (value: string): boolean => PATH_SEGMENT.test(value);

/**
 * The vendor addresses posts by URL; we hold ids. One place to convert.
 *
 * Throws rather than returning null so no caller can build a URL out of a value this
 * refused — the gate a future second caller cannot forget. `observe.ts` checks with
 * the predicate above and skips the id instead, which is the same treatment an absent
 * handle already gets: a post we cannot address is a post we do not read, and it is
 * absent from the result map rather than present with invented numbers.
 */
export const postUrl = (authorHandle: string, id: string): string => {
  if (!isPathSegment(authorHandle)) {
    throw new RangeError(`tiktok client: '${bounded(authorHandle, 64)}' cannot be a path segment`);
  }
  if (!isPathSegment(id)) {
    throw new RangeError(`tiktok client: '${bounded(id, 64)}' cannot be a path segment`);
  }
  return `https://www.tiktok.com/@${authorHandle}/video/${id}`;
};

/** A run, as much of it as we need, decoded from the vendor's `{ data: … }` envelope. */
export interface RunRecord {
  readonly id: string;
  readonly status: string;
  /** Absent until the run has one. Only read once the run has SUCCEEDED. */
  readonly datasetId: string | null;
}

export const isTerminal = (status: string): boolean => (TERMINAL as readonly string[]).includes(status);

/**
 * One run object, decoded.
 *
 * Exported because it is the shape half of this file and deserves a test that needs
 * no socket: an envelope arriving in the wrong shape is precisely the failure types
 * cannot catch, since `raw: unknown` proves nothing at runtime.
 *
 * ★ AN UNREADABLE STATUS IS A SHAPE ERROR, NEVER A DEFAULT. Defaulting it to
 * SUCCEEDED would report a failed run's empty dataset as an empty internet;
 * defaulting it to RUNNING would spend the poll budget and then report a timeout on
 * a run that finished. There is no safe guess, so there is no guess.
 */
export function decodeRun(body: unknown, endpoint: string): RunRecord {
  const data = rec(rec(body).data);

  const id = str(data.id);
  if (id === null || !VENDOR_ID.test(id)) {
    throw new VendorShapeError(
      VENDOR,
      'data.id',
      `is ${id === null ? shapeOf(data.id) : `'${bounded(id, 80)}'`}, expected a run id (from ${endpoint})`,
    );
  }

  const status = str(data.status);
  if (status === null) {
    throw new VendorShapeError(
      VENDOR,
      'data.status',
      `is ${shapeOf(data.status)}, expected a run status — without it a failed run and an empty ` +
        `one are the same answer (from ${endpoint})`,
    );
  }

  const datasetId = str(data.defaultDatasetId);
  if (datasetId !== null && !VENDOR_ID.test(datasetId)) {
    throw new VendorShapeError(
      VENDOR,
      'data.defaultDatasetId',
      `is '${bounded(datasetId, 80)}', which is not a dataset id we will put in a path (from ${endpoint})`,
    );
  }

  return { id, status: bounded(status, 32), datasetId };
}

/**
 * A dataset page, decoded from a BARE JSON ARRAY — this endpoint has no envelope.
 *
 * ★ AN EMPTY ARRAY IS ONLY EVER REACHED AFTER A SUCCEEDED STATUS, and that ordering
 * is the single most important thing in this file. Read in any other order, "the run
 * broke" and "the hashtag is quiet" are the same value.
 */
export function decodeDataset(body: unknown, endpoint: string): readonly unknown[] {
  if (!Array.isArray(body)) {
    throw new VendorShapeError(
      VENDOR,
      'dataset items',
      `is ${shapeOf(body)}, expected an array — this endpoint returns the items with no envelope ` +
        `(from ${endpoint})`,
    );
  }
  return arr(body);
}

/* ── the client ───────────────────────────────────────────────────────── */

interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

function requireToken(value: string): string {
  const problem = headerValueProblem(value);
  if (problem !== null) throw new TikTokNotConfigured('APIFY_TOKEN', problem);
  return value;
}

function requireActorId(value: string, variable: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TikTokNotConfigured(variable, 'is empty');
  if (trimmed.includes('/')) {
    throw new TikTokNotConfigured(
      variable,
      `is '${bounded(trimmed, 80)}', which is the console spelling of an actor — the API form ` +
        'replaces the slash with a tilde, as in "username~actor-name"',
    );
  }
  if (!isActorId(trimmed)) {
    throw new TikTokNotConfigured(
      variable,
      `is '${bounded(trimmed, 80)}', which is not an actor id (letters, digits, '_', '.', '-', ` +
        "and at most one '~')",
    );
  }
  return trimmed;
}

function requireBaseUrl(value: string): string {
  const problem = httpUrlProblem(value);
  if (problem !== null) throw new TikTokNotConfigured('TIKTOK_API_BASE', problem);
  return trimTrailingSlash(value);
}

export function httpClient(config: TikTokClientConfig): TikTokClient {
  /* ★ Validated HERE, at construction, and not on first use. This source is billed
     per run, so a client built from a half-filled .env that only fails when somebody
     calls it does not just produce an incident in the middle of a discovery pass — it
     can produce a BILLED one, because a wrong-but-well-formed actor id runs and is
     charged. This is also the constructor path the registry's try/catch exists to
     serve: until it could throw, this source could not reach the `misconfigured`
     verdict at all except through a half-filled environment. */
  const token = requireToken(config.token);
  const discoveryActorId = requireActorId(config.discoveryActorId, 'TIKTOK_DISCOVERY_ACTOR_ID');
  const observeActorId = requireActorId(config.observeActorId, 'TIKTOK_OBSERVE_ACTOR_ID');
  const baseUrl = requireBaseUrl(config.baseUrl);

  const waitForFinish = config.waitForFinishSeconds ?? DEFAULT_WAIT_FOR_FINISH_S;
  const maxStatusPolls = config.maxStatusPolls ?? DEFAULT_MAX_STATUS_POLLS;
  const runTimeout = config.runTimeoutSeconds ?? DEFAULT_RUN_TIMEOUT_S;
  const datasetLimit = config.datasetLimit ?? DEFAULT_DATASET_LIMIT;

  const requestInit = (init: RequestInit): RequestInit =>
    config.timeoutMs === undefined ? init : { ...init, signal: AbortSignal.timeout(config.timeoutMs) };

  /**
   * ★ THE PATH GATE. Every path below is assembled from a value that came from
   * outside this file — an environment variable, or a string in a vendor response.
   * A `/` or a `?` in one of those does not fail; it silently changes WHICH request
   * is made, which is the one class of bad input a URL builder must never pass
   * through. The segment predicates above are the first line and this is the second,
   * because a future caller will forget the first.
   */
  const urlFor = (path: string, query: Readonly<Record<string, string>>): string => {
    if (!/^\/[A-Za-z0-9/_.~-]*$/.test(path)) {
      throw new RangeError(`tiktok client: path '${bounded(path, 120)}' is not a safe request path`);
    }
    return `${baseUrl}${path}?${new URLSearchParams(query).toString()}`;
  };

  const send = async (url: string, init: RequestInit, endpoint: string): Promise<RawResponse> => {
    let response: Response;
    try {
      response = await config.fetch(
        url,
        requestInit({
          ...init,
          headers: {
            // The header form, never `?token=`: the vendor's own documentation calls
            // the query-parameter form less secure because "URLs are often stored in
            // browser history and server logs", and this one is a credential.
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
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
    // interesting reading is the one we are about to reject.
    config.onQuota?.(quota, endpoint);

    let text: string;
    try {
      // Always drained, even on a status we are about to reject. An unread body holds
      // its socket, and a client that leaks one per error leaks fastest during the
      // incident that is producing the errors.
      text = await response.text();
    } catch (error) {
      throw new VendorUnavailable(VENDOR, endpoint, `body could not be read: ${messageOf(error)}`, response.status);
    }

    return { status: response.status, headers: response.headers, text };
  };

  /**
   * A response turned into JSON, or into the right kind of failure.
   *
   * Every status below is a decision about what it MEANS on this vendor, and the rule
   * behind all of them is the product's: an outage is not a claim. None of these
   * paths may ever be turned into an empty dataset.
   */
  const json = async (endpoint: string, url: string, init: RequestInit): Promise<unknown> => {
    const response = await send(url, init, endpoint);

    if (response.status === 401) {
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        'rejected our token — check APIFY_TOKEN against the scraper platform console',
        401,
      );
    }

    if (response.status === 402 || response.status === 403) {
      /* ★ AN OUTAGE, NOT AN EMPTY RESULT, AND THE BODY IS NEVER PARSED FOR CONTENT.
         On a platform billed per run this is the shape an exhausted plan or a revoked
         token takes, and it is the most likely non-2xx this source will ever produce.
         Mapping it to "no posts" would report an unpaid invoice as a quiet internet,
         forever, with nothing to object to. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `refused the request (content-type ${response.headers.get('content-type') ?? 'absent'}): ` +
          `${snippet(response.text)}`,
        response.status,
      );
    }

    if (response.status === 404) {
      /* Every non-2xx INCLUDING 404. An actor id that was deprecated, a run that was
         purged, a dataset past its retention — all arrive here, and none of them is
         "this actor found nothing". A 404 on a run creation is the most likely single
         symptom of a wrong TIKTOK_*_ACTOR_ID, so the message says so. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        'responded 404 — no such actor, run or dataset (a retired or mistyped actor id looks ' +
          'exactly like this)',
        404,
      );
    }

    if (response.status === 429) {
      /* The rate limit, surfaced as an event rather than absorbed. This vendor
         documents exponential backoff starting at 500ms, and this client still does
         not implement it: pacing decided inside a client is pacing nobody above it
         can see or budget for. What the vendor said travels in the message, so a
         caller that WANTS to back off has the number. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `rate limited — ${quotaNote(quotaFrom(response.headers, QUOTA_HEADERS))}`,
        429,
      );
    }

    if (response.status === 408) {
      /* The documented answer when a synchronous run exceeds its window. We do not
         use the synchronous endpoint, so reaching this means an intermediary timed
         the request out — an outage either way, and never an empty run. */
      throw new VendorUnavailable(VENDOR, endpoint, 'timed out server-side before answering', 408);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new VendorUnavailable(VENDOR, endpoint, `responded ${response.status}`, response.status);
    }

    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      /* ★ 200 WITH A BODY THAT IS NOT JSON IS AN OUTAGE WEARING A SUCCESS CODE.
         Calling it a shape error would send the next person hunting a schema change;
         it is unavailability, with a snippet so the interstitial is recognisable. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `responded ${response.status} with a body that is not JSON ` +
          `(content-type ${response.headers.get('content-type') ?? 'absent'}): ${snippet(response.text)}`,
        response.status,
      );
    }
  };

  /**
   * Create the run, wait for it to reach a terminal state, then read its dataset.
   *
   * The only function in this file that costs money, and it costs the same whether it
   * returns a thousand items or none.
   */
  const runActor = async (actorId: string, input: unknown): Promise<RunResult> => {
    let run = decodeRun(
      await json(
        RUN_ENDPOINT,
        urlFor(`/v2/actors/${actorId}/runs`, {
          waitForFinish: String(waitForFinish),
          // The vendor stopping a wedged run, rather than us hoping it stops. See the
          // file header: a run we walk away from keeps billing.
          timeout: String(runTimeout),
        }),
        { method: 'POST', body: JSON.stringify(input) },
      ),
      RUN_ENDPOINT,
    );

    for (let polls = 0; !isTerminal(run.status); polls += 1) {
      if (polls >= maxStatusPolls) {
        /* ★ GIVING UP IS UNAVAILABILITY AND IS NEVER AN EMPTY RESULT. The run may yet
           succeed; we simply will not be here to read it. The run id is in the message
           because it is the only way to find the charge that this call is going to be
           billed for, and because the vendor's own timeout will end it shortly. */
        throw new VendorUnavailable(
          VENDOR,
          RUN_STATUS_ENDPOINT,
          `run ${run.id} was still ${run.status} after ${(1 + maxStatusPolls) * waitForFinish}s of ` +
            'waiting; the vendor will end it at its own timeout and it will still be billed',
          200,
        );
      }
      run = decodeRun(
        await json(
          RUN_STATUS_ENDPOINT,
          urlFor(`/v2/actor-runs/${run.id}`, { waitForFinish: String(waitForFinish) }),
          { method: 'GET' },
        ),
        RUN_STATUS_ENDPOINT,
      );
    }

    if (run.status !== SUCCEEDED) {
      /* ★ THE LINE THIS CLIENT'S WHOLE SHAPE EXISTS TO MAKE POSSIBLE. FAILED,
         TIMED-OUT and ABORTED all leave a dataset that is empty or partial, and under
         the one-shot endpoint they would have arrived as exactly that: an empty array,
         indistinguishable from a hashtag nobody posted under. Here they are an
         outage, and they say which one. */
      throw new VendorUnavailable(
        VENDOR,
        RUN_ENDPOINT,
        `run ${run.id} ended ${run.status}; its dataset is not a measurement of anything and is ` +
          'not read',
        200,
      );
    }

    if (run.datasetId === null) {
      throw new VendorShapeError(
        VENDOR,
        'data.defaultDatasetId',
        `is absent from a ${SUCCEEDED} run (run ${run.id}), so there is nothing to read it from`,
      );
    }

    const body = await json(
      DATASET_ENDPOINT,
      urlFor(`/v2/datasets/${run.datasetId}/items`, {
        // Strips the platform's own bookkeeping fields and empty records, so what
        // reaches `to-item.ts` is the actor's output and nothing else.
        clean: 'true',
        format: 'json',
        limit: String(datasetLimit),
      }),
      { method: 'GET' },
    );

    const items = decodeDataset(body, DATASET_ENDPOINT);
    return { items, runId: run.id };
  };

  return {
    runDiscovery: async (input) => runActor(discoveryActorId, input),
    runObserve: async (urls) => {
      if (urls.length === 0) {
        // A run of nothing still costs a run. Refusing is a caller bug with a stack
        // trace rather than a charge with no items to show for it.
        throw new RangeError('tiktok client: asked to observe no urls; a run of nothing is a caller bug');
      }
      return runActor(observeActorId, { postURLs: urls });
    },
  };
}
