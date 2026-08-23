/**
 * THE WALLET SURFACE INSIDE THE APP.
 *
 * ★ WHAT IS NOT HERE IS THE POINT: no vendor symbol, no SDK, and no adapter. Everything this
 * folder renders it renders from `WalletState`, whose definition comes from the shared
 * vocabulary (`@insidor/contracts/ports/wallet.ts`). The adapter that produces those states
 * is constructed in `main.tsx` — one line, in the one file that composes the application —
 * and is passed down as a value. Nothing under `features/` imports it.
 *
 * The test for whether that boundary is still holding: this folder imports a TYPE and never
 * a vendor symbol. The moment a component here needs `import { useWallet } from '<vendor>'`,
 * the boundary has moved and the adapter has stopped being one.
 *
 * `truncateRef` is exported because it is the app's one spelling of "shorten an opaque
 * reference for the eye", and a second spelling is a second thing to get subtly wrong.
 */

export { Connect } from './Connect.tsx';
export type { ConnectProps } from './Connect.tsx';
export { useWalletState } from './useWallet.ts';
export { truncateRef, walletView } from './wallet-view.ts';
export type { WalletAccount, WalletAction, WalletNote, WalletView } from './wallet-view.ts';
