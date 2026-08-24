/**
 * THE SHELL. Layout, routing and wiring — no domain logic and no fetching of its own.
 *
 * The chrome is Hawa's, ported from her index.html and styles/index.css: the 58px sticky nav
 * with the cyan brand dot, her five nav items, the ⌘K search trigger, the Connect button in
 * her cyan gradient, and the two-column layout with the live rail permanently on the right.
 *
 * Routing is the hash, and there is no router dependency. Six surfaces, one parameter between
 * them; a router would be a dependency, a bundle and a set of conventions bought to replace
 * twenty lines. If the surface count grows past about ten, take the router.
 *
 * ★ NAV MAPPING. Her nav has five items; three of them have a screen behind them today:
 *     Trending  → the board            (#/)          — this is the ranked story board
 *     New Pairs → the pairs screen     (#/new-pairs) — the mints that reached a market. The
 *                                                      nav keeps her label; the screen's own
 *                                                      heading does not say "new", because
 *                                                      nothing here knows when a pool opened
 *                                                      and a pair age is not derivable.
 *     Stories   → the board, for now   (#/stories)   — same board; the grouped view that
 *                                                      belongs here does not exist yet, and a
 *                                                      dead nav item is worse than a shared one
 *     Tokens    → nothing yet          (#/tokens)    — honest empty state
 *     Watchlist → watching             (#/watchlist)
 *   When the grouped view is built it takes over the 'stories' route and Trending keeps
 *   the board. Nothing else moves.
 *
 * ★ ONE DELIBERATE DEPARTURE FROM HER CHROME. She called this nav item "Narratives"
 *   (index.html:24) and so did the first port of it. "Narrative" is our internal name for the
 *   grouping stage — it is on the banned list in tools/check-app-vocabulary.mjs and in
 *   FORBIDDEN_KEYS, alongside 'cluster', for the same reason: it names the machine that found
 *   the thing rather than the thing. The user-facing word is "story", which is what the wire
 *   carries (STORY_FIELDS), what the projection publishes (story_view) and what every other
 *   surface here already says. Her styling is preserved exactly; only the word changed, and
 *   it changed because the vocabulary rule outranks the visual port.
 *
 * The one piece of real machinery here is the live wiring, and it exists because of a
 * specific bug: the previous build cancelled its fallback poll on reconnect and issued no
 * refetch, so every row that changed during a socket outage was silently missing until
 * something unrelated refetched. Broadcast has no replay. So: refetch authoritatively on
 * every subscribe transition AND on any gap in the tick sequence. Both are wired below and
 * neither is optional.
 *
 * The buy drawer is opened with a `BuyAction`, which is the only branch of the row-action
 * union carrying a confirmed coin. There is no state here that can hold an unsure match.
 *
 * ★ THE SECOND PIECE OF MACHINERY IS THE SOURCE INDICATOR, and it is here rather than on a
 * screen because it describes ALL of them. Which of our inputs are answering is not a fact
 * about the board, or the rail, or the pairs screen — it is the fact that decides what an
 * empty one of any of them means, so it belongs to the shell that contains them all. One
 * hook holds one frame and two elements render it: the corner of the nav says WHICH source
 * is dark, and the banner below the nav says what that means for everything underneath. Both
 * come from features/sources; this file makes no decision about either, and holds no state
 * for them beyond the one call.
 *
 * ★ THE THIRD PIECE OF MACHINERY IS THE WALLET, AND THE ONLY THING TO KNOW ABOUT IT IS THAT
 * CONNECTING ONE CHANGES NOTHING ABOUT WHAT CAN BE DONE. It changes what the app KNOWS, not
 * what it OFFERS. There is one control, it is in the corner where it always was, and no
 * state of it makes any other control appear anywhere — the buy panel still says trading is
 * not connected, because it still is not: there is no venue that will price a coin here, and
 * no service that could submit and confirm what a wallet signed. If a wallet connection ever
 * causes a new affordance to show up, that is a bug and not a feature.
 *
 * The shell holds ONE frame of wallet state, for the reason it holds one frame of source
 * health: the corner and the buy panel both read it, and two subscriptions would be two
 * frames that can disagree. The adapter itself is constructed in main.tsx and arrives here
 * as a prop — nothing in this file, or under features/, imports it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Wallet } from '@insidor/contracts/ports/wallet.ts';

import {
  BoardStoreProvider,
  createBoardStore,
  createLiveHandlers,
  fetchBoard,
  openLiveChannel,
  USING_FIXTURES,
} from './shared/api/index.ts';
import { NotImplemented } from './shared/not-implemented.ts';
import { CommandPalette } from './shared/ui/index.ts';
import { BoardProvenanceBanner, Feed } from './features/feed/index.ts';
import type { BuyAction } from './features/feed/index.ts';
import { Pairs } from './features/pairs/index.ts';
import { LiveRail } from './features/rail/index.ts';
import { SourceBanner, SourceStatus, useSourceHealth } from './features/sources/index.ts';
import { Story } from './features/story/index.ts';
import { TradePanel } from './features/trade/index.ts';
import { Connect, useWalletState } from './features/wallet/index.ts';
import { MintAlerts, Watchlist, createWatchStore } from './features/watchlist/index.ts';
import styles from './App.module.css';

/** Which board the user is looking at. One for now; the wire already carries the id. */
const VIEW_ID = 'default';
const CLOCK_MS = 1_000;

