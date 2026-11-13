/**
 * THE FEED TAB — Trador's Feed (app/(app)/feed/FeedScreen.tsx) as the owner approved it: the buys,
 * sells and comments of the people you follow, newest first.
 *
 * Trador's page, piece by piece, in Insidor's look (the owner's design, 2026-10-18): a sticky
 * "Feed" title with the bell at its right (shared/ui/NotificationBell.tsx, on every tab since
 * 2026-11-04, with the unread count), Trador's three tabs, Following, Top calls
 * and Latest, as For You's sort chips, Top calls' This week / All time, rows with no box
 * (FeedTradeRow and FeedCommentRow), four skeleton rows while loading, twenty rows at a time with
 * Load more, "You have seen everything" at the end, Trador's sentence on an empty tab ("See all
 * time" on a quiet week), and pull to refresh.
 *
 *   Following  the trades and comments of the people you follow, newest first
 *   Top calls  every comment by the likes holders gave it, as Trador ranks by Useful votes
 *   Latest     every comment, newest first
 *
 * Insidor's differences, each a rule of the product:
 *   - Someone who follows nobody sees People to follow (their counts this week, a Follow button) in
 *     Following's place, rather than an empty tab.
 *   - A trade with no market reading near its landing, or a sell with no known average buy, has no
 *     second line rather than a guess.
 *
 * The rows of this tab before (Watching, Rising and Latest, from the alert service: starred
 * narratives' coins and rising posts) are now rows in Notifications (features/alerts/split.ts);
 * the Notifications screen is only linked to.
 */

import { useState } from 'react';

import { fetchPeopleToFollow, type FeedComment, type FeedItem, type FeedTab, type FeedTrade, type FeedWindow, type SuggestedPerson } from '../../shared/api/following.ts';
import { follow } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { ArrowUpIcon, PlayIcon, ReplyIcon } from '../../shared/ui/icons.tsx';
import { NotificationBell } from '../../shared/ui/NotificationBell.tsx';
import { PlatformMark } from '../../shared/ui/PlatformMark.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { useWallet } from '../../shared/wallet.tsx';
import { LoadMore, PullIndicator } from '../alerts/Parts.tsx';
import { pullStyle, usePullToRefresh } from '../alerts/pull.ts';
import { useScreenActive } from '../../shared/screen-active.ts';
import alerts from '../alerts/alerts.module.css';
import { RankTag } from '../people/RankBadge.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { coinHref, coinLabel, nameOf, peopleFacts, profileHref, siteOf, tradeDetail, whereOf } from './lines.ts';
import { usePeopleFeed } from './list.ts';
import { ScreenHeader, ScreenTitle } from '../../shared/ui/ScreenHeader.tsx';
import styles from './following.module.css';
import { Nums } from '../../shared/ui/Num.tsx';
import { CallsList } from './Calls.tsx';

/* The Feed's three chips (the owner, 2026-11-13): Insidor's own calls first, then the people you
   follow, then everyone's takes. Community holds what were Top calls and Latest, as its three views. */
type Chip = 'calls' | 'following' | 'community';

const CHIPS: readonly { readonly key: Chip; readonly label: string }[] = [
  { key: 'calls', label: 'Calls' },
  { key: 'following', label: 'Following' },
  { key: 'community', label: 'Community' },
];

/** Community's views: everyone's takes newest first, or ranked by the holders' likes over a window. */
type CommunityView = 'latest' | FeedWindow;

const COMMUNITY_VIEWS: readonly { readonly key: CommunityView; readonly label: string }[] = [
  { key: 'latest', label: 'Newest' },
  { key: 'week', label: 'Top this week' },
  { key: 'all', label: 'Top all time' },
];

const age = (at: number, now: number) => <Value r={formatAge({ known: true, at: at as never }, now as never)} />;

