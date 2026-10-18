/**
 * THE HOLDINGS LIST — a "HOLDINGS" label, SOL first, then one short row per coin: the picture,
 * the ticker and how much is held; on the right what it is worth and the gain under it.
 *
 * Shared by your own Portfolio and everyone's profile, so a holding reads the same wherever it is
 * shown, as Trador shares its HoldingRow between the Stonkfolio and /u/.
 *
 * ★ UNPRICED SAYS SO; IT IS NOT WORTH ZERO. ★ NO GAIN IS A PLAIN DASH, its reason in the row's
 * title and in the one note the screen puts under the list (wallet-view.ts gainsNote). SOL has no
 * gain line: it is what coins are paid with, not a coin bought.
 *
 * What breaks if changed carelessly: the two screens drifting apart, so the same coin reads one
 * way on your Portfolio and another on your profile.
 */

import type { Holding, Portfolio } from '../../shared/api/index.ts';
import { known } from '../../shared/format/measure.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { compactAmount, profitLine, solValueUsd } from './wallet-view.ts';
import styles from './portfolio.module.css';

const LOGO = 38;

export function Holdings({ data }: { data: Extract<Portfolio, { kind: 'read' }> }) {
  const sol = solValueUsd(data);
  return (
    <>
      <h2 className={styles['holdingsLabel']}>Holdings</h2>
      <ul className={styles['list']}>
        <li>
          <div className={styles['row']}>
            <SolMark />
            <div className={styles['mid']}>
              <div className={styles['symbol']}>SOL</div>
              <div className={styles['units']}>{data.solBalance.known ? data.solBalance.amount.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'} SOL</div>
            </div>
            <div className={styles['right']}>
              <div className={sol === null ? `${styles['worth']} ${styles['faint']}` : styles['worth']}>{sol === null ? 'Unpriced' : <Value r={formatUsd(known(sol))} />}</div>
            </div>
          </div>
        </li>
        {data.holdings.map((h) => <li key={h.address}><HoldingRow h={h} /></li>)}
      </ul>
      {data.notShown > 0 ? <p className={styles['foot']}>{data.notShown.toLocaleString('en-US')} more coins not shown.</p> : null}
    </>
  );
}

export function HoldingRow({ h }: { h: Holding }) {
  const symbol = h.ticker ?? '—';
  const p = profitLine(h.profit);
  const priced = h.valueUsd.known;
  return (
    <a className={styles['row']} href={hrefFor({ screen: 'token', coinId: h.coinId })}>
      <CoinLogo small address={h.address} ticker={h.ticker} imageUrl={h.imageUrl} size={LOGO} />
      <div className={styles['mid']}>
        <div className={styles['symbol']}>{symbol}</div>
        <div className={styles['units']}>{compactAmount(h.amount, h.decimals)} {symbol}</div>
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

/** SOL's own mark: three slanted bars on a dark disc, drawn here so no picture is fetched for it. */
function SolMark() {
  return (
    <svg width={LOGO} height={LOGO} viewBox="0 0 38 38" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="sol-mark" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <circle cx="19" cy="19" r="19" fill="#141418" />
      <g fill="url(#sol-mark)">
        <path d="M12.5 23.6h12.6l-2.6 2.6H9.9z" />
        <path d="M12.5 11.8h12.6l-2.6 2.6H9.9z" />
        <path d="M25.1 17.7H12.5l-2.6 2.6h12.6z" transform="matrix(-1 0 0 1 35 0)" />
      </g>
    </svg>
  );
}
