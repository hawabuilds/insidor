/**
 * THE WALLET TAB — Trador's Stonkfolio, in Insidor: who you are, what your wallet holds and what
 * it is worth (Portfolio.tsx), Send and Receive, and the profile menu top right (ProfileMenu.tsx).
 *
 * ★ NOBODY SIGNS IN HERE. The front door is the only sign-in (shared/sign-in.ts gates the whole
 * app), so this tab is only ever reached signed in — or in the demo build. Signing out is in the
 * profile menu, and returns to the door.
 *
 * Sign-in creates a Solana wallet for anyone who has none (the vendor holds it; we never see a
 * key, and there is no screen to import or export one). The tab only ever reads the signed-in
 * person's own wallet. A build with no sign-in shows a recorded public wallet, labelled as
 * sample data, as Trador's demo mode does; it is never presented as anyone's own.
 *
 * ★ SEND ONLY WITH TRADING ON. Receive is always there (it is an address); Send appears only in a
 * build with TRADING on, never as a disabled button.
 */

import { useState } from 'react';

import { SAMPLE_SCREENS, fetchPortfolio, fetchWalletHistory, loadSamplePortfolio, type Holding, type Portfolio as PortfolioData } from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { SAMPLE_WALLET } from '../../shared/notice.ts';
import { tradingOn } from '../../shared/trading.ts';
import { Notice } from '../../shared/ui/Notice.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { useWallet } from '../../shared/wallet.tsx';
import { forgetEntered } from '../landing/entered.ts';
import { Portfolio, type ChartRange, type WhoAmI } from './Portfolio.tsx';
import { ProfileMenu } from './ProfileMenu.tsx';
import { withLive, type BalancePoint } from './balance-points.ts';
import { ReceiveSheet } from './ReceiveSheet.tsx';
import { SendSheet } from './SendSheet.tsx';
import styles from './portfolio.module.css';
import box from './wallet.module.css';

/* Read once, at build time, like the trade bar: a deploy turns Send on, never a page. */
const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

/** The address of the recorded sample wallet; shown only with the "Sample data" notice. */
const SAMPLE_ADDRESS = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

function Loaded({ who, load, history, canAct, exportKey, leave }: {
  who: WhoAmI;
  load: (signal: AbortSignal) => Promise<PortfolioData>;
  history: (signal: AbortSignal, range: ChartRange) => Promise<readonly BalancePoint[]>;
  canAct: boolean;
  exportKey: (() => void) | null;
  leave: { readonly label: string; readonly run: () => void };
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
        menu={
          <ProfileMenu
            name={who.name ?? who.handle ?? 'Your wallet'}
            subtitle={who.handle !== null ? `@${who.handle}` : canAct ? 'Signed in' : 'Sample data'}
            address={who.address}
            onCopy={() => void copy()}
            exportKey={exportKey}
            leave={leave}
          />
        }
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

export function PortfolioScreen() {
  const { wallet, state } = useWallet();
  const toast = useToast();
  /* The provider's own window; we hear only whether it opened. */
  const exportKey = () => {
    void wallet?.showKeyExport().then((outcome) => {
      if (outcome !== 'shown') toast("Couldn't open the export", 'Try again in a moment.');
    });
  };

  if (state.kind === 'connected' || state.kind === 'wrong-network') {
    const id = wallet?.identity() ?? null;
    const who: WhoAmI = { name: id?.name ?? null, handle: id?.handle ?? null, pictureUrl: id?.pictureUrl ?? null, address: state.account };
    return (
      <Loaded
        who={who}
        canAct
        load={(signal) => fetchPortfolio(state.account, '24h', signal)}
        history={(signal, range) => fetchWalletHistory(state.account, range, signal)}
        exportKey={exportKey}
        leave={{ label: 'Sign out', run: () => void wallet?.disconnect() }}
      />
    );
  }

  /* Only the demo build gets here: the gate lets nobody else in signed out. */
  const leaveDemo = {
    label: 'Leave the demo',
    run: () => {
      forgetEntered();
      window.location.reload();
    },
  };
  if (SAMPLE_SCREENS) {
    return <Loaded who={{ name: 'Sample wallet', handle: null, pictureUrl: null, address: SAMPLE_ADDRESS }} canAct={false} load={() => loadSamplePortfolio()} history={async () => []} exportKey={null} leave={leaveDemo} />;
  }
  return (
    <section className={box['screen']}>
      <p className={box['note']}>This build has no sign-in, so there is no wallet to show.</p>
    </section>
  );
}
