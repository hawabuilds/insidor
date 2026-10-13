/**
 * THE TOKEN PAGE FOR A NARRATIVE'S COIN — reached from a narrative's Coins tab. The page itself
 * is TokenView (Trador's AssetPage); this file supplies what only a narrative knows: the coin's
 * facts as the narrative carries them (ticker, name, venue, address, mint time, price, 24-hour
 * change, market cap, liquidity), its fact chips, the narrative's notice when it is sample or
 * unobserved, and the Insidor part of the Info tab — the narrative, its lead post and where the
 * coin came from.
 *
 * ★ BUY AND SELL OPEN THE ORDER SHEET ONLY WHEN TRADING IS ON (features/trade). Off, they say
 * "Coming soon", and appear only for a coin the server says can be quoted (`tradable`).
 *
 * What breaks if changed carelessly: the coin must be one the narrative settled on
 * (`settledCoins`). A coin id from the URL that the narrative does not name is refused, so a
 * hand-edited link cannot put a narrative's name above a coin it never chose.
 */

import type { Coin, CoinMarket, Story } from '../../shared/api/index.ts';
import { coinLabels } from '../../shared/coin-facts.ts';
import { settledCoins } from '../../shared/coin-status.ts';
import { formatAge, formatDuration } from '../../shared/format/duration.ts';
import { formatCount, formatUsd } from '../../shared/format/number.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { loadStory, noticeFor } from '../../shared/story-source.ts';
import { leadPost } from '../feed/lead-post.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon, ChevronIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { TokenView, type TokenFacts } from './TokenView.tsx';
import styles from './token.module.css';

export function TokenPage({ storyId, coinId }: { storyId: string; coinId: string }) {
  const [story] = useLoad(storyId, (signal) => loadStory(storyId, signal));
  const coin = story.state === 'ready' ? settledCoins(story.value.coins).find((c) => c.coinId === coinId) : undefined;
  return (
    <section className={styles['page']}>
      {story.state !== 'ready' || coin === undefined ? (
        <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
          <BackIcon size={20} />
        </button>
      ) : null}
      {story.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {story.state === 'failed' ? <p className={styles['note']}>This coin's narrative couldn't be read.</p> : null}
      {story.state === 'ready' && coin === undefined ? <p className={styles['note']}>This coin is not one this narrative has settled on.</p> : null}
      {story.state === 'ready' && coin !== undefined ? <Body story={story.value} coin={coin} /> : null}
    </section>
  );
}

function Body({ story, coin }: { story: Story; coin: Coin }) {
  const soon = useComingSoon();
  const facts: TokenFacts = {
    coinId: coin.coinId,
    address: coin.address,
    ticker: coin.ticker,
    name: coin.name,
    imageUrl: coin.imageUrl,
    launchedAt: coin.mintedAt,
    price: coin.priceUsd,
    change24h: coin.priceChange24h,
    marketCapUsd: coin.marketCapUsd,
    liquidityUsd: coin.liquidityUsd,
    venue: null,
    venueLabel: coin.venueLabel,
  };
  return (
    <TokenView
      facts={facts}
      chips={coinLabels(settledCoins(story.coins)).get(coin.coinId) ?? []}
      notice={<Notice notice={noticeFor(story)} />}
      info={(market) => <NarrativeInfo story={story} coin={coin} market={market} />}
      offBar={<ComingSoonBar coin={coin} soon={soon} />}
    />
  );
}

/** With trading off: the buttons say "Coming soon", and only for a coin the server says can be quoted. */
function ComingSoonBar({ coin, soon }: { coin: Coin; soon: (what: string) => void }) {
  return coin.tradable ? (
    <div className={styles['tradeBar']}>
      <Button look="buy" size="large" className={styles['buyWash']} onClick={() => soon(`Buying ${coin.ticker}`)}>Buy</Button>
      <Button look="sell" size="large" onClick={() => soon(`Selling ${coin.ticker}`)}>Sell</Button>
    </div>
  ) : (
    <p className={styles['note']}>This coin can't be traded yet.</p>
  );
}

/** The Info tab for a narrative's coin: the coin's facts, then the narrative and where the coin came from. */
function NarrativeInfo({ story, coin, market: _market }: { story: Story; coin: Coin; market: CoinMarket | null }) {
  const now = useNow();
  const lead = leadPost(story.evidence);
  const leadEvidence = story.evidence.find((e) => e.authorLabel === lead?.author) ?? null;
  const minted = formatAge(coin.mintedAt, now as never);
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
    <>
      <dl className={styles['info']}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <a className={styles['from']} href={hrefFor({ screen: 'story', storyId: story.id })}>
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
                <Value r={formatAge(leadEvidence.postedAt, now as never)} />
              </span>
              <span>{leadEvidence.excerpt}</span>
            </span>
          </span>
        ) : null}
      </a>
      <Origin origin={coin.origin} now={now} />
    </>
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
export function Origin({ origin, now }: { origin: Coin['origin']; now: number }) {
  if (origin.kind === 'unknown') {
    return (
      <div className={styles['from']}>
        <span className={styles['kicker']}>Where it came from</span>
        <Value r={formatAge({ known: false, pending: origin.pending }, now as never)} />
      </div>
    );
  }
  const offset = origin.offset.known ? origin.offset.amount : null;
  const when = offset === null ? null : `posted ${formatDuration(Math.abs(offset))} ${offset < 0 ? 'before' : 'after'} the coin`;
  const body = (
    <>
      <span className={styles['fromHead']}>
        <span className={styles['kicker']}>{ORIGIN_LABEL[origin.kind]}</span>
        {origin.post.permalink !== null ? <ChevronIcon size={16} /> : null}
      </span>
      <span className={styles['fromTitle']}>
        <b>{origin.post.authorLabel}</b>
        {when === null ? <Value r={formatAge(origin.post.postedAt, now as never)} /> : <span>{when}</span>}
      </span>
    </>
  );
  return origin.post.permalink !== null ? (
    <a className={styles['from']} href={origin.post.permalink} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <div className={styles['from']}>{body}</div>
  );
}
