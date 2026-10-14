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
 * ★ EVERY COIN TAP OPENS A TOKEN PAGE (coin-opening.ts). A coin the narrative did not settle on
 * — one of a post's "See N coins", a link that outlived the narrative's choice — is not refused:
 * it opens on its own facts by its id (SearchedToken), with no narrative named above it. A
 * narrative that could not be read does the same. (A coin a post has not proven is linked by its
 * own id with `unproven`, and that page carries the grey line; this route cannot tell.)
 *
 * What breaks if changed carelessly: only a coin the narrative settled on (`settledCoins`) gets
 * the narrative's page, so a hand-edited link cannot put a narrative's name above a coin it never
 * chose. Bringing back a refusal for the rest strands every "See N coins" tap on a dead end.
 */

import type { Coin, Story } from '../../shared/api/index.ts';
import { coinLabels } from '../../shared/coin-facts.ts';
import { settledCoins } from '../../shared/coin-status.ts';
import { formatAge, formatDuration } from '../../shared/format/duration.ts';
import { formatCount } from '../../shared/format/number.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { loadStory, noticeFor } from '../../shared/story-source.ts';
import { leadPost } from '../feed/lead-post.ts';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon, ChevronIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { TradeButtons } from '../trade/TradeBar.tsx';
import { coinOpening } from './coin-opening.ts';
import { SearchedToken } from './SearchedToken.tsx';
import { TokenView, type TokenFacts } from './TokenView.tsx';
import styles from './token.module.css';

export function TokenPage({ storyId, coinId }: { storyId: string; coinId: string }) {
  const [story] = useLoad(storyId, (signal) => loadStory(storyId, signal));
  const opening = coinOpening(story, coinId);
  if (opening.kind === 'own') return <SearchedToken coinId={coinId} />;
  return (
    <section className={styles['page']}>
      {opening.kind === 'loading' ? (
        <>
          <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
            <BackIcon size={20} />
          </button>
          <p className={styles['note']}>Loading.</p>
        </>
      ) : (
        <Body story={opening.story} coin={opening.coin} />
      )}
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
    tradable: coin.tradable,
  };
  return (
    <TokenView
      facts={facts}
      chips={coinLabels(settledCoins(story.coins)).get(coin.coinId) ?? []}
      notice={<Notice notice={noticeFor(story)} />}
      insidor={<NarrativeInfo story={story} coin={coin} />}
      offBar={<ComingSoonBar coin={coin} soon={soon} />}
    />
  );
}

/** With trading off: the buttons say "Coming soon", and only for a coin the server says can be quoted. */
function ComingSoonBar({ coin, soon }: { coin: Coin; soon: (what: string) => void }) {
  return coin.tradable ? (
    <TradeButtons ticker={coin.ticker} onBuy={() => soon(`Buying ${coin.ticker}`)} onSell={() => soon(`Selling ${coin.ticker}`)} />
  ) : (
    <p className={styles['note']}>This coin can't be traded yet.</p>
  );
}

/** Insidor's part of the Info tab for a narrative's coin: the narrative, its lead post, and where the coin came from. */
function NarrativeInfo({ story, coin }: { story: Story; coin: Coin }) {
  const now = useNow();
  const lead = leadPost(story.evidence);
  const leadEvidence = story.evidence.find((e) => e.authorLabel === lead?.author) ?? null;
  return (
    <>
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
