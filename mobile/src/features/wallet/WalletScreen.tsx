/**
 * THE WALLET TAB — sign in with X, and your embedded wallet's address. Nothing else yet.
 *
 * Sign-in creates a Solana wallet for anyone who has none (the vendor holds it; we never see a
 * key, and there is no screen to import or export one). Signed in, the tab shows the address —
 * a reference, shortened, with a copy button — and Sign out. What the wallet holds is the
 * portfolio's job (Phase 5b); until then the tab says so rather than showing an empty balance.
 *
 * ★ CONNECTING CHANGES NO OTHER SCREEN. Buy and Sell stay "Coming soon" until trading is turned
 * on (shared/trading.ts) and built; a connected wallet is not a reason for a button to appear.
 *
 * Closing the sign-in is said as what it is — "You closed sign-in" — never as an error.
 */

import { useWallet } from '../../shared/wallet.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { CopyIcon } from '../../shared/ui/icons.tsx';
import styles from './wallet.module.css';

/** "7sYK…pump": enough of each end to compare by eye. */
const short = (a: string): string => (a.length <= 12 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`);

export function WalletScreen() {
  const { wallet, state } = useWallet();
  const toast = useToast();

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      toast('Address copied');
    } catch {
      toast('Could not copy', 'Press and hold the address instead.');
    }
  };

  return (
    <section className={styles['screen']}>
      <h1 className={styles['title']}>Wallet</h1>
      {state.kind === 'unavailable' ? (
        <div className={styles['box']}>
          <b>Sign-in isn't set up in this build</b>
          <p>The wallet needs sign-in with X, which this build has no key for.</p>
        </div>
      ) : null}

      {state.kind === 'disconnected' || state.kind === 'refused' || state.kind === 'failed' ? (
        <div className={styles['box']}>
          <b>Sign in to get your wallet</b>
          <p>Sign in with X and a Solana wallet is made for you. Nobody, including us, ever sees its key.</p>
          {state.kind === 'refused' ? <p className={styles['note']}>You closed sign-in.</p> : null}
          {state.kind === 'failed' ? <p className={styles['note']}>Sign-in didn't work. Try again.</p> : null}
          <Button look="primary" size="large" className={styles['cta']} onClick={() => void wallet?.connect()}>
            Sign in with X
          </Button>
        </div>
      ) : null}

      {state.kind === 'connecting' ? (
        <div className={styles['box']}>
          <b>Signing in</b>
          <p>Finish in the sign-in window. Your wallet is made the first time.</p>
        </div>
      ) : null}

      {state.kind === 'connected' || state.kind === 'wrong-network' ? (
        <>
          <div className={styles['box']}>
            <span className={styles['kicker']}>Your Solana wallet</span>
            <button type="button" className={styles['address']} onClick={() => void copy(state.account)} aria-label={`Copy address ${state.account}`}>
              {short(state.account)} <CopyIcon size={14} />
            </button>
            <p>What it holds appears here once the portfolio is built.</p>
          </div>
          <Button look="quiet" size="large" className={styles['cta']} onClick={() => void wallet?.disconnect()}>
            Sign out
          </Button>
        </>
      ) : null}
    </section>
  );
}
