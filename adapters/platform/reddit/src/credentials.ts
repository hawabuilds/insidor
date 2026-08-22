/**
 * WHAT THIS SOURCE NEEDS FROM THE ENVIRONMENT, AND HOW THOSE VALUES BECOME A CLIENT
 * CONFIG.
 *
 * It lives in this package rather than in a central list of every source's variables
 * for one reason: a central list drifts silently. The day this vendor adds a required
 * field, the adapter still compiles, the central list still looks complete, and the
 * only symptom is a source that reports itself configured and then throws on its
 * first call. Here, the declaration and the code that reads the value are edited in
 * the same diff or the package does not typecheck.
 *
 * ★ THE USER AGENT IS DECLARED AS A CREDENTIAL AND THAT IS NOT A CATEGORY ERROR. This
 * vendor rations by client id AND by agent string, bans spoofed ones, and throttles
 * generic library defaults into a shared bucket. Without it we do not have working
 * access; that is what makes it a credential rather than a courtesy. See the ★ on
 * `requireUserAgent` in client.ts.
 *
 * ★ AND NOTE WHAT IS NOT HERE: no check that any of these values is any GOOD. Whether
 * an agent string is honest, whether it still holds the placeholder from
 * `.env.example` — those are this vendor's own rules, they already live in
 * `httpClient`, and they already throw there. Restating them here would be a second
 * spelling of a predicate, and the direction it would drift in is the one where this
 * file is laxer than the constructor and reports a source ready that cannot be built.
 * The layer above builds inside a `try` and reports that throw as a misconfiguration,
 * which is the same state a missing variable reaches by the other road.
 */

import type { Millis } from '@insidor/contracts';
import type { CredentialSpec, CredentialValues } from '@insidor/vendor-kit';

import { SOURCE } from './capabilities.ts';
import type { RedditClientConfig } from './client.ts';

export const CLIENT_ID = 'REDDIT_CLIENT_ID';
export const CLIENT_SECRET = 'REDDIT_CLIENT_SECRET';
export const USER_AGENT = 'REDDIT_USER_AGENT';

/**
 * Three variables, all of them credentials, none of them defaultable.
 *
 * There is no variable for the token host or the API host. Both are constants of the
 * vendor rather than of the deployment (`DEFAULT_TOKEN_URL`, `DEFAULT_BASE_URL` in
 * client.ts), and `RedditClientConfig` already accepts an override for the one case
 * that needs one — a test pointing at a local server. A variable nobody would ever
 * set in production is a variable somebody can set in production by accident.
 */
export const CREDENTIALS: CredentialSpec = {
  source: String(SOURCE),
  requires: [
    {
      variable: CLIENT_ID,
      note: 'the short string under the app name at https://www.reddit.com/prefs/apps. The app type must be "script".',
      fallback: null,
    },
    {
      variable: CLIENT_SECRET,
      note: 'the secret on the same app. Belongs in .env.local, which is gitignored.',
      fallback: null,
    },
    {
      variable: USER_AGENT,
      note: 'must name a contactable account: "script:com.insidor.adapter:v0.1.0 (by /u/<your-username>)". The vendor bans spoofed agents.',
      fallback: null,
    },
  ],
};

export interface ClientRuntime {
  /** Injected, never imported: a unit test must not be able to reach the network. */
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => Millis;
}

/**
 * Turn resolved values into this client's config.
 *
 * The one place in the repository that knows which variable feeds which field. A
 * caller passing a variable name this spec never declared gets a throw from
 * `values`, at construction, rather than an empty credential and a 401 an hour later.
 */
export function clientConfig(values: CredentialValues, runtime: ClientRuntime): RedditClientConfig {
  return {
    clientId: values(CLIENT_ID),
    clientSecret: values(CLIENT_SECRET),
    userAgent: values(USER_AGENT),
    fetch: runtime.fetch,
    now: runtime.now,
  };
}
