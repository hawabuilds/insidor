/**
 * THE WALLET TAB — sign in with X; then your wallet: what it holds and what it is worth
 * (Portfolio.tsx), Receive (your address, with a copy button) and, once the build has TRADING on,
 * Send.
 *
 * Sign-in creates a Solana wallet for anyone who has none (the vendor holds it; we never see a
 * key, and there is no screen to import or export one). The tab only ever reads the signed-in
 * person's own wallet. A build with no sign-in shows a recorded public wallet, labelled as
 * sample data, so the screen can be seen; it is never presented as anyone's own.
 *
 * ★ CONNECTING CHANGES NO OTHER SCREEN. Buy and Sell stay "Coming soon" until trading is turned
 * on (shared/trading.ts); a connected wallet is not a reason for a button to appear.
 *
 * Closing the sign-in is said as what it is — "You closed sign-in" — never as an error.
 */

import { useState } from 'react';

import { SAMPLE_SCREENS, fetchPortfolio, loadSamplePortfolio, type Holding, type Portfolio as PortfolioData } from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { SAMPLE_WALLET } from '../../shared/notice.ts';
import { tradingOn } from '../../shared/trading.ts';
import { Notice } from '../../shared/ui/Notice.tsx';
import { useWallet } from '../../shared/wallet.tsx';
import { Portfolio, usePortfolioRange } from './Portfolio.tsx';
import { SendSheet } from './SendSheet.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { CopyIcon } from '../../shared/ui/icons.tsx';
import styles from './wallet.module.css';

/** "7sYK…pump": enough of each end to compare by eye. */
const short = (a: string): string => (a.length <= 12 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`);

/* Read once, at build time, like the trade bar: a deploy turns Send on, never a page. */
const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

function Holdings({ load, keyOf, canSend }: { load: (signal: AbortSignal, range: '1h' | '6h' | '24h') => Promise<PortfolioData>; keyOf: string; canSend: boolean }) {
  const [range, setRange] = usePortfolioRange();
  const [data] = useLoad(`wallet:${keyOf}:${range}`, (signal) => load(signal, range));
  if (data.state === 'loading') return <p className={styles['line']}>Reading the wallet.</p>;
  if (data.state === 'failed') return <p className={styles['line']}>— what this wallet holds could not be read just now.</p>;
  return (
    <>
      {canSend ? <SendButton holdings={data.value.kind === 'read' ? data.value.holdings : []} /> : null}
      <Portfolio data={data.value} range={range} onRange={setRange} />
    </>
  );
}

/** Send, with the wallet's own coins to choose from. Only in a build with TRADING on. */
function SendButton({ holdings }: { holdings: readonly Holding[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button look="primary" size="large" className={styles['cta']} onClick={() => setOpen(true)}>Send</Button>
      {open ? <SendSheet holdings={holdings} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

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
      {state.kind === 'unavailable' && SAMPLE_SCREENS ? (
        <div className={styles['sample']}>
          <Notice notice={SAMPLE_WALLET} />
          <Holdings keyOf="sample" canSend={false} load={() => loadSamplePortfolio()} />
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
            <span className={styles['kicker']}>Receive</span>
            <button type="button" className={styles['address']} onClick={() => void copy(state.account)} aria-label={`Copy address ${state.account}`}>
              {short(state.account)} <CopyIcon size={14} />
            </button>
            <p>Send SOL or coins to this address.</p>
          </div>
          <Holdings keyOf={state.account} canSend={TRADING} load={(signal, range) => fetchPortfolio(state.account, range, signal)} />
          <Button look="quiet" size="large" className={styles['cta']} onClick={() => void wallet?.disconnect()}>
            Sign out
          </Button>
        </>
      ) : null}
    </section>
  );
}