export function FollowingScreen({ onRefreshed }: { onRefreshed: () => void }) {
  const now = useNow();
  const active = useScreenActive();
  const { state } = useWallet();
  const account = state.kind === 'connected' ? state.account : 'signed-out';
  const [chip, setChip] = useState<Chip>('calls');
  const [view, setView] = useState<CommunityView>('latest');
  const tab: FeedTab = chip === 'following' ? 'following' : view === 'latest' ? 'latest' : 'top';
  const period: FeedWindow = view === 'latest' ? 'week' : view;
  /* The calls are their own read (Calls.tsx); the people's feed is not asked while they show. */
  const feed = usePeopleFeed(tab, account, chip !== 'calls', period);
  /* Following nobody: People to follow in the list's place, so the first visit is not a dead end. */
  const nobody = tab === 'following' && feed.list.state === 'ready' && feed.list.value.following === 0;
  const { pull, refreshing } = usePullToRefresh(async () => {
    await feed.refresh();
    onRefreshed();
  }, active);

  /* Trador's sentences for an empty tab, and its "See all time" on a quiet week. */
  const empty = tab === 'following' ? 'Follow a few people and their buys, sells and takes land here.' : tab === 'top' ? (period === 'week' ? 'No top takes this week yet.' : 'No top takes yet.') : 'No takes yet. Open a coin and post the first one.';

  return (
    <>
      <section className={alerts['page']}>
        <header className={alerts['sticky']}>
          <ScreenHeader className={styles['titleRow']}>
            <ScreenTitle>Feed</ScreenTitle>
            <NotificationBell />
          </ScreenHeader>
          <div className={styles['chips']} role="tablist" aria-label="Feed">
            {CHIPS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={t.key === chip} className={`${styles['chip']} ${t.key === chip ? styles['chipOn'] : ''}`} onClick={() => setChip(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </header>

        {/* Only the list follows the pull, never the sticky header (as on Notifications); the
            spinner sits in the gap it opens, above the first row. */}
        <PullIndicator pull={pull} refreshing={refreshing} />
        <div style={pullStyle(pull)}>
        {chip === 'community' ? (
          <div className={styles['windowRow']}>
            <div className={styles['windows']} role="group">
              {COMMUNITY_VIEWS.map((w) => (
                <button key={w.key} type="button" aria-pressed={w.key === view} className={w.key === view ? styles['windowOn'] : ''} onClick={() => setView(w.key)}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {chip === 'calls' ? (
          <CallsList />
        ) : nobody ? (
          <PeopleToFollow onFollowed={() => void feed.refresh()} />
        ) : (
          <Listed feed={feed} now={now} empty={empty} {...(view === 'week' ? { emptyAction: { label: 'See all time', onAct: () => setView('all') } } : {})} />
        )}
        </div>
      </section>
    </>
  );
}

function Listed({ feed, now, empty, emptyAction }: { feed: ReturnType<typeof usePeopleFeed>; now: number; empty: string; emptyAction?: { label: string; onAct: () => void } }) {
  const { list } = feed;
  if (list.state === 'loading') return <Skeleton />;
  if (list.state === 'failed') return <p className={alerts['centred']}>Your feed couldn't be read just now. Pull down to try again.</p>;
  const { items, cursor } = list.value;
  if (items.length === 0 && cursor === null) {
    return (
      <div className={alerts['emptyBox']}>
        <p className={alerts['emptyText']}>{empty}</p>
        {emptyAction !== undefined ? (
          <button type="button" className={alerts['emptyAction']} onClick={emptyAction.onAct}>
            {emptyAction.label}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <ul className={alerts['list']}>
        {items.map((item) => (
          <li key={item.key}>
            <Row item={item} now={now} />
          </li>
        ))}
      </ul>
      {cursor !== null ? <LoadMore onLoad={feed.loadMore} loading={feed.loadingMore} /> : <p className={alerts['end']}>You have seen everything</p>}
    </>
  );
}

function Row({ item, now }: { item: FeedItem; now: number }) {
  return item.kind === 'trade' ? <TradeRow t={item} now={now} /> : <CommentRow c={item} now={now} />;
}

function Face({ p }: { p: FeedItem['person'] }) {
  return (
    <a className={styles['face']} href={profileHref(p)} aria-label={nameOf(p)}>
      <Avatar name={nameOf(p)} seed={p.userId} src={p.pictureUrl} size={40} />
    </a>
  );
}

/**
 * Trador's FeedTradeRow: lighter than a comment, no box and no button, one line of what happened
 * ("handle bought [logo] TICKER", the age) and one of where it stood or how it went. Trador's whole
 * row opens the coin; here the face opens the person (the owner's rule for every face) and the
 * rest of the row opens the coin. The coin never truncates: a long handle gives way instead.
 */
function TradeRow({ t, now }: { t: FeedTrade; now: number }) {
  const bought = t.side === 'buy';
  const detail = tradeDetail(t);
  return (
    <div className={styles['tradeRow']}>
      <Face p={t.person} />
      <a className={styles['text']} href={coinHref(t.coin.mint)}>
        <div className={styles['line']}>
          <span className={styles['what']}>
            <span className={styles['who']}>{t.person.handle ?? nameOf(t.person)}</span>
            <span className={bought ? styles['bought'] : styles['sold']}>{bought ? 'bought' : 'sold'}</span>
            <CoinLogo small address={t.coin.mint} ticker={t.coin.symbol ?? t.coin.name} imageUrl={t.coin.imageUrl} size={24} />
            <span className={styles['ticker']}>{coinLabel(t.coin)}</span>
          </span>
          <span className={styles['age']}>{age(t.at, now)}</span>
        </div>
        {detail !== null ? <p className={styles['detail']}><Nums text={detail} /></p> : null}
      </a>
    </div>
  );
}

/** A post's small rounded picture, with a play mark on a video's cover; the site's mark when there is no picture. */
function PostPicture({ c }: { c: FeedComment }) {
  const [failed, setFailed] = useState(false);
  const site = siteOf(c);
  if (c.on.pictureUrl === null || failed) return <span className={styles['pillTile']}>{site !== null ? <PlatformMark platform={site} size={11} /> : null}</span>;
  return (
    <span className={styles['pillPicture']}>
      <img src={c.on.pictureUrl} alt="" width={20} height={20} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      {c.on.video ? (
        <span className={styles['pillPlay']} aria-label="Video">
          <PlayIcon size={8} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Trador's FeedCommentRow: spacing between posts, not cards. Name, rank and age; then the pill of
 * what it was said on, where Trador shows the coin (the coin's logo and ticker; a post's small
 * picture and "Post by @handle"; a narrative's picture and title), which opens it; the words; and
 * the holders' likes and the replies as readouts, as Trador's are.
 */
function CommentRow({ c, now }: { c: FeedComment; now: number }) {
  const where = whereOf(c);
  return (
    <article className={styles['commentRow']}>
      <Face p={c.person} />
      <div className={styles['text']}>
        <div className={styles['commentHead']}>
          <a className={styles['name']} href={profileHref(c.person)}>{nameOf(c.person)}</a>
          <RankTag rank={c.person.rank} />
          <span className={styles['age']}>{age(c.at, now)}</span>
        </div>
        <a className={styles['pill']} href={where.href}>
          {where.coin !== null ? <CoinLogo small address={where.coin.mint} ticker={where.coin.symbol ?? where.coin.name} imageUrl={where.coin.imageUrl} size={18} /> : null}
          {c.on.kind === 'post' ? <PostPicture c={c} /> : null}
          {c.on.kind === 'story' ? <Thumb url={c.on.pictureUrl} size={18} radius={5} /> : null}
          {c.on.kind === 'post' && c.on.author !== null ? <Avatar name={c.on.author.replace(/^@/, '')} seed={c.on.author} src={c.on.authorPictureUrl ?? null} file={c.on.authorPictureFile ?? null} size={16} /> : null}
          <span>{where.label}</span>
        </a>
        <p className={styles['body']}>{c.body}</p>
        <div className={styles['counts']}>
          <span aria-label={`${c.likes} found it useful`}>
            <ArrowUpIcon size={15} />
            {c.likes}
          </span>
          <span aria-label={`${c.replies} ${c.replies === 1 ? 'reply' : 'replies'}`}>
            <ReplyIcon size={15} />
            {c.replies}
          </span>
        </div>
      </div>
    </article>
  );
}

/** People to follow, with this week's counts and a Follow that does not leave the list. */
function PeopleToFollow({ onFollowed }: { onFollowed: () => void }) {
  const [people] = useLoad('people-to-follow', () => fetchPeopleToFollow(), 'memory');
  return (
    <>
      <h2 className={styles['heading']}>People to follow</h2>
      <p className={styles['lead']}>Follow people and their buys, sells and comments land here.</p>
      {people.state === 'loading' ? <Skeleton rows={2} /> : null}
      {people.state === 'failed' ? <p className={styles['lead']}>Suggestions couldn't be read just now.</p> : null}
      {people.state === 'ready' && people.value.length === 0 ? <p className={styles['lead']}>Nobody has traded or commented this week yet.</p> : null}
      {people.state === 'ready' ? (
        <ul className={alerts['list']}>
          {people.value.map((p) => (
            <li key={p.userId}>
              <Person p={p} onFollowed={onFollowed} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function Person({ p, onFollowed }: { p: SuggestedPerson; onFollowed: () => void }) {
  const toast = useToast();
  const [on, setOn] = useState(false);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    try {
      await follow(p.userId, next);
      onFollowed();
    } catch (e) {
      setOn(!next);
      toast("Couldn't follow", e instanceof Error ? e.message : '');
    }
  };
  return (
    <div className={styles['person']}>
      <Face p={p} />
      <a className={styles['personText']} href={profileHref(p)}>
        <b>{nameOf(p)}</b>
        <span>{peopleFacts(p)}</span>
      </a>
      <button type="button" className={`${styles['follow']} ${on ? styles['on'] : ''}`} onClick={() => void toggle()}>
        <span>{on ? 'Following' : 'Follow'}</span>
      </button>
    </div>
  );
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className={alerts['list']} aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={alerts['skeletonRow']}>
          <span className={alerts['skeletonFace']} />
          <div>
            <span className={alerts['skeletonBar']} style={{ width: 112 }} />
            <span className={alerts['skeletonBar']} style={{ width: 64, height: 12, marginTop: 8 }} />
            <span className={alerts['skeletonBar']} style={{ width: '100%', marginTop: 12 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
