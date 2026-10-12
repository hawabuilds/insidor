/**
 * A COIN OPENED FROM SEARCH. The token page without a narrative around it: what the search
 * said about the coin (or what chainwatch recorded), and its market read live — price history,
 * the latest trades, and how far along its curve it is.
 *
 * ★ NO NARRATIVE. A search result is a coin with that name and nothing more, so this page names
 * no narrative. It is a page the person opened themselves, so once trading is on it offers Buy
 * and Sell like any coin with somewhere to trade (features/trade/TradeBar.tsx) — and "Can't be
 * traded right now" for one without, never a broken button.
 */

import { useEffect, useState } from 'react';
import { fetchCoinMarket, fetchSearchedCoin, type CoinMarket, type MarketTimeframe, type SearchedCoin } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount, formatUsd } from '../../shared/format/number.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon, CandleIcon, CopyIcon, LineChartIcon } from '../../shared/ui/icons.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { TradeBar } from '../trade/TradeBar.tsx';
import { CandleChart } from './CandleChart.tsx';
import { PriceChart } from './PriceChart.tsx';
import { directionOf } from './direction.ts';
import { chartNote, MARKET_POLL_MS, shortAddress, TIMEFRAMES, Trades, tradesNote } from './TokenPage.tsx';
import styles from './token.module.css';

export function SearchedToken({ coinId }: { coinId: string }) {
  const [coin] = useLoad(`searched:${coinId}`, (signal) => fetchSearchedCoin(coinId, signal));
  return (
    <section className={styles['page']}>
      <div className={styles['top']}>
        <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
          <BackIcon size={22} />
        </button>
      </div>
      {coin.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {coin.state === 'failed' ? <p className={styles['note']}>This coin couldn't be opened. Search for it again.</p> : null}
      {coin.state === 'ready' ? <Body coin={coin.value} /> : null}
    </section>
  );
}

function Body({ coin }: { coin: SearchedCoin }) {
  const now = useNow();
  const toast = useToast();
  const [tf, setTf] = useState<MarketTimeframe>('1h');
  const [kind, setKind] = useState<'line' | 'candles'>('line');
  const [section, setSection] = useState<'trades' | 'info'>('trades');
  const [loaded, reload] = useLoad(`market:search:${coin.coinId}:${tf}`, (signal) => fetchCoinMarket(coin.coinId, tf, signal));
  useEffect(() => {
    const timer = setInterval(reload, MARKET_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const market: CoinMarket | null = loaded.state === 'ready' ? loaded.value : null;
  const read = market?.kind === 'read' ? market : null;
  const series = read?.candles?.map((c) => c.c) ?? [];
  const progress = read?.curveProgress?.known ? Math.round(read.curveProgress.amount * 1000) / 10 : null;
  const venue = read?.venue ?? coin.venue;
  const ticker = coin.ticker ?? '—';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coin.address);
      toast('Address copied');
    } catch {
      toast('Could not copy', 'Select the address under Info instead.');
    }
  };

  return (
    <>
      <div className={styles['coinHead']}>
        <Thumb url={coin.imageUrl} size={44} round letter={ticker.charAt(0)} />
        <div>
          <h1>{ticker}</h1>
          <span className={styles['name']}>{coin.name ?? ''}</span>
        </div>
      </div>

      <div className={styles['chips']}>
        <span className={styles['chip']}>SOL</span>
        <span className={`${styles['chip']} ${styles['chipBold']}`}>pump.fun</span>
        <span className={styles['chip']}>{venue === 'pool' ? 'Bonded' : venue === 'curve' ? 'On curve' : 'Not listed yet'}</span>
      </div>
      <button type="button" className={styles['address']} onClick={() => void copy()} aria-label={`Copy address ${coin.address}`}>
        {shortAddress(coin.address)} <CopyIcon size={13} />
      </button>

      {read?.curveProgress != null ? (
        <div className={styles['curve']} aria-label="Bonding curve progress">
          <span className={styles['curveTrack']}>
            <span className={styles['curveFill']} style={{ width: `${progress ?? 0}%` }} />
          </span>
          {progress === null ? <Value r={formatCount(read.curveProgress)} /> : <span>{progress}% of the curve</span>}
        </div>
      ) : null}

      <div className={styles['priceRow']}>
        <div className={styles['cap']}>
          <span className={styles['kicker']}>Market cap</span>
          <Value r={formatUsd(coin.marketCapUsd)} className={styles['capN']} />
        </div>
      </div>

      {series.length > 1 ? (
        kind === 'line' ? <PriceChart series={series} direction={directionOf(series)} /> : <CandleChart candles={read?.candles ?? []} />
      ) : (
        <p className={styles['note']}>{chartNote(loaded.state, market)}</p>
      )}
      {market !== null ? (
        <div className={styles['tfRow']}>
          <div className={styles['tfs']}>
            {TIMEFRAMES.map((t) => (
              <button key={t} type="button" className={`${styles['tfButton']} ${t === tf ? styles['tfOn'] : ''}`} onClick={() => setTf(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div className={styles['kinds']}>
            <button type="button" className={kind === 'line' ? styles['kindOn'] : ''} aria-label="Line chart" aria-pressed={kind === 'line'} onClick={() => setKind('line')}><LineChartIcon size={16} /></button>
            <button type="button" className={kind === 'candles' ? styles['kindOn'] : ''} aria-label="Candle chart" aria-pressed={kind === 'candles'} onClick={() => setKind('candles')}><CandleIcon size={16} /></button>
          </div>
        </div>
      ) : null}

      <UnderlineTabs
        label="Coin"
        current={section}
        onChange={setSection}
        tabs={[
          { key: 'trades', label: 'Trades' },
          { key: 'info', label: 'Info' },
        ]}
      />
      {section === 'trades' ? (read?.trades != null && read.trades.length > 0 ? <Trades ticker={ticker} trades={read.trades} now={now} /> : <p className={styles['note']}>{tradesNote(loaded.state, market)}</p>) : null}
      {section === 'info' ? (
        <dl className={styles['info']}>
          <div><dt>Name</dt><dd>{coin.name ?? '—'}</dd></div>
          <div><dt>Ticker</dt><dd>{ticker}</dd></div>
          <div><dt>Launched</dt><dd><Value r={formatAge(coin.launchedAt, now)} /></dd></div>
          <div><dt>Address</dt><dd className={styles['mono']}>{coin.address}</dd></div>
        </dl>
      ) : null}

      <TradeBar
        mint={coin.address}
        ticker={ticker}
        off={<p className={styles['note']}>Opened from search. Buying and selling are coming soon.</p>}
      />
    </>
  );
}
