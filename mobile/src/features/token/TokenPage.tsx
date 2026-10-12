/**
 * THE TOKEN PAGE — one coin, reached from a narrative's Coins tab. Trador's AssetPage layout
 * with a "From narrative" card on top, so the coin is never shown without what it is about.
 *
 * The coin's facts come from the wire (`Coin` inside the story's `CoinLink`): ticker, name,
 * venue, address, mint time, price, 24-hour change, market cap and liquidity. Its market —
 * price history for the chosen view, the latest trades, curve progress while on the launchpad
 * curve — is read from `GET /coin/:id/market` when the page opens, and again every 20 seconds.
 * A source that failed is said to have failed; a coin with no trades yet says that instead.
 *
 * ★ BUY AND SELL DO NOTHING BUT SAY "COMING SOON". The bar appears only for a coin the server
 * says can be quoted (`tradable`); for any other the page shows its numbers and says it cannot
 * be traded yet, with no button. `submitTrade` is never called from here.
 */

import { useEffect, useState } from 'react';
import { fetchCoinMarket, loadSampleMarket, type Coin, type CoinMarket, type MarketTimeframe, type MarketTrade, type Story } from '../../shared/api/index.ts';
import { coinLabels } from '../../shared/coin-facts.ts';
import { settledCoins } from '../../shared/coin-status.ts';
import { formatAge, formatDuration } from '../../shared/format/duration.ts';
import { formatChangePercent, formatCount, formatPrice, formatUsd } from '../../shared/format/number.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { loadStory, noticeFor } from '../../shared/story-source.ts';
import { leadPost } from '../feed/lead-post.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon, useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon, CandleIcon, ChevronIcon, CopyIcon, LineChartIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { CandleChart } from './CandleChart.tsx';
import { PriceChart } from './PriceChart.tsx';
import { directionOf } from './direction.ts';
import styles from './token.module.css';

type Section = 'trades' | 'comments' | 'info';

