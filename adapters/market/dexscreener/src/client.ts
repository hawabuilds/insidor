/**
 * One endpoint, on purpose.
 *
 * There is a symbol-search endpoint on this vendor and it is deliberately not
 * wrapped. Two reasons, both measured:
 *
 *   - It rate-limits at around eleven sequential calls, and the code that used
 *     it ran a 250 ms delay — 240 requests a minute, straight into the ceiling.
 *   - Symbol is not a retrieval key. A search for one meme's symbol returns
 *     hundreds of tokens, and the harmful answer is not the absurd one but the
 *     plausible survivor: an established coin with a matching ticker that looks
 *     like a perfectly reasonable match and is not.
 *
 * Candidate generation is time-first and lives in a query over our own asset
 * table. Symbol is a scoring channel over that set. If a `searchBySymbol`
 * method ever appears in this file, the old bug has come back.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS RESPONSIBLE FOR, AND WHAT IT IS NOT
 *
 * HTTP, JSON, and the two decisions a caller cannot make for itself: which
 * chain slugs this vendor may be asked about, and which pairs in the answer are
 * actually about the token we asked for. Everything else — how to read a price,
 * which pair to price from, absent vs zero — lives in `to-market-state.ts`,
 * which is pure and needs no network. That line is what lets the conformance
 * suite exercise the whole adapter with this file replaced by a stub that
 * throws.
 *
 * It does NOT meter. Metering wraps this file from `index.ts`, through
 * `metered()`, which records a `flat`/`units: 1`/`usd: 0` row on both the
 * success and the failure path. That is the honest shape for a free call: the
 * call HAPPENED and the ledger says so at a price of zero. `freeSpend` — the
 * `units: 0` row used by the replay platform — would say no vendor was
 * contacted at all, which would make the budget that actually binds here (the
 * rate limit) invisible in the one ledger that has to stay factual.
 */

