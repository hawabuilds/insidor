/**
 * WHAT THIS SOURCE NEEDS FROM THE ENVIRONMENT, AND HOW THOSE VALUES BECOME A CLIENT
 * CONFIG.
 *
 * ★ THIS IS THE SOURCE WHERE "ADDING A CREDENTIAL TURNS IT ON" WAS NOT TRUE, AND THIS
 * FILE IS WHERE THAT STOPS BEING A SURPRISE.
 *
 * `.env.example` offers exactly one variable for this source. `TikTokClientConfig`
 * wants FOUR fields, and until now the other three had no variable, no default, and
 * no constant anywhere in the package. Supplying the token alone therefore produced a
 * client that constructed happily and could not run anything — the worst of the three
 * possible states, because it looks configured. Declaring all four here means the
 * shortfall is answered at boot, by name, as a `misconfigured` reading: somebody
 * turned this on and got it wrong, which is a fault, and is deliberately NOT the same
 * reading as the source nobody turned on.
 *
 * ★ WHY THE ACTOR IDS ARE CONFIGURATION AND NOT CODE CONSTANTS. They identify which
 * third-party scraper we run, and that is a commercial choice with a price attached
 * that can change without our code changing — the actor we use today can be deprecated,
 * re-published under a new id, or swapped for a cheaper one, and none of those is a
 * deploy of this repository. A constant would make each of those a code change; a
 * variable makes it a config change, which is the property this whole build exists to
 * establish. They carry no fallback because we have no id we could honestly default
 * to: inventing one would be a fiction, and a fiction is labelled or it is not shipped.
 *
 * The host is the exception and gets a default, because a public address is not a
 * credential and a fresh clone must not have to paste a URL it had no reason to know.
 */

import type { CredentialSpec, CredentialValues } from '@insidor/vendor-kit';

import { SOURCE } from './capabilities.ts';
import type { TikTokClientConfig } from './client.ts';

export const TOKEN = 'APIFY_TOKEN';
export const BASE_URL = 'TIKTOK_API_BASE';
export const DISCOVERY_ACTOR = 'TIKTOK_DISCOVERY_ACTOR_ID';
export const OBSERVE_ACTOR = 'TIKTOK_OBSERVE_ACTOR_ID';

/** The scraper platform's public host. Not a credential; see the header. */
export const DEFAULT_BASE_URL = 'https://api.apify.com';

export const CREDENTIALS: CredentialSpec = {
  source: String(SOURCE),
  requires: [
    {
      variable: TOKEN,
      note: 'the scraper platform API token. Billed per RUN, so a run that returns nothing still costs.',
      fallback: null,
    },
    {
      variable: DISCOVERY_ACTOR,
      note: 'the actor id run for hashtag, feed and account discovery. This source has no keyword search.',
      fallback: null,
    },
    {
      variable: OBSERVE_ACTOR,
      note: 'the actor id run to re-read known posts. Takes post URLs rather than ids.',
      fallback: null,
    },
    {
      variable: BASE_URL,
      note: 'the scraper platform host. Override only to point at a staging or recorded endpoint.',
      fallback: DEFAULT_BASE_URL,
    },
  ],
};

export interface ClientRuntime {
  /** Injected, never imported: a unit test must not be able to reach the network. */
  readonly fetch: typeof globalThis.fetch;
}

/** The one place that knows which variable feeds which field of this client. */
export function clientConfig(values: CredentialValues, runtime: ClientRuntime): TikTokClientConfig {
  return {
    token: values(TOKEN),
    baseUrl: values(BASE_URL),
    discoveryActorId: values(DISCOVERY_ACTOR),
    observeActorId: values(OBSERVE_ACTOR),
    fetch: runtime.fetch,
  };
}
