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
 * ★ THE CLIENT IS STILL A SIGNATURE. `httpClient` here throws `NotImplemented` on
 * both verbs, and that is deliberately NOT this file's problem: nothing below decides
 * whether the source works, only whether it was configured. The distinction matters
 * because the two failures want different answers — a not-implemented body is our
 * work to finish, a missing key is somebody's to supply — and a source configured
 * today will report `failing` with an honest reason until the body lands, rather than
 * silently reading as dormant and looking like nobody's fault.
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