import { rec, str, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

export interface MarketClient {
  /** All pairs for one token address. The only read this vendor is used for. */
  pairsForToken(chain: string, address: string): Promise<unknown>;
  /** Up to 30 addresses per call — the batching that keeps us under the limit. */
  pairsForTokens(chain: string, addresses: readonly string[]): Promise<unknown>;
}

export interface MarketClientConfig {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  /**
   * Optional wall-clock ceiling for one request, as an AbortSignal.
   *
   * Optional because a deadline is a policy and policies belong to the caller;
   * when it is absent this file imposes none and the injected `fetch` owns the
   * deadline. It is offered at all because a hung socket in a polling loop is
   * indistinguishable from a slow vendor, and a loop that never returns stops
   * reading every other coin too.
   */
  readonly timeoutMs?: number;
}

/** Opaque vendor token. Internal: it names who we paid, and never reaches a payload. */
export const VENDOR = 'dexscreener';

/**
 * The only chain slug this adapter may be asked about.
 *
 * ★ Checked LOUDLY, and the reason is measured: this vendor answers HTTP 200
 * with `[]` for a chain slug it has never heard of — `GET /tokens/v1/notachain/…`
 * returns an empty array, not an error. So a typo, or a second chain arriving
 * before anyone has thought about it, would read as "no pair exists for this
 * token" for every token, forever, silently. That is `no_market` on the board
 * for a whole chain, and nothing in the system would ever raise its hand.
 * An absent reading must stay absent, but a question we never actually asked is
 * not an absent reading — it is a bug, and it throws.
 */
export const CHAIN_SLUG = 'solana';

export const MAX_ADDRESSES_PER_CALL = 30;

/**
 * The published ceiling for the token endpoints, requests per minute.
 *
 * Recorded here as a documented ASSUMPTION rather than enforced: this file
 * neither retries, caches, nor paces, for the same reason the meter does not —
 * those change what the vendor is asked, and pacing decided inside a client is
 * pacing nobody above it can see or budget for. Two numbers disagree and the
 * smaller one is the one to believe: the vendor documents 300/min, and this
 * repo has measured throttling after about eleven sequential calls. A caller
 * that treats "free" as a licence to loop will find the second number first.
 */
export const RATE_LIMIT_PER_MIN = 300;

/** Endpoint labels. They carry no host, so they are safe to put in an error. */
export const PAIRS_ENDPOINT = 'GET /token-pairs/v1/{chain}/{address}';
export const TOKENS_ENDPOINT = 'GET /tokens/v1/{chain}/{addresses}';

export function httpClient(config: MarketClientConfig): MarketClient {
  return {
    pairsForToken: async (chain, address) => {
      requireChain(chain, PAIRS_ENDPOINT);
      requireAddress(address, PAIRS_ENDPOINT);

      const pairs = await getPairs(
        config,
        PAIRS_ENDPOINT,
        `/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`,
      );
      return { pairs: pairsWhereBaseIs(pairs, new Set([address])) };
    },

    pairsForTokens: async (chain, addresses) => {
      requireChain(chain, TOKENS_ENDPOINT);

      // Both bounds throw rather than clamp. Truncating at 30 would drop the
      // 31st token silently, and a dropped token reads downstream as a token
      // with no pair — a plausible, wrong, unnoticeable answer. The caller
      // already slices at MAX_ADDRESSES_PER_CALL; if it stops, we say so.
      if (addresses.length === 0) {
        throw new RangeError('pairsForTokens: asked for no addresses; a batch of nothing is a caller bug');
      }
      if (addresses.length > MAX_ADDRESSES_PER_CALL) {
        throw new RangeError(
          `pairsForTokens: ${addresses.length} addresses exceeds the ${MAX_ADDRESSES_PER_CALL} this endpoint accepts`,
        );
      }
      for (const address of addresses) requireAddress(address, TOKENS_ENDPOINT);

      const joined = addresses.map((a) => encodeURIComponent(a)).join(',');
      const pairs = await getPairs(config, TOKENS_ENDPOINT, `/tokens/v1/${encodeURIComponent(chain)}/${joined}`);
      return { pairs: pairsWhereBaseIs(pairs, new Set(addresses)) };
    },
  };
}

/**
 * The vendor's two token endpoints both answer with a BARE JSON ARRAY at the
 * top level. Everything above this file reads `{ pairs: [...] }`, so the
 * normalisation happens here, once, rather than in the mapper.
 *
 * ★ It has to happen SOMEWHERE and here is the safe place. `toMarketState`
 * reads `arr(rec(response).pairs)`, and `rec()` of an array is `{}` by design —
 * so handing it the raw array would produce `pairs: []`, which is the vendor's
 * own spelling for "this token has no market". Every coin would read as
 * `no_market`, no error would be thrown, and the board would look exactly like
 * a market of brand-new coins. Silent, plausible, and wrong.
 */
async function getPairs(
  config: MarketClientConfig,
  endpoint: string,
  path: string,
): Promise<readonly unknown[]> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}${path}`;

  let response: Response;
  try {
    response = await config.fetch(url, requestInit(config));
  } catch (error) {
    // No status: DNS, socket, or the abort above. Deliberately NOT the same
    // error as "the vendor said no": a caller failing closed has to be able to
    // tell an outage from a market full of tokens nobody will quote.
    throw new VendorUnavailable(VENDOR, endpoint, `request failed: ${messageOf(error)}`);
  }

  if (!response.ok) {
    // Every non-2xx, INCLUDING 404. The vendor's answer for "no such token" is
    // 200 with `[]` — measured — so a 404 here means the path moved or we were
    // blocked, and mapping it to an empty market would turn an outage into a
    // screenful of unpriced coins. 429 arrives here too, which is how the rate
    // limit becomes a visible event rather than a slow leak of missing prices.
    throw new VendorUnavailable(VENDOR, endpoint, `responded ${response.status}`, response.status);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new VendorUnavailable(VENDOR, endpoint, `body could not be read: ${messageOf(error)}`, response.status);
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // 200 with a body that is not JSON is an outage wearing a success code —
    // this host sits behind a CDN that serves HTML error and challenge pages
    // with a 200. Calling it a shape error would send the next person hunting a
    // schema change, so it is reported as unavailability, with enough of the
    // body attached to recognise the page on sight.
    throw new VendorUnavailable(
      VENDOR,
      endpoint,
      `responded ${response.status} with a body that is not JSON ` +
        `(content-type ${response.headers.get('content-type') ?? 'absent'}): ${snippet(text)}`,
      response.status,
    );
  }

  if (!Array.isArray(body)) {
    // This one IS a shape error: the vendor answered in JSON and the JSON was
    // not the list of pairs we decode against. Types are erased at runtime, so
    // this throw is the only thing that turns a silent schema change loud.
    throw new VendorShapeError(VENDOR, 'body', `is ${shapeOf(body)}, expected an array of pairs`);
  }

  // An empty array is a NORMAL ANSWER and returns as one: it means no venue is
  // quoting this token yet, which for a coin minted minutes ago is the common
  // case, not an edge case. It is `no_market` downstream — never an error, and
  // never a price of zero.
  return body;
}

function requestInit(config: MarketClientConfig): RequestInit {
  const headers = { accept: 'application/json' };
  return config.timeoutMs === undefined
    ? { method: 'GET', headers }
    : { method: 'GET', headers, signal: AbortSignal.timeout(config.timeoutMs) };
}

/**
 * Keeps only the pairs in which the token we asked about is the BASE side.
 *
 * ★ Measured on the live endpoint, and it is the trap in this vendor's shape:
 * `/token-pairs/v1/{chain}/{address}` returns every pair the address appears
 * in, INCLUDING the ones where it is the quote asset. Of 30 pairs returned for
 * one token, 7 were pairs in which it was the quote — and in those rows
 * `priceUsd`, `fdv` and `marketCap` describe the OTHER token. Left in, they are
 * ranked for depth alongside the real ones, so a token whose deepest pool is
 * one it quotes would be published at a different coin's price and a different
 * coin's market cap. Nothing about that row looks wrong.
 *
 * A pair we cannot attribute — no `baseToken.address` at all — is dropped for
 * the same reason: an unattributable reading is worse than an absent one.
 * Matching is exact, because addresses on this chain are case-significant and
 * the vendor echoes back the string we sent.
 */
function pairsWhereBaseIs(pairs: readonly unknown[], wanted: ReadonlySet<string>): readonly unknown[] {
  return pairs.filter((pair) => {
    const base = str(rec(rec(pair).baseToken).address);
    return base !== null && wanted.has(base);
  });
}

function requireChain(chain: string, endpoint: string): void {
  if (chain !== CHAIN_SLUG) {
    throw new RangeError(`${endpoint}: this adapter reads '${CHAIN_SLUG}' only, and was asked for '${chain}'`);
  }
}

/**
 * Rejects only what would change WHICH REQUEST IS MADE — an empty address, or
 * one carrying a comma, a slash, whitespace or a query delimiter. A comma is
 * the batch separator, so an address containing one would silently become two
 * addresses and shift every result after it.
 *
 * Deliberately not a base58 check. Whether a string is an address is settled
 * where addresses are recorded, not at the read edge, and a wrong opinion about
 * the alphabet here would throw away a whole batch of real coins. A nonsense
 * address that is merely URL-safe reaches the vendor and comes back as `[]`,
 * which is the honest answer to a question about a token that does not exist.
 */
function requireAddress(address: string, endpoint: string): void {
  if (address.length === 0) {
    throw new RangeError(`${endpoint}: an empty address is not a token`);
  }
  if (/[,/?#\s]/.test(address)) {
    throw new RangeError(`${endpoint}: address '${address}' carries a character that would change the request`);
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const shapeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'an array' : `a ${typeof v}`);

const snippet = (text: string): string =>
  text.length <= 120 ? JSON.stringify(text) : `${JSON.stringify(text.slice(0, 120))}…`;
