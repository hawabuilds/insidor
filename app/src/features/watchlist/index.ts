/**
 * The watchlist's surface: the saved list, the alert sheet, and the store behind both.
 *
 * ★ THIS IS THE ONE FEATURE BARREL THAT EXPORTS STATE, and the exception is worth naming
 * because copying it elsewhere would be wrong. Three surfaces need the SAME watch store —
 * the `/watchlist` view, the floating mint alert, and the star on the story page — and
 * they live in three different places in the tree. `createWatchStore` is therefore a
 * factory that `App.tsx` calls once and threads down. The alternative, a module-level
 * singleton constructed in this folder and re-exported, shares the instance just as well
 * but hides its lifetime: nothing would be able to make a second one for a test, and
 * nothing would say where the first one began.
 *
 * What is NOT exported is `settledCoin`, `load`, `save` and the storage key. That is not
 * tidiness. The transition rule inside `observe` — an `unsure` coin link never fires, and
 * the same settled coin observed twice fires once — is the entire reason this alert is
 * worth interrupting someone for, and it is enforced only by being the sole way an alert
 * can come into existence. A caller able to write the list or mint an alert directly could
 * route around it, and the product would have taught the user to dismiss the one
 * interruption it gets.
 *
 * `MintAlert` is exported as a TYPE for the components that render one. That is a shape,
 * not a constructor; `alerts()` remains the only source.
 *
 * Features import each other only through these barrels — a dependency rule, not a
 * convention.
 */

export { Watchlist } from './Watchlist.tsx';
export { MintAlerts } from './MintAlert.tsx';
export { createWatchStore } from './watchlist-store.ts';
export type { MintAlert, WatchStore } from './watchlist-store.ts';
