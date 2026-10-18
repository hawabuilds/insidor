/**
 * THE FEED TAB — Trador's Feed (app/(app)/feed/FeedScreen.tsx) as the owner approved it: the buys,
 * sells and comments of the people you follow, newest first.
 *
 * Trador's page, piece by piece: a sticky "Feed" title with the bell at its right (it opens
 * Notifications, the only place their count is shown), tabs under the title, rows with no box
 * (FeedTradeRow: "Ana bought FERRY", the age, and a second line; FeedCommentRow: name, rank, age,
 * the coin or narrative it was said on, the words, and the likes and replies as readouts), four
 * skeleton rows while loading, twenty rows at a time with Load more, "You have seen everything" at
 * the end, and pull to refresh. Trador's tabs are Following, Top calls and Latest; Insidor has no
 * vote-ranked list of calls, so its tabs are Following and Latest (everyone's).
 *
 * Insidor's differences, each a rule of the product:
 *   - A trade shows its quoted SOL as "about", not Trador's "at $40M market cap" or "in profit": the
 *     record holds the quote, not the fill or the cap at the time, and a guess about someone's money
 *     is not a fact.
 *   - Someone who follows nobody sees People to follow (their counts this week, a Follow button)
 *     above Latest, instead of Trador's switch to another tab: the first visit is never empty.
 *   - A person's trades appear only once they turn on "Show my trades to followers" (their
 *     profile; on by default, as Trador's). The server decides; this screen cannot.
 *
 * The rows of this tab before (Watching, Rising and Latest, from the alert service: starred
 * narratives' coins and rising posts) are now rows in Notifications (features/alerts/split.ts); the
 * bell and Notifications are untouched.
 */

import { useState } from 'react';

import { fetchPeopleToFollow, type FeedComment, type FeedItem, type FeedTab, type FeedTrade, type SuggestedPerson } from '../../shared/api/following.ts';
import { follow } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { useWallet } from '../../shared/wallet.tsx';
import { Bell, LoadMore, PageTabs, PullIndicator } from '../alerts/Parts.tsx';
import { pullStyle, usePullToRefresh } from '../alerts/pull.ts';
import alerts from '../alerts/alerts.module.css';
import { RankTag } from '../people/RankBadge.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { coinHref, coinLabel, nameOf, peopleFacts, profileHref, solText, whereOf } from './lines.ts';
import { usePeopleFeed } from './list.ts';
import styles from './following.module.css';

const TABS: readonly { readonly key: FeedTab; readonly label: string }[] = [
  { key: 'following', label: 'Following' },
  { key: 'latest', label: 'Latest' },
];

const age = (at: number, now: number) => <Value r={formatAge({ known: true, at: at as never }, now as never)} />;

export function FollowingScreen({ unread, onRefreshed }: { unread: number; onRefreshed: () => void }) {
  const now = useNow();
  const { state } = useWallet();
  const account = state.kind === 'connected' ? state.account : 'signed-out';
  const [tab, setTab] = useState<FeedTab>('following');
  const feed = usePeopleFeed(tab, account);
  /* Following nobody: Latest is read underneath People to follow, so the first visit has something to read. */
  const nobody = tab === 'following' && feed.list.state === 'ready' && feed.list.value.following === 0;
  const latest = usePeopleFeed('latest', account, nobody);
  const { pull, refreshing } = usePullToRefresh(async () => {
    await Promise.all([feed.refresh(), nobody ? latest.refresh() : Promise.resolve()]);
    onRefreshed();
  });

  return (
    <>
      <PullIndicator pull={pull} refreshing={refreshing} />
      <section className={alerts['page']} style={pullStyle(pull)}>
        <header className={alerts['sticky']}>
          <div className={alerts['titleRow']}>
            <h1 className={alerts['title']}>Feed</h1>
            <Bell unread={unread} />
          </div>
          <PageTabs tabs={TABS} current={tab} onChange={setTab} label="Feed" />
        </header>

        {nobody ? (
          <>
            <PeopleToFollow onFollowed={() => void feed.refresh()} />
            <h2 className={styles['heading']}>Latest from everyone</h2>
            <Listed feed={latest} now={now} empty="Nobody has traded or commented yet." />
          </>
        ) : (
          <Listed feed={feed} now={now} empty={tab === 'following' ? 'Nobody you follow has traded or commented yet.' : 'Nobody has traded or commented yet.'} />
        )}
      </section>
    </>
  );
}

function Listed({ feed, now, empty }: { feed: ReturnType<typeof usePeopleFeed>; now: number; empty: string }) {
  const { list } = feed;
  if (list.state === 'loading') return <Skeleton />;
  if (list.state === 'failed') return <p className={alerts['centred']}>Your feed couldn't be read just now. Pull down to try again.</p>;
  const { items, cursor } = list.value;
  if (items.length === 0 && cursor === null) {
    return (
      <div className={alerts['emptyBox']}>
        <p className={alerts['emptyText']}>{empty}</p>
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

/** Trador's FeedTradeRow: who, bought or sold, the coin, the age; under it the quoted SOL. */
function TradeRow({ t, now }: { t: FeedTrade; now: number }) {
  const bought = t.side === 'buy';
  const sol = solText(t.quotedLamports);
  return (
    <div className={styles['row']}>
      <Face p={t.person} />
      <div className={styles['text']}>
        <div className={styles['line']}>
          <span className={styles['what']}>
            <a className={styles['who']} href={profileHref(t.person)}>{nameOf(t.person)}</a>
            <span className={bought ? styles['bought'] : styles['sold']}>{bought ? 'bought' : 'sold'}</span>
            <a className={styles['coin']} href={coinHref(t.coin.mint)}>
              <CoinLogo small address={t.coin.mint} ticker={t.coin.symbol ?? t.coin.name} imageUrl={t.coin.imageUrl} size={22} />
              {coinLabel(t.coin)}
            </a>
          </span>
          <span className={styles['age']}>{age(t.at, now)}</span>
        </div>
        {sol !== null ? <p className={styles['detail']}>for {sol}</p> : null}
      </div>
    </div>
  );
}

/** Trador's FeedCommentRow: name, rank and age; where it was said; the words; likes and replies. */
function CommentRow({ c, now }: { c: FeedComment; now: number }) {
  const where = whereOf(c);
  const label = (
    <>
      {where.coin !== null ? <CoinLogo small address={where.coin.mint} ticker={where.coin.symbol ?? where.coin.name} imageUrl={where.coin.imageUrl} size={18} /> : null}
      {where.label}
    </>
  );
  return (
    <article className={styles['row']}>
      <Face p={c.person} />
      <div className={styles['text']}>
        <div className={styles['line']}>
          <span className={styles['what']}>
            <a className={styles['who']} href={profileHref(c.person)}>{nameOf(c.person)}</a>
            <RankTag rank={c.person.rank} />
          </span>
          <span className={styles['age']}>{age(c.at, now)}</span>
        </div>
        {where.href !== null ? <a className={styles['where']} href={where.href}>{label}</a> : <span className={styles['where']}>{label}</span>}
        <p className={styles['body']}>{c.body}</p>
        <div className={styles['counts']}>
          <span>↑ {c.likes}</span>
          <span>{c.replies} {c.replies === 1 ? 'reply' : 'replies'}</span>
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
