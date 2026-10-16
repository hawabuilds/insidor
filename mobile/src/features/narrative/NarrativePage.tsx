/**
 * THE NARRATIVE PAGE — one narrative, on one phone screen, as the owner laid it out (2026-10-16):
 *
 *   Header   its picture and title; total views across its posts; how many posts; the views it
 *            gained in the last hour; its coin with market cap and Buy.
 *   Chart    the post sheet's views chart over the narrative's total (StoryChart.tsx): each post a
 *            dot at the time it went up (a tap opens it), Found and Coin markers, and the coin's
 *            market cap behind the MC switch.
 *   Posts    newest first, the For You card for each post a feed holds (a tap opens its post sheet),
 *            the narrative's own listing for one no feed holds (a tap opens the post where it is).
 *   Coins    the narrative's own coin first, then the other coins with its name.
 *
 * ★ FACTS ONLY. The post count is the narrative's own (`postCount`). Total views and the last hour
 * are the projector's (`viewsTotal`, `viewsGained1h`), with "12 of 14 posts counted" when they
 * counted fewer posts than the page lists; from a server without them, the phone adds up the
 * readings its feed cards carry under story-views.ts's rule, and says how many posts have none.
 * (`reach` is the top post's views, not a total, so it is not used here.) Nothing is ever a zero
 * for want of a reading.
 *
 * ★ BUY ONLY ON THE NARRATIVE'S OWN COIN. The header offers Buy only for the coin the narrative
 * names (`proven` on the sheet, or the story's `one`); with several coins or an unsure match it says
 * so in words and the coins are one tap away under Coins, one at a time, never chosen for anyone.
 *
 * ★ THE OWNER'S CALLS (features/owner, the owner's wallet only, as on posts): Not a narrative, Merge
 * with…, Remove this post (on each post), Right coin and Wrong coin (on the narrative's coin).
 * NarrativeOwner.tsx holds them; this file only places them.
 *
 * What breaks if changed carelessly: the page reads two replies, the story and its sheet. The story
 * alone draws the header; the sheet failing must cost only the chart, the cards and the coin list,
 * each saying it could not be read, never the whole page.
 */

import { useMemo, useState } from 'react';
import type { SheetCoin, Story, StoryMember, StorySheet } from '../../shared/api/index.ts';
import { fetchStorySheet } from '../../shared/api/index.ts';
import { coinStatus } from '../../shared/coin-status.ts';
import { formatAge, formatDuration } from '../../shared/format/duration.ts';
import { instant, pendingInstant } from '../../shared/format/measure.ts';
import { compact, formatCount } from '../../shared/format/number.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { platformOf, siteList } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { loadStory, noticeFor } from '../../shared/story-source.ts';
import { watchlist } from '../../shared/watchlist.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon, ShareIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformBadge } from '../../shared/ui/PlatformMark.tsx';
import { PostRow } from '../../shared/ui/PostRow.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Comments } from '../comments/Comments.tsx';
import { HideBar } from '../owner/OwnerPost.tsx';
import { useIsOwner, useOwnerState } from '../owner/hooks.ts';
import { withoutHidden } from '../owner/owner-store.ts';
import { BuyOpen, CoinLine, PostSheet, SheetToast, type SheetNote } from '../post-sheet/index.ts';
import { sheetCoinRoute } from '../token/coin-opening.ts';
import { goBack } from '../../shared/nav.ts';
import { NarrativeOwnerBar, RemovePost, CoinCall } from './NarrativeOwner.tsx';
import { StoryChart, useStoryTotal } from './StoryChart.tsx';
import { gainedLastHour, latestTotal, seriesTotal } from './story-views.ts';
import styles from './narrative.module.css';

type Section = 'posts' | 'coins' | 'comments' | 'stats';

/** Older than this, the header's total says how long ago some post was last read. */
const STALE_MS = 15 * 60_000;

export function NarrativePage({ storyId, onCreate }: {
  storyId: string;
  onCreate: (story: Story) => void;
}) {
  const [story] = useLoad(storyId, (signal) => loadStory(storyId, signal));
  const [sheet] = useLoad(`story-sheet:${storyId}`, (signal) => fetchStorySheet(storyId, signal));
  return (
    <section className={styles['page']}>
      <TopBar storyId={storyId} />
      {story.state === 'loading' ? <p className={styles['empty']}>Loading.</p> : null}
      {story.state === 'failed' ? (
        <p className={styles['empty']}>This narrative couldn't be read. It may not be on the read service.</p>
      ) : null}
      {story.state === 'ready' ? (
        <Body story={story.value} sheet={sheet.state === 'ready' ? sheet.value : sheet.state === 'failed' ? 'failed' : null} onCreate={onCreate} />
      ) : null}
    </section>
  );
}