export function TokenPage({ storyId, coinId, sample }: { storyId: string; coinId: string; sample: boolean }) {
  const [story] = useLoad(`${sample}:${storyId}`, (signal) => loadStory(storyId, sample, signal));
  const coin = story.state === 'ready' ? settledCoins(story.value.coins).find((c) => c.coinId === coinId) : undefined;
  return (
    <section className={styles['page']}>
      <div className={styles['top']}>
        <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
          <BackIcon size={22} />
        </button>
      </div>
      {story.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {story.state === 'failed' ? <p className={styles['note']}>This coin's narrative couldn't be read.</p> : null}
      {story.state === 'ready' && coin === undefined ? (
        <p className={styles['note']}>This coin is not one this narrative has settled on.</p>
      ) : null}
      {story.state === 'ready' && coin !== undefined ? <Body story={story.value} coin={coin} sample={sample} /> : null}
    </section>
  );
}

/** "SAMPLEj…pump": enough of each end to compare by eye, never presented as a label. */
export function shortAddress(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-4)}`;
}

function Body({ story, coin, sample }: { story: Story; coin: Coin; sample: boolean }) {
  const now = useNow();
  const soon = useComingSoon();
  const toast = useToast();
  const [tf, setTf] = useState<MarketTimeframe>('1h');
  const [kind, setKind] = useState<'line' | 'candles'>('line');
  const [section, setSection] = useState<Section>('trades');
  /* The market: read now, then again every MARKET_POLL_MS while the page is open. */
  const [loaded, reload] = useLoad(`market:${sample}:${coin.coinId}:${tf}`, (signal) =>
    sample ? loadSampleMarket(coin.coinId, tf) : fetchCoinMarket(coin.coinId, tf, signal),
  );
  useEffect(() => {
    const timer = setInterval(reload, MARKET_POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const market: CoinMarket | null = loaded.state === 'ready' ? loaded.value : null;
  const read = market?.kind === 'read' ? market : null;
  const lead = leadPost(story.evidence);
  const leadEvidence = story.evidence.find((e) => e.authorLabel === lead?.author) ?? null;
  const labels = coinLabels(settledCoins(story.coins)).get(coin.coinId) ?? [];
  const change = formatChangePercent(coin.priceChange24h);
  const series = read?.candles?.map((c) => c.c) ?? [];
  const progress = read?.curveProgress?.known ? Math.round(read.curveProgress.amount * 1000) / 10 : null;

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
      <a className={styles['from']} href={hrefFor({ screen: 'story', storyId: story.id, sample })}>
        <span className={styles['fromHead']}>
          <span className={styles['kicker']}>From narrative</span>
          <ChevronIcon size={16} />
        </span>
        <span className={styles['fromTitle']}>
          <b>{story.title}</b>
          <span><Value r={formatCount(story.reach)} /> views</span>
        </span>
        {leadEvidence !== null ? (
          <span className={styles['fromPost']}>
            <Thumb url={leadEvidence.thumbUrl} size={56} />
            <span className={styles['fromPostText']}>
              <span className={styles['fromBy']}>
                {lead?.platform ? <PlatformMark platform={lead.platform} size={13} /> : null}
                <b>{leadEvidence.authorLabel}</b>
                <Value r={formatAge(leadEvidence.postedAt, now)} />
              </span>
              <span>{leadEvidence.excerpt}</span>
            </span>
          </span>
        ) : null}
      </a>

      <div className={styles['coinHead']}>
        <Thumb url={coin.imageUrl} size={44} round letter={coin.ticker.charAt(0)} />
        <div>
          <h1>{coin.ticker}</h1>
          <span className={styles['name']}>{coin.name}</span>
        </div>
      </div>

      <Origin origin={coin.origin} sample={sample} now={now} />

      <div className={styles['chips']}>
        <span className={styles['chip']}>SOL</span>
        <span className={`${styles['chip']} ${styles['chipBold']}`}>{coin.venueLabel}</span>
        {labels.map((l) => (
          <span key={l} className={`${styles['chip']} ${styles['chipBrand']}`}>{l}</span>
        ))}
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
        <div>
          <Value r={formatPrice(coin.priceUsd)} className={styles['price']} />
          <span className={`${styles['change']} ${change.direction === 'up' ? styles['up'] : change.direction === 'down' ? styles['down'] : ''}`}>
            {change.direction === 'up' ? '▲ ' : change.direction === 'down' ? '▼ ' : ''}
            <Value r={change.text} /> <span className={styles['tf']}>24H</span>
          </span>
        </div>
        <div className={styles['cap']}>
          <span className={styles['kicker']}>Market cap</span>
          <Value r={formatUsd(coin.marketCapUsd)} className={styles['capN']} />
          <span className={styles['liq']}>Liq <Value r={formatUsd(coin.liquidityUsd)} /></span>
        </div>
      </div>

      <Notice notice={noticeFor(story, sample)} />

      {series.length > 1 ? (
        kind === 'line' ? <PriceChart series={series} direction={directionOf(series)} /> : <CandleChart candles={read?.candles ?? []} />
      ) : (
        <p className={styles['note']}>{chartNote(loaded.state, market)}</p>
      )}
      {market !== null ? (
        <>
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
        </>
      ) : null}

      <UnderlineTabs
        label="Coin"
        current={section}
        onChange={setSection}
        tabs={[
          { key: 'trades', label: 'Trades' },
          { key: 'comments', label: 'Comments' },
          { key: 'info', label: 'Info' },
        ]}
      />
      {section === 'trades' ? (read?.trades != null && read.trades.length > 0 ? <Trades ticker={coin.ticker} trades={read.trades} now={now} /> : <p className={styles['note']}>{tradesNote(loaded.state, market)}</p>) : null}
      {section === 'comments' ? <p className={styles['note']}>Comments are coming soon.</p> : null}
      {section === 'info' ? <Info coin={coin} now={now} /> : null}

      {coin.tradable ? (
        <div className={styles['tradeBar']}>
          <Button look="buy" size="large" className={styles['buyWash']} onClick={() => soon(`Buying ${coin.ticker}`)}>Buy</Button>
          <Button look="sell" size="large" onClick={() => soon(`Selling ${coin.ticker}`)}>Sell</Button>
        </div>
      ) : (
        <p className={styles['note']}>This coin can't be traded yet.</p>
      )}
    </>
  );
}

export const TIMEFRAMES: readonly MarketTimeframe[] = ['1m', '5m', '1h', '6h'];
/** How often an open token page reads its market again. The server keeps answers 12–300s. */
export const MARKET_POLL_MS = 20_000;

/** Why there is no chart: still loading, the source failed, or the coin has no trades in this view. */
export function chartNote(state: 'loading' | 'ready' | 'failed', market: CoinMarket | null): string {
  if (state === 'loading') return 'Loading price history.';
  if (state === 'failed' || market?.kind === 'unavailable' || (market?.kind === 'read' && market.candles === null)) return 'Price history could not be read just now.';
  return 'No trades in this view yet, so there is no price history to draw.';
}

export function tradesNote(state: 'loading' | 'ready' | 'failed', market: CoinMarket | null): string {
  if (state === 'loading') return 'Loading trades.';
  if (state === 'failed' || market?.kind === 'unavailable' || (market?.kind === 'read' && market.trades === null)) return 'Trades could not be read just now.';
  return 'No trades yet.';
}

/**
 * The latest trades, Trador's tape rebuilt in our style: side and age, amount, value, and the
 * transaction, which opens on a block explorer. A sample trade has no transaction, so no link.
 */
export function Trades({ ticker, trades, now }: { ticker: string; trades: readonly MarketTrade[]; now: number }) {
  return (
    <table className={styles['trades']}>
      <thead>
        <tr><th>Type</th><th>Amount</th><th>USD</th><th>Txn</th></tr>
      </thead>
      <tbody>
        {trades.slice(0, TRADES_SHOWN).map((t, i) => (
          <tr key={t.tx ?? i}>
            <td className={t.side === 'buy' ? styles['up'] : styles['down']}>
              {t.side === 'buy' ? 'Buy' : 'Sell'}
              <small><Value r={formatAge(t.at, now)} /></small>
            </td>
            <td>
              <b><Value r={formatCount(t.tokenAmount)} /></b> <span className={styles['dim']}>{ticker}</span>
            </td>
            <td className={t.side === 'buy' ? styles['up'] : styles['down']}><b><Value r={formatUsd(t.usd)} /></b></td>
            <td>
              {t.tx === null ? <span className={styles['dim']}>—</span> : (
                <a className={styles['txn']} href={`https://solscan.io/tx/${t.tx}`} target="_blank" rel="noopener noreferrer">{t.tx.slice(0, 4)}…</a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The tape shows the latest few; the full history is one tap away on the explorer. */
