/**
 * BUY AND SELL ON A TOKEN PAGE THE PERSON OPENED THEMSELVES — from a narrative's coins or from
 * Search. With TRADING off this renders whatever the page showed before (`off`); with it on, the
 * coin's venue is checked first and the buttons appear only when a trade can work.
 *
 * Not on posts or narrative rows: there, Buy still appears only for a confident match, by the
 * rules in shared/coin-status.ts, and opens this page rather than a sheet.
 */

import { useState, type ReactNode } from 'react';

import { fetchTradeVenue } from '../../shared/api/index.ts';
import { useLoad } from '../../shared/hooks.ts';
import { tradingOn } from '../../shared/trading.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { availability } from './order-flow.ts';
import { OrderSheet } from './OrderSheet.tsx';
import styles from './trade.module.css';

/* Read once, at build time: VITE_TRADING is baked into the bundle, so a deploy turns it on, never a page. */
const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

export function TradeBar({ mint, ticker, off }: { mint: string; ticker: string; off: ReactNode }) {
  if (!TRADING) return <>{off}</>;
  return <OpenBar mint={mint} ticker={ticker} />;
}

function OpenBar({ mint, ticker }: { mint: string; ticker: string }) {
  const [venue] = useLoad(`venue:${mint}`, (signal) => fetchTradeVenue(mint, signal));
  const [side, setSide] = useState<'buy' | 'sell' | null>(null);
  const a = availability(true, venue.state === 'ready' ? venue.value : venue.state === 'failed' ? 'unavailable' : 'loading');
  if (a.kind === 'checking') return <p className={styles['note']}>Checking where it trades.</p>;
  if (a.kind !== 'open') return <p className={styles['note']}>{a.kind === 'closed' ? a.line : ''}</p>;
  return (
    <>
      <div className={styles['bar']}>
        <Button look="buy" size="large" onClick={() => setSide('buy')}>Buy</Button>
        <Button look="sell" size="large" onClick={() => setSide('sell')}>Sell</Button>
      </div>
      {side !== null ? <OrderSheet key={side} mint={mint} ticker={ticker} side={side} onClose={() => setSide(null)} /> : null}
    </>
  );
}
