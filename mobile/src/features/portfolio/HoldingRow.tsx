/**
 * ONE HOLDING — Trador's HoldingRow: the coin's picture, its symbol with the pair it trades
 * against, how much is held and the price; on the right what it is worth and the gain on it.
 *
 * Shared by your own Portfolio and everyone else's profile, so a holding reads the same wherever it
 * is shown, as Trador shares it between the Stonkfolio and /u/.
 *
 * ★ UNPRICED SAYS SO; IT IS NOT WORTH ZERO. ★ A GAIN ONLY WHERE INSIDOR MADE THE BUY, else the dash
 * with its reason (wallet-view.ts profitLine). Trador's row shows nothing more, so neither does
 * this: no price move, no narrative line.
 *
 * What breaks if changed carelessly: the two screens drifting apart, so the same coin reads one
 * way on your Portfolio and another on your profile.
 */

import type { Holding } from '../../shared/api/index.ts';
import { formatPrice, formatUsd } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { compactAmount, profitLine } from './wallet-view.ts';
import styles from './portfolio.module.css';

export function HoldingRow({ h }: { h: Holding }) {
  const symbol = h.ticker ?? '—';
  const p = profitLine(h.profit);
  const priced = h.valueUsd.known;
  return (
    <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: h.coinId })}>
      <CoinLogo small address={h.address} ticker={h.ticker} imageUrl={h.imageUrl} size={36} />
      <div className={styles['mid']}>
        <div className={styles['symbolRow']}>
          <span className={styles['symbol']}>{symbol}</span>
          <span className={styles['pair']}>SOL</span>
        </div>
        <div className={styles['units']}>
          {compactAmount(h.amount, h.decimals)} {symbol}&nbsp;&nbsp;&nbsp;<Value r={formatPrice(h.priceUsd)} />
        </div>
      </div>
      <div className={styles['right']}>
        <div className={priced ? styles['worth'] : `${styles['worth']} ${styles['faint']}`}>
          {priced ? <Value r={formatUsd(h.valueUsd)} /> : 'Unpriced'}
        </div>
        <div title={p.title} className={p.tone === 'up' ? styles['up'] : p.tone === 'down' ? styles['down'] : styles['faintSmall']}>{p.text}</div>
      </div>
    </a>
  );
}
