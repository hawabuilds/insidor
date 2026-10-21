/**
 * THE TOKEN PAGE'S BODY — Trador's `AssetPage.tsx` for a launchpad coin, rebuilt in our CSS
 * modules and purple: the logo, ticker and name with the coin's own links beside them; the pair,
 * launchpad and fact chips; the address chip with copy and explorer; curve progress while on the
 * curve; the price, chart and timeframe rail; then, right under the interval row, the coin's
 * narrative as a slim card (NarrativeCard, which opens the narrative page), or with no narrative the
 * most-viewed feed post naming the coin at the same slim size (ViralPost, which opens the post sheet),
 * or nothing when there is neither; then Trades, Comments and Info under tabs that stick to the top
 * once the chart scrolls away, with the trades' small "All" filter menu at the right of that row; and
 * Buy and Sell pinned above the tab bar.
 *
 * ★ TWO WHOLE TRADES ABOVE BUY AND SELL ON A 390 BY 844 PHONE (the owner, 2026-10-17). The top half,
 * down to and including the interval row, is as it was; the card is 68px, the filter sits in the
 * tabs row, a trade is one 33px line, and the Buy and Sell bar is slimmer. Growing any of them
 * pushes the second trade under the bar. (The pair and venue chips now read the chart's pool, at
 * the same height; see below.)
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
 * ★ THE MARKET CAP IS THE SHARED ONE (shared/coin-cap.ts): each market read is noted against the
 * coin's address, and the header and Info tab show `useCoinCap` — price × the launchpad's supply
 * while a fresh price is held, else the coin's own read cap — the same figure the post sheet,
 * Choose coin and the For You card show for that coin. Until anything is read, the header holds a
 * small placeholder where the number goes, never "$0" or an empty space.
 *
 * ★ THE PAIR AND THE LIQUIDITY ARE THE CHART'S POOL'S (the owner, 2026-10-21, the one change to the
 * top half since): the pair chip names the token the pool pairs the coin with (MSTRx for Laura,
 * tagged "Stock"), the venue chip the pool's dex when that says something new, and "Liq" the pool's
 * depth. A SOL-paired coin on the launchpad looks as it did. See pair-view.ts.
 *
 * What breaks if changed carelessly: liquidity is the chart's pool's when read, else the coin's own
 * read, else the market profile's; an absent one is a dash with its reason, and only once the
 * profile has answered.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { fetchCoinAbout, fetchCoinMarket, fetchStory, type CoinAbout, type CoinMarket, type MarketTimeframe, type Story } from '../../shared/api/index.ts';
import { LIVE_POLL_MS, noteMarket } from '../../shared/coin-cap.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { useCoinCap } from '../../shared/useCoinCap.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { BackIcon, CopyIcon, ExternalIcon } from '../../shared/ui/icons.tsx';
import { Comments } from '../comments/Comments.tsx';
import { TradeBar } from '../trade/TradeBar.tsx';
import { defaultTimeframe } from './chart-data.ts';
import { CoinChart } from './CoinChart.tsx';
import { InfoPanel, latestPrice } from './InfoPanel.tsx';
import { SocialRow } from './SocialRow.tsx';
import { servedCap, type TokenFacts } from './token-facts.ts';
import { TapeFilterMenu, TradesPanel, tapeFilterFor } from './TradesPanel.tsx';
import type { TapeFilter } from './trades-view.ts';
import { ViralPost } from './ViralPost.tsx';
import { NarrativeCard } from './NarrativeCard.tsx';
import { narrativeIdFor } from './coin-narrative.ts';
import { pairChip, pairFrom, poolLiquidity, shownName, venueChip, type CoinListing, type PairChip, type PairRead } from './pair-view.ts';

export type { TokenFacts } from './token-facts.ts';
import styles from './token.module.css';
import { tickerText } from '../../shared/format/ticker.ts';
import { goBack } from '../../shared/nav.ts';
import type { Route } from '../../shared/route.ts';

type Panel = 'trades' | 'comments' | 'info';

const PANELS: readonly { readonly key: Panel; readonly label: string }[] = [
  { key: 'trades', label: 'Trades' },
  { key: 'comments', label: 'Comments' },
  { key: 'info', label: 'Info' },
];

/** How often an open token page reads its market again: the shared live cadence, so the cap moves with the price. The server keeps trades 12s. */
export const MARKET_POLL_MS = LIVE_POLL_MS;

