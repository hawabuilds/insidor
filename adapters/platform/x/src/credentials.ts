/**
 * WHAT THIS SOURCE NEEDS FROM THE ENVIRONMENT, AND HOW THOSE VALUES BECOME A CLIENT
 * CONFIG.
 *
 * Declared in this package and not in a central list, for the reason the reddit
 * adapter's copy of this header gives: a central list of every source's variables
 * drifts silently the day a vendor adds a field.
 *
 * ★ ONE CREDENTIAL AND ONE HOST, AND THE DIFFERENCE BETWEEN THEM IS LOAD-BEARING.
 * The key has no fallback and never will: a defaulted credential authenticates as
 * somebody else, which fails in a way that looks like our bug and is not. The base
 * URL has one, because it is a public address rather than a secret, and because a
 * fresh clone that supplies only the key must end up LIVE rather than half-configured
 * — the "activation is one credential" property the whole feature is for. Giving the
 * host no fallback would make every correctly configured deploy read as broken until
 * somebody also pasted a URL they had no reason to know.
 *
 * ★ THIS FILE ASKS "WAS IT SUPPLIED", NEVER "IS IT ANY GOOD", AND NOW THAT THE CLIENT
 * MAKES REAL REQUESTS THAT SPLIT IS LOAD-BEARING RATHER THAN THEORETICAL.
 *
 * Whether a key is well formed — not empty, no whitespace that would forge a header,
 * a base URL that is really http(s) — is vendor knowledge, and it lives in
 * `httpClient`, which throws `XNotConfigured` at construction. It is NOT restated
 * here, for the reason the reddit adapter's copy of this header gives: two spellings
 * of one predicate drift, and the direction they drift in is the one where this file
 * is LAXER than the constructor and reports a source ready that cannot be built.
 *
 * The registry builds every adapter inside a `try`, so both roads — nothing supplied,
 * and something supplied that will not work — arrive at `services/runner/src/sources.ts`
 * as the same `misconfigured` shape with a different reason attached. One state,
 * reached two ways, and no duplicated check between them.
 */

import type { CredentialSpec, CredentialValues } from '@insidor/vendor-kit';

import { SOURCE } from './capabilities.ts';
import type { XClientConfig } from './client.ts';

export const API_KEY = 'X_API_KEY';
export const API_BASE = 'X_API_BASE';

/**
 * The reseller's host. A default rather than a required variable for the same reason
 * services/market spells its vendor host out rather than failing on a missing one:
 * the credential is the thing that must never have a default, and a public host is
 * not a credential.
 */
export const DEFAULT_BASE_URL = 'https://api.twitterapi.io';

export const CREDENTIALS: CredentialSpec = {
  source: String(SOURCE),
  requires: [
    {
      variable: API_KEY,
      note: 'the reseller API key. Billed per post returned, so every call is metered.',
      fallback: null,
    },
    {
      variable: API_BASE,
      note: 'the reseller host. Override only to point at a staging or recorded endpoint.',
      fallback: DEFAULT_BASE_URL,
    },
  ],
};

export interface ClientRuntime {
  /** Injected, never imported: a unit test must not be able to reach the network. */
  readonly fetch: typeof globalThis.fetch;
}

/** The one place that knows which variable feeds which field of this client. */
export function clientConfig(values: CredentialValues, runtime: ClientRuntime): XClientConfig {
  return {
    apiKey: values(API_KEY),
    baseUrl: values(API_BASE),
    fetch: runtime.fetch,
  };
}
