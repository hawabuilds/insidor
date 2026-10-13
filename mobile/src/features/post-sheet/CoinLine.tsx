/**
 * ONE COIN AS THE POST SHEET AND CHOOSE COIN DRAW IT: logo, ticker, its age and "Bonded" when the
 * market says so, market cap and 24h move, and one action at the right (Buy on the sheet, ⚡ on
 * Choose coin). Tapping the row anywhere but the action opens the coin's token page.
 *
 * Shared by the two views so a coin reads the same in both; the action is the caller's, because
 * the sheet buys through the ticket and Choose coin buys at once.
 */

import type { ReactNode } from 'react';

import type { SheetCoin } from '../../shared/api/index.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { ageText, pctText } from './sheet-view.ts';
import styles from './post-sheet.module.css';

export function CoinLine({ coin, now, onOpen, action }: { coin: SheetCoin; now: number; onOpen: () => void; action: ReactNode }) {
  const age = ageText(coin.launchedAt, now);
  return (
    <div className={styles['coinRow']} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => {
      if (e.key === 'Enter') onOpen();
    }}>
      <CoinLogo address={coin.address} ticker={coin.ticker ?? coin.name} imageUrl={coin.imageUrl} size={44} />
      <span className={styles['coinText']}>
        <b className={styles['ticker']}>${coin.ticker ?? coin.name ?? coin.address.slice(0, 4)}</b>
        <span className={styles['coinSub']}>
          {age !== null ? <span>{age}</span> : null}
          {coin.bonded === true ? <span>Bonded</span> : null}
        </span>
      </span>
      <span className={styles['coinNums']}>
        {/* A cap no market reports is left out, as the design asks: the row says only what is known. */}
        {coin.marketCapUsd.known ? <Value r={formatUsd(coin.marketCapUsd)} className={styles['cap']} /> : null}
        {coin.changePct24h.known ? <span className={coin.changePct24h.amount >= 0 ? styles['up'] : styles['down']}>{pctText(coin.changePct24h.amount)}</span> : null}
      </span>
      {action}
    </div>
  );
}

