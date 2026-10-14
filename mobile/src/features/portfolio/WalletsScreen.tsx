/**
 * YOUR WALLETS — the Insidor wallet made at sign-in, and outside wallets (Phantom) joined to view
 * here. Linking runs in the sign-in provider's own window: the outside wallet proves it is yours
 * by signing there, and Insidor receives its address. Never its key.
 *
 * ★ VIEW ONLY. A linked wallet's balances are read from the chain like any address; Send, Buy and
 * Sell use the Insidor wallet, and trading is allowed only for wallets on the trade service's
 * allowlist. No button here can move anything from a linked wallet.
 */

import { useSyncExternalStore } from 'react';

import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon, ExternalIcon } from '../../shared/ui/icons.tsx';
import { useWallet } from '../../shared/wallet.tsx';
import styles from './portfolio.module.css';
import box from './wallet.module.css';
import { goBack } from '../../shared/nav.ts';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function WalletsScreen() {
  const { wallet, state } = useWallet();
  const toast = useToast();
  const linkedKey = useSyncExternalStore(
    (l) => (wallet === null ? () => undefined : wallet.subscribe(l)),
    () => (wallet === null ? '' : wallet.linkedWallets().join(',')),
  );
  const linked = linkedKey === '' ? [] : linkedKey.split(',');
  const signedIn = state.kind === 'connected';

  const link = async () => {
    const outcome = (await wallet?.linkWallet()) ?? 'unavailable';
    if (outcome === 'linked') toast('Wallet linked', 'It shows on your Portfolio, view only.');
    else if (outcome === 'refused') toast('Not linked', 'You closed the window.');
    else toast("Couldn't link", outcome === 'unavailable' ? 'Sign in first.' : 'Try again in a moment.');
  };

  return (
    <section className={box['page']}>
      <button type="button" className={box['back']} aria-label="Back" onClick={() => goBack({ screen: 'portfolio' })}>
        <BackIcon size={22} />
      </button>
      <h1 className={box['title']}>Your wallets</h1>
      <p className={box['lead']}>Link Phantom or another Solana wallet to see it here. It stays view only: Insidor reads it from the chain and never gets its key. Trading only ever uses your Insidor wallet.</p>

      {signedIn ? (
        <div className={box['walletCard']}>
          <b>Insidor wallet <span className={box['active']}>Trades</span></b>
          <span>{short(state.account)}</span>
          <a href={`https://solscan.io/account/${state.account}`} target="_blank" rel="noreferrer" aria-label="Open on Solscan"><ExternalIcon size={14} /></a>
        </div>
      ) : null}
      {linked.map((a) => (
        <div key={a} className={box['walletCard']}>
          <b>Linked wallet <span className={box['viewOnly']}>View only</span></b>
          <span>{short(a)}</span>
          <a href={`https://solscan.io/account/${a}`} target="_blank" rel="noreferrer" aria-label="Open on Solscan"><ExternalIcon size={14} /></a>
        </div>
      ))}

      {signedIn ? (
        <button type="button" className={`${styles['action']} ${box['linkButton']}`} onClick={() => void link()}>Link Phantom</button>
      ) : (
        <p className={box['lead']}>Sign in to link a wallet.</p>
      )}
      <ol className={box['steps']}>
        <li>Tap Link Phantom. Your sign-in provider's window opens.</li>
        <li>Choose Phantom, and approve the connection there.</li>
        <li>The wallet appears on your Portfolio. Switch between wallets at the top.</li>
      </ol>
    </section>
  );
}