function TopBar({ storyId }: { storyId: string }) {
  const starred = useWatchlist().includes(storyId);
  const toast = useToast();
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch {
      /* Dismissing the share sheet is not an error worth a message. */
    }
  };
  return (
    <div className={styles['top']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => goBack({ screen: 'narratives' })}>
        <BackIcon size={22} />
      </button>
      <div className={styles['topRight']}>
        <button
          type="button"
          className={`${styles['round']} ${starred ? styles['starred'] : ''}`}
          aria-label={starred ? 'Remove from watchlist' : 'Add to watchlist'}
          aria-pressed={starred}
          onClick={() => watchlist.toggle(storyId)}
        >
          <StarIcon size={19} filled={starred} />
        </button>
        <button type="button" className={styles['round']} aria-label="Share" onClick={() => void share()}>
          <ShareIcon size={19} />
        </button>
      </div>
    </div>
  );
}

/**
 * The narrative's own coin: the sheet's proven one, else the story's `one`, else the coin the feed's
 * own cards name as this narrative's (`one` with this narrative's id: the projector's newer word when
 * the page was projected before the coin was found). In the sheet's shape. Never picked from several.
 */
function ownCoin(story: Story, sheet: StorySheet | null): SheetCoin | null {
  const proven = sheet?.coins.find((c) => c.proven) ?? null;
  if (proven !== null) return proven;
  const fromCards = sheet?.members.flatMap((m) => (m.post !== null && m.post.storyId === story.id && m.post.coins.kind === 'one' ? [m.post.coins.coin] : [])) ?? [];
  const c = story.coins.kind === 'one' ? story.coins.coin : new Set(fromCards.map((x) => x.address)).size === 1 ? (fromCards[0] ?? null) : null;
  if (c === null) return null;
  return {
    coinId: c.coinId,
    address: c.address,
    name: c.name,
    ticker: c.ticker,
    imageUrl: c.imageUrl,
    launchedAt: c.mintedAt,
    marketCapUsd: c.marketCapUsd,
    changePct24h: c.priceChange24h.known ? { known: true, amount: c.priceChange24h.amount } : { known: false, pending: c.priceChange24h.pending },
    bonded: null,
    proven: true,
  };
}

