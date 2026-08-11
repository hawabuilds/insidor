/**
 * THE SHELL. Layout, routing and wiring — no domain logic and no fetching of its own.
 *
 * Routing is the hash, and there is no router dependency. Three surfaces, one parameter
 * between them; a router would be a dependency, a bundle and a set of conventions bought to
 * replace fifteen lines. If the surface count grows past about six, take the router.
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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BoardStoreProvider,
  createBoardStore,
  decodeBoardTick,
  decodeRowPatch,
  fetchBoard,
  openLiveChannel,
} from './shared/api/index.ts';
import { NotImplemented } from './shared/not-implemented.ts';
import { Feed } from './features/feed/index.ts';
import type { BuyAction } from './features/feed/index.ts';
import { Story } from './features/story/index.ts';
import { TradePanel } from './features/trade/index.ts';
import { MintAlerts, Watchlist, createWatchStore } from './features/watchlist/index.ts';
import styles from './App.module.css';

/** Which board the user is looking at. One for now; the wire already carries the id. */
const VIEW_ID = 'default';
const CLOCK_MS = 1_000;

type Route =
  | { readonly kind: 'feed' }
  | { readonly kind: 'story'; readonly storyId: string }
  | { readonly kind: 'watchlist' };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'watchlist') return { kind: 'watchlist' };
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

export function App() {
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

  useEffect(() => watchStore.subscribe(() => setAlerts(watchStore.alerts())), [watchStore]);

  /* The live channel. Unimplemented today; the wiring is written now so that when the
     transport lands, the refetch-on-subscribe rule is already in place rather than being
     something someone remembers to add. */
  useEffect(() => {
    try {
      const channel = openLiveChannel(VIEW_ID, {
        onTick: (raw) => boardStore.tick(decodeBoardTick(raw)),
        onPatch: (raw) => boardStore.patch(decodeRowPatch(raw)),
        onSubscribed: () => {
          boardStore.setConnected(true);
          refetch();
        },
        onDropped: () => boardStore.setConnected(false),
      });
      return () => channel.close();
    } catch (e: unknown) {
      /* An unwritten transport is not a crash on first paint — the board still reads. */
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

  return (
    <BoardStoreProvider value={boardStore}>
      <div className={styles['shell']}>
        <header className={styles['header']}>
          <span className={styles['brand']}>INSIDOR</span>
          <nav className={styles['nav']}>
            <button
              type="button"
              className={`${styles['navLink']} ${route.kind === 'feed' ? styles['navActive'] : ''}`}
              onClick={() => navigate('/')}
            >
              board
            </button>
            <button
              type="button"
              className={`${styles['navLink']} ${route.kind === 'watchlist' ? styles['navActive'] : ''}`}
              onClick={() => navigate('/watchlist')}
            >
              watching
            </button>
          </nav>
        </header>

        <main className={styles['main']}>
          {route.kind === 'feed' ? (
            <Feed viewId={VIEW_ID} store={boardStore} onOpenStory={openStory} onBuy={setBuying} />
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
            <Watchlist store={watchStore} now={now} onOpen={openStory} />
          ) : null}
        </main>

        {/* The panel takes a BuyAction. An unsure match is a different type and cannot be
            put into this state, so this drawer cannot open for a coin we have not named. */}
        {buying === null ? null : (
          <aside className={styles['drawer']} aria-label="buy">
            <TradePanel action={buying} onClose={() => setBuying(null)} />
          </aside>
        )}

        <MintAlerts
          alerts={alerts}
          now={now}
          onOpen={openStory}
          onDismiss={(id) => watchStore.dismiss(id)}
        />
      </div>
    </BoardStoreProvider>
  );
}
