/**
 * WHAT A WALLET HOLDS — Trador's Stonkfolio, its layout kept, without the pie chart and the
 * Stonks/Stocks split: who you are, the portfolio value with your SOL and what is not priced,
 * Send and Receive, the chart's place, and one row per coin.
 *
 * ★ FACTS, AND A DASH FOR WHAT WE DO NOT KNOW. A coin no market prices says "Unpriced" (it is not
 * worth zero); a coin with no buy history says so under its value; a coin's narrative appears only
 * on a confident match. Coins past the list are counted, never dropped silently.
 *
 * ★ THE CHART HAS NO HISTORY YET, AND SAYS SO. Trador draws the balance line from snapshots it
 * records each time the wallet is read; Insidor records none yet, so the chart's place holds
 * Trador's own "not available" note rather than a line drawn from nothing.
 *
 * Read-only: no key, no TRADING switch. Tapping a coin opens its token page.
 */

import type { ReactNode } from 'react';

import type { Holding, Portfolio as PortfolioData, PortfolioRange } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { formatPrice, formatUsd } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from './Avatar.tsx';
import { compactAmount, profitLine } from './wallet-view.ts';
import styles from './portfolio.module.css';

const RANGES: readonly { readonly key: PortfolioRange; readonly label: string }[] = [
  { key: '1h', label: '1H' },
  { key: '6h', label: '6H' },
  { key: '24h', label: '24H' },
];

const solText = (m: Measured): string => (m.known ? m.amount.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—');

export interface WhoAmI {
  readonly name: string | null;
  readonly handle: string | null;
  readonly pictureUrl: string | null;
  readonly address: string;
}

/** "86xCn…o2MMY": five of each end, as Trador shows it. */
const shortAddress = (a: string): string => (a.length <= 12 ? a : `${a.slice(0, 5)}…${a.slice(-5)}`);

export function Portfolio({
  who, data, range, onRange, copied, onCopy, actions, notice, footer = null,
}: {
  who: WhoAmI;
  data: PortfolioData | null;
  range: PortfolioRange;
  onRange: (r: PortfolioRange) => void;
  copied: boolean;
  onCopy: () => void;
  /** Send and Receive, as the screen decides to offer them. */
  actions: ReactNode;
  notice: ReactNode;
  footer?: ReactNode;
}) {
  const read = data !== null && data.kind === 'read' ? data : null;
  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <div className={styles['who']}>
          <Avatar name={who.name ?? who.handle} seed={who.address} src={who.pictureUrl} size={46} />
          <div className={styles['whoText']}>
            <h1 className={styles['name']}>{who.name ?? who.handle ?? 'Wallet'}</h1>
            <div className={styles['ids']}>
              {who.handle !== null ? <span className={styles['handle']}>@{who.handle}</span> : null}
              <button type="button" className={styles['copy']} onClick={onCopy} aria-label={`Copy address ${who.address}`}>
                <span className={styles['mono']}>{copied ? 'Copied' : shortAddress(who.address)}</span>
                <CopyGlyph />
              </button>
            </div>
          </div>
        </div>

        <div className={styles['value']}>
          <div className={styles['label']}>Portfolio value</div>
          <div className={styles['big']}>{read === null ? '—' : <Value r={formatUsd(read.totalUsd)} />}</div>
          {read !== null ? (
            <div className={styles['subline']}>
              <span>{solText(read.solBalance)} SOL</span>
              {read.unpriced > 0 ? <span>{read.unpriced.toLocaleString('en-US')} not priced here</span> : null}
            </div>
          ) : null}
        </div>

        {actions}

        <div className={styles['controls']}>
          <div role="group" aria-label="Price move over" className={styles['pills']}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={r.key === range} className={r.key === range ? styles['pillOn'] : styles['pill']} onClick={() => onRange(r.key)}>{r.label}</button>
            ))}
          </div>
        </div>
      </header>

      <div className={styles['chart']}>
        <p>Balance history is not available yet. Your live total above still reflects what the chain holds right now.</p>
      </div>

      {notice}

      {data === null ? (
        <ul className={styles['list']}>
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className={styles['skeleton']}><span className={styles['skDot']} /><span className={styles['skLines']}><span /><span /></span><span className={styles['skBox']} /></li>
          ))}
        </ul>
      ) : data.kind === 'unavailable' ? (
        <p className={styles['empty']}>— what this wallet holds could not be read just now.</p>
      ) : data.holdings.length === 0 ? (
        <div className={styles['nothing']}>
          <b>Nothing here yet</b>
          <p>Buy a coin from a narrative and it shows up here.</p>
        </div>
      ) : (
        <ul className={styles['list']}>
          {data.holdings.map((h) => <li key={h.address}><Row h={h} /></li>)}
        </ul>
      )}

      {read !== null && read.notShown > 0 ? <p className={styles['foot']}>{read.notShown.toLocaleString('en-US')} more coins not shown.</p> : null}
      {read !== null ? <p className={styles['foot']}>Profit is counted in SOL, from this wallet's last {read.historyDepth} transactions.</p> : null}

      {read !== null && read.created.coins.length > 0 ? (
        <>
          <h2 className={styles['section']}>Coins you created</h2>
          <ul className={styles['list']}>
            {read.created.coins.map((c) => (
              <li key={c.address}>
                <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: c.coinId })}>
                  <Avatar name={c.ticker} seed={c.address} src={null} size={36} />
                  <div className={styles['mid']}>
                    <div className={styles['symbolRow']}><span className={styles['symbol']}>{c.ticker ?? '—'}</span><span className={styles['pair']}>Created on Insidor</span></div>
                    <div className={styles['units']}>Market cap</div>
                  </div>
                  <div className={styles['right']}><div className={styles['worth']}><Value r={formatUsd(c.marketCapUsd)} /></div></div>
                </a>
              </li>
            ))}
          </ul>
          <p className={styles['foot']}>Unclaimed creator fees {read.created.unclaimedFeesSol.known ? `${read.created.unclaimedFeesSol.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL` : '—'}</p>
        </>
      ) : null}
      {footer}
    </div>
  );
}

