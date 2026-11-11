/**
 * THE NARRATIVE SCREEN — a narrative as a feed of its posts (the owner, 2026-11-11: the old page with
 * its chart, range buttons and small rows was "too much", and "I don't want that old pop up anywhere").
 * Every way in still lands here, at the same address (`#/story/<id>`): the Narratives tab's "See all N
 * posts", a narrative tag on For You, the Watchlist, Search, shared links and alerts, and "See N
 * coins" (`#/story/<id>/coins`, which opens Choose coin over it).
 *
 *   Head     stays at the top as the posts scroll under it: back, Watch, Share (and Edit for the
 *            owner's wallet only, NarrativeEdit.tsx); the whole title, wrapped, never cut; posts,
 *            views and the last hour's gain; and the narrative's ONE coin row (story-coin.ts's three
 *            states): the coin and Buy, or No coin yet and Create, with "See N coins" beside them
 *   Posts    every listed post as the For You card (shared/ui/PostRow.tsx, its head line, words,
 *            picture or playing video, full screen on a tap) without the card's own coin row, the
 *            narrative's coin being in the head; most viewed first, or newest first on a tap; the
 *            post that started it labelled "First post"; twenty at a time as the list's end comes in
 *   Up next  the next narrative on the Narratives tab's Most viewed list, under the last post
 *
 * ★ NO CHART AND NO MOMENTS. The numbers left are the page's own facts: the total is each post's
 * newest count (core narrativeReach), the gain the last hour's, and a narrative with no reading says
 * "— views", never 0.
 *
 * What breaks if changed carelessly: the screen reads two replies, the story and its sheet, and the
 * cards of each further screenful of a long story by id (`fetchStoryPosts`). The story alone draws
 * the screen and lists every post; a post no feed holds is drawn from its listing (picture, words,
 * head line, views) rather than left out, and a sheet failing costs only the coin's market details.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Evidence, RisingPost, SheetCoin, Story, StorySheet } from '../../shared/api/index.ts';
import type { PostTranslation } from '../../shared/api/wire/rising.ts';
import { fetchStoryPosts, fetchStorySheet } from '../../shared/api/index.ts';
import { fresh } from '../../shared/kept-reads.ts';
import { firstPageKey, readFirstPage } from '../narratives/first-page.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact, formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { goBack } from '../../shared/nav.ts';
import { platformOf } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { loadStory, noticeFor } from '../../shared/story-source.ts';
import { useCoinCap } from '../../shared/useCoinCap.ts';
import { watchlist } from '../../shared/watchlist.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { HeadLine } from '../../shared/ui/HeadLine.tsx';
import { BackIcon, ShareIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { CardMedia, PostRow } from '../../shared/ui/PostRow.tsx';
import { Sheet } from '../../shared/ui/Sheet.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { TranslatedLine, useShownWords } from '../../shared/ui/Translated.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { WatchStar } from '../../shared/ui/WatchStar.tsx';
import { useIsOwner } from '../owner/hooks.ts';
import { useSeenOnScreen } from '../owner/useSeen.ts';
import { BuyOpen, ChooseCoin, SheetToast, plus, pctText, type SheetNote } from '../post-sheet/index.ts';
import { sheetCoinRoute } from '../token/coin-opening.ts';
import { NarrativeEdit } from './NarrativeEdit.tsx';
import { PAGE, firstPosted, mostViewedFirst, newestFirst } from './posts-order.ts';
import { storyCoinState, type CoinFace, type StoryCoinState } from './story-coin.ts';
import { WindowList } from '../../shared/ui/WindowList.tsx';
import styles from './narrative.module.css';
import { Num } from '../../shared/ui/Num.tsx';
import { COIN_LEAD_MS, coinsMadeAfter } from '../../shared/coins-made.ts';
import { sharePage } from '../../shared/share-link.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';

/* The posts list draws only the cards near the screen (shared/ui/WindowList.tsx): a narrative can
   carry hundreds of posts, each with a picture or a video. A card's height before it is measured
   (For You's card with media), and how far beyond the screen cards stay drawn. */
