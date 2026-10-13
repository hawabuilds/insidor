/**
 * THE POST SHEET — one feed post, opened from its For You card or from a coin page's viral post
 * card: who posted it, the post itself (its video plays here), its views and how they grew, and
 * the post's main coin with Buy, Create and the full coin list (Choose coin, ChooseCoin.tsx).
 *
 * Its own feature folder because two screens open it (features/feed and features/token), and
 * neither should own the other's sheet. The props are the contract the token page builds on
 * (post-sheet-contract.md in the coordinator's notes): `postId` is the feed post's id
 * (`RisingPost.id`, the same id `AboutPost.postId` carries) and `onClose` puts the screen back as
 * it was, tab bar included — the sheet sits over it and takes nothing away.
 *
 * ★ ONE PHONE SCREEN, NO SCROLLING, at 390 by 844: the media box is sized from what is left, and
 * a part with nothing real to show (no chart history, no narrative, no reply count) is left out
 * rather than drawn empty. ★ FACTS ONLY: who, when, how many, and which coin; never how sure.
 * ★ THE ONLY LINK OUT is the open button, to the post where it was posted.
 *
 * Buy opens the existing ticket unchanged (BuyOpen.tsx); there is no quick buy here — that is on
 * Choose coin only. Tapping the coin row anywhere else opens that coin's token page.
 *
 * What breaks if changed carelessly: renaming or adding a required prop breaks the token page,
 * which renders this sheet knowing nothing else about the post.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ReadError, fetchPostSheet, type PostSheetData, type SheetCoin } from '../../shared/api/index.ts';
import { evidenceFacts } from '../../shared/coin-status.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact, formatCount } from '../../shared/format/number.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { platformOf } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { watchlist } from '../../shared/watchlist.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { BellIcon, ChevronIcon } from '../../shared/ui/icons.tsx';
import { PlatformBadge } from '../../shared/ui/PlatformMark.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { CreateCoin } from '../create/CreateCoin.tsx';
import { BuyOpen, SheetToast, type SheetNote } from './BuyOpen.tsx';
import { ChooseCoin } from './ChooseCoin.tsx';
import { CoinLine } from './CoinLine.tsx';
import { PostMedia } from './PostMedia.tsx';
import { ReachChart } from './ReachChart.tsx';
import { OpenIcon } from './sheet-icons.tsx';
import { chartPlan, coinTag, firstCoinAfter, followersText, foundTag, gainText, provenWhy, recentGain } from './sheet-view.ts';
import styles from './post-sheet.module.css';

export interface PostSheetProps {
  /** The feed post's id: `RisingPost.id`, or `AboutPost.postId` on a coin page. */
  readonly postId: string;
  readonly onClose: () => void;
}

/** The media box's height: the picture's own shape at the card's width, between these bounds. */
const MEDIA_MIN = 120;
const MEDIA_MAX = 186;
const CARD_WIDTH = 334;
const CHART_HEIGHT = 92;

export function PostSheet({ postId, onClose }: PostSheetProps) {
  const [loaded, reload] = useLoad(`post-sheet:${postId}`, (signal) => fetchPostSheet(postId, signal));
  const [view, setView] = useState<'post' | 'coins'>('post');
  const [buying, setBuying] = useState<SheetCoin | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<SheetNote | null>(null);
  const clearNote = useCallback(() => setNote(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && buying === null && !creating) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, buying, creating]);

  const data = loaded.state === 'ready' ? loaded.value : null;
  /* A coin's page: with its narrative around it when the post has one, as the feed opens it. */
  const openCoin = (c: SheetCoin) => {
    const storyId = data?.post.storyId ?? data?.narrative?.storyId ?? null;
    onClose();
    window.location.hash = hrefFor(storyId !== null ? { screen: 'coin', storyId, coinId: c.coinId } : { screen: 'token', coinId: c.coinId });
  };

  return (
    <>
      <div className={styles['scrim']} onClick={onClose}>
        <div className={styles['sheet']} role="dialog" aria-modal="true" aria-label="Post" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={styles['gripButton']} aria-label="Close" onClick={onClose}>
            <span className={styles['grip']} />
          </button>
          {loaded.state === 'loading' ? <p className={styles['note']}>Reading the post.</p> : null}
          {loaded.state === 'failed' ? (
            <div className={styles['note']}>
              <p>
                {loaded.error instanceof ReadError && loaded.error.said === 'not found'
                  ? 'This post has left the feed, so there is nothing more to show about it.'
                  : "Couldn't read this post just now."}
              </p>
              {!(loaded.error instanceof ReadError && loaded.error.said === 'not found') ? (
                <button type="button" className={styles['dark']} onClick={reload}>Try again</button>
              ) : null}
            </div>
          ) : null}
          {data !== null && view === 'post' ? (
            <PostView data={data} onBuy={setBuying} onOpenCoin={openCoin} onCreate={() => setCreating(true)} onAll={() => setView('coins')} onNarrative={(id) => {
              onClose();
              window.location.hash = hrefFor({ screen: 'story', storyId: id });
            }} />
          ) : null}
          {data !== null && view === 'coins' ? (
            <ChooseCoin data={data} onBack={() => setView('post')} onOpenCoin={openCoin} onCreate={() => setCreating(true)} onNote={setNote} />
          ) : null}
        </div>
      </div>
      {buying !== null ? (
        <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} />
      ) : null}
      {creating && data !== null ? (
        <CreateCoin
          from={{ title: data.post.excerpt, reach: data.post.reach, thumbUrl: data.post.thumbUrl, labelled: false, storyId: data.post.storyId, link: data.post.permalink, postId: data.post.id }}
          onClose={() => setCreating(false)}
        />
      ) : null}
      <SheetToast note={note} onDone={clearNote} />
    </>
  );
}