/** One holding, Trador's HoldingRow: picture, symbol with its pair, amount and price; value, move, profit. */
function Row({ h }: { h: Holding }) {
  const symbol = h.ticker ?? '—';
  const p = profitLine(h.profit);
  const priced = h.valueUsd.known;
  return (
    <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: h.coinId })}>
      <Avatar name={symbol} seed={h.address} src={h.imageUrl} size={36} />
      <div className={styles['mid']}>
        <div className={styles['symbolRow']}>
          <span className={styles['symbol']}>{symbol}</span>
          <span className={styles['pair']}>SOL</span>
        </div>
        <div className={styles['units']}>
          {compactAmount(h.amount, h.decimals)} {symbol}&nbsp;&nbsp;&nbsp;<Value r={formatPrice(h.priceUsd)} />
        </div>
        {h.story !== null ? <span className={styles['story']}>From {h.story.title}</span> : null}
      </div>
      <div className={styles['right']}>
        <div className={priced ? styles['worth'] : `${styles['worth']} ${styles['faint']}`}>
          {/* Unpriced says so. It is not worth zero. */}
          {priced ? <Value r={formatUsd(h.valueUsd)} /> : 'Unpriced'}
        </div>
        {h.change.known ? (
          /* Trador's PriceDelta: the glyph and the sign, never colour alone. */
          <div className={h.change.amount < 0 ? styles['down'] : styles['up']}>
            {h.change.amount < 0 ? `▼ ${Math.abs(h.change.amount).toFixed(2)}%` : `▲ +${h.change.amount.toFixed(2)}%`}
          </div>
        ) : null}
        <div className={p.tone === 'up' ? styles['up'] : p.tone === 'down' ? styles['down'] : styles['faintSmall']}>{p.text}</div>
      </div>
    </a>
  );
}

function CopyGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