function Body({ story, sheet, onCreate }: { story: Story; sheet: StorySheet | 'failed' | null; onCreate: (s: Story) => void }) {
  const now = useNow();
  const owner = useIsOwner();
  const [section, setSection] = useState<Section>('posts');
  const [open, setOpen] = useState<string | null>(null);
  const [buying, setBuying] = useState<SheetCoin | null>(null);
  const [note, setNote] = useState<SheetNote | null>(null);
  const read = sheet === 'failed' || sheet === null ? null : sheet;
  const members = useMemo(() => read?.members ?? [], [read]);
  /* The projector's own series when it sends one (it reads every post's readings); else ours. */
  const phoneTotal = useStoryTotal(members, now);
  const total = useMemo(() => (story.viewsSeries !== null ? seriesTotal(story.viewsSeries) : phoneTotal), [story.viewsSeries, phoneTotal]);
  const coin = ownCoin(story, read);
  const status = coinStatus(story.coins);
  const posts = story.postCount ?? story.evidence.length;
  /* "12 of 14 posts counted" under a sum that counted fewer posts than the page lists. */
  const counted = (n: number | null) => (n !== null && n !== posts ? `${n} of ${posts} posts counted` : null);

  /* The projector's gain when it sends one; else ours from the posts' readings; else why not. */
  const gain = story.viewsGained1h !== null
    ? (story.viewsGained1h.known ? { kind: 'value' as const, gain: story.viewsGained1h.amount, minutes: 60 } : { kind: 'unknown' as const, why: 'Not read yet' })
    : read === null ? { kind: 'unknown' as const, why: sheet === 'failed' ? "Couldn't read the posts' views" : 'Reading' } : gainedLastHour(total, now);
  /* The projector's total when it sends one; else every post's views as last read, added up here
     (story-views.ts latestTotal): the card's figure when a feed holds the post, else its own newest reading. */
  const sum = story.viewsTotal !== null
    ? (story.viewsTotal.known ? { kind: 'value' as const, total: story.viewsTotal.amount, oldestAt: now } : { kind: 'unknown' as const, why: 'Not read yet' })
    : read === null
    ? { kind: 'unknown' as const, why: sheet === 'failed' ? "Couldn't read the posts' views" : 'Reading' }
    : latestTotal(members.map((m) => {
        const last = [...m.views].reverse().find((v) => v.value !== null);
        if (m.post !== null && m.post.reach.known) return { latest: m.post.reach.amount, latestAt: m.post.readAt.known ? m.post.readAt.at : (last?.atMs ?? null) };
        return { latest: last?.value ?? null, latestAt: last?.atMs ?? null };
      }));
  const totalNote = story.viewsTotal !== null && sum.kind === 'value' ? counted(story.viewsTotalPosts) : null;
  const gainNote = story.viewsGained1h !== null && gain.kind === 'value' ? counted(story.viewsGained1hPosts) : null;
  const foundAt = story.foundAt?.known === true ? story.foundAt.at : read !== null && read.foundAt.known ? read.foundAt.at : null;
  /* The chart's coin (its MC line and launch marker): its own coin, else the one coin its posts are proven to. */
  const chartCoin = coin ?? (read !== null && read.coins.length === 1 ? (read.coins[0] ?? null) : null);
  const coinAt = chartCoin !== null && chartCoin.launchedAt.known ? chartCoin.launchedAt.at : null;
  const openCoin = (c: SheetCoin) => (window.location.hash = hrefFor(sheetCoinRoute(c, story.id)));

  return (
    <>
      <header className={styles['head']}>
        <Thumb url={story.thumbUrl} size={76} />
        <div className={styles['headText']}>
          <span className={styles['kicker']}>Narrative</span>
          <h1>{story.title}</h1>
          <span className={styles['meta']}>
            {posts === 1 ? '1 post' : `${posts} posts`} on {siteList(story.evidence.map((e) => e.sourceLabel))}
            <Value r={formatAge(story.firstSeenAt, now)} className={styles['age']} />
          </span>
        </div>
      </header>

      <div className={styles['facts']}>
        <div>
          <span className={styles['factL']}>Total views</span>
          {sum.kind === 'value' ? <span className={styles['factN']}>{compact(sum.total)}</span> : <span className={styles['factN']}>—</span>}
          {sum.kind === 'unknown'
            ? <span className={styles['factWhy']}>{sum.why}</span>
            : totalNote !== null ? <span className={styles['factWhy']}>{totalNote}</span>
            : now - sum.oldestAt > STALE_MS ? <span className={styles['factWhy']}>Some last read {formatDuration(now - sum.oldestAt)} ago</span> : null}
        </div>
        <div>
          <span className={styles['factL']}>Posts</span>
          <span className={styles['factN']}>{posts}</span>
        </div>
        <div>
          <span className={styles['factL']}>Last hour</span>
          {gain.kind === 'value'
            ? <span className={`${styles['factN']} ${gain.gain >= 0 ? styles['up'] : styles['down']}`}>{gain.gain >= 0 ? '+' : ''}{compact(gain.gain)}</span>
            : <span className={styles['factN']} title={gain.why}>—</span>}
          {gain.kind === 'unknown' ? <span className={styles['factWhy']}>{gain.why}</span> : gainNote !== null ? <span className={styles['factWhy']}>{gainNote}</span> : null}
        </div>
      </div>

      <div className={styles['coinArea']}>
        {coin !== null ? (
          <>
            <span className={styles['coinHead']}>This narrative's coin</span>
            <CoinLine coin={coin} now={now} onOpen={() => openCoin(coin)} action={
              <button type="button" className={styles['buy']} onClick={(e) => {
                e.stopPropagation();
                setBuying(coin);
              }}>Buy</button>
            } />
            {owner ? <CoinCall storyId={story.id} coin={coin.address} /> : null}
          </>
        ) : (
          <div className={styles['coinNone']}>
            {/* No coin of its own, but coins proven from its posts: said as that, one tap from the list. */}
            <span>{read !== null && read.coins.length > 0 ? `${read.coins.length === 1 ? '1 coin' : `${read.coins.length} coins`} from its posts, none named for it` : status.line}</span>
            {read !== null && read.coins.length > 0 ? (
              <button type="button" className={styles['create']} onClick={() => setSection('coins')}>View coins</button>
            ) : status.action?.kind === 'create' ? (
              <button type="button" className={styles['create']} onClick={() => onCreate(story)}>Create coin</button>
            ) : status.action?.kind === 'view' ? (
              <button type="button" className={styles['create']} onClick={() => setSection('coins')}>View coins</button>
            ) : null}
          </div>
        )}
      </div>

      {read !== null ? (
        <StoryChart
          members={members}
          total={total}
          foundAt={foundAt}
          coin={chartCoin}
          coinAt={coinAt}
          now={now}
          onPost={(m) => openMember(m, story, setOpen)}
        />
      ) : sheet === 'failed' ? <p className={styles['chartNote']}>Couldn't read this narrative's posts just now, so there is no chart.</p> : null}

      <Notice notice={noticeFor(story)} />
      {owner ? <NarrativeOwnerBar story={story} /> : null}

      <UnderlineTabs
        label="Narrative"
        current={section}
        onChange={setSection}
        tabs={[
          { key: 'posts', label: <>Posts <small>{posts}</small></> },
          { key: 'coins', label: <>Coins <small>{read !== null && read.coins.length > 0 ? read.coins.length : ''}</small></> },
          { key: 'comments', label: 'Comments' },
          { key: 'stats', label: 'Stats' },
        ]}
      />

      <div className={styles['section']}>
        {section === 'posts' ? <Posts story={story} sheet={sheet} now={now} onOpen={setOpen} onCreate={onCreate} /> : null}
        {section === 'coins' ? <Coins sheet={sheet} now={now} onOpen={openCoin} onBuy={setBuying} line={status.line} /> : null}
        {section === 'comments' ? <Comments subject={`story:${story.id}`} holdersOf="this narrative" /> : null}
        {section === 'stats' ? <Stats story={story} now={now} /> : null}
      </div>

      {open !== null ? <PostSheet postId={open} onClose={() => setOpen(null)} /> : null}
      {buying !== null ? (
        <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} />
      ) : null}
      <SheetToast note={note} onDone={() => setNote(null)} />
    </>
  );
}

