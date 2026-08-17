/**
 * THE HTTP SURFACE, AND NOTHING ELSE — and unlike the two adapters before it,
 * this one actually makes the request.
 *
 * The other platform clients are signatures with `NotImplemented` bodies and a
 * comment describing the call. This source is free, so this is the file where
 * the shape stops being a promise. Everything above it stays deterministic and
 * testable with no network: `to-item.ts`, `discover.ts`, `observe.ts` and
 * `capabilities.ts` never see a `Response`, which is what lets the conformance
 * suite exercise the whole adapter with both methods below replaced by stubs
 * that throw.
 *
 * `fetch` is INJECTED. It is never imported and never read off `globalThis`,
 * for the same reason the clock is injected: a test that can reach the network
 * is a test that fails when the network does, and a source that can be reached
 * from a unit test eventually is.
 *
 * ── THE GRANT, AND WHY WE ARE NOT ASKING FOR A PASSWORD ───────────────────
 *
 * `client_credentials`. A "script" app is a CONFIDENTIAL client — it can keep a
 * secret — and the application-only client-credentials grant is exactly what
 * confidential clients are given. It needs the app id and the app secret and
 * NOTHING ELSE. The reference client's own authoriser proves it: its read-only
 * authoriser requests `grant_type=client_credentials` against a trusted
 * authenticator whose auth pair is `(client_id, client_secret)`; the
 * `grant_type=password` path is a DIFFERENT authoriser that we do not use.
 *
 * The caveat, stated so nobody trips on it later: an application-only token is
 * associated with no account, so account-scoped endpoints (voting, saving,
 * subscriptions, moderation) will not work under it. Public listings, search
 * and the batch lookup are all logged-out-visible and do work. We need none of
 * the former.
 *
 * ── THE PATH THAT MUST NOT EXIST ──────────────────────────────────────────
 *
 * ★ There is no unauthenticated fallback in this file and there must never be
 * one. Appending `.json` to a public URL used to return JSON without a token;
 * it now returns HTTP 403 with an HTML body, and the authenticated host answers
 * the same way without a bearer token. A client that "degrades gracefully" to
 * that path is a client that parses an error page and reports whatever it finds
 * as data — which is how a source starts lying while every dashboard stays
 * green. A 403 here is an outage, it is reported as one, and its body is never
 * looked at for content.
 */

import { Buffer } from 'node:buffer';

