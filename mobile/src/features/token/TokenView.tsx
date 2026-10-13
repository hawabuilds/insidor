/**
 * THE TOKEN PAGE'S BODY — Trador's `AssetPage.tsx` for a launchpad coin, rebuilt in our CSS
 * modules and purple: the logo, ticker and name with the coin's own links beside them; the pair,
 * launchpad and fact chips; the address chip with copy and explorer; curve progress while on the
 * curve; the price, chart and timeframe rail; then Trades, Comments and Info under tabs that stick
 * to the top once the chart scrolls away; and Buy and Sell pinned above the tab bar.
 *
 * ★ ONE BODY FOR BOTH WAYS IN. A coin opened from a narrative (TokenPage) and one opened from
 * Search (SearchedToken) are the same page, as Trador's one AssetPage is for every coin: they
 * differ only in what they already know (the narrative's facts, its labels, its notice) and in
 * the Insidor part of the Info tab. Two copies drifted before; this file is the one.
 *
 * Trador's stock half (sector, issuer, "Company cap", About, the watch star for stocks) has no
 * place here and is not ported. The market is read now and every MARKET_POLL_MS while open, so
 * the tape and the chart's last candle move live, as Trador's poll does.
 *
 * What breaks if changed carelessly: the market cap and liquidity shown are the coin's own read
 * (`facts`), scaled to the shown price by CoinChart; an absent one is a dash with its reason.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { fetchCoinAbout, fetchCoinMarket, type CoinAbout, type CoinMarket, type MarketTimeframe } from '../../shared/api/index.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { BackIcon, CopyIcon, ExternalIcon } from '../../shared/ui/icons.tsx';
import { Comments } from '../comments/Comments.tsx';
import { TradeBar } from '../trade/TradeBar.tsx';
import { defaultTimeframe } from './chart-data.ts';
import { CoinChart } from './CoinChart.tsx';
import { InfoPanel } from './InfoPanel.tsx';
import { SocialRow } from './SocialRow.tsx';
import type { TokenFacts } from './token-facts.ts';
import { TradesPanel } from './TradesPanel.tsx';

export type { TokenFacts } from './token-facts.ts';
import styles from './token.module.css';

type Panel = 'trades' | 'comments' | 'info';

const PANELS: readonly { readonly key: Panel; readonly label: string }[] = [
  { key: 'trades', label: 'Trades' },
  { key: 'comments', label: 'Comments' },
  { key: 'info', label: 'Info' },
];

/** How often an open token page reads its market again: Trador's tape cadence. The server keeps trades 12s. */
export const MARKET_POLL_MS = 12_000;

/** "7xKXtg…sAsU": enough of each end to compare by eye, never presented as a label (Trador's shortAddress). */
export function shortAddress(a: string, lead = 6): string {
  return a.length <= lead + 6 ? a : `${a.slice(0, lead)}…${a.slice(-4)}`;
}

export function tradesNote(state: 'loading' | 'ready' | 'failed', market: CoinMarket | null): string {
  if (state === 'loading') return 'Loading trades';
  if (state === 'failed' || market?.kind === 'unavailable' || (market?.kind === 'read' && market.trades === null)) return 'Trades could not be read just now.';
  return 'No trades yet.';
}