function PostView({ data, onBuy, onOpenCoin, onCreate, onAll, onNarrative }: {
  data: PostSheetData;
  onBuy: (c: SheetCoin) => void;
  onOpenCoin: (c: SheetCoin) => void;
  onCreate: () => void;
  onAll: () => void;
  onNarrative: (storyId: string) => void;
}) {
  const now = useNow();
  const post = data.post;
  const platform = platformOf(post.sourceLabel);
  const [mediaGone, setMediaGone] = useState(false);
  const readings = data.views.length > 0 ? data.views : post.spark.points.map((p) => ({ atMs: p.atMs, value: p.value }));
  const gain = recentGain(readings);
  const firstCoin = firstCoinAfter(post.postedAt, data.coins.map((c) => c.launchedAt));
  const plan = useMemo(
    () => chartPlan(data.views, post.postedAt.known ? post.postedAt.at : null, { found: data.foundAt.known ? data.foundAt.at : null, coin: firstCoin }),
    [data, firstCoin, post.postedAt],
  );
  const found = foundTag(post.postedAt, data.foundAt);
  const coinAt = coinTag(post.postedAt, firstCoin);
  const media = data.media !== null && !mediaGone ? data.media : null;
  const mediaHeight = media === null ? 0 : Math.round(Math.min(MEDIA_MAX, Math.max(MEDIA_MIN, media.width !== null && media.height !== null && media.width > 0 ? (CARD_WIDTH * media.height) / media.width : MEDIA_MAX)));
  const handle = post.authorLabel;
  /* With no name stored, the handle is the name, said once. */
  const name = data.author.name ?? handle;
  const age = formatAge(post.postedAt, now);
  const watched = useWatchlist();
  const storyId = data.narrative?.storyId ?? null;

  const proven = data.coins.find((c) => c.proven) ?? null;
  const main = proven ?? data.coins[0] ?? null;
  const matched = post.coins.kind === 'matched';
  const why = proven !== null ? provenWhy(post.coins, evidenceFacts) : null;

  return (
    <>
      <section className={styles['postCard']}>
        <header className={styles['who']}>
          <span className={styles['avatar']}>
            <Avatar url={data.author.pictureUrl} letter={name.replace(/^@/, '')} />
            {platform !== null ? <PlatformBadge platform={platform} label={post.sourceLabel} /> : null}
          </span>
          <span className={styles['whoText']}>
            <b className={styles['name']}>{name}</b>
            <span className={styles['byline']}>
              {data.author.name !== null && handle.startsWith('@') ? <span>{handle}</span> : null}
              {data.author.followers.known ? <span>{followersText(data.author.followers.amount)}</span> : null}
              {age.kind === 'value' ? <span>{age.text}</span> : null}
            </span>
          </span>
          {/* Alerts for a proven coin go to a narrative's watchers: the bell stars the narrative, and is not drawn without one. */}
          {storyId !== null ? (
            <button type="button" className={`${styles['round']} ${watched.includes(storyId) ? styles['roundOn'] : ''}`} aria-pressed={watched.includes(storyId)} aria-label={watched.includes(storyId) ? 'Stop alerts for this narrative' : 'Alert me when a proven coin appears'} onClick={() => watchlist.toggle(storyId)}>
              <BellIcon size={20} />
            </button>
          ) : null}
          {post.permalink !== null ? (
            <a className={styles['round']} href={post.permalink} target="_blank" rel="noopener noreferrer" aria-label={`Open the post on ${post.sourceLabel}`}>
              <OpenIcon size={18} />
            </a>
          ) : null}
        </header>
        {post.excerpt !== '' ? <p className={styles['text']}>{post.excerpt}</p> : null}
        {media !== null ? <PostMedia media={media} height={mediaHeight} onGone={() => setMediaGone(true)} /> : null}
      </section>

      <section className={styles['views']}>
        <div className={styles['viewsLeft']}>
          <span className={styles['label']}>Views</span>
          <span className={styles['viewsLine']}>
            <Value r={formatCount(post.reach)} className={styles['bigNumber']} />
            {gainText(gain) !== null && gain !== null ? <span className={gain.gain >= 0 ? styles['up'] : styles['down']}>{gainText(gain)} {gain.minutes}m</span> : null}
          </span>
        </div>
        <span className={styles['tags']}>
          {found !== null ? <span className={styles['tagFound']}>{found}</span> : null}
          {coinAt !== null ? <span className={styles['tag']}>{coinAt}</span> : null}
        </span>
      </section>

      {plan !== null ? <ReachChart plan={plan} now={now} height={CHART_HEIGHT} /> : null}

      <Tiles data={data} onNarrative={onNarrative} />

      <section className={styles['coinArea']}>
        {main !== null ? (
          <>
            <div className={styles['coinHead']}>
              {proven !== null ? (
                <>
                  <span>{matched ? 'Coin made from this post' : "This narrative's coin"}</span>
                  <span className={styles['upText']}>{why?.split(', ')[0]}</span>
                </>
              ) : (
                <>
                  <span>{topLine(main, data.coinName)}</span>
                  <span>Not proven from this post</span>
                </>
              )}
            </div>
            <CoinLine coin={main} now={now} onOpen={() => onOpenCoin(main)} action={
              <button type="button" className={styles['buy']} onClick={(e) => {
                e.stopPropagation();
                onBuy(main);
              }}>Buy</button>
            } />
          </>
        ) : (
          <div className={styles['coinHead']}><span>No coin with this name yet</span></div>
        )}
        <div className={styles['pair']}>
          <button type="button" className={styles['dark']} onClick={onCreate}>Create</button>
          {data.coins.length > 0 ? (
            <button type="button" className={styles['dark']} onClick={onAll}>
              <span className={styles['stack']}>
                {data.coins.slice(0, 3).map((c) => (
                  <span key={c.address} className={styles['stackItem']}><CoinLogo address={c.address} ticker={c.ticker ?? c.name} imageUrl={c.imageUrl} size={26} /></span>
                ))}
              </span>
              {data.coins.length === 1 ? 'All 1 coin' : `All ${data.coins.length} coins`}
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}

/** Narrative, views a minute, $tickers in replies: each only when we have it. */
function Tiles({ data, onNarrative }: { data: PostSheetData; onNarrative: (storyId: string) => void }) {
  const n = data.narrative;
  const tiles = [
    n !== null && n.title !== null ? (
      <button key="n" type="button" className={`${styles['tile']} ${styles['tileLink']}`} onClick={() => onNarrative(n.storyId)}>
        <span className={styles['label']}>Narrative</span>
        <span className={styles['tileValue']}><span className={styles['clip']}>{n.title}</span><ChevronIcon size={14} /></span>
      </button>
    ) : null,
    data.perMinute.known ? (
      <div key="m" className={styles['tile']}>
        <span className={styles['label']}>Per minute</span>
        <span className={styles['tileValue']}>{compact(data.perMinute.amount)}</span>
      </div>
    ) : null,
    data.tickersInReplies.known ? (
      <div key="r" className={styles['tile']}>
        <span className={styles['label']}>$ in replies</span>
        <span className={styles['tileValue']}>{compact(data.tickersInReplies.amount)}</span>
      </div>
    ) : null,
  ].filter((t) => t !== null);
  if (tiles.length === 0) return null;
  return <section className={styles['tiles']}>{tiles}</section>;
}

/** "Top Goliath coin by MC" when the top coin carries the shared name; otherwise without a name, never another coin's. */
function topLine(main: SheetCoin, shared: string | null): string {
  const same = (v: string | null) => v !== null && shared !== null && v.toLowerCase() === shared.toLowerCase();
  return shared !== null && (same(main.name) || same(main.ticker)) ? `Top ${shared} coin by MC` : 'Top coin by MC';
}

/** The poster's picture, or the first letter of their name when there is none or it will not load. */
function Avatar({ url, letter }: { url: string | null; letter: string }) {
  const [failed, setFailed] = useState(false);
  if (url !== null && !failed) return <img className={styles['avatarImg']} src={url} alt="" onError={() => setFailed(true)} />;
  return <span className={styles['avatarLetter']} aria-hidden="true">{(letter.trim()[0] ?? '?').toUpperCase()}</span>;
}
