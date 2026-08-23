/**
 * THE WALLET ADAPTER'S SURFACE.
 *
 * WHAT IT IS RESPONSIBLE FOR: naming the four things outside this package may use — the
 * adapter, its configuration, the default discovery, and the pure state machine — and
 * nothing else.
 *
 * ★ WHAT IS NOT EXPORTED, AND WHY THAT MATTERS. `provider.ts`'s narrowing functions
 * (`classify`, `readAccount`, `readNetwork`, `readSignature`) are internal on purpose. They
 * are the boundary that turns a wallet extension's arbitrary output into our closed types,
 * and a caller holding them is a caller that has a value which has NOT been through them —
 * which is the only way the guarantee in that file's header can be broken from outside. The
 * `WalletProvider` type is exported because a test must be able to write one; the functions
 * that police it are not.
 *
 * ★ AND THE TYPES ARE NOT RE-EXPORTED FROM HERE. `Wallet`, `WalletState` and `WalletFailure`
 * live in `@insidor/contracts/ports/wallet.ts` and consumers import them from there. That is
 * deliberate: the app renders a state whose definition it gets from the vocabulary, not from
 * an adapter — so swapping this adapter for a second one changes an import in exactly one
 * file (the app's entry point) and nothing that renders.
 */

export { browserWallet } from './browser.ts';
export type { BrowserWalletConfig } from './browser.ts';
export { DEFAULT_PROVIDER_KEYS, globalDiscovery } from './discovery.ts';
export { UNPROBED, next, settle } from './machine.ts';
export type { WalletEvent, WalletRules } from './machine.ts';
export type { WalletProvider } from './provider.ts';
