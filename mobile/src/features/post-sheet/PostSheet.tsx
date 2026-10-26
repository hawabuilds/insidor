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
 * ★ TWO PARTS, as the owner laid it out. The head (who posted it, the Watch star, the open button and
 * the X) and the foot (the coin line, the coin with Buy, then Create and All coins) stay put; the
 * middle (the words, the media at its own shape, whole, the views, the chart, the tiles) scrolls when it
 * is taller than the phone. Nothing shrinks to fit but the views chart's plot, which takes the height
 * the middle has left (CHART_SHORTEST to CHART_TALLEST), so on a 390x844 phone the whole sheet
 * shows without scrolling, and with less room it is the middle that scrolls. It is drawn with the shared Sheet
 * (shared/ui/Sheet.tsx), which gives it every way to close. ★ FACTS ONLY: who, when, how many,
 * and which coin; never how sure. ★ THE ONLY LINK OUT is the open button, to the post where it
 * was posted, an outlined square so it is never mistaken for the round X beside it.
 *
 * ★ THE VIEWS, THE FACT LINE AND THE ONE CHART (the owner's design, 2026-10-17): the views, then one
 * line of facts, "Last 5m +48K   MC +6%   Found 2m before $GTA", then this post's views gained
 * every five minutes (GainChart.tsx, gain-chart.ts's rule) with Found and the coin's launch at
 * their exact times, then "Part of a story" when the post is in a narrative the board lists. The
 * coin in those words and that marker is the post's own proven coin only; MC is hidden until the
 * coin has enough trades (mc-change.ts), and "Found before" only when we really were first.
 *
 * Buy opens the existing ticket unchanged (BuyOpen.tsx); there is no quick buy here — that is on
 * Choose coin only. Tapping the coin row anywhere else opens that coin's token page.
 *
 * `start: 'coins'` opens straight on Choose coin (a For You card's "See N coins"); its back arrow
 * still leads to the post.
 *
 * What breaks if changed carelessly: renaming or adding a required prop breaks the token page,
 * which renders this sheet knowing nothing else about the post.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ReadError, fetchPostSheet, type PostSheetData, type SheetCoin } from '../../shared/api/index.ts';
import { askForReading } from '../../shared/api/people.ts';
import { evidenceFacts } from '../../shared/coin-status.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact, formatCount } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { QuoteInset } from '../../shared/ui/QuoteInset.tsx';
import { quotePictureLeads, sharedByLabel, type SharedBy } from '../../shared/api/wire/rising.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { deletedLine, platformOf } from '../../shared/platform.ts';
import { storyWords } from '../../shared/story-words.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { ChevronIcon, ShareIcon } from '../../shared/ui/icons.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { WatchStar } from '../../shared/ui/WatchStar.tsx';
import { PlatformBadge } from '../../shared/ui/PlatformMark.tsx';
import { Sheet, SheetBody, SheetFoot, SheetHead } from '../../shared/ui/Sheet.tsx';
import { TranslatedLine, useShownWords } from '../../shared/ui/Translated.tsx';
import { usePosterPic } from '../../shared/ui/usePosterPic.ts';
import { Value } from '../../shared/ui/Value.tsx';
import { CreateCoin } from '../create/CreateCoin.tsx';
import { usePreloadCreate } from '../create/preload.ts';
import { sheetCoinRoute } from '../token/coin-opening.ts';
import { BuyOpen, SheetToast, type SheetNote } from './BuyOpen.tsx';
import { ChooseCoin } from './ChooseCoin.tsx';
import { CoinLine } from './CoinLine.tsx';
import { PostMedia } from './PostMedia.tsx';
import { tiktokVideoId } from './tiktok-player.ts';
import { OpenIcon } from './sheet-icons.tsx';
import { followersText, listIsOwners, provenWhy } from './sheet-view.ts';
import { useIsOwner } from '../owner/hooks.ts';
import { GainChart, type ChartMarker } from './GainChart.tsx';
import { firstWords, hm, lastGain, launchTime, plus, postSlots } from './gain-chart.ts';
import { pctText } from './mc-change.ts';
import { useMcChange } from './useMcChange.ts';
import { useOpenedPost } from '../owner/useSeen.ts';
import styles from './post-sheet.module.css';
import { Num } from '../../shared/ui/Num.tsx';
import { coinsMadeAfter } from '../../shared/coins-made.ts';
import { sharePage } from '../../shared/share-link.ts';

export interface PostSheetProps {
  /** The feed post's id: `RisingPost.id`, or `AboutPost.postId` on a coin page. */
  readonly postId: string;
  readonly onClose: () => void;
  /** Which view opens first: the post (the default) or Choose coin. */
  readonly start?: 'post' | 'coins';
}

/**
 * The plot's height takes what the middle has left once everything else in it is drawn (the
 * owner, 2026-10-16: one 390x844 screen, nothing cut off), between these two. Below the shortest
 * the middle scrolls instead; the coin row and buttons never move.
 */
const CHART_SHORTEST = 96;
const CHART_TALLEST = 200;
/** The sheet's side padding, both sides, and the widest the app's column gets. */
const SIDES = 32;
/** The post card's own padding, both sides (post-sheet.module.css .postCard), inside the sheet's. */
const CARD_SIDES = 16;
const COLUMN = 480;
/**
 * The tallest the media box may be, in px (the owner, 2026-10-16): 160, so on a 390x844 phone the
 * whole sheet, post card, views, chart, tiles, coin row and buttons, fits without scrolling. A
 * taller or portrait frame is shown whole inside it with dark bars at the sides, never cropped or
 * squashed; a tap opens it full screen (PostMedia.tsx).
 */
const MEDIA_TALLEST = 160;
/** How many lines of the post's words show before a tap: fewer above media, more with none; and a quoted post's. */
const TEXT_LINES = { withMedia: 2, alone: 6, quote: 3 } as const;

/**
 * The media box's height: the media's own shape at the sheet's real width, so the whole frame
 * shows; a taller frame stops at MEDIA_TALLEST and is shown whole inside it. A post
 * that does not say its shape gets a square box. (PostMedia.tsx draws the media in it, contained.)
 */
function mediaHeight(width: number | null, height: number | null): number {
  const inner = Math.min(window.innerWidth, COLUMN) - SIDES - CARD_SIDES;
  const shape = width !== null && height !== null && width > 0 && height > 0 ? height / width : 1;
  return Math.round(Math.min(inner * shape, MEDIA_TALLEST));
}

export function PostSheet({ postId, onClose, start = 'post' }: PostSheetProps) {
  const [loaded, reload] = useLoad(`post-sheet:${postId}`, (signal) => fetchPostSheet(postId, signal), 'phone');
  usePreloadCreate(postId); /* Create coin then opens on this post's own names, with nothing filling in. */
  useOpenedPost(postId); /* The owner's opened posts (features/owner/useSeen.ts); nothing for anyone else. */
  /* Opening the sheet asks for a fresh view reading for its chart; a refusal or an outage changes nothing here. */
  useEffect(() => {
    askForReading(postId).catch(() => undefined);
  }, [postId]);
  const [view, setView] = useState<'post' | 'coins'>(start);
  const [buying, setBuying] = useState<SheetCoin | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<SheetNote | null>(null);
  const clearNote = useCallback(() => setNote(null), []);

  /* Only the coins made after the post (shared/coins-made.ts): older same-name coins are not its. */
  const data = useMemo(() => {
    if (loaded.state !== 'ready') return null;
    const v = loaded.value;
    /* A post in a narrative: from the narrative's oldest post, so a coin its first post made still shows. */
    const own = v.post.postedAt.known ? v.post.postedAt.at : null;
    const first = v.narrative?.firstPostedAt ?? null;
    return { ...v, coins: coinsMadeAfter(v.coins, own === null ? first : first === null ? own : Math.min(own, first)) };
  }, [loaded]);
  /* Leaving for another screen: the sheet stays open on the page it was opened over, which stays
     drawn behind (App.tsx, shared/ui/dismiss.ts), so Back from that screen finds this sheet as it
     was, on the same view (the owner, 2026-10-21: Back must not reset the page it returns to). */
  const go = (href: string) => {
    window.location.hash = href;
  };
  /* A coin's page, always (coin-opening.ts): the post's proven coin with its narrative around it,
     any other by its own id with the grey "not proven" line. */
  const openCoin = (c: SheetCoin) => go(hrefFor(sheetCoinRoute(c, data?.post.storyId ?? data?.narrative?.storyId ?? null)));

  return (
    <>
      <Sheet label={view === 'coins' ? 'Choose coin' : 'Post'} onClose={onClose} escape={buying === null && !creating}>
        {data === null ? (
          <>
            <SheetHead title="Post" />
            <SheetBody last>
              {loaded.state === 'loading' ? (
                <div className={styles['skeleton']} role="status">
                  <span className={styles['unseen']}>Reading the post.</span>
                  <div className={styles['skeletonHead']} aria-hidden="true"><span /><span /></div>
                  <div className={styles['skeletonLine']} aria-hidden="true" />
                  <div className={`${styles['skeletonLine']} ${styles['skeletonShort']}`} aria-hidden="true" />
                  <div className={styles['skeletonMedia']} aria-hidden="true" />
                  <div className={styles['skeletonChart']} aria-hidden="true" />
                </div>
              ) : null}
              {loaded.state === 'failed' ? (
                <div className={styles['note']}>
                  <p>
                    {loaded.error instanceof ReadError && loaded.error.said === 'not found'
                      ? 'This post has left the feed, so there is nothing more to show about it.'
                      : "Couldn't read this post just now."}
                  </p>
                  {!(loaded.error instanceof ReadError && loaded.error.said === 'not found') ? (
                    <Button look="link" size="large" onClick={reload}>Try again</Button>
                  ) : null}
                </div>
              ) : null}
            </SheetBody>
          </>
        ) : view === 'post' ? (
          <PostView data={data} onBuy={setBuying} onOpenCoin={openCoin} onCreate={() => setCreating(true)} onAll={() => setView('coins')} onNarrative={(id) => go(hrefFor({ screen: 'story', storyId: id }))} />
        ) : (
          <ChooseCoin data={data} onBack={() => setView('post')} onOpenCoin={openCoin} onCreate={() => setCreating(true)} onNote={setNote} />
        )}
      </Sheet>
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

/**
 * The post's words, always at the top of the sheet: cut to `lines`, and when they are cut a tap
 * shows them all (and another tap cuts them again). Words that fit are plain text, not a button.
 */
function PostText({ text, lines }: { text: string; lines: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const p = ref.current;
    if (p !== null && !open) setCut(p.scrollHeight > p.clientHeight + 1);
  }, [text, lines, open]);
  return (
    <p
      ref={ref}
      className={`${styles['text']} ${cut ? styles['textCut'] : ''}`}
      style={open ? { WebkitLineClamp: 'unset', display: 'block' } : { WebkitLineClamp: lines }}
      {...(cut ? { role: 'button', tabIndex: 0, 'aria-expanded': open, onClick: () => setOpen((o) => !o), onKeyDown: (e: { key: string }) => e.key === 'Enter' && setOpen((o) => !o) } : {})}
    >
      {text}
    </p>
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
  const toast = useToast();
  const post = data.post;
  const platform = platformOf(post.sourceLabel);
  const [mediaGone, setMediaGone] = useState(false);
  const middle = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(140);
  /* After every draw: give the chart whatever the middle has spare, or take back what overflows. */
  useLayoutEffect(() => {
    const inner = middle.current;
    const body = inner?.closest('[data-sheet-scroll]');
    if (inner == null || !(body instanceof HTMLElement)) return;
    const pad = parseFloat(getComputedStyle(body).paddingTop) + parseFloat(getComputedStyle(body).paddingBottom);
    const spare = body.clientHeight - pad - inner.offsetHeight;
    const next = Math.round(Math.min(CHART_TALLEST, Math.max(CHART_SHORTEST, chartHeight + spare)));
    if (Math.abs(next - chartHeight) > 1) setChartHeight(next);
  });
  /* The English when the post was written in another language, with its line (shared/ui/Translated.tsx). */
  const words = useShownWords(post);
  /* The post's views gained, five minutes at a time, from its own readings (gain-chart.ts): the chart and "Last 5m". */
  const minute = Math.floor(now / 60_000) * 60_000;
  const slots = useMemo(() => postSlots(data.views, minute), [data.views, minute]);
  const gain = lastGain(slots, '5m');
  const media = data.media !== null && !mediaGone ? data.media : null;
  /* The post this one quotes; `quoteLeads` when its picture is the card's (and so the sheet's media). */
  const quote = post.quote ?? null;
  const quoteLeads = quotePictureLeads(post);
  const handle = post.authorLabel;
  /* With no name stored, the handle is the name, said once. */
  const name = data.author.name ?? handle;
  const age = formatAge(post.postedAt, now);

  const proven = data.coins.find((c) => c.proven) ?? null;
  /* ★ One post, one coin: the coins that only share the name are the owner's list (listIsOwners). */
  const owner = useIsOwner();
  const listShown = owner || !listIsOwners(post.coins);
  const main = proven ?? (listShown ? (data.coins[0] ?? null) : null);
  const matched = post.coins.kind === 'matched';
  const why = proven !== null ? provenWhy(post.coins, evidenceFacts) : null;
  /* Who was first, against the post's own proven coin only: an unproven coin is not "the" coin. */
  const mc = useMcChange(proven?.address ?? null, '5m');
  const ticker = proven !== null ? tickerText(proven.ticker ?? proven.name ?? proven.address.slice(0, 4)) : '';
  const launch = proven === null ? null : launchTime(proven.launchedAt.known ? proven.launchedAt.at : null, proven.launchClock, now);
  const foundAt = data.foundAt.known ? data.foundAt.at : null;
  const first = firstWords(foundAt, launch ?? { kind: 'unknown' }, ticker);
  const markers: ChartMarker[] = [
    ...(foundAt !== null ? [{ key: 'found', tone: 'found' as const, text: `Found ${hm(foundAt, now)}`, at: foundAt }] : []),
    ...(launch === null ? [] : launch.kind === 'at'
      ? [{ key: 'coin', tone: 'coin' as const, text: `${ticker} ${launch.text}`, at: launch.at }]
      : [{ key: 'coin', tone: 'coin' as const, text: `${ticker} launch time not known`, at: null }]),
  ];

  return (
    <>
      <SheetHead>
        <span className={styles['avatar']}>
          <Avatar file={data.author.pictureFile} url={data.author.pictureUrl} letter={name.replace(/^@/, '')} />
          {platform !== null ? <PlatformBadge platform={platform} label={post.sourceLabel} /> : null}
        </span>
        <span className={styles['whoText']}>
          <b className={styles['name']}>{name}</b>
          <span className={styles['byline']}>
            {data.author.name !== null && handle.startsWith('@') ? <span>{handle}</span> : null}
            {data.author.followers.known ? <span>{followersText(data.author.followers.amount)}</span> : null}
            {age.kind === 'value' ? <span>{age.text}</span> : null}
            {post.deletedAt !== undefined ? <span>{deletedLine(post.sourceLabel)}</span> : null}
          </span>
        </span>
        {/* Watch this post (the owner, 2026-10-14): its coin, when one launches or is found, is pushed within seconds. */}
        <WatchStar postId={post.id} size="sheet" />
        {/* Share this post's page in the app (shared/share-link.ts): the phone's share sheet, or the link copied. */}
        <button type="button" className={styles['open']} aria-label="Share this post" onClick={() => {
          void sharePage({ screen: 'post', postId: post.id }, `${name} on Insidor`).then((o) => {
            if (o === 'copied') toast('Link copied');
            else if (o === 'failed') toast("Couldn't share the link");
          });
        }}>
          <ShareIcon size={18} />
        </button>
        {/* A deleted post's page is gone: no link out offered as if it worked (RisingPost.deletedAt). */}
        {post.permalink !== null && post.deletedAt === undefined ? (
          <a className={styles['open']} href={post.permalink} target="_blank" rel="noopener noreferrer" aria-label={`Open the post on ${post.sourceLabel}`}>
            <OpenIcon size={18} />
          </a>
        ) : null}
      </SheetHead>

      <SheetBody>
        <div ref={middle} className={styles['scroll']}>
          {/* ★ A huge account just shared this post (RisingPost.sharedBy): who, with their face, and when; a link to the share. */}
          {post.sharedBy !== undefined ? <SharedLine share={post.sharedBy} now={now} /> : null}
          {post.excerpt !== '' || media !== null || quote !== null ? (
            <section className={styles['postCard']}>
              {post.excerpt !== '' ? (
                <div>
                  <PostText text={words.text} lines={media !== null ? TEXT_LINES.withMedia : TEXT_LINES.alone} />
                  <TranslatedLine line={words.line} className={styles['wordsLine']} />
                </div>
              ) : null}
              {/* ★ The quoted post (QuoteInset.tsx). With no media of its own the media below IS the
                  quoted post's, so the box comes first and shows no picture; else after the media, with it. */}
              {quote !== null && quoteLeads ? <QuoteInset quote={quote} showPicture={false} now={now} lines={TEXT_LINES.quote} link /> : null}
              {media !== null ? <PostMedia media={media} height={mediaHeight(media.width, media.height)} onGone={() => setMediaGone(true)} postUrl={post.deletedAt === undefined ? post.permalink : null} sourceLabel={post.sourceLabel} tiktokId={platform === 'tiktok' ? tiktokVideoId(post.id) : null} /> : null}
              {quote !== null && !quoteLeads ? <QuoteInset quote={quote} showPicture now={now} lines={TEXT_LINES.quote} link /> : null}
            </section>
          ) : null}

          <section className={styles['views']}>
            <span className={styles['viewsLine']}>
              <Value r={formatCount(post.reach)} className={styles['bigNumber']} />
              <span className={styles['viewsWord']}>views</span>
            </span>
            <p className={styles['facts']}>
              {slots !== null ? (
                <span>
                  Last 5m {gain !== null ? <b className={gain > 0 ? styles['upText'] : styles['plainText']}>{plus(gain)}</b> : 'not read'}
                </span>
              ) : null}
              {proven !== null && mc !== null ? (
                <span>
                  MC <b className={mc >= 0 ? styles['upText'] : styles['downText']}><Num>{pctText(mc)}</Num></b>
                </span>
              ) : null}
              {first !== null ? (
                <span>
                  {first.lead} <b className={styles['plainText']}>{first.gap}</b> {first.tail}
                </span>
              ) : null}
            </p>
          </section>

          {slots !== null && slots.values.some((v) => v !== null) ? (
            <GainChart slots={slots} firstAt={post.postedAt.known ? post.postedAt.at : null} firstWord="posted" now={minute} interval="5m" onInterval={() => undefined} markers={markers} height={chartHeight} rail={false} />
          ) : null}

          {data.storyCard !== null ? <StoryCard card={data.storyCard} onOpen={onNarrative} /> : null}

          <Tiles data={data} />
        </div>
      </SheetBody>

      <SheetFoot>
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
            <div className={styles['coinHead']}><span>{listShown ? 'No coin with this name yet' : 'No coin for this post yet'}</span></div>
          )}
          {/* One main button at the bottom: Buy when there is a coin, Create when there is none. The
              other choices are words under it, never a second filled button (the approved system). */}
          {main === null ? <Button look="primary" size="large" className={styles['wide']} onClick={onCreate}>Create</Button> : null}
          {main !== null || (listShown && data.coins.length > 0) ? (
            <div className={styles['links']}>
              {main !== null ? <Button look="link" size="large" onClick={onCreate}>Create</Button> : null}
              {listShown && data.coins.length > 0 ? (
                <Button look="link" size="large" onClick={onAll}>
                  <span className={styles['stack']}>
                    {data.coins.slice(0, 3).map((c) => (
                      <span key={c.address} className={styles['stackItem']}><CoinLogo small address={c.address} ticker={c.ticker ?? c.name} imageUrl={c.imageUrl} size={22} /></span>
                    ))}
                  </span>
                  {data.coins.length === 1 ? 'All 1 coin' : `All ${data.coins.length} coins`}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </SheetFoot>
    </>
  );
}

/**
 * "Part of a story" (the owner's design, 2026-10-17): the narrative's picture, title and post count
 * under the chart, opening its page. Only for a narrative the board lists now (the reply's
 * `storyCard`), so it never points at a group that is not a real narrative.
 */
function StoryCard({ card, onOpen }: { card: NonNullable<PostSheetData['storyCard']>; onOpen: (storyId: string) => void }) {
  return (
    <button type="button" className={styles['storyCard']} onClick={() => onOpen(card.storyId)}>
      <Thumb url={card.thumbUrl} file={card.thumbFile} size={44} radius={10} />
      <span className={styles['storyCardText']}>
        <span className={styles['storyCardKicker']}>Part of a story</span>
        <span className={styles['storyCardTitle']}>
          <b>{card.title ?? 'Untitled'}</b>
          {card.posts !== null ? <span>{card.posts === 1 ? '1 post' : `${card.posts} posts`}</span> : null}
        </span>
      </span>
      <ChevronIcon size={18} />
    </button>
  );
}

/** $tickers in replies, when we have it. The narrative is the "Part of a story" card above. */
function Tiles({ data }: { data: PostSheetData }) {
  const tiles = [
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

/** "Quoted by @elonmusk · 2h", with that account's face; the line opens the share when we hold its link. */
function SharedLine({ share, now }: { share: SharedBy; now: number }) {
  const { src, tryKey, onError } = usePosterPic(share.authorPictureFile, share.authorPictureUrl);
  const age = formatAge(share.at, now);
  const face = src !== null
    ? <img key={tryKey} className={styles['sharedImg']} src={src} alt="" onError={onError} />
    : <span className={styles['sharedLetter']} aria-hidden="true">{(share.authorLabel.replace(/^@/, '').trim()[0] ?? '?').toUpperCase()}</span>;
  const words = <><span className={styles['sharedWho']}>{sharedByLabel(share)}</span>{age.kind === 'value' ? <span className={styles['sharedAge']}>{age.text}</span> : null}</>;
  return share.permalink !== null
    ? <a className={styles['shared']} href={share.permalink} target="_blank" rel="noopener noreferrer">{face}{words}</a>
    : <div className={styles['shared']}>{face}{words}</div>;
}

/** The poster's picture (our copy, else the source's link), or the first letter of their name when there is none or none will load. */
function Avatar({ file, url, letter }: { file: string | null; url: string | null; letter: string }) {
  const { src, tryKey, onError } = usePosterPic(file, url);
  if (src !== null) return <img key={tryKey} className={styles['avatarImg']} src={src} alt="" onError={onError} />;
  return <span className={styles['avatarLetter']} aria-hidden="true">{(letter.trim()[0] ?? '?').toUpperCase()}</span>;
}
