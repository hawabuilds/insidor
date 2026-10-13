/**
 * BUY AND SELL ON A COIN'S PAGE — Trador's `TradeBar.tsx`: the pair pinned above the tab bar,
 * floating on a blurred panel so the action stays in reach while someone reads the trades,
 * comments and info below the fold. Buy is a green wash with green text, Sell the same in red.
 *
 * ★ ONLY WHEN TRADING IS ON (shared/trading.ts). Off, the page's own stand-in shows instead
 * (`off`: "Coming soon", or a line). On, the coin's venue is read first, with the gate's limits;
 * the buttons appear only when a trade can work, and in their place the bar says why when not
 * ("Checking where it trades", "Can't be traded right now") — never a button that cannot work.
 *
 * Not on posts or narrative rows: there, Buy appears only for a confident match, by the rules in
 * shared/coin-status.ts, and opens this page rather than a sheet.
 */

import { useState, type ReactNode } from 'react';

import { fetchTradeVenue } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { useLoad } from '../../shared/hooks.ts';
import { tradingOn } from '../../shared/trading.ts';
import { availability } from './order-flow.ts';
import { OrderSheet } from './OrderSheet.tsx';
import styles from './trade.module.css';

/* Read once, at build time: VITE_TRADING is baked into the bundle, so a deploy turns it on, never a page. */
const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

export function TradeBar({ mint, ticker, priceUsd, off }: { mint: string; ticker: string; priceUsd: Measured; off: ReactNode }) {
  if (!TRADING) return <>{off}</>;
  return <OpenBar mint={mint} ticker={ticker} priceUsd={priceUsd} />;
}

function OpenBar({ mint, ticker, priceUsd }: { mint: string; ticker: string; priceUsd: Measured }) {
  const [venue] = useLoad(`venue:${mint}`, (signal) => fetchTradeVenue(mint, signal));
  const [side, setSide] = useState<'buy' | 'sell' | null>(null);
  const a = availability(true, venue.state === 'ready' ? venue.value.venue : venue.state === 'failed' ? 'unavailable' : 'loading');
  const limits = venue.state === 'ready' ? venue.value.limits : null;
  return (
    <>
      {a.kind === 'open' ? (
        <TradeButtons ticker={ticker} onBuy={() => setSide('buy')} onSell={() => setSide('sell')} />
      ) : (
        <div className={styles['bar']}>
          <div className={styles['panel']}>
            <p className={styles['why']}>{a.kind === 'checking' ? 'Checking where it trades' : a.kind === 'closed' ? a.line : ''}</p>
          </div>
        </div>
      )}
      {side !== null ? <OrderSheet key={side} mint={mint} ticker={ticker} side={side} limits={limits} priceUsd={priceUsd} onClose={() => setSide(null)} /> : null}
    </>
  );
}

/** The pinned pair itself, Trador's look: also what a page shows while trading is off ("Coming soon"). */
export function TradeButtons({ ticker, onBuy, onSell }: { ticker: string; onBuy: () => void; onSell: () => void }) {
  return (
    <div className={styles['bar']}>
      <div className={styles['panel']}>
        <button type="button" className={styles['buy']} aria-label={`Buy ${ticker}`} onClick={onBuy}>Buy</button>
        <button type="button" className={styles['sell']} aria-label={`Sell ${ticker}`} onClick={onSell}>Sell</button>
      </div>
    </div>
  );
}