/** A post a feed holds opens its post sheet; one no feed holds opens where it was posted. */
function openMember(m: StoryMember, story: Story, setOpen: (id: string) => void): void {
  if (m.post !== null) {
    setOpen(m.id);
    return;
  }
  const link = story.evidence.find((e) => e.evidenceId === m.id)?.permalink;
  if (link !== undefined) window.open(link, '_blank', 'noopener');
}

/** Newest first, by when each post went up; a post with no time after every one with one. */
function newestFirst<T>(items: readonly T[], at: (t: T) => number | null): T[] {
  const known = items.filter((i) => at(i) !== null).sort((a, b) => (at(b) ?? 0) - (at(a) ?? 0));
  return [...known, ...items.filter((i) => at(i) === null)];
}

function Posts({ story, sheet, now, onOpen, onCreate }: {
  story: Story;
  sheet: StorySheet | 'failed' | null;
  now: number;
  onOpen: (id: string) => void;
  onCreate: (s: Story) => void;
}) {
  const [talk, setTalk] = useState<{ id: string; author: string } | null>(null);
  const owner = useIsOwner();
  const { hidden } = useOwnerState();
  const cards = new Map((sheet === 'failed' || sheet === null ? [] : sheet.members).flatMap((m) => (m.post === null ? [] : [[m.id, m.post] as const])));
  const listed = newestFirst(withoutHidden(story.evidence, hidden, (e) => e.evidenceId), (e) => (e.postedAt.known ? e.postedAt.at : null));
  return (
    <>
      {owner ? <HideBar /> : null}
      {talk !== null ? (
        <Modal title="Comments" subtitle={`On ${talk.author}'s post`} onClose={() => setTalk(null)}>
          <Comments subject={`post:${talk.id}`} holdersOf="this narrative" />
        </Modal>
      ) : null}
      {listed.map((e) => {
        const card = cards.get(e.evidenceId);
        const remove = owner ? <RemovePost storyId={story.id} item={e} /> : null;
        if (card !== undefined) {
          return (
            <div key={e.evidenceId} className={styles['card']}>
              <PostRow
                post={card}
                now={now}
                extra={remove}
                handlers={{
                  open: () => onOpen(card.id),
                  create: () => onCreate(story),
                  seeCoins: () => onOpen(card.id),
                  openCoin: (coinId) => (window.location.hash = hrefFor(sheetCoinRoute({ coinId, proven: true }, story.id))),
                }}
              />
            </div>
          );
        }
        const platform = platformOf(e.sourceLabel);
        return (
          <div key={e.evidenceId}>
            <a className={styles['post']} href={e.permalink} target="_blank" rel="noopener noreferrer">
              <span className={styles['postHead']}>
                {platform !== null ? <PlatformBadge platform={platform} label={e.sourceLabel} /> : <span>{e.sourceLabel}</span>}
                <b>{e.authorLabel}</b>
                <Value r={formatAge(e.postedAt, now)} className={styles['age']} />
              </span>
              <span className={styles['postText']}>{e.excerpt}</span>
            </a>
            <button type="button" className={styles['postComments']} onClick={() => setTalk({ id: e.evidenceId, author: e.authorLabel })}>
              Comments
            </button>
            {remove}
          </div>
        );
      })}
    </>
  );
}

