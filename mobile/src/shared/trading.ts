/**
 * THE TRADING FLAG — off unless the build says exactly `VITE_TRADING=on`.
 *
 * While it is off there is no trade path in this app at all: Buy and Sell say "Coming soon",
 * whether or not a wallet is connected. Turning it on is the founders' decision, made in the
 * build's environment, never in code, and never by a connected wallet. Even on, the server
 * decides who may trade (an allowlist) and how much (a cap in policy); this flag only lets the
 * app ask.
 */
export function tradingOn(env: { readonly VITE_TRADING?: string | undefined }): boolean {
  return env.VITE_TRADING === 'on';
}
