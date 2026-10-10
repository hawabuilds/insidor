/**
 * THE TOKEN PAGE — one coin, reached from a narrative's Coins tab. Trador's AssetPage layout
 * with a "From narrative" card on top, so the coin is never shown without what it is about.
 *
 * What is real comes from the wire (`Coin` inside the story's `CoinLink`): ticker, name,
 * venue, address, mint time, price, 24-hour change, market cap and liquidity. What has no wire
 * field — price history, the trade tape, curve progress — comes from `sample-market.ts` and
 * only on a page that is already sample data; against the read service those panels say they
 * are not available yet.
 *
 * ★ BUY AND SELL DO NOTHING BUT SAY "COMING SOON". The bar appears only for a coin the server
 * says can be quoted (`tradable`); for any other the page shows its numbers and says it cannot
 * be traded yet, with no button. `submitTrade` is never called from here.
 */

import { useState } from 'react';
import { USING_FIXTURES, type Coin, type Story } from '../../shared/api/index.ts';
import { coinLabels } from '../../shared/coin-facts.ts';
import { settledCoins } from '../../shared/coin-status.ts';
import { formatAge } from '../../shared/format/duration.ts';
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
import { PriceChart } from './PriceChart.tsx';
import { TIMEFRAMES, directionOf, sampleCurvePercent, sampleSeries, sampleTrades, type Timeframe } from './sample-market.ts';
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
function shortAddress(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-4)}`;
}

function Body({ story, coin, sample }: { story: Story; coin: Coin; sample: boolean }) {
  const now = useNow();
  const soon = useComingSoon();
  const toast = useToast();
  const [tf, setTf] = useState<Timeframe>('1H');
  const [section, setSection] = useState<Section>('trades');
  const sampleMarket = sample || USING_FIXTURES;
  const lead = leadPost(story.evidence);
  const leadEvidence = story.evidence.find((e) => e.authorLabel === lead?.author) ?? null;
  const labels = coinLabels(settledCoins(story.coins)).get(coin.coinId) ?? [];
  const change = formatChangePercent(coin.priceChange24h);
  const series = sampleMarket && coin.priceUsd.known ? sampleSeries(coin.coinId, tf, coin.priceUsd.amount) : [];

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

      <div className={styles['chips']}>
        <span className={styles['chip']}>SOL</span>
        <span className={`${styles['chip']} ${styles['chipBold']}`}>{coin.venueLabel}</span>
        {labels.map((l) => (
          <span key={l} className={`${styles['chip']} ${styles['chipBlue']}`}>{l}</span>
        ))}
      </div>
      <button type="button" className={styles['address']} onClick={() => void copy()} aria-label={`Copy address ${coin.address}`}>
        {shortAddress(coin.address)} <CopyIcon size={13} />
      </button>

      {sampleMarket ? (
        <div className={styles['curve']} aria-label="Bonding curve progress, sample">
          <span className={styles['curveTrack']}>
            <span className={styles['curveFill']} style={{ width: `${sampleCurvePercent(coin.coinId)}%` }} />
          </span>
          <span>{sampleCurvePercent(coin.coinId)}%</span>
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
        <>
          <PriceChart series={series} direction={directionOf(series)} />
          <div className={styles['tfRow']}>
            <div className={styles['tfs']}>
              {TIMEFRAMES.map((t) => (
                <button key={t} type="button" className={`${styles['tfButton']} ${t === tf ? styles['tfOn'] : ''}`} onClick={() => setTf(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className={styles['kinds']}>
              <button type="button" className={styles['kindOn']} aria-label="Line chart"><LineChartIcon size={16} /></button>
              <button type="button" aria-label="Candle chart" onClick={() => soon('Candle charts')}><CandleIcon size={16} /></button>
            </div>
          </div>
        </>
      ) : (
        <p className={styles['note']}>Price history is not available yet.</p>
      )}

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
      {section === 'trades' ? (sampleMarket ? <Trades ticker={coin.ticker} /> : <p className={styles['note']}>Trades are not available yet.</p>) : null}
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

function Trades({ ticker }: { ticker: string }) {
  return (
    <table className={styles['trades']}>
      <thead>
        <tr><th>Type</th><th>Amount</th><th>USD</th></tr>
      </thead>
      <tbody>
        {sampleTrades().map((t, i) => (
          <tr key={i}>
            <td className={t.side === 'buy' ? styles['up'] : styles['down']}>
              {t.side === 'buy' ? 'Buy' : 'Sell'}
              <small>{t.ago}</small>
            </td>
            <td>
              <b>{t.tokens}</b> <span className={styles['dim']}>{ticker}</span>
              <small>{t.sol}</small>
            </td>
            <td className={t.side === 'buy' ? styles['up'] : styles['down']}><b>{t.usd}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
