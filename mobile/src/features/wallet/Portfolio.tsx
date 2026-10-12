/**
 * WHAT A WALLET HOLDS — Trador's Stonkfolio rebuilt in our style: the total in dollars and SOL,
 * the SOL balance, each coin with its value and move over the chosen range, its profit in SOL
 * when we can see what it cost, and the narrative it came from when the match is confident.
 *
 * ★ FACTS, AND A DASH FOR WHAT WE DO NOT KNOW. A coin no market prices has a dash for its value;
 * a coin with no buy history has "— no buy history"; a coin whose narrative match is not
 * confident shows no narrative at all. Coins past the list are counted, never hidden silently.
 *
 * Read-only: no key, no TRADING switch. Tapping a coin opens its token page.
 */

import { useState } from 'react';

import type { Holding, Portfolio as PortfolioData, PortfolioRange } from '../../shared/api/index.ts';
import { formatChangePercent, formatUsd } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { compactAmount, profitLine } from './wallet-view.ts';
import styles from './wallet.module.css';

const RANGES: readonly { readonly key: PortfolioRange; readonly label: string }[] = [
  { key: '1h', label: '1H' },
  { key: '6h', label: '6H' },
  { key: '24h', label: '24H' },
];

const sol = (m: { known: boolean; amount?: number }): string => (m.known && m.amount !== undefined ? `${m.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} SOL` : '—');

export function Portfolio({ data, range, onRange }: { data: PortfolioData; range: PortfolioRange; onRange: (r: PortfolioRange) => void }) {
  if (data.kind === 'unavailable') return <p className={styles['line']}>— what this wallet holds could not be read just now.</p>;
  return (
    <>
      <div className={styles['totals']}>
        <span className={styles['kicker']}>Total value</span>
        <Value r={formatUsd(data.totalUsd)} className={styles['total']} />
        <span className={styles['sub']}>{sol(data.totalSol)}</span>
        <span className={styles['sub']}>SOL balance {sol(data.solBalance)}</span>
      </div>

      <div className={styles['headRow']}>
        <h2 className={styles['section']}>Coins</h2>
        <div className={styles['ranges']} role="group" aria-label="Price move over">
          {RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={r.key === range} className={r.key === range ? styles['on'] : ''} onClick={() => onRange(r.key)}>{r.label}</button>
          ))}
        </div>
      </div>
      {data.holdings.length === 0 ? <p className={styles['line']}>No coins in this wallet.</p> : null}
      {data.holdings.map((h) => <Row key={h.address} h={h} />)}
      {data.notShown > 0 ? <p className={styles['line']}>{data.notShown.toLocaleString('en-US')} more coins not shown{data.unpriced > 0 ? `, ${data.unpriced.toLocaleString('en-US')} with no market price` : ''}.</p> : null}
      <p className={styles['line']}>Profit is counted from this wallet's last {data.historyDepth} transactions, in SOL.</p>

      <h2 className={styles['section']}>Coins you created</h2>
      {data.created.coins.length === 0 ? (
        <p className={styles['line']}>None yet.</p>
      ) : (
        <>
          {data.created.coins.map((c) => (
            <a key={c.address} className={styles['row']} href={hrefFor({ screen: 'token', coinId: c.coinId })}>
              <Thumb url={null} size={40} round letter={(c.ticker ?? '?').charAt(0)} />
              <span className={styles['rowText']}>
                <b>{c.ticker ?? '—'}</b>
                <span className={styles['dim']}>Created on Insidor</span>
              </span>
              <span className={styles['rowRight']}><Value r={formatUsd(c.marketCapUsd)} /><small>market cap</small></span>
            </a>
          ))}
          <p className={styles['line']}>Unclaimed creator fees {sol(data.created.unclaimedFeesSol)}</p>
        </>
      )}
    </>
  );
}

function Row({ h }: { h: Holding }) {
  const change = formatChangePercent(h.change);
  const p = profitLine(h.profit);
  return (
    <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: h.coinId })}>
      <Thumb url={h.imageUrl} size={40} round letter={(h.ticker ?? '?').charAt(0)} />
      <span className={styles['rowText']}>
        <b>{h.ticker ?? '—'}</b>
        <span className={styles['dim']}>{compactAmount(h.amount, h.decimals)}</span>
        {h.story !== null ? <span className={styles['story']}>From {h.story.title}</span> : null}
      </span>
      <span className={styles['rowRight']}>
        <Value r={formatUsd(h.valueUsd)} />
        <span className={change.direction === 'up' ? styles['up'] : change.direction === 'down' ? styles['down'] : styles['dim']}>
          {change.direction === 'up' ? '▲ ' : change.direction === 'down' ? '▼ ' : ''}<Value r={change.text} />
        </span>
        <small className={p.tone === 'up' ? styles['up'] : p.tone === 'down' ? styles['down'] : styles['dim']}>{p.text}</small>
      </span>
    </a>
  );
}

export function usePortfolioRange(): [PortfolioRange, (r: PortfolioRange) => void] {
  return useState<PortfolioRange>('24h');
}