type Route =
  | { readonly kind: 'feed' }
  | { readonly kind: 'stories' }
  | { readonly kind: 'newPairs' }
  | { readonly kind: 'tokens' }
  | { readonly kind: 'story'; readonly storyId: string }
  | { readonly kind: 'watchlist' };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'watchlist') return { kind: 'watchlist' };
  if (path === 'stories') return { kind: 'stories' };
  if (path === 'new-pairs') return { kind: 'newPairs' };
  if (path === 'tokens') return { kind: 'tokens' };
  const story = /^story\/(.+)$/.exec(path);
  if (story?.[1]) return { kind: 'story', storyId: decodeURIComponent(story[1]) };
  return { kind: 'feed' };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(globalThis.location?.hash ?? ''));
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(globalThis.location.hash));
    globalThis.addEventListener('hashchange', onChange);
    return () => globalThis.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function navigate(to: string): void {
  globalThis.location.hash = to;
}

interface NavItem {
  readonly label: string;
  readonly to: string;
  /** Which route kinds light this item. The story route lights none of them. */
  readonly active: readonly Route['kind'][];
}

const NAV: readonly NavItem[] = [
  { label: 'Trending', to: '/', active: ['feed'] },
  { label: 'New Pairs', to: '/new-pairs', active: ['newPairs'] },
  { label: 'Stories', to: '/stories', active: ['stories'] },
  { label: 'Tokens', to: '/tokens', active: ['tokens'] },
  { label: 'Watchlist', to: '/watchlist', active: ['watchlist'] },
];

/** A view heading in her chrome (index.css:144-148). */
function ViewHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className={styles['vhead']}>
      <div className={styles['vtitle']}>{title}</div>
      <div className={styles['vsub']}>{sub}</div>
    </div>
  );
}

/**
 * A screen with nothing behind it, said plainly.
 *
 * Not a "coming soon", not a spinner, not a table of zeroes: the heading renders in her style
 * and one line states what has to exist before this screen can show anything. The user chose
 * this over a mock — a screenshot of invented rows is the thing that later gets mistaken for
 * a product.
 */
function NotBuilt({ headline, needs, note }: { headline: string; needs: string; note: string }) {
  return (
    <div className={styles['notBuilt']}>
      <b>{headline}</b>
      {needs}
      <span className={styles['notBuiltNote']}>{note}</span>
    </div>
  );
}

