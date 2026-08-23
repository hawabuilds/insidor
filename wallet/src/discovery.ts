/**
 * FINDING A WALLET — the one file in this package that reads a browser global.
 *
 * WHAT IT IS RESPONSIBLE FOR: looking at the page for an object that behaves like a wallet
 * provider, and returning it or null. Nothing else here reaches for a global, which is why
 * every other file in this package runs unchanged under a test runner with no DOM.
 *
 * WHY IT IS SEPARATE FROM `browser.ts`: because it is the only impure line in the package,
 * and the adapter takes it as a parameter. Injecting the lookup rather than performing it
 * is what makes "the person refused", "the wallet returned junk" and "the account changed
 * mid-session" ordinary unit tests instead of things somebody verifies by hand once.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY.
 *
 *   1. ★ NULL IS A NORMAL ANSWER, NOT A FAILURE. Most browsers have no wallet extension.
 *      Returning null must stay cheap, silent and side-effect-free — no throw, no log, no
 *      retry loop, no prompt to install anything. `unavailable` is the state it produces and
 *      that state is deliberately not a fault anywhere downstream.
 *
 *   2. ★ NO SDK IS IMPORTED HERE OR ANYWHERE IN THIS PACKAGE, AND THAT IS ASSERTED.
 *      `dependency-graph.test.ts` reads the manifests and every import in this package and
 *      the app, and fails if a third-party wallet library appears in either. A browser
 *      extension publishes a plain object on the page; talking to it needs no library, and
 *      a library is how a chain client, a transaction builder and eventually an endpoint
 *      with an authentication token get into a browser bundle. Every one of those is banned
 *      on this path, and the cheapest way to keep them out is to never take the first
 *      dependency.
 *
 *   3. ★ THE SHAPE TEST IS STRUCTURAL AND DELIBERATELY SHALLOW. We accept an object with a
 *      callable `connect` and nothing more. Demanding more members would refuse working
 *      wallets that publish fewer; walking the object looking for something wallet-shaped
 *      would eventually find a stranger's object and hand a person's connection prompt to
 *      it. What we get back is typed `unknown` at every member anyway (`provider.ts`), so a
 *      wrong guess here cannot become a wrong value on screen — it becomes a failed connect,
 *      which is a state we can say out loud.
 */

import { quietly } from './provider.ts';
import type { WalletProvider } from './provider.ts';

/**
 * Where browser wallet extensions publish themselves.
 *
 * One entry, because this build has one settlement layer behind it — the venue adapter in
 * this repository prices a curve market on it — and declaring support for layers no venue
 * here can trade on would be an offer we cannot honour. It is a parameter rather than a
 * constant at the call site so that adding a layer is one argument rather than a change to
 * this file, and so a test can supply names that exist nowhere.
 */
export const DEFAULT_PROVIDER_KEYS: readonly string[] = ['solana'];

/**
 * Anything with a callable `connect` is worth trying. See note 3.
 *
 * ★ THE SHAPE TEST IS ITSELF A READ ON A STRANGER'S OBJECT. `window.solana` is defined by
 * whatever ran first on the page, and both `scope[key]` and `.connect` may be accessors that
 * run code — including code that throws. Unguarded, "look for a wallet" could therefore
 * throw, and it is called at construction in `main.tsx`: the failure was a blank document
 * rather than a failed connection. Anything we cannot even inspect is `null`, which is the
 * same answer as "there is nothing here" and produces `unavailable`, which is not a fault.
 */
function asProvider(value: unknown): WalletProvider | null {
  if (typeof value !== 'object' || value === null) return null;
  return quietly(() => {
    const candidate = value as { readonly connect?: unknown };
    return typeof candidate.connect === 'function' ? (value as WalletProvider) : null;
  }, null);
}

/**
 * Builds the lookup the adapter takes.
 *
 * `globalThis` is read through a structural cast rather than through the DOM type library,
 * so this package needs no `lib: ["DOM"]` and nothing here is tempted to reach for
 * `window.localStorage`, `window.fetch` or any other browser capability. Under a test runner
 * the same code finds nothing and returns null, which is the correct answer there.
 *
 * @param scope injectable for tests; defaults to the real global.
 */
export function globalDiscovery(
  keys: readonly string[] = DEFAULT_PROVIDER_KEYS,
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): () => WalletProvider | null {
  return () => {
    for (const key of keys) {
      /* The indexed read is guarded separately from the shape test, so a global defined as a
         throwing getter costs us that ONE key rather than the whole sweep — a second wallet
         published under a later name is still found. */
      const found = asProvider(quietly(() => scope[key], undefined));
      if (found !== null) return found;
    }
    return null;
  };
}