export function TokenView({ facts, chips = [], notice = null, insidor = null, offBar }: {
  facts: TokenFacts;
  /** Fact chips after the pair and launchpad: "Created on Insidor" and the like. */
  chips?: readonly string[];
  /** A sample or unobserved narrative's notice, above everything: a fiction is labelled. */
  notice?: ReactNode;
  /** Insidor's part of the Info tab that only this page knows: the narrative and the coin's origin. */
  insidor?: ReactNode;
  /** What stands in for Buy and Sell while trading is off. */
  offBar: ReactNode;
}) {
  const now = useNow();
  const toast = useToast();
  const { state: walletState } = useWallet();
  const account = walletState.kind === 'connected' ? walletState.account : null;
  const ticker = facts.ticker ?? '—';
  const [tf, setTf] = useState<MarketTimeframe>(() =>
    defaultTimeframe({ onCurve: facts.venue === 'curve', launchedAt: facts.launchedAt.known ? facts.launchedAt.at : null, now: Date.now() }),
  );
  const [panel, setPanel] = useState<Panel>('trades');
  const tabs = useRef<HTMLDivElement>(null);
  const [loaded, reload] = useLoad(`market:${facts.coinId}:${tf}`, (signal) => fetchCoinMarket(facts.coinId, tf, signal));
  useEffect(() => {
    const timer = setInterval(reload, MARKET_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const market: CoinMarket | null = loaded.state === 'ready' ? loaded.value : null;
  /* The links, day numbers, holders, creator and posts: read once when the page opens. */
  const [aboutLoad] = useLoad(`about:${facts.coinId}`, (signal) => fetchCoinAbout(facts.coinId, signal));
  const about: CoinAbout | null = aboutLoad.state === 'ready' ? aboutLoad.value : null;
  const read = market?.kind === 'read' ? market : null;
  const venue = read?.venue ?? facts.venue;
  const progress = read?.curveProgress?.known ? Math.min(100, Math.max(0, read.curveProgress.amount * 100)) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(facts.address);
      toast('Address copied');
    } catch {
      toast('Could not copy', 'Select the address under Info instead.');
    }
  };

  return (
    <>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
        <BackIcon size={20} />
      </button>
      {notice}

      <div className={styles['head']}>
        <CoinLogo address={facts.address} ticker={facts.ticker ?? facts.name} imageUrl={facts.imageUrl} size={44} />
        <div className={styles['headText']}>
          <h1>{ticker}</h1>
          <div className={styles['name']}>{facts.name ?? ''}</div>
        </div>
        {/* The coin's own links, aligned to the logo as Trador aligns them; none, no row. */}
        {about !== null ? <SocialRow links={about.links} /> : null}
      </div>

      <div className={styles['chips']}>
        <span className={styles['pair']} title="Priced in SOL">SOL</span>
        <a className={styles['chip']} href={`https://pump.fun/coin/${facts.address}`} target="_blank" rel="noopener noreferrer" title={`Open ${ticker} on ${facts.venueLabel}`}>
          {facts.venueLabel}
        </a>
        {chips.map((c) => (
          <span key={c} className={`${styles['chip']} ${styles['chipBrand']}`}>{c}</span>
        ))}
      </div>

      <div className={styles['mintRow']}>
        <span className={styles['mint']}>
          <span className={styles['mono']}>{shortAddress(facts.address, 5)}</span>
          <button type="button" onClick={() => void copy()} aria-label="Copy mint address"><CopyIcon size={12} /></button>
          <a href={`https://solscan.io/token/${facts.address}`} target="_blank" rel="noopener noreferrer" aria-label="View mint on the explorer"><ExternalIcon size={12} /></a>
        </span>
      </div>

      {venue === 'curve' && progress !== null ? <CurveProgress pct={progress} /> : null}

      <CoinChart market={market} state={loaded.state} tf={tf} onTf={setTf} price={facts.price} change24h={facts.change24h} cap={facts.marketCapUsd} liquidity={facts.liquidityUsd} />

      {/* Stuck under the top once the chart scrolls away; a second tap on the open tab returns to it. */}
      <div ref={tabs} className={styles['panelTabs']} role="tablist" aria-label="Coin">
        {PANELS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={p.key === panel}
            className={p.key === panel ? styles['panelTabOn'] : ''}
            onClick={() => (p.key === panel ? tabs.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : setPanel(p.key))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles['panel']}>
        {panel === 'trades' ? <TradesPanel ticker={ticker} trades={read?.trades != null && read.trades.length > 0 ? read.trades : null} note={tradesNote(loaded.state, market)} account={account} now={now} /> : null}
        {panel === 'comments' ? <Comments subject={`coin:${facts.coinId}`} holdersOf={facts.ticker !== null ? `$${facts.ticker}` : 'this coin'} /> : null}
        {panel === 'info' ? <InfoPanel facts={facts} market={market} about={about} tradable={facts.tradable} now={now} insidor={insidor} /> : null}
      </div>

      <TradeBar mint={facts.address} ticker={ticker} off={offBar} />
    </>
  );
}

/**
 * Trador's CurveProgress: how far along the launchpad's curve, the bar and its percentage side by
 * side (length alone is a comparison, the question is absolute). Green from halfway, as Trador's.
 */
export function CurveProgress({ pct }: { pct: number }) {
  const close = pct >= 50;
  return (
    <div className={styles['curve']}>
      <div className={styles['curveTrack']} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to bonding">
        <div className={close ? styles['curveFillUp'] : styles['curveFill']} style={{ width: `${pct}%` }} />
      </div>
      <span className={close ? styles['up'] : styles['curvePct']}>{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
    </div>
  );
}