export interface AppProps {
  /**
   * The wallet, as an interface. The shell never learns which implementation this is, and
   * there is no branch anywhere below that asks: every state it can be in is declared in the
   * shared vocabulary and rendered by features/wallet. Swapping the adapter is a change to
   * main.tsx and to nothing that renders.
   */
  readonly wallet: Wallet;
}

export function App({ wallet }: AppProps) {
  /* One store per app lifetime. Created here rather than at module scope so a test can
     mount two Apps without them sharing a board.

     `onGap` is fixed when the store is created but the refetch it should call is not, so it
     goes through a ref. The alternative — recreating the store when the callback identity
     changes — would drop the board on every render that touched it. */
  const refetchRef = useRef<() => void>(() => {});
  const boardStore = useMemo(() => createBoardStore({ onGap: () => refetchRef.current() }), []);
  const watchStore = useMemo(() => createWatchStore(), []);
  const route = useRoute();
  const [buying, setBuying] = useState<BuyAction | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [alerts, setAlerts] = useState(() => watchStore.alerts());
  const [paletteOpen, setPaletteOpen] = useState(false);
  /* ★ ONE FRAME, TWO READERS — the corner of the nav and the buy panel. The same argument as
     the source indicator below: two subscriptions would be two frames, and the pair could
     show a connected account above a panel still listing a wallet among the things it
     lacks. */
  const walletState = useWalletState(wallet);
  /* ★ ONE FRAME, TWO PLACES. The corner of the nav and the sentence under it are two
     renderings of the same read, so they cannot disagree — two fetches would be two frames,
     and the pair could show a lit pip above a banner saying nothing is answering. Every
     decision behind both lives in features/sources/sources.ts; this line is the whole of
     the shell's involvement. */
  const sources = useSourceHealth();

  const refetch = useCallback(() => {
    fetchBoard(VIEW_ID)
      .then((tick) => boardStore.reset(tick))
      .catch(() => {
        /* The status line already says we are not live. A modal here would cover the board
           the user came for, and a stale board still beats no board. */
      });
  }, [boardStore]);

  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  /* The board is fetched here, not only by the screen that displays it.
     Every surface that shows a row reads the same store — the watchlist most of all — and
     when the fetch belonged to <Feed> alone, opening #/watchlist directly left the store
     empty and every saved row rendered "not on the board right now". That sentence was false:
     the story was on the board, we had simply never asked. A pending state has to describe
     the world, not our fetch order. */
  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => watchStore.subscribe(() => setAlerts(watchStore.alerts())), [watchStore]);

  /* ⌘K / Ctrl+K opens the palette. Bound here rather than in the palette because it has to
     work while the palette is closed; Escape is bound inside the palette, where it only
     exists while it is open. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  /* The live channel. The four handlers are built by `createLiveHandlers` rather than
     written inline, because the refetch-on-every-subscribe rule is the one the previous
     build broke and a rule needs a test rather than a comment — see live/wiring.ts and
     live/wiring.test.ts, which assert against this exact code path.

     `refetch` is stable (useCallback over a store that is useMemo'd once), so this effect
     runs once per mount and the channel is not torn down on re-render. */
  useEffect(() => {
    try {
      const channel = openLiveChannel(VIEW_ID, createLiveHandlers(boardStore, refetch));
      return () => channel.close();
    } catch (e: unknown) {
      /* No transport in this build — sample data, or an environment with no EventSource.
         Not a crash on first paint: the board still reads, and the status line says it is
         not streaming, which is true. */
      if (!(e instanceof NotImplemented)) throw e;
      boardStore.setConnected(false);
      return;
    }
  }, [boardStore, refetch]);

  /* Watched stories are observed off the board the user is already looking at, so there is
     no second source of truth that can disagree with what is on screen. */
  useEffect(() => {
    for (const id of watchStore.ids()) {
      const row = boardStore.getRow(id);
      if (row) watchStore.observe(id, row.coins, Date.now());
    }
  }, [boardStore, watchStore, now]);

  const openStory = useCallback((storyId: string) => navigate(`/story/${encodeURIComponent(storyId)}`), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  /* Trending and Stories share the board (see the NAV MAPPING note at the top). */
  const showsBoard = route.kind === 'feed' || route.kind === 'stories';
  const wide = route.kind === 'tokens' || route.kind === 'newPairs' || route.kind === 'watchlist' || route.kind === 'story';

  return (
    <BoardStoreProvider value={boardStore}>
      <nav className={styles['nav']}>
        <div className={styles['brand']}>
          <span className={styles['dot']} />
          INSIDOR
        </div>

        <div className={styles['navlinks']}>
          {NAV.map((item) => (
            <button
              key={item.to}
              type="button"
              className={`${styles['navlink']} ${
                item.active.includes(route.kind) ? styles['navActive'] : ''
              }`}
              onClick={() => navigate(item.to)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button type="button" className={styles['navsearch']} onClick={() => setPaletteOpen(true)}>
          <span className={styles['navsearchIc']} aria-hidden="true">
            ⌕
          </span>
          <span className={styles['navsearchTxt']}>Search stories, tickers, contracts…</span>
          <kbd>⌘K</kbd>
        </button>

        <div className={styles['navright']}>
          {/* ★ THE TOP CORNER, WHICH IS WHERE IT WAS ASKED FOR AND ALSO WHERE IT BELONGS.
              It sits to the LEFT of Connect, in the slot `.walletNote` already occupies at
              already-proven metrics. It is first in this group because it is a fact about
              everything below it, and last would put it against the edge of the window
              where a narrow viewport clips it first.

              It draws its own chrome from features/sources/sources.module.css rather than
              from this file: the shell owns the slot, the feature owns what goes in it. */}
          <SourceStatus view={sources} />
          {/* ★ STILL NOT A DISABLED BUTTON, AND NOW FOR A BETTER REASON. It used to be live
              because there was nothing behind it and a greyed control invites waiting for
              something that is not coming. There is something behind it now, and it stays
              live in six of its seven states for a second reason: "no wallet found" is the
              commonest state there is, extensions inject themselves into the page after we
              have looked, and pressing the button looks again. The one state that makes it
              inert is the wallet's own prompt being open — which is exactly what her
              `:disabled` treatment was reserved for. All of that is decided in
              features/wallet/wallet-view.ts; this line is the whole of the shell's
              involvement. */}
          <Connect wallet={wallet} state={walletState} />
        </div>
      </nav>

      {/* ★ WHEN NOTHING IS FEEDING THIS, THE SHELL SAYS SO IN WORDS, above every route.
          Six pixels of dark shape in the corner says WHICH source is out; it cannot carry
          "everything you are about to read is missing its inputs". An empty board and a
          board nobody is feeding are the same picture, and this is the sentence that
          separates them — which is the same job the launches rail's source banner and the
          coverage log both do, arriving on the surface that had no defence at all.

          It is ABOVE the fixture bar deliberately. Both are amber and both are true at once
          in a dev build, and of the two, "nothing is ingesting" is the one that changes what
          every row below means. */}
      <SourceBanner view={sources} />

      {/* Every number below is invented. This says so, permanently and without a dismiss
          control — a banner the user can close is a banner that is absent in the screenshot
          somebody later mistakes for a product. It compiles out of a production build with
          the fixtures it describes. */}
      {USING_FIXTURES ? (
        <div className={styles['fixtureBar']} role="status">
          <strong>sample data</strong> — no pipeline is connected. Every number on this screen
          is made up, and each row is here to show one rule: an unsure match with no button, a
          source that publishes no views, a broken graph where a reading was censored, an age
          we never learned.
        </div>
      ) : null}

      {/* ★ THE SAME CLAIM ABOUT THE DATABASE THAT THE BAR ABOVE MAKES ABOUT THE BUNDLE, and
          it is the one that was missing. The bar above only ever appears when there is no
          backend at all; with a backend attached and a freshly seeded database, six invented
          stories rendered under `Trending` with nothing over them. This says so, and says it
          out of the frame's own provenance rather than out of a flag here — so it goes away
          on its own the moment a real story is projected, and cannot be turned off early.

          Gated on `showsBoard` because it is a sentence about the BOARD's rows. The pairs
          and launches screens read different tables and are entitled to their own answer;
          borrowing this one would be this frame's provenance printed over somebody else's
          rows, which is the mistake `WireBoardTick.provenance` rides on the frame to avoid. */}
      {showsBoard ? <BoardProvenanceBanner /> : null}

      {/* main-left + permanent live feed right (never hides). Her layout, her comment. */}
      <div className={styles['shell']}>
        <main className={styles['main']}>
          <div className={`${styles['wrap']} ${wide ? styles['wrapWide'] : ''}`}>
            {/* The board owns its own head, because the head carries the provenance badge and
                the Stories/Tokens sub-tabs, which are part of the board rather than part of
                the shell. The two words that differ per route are passed in — this is the only
                thing here that knows which route is on screen. */}
            {showsBoard ? (
              <Feed
                viewId={VIEW_ID}
                store={boardStore}
                title={route.kind === 'stories' ? 'Stories' : 'Trending'}
                sub={
                  route.kind === 'stories'
                    ? 'The board, for now — the grouped view is not built yet.'
                    : 'Stories in the order the board publishes them.'
                }
                onOpenStory={openStory}
                onBuy={setBuying}
              />
            ) : null}

            {/* ★ THE NAV ITEM STILL SAYS "NEW PAIRS" AND THE SCREEN DOES NOT, WHICH IS
                DELIBERATE. The route stays because a link somebody has is a link that should
                keep working, and the label stays because that is the word in her nav — but
                the heading a user reads once they are here says what the screen actually
                holds. Nothing in this system knows when a pool opened, so nothing here is
                entitled to call a pair new; what it can say is that these are the mints a
                venue could price, and how few of them there are. `Pairs` owns its own head
                for that reason: the honest title is a property of the screen, not of the
                shell that routed to it. */}
            {route.kind === 'newPairs' ? <Pairs /> : null}

            {route.kind === 'tokens' ? (
              <>
                <ViewHead title="Tokens" sub="Every coin the board has matched to a story." />
                <NotBuilt
                  headline="There is no coin index yet."
                  needs="Tokens is a board of coins rather than stories, and nothing publishes that list. The coins you can see today arrive attached to a story, one at a time."
                  note="needs: a coins endpoint, and prices for the coins on it"
                />
              </>
            ) : null}

            {route.kind === 'story' ? (
              <>
                <button type="button" className={styles['back']} onClick={() => navigate('/')}>
                  ← board
                </button>
                <Story
                  storyId={route.storyId}
                  onBuy={setBuying}
                  isWatched={watchStore.has(route.storyId)}
                  onToggleWatch={(id) => watchStore.toggle(id)}
                />
              </>
            ) : null}

            {route.kind === 'watchlist' ? (
              <>
                <ViewHead title="Watchlist" sub="Stories you asked to be told about." />
                <Watchlist store={watchStore} now={now} onOpen={openStory} />
              </>
            ) : null}
          </div>
        </main>

        <LiveRail />
      </div>

      {/* The panel takes a BuyAction. An unsure match is a different type and cannot be
          put into this state, so this drawer cannot open for a coin we have not named. */}
      {buying === null ? null : (
        <aside className={styles['drawer']} aria-label="buy">
          <TradePanel
            action={buying}
            onClose={() => setBuying(null)}
            walletConnected={walletState.kind === 'connected'}
          />
        </aside>
      )}

      <MintAlerts
        alerts={alerts}
        now={now}
        onOpen={openStory}
        onDismiss={(id) => watchStore.dismiss(id)}
      />

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </BoardStoreProvider>
  );
}
