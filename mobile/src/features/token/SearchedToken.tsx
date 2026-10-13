/**
 * A COIN OPENED FROM SEARCH (or a "See N coins" list, Portfolio, an alert, Create). The same page
 * as a narrative's coin — TokenView, Trador's AssetPage — fed with what the search said about the
 * coin, or what chainwatch recorded.
 *
 * ★ NO NARRATIVE IS ASSUMED. A search result is a coin with that name and nothing more, so this
 * file names no narrative of its own; the Info tab says which feed posts name the coin, with
 * their evidence, only as the read service lists them. It is a page the person opened themselves,
 * so once trading is on it offers Buy and Sell like any coin with somewhere to trade
 * (features/trade/TradeBar.tsx) — and "Can't be traded right now" for one without.
 *
 * What breaks if changed carelessly: a search result carries no price, 24-hour move or liquidity
 * of its own. They are dashes ("not reported") until the market is read, never zeros.
 */

import { fetchSearchedCoin, type SearchedCoin } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { useLoad } from '../../shared/hooks.ts';
import { BackIcon } from '../../shared/ui/icons.tsx';
import { TokenView, type TokenFacts } from './TokenView.tsx';
import styles from './token.module.css';

export function SearchedToken({ coinId }: { coinId: string }) {
  const [coin] = useLoad(`searched:${coinId}`, (signal) => fetchSearchedCoin(coinId, signal));
  return (
    <section className={styles['page']}>
      {coin.state !== 'ready' ? (
        <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
          <BackIcon size={20} />
        </button>
      ) : null}
      {coin.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {coin.state === 'failed' ? <p className={styles['note']}>This coin couldn't be opened. Search for it again.</p> : null}
      {coin.state === 'ready' ? <Body coin={coin.value} /> : null}
    </section>
  );
}

/** A search result carries no price or 24-hour move of its own; with no candles either, both are a dash. */
const NOT_LISTED: Measured = { known: false, pending: 'not_reported' };

function Body({ coin }: { coin: SearchedCoin }) {
  const facts: TokenFacts = {
    coinId: coin.coinId,
    address: coin.address,
    ticker: coin.ticker,
    name: coin.name,
    imageUrl: coin.imageUrl,
    launchedAt: coin.launchedAt,
    price: NOT_LISTED,
    change24h: NOT_LISTED,
    marketCapUsd: coin.marketCapUsd,
    liquidityUsd: null,
    venue: coin.venue,
    venueLabel: 'pump.fun',
    tradable: null,
  };
  return (
    <TokenView
      facts={facts}
      offBar={<p className={styles['note']}>Opened from search. Buying and selling are coming soon.</p>}
    />
  );
}