const CARD_GUESS_PX = 430;
const CARDS_BEYOND_PX = 1600;
const evidenceKey = (e: Evidence): string => e.evidenceId;

export function NarrativePage({ storyId, openCoins = false, onCreate }: {
  storyId: string;
  /** Open on its Choose coin (`#/story/<id>/coins`): the Narratives card's "See N coins". */
  openCoins?: boolean;
  /** `from`: the post that started it, so the create popup fills its link and name ideas as For You's does. */
  onCreate: (story: Story, from?: { readonly link: string; readonly postId: string }) => void;
}) {
  const [story] = useLoad(storyId, (signal) => loadStory(storyId, signal), 'phone');
  const [sheet] = useLoad(`story-sheet:${storyId}`, (signal) => fetchStorySheet(storyId, signal), 'phone');
  const [editing, setEditing] = useState(false);
  const owner = useIsOwner();
  const ready = story.state === 'ready' ? story.value : null;
  const read = sheet.state === 'ready' ? sheet.value : null;
  return (
    <section className={styles['feedPage']}>
      {/* Before the story is read the head is only its top bar, so Back works from the first frame. */}
      {ready === null ? <TopBar storyId={storyId} onEdit={null} /> : null}
      {story.state === 'loading' ? <p className={styles['empty']}>Loading.</p> : null}
      {story.state === 'failed' ? <p className={styles['empty']}>This narrative couldn't be read. It may not be on the read service.</p> : null}
      {ready !== null ? <Body story={ready} sheet={read} openCoins={openCoins} onCreate={onCreate} onEdit={owner ? () => setEditing(true) : null} /> : null}
      {editing && ready !== null ? <NarrativeEdit story={ready} sheet={read} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

function TopBar({ storyId, onEdit }: { storyId: string; onEdit: (() => void) | null }) {
  const starred = useWatchlist().includes(storyId);
  const toast = useToast();
  return (
    <div className={styles['top']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => goBack({ screen: 'narratives' })}>
        <BackIcon size={24} />
      </button>
      <div className={styles['topRight']}>
        <button
          type="button"
          className={`${styles['star']} ${starred ? styles['starred'] : ''}`}
          aria-label={starred ? 'Stop watching' : 'Watch'}
          aria-pressed={starred}
          onClick={() => watchlist.toggle(storyId)}
        >
          <StarIcon size={22} filled={starred} />
        </button>
        {/* Share this narrative's page in the app (shared/share-link.ts). */}
        <button type="button" className={styles['star']} aria-label="Share this narrative" onClick={() => {
          void sharePage({ screen: 'story', storyId }, 'A narrative on Insidor').then((o) => {
            if (o === 'copied') toast('Link copied');
            else if (o === 'failed') toast("Couldn't share the link");
          });
        }}>
          <ShareIcon size={22} />
        </button>
        {onEdit !== null ? <button type="button" className={styles['edit']} onClick={onEdit}>Edit</button> : null}
      </div>
    </div>
  );
}

function Body({ story, sheet, openCoins, onCreate, onEdit }: { story: Story; sheet: StorySheet | null; openCoins: boolean; onCreate: (s: Story, from?: { readonly link: string; readonly postId: string }) => void; onEdit: (() => void) | null }) {
  const now = useNow();
  const [buying, setBuying] = useState<CoinFace | null>(null);
  /* Open from the card's "See N coins" (`#/story/<id>/coins`): the pop-up shows once the sheet is read. */
  const [choosing, setChoosing] = useState(openCoins);
  const [note, setNote] = useState<SheetNote | null>(null);
  const [order, setOrder] = useState<'viewed' | 'newest'>('viewed');

  const posts = story.postCount ?? story.evidence.length;
  const coin = storyCoinState(story, sheet);
  const firstPost = useMemo(() => {
    const t = story.evidence.flatMap((e) => (e.postedAt.known ? [e.postedAt.at] : []));
    return t.length === 0 ? null : Math.min(...t);
  }, [story.evidence]);
  const total = story.viewsTotal;
  const hourGain = story.viewsGained1h !== null && story.viewsGained1h.known && story.viewsGained1h.amount > 0 ? story.viewsGained1h.amount : null;

  /* ★ NO CLEAR RUNNER (the owner, 2026-10-24): when no coin is the narrative's, the row says so, offers
     Create, and beside it "See N coins" opens the coins its posts made, oldest first. Only coins made
     after the narrative's first post count (a few minutes' lead for one launched as it went up). */
  const madeHere = useMemo(() => (sheet === null ? [] : coinsMadeAfter(sheet.coins, firstPost)), [sheet, firstPost]);
  const unclear = coin.kind !== 'checked' && madeHere.length > 0;
  const oldTop = coin.kind === 'top' && firstPost !== null && coin.coin.sheet !== null && coin.coin.sheet.launchedAt.known && coin.coin.sheet.launchedAt.at < firstPost - COIN_LEAD_MS;
  const barState: StoryCoinState | { readonly kind: 'unclear' } = unclear ? { kind: 'unclear' } : oldTop ? { kind: 'none' } : coin;
  const oldestFirst = useMemo(() => [...madeHere].sort((a, b) => (a.launchedAt.known ? a.launchedAt.at : Infinity) - (b.launchedAt.known ? b.launchedAt.at : Infinity)), [madeHere]);
  const openCoin = (c: CoinFace) => (window.location.hash = hrefFor(sheetCoinRoute(c.sheet ?? { coinId: `solana:${c.address}`, proven: coin.kind === 'checked' }, story.id)));
  const pinned = useMemo(() => firstPosted(story), [story]);
  /* Create from the narrative's starting post, as For You's does from its post (the owner, 2026-10-24). */
  const create = () => onCreate(story, pinned === null ? undefined : { link: pinned.post.permalink, postId: pinned.post.evidenceId });

  const ordered = useMemo(() => (order === 'viewed' ? mostViewedFirst(story) : newestFirst(story, null)), [story, order]);
  const [shownCount, setShownCount] = useState(PAGE);
  const visible = ordered.slice(0, shownCount);
  const { cards, faces } = useCards(story.id, sheet, visible);
  const [atEnd, setAtEnd] = useState(false);
  const end = useEndInView(() => {
    if (shownCount < ordered.length) setShownCount((n) => n + PAGE);
    else setAtEnd(true);
  });
  /* The owner's screen (features/owner/useSeen.ts): this screen's posts in view for two seconds, the owner's sign-in only. */
  const owner = useIsOwner();
  const seen = useSeenOnScreen('narrative', owner);
  const item = (e: Evidence) => (
    <FeedItem key={e.evidenceId} e={e} story={story} card={cards.get(e.evidenceId)} face={faces.get(e.evidenceId)} now={now} first={pinned?.post.evidenceId === e.evidenceId} onCreate={create} rowRef={owner ? seen(e.evidenceId) : undefined} />
  );

  return (
    <>
      <header className={styles['feedHead']}>
        <TopBar storyId={story.id} onEdit={onEdit} />
        <div className={styles['feedTitle']}>
          <h1>{story.title}</h1>
          <span className={styles['feedFacts']}>
            <span><b>{posts.toLocaleString('en')}</b> {posts === 1 ? 'post' : 'posts'}</span>
            <span>{total !== null && total.known ? <><b>{compact(total.amount)}</b> views</> : '— views'}</span>
            {hourGain !== null ? <span className={styles['up']}>{plus(hourGain)} last hour</span> : null}
          </span>
        </div>
        <CoinBar inHead state={barState} coins={madeHere.length} onBuy={setBuying} onOpen={openCoin} onAll={() => setChoosing(true)} onCreate={create} />
      </header>

      <Notice notice={noticeFor(story)} />

      <div className={styles['sortLine']}>
        <b>Posts</b>
        <button type="button" className={styles['sortToggle']} onClick={() => {
          setOrder(order === 'viewed' ? 'newest' : 'viewed');
          setShownCount(PAGE);
        }}>{order === 'viewed' ? 'Most viewed' : 'Newest'}</button>
      </div>
      <div className={styles['feed']}>
        <WindowList items={visible} keyOf={evidenceKey} render={item} guess={CARD_GUESS_PX} overscan={CARDS_BEYOND_PX} nearEnd={0} />
        <div ref={end} className={styles['more']}>{visible.length < ordered.length ? 'Loading more posts' : ''}</div>
        {atEnd ? <UpNext storyId={story.id} /> : null}
      </div>

      {choosing && sheet !== null ? (
        <Sheet label="Choose coin" onClose={() => setChoosing(false)}>
          <ChooseCoin data={{ coins: oldestFirst, coinName: story.title, sourcesMissing: sheet.sourcesMissing }} order="Oldest first" onBack={() => setChoosing(false)} onOpenCoin={(c: SheetCoin) => openCoin({ address: c.address, ticker: c.ticker, name: c.name, imageUrl: c.imageUrl, marketCapUsd: c.marketCapUsd, changePct: c.changePct24h, sheet: c })} onCreate={create} onNote={setNote} />
        </Sheet>
      ) : null}
      {buying !== null ? <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} /> : null}
      <SheetToast note={note} onDone={() => setNote(null)} />
    </>
  );
}

/**
 * One post of the narrative as the For You card, without its coin row (the narrative's coin is in the
 * head). A post no feed holds has no card: it is drawn from its listing (its head line, words,
 * picture and views), never left out.
 */
function FeedItem({ e, story, card, face, now, first, onCreate, rowRef }: { e: Evidence; story: Story; card: RisingPost | undefined; face: Face | undefined; now: number; first: boolean; onCreate: () => void; rowRef?: ((el: Element | null) => void) | undefined }) {
  const label = first ? 'First post' : null;
  if (card !== undefined) {
    /* The sheet sends each poster's face beside the card (`face`); a card that carries none takes it. */
    const withFace: RisingPost = { ...card, authorPictureUrl: card.authorPictureUrl ?? face?.url ?? null, authorPictureFile: card.authorPictureFile ?? face?.file ?? null };
    return (
      <PostRow
        post={withFace}
        now={now}
        coinRow={false}
        footLabel={label}
        cardRef={rowRef}
        watch={<WatchStar postId={card.id} size="bare" />}
        handlers={{ open: () => undefined, create: onCreate, seeCoins: () => undefined }}
      />
    );
  }
  const pv = story.postViews?.get(e.evidenceId) ?? null;
  const translation = face?.translation;
  return <ListedPost e={e} views={pv?.views ?? null} face={face} translation={translation} now={now} label={label} rowRef={rowRef} />;
}

/** A listed post no feed holds, drawn from its listing in the card's shape. */
function ListedPost({ e, views, face, translation, now, label, rowRef }: { e: Evidence; views: number | null; face: Face | undefined; translation: PostTranslation | undefined; now: number; label: string | null; rowRef?: ((el: Element | null) => void) | undefined }) {
  const words = useShownWords(translation === undefined ? { excerpt: e.excerpt } : { excerpt: e.excerpt, translation });
  const platform = platformOf(e.sourceLabel);
  return (
    <article className={styles['listed']} ref={rowRef}>
      <HeadLine
        face={{ file: face?.file ?? null, url: face?.url ?? null }}
        label={e.authorLabel}
        platform={platform}
        sourceLabel={e.sourceLabel}
        sourceLink={e.permalink}
        age={formatAge(e.postedAt, now)}
        right={views !== null ? <span className={styles['listedViews']}><b>{compact(views)}</b><small>views</small></span> : null}
      />
      <p className={styles['listedText']}>{words.text}</p>
      <TranslatedLine line={words.line} compact />
      {e.thumbUrl !== null || e.thumbFile !== null ? <CardMedia post={{ id: e.evidenceId, sourceLabel: e.sourceLabel, thumbUrl: e.thumbUrl, thumbFile: e.thumbFile, thumbIsVideo: false }} /> : null}
      {label !== null ? <span className={styles['listedLabel']}>{label}</span> : null}
    </article>
  );
}

/**
 * The next narrative, under the last post (the owner's design, 2026-11-11): the one after this one on
 * the Narratives tab's Most viewed list, else that list's first; the tab's own kept first page when
 * it is fresh, and asked for only once the last post is in view. A tap opens it.
 */
function UpNext({ storyId }: { storyId: string }) {
  const [next, setNext] = useState<Story | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    /* The tab's own kept first page of Most viewed (first-page.ts) when it is fresh: usually no read at all. */
    fresh(firstPageKey('viewed', null, false), readFirstPage('viewed', null, false), true, ac.signal)
      .then((page) => {
        const list = page.stories.filter((s) => s.id !== storyId);
        const at = page.stories.findIndex((s) => s.id === storyId);
        setNext((at >= 0 ? page.stories[at + 1] : undefined) ?? list[0] ?? null);
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [storyId]);
  if (next === null) return null;
  const views = next.viewsTotal !== null && next.viewsTotal.known ? `${compact(next.viewsTotal.amount)} views` : null;
  const n = next.postCount ?? next.evidence.length;
  return (
    <a className={styles['upNext']} href={hrefFor({ screen: 'story', storyId: next.id })}>
      <span className={styles['upNextLabel']}>Up next</span>
      <span className={styles['upNextRow']}>
        <Thumb url={next.thumbUrl} file={next.thumbFile} size={44} radius={10} hideEmpty />
        <span className={styles['upNextText']}>
          <b>{next.title}</b>
          <span>{n === 1 ? '1 post' : `${n} posts`}{views !== null ? `  ${views}` : ''}</span>
        </span>
      </span>
    </a>
  );
}

/**
 * The feed cards of the rows on screen: the sheet's, and for the rows past it, asked for by id a
 * screenful at a time (`fetchStoryPosts`). A row whose card never comes opens its post where it lives.
 */
/** A listed post's account picture, from the sheet whether or not a feed holds the post. */
export interface Face {
  readonly url: string | null;
  readonly file: string | null;
  /** Its English when it was written in another language (the sheet's, card or not). */
  readonly translation?: PostTranslation;
}

function useCards(storyId: string, sheet: StorySheet | null, rows: readonly Evidence[]): { readonly cards: ReadonlyMap<string, RisingPost>; readonly faces: ReadonlyMap<string, Face> } {
  const [more, setMore] = useState<ReadonlyMap<string, RisingPost>>(new Map());
  const [moreFaces, setMoreFaces] = useState<ReadonlyMap<string, Face>>(new Map());
  const asked = useRef(new Set<string>());
  const fromSheet = useMemo(() => new Map((sheet?.members ?? []).flatMap((m) => (m.post === null ? [] : [[m.id, m.post] as const]))), [sheet]);
  const facesFromSheet = useMemo(() => new Map((sheet?.members ?? []).map((m) => [m.id, { url: m.authorPictureUrl, file: m.authorPictureFile, ...(m.translation === undefined ? {} : { translation: m.translation }) }] as const)), [sheet]);
  const carried = useMemo(() => new Set((sheet?.members ?? []).map((m) => m.id)), [sheet]);
  const want = sheet === null ? [] : rows.map((e) => e.evidenceId).filter((id) => !carried.has(id) && !asked.current.has(id));
  const key = want.join(',');
  useEffect(() => {
    if (want.length === 0) return;
    const ask = want.slice(0, 60);
    for (const id of ask) asked.current.add(id);
    /* Not aborted when the ids change: marking them asked changes them, and the answer is still wanted. */
    fetchStoryPosts(storyId, ask)
      .then((ms) => {
        setMore((m) => new Map([...m, ...ms.flatMap((x) => (x.post === null ? [] : [[x.id, x.post] as const]))]));
        setMoreFaces((f) => new Map([...f, ...ms.map((x) => [x.id, { url: x.authorPictureUrl, file: x.authorPictureFile, ...(x.translation === undefined ? {} : { translation: x.translation }) }] as const)]));
      })
      .catch(() => undefined);
    /* Keyed on the ids asked for, not the array: a new array of the same ids asks nothing new. */
  }, [storyId, key]);
  const cards = useMemo(() => new Map([...fromSheet, ...more]), [fromSheet, more]);
  const faces = useMemo(() => new Map([...facesFromSheet, ...moreFaces]), [facesFromSheet, moreFaces]);
  return { cards, faces };
}

/** A ref for the list's end: `onEnd` each time it comes into view (the next screenful). */
function useEndInView(onEnd: () => void): (el: HTMLDivElement | null) => void {
  const latest = useRef(onEnd);
  latest.current = onEnd;
  const seen = useRef<IntersectionObserver | null>(null);
  return (el) => {
    seen.current?.disconnect();
    seen.current = null;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) latest.current();
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    seen.current = io;
  };
}

/**
 * The coin bar, where the token page's Buy and Sell panel sits: logo, ticker and the day's move,
 * "MC" (or "Top coin, not checked"), "See N coins" when it made more than one, and Buy; "No coin yet"
 * with "See N coins" and Create; or the narrative's own line.
 */
function CoinBar({ state, coins, onBuy, onOpen, onAll, onCreate, inHead = false }: {
  /* In the narrative screen's head (it scrolls with nothing; the head stays put), not pinned above the tab bar. */
  inHead?: boolean;
  /* `unclear`: coins exist but none is the narrative's; they are listed on the page, and the bar offers Create. */
  state: StoryCoinState | { readonly kind: 'unclear' };
  coins: number;
  onBuy: (c: CoinFace) => void;
  onOpen: (c: CoinFace) => void;
  onAll: () => void;
  onCreate: () => void;
}) {
  const face = state.kind === 'checked' || state.kind === 'top' ? state.coin : null;
  const cap = useCoinCap(face?.address ?? '', face?.marketCapUsd ?? { known: false, pending: 'not_read_yet' }, face !== null);
  /* "See N coins" sits left of Buy (more than one coin) and left of Create (any), as on a Narratives
     card; with the button there, the panel's own "All N coins" line is not repeated. */
  const see = (
    <button type="button" className={styles['seeCoins']} onClick={(e) => {
      e.stopPropagation();
      onAll();
    }}>{coins === 1 ? 'See 1 coin' : `See ${coins} coins`}</button>
  );
  const all = coins === 1 ? (
    <button type="button" className={styles['allCoins']} onClick={(e) => {
      e.stopPropagation();
      onAll();
    }}>All 1 coin</button>
  ) : null;
  return (
    <div className={inHead ? styles['headCoin'] : styles['bar']}>
      <div className={styles['barPanel']}>
        {face !== null ? (
          <>
            <div className={styles['barCoin']} role="button" tabIndex={0} onClick={() => onOpen(face)} onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(face);
            }}>
              <CoinLogo small address={face.address} ticker={face.ticker ?? face.name} imageUrl={face.imageUrl} size={inHead ? 34 : 48} />
              <span className={styles['barText']}>
                <span className={styles['barTop']}>
                  <b>{tickerText(face.ticker ?? face.name ?? face.address.slice(0, 4))}</b>
                  {face.changePct.known ? <Num className={face.changePct.amount >= 0 ? styles['up'] : styles['down']}>{pctText(face.changePct.amount)}</Num> : null}
                </span>
                <span className={styles['barSub']}>
                  {state.kind === 'top' ? <span>Top coin, not checked</span> : cap.known ? <Value r={formatUsd(cap)} num /> : null}
                  {all}
                </span>
              </span>
            </div>
            {coins > 1 ? see : null}
            <button type="button" className={styles['buy']} onClick={() => onBuy(face)}>Buy</button>
          </>
        ) : state.kind === 'unclear' ? (
          <>
            <span className={styles['barNone']}>
              <b>No clear runner yet</b>
            </span>
            {coins > 0 ? see : null}
            <button type="button" className={styles['buy']} onClick={onCreate}>Create</button>
          </>
        ) : state.kind === 'none' ? (
          <>
            <span className={styles['barNone']}>
              <b>No coin yet</b>
            </span>
            {coins > 0 ? see : null}
            <button type="button" className={styles['buy']} onClick={onCreate}>Create</button>
          </>
        ) : (
          <>
            <span className={styles['barNone']}>
              <span>{state.kind === 'line' ? state.line : ''}</span>
            </span>
            {coins > 0 ? see : null}
          </>
        )}
      </div>
    </div>
  );
}