const TRADES_SHOWN = 30;

function Info({ coin, now }: { coin: Coin; now: number }) {
  const minted = formatAge(coin.mintedAt, now);
  const rows: readonly [string, React.ReactNode][] = [
    ['Name', coin.name],
    ['Ticker', coin.ticker],
    ['Venue', coin.venueLabel],
    ['Minted', minted.kind === 'value' ? `${minted.text} ago` : <Value r={minted} />],
    ['Market cap', <><Value r={formatUsd(coin.marketCapUsd)} />{coin.marketCapBasis === 'circulating' ? ' circulating' : coin.marketCapBasis === 'fully-diluted' ? ' fully diluted' : ''}</>],
    ['Liquidity', <Value r={formatUsd(coin.liquidityUsd)} />],
    ['Address', <span className={styles['mono']}>{coin.address}</span>],
  ];
  return (
    <dl className={styles['info']}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Each origin says how we know it. "Went viral after launch" is never where the coin came from. */
const ORIGIN_LABEL: Record<Exclude<Coin['origin']['kind'], 'unknown'>, string> = {
  linkedByCreator: 'Linked by creator',
  matchedByInsidor: 'Matched by Insidor',
  foundByTeam: 'Found by the Insidor team',
  influencer: 'From an influencer or founder',
  afterLaunch: 'Went viral after launch',
};

/**
 * Where the coin came from: the post, who posted it, and how long before the coin it was —
 * or, for a post that went viral after launch, how long after. Not checked, or nothing
 * confident, is a dash with its reason; never "no origin".
 */
function Origin({ origin, sample, now }: { origin: Coin['origin']; sample: boolean; now: number }) {
  if (origin.kind === 'unknown') {
    return (
      <div className={styles['from']}>
        <span className={styles['kicker']}>Where it came from</span>
        <Value r={formatAge({ known: false, pending: origin.pending }, now)} />
      </div>
    );
  }
  const offset = origin.offset.known ? origin.offset.amount : null;
  const when = offset === null ? null : `posted ${formatDuration(Math.abs(offset))} ${offset < 0 ? 'before' : 'after'} the coin`;
  const body = (
    <>
      <span className={styles['fromHead']}>
        <span className={styles['kicker']}>{ORIGIN_LABEL[origin.kind]}</span>
        {origin.post.permalink !== null && !sample ? <ChevronIcon size={16} /> : null}
      </span>
      <span className={styles['fromTitle']}>
        <b>{origin.post.authorLabel}</b>
        {when === null ? <Value r={formatAge(origin.post.postedAt, now)} /> : <span>{when}</span>}
      </span>
    </>
  );
  /* A sample post has no real page to link to, so it is not a link. */
  return origin.post.permalink !== null && !sample ? (
    <a className={styles['from']} href={origin.post.permalink} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <div className={styles['from']}>{body}</div>
  );
}
