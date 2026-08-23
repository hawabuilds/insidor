/**
 * THE CONNECT CONTROL. Renders what `wallet-view.ts` decided and decides nothing itself.
 *
 * WHAT IT IS RESPONSIBLE FOR: three elements in the corner of the nav — an account chip, a
 * quiet note, and one button — plus wiring the button to the two verbs on the port. Which
 * words, which tone, and whether the button is inert are all read off the view; there is no
 * conditional in this file that is not a presence check.
 *
 * WHY IT HOLDS NO LOGIC: this test runner has no DOM, so a `.tsx` cannot be imported by a
 * test. Anything decided here would be untestable by construction, and the thing that has to
 * be tested is precisely that no two states say the same thing. `SourceStatus.tsx` next to it
 * is the same shape for the same reason.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY.
 *
 *   1. ★ CONNECTING CHANGES WHAT THE APP KNOWS, NOT WHAT IT OFFERS. There is exactly one
 *      control here in every state, and no state adds one anywhere else in the app. Nothing
 *      downstream becomes pressable because a wallet appeared — the buy panel still says
 *      trading is not connected, because it still is not. If a change to this file causes a
 *      new affordance to appear when a wallet connects, the change is wrong: there is
 *      nothing behind it to press.
 *
 *   2. ★ THE DETAIL IS REACHABLE BY KEYBOARD, NOT ONLY BY MOUSE. `tabIndex` plus
 *      `aria-label` plus the `.tip` child carry the same sentence through three channels. A
 *      `title` attribute alone would put every explanation — including "you cancelled" and
 *      "your wallet is on another network" — behind a hover, which is no explanation at all
 *      for anybody navigating by keyboard or reading with a screen reader.
 *
 *   3. ★ `connect()` IS CALLED WITHOUT A CATCH BLOCK, ON PURPOSE. The port promises it
 *      resolves rather than rejects, so there is no error object here to accidentally log,
 *      and every outcome — including refusal — arrives as a state that this file already
 *      knows how to render. A `.catch(console.error)` added here would be the exact leak the
 *      adapter was built to make impossible.
 */

import type { Wallet, WalletState } from '@insidor/contracts/ports/wallet.ts';

import { walletView } from './wallet-view.ts';
import styles from './wallet.module.css';

export interface ConnectProps {
  readonly wallet: Wallet;
  /** Read by the shell from `useWalletState` and passed down, so there is one frame. */
  readonly state: WalletState;
}

export function Connect({ wallet, state }: ConnectProps) {
  const view = walletView(state);

  const press = (): void => {
    /* Note 3. Both verbs resolve; neither rejects. */
    if (view.action.intent === 'connect') void wallet.connect();
    else void wallet.disconnect();
  };

  return (
    <div className={styles['wallet']} data-wallet={view.kind}>
      {view.account === null ? null : (
        <span className={styles['chip']} title={view.account.full}>
          {view.account.short}
        </span>
      )}

      {/* ★ THE LIVE REGION IS ALWAYS PRESENT AND THE BUTTON IS OUTSIDE IT. Two reasons, and
          both are about what a person who cannot see the corner hears. A region that appears
          only when there is something to say is a region a screen reader has not been
          watching, so the first sentence after a state change is the one that gets missed —
          which here is "you cancelled" or "different network", the two that matter most. And
          a live region containing a control re-announces the control on every unrelated
          change, so the button sits outside it. `display: contents` keeps the layout
          identical to having no wrapper at all. */}
      <span className={styles['live']} role="status">
        {view.note === null ? null : (
          <span
            className={`${styles['walletNote']} ${
              view.note.tone === 'warn' ? styles['walletWarn'] : ''
            }`}
            tabIndex={0}
            aria-label={view.note.detail}
          >
            {view.note.text}
            <span className={styles['tip']}>{view.note.detail}</span>
          </span>
        )}
      </span>

      <button
        type="button"
        className={styles['walletBtn']}
        onClick={press}
        disabled={view.action.busy}
        aria-busy={view.action.busy}
      >
        {view.action.label}
      </button>
    </div>
  );
}