function Coins({ sheet, now, onOpen, onBuy, line }: {
  sheet: StorySheet | 'failed' | null;
  now: number;
  onOpen: (c: SheetCoin) => void;
  onBuy: (c: SheetCoin) => void;
  line: string;
}) {
  if (sheet === null) return <p className={styles['note']}>Reading the coins.</p>;
  if (sheet === 'failed') return <p className={styles['note']}>Couldn't read this narrative's coins just now.</p>;
  if (sheet.coins.length === 0) return <p className={styles['note']}>{line}</p>;
  return (
    <div className={styles['coinList']}>
      {sheet.coins.map((c, i) => (
        <div key={c.address}>
          {i === 0 && c.proven ? <span className={styles['coinHead']}>This narrative's coin</span> : null}
          {(i === 0 && !c.proven) || (i === 1 && sheet.coins[0]?.proven === true) ? <span className={styles['coinHead']}>Other fitting coins</span> : null}
          <CoinLine coin={c} now={now} onOpen={() => onOpen(c)} action={
            <button type="button" className={styles['buy']} onClick={(e) => {
              e.stopPropagation();
              onBuy(c);
            }}>Buy</button>
          } />
        </div>
      ))}
    </div>
  );
}

function Stats({ story, now }: { story: Story; now: number }) {
  const earliest = story.earliestPost;
  const rows: readonly [string, React.ReactNode][] = [
    ['Views', <Value r={formatCount(story.reach)} />],
    ['Views in the last 24 hours', <Value r={formatCount(story.reachDelta24h)} />],
    [earliest.known && earliest.startedBy !== null ? 'Started by' : 'Earliest post found', <Earliest post={earliest} now={now} />],
    ['Posts', story.evidence.length],
    ['Sites', siteList(story.evidence.map((e) => e.sourceLabel)) || '—'],
  ];
  return (
    <dl className={styles['stats']}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "@handle, 6h ago", linked to the post, and under "Started by" the proof in a few words.
 * A dash with its reason when no post in the story carries a time.
 */
function Earliest({ post, now }: { post: Story['earliestPost']; now: number }) {
  if (!post.known) return <Value r={formatAge(pendingInstant(post.pending), now)} />;
  const text = (
    <>
      {post.authorLabel}, <Ago r={formatAge(instant(post.at), now)} />
    </>
  );
  const proof = post.startedBy === 'quoted' ? 'later posts quote it' : post.startedBy === 'samePicture' ? 'same picture' : null;
  return (
    <>
      {post.permalink === null ? text : <a href={post.permalink} target="_blank" rel="noopener noreferrer">{text}</a>}
      {proof === null ? null : <span className={styles['age']}> ({proof})</span>}
    </>
  );
}

/** "6h ago", or a dash with its reason — never "— ago". */
function Ago({ r }: { r: ReturnType<typeof formatAge> }) {
  return r.kind === 'value' ? <>{r.text} ago</> : <Value r={r} />;
}