import type { Millis } from '@insidor/contracts';
import { arr, rec, str, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

import { VENDOR } from './capabilities.ts';

/* ── endpoint labels ──────────────────────────────────────────────────── */

/**
 * Labels for errors and for the ledger. They carry NO host and no credential,
 * which is what makes them safe to put in an exception message that will end up
 * in a log somebody else reads.
 */
export const TOKEN_ENDPOINT = 'POST /api/v1/access_token';
export const LISTING_ENDPOINT = 'GET /{listing}';
export const INFO_ENDPOINT = 'GET /api/info';

/** The one call that does NOT go to the authenticated host. */
export const DEFAULT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
/** Everything else does. A bearer token sent to the public host is ignored. */
export const DEFAULT_BASE_URL = 'https://oauth.reddit.com';

/**
 * The prefix this source gives a link — as opposed to a comment, an account or
 * a community. Every id this adapter handles is a link, and that assumption is
 * asserted rather than assumed: a listing child of any other kind is dropped
 * below rather than translated into a post it is not.
 */
export const LINK_KIND = 't3';

/** A fullname: the kind prefix, an underscore, and a base-36 id. */
const FULLNAME = /^t3_[0-9a-z]+$/i;

/**
 * ★ ONE DEFINITION OF "IS THIS AN ID WE MINTED", AND TWO CALLERS.
 *
 * `info` below needs it because a comma inside an id would split one lookup into
 * two. `to-item.ts` needs it because the same string ends up in a storage key, in
 * an item id and — through `sourceItemId` — in a citation URL, and NONE of those
 * places can defend itself against a string it is handed. Two spellings of this
 * rule would drift, and the direction they would drift in is the one where the
 * batch lookup is stricter than the thing that mints the ids it is asked for.
 */
export const isFullname = (value: string): boolean => FULLNAME.test(value);

/** The bare id inside a fullname: base 36, and nothing that can address a path. */
export const isBareId = (value: string): boolean => /^[0-9a-z]+$/i.test(value);

/**
 * The batch lookup's own ceiling. Exceeding it is a caller bug and throws
 * rather than truncating — a silently dropped id reads downstream as a post
 * that returned nothing, which is a plausible, wrong, unnoticeable answer.
 */
export const MAX_FULLNAMES_PER_CALL = 100;

/* ── what a caller gets back ──────────────────────────────────────────── */

/**
 * The three quota headers this vendor puts on every authenticated response.
 *
 * ★ THESE ARE BETTER THAN THE PUBLISHED CONSTANT AND THEY ARE THE REASON THIS
 * TYPE EXISTS. A hardcoded requests-per-minute figure is a guess that goes
 * stale in silence; these are measured, by the party doing the rationing.
 * Reading them is observation. Acting on them inside this file would be pacing,
 * which this file does not do — see the header of `capabilities.ts`.
 */
export interface QuotaReading {
  /** Requests consumed in the current window. */
  readonly used: number | null;
  /** Requests left in it. This is the one that matters. */
  readonly remaining: number | null;
  /** Seconds until the window rolls over. */
  readonly resetSeconds: number | null;
}

export interface ListingPage {
  /** The post payloads, unwrapped from their listing envelopes. */
  readonly items: readonly unknown[];
  /**
   * The vendor's own pagination token, or null. Null means "there is no way to
   * ask for more", which is not the same as "there is no more" — but on this
   * vendor it is also the way it says the latter, so `hasMore` is derived from
   * exactly this field and from nothing about how full the page looked.
   */
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/**
 * One request, already rendered. The client does not know what a discovery mode
 * is; `discover.ts` turns a query into this and the client turns this into HTTP.
 * That split is what keeps query rendering unit-testable with no network.
 */
export interface ListingRequest {
  /** An absolute path on the authenticated host, e.g. `/r/solana/new`. */
  readonly path: string;
  /** Already-decided parameters. `raw_json` is added here, not by the caller. */
  readonly query: Readonly<Record<string, string>>;
}

export interface RedditClient {
  /** One page of a listing or a search. Paged by the vendor's own token. */
  listing(request: ListingRequest): Promise<ListingPage>;
  /** Re-read by fullname, up to `capabilities.observeBatchSize` per call. */
  info(fullnames: readonly string[]): Promise<readonly unknown[]>;
}

export interface RedditClientConfig {
  /** REDDIT_CLIENT_ID — the short string under the app name. */
  readonly clientId: string;
  /** REDDIT_CLIENT_SECRET — treat as a password; it authorises as the app. */
  readonly clientSecret: string;
  /** REDDIT_USER_AGENT — see `requireUserAgent`; a bad one gets us banned. */
  readonly userAgent: string;
  /** Injected so the conformance suite and every unit test stay offline. */
  readonly fetch: typeof globalThis.fetch;
  /**
   * Injected for the same reason the adapter's is: token expiry is the only
   * thing in this package that needs a clock, and a test that cannot move time
   * cannot check that a token is refreshed BEFORE it expires rather than after.
   */
  readonly now: () => Millis;
  readonly tokenUrl?: string;
  readonly baseUrl?: string;
  /**
   * Optional wall-clock ceiling for one request. Optional because a deadline is
   * a policy and policies belong to the caller; a hung socket in a polling loop
   * is indistinguishable from a slow vendor, which is why it is offered at all.
   */
  readonly timeoutMs?: number;
  /**
   * Refresh this long before the token actually expires. A token that expires
   * in flight costs a 401, a refresh and a retry — three requests against a
   * quota rationed by request — so the margin is cheaper than the edge case.
   */
  readonly refreshMarginMs?: number;
  /**
   * Called with every quota reading the vendor reports. Observation only: this
   * file never waits, retries or paces on it. Wired by whoever constructs the
   * client, so the reading is visible to something that can actually budget.
   */
  readonly onQuota?: (reading: QuotaReading, endpoint: string) => void;
}

/** Sixty seconds. Ample against a token that lives an hour. */
const DEFAULT_REFRESH_MARGIN_MS = 60_000;

/* ── configuration errors ─────────────────────────────────────────────── */

/**
 * ★ A MISSING CREDENTIAL IS NOT A VENDOR FAILURE AND MUST NOT ARRIVE AS ONE.
 *
 * It is its own class so that a caller failing closed can tell "we were never
 * configured to call this source" from "this source is down". They demand
 * opposite responses: the first is a person editing a file, the second is a
 * retry. Collapsing them is how a permanently unconfigured source spends weeks
 * looking like an intermittently flaky one.
 */
export class RedditNotConfigured extends Error {
  readonly variable: string;

  constructor(variable: string, note: string) {
    super(
      `reddit adapter is not configured: ${variable} ${note}. ` +
        'All three of REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and REDDIT_USER_AGENT are ' +
        'required. Create a "script" app at https://www.reddit.com/prefs/apps (type must ' +
        'be "script", redirect uri http://localhost); the client id is the short string ' +
        'under the app name and the secret is labelled. Put them in .env.local, which is ' +
        'gitignored. The user agent must name a contactable account, in the vendor\'s own ' +
        'recommended shape: "script:com.insidor.adapter:v0.1.0 (by /u/<your-username>)".',
    );
    this.name = 'RedditNotConfigured';
    this.variable = variable;
  }
}

/**
 * User agents this vendor's own documentation singles out. Its rule is quoted
 * and unambiguous — "NEVER lie about your user-agent. This includes spoofing
 * popular browsers and spoofing other bots. We will ban liars with extreme
 * prejudice" — and it separately throttles default library strings harder than
 * unique ones. So a spoof or a library default is rejected HERE, at
 * construction, rather than discovered later as an unexplained ban.
 */
const DISHONEST_AGENT = /mozilla|chrome|safari|firefox|edge\/|googlebot|bingbot|python|java|curl|wget|okhttp|node-fetch|axios|libwww|urllib/i;

/** The exact string shipped in `.env.example`. Present means nobody edited it. */
const PLACEHOLDER = /your_reddit_username/i;

function requireCredential(value: string, variable: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RedditNotConfigured(variable, 'is empty');
  return trimmed;
}

/**
 * ★ THE USER AGENT IS A CREDENTIAL HERE, NOT A COURTESY.
 *
 * This vendor rations by client id AND by agent string, and a generic or
 * dishonest one lands in a shared, much smaller bucket — or gets the app
 * banned. The check is at construction because the alternative is discovering
 * it as a 429 storm in production, at which point the interesting question
 * ("why are we suddenly rate limited?") has a boring answer nobody looks for.
 *
 * A `/u/<name>` contact is required rather than merely recommended: an agent
 * with no contactable owner is not identification, it is a label, and the whole
 * reason the vendor tolerates a free client is that it can find whoever is
 * running it.
 */
function requireUserAgent(value: string): string {
  const agent = requireCredential(value, 'REDDIT_USER_AGENT');
  if (PLACEHOLDER.test(agent)) {
    throw new RedditNotConfigured('REDDIT_USER_AGENT', 'is still the placeholder from .env.example');
  }
  if (DISHONEST_AGENT.test(agent)) {
    throw new RedditNotConfigured(
      'REDDIT_USER_AGENT',
      'names a browser or a generic HTTP library, which this vendor treats as spoofing',
    );
  }
  if (!/\/u\/[A-Za-z0-9_-]{3,}/.test(agent)) {
    throw new RedditNotConfigured(
      'REDDIT_USER_AGENT',
      'names no contactable account (it must contain "/u/<your-username>")',
    );
  }
  return agent;
}

/* ── pure helpers, exported because they are worth testing without a socket ── */

/**
 * The one spelling of a number we will accept from a header. Anchored, decimal,
 * optionally signed. Deliberately narrower than `Number`, for the reason below.
 */
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Header names are case-insensitive; `Headers.get` already handles that.
 *
 * ★ `Number('')` IS 0, AND THAT IS THE BUG THIS FUNCTION EXISTS NOT TO HAVE.
 *
 * A header that is PRESENT AND BLANK — which is what an edge emits when it
 * rewrites a response it did not generate — went through `Number` and came back
 * `0`, so `remaining: 0` was reported as a measured fact: "this client has no
 * requests left". That is a fabricated measurement, in the one package whose
 * entire argument is that we do not fabricate them, and it is the same shape as
 * the `reach: 0` that `capabilities.ts` spends thirty lines refusing. Whoever
 * eventually paces on this reading would stop dead on a source that was fine.
 * `Number` is equally happy to read `'0x10'` as 16 and `'1e3'` as 1000, neither
 * of which is a spelling this vendor uses, so a match against the ONE spelling
 * it does use is both the fix and the tighter contract.
 *
 * Null means "we do not have a reading", which is a different fact from every
 * number including zero, and the caller already treats it as one.
 */
export function parseQuota(headers: Headers): QuotaReading {
  const read = (name: string): number | null => {
    const raw = headers.get(name);
    if (raw === null) return null;
    const trimmed = raw.trim();
    // The vendor sends these as decimals ("97.0"). Anything else means the
    // header is not what we think it is, and a guess about the remaining quota
    // is worse than knowing we do not have one.
    if (!DECIMAL.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };
  return {
    used: read('x-ratelimit-used'),
    remaining: read('x-ratelimit-remaining'),
    resetSeconds: read('x-ratelimit-reset'),
  };
}

const quotaNote = (quota: QuotaReading): string =>
  `quota used ${quota.used ?? 'unknown'}, remaining ${quota.remaining ?? 'unknown'}, ` +
  `resets in ${quota.resetSeconds ?? 'unknown'}s`;

/**
 * Turns one listing envelope into the post payloads inside it.
 *
 * Exported because it is the shape half of this file and deserves a test that
 * needs no socket: an envelope arriving in the wrong shape is precisely the
 * failure that types cannot catch, since `raw: unknown` proves nothing at
 * runtime.
 */
export function decodeListing(body: unknown, endpoint: string): ListingPage {
  const envelope = rec(body);
  if (str(envelope.kind) !== 'Listing') {
    throw new VendorShapeError(
      VENDOR,
      'kind',
      `is ${JSON.stringify(envelope.kind)}, expected "Listing" (from ${endpoint})`,
    );
  }
  const data = rec(envelope.data);
  if (!Array.isArray(data.children)) {
    throw new VendorShapeError(
      VENDOR,
      'data.children',
      `is ${shapeOf(data.children)}, expected an array (from ${endpoint})`,
    );
  }

  const items: unknown[] = [];
  for (const child of arr(data.children)) {
    const wrapper = rec(child);
    // ★ Only links. A comment or an account in a listing we asked for posts
    // from is not a post, and translating one would mint an item id with a
    // comment's base-36 in it — an id that looks exactly like a post id and
    // resolves to nothing. Dropping is correct rather than lossy: this adapter
    // only ever asks for links.
    if (str(wrapper.kind) !== LINK_KIND) continue;
    const payload = wrapper.data;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue;
    items.push(payload);
  }

  // `after` is the vendor SAYING there is another page. `hasMore` is derived
  // from it alone and never from `items.length === limit`, which is a guess
  // that either loops forever or stops a page early — and both look like
  // working code.
  const after = str(data.after);
  return { items, cursor: after, hasMore: after !== null };
}

const shapeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const snippet = (text: string): string =>
  text.length <= 160 ? JSON.stringify(text) : `${JSON.stringify(text.slice(0, 160))}…`;

/* ── the client ───────────────────────────────────────────────────────── */

interface CachedToken {
  readonly value: string;
  readonly expiresAt: Millis;
  /**
   * When we stop using it — `expiresAt` less the margin, CLAMPED so the margin
   * can never swallow the whole lifetime. See `refreshAtFor`.
   */
  readonly refreshAt: Millis;
}

/**
 * ★ A MARGIN WIDER THAN THE LIFETIME MEANS A TOKEN REQUEST ON EVERY CALL.
 *
 * The cache test is `now < expiresAt - margin`. If the vendor hands back a token
 * that lives 45 seconds and the margin is 60, that test is false the instant the
 * token is minted — so every read buys its own token and the client silently
 * spends TWICE the quota, on the one budget that actually binds on a free
 * source. Nothing errors, nothing looks wrong, and the ledger shows twice as
 * many token rows as listing rows, which is exactly the "refresh loop hiding"
 * that the price book's separate token key was created to expose.
 *
 * This is not a hypothetical reach: the ★ on `expires_in` below refuses to
 * hardcode 3600 precisely BECAUSE this vendor's application-only lifetimes have
 * disagreed with its documentation. A client that reads the lifetime honestly
 * and then ignores its magnitude has only moved the assumption.
 *
 * So the margin is a preference, not a promise: never more than half the token's
 * actual life. Half rather than "the lifetime minus a second" because the margin
 * is there to cover a whole request's flight time plus clock skew, and a token
 * used into its last instant is the 401-refresh-retry round trip the margin
 * exists to avoid.
 */
export function refreshAtFor(requestedAt: Millis, lifetimeMs: number, marginMs: number): Millis {
  return requestedAt + lifetimeMs - Math.min(Math.max(marginMs, 0), Math.floor(lifetimeMs / 2));
}

interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

export function httpClient(config: RedditClientConfig): RedditClient {
  /* ★ Validated HERE, at construction, and not on first use. A client built
     from a half-filled .env that only fails when someone finally calls it turns
     a one-line configuration mistake into an incident with a stack trace in the
     middle of a discovery run. The three names in the error are the three names
     in the file the reader has to edit. */
  const clientId = requireCredential(config.clientId, 'REDDIT_CLIENT_ID');
  const clientSecret = requireCredential(config.clientSecret, 'REDDIT_CLIENT_SECRET');
  const userAgent = requireUserAgent(config.userAgent);

  const tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL;
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const refreshMarginMs = config.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;

  /* HTTP Basic, which is the mechanism this vendor's token endpoint advertises
     in its own `WWW-Authenticate` header. Computed once: it is a constant, and
     recomputing it per call would put the secret through a base64 encoder on
     every request for no reason. */
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;

  let token: CachedToken | null = null;
  let pending: Promise<string> | null = null;
  /* Bumped by a forced refresh. An in-flight token request that started BEFORE
     the force must not be allowed to write its now-known-stale answer into the
     cache after the fresh one lands — a rare race whose symptom is an
     inexplicable second 401. */
  let generation = 0;

  const requestInit = (init: RequestInit): RequestInit =>
    config.timeoutMs === undefined ? init : { ...init, signal: AbortSignal.timeout(config.timeoutMs) };

  const send = async (url: string, init: RequestInit, endpoint: string): Promise<RawResponse> => {
    let response: Response;
    try {
      response = await config.fetch(url, requestInit(init));
    } catch (error) {
      // No status: DNS, socket, or the abort above. Deliberately NOT the same
      // error as "the vendor said no" — a caller failing closed has to be able
      // to tell an outage from an answer it did not like.
      throw new VendorUnavailable(VENDOR, endpoint, `request failed: ${messageOf(error)}`);
    }

    const quota = parseQuota(response.headers);
    // Reported before anything can throw, because the response that carries the
    // most interesting quota reading is the 429.
    config.onQuota?.(quota, endpoint);

    let text: string;
    try {
      // Always drained, even on a status we are about to reject. An unread body
      // holds its socket, and a client that leaks one per error leaks fastest
      // during the incident that is producing the errors.
      text = await response.text();
    } catch (error) {
      throw new VendorUnavailable(VENDOR, endpoint, `body could not be read: ${messageOf(error)}`, response.status);
    }

    return { status: response.status, headers: response.headers, text };
  };

  /* ── the token ──────────────────────────────────────────────────────── */

  const requestToken = async (): Promise<CachedToken> => {
    const mine = generation;
    const requestedAt = config.now();

    const response = await send(
      tokenUrl,
      {
        method: 'POST',
        headers: {
          authorization: basic,
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': userAgent,
          accept: 'application/json',
        },
        // The application-only grant. No username, no password, and none is
        // asked for anywhere in this package.
        body: 'grant_type=client_credentials',
      },
      TOKEN_ENDPOINT,
    );

    if (response.status === 401) {
      // Not transient and not worth retrying: the id/secret pair was rejected.
      // Reported as unavailability with the status attached so the distinction
      // survives into a log, and deliberately WITHOUT the body, which echoes
      // nothing useful and could echo something we sent.
      throw new VendorUnavailable(
        VENDOR,
        TOKEN_ENDPOINT,
        'credentials rejected — check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET against the app at /prefs/apps',
        401,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new VendorUnavailable(VENDOR, TOKEN_ENDPOINT, `responded ${response.status}`, response.status);
    }

    let body: unknown;
    try {
      body = JSON.parse(response.text) as unknown;
    } catch {
      throw new VendorUnavailable(
        VENDOR,
        TOKEN_ENDPOINT,
        `responded ${response.status} with a body that is not JSON ` +
          `(content-type ${response.headers.get('content-type') ?? 'absent'}): ${snippet(response.text)}`,
        response.status,
      );
    }

    const payload = rec(body);
    const value = str(payload.access_token);
    if (value === null) {
      throw new VendorShapeError(VENDOR, 'access_token', 'is absent from a 2xx token response');
    }

    /* ★ THE LIFETIME COMES FROM THE RESPONSE, NEVER FROM A CONSTANT. The docs
       say one hour and application-only tokens have not always agreed. A
       hardcoded 3600 fails in the one direction that is invisible: it keeps
       sending a token the vendor has already retired, every call 401s, and the
       adapter looks like a permissions problem rather than a clock problem. An
       absent `expires_in` is a schema change and is raised as one — guessing
       here would restore exactly the failure the previous sentence describes. */
    const lifetime = payload.expires_in;
    if (typeof lifetime !== 'number' || !Number.isFinite(lifetime) || lifetime <= 0) {
      throw new VendorShapeError(
        VENDOR,
        'expires_in',
        `is ${JSON.stringify(lifetime)}, expected a positive number of seconds`,
      );
    }

    const lifetimeMs = lifetime * 1000;
    const fresh: CachedToken = {
      value,
      expiresAt: requestedAt + lifetimeMs,
      refreshAt: refreshAtFor(requestedAt, lifetimeMs, refreshMarginMs),
    };
    if (mine === generation) token = fresh;
    return fresh;
  };

  const ensureToken = async (force: boolean): Promise<string> => {
    if (force) {
      generation += 1;
      token = null;
      pending = null;
    } else {
      const cached = token;
      // Refreshed BEFORE expiry, not after: a token that dies mid-call costs a
      // 401, a token request and a retry, which is three units of the quota
      // that is actually scarce here. `refreshAt` and not `expiresAt - margin`
      // so that a short-lived token is still CACHED — see `refreshAtFor`.
      if (cached !== null && config.now() < cached.refreshAt) return cached.value;
      // Single-flight. Two concurrent reads must not each buy a token: the
      // second is pure quota burn, and this vendor invalidates nothing, so the
      // loser's token is simply wasted.
      if (pending !== null) return pending;
    }

    const inFlight = requestToken()
      .then((fresh) => fresh.value)
      .finally(() => {
        if (pending === inFlight) pending = null;
      });
    pending = inFlight;
    return inFlight;
  };

  /* ── an authenticated read ──────────────────────────────────────────── */

  const authedJson = async (endpoint: string, url: string): Promise<unknown> => {
    const attempt = async (bearer: string): Promise<RawResponse> =>
      send(
        url,
        {
          method: 'GET',
          headers: { authorization: `bearer ${bearer}`, 'user-agent': userAgent, accept: 'application/json' },
        },
        endpoint,
      );

    let response = await attempt(await ensureToken(false));

    if (response.status === 401) {
      /* ★ EXACTLY ONE RETRY, AND ONLY ON A 401. The token expired between our
         margin and this request — a clock skew, a long-running batch, a token
         retired early. Retrying anything else, or retrying twice, turns a
         vendor saying no into a loop that says it louder: the second 401 means
         the credentials are wrong rather than stale, and hammering a rejected
         credential is how an app gets blocked rather than throttled. Note the
         cost is honest and visible: the retry is a real extra request against
         the quota, which is why the refresh margin above exists to make this
         path rare. */
      response = await attempt(await ensureToken(true));
      if (response.status === 401) {
        throw new VendorUnavailable(
          VENDOR,
          endpoint,
          'rejected our bearer token twice, the second time with a token minted seconds earlier',
          401,
        );
      }
    }

    if (response.status === 429) {
      /* The rate limit, surfaced as an event rather than absorbed. The vendor's
         own headers go in the message because they are the measured answer to
         "how long until this works again" and the published requests-per-minute
         constant is not.

         ★ `retry-after` IS REPORTED SEPARATELY BECAUSE IT IS AN INSTRUCTION AND
         THE OTHERS ARE OBSERVATIONS. The quota trio describes the window; this
         one is the party doing the rationing telling us when to come back. This
         client still does not wait on it — pacing decided inside a client is
         pacing nobody above it can see or budget for, which is the argument in
         capabilities.ts — but a caller that WANTS to back off cannot, if the
         only place the number appeared was a response we discarded. On a free
         tier there is no support queue to appeal a block to, so the cheapest
         possible thing is to make the number reachable. */
      const retryAfter = str(response.headers.get('retry-after'));
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `rate limited — ${quotaNote(parseQuota(response.headers))}` +
          (retryAfter === null ? '' : `, vendor says retry after ${retryAfter}`),
        429,
      );
    }

    if (response.status === 403) {
      /* ★ 403 IS AN OUTAGE HERE, NOT AN EMPTY RESULT, AND ITS BODY IS NEVER
         PARSED. This is the exact shape an unauthenticated or blocked read
         takes on this vendor: a 403 carrying an HTML page. Mapping it to "no
         posts" would report a blocked client as a quiet community, forever,
         with nothing to object to. Enough of the body is attached to recognise
         the page on sight and no attempt is made to read anything out of it. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `refused the request (content-type ${response.headers.get('content-type') ?? 'absent'}): ` +
          `${snippet(response.text)}`,
        403,
      );
    }

    if (response.status === 404) {
      /* Every non-2xx INCLUDING 404. A community that does not exist, a
         community that has gone private, and a path that moved all arrive here,
         and none of them is "this community published nothing". */
      throw new VendorUnavailable(VENDOR, endpoint, 'responded 404 — no such listing, or it is not visible to us', 404);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new VendorUnavailable(VENDOR, endpoint, `responded ${response.status}`, response.status);
    }

    try {
      return JSON.parse(response.text) as unknown;
    } catch {
      /* ★ 200 WITH A BODY THAT IS NOT JSON IS AN OUTAGE WEARING A SUCCESS CODE.
         This host sits behind an edge that serves HTML interstitials, and the
         public `.json` path this adapter refuses to use returns exactly that.
         Calling it a shape error would send the next person hunting a schema
         change; it is unavailability, with a snippet so the page is
         recognisable. */
      throw new VendorUnavailable(
        VENDOR,
        endpoint,
        `responded ${response.status} with a body that is not JSON ` +
          `(content-type ${response.headers.get('content-type') ?? 'absent'}): ${snippet(response.text)}`,
        response.status,
      );
    }
  };

  /* ── URL assembly ───────────────────────────────────────────────────── */

  /**
   * ★ `raw_json=1` ON EVERY CALL, AND IT IS NOT COSMETIC. Without it this
   * vendor HTML-escapes `&`, `<` and `>` inside every text field, so the text
   * we shingle is `&amp;` where the author wrote `&`. The shingles still
   * compute, still store and still look fine — and silently fail to match the
   * same sentence carried by any other source, which is the cheapest evidence
   * the grouper has.
   */
  const urlFor = (path: string, query: Readonly<Record<string, string>>): string => {
    if (!/^\/[A-Za-z0-9/_.-]*$/.test(path)) {
      // A path is assembled from a caller-supplied community or account name.
      // A '?' or a '/' in the wrong place does not fail — it silently changes
      // WHICH request is made, which is the one class of bad input a URL
      // builder must never pass through. `discover.ts` validates too; this is
      // the gate that a future second caller cannot forget.
      throw new RangeError(`reddit client: path '${path}' is not a safe listing path`);
    }
    const params = new URLSearchParams(query);
    params.set('raw_json', '1');
    return `${baseUrl}${path}?${params.toString()}`;
  };

  return {
    listing: async (request) => {
      const body = await authedJson(LISTING_ENDPOINT, urlFor(request.path, request.query));
      return decodeListing(body, LISTING_ENDPOINT);
    },

    info: async (fullnames) => {
      if (fullnames.length === 0) {
        throw new RangeError('reddit client: asked to look up no ids; a batch of nothing is a caller bug');
      }
      if (fullnames.length > MAX_FULLNAMES_PER_CALL) {
        throw new RangeError(
          `reddit client: ${fullnames.length} ids exceeds the ${MAX_FULLNAMES_PER_CALL} this endpoint accepts`,
        );
      }
      for (const name of fullnames) {
        // The batch separator is a comma, so an id containing one would become
        // two ids and shift every result after it. Rejected rather than
        // encoded: an id that is not a fullname is not a post we know about.
        if (!isFullname(name)) {
          throw new RangeError(`reddit client: '${name}' is not a ${LINK_KIND} fullname`);
        }
      }

      const body = await authedJson(INFO_ENDPOINT, urlFor('/api/info', { id: fullnames.join(',') }));
      // ★ Ids that come back with no payload are simply NOT IN THIS ARRAY. That
      // absence is preserved all the way up: `observe.ts` omits them from the
      // map rather than mapping them to zeros, because a removed post and an
      // unread post are different facts.
      return decodeListing(body, INFO_ENDPOINT).items;
    },
  };
}