/** "7xKXtg…sAsU": enough of each end to compare by eye, never presented as a label (Trador's shortAddress). */
export function shortAddress(a: string, lead = 6): string {
  return a.length <= lead + 6 ? a : `${a.slice(0, lead)}…${a.slice(-4)}`;
}

export function tradesNote(state: 'loading' | 'ready' | 'failed', market: CoinMarket | null): string {
  if (state === 'loading') return 'Loading trades';
  if (state === 'failed' || market?.kind === 'unavailable' || (market?.kind === 'read' && market.trades === null)) return 'Trades could not be read just now.';
  return 'No trades yet.';
}

export function TokenView({ facts, chips = [], notice = null, insidor = null, offBar, back = { screen: 'search' }, story = null }: {
  facts: TokenFacts;
  /** Fact chips after the pair and launchpad: "Created on Insidor" and the like. */
  chips?: readonly string[];
  /** A sample or unobserved narrative's notice, above everything: a fiction is labelled. */
  notice?: ReactNode;
  /** Insidor's part of the Info tab that only this page knows: the narrative and the coin's origin. */
  insidor?: ReactNode;
  /** What stands in for Buy and Sell while trading is off. */
  offBar: ReactNode;
  /** Where Back goes when nothing of ours is under this page (opened from a link or a notification). */
  back?: Route;
  /** The narrative the page was opened from, when it was; otherwise the coin's own is read. */
  story?: Story | null;
}) {
  const now = useNow();
  const toast = useToast();
  const { state: walletState } = useWallet();
  const account = walletState.kind === 'connected' ? walletState.account : null;
  const [tf, setTf] = useState<MarketTimeframe>(() =>
    defaultTimeframe({ onCurve: facts.venue === 'curve', launchedAt: facts.launchedAt.known ? facts.launchedAt.at : null, now: Date.now() }),
  );
  const [panel, setPanel] = useState<Panel>('trades');
  const [pickedTape, setTape] = useState<TapeFilter>('all');
  const tape = tapeFilterFor(pickedTape, account);
  const tabs = useRef<HTMLDivElement>(null);
  const [loaded, reload] = useLoad(`market:${facts.coinId}:${tf}`, (signal) => fetchCoinMarket(facts.coinId, tf, signal), 'memory');
  useEffect(() => {
    const timer = setInterval(reload, MARKET_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const market: CoinMarket | null = loaded.state === 'ready' ? loaded.value : null;
  /* Every read's price goes to the shared store, so every screen showing this coin agrees. */
  useEffect(() => {
    if (market !== null) noteMarket(facts.address, market, Date.now());
  }, [market, facts.address]);
  /* The links, day numbers, holders, creator and posts: read once when the page opens. */
  const [aboutLoad] = useLoad(`about:${facts.coinId}`, (signal) => fetchCoinAbout(facts.coinId, signal), 'phone');
  const about: CoinAbout | null = aboutLoad.state === 'ready' ? aboutLoad.value : null;
  /* The coin's narrative (coin-narrative.ts): the one the page came from, else the one the read
     service names for the coin, else the most-viewed naming post's. Read once it is known. */
  const narrativeId = story !== null ? null : narrativeIdFor(about);
  const [storyLoad] = useLoad(`coin-story:${narrativeId ?? ''}`, (signal) => (narrativeId === null ? Promise.resolve(null) : fetchStory(narrativeId, signal)));
  const narrative: Story | null = story ?? (storyLoad.state === 'ready' ? storyLoad.value : null);
  /* The post card stands in only once there is surely no narrative to show: none named, or it could not be read. */
  const noNarrative = story === null && about !== null && (narrativeId === null || storyLoad.state === 'failed');
  const read = market?.kind === 'read' ? market : null;
  const venue = read?.venue ?? facts.venue;
  const progress = read?.curveProgress?.known ? Math.min(100, Math.max(0, read.curveProgress.amount * 100)) : null;
  const cap = useCoinCap(facts.address, servedCap(facts, about), false, facts.price);
  /* Nothing read yet, from either source: a placeholder where the number goes. */
  const capWaiting = !cap.known && (loaded.state === 'loading' || aboutLoad.state === 'loading');
  /* The chart's pool (pair-view.ts): kept from the last read, so switching timeframe does not unknow it. */
  const [pair, setPair] = useState<PairRead>('unread');
  useEffect(() => setPair((kept) => pairFrom(market, kept)), [market]);
  const pairShown = pairChip(pair);
  const venueShown = venueChip(pair, facts.venueLabel, facts.address);
  const served: Measured | 'loading' = facts.liquidityUsd?.known === true ? facts.liquidityUsd : about !== null ? (about.liquidityUsd.known ? about.liquidityUsd : (facts.liquidityUsd ?? about.liquidityUsd)) : aboutLoad.state === 'loading' ? 'loading' : (facts.liquidityUsd ?? { known: false, pending: 'unreadable' });
  const liquidity = poolLiquidity(pair, served);
  /* The coin's name as its market lists it, over our name index's (pair-view.ts `shownName`). */
  const [listed, setListed] = useState<CoinListing | null>(null);
  useEffect(() => {
    if (market?.kind === 'read' && market.coin !== null) setListed(market.coin);
  }, [market]);
  const named = shownName(listed, facts.ticker, facts.name);
  const ticker = named.ticker ?? '—';

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
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => goBack(back)}>
        <BackIcon size={20} />
      </button>
      {notice}

      <div className={styles['head']}>
        <CoinLogo address={facts.address} ticker={named.ticker ?? named.name} imageUrl={facts.imageUrl} size={44} />
        <div className={styles['headText']}>
          <h1>{ticker}</h1>
          <div className={styles['name']}>{named.name ?? ''}</div>
        </div>
        {/* The coin's own links, aligned to the logo as Trador aligns them; none, no row. */}
        {about !== null ? <SocialRow links={about.links} /> : null}
      </div>

      <div className={styles['chips']}>
        <PairTag chip={pairShown} />
        <a className={styles['chip']} href={venueShown.url} target="_blank" rel="noopener noreferrer" title={`Open ${ticker} on ${venueShown.label}`}>
          {venueShown.label}
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

      <CoinChart market={market} state={loaded.state} tf={tf} onTf={setTf} price={facts.price} change24h={facts.change24h} cap={capWaiting ? 'loading' : cap} liquidity={liquidity} />

      {narrative !== null ? <NarrativeCard story={narrative} coinAddress={facts.address} /> : noNarrative && about !== null ? <ViralPost posts={about.posts} /> : null}

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
        {panel === 'trades' ? <TapeFilterMenu filter={tape} account={account} onPick={setTape} /> : null}
      </div>

      <div className={styles['panel']}>
        {panel === 'trades' ? <TradesPanel ticker={ticker} trades={read?.trades != null && read.trades.length > 0 ? read.trades : null} note={tradesNote(loaded.state, market)} account={account} now={now} filter={tape} /> : null}
        {panel === 'comments' ? <Comments subject={`coin:${facts.coinId}`} holdersOf={named.ticker !== null ? tickerText(named.ticker) : 'this coin'} about={ticker} /> : null}
        {panel === 'info' ? <InfoPanel facts={facts} market={market} about={about} tradable={facts.tradable} now={now} insidor={insidor} pair={pair} /> : null}
      </div>

      <TradeBar mint={facts.address} ticker={ticker} priceUsd={latestPrice(market) ?? facts.price} off={offBar} />
    </>
  );
}

/**
 * What the coin is priced in: "SOL" as Trador's PairTicker, or the token its pool pairs it with,
 * with that token's picture and, for a tokenised stock, a "Stock" tag. Before the first read, a
 * quiet bar holds the place: the page does not yet know, so it does not say.
 */
function PairTag({ chip }: { chip: PairChip }) {
  if (chip.kind === 'unread') return <span className={styles['pair']} aria-label="reading"><span className={styles['pairWait']} /></span>;
  if (chip.kind === 'sol') return <span className={styles['pair']} title="Priced in SOL">SOL</span>;
  return (
    <>
      <span className={`${styles['pair']} ${styles['pairToken']}`} title={`Priced in ${chip.ticker}`}>
        <CoinLogo address={chip.address} ticker={chip.ticker} imageUrl={chip.imageUrl} size={14} small />
        {chip.ticker}
      </span>
      {chip.stock ? <span className={`${styles['pair']} ${styles['pairStock']}`}>Stock</span> : null}
    </>
  );
}

/**
 * Trador's CurveProgress:how far along the launchpad's curve, the bar and its percentage side by
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
