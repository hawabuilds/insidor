/**
 * The wallet port, implemented with an embedded wallet and sign-in with X or Google.
 *
 * `embeddedWallet()` makes the port and its bridge; `EmbeddedWalletProvider` renders the vendor
 * around the app and keeps the bridge fed. A screen holds the port (contracts/src/ports/wallet.ts)
 * and nothing else from here.
 */

export { embeddedWallet } from './store.ts';
export type { Actions, Bridge, Snapshot } from './store.ts';
export { EmbeddedWalletProvider } from './EmbeddedWallet.tsx';
