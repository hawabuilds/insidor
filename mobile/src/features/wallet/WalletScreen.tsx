/**
 * THE WALLET TAB — Trador's Stonkfolio, in Insidor: sign in with X, then who you are, what your
 * wallet holds and what it is worth (Portfolio.tsx), Send and Receive.
 *
 * Sign-in creates a Solana wallet for anyone who has none (the vendor holds it; we never see a
 * key, and there is no screen to import or export one). The tab only ever reads the signed-in
 * person's own wallet. A build with no sign-in shows a recorded public wallet, labelled as
 * sample data, as Trador's demo mode does; it is never presented as anyone's own.
 *
 * ★ SEND ONLY WITH TRADING ON. Receive is always there (it is an address); Send appears only in a
 * build with TRADING on, never as a disabled button.
 *
 * Closing the sign-in is said as what it is — "You closed sign-in" — never as an error.
 */

import { useState } from 'react';

import { SAMPLE_SCREENS, fetchPortfolio, fetchWalletHistory, loadSamplePortfolio, type Holding, type Portfolio as PortfolioData } from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { SAMPLE_WALLET } from '../../shared/notice.ts';
import { tradingOn } from '../../shared/trading.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { useWallet } from '../../shared/wallet.tsx';
import { Portfolio, type ChartRange, type WhoAmI } from './Portfolio.tsx';
import { withLive, type BalancePoint } from './balance-points.ts';
import { ReceiveSheet } from './ReceiveSheet.tsx';
import { SendSheet } from './SendSheet.tsx';
import styles from './portfolio.module.css';
import box from './wallet.module.css';

/* Read once, at build time, like the trade bar: a deploy turns Send on, never a page. */
const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

/** The address of the recorded sample wallet; shown only with the "Sample data" notice. */
const SAMPLE_ADDRESS = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

function Loaded({ who, load, history, canAct, footer = null }: {
  who: WhoAmI;
  load: (signal: AbortSignal) => Promise<PortfolioData>;
  history: (signal: AbortSignal, range: ChartRange) => Promise<readonly BalancePoint[]>;
  canAct: boolean;
  footer?: React.ReactNode;
}) {
  const [range, setRange] = useState<ChartRange>('1w');
  const [scrubbed, setScrubbed] = useState<BalancePoint | null>(null);
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<'send' | 'receive' | null>(null);
  const [data] = useLoad(`wallet:${who.address}`, (signal) => load(signal));
  const [stored] = useLoad(`wallet-history:${who.address}:${range}`, (signal) => history(signal, range));
  const portfolio: PortfolioData | null = data.state === 'ready' ? data.value : data.state === 'failed' ? { kind: 'unavailable' } : null;
  const live = portfolio?.kind === 'read' && portfolio.totalUsd.known ? portfolio.totalUsd.amount : null;
  const points = stored.state === 'loading' ? null : withLive(stored.state === 'ready' ? stored.value : [], live, Date.now());
  const holdings: readonly Holding[] = portfolio?.kind === 'read' ? portfolio.holdings : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(who.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const actions = canAct ? (
    <div className={styles['actions']}>
      {TRADING ? <button type="button" className={styles['action']} onClick={() => setSheet('send')}><Arrow up />Send</button> : null}
      <button type="button" className={styles['action']} onClick={() => setSheet('receive')}><Arrow />Receive</button>
    </div>
  ) : null;

  return (
    <>
      <Portfolio
        who={who}
        data={portfolio}
        points={points}
        range={range}
        onRange={setRange}
        scrubbed={scrubbed}
        onScrub={setScrubbed}
        copied={copied}
        onCopy={() => void copy()}
        actions={actions}
        notice={canAct ? null : <div className={box['sampleNotice']}><Notice notice={SAMPLE_WALLET} /></div>}
        footer={footer}
      />
      {sheet === 'send' ? <SendSheet holdings={holdings} onClose={() => setSheet(null)} /> : null}
      {sheet === 'receive' ? <ReceiveSheet address={who.address} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: up ? undefined : 'rotate(180deg)' }}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function WalletScreen() {
  const { wallet, state } = useWallet();

  if (state.kind === 'connected' || state.kind === 'wrong-network') {
    const id = wallet?.identity() ?? null;
    const who: WhoAmI = { name: id?.name ?? null, handle: id?.handle ?? null, pictureUrl: id?.pictureUrl ?? null, address: state.account };
    return (
      <Loaded
        who={who}
        canAct
        load={(signal) => fetchPortfolio(state.account, '24h', signal)}
        history={(signal, range) => fetchWalletHistory(state.account, range, signal)}
        footer={<div className={box['signOutRow']}><Button look="quiet" size="small" onClick={() => void wallet?.disconnect()}>Sign out</Button></div>}
      />
    );
  }

  if (state.kind === 'unavailable' && SAMPLE_SCREENS) {
    return <Loaded who={{ name: 'Sample wallet', handle: null, pictureUrl: null, address: SAMPLE_ADDRESS }} canAct={false} load={() => loadSamplePortfolio()} history={async () => []} />;
  }

  return (
    <section className={box['screen']}>
      <div className={box['signIn']}>
        <span className={box['signInIcon']} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M16 13h2M3 10h18" /></svg>
        </span>
        {state.kind === 'unavailable' ? (
          <>
            <b>Sign-in isn't set up in this build</b>
            <p>The wallet needs sign-in, which this build has no key for.</p>
          </>
        ) : state.kind === 'connecting' ? (
          <>
            <b>Signing in</b>
            <p>Finish in the sign-in window. Your wallet is made the first time.</p>
          </>
        ) : (
          <>
            <b>Sign in to see your wallet</b>
            <p>Your holdings are read from the chain, so nothing is stored here. Nobody, including us, ever sees your wallet's key.</p>
            {state.kind === 'refused' ? <p className={box['note']}>You closed sign-in.</p> : null}
            {state.kind === 'failed' ? <p className={box['note']}>Sign-in didn't work. Try again.</p> : null}
            <Button look="primary" size="large" className={box['cta']} onClick={() => void wallet?.connect()}>Sign in</Button>
          </>
        )}
      </div>
    </section>
  );
}
