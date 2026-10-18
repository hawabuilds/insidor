/**
 * THE PHONE APP'S SHELL. Routing, the tab bar, and the Coming-soon toast — no fetching and no
 * domain logic of its own.
 *
 * Routing is the hash (`shared/route.ts`), with no router dependency, for the desktop shell's
 * reason: a handful of screens is twenty lines, not a package.
 *
 * The tab bar is always there. A story and a coin page belong to whichever list they were
 * reached from, and light that tab, so the bar always says where "back" leads.
 *
 * ★ THE FIVE TABS STAY OPEN (the owner, 2026-10-18: "switching tabs must not reload them from
 * scratch"). A bottom tab's screen is drawn the first time it is opened and then only hidden when
 * left, never unmounted, so coming back shows it at once, as it was, at the scroll position it was
 * left at; it reads again in the background (shared/hooks.ts useLoad). A hidden tab is told it is
 * not on screen (shared/screen-active.ts) and polls nothing. Every other screen (a story, a coin
 * page, a profile) is drawn fresh as before and starts at its top.
 *
 * ★ SIGN IN ONCE, AT THE DOOR. Every address is behind one gate (shared/sign-in.ts): signed in,
 * the app; signed out, the front door, with the address kept so signing in lands on it; a
 * returning person, a moment's hold while their session comes back. No screen inside asks anyone
 * to sign in.
 */

import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CreateFrom } from './features/create/CreateCoin.tsx';
import { Feed } from './features/feed/Feed.tsx';
import { bellCount } from './features/alerts/split.ts';
import { RankUp } from './features/people/RankUp.tsx';
import { resavePush } from './features/alerts/push.ts';
import { PushAsk } from './features/alerts/PushAsk.tsx';
import { fetchAlertSettings, fetchAlerts, setTokenSource, syncMe, syncWatch } from './shared/api/people.ts';
import { watchedPosts } from './shared/watched-posts.ts';
import { useWatchlist } from './shared/hooks.ts';
import { InstallPrompt } from './features/install/InstallPrompt.tsx';
import { Narratives } from './features/narratives/Narratives.tsx';
import { NOT_PROVEN } from './features/token/coin-opening.ts';
import { ComingSoonScreen } from './features/soon/ComingSoonScreen.tsx';
import { Holding, Landing } from './features/landing/Landing.tsx';
import { forgetEntered, hasEntered, markEntered } from './features/landing/entered.ts';
import { SIGN_IN_CONFIGURED, gateFor } from './shared/sign-in.ts';
import { useWallet } from './shared/wallet.tsx';
import { tabOf, type Route } from './shared/route.ts';
import { useRoute } from './shared/useRoute.ts';
import { noticeFor } from './shared/story-source.ts';
import { ComingSoonProvider } from './shared/ui/ComingSoon.tsx';
import { ScreenActive } from './shared/screen-active.ts';
import { preloadWhenQuiet } from './shared/preload.ts';
import { TabBar } from './shared/ui/TabBar.tsx';

/*
 * ★ For You and Narratives come with the app; every other screen is its own chunk, fetched ahead
 * once the app is quiet (shared/preload.ts) so opening one does not wait on it. While a chunk is
 * still on its way the screen's place is empty for that moment, never a spinner.
 */
const SCREENS = {
  /* In the order they are fetched ahead: the tabs first, then where a tap most often leads. */
  Search: () => import('./features/search/Search.tsx'),
  AlertsScreen: () => import('./features/alerts/AlertsScreen.tsx'),
  PortfolioScreen: () => import('./features/portfolio/PortfolioScreen.tsx'),
  NarrativePage: () => import('./features/narrative/NarrativePage.tsx'),
  TokenPage: () => import('./features/token/TokenPage.tsx'),
  SearchedToken: () => import('./features/token/SearchedToken.tsx'),
  CreateCoin: () => import('./features/create/CreateCoin.tsx'),
  Learn: () => import('./features/learn/Learn.tsx'),
  NotificationsScreen: () => import('./features/alerts/NotificationsScreen.tsx'),
  FollowList: () => import('./features/people/FollowList.tsx'),
  Leaderboard: () => import('./features/people/Leaderboard.tsx'),
  ProfileScreen: () => import('./features/people/ProfileScreen.tsx'),
  ImportScreen: () => import('./features/portfolio/ImportScreen.tsx'),
  WalletsScreen: () => import('./features/portfolio/WalletsScreen.tsx'),
};
const CreateCoin = lazy(() => SCREENS.CreateCoin().then((m) => ({ default: m.CreateCoin })));
const Learn = lazy(() => SCREENS.Learn().then((m) => ({ default: m.Learn })));
const AlertsScreen = lazy(() => SCREENS.AlertsScreen().then((m) => ({ default: m.AlertsScreen })));
const NotificationsScreen = lazy(() => SCREENS.NotificationsScreen().then((m) => ({ default: m.NotificationsScreen })));
const FollowList = lazy(() => SCREENS.FollowList().then((m) => ({ default: m.FollowList })));
const Leaderboard = lazy(() => SCREENS.Leaderboard().then((m) => ({ default: m.Leaderboard })));
const ProfileScreen = lazy(() => SCREENS.ProfileScreen().then((m) => ({ default: m.ProfileScreen })));
const ImportScreen = lazy(() => SCREENS.ImportScreen().then((m) => ({ default: m.ImportScreen })));
const WalletsScreen = lazy(() => SCREENS.WalletsScreen().then((m) => ({ default: m.WalletsScreen })));
const NarrativePage = lazy(() => SCREENS.NarrativePage().then((m) => ({ default: m.NarrativePage })));
const Search = lazy(() => SCREENS.Search().then((m) => ({ default: m.Search })));
const SearchedToken = lazy(() => SCREENS.SearchedToken().then((m) => ({ default: m.SearchedToken })));
const TokenPage = lazy(() => SCREENS.TokenPage().then((m) => ({ default: m.TokenPage })));
const PortfolioScreen = lazy(() => SCREENS.PortfolioScreen().then((m) => ({ default: m.PortfolioScreen })));

/** The bottom tabs' own screens: kept open once visited (see the header). */
const KEPT_TABS = ['feed', 'narratives', 'search', 'alerts', 'portfolio'] as const;
type KeptTab = (typeof KEPT_TABS)[number];

/** The kept tab this address shows, or null for any other screen. `#/post/<id>` is For You with a sheet over it. */
function keptTabOf(route: Route): KeptTab | null {
  if (route.screen === 'post') return 'feed';
  return (KEPT_TABS as readonly string[]).includes(route.screen) ? (route.screen as KeptTab) : null;
}

type ScreenProps = { route: Route; create: (from: CreateFrom) => void; unread: number; onAlertsSeen: () => void; readUnread: () => void };

/**
 * The kept tabs, each drawn from its first visit and hidden (display: none) when another screen is
 * showing; `display: contents` on the one showing, so the wrapper changes no layout.
 */
function KeptTabs({ shown, ...props }: ScreenProps & { shown: KeptTab | null }) {
  const [opened, setOpened] = useState<readonly KeptTab[]>(() => (shown === null ? [] : [shown]));
  if (shown !== null && !opened.includes(shown)) setOpened([...opened, shown]);
  return (
    <>
      {KEPT_TABS.filter((t) => opened.includes(t)).map((t) => (
        <div key={t} style={{ display: t === shown ? 'contents' : 'none' }}>
          <ScreenActive.Provider value={t === shown}>
            <Suspense fallback={null}>
              <Screen {...props} route={t === shown ? props.route : { screen: t }} />
            </Suspense>
          </ScreenActive.Provider>
        </div>
      ))}
    </>
  );
}

/**
 * Where each kept tab was scrolled to, so coming back lands there; any other screen starts at its
 * top. Read on every scroll while the tab is showing and put back before the first paint of a return.
 */
function useScrollPerTab(shown: KeptTab | null, route: Route): void {
  const at = useRef(new Map<KeptTab, number>());
  const current = useRef<KeptTab | null>(shown);
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const onScroll = () => {
      if (current.current !== null) at.current.set(current.current, window.scrollY);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    current.current = shown;
    window.scrollTo(0, shown === null ? 0 : (at.current.get(shown) ?? 0));
  }, [shown, route]);
}

function Screen({ route, create, unread, onAlertsSeen, readUnread }: ScreenProps): ReactNode {
  switch (route.screen) {
    case 'feed':
    case 'post':
      /* The same Feed for both: `#/post/<id>` is For You with that post's sheet open (Feed.tsx takes it). */
      return (
        <Feed
          onCreatePost={(p) => create({ title: p.excerpt, reach: p.reach, thumbUrl: p.thumbUrl, labelled: false, storyId: p.storyId, link: p.permalink, postId: p.id })}
          onCreateStory={(s) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, labelled: noticeFor(s) !== null, storyId: s.id })}
        />
      );
    case 'narratives':
      return <Narratives onCreate={(s) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, labelled: noticeFor(s) !== null, storyId: s.id })} />;
    case 'coin':
      return <TokenPage key={`${route.storyId}:${route.coinId}`} storyId={route.storyId} coinId={route.coinId} />;
    case 'story':
      return (
        <NarrativePage
          key={route.storyId}
          storyId={route.storyId}
          onCreate={(s) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, labelled: noticeFor(s) !== null, storyId: s.id })}
        />
      );
    case 'portfolio':
      return <PortfolioScreen />;
    case 'search':
      return <Search />;
    case 'token':
      return <SearchedToken key={route.coinId} coinId={route.coinId} note={route.unproven === true ? NOT_PROVEN : null} />;
    case 'learn':
      return <Learn />;
    case 'alerts':
      return <AlertsScreen unread={unread} onRefreshed={readUnread} />;
    case 'notifications':
    case 'alert-settings':
      return <NotificationsScreen settings={route.screen === 'alert-settings'} onSeen={onAlertsSeen} />;
    case 'profile':
      return <ProfileScreen key={route.key} profileKey={route.key} />;
    case 'follows':
      return <FollowList key={`${route.key}:${route.which}`} profileKey={route.key} which={route.which} />;
    case 'leaderboard':
      return <Leaderboard />;
    case 'wallets':
      return <WalletsScreen />;
    case 'import':
      return <ImportScreen />;
    default:
      return <ComingSoonScreen which="narratives" />;
  }
}

export function App() {
  const route = useRoute();
  const { wallet, state } = useWallet();
  const [entered, setEntered] = useState(hasEntered);
  const signedIn = state.kind === 'connected';
  /* Once signed in, this browser is held rather than shown the door while its session comes back. */
  if (signedIn && !entered) {
    markEntered();
    setEntered(true);
  }
  /* Signed out (the profile menu): the door, and no hold next time. */
  if (SIGN_IN_CONFIGURED && entered && (state.kind === 'disconnected' || state.kind === 'refused' || state.kind === 'failed')) {
    forgetEntered();
    setEntered(false);
  }
  /* The create modal sits over whichever screen opened it, so it lives here, above them. */
  const [creating, setCreating] = useState<CreateFrom | null>(null);
  const watched = useWatchlist();
  const [unread, setUnread] = useState(0);
  const inside = signedIn || (!SIGN_IN_CONFIGURED && entered);

  /* Who is asking, for the social and alert services: the sign-in's signed token, read when sent. */
  useEffect(() => setTokenSource(() => wallet?.sessionToken() ?? null), [wallet]);
  /* Signed in: the profile is brought up to date from the sign-in, once per session. */
  useEffect(() => {
    if (signedIn) void syncMe().catch(() => undefined);
  }, [signedIn]);
  /* This phone's notifications, made sure of on every launch: a phone that allowed them is saved
     again, so a save that failed once heals itself (features/alerts/push.ts). No prompt is shown. */
  useEffect(() => {
    if (signedIn) void fetchAlertSettings().then((s) => resavePush(s.push.on && s.push.configured ? s.push.publicKey : null), () => undefined);
  }, [signedIn]);
  /* The posts watched here, read from the alert service once signed in (shared/watched-posts.ts). */
  useEffect(() => {
    if (signedIn) watchedPosts.load();
  }, [signedIn]);
  /* The narratives starred here are mirrored for alerts sent while the app is closed. */
  const watchedKey = watched.join(',');
  useEffect(() => {
    if (signedIn) void syncWatch(watchedKey === '' ? [] : watchedKey.split(',')).catch(() => undefined);
  }, [signedIn, watchedKey]);
  /* The Feed bell's count (unread notifications, not the Feed's own rows), read every minute while the app is open. */
  const readUnread = useCallback(() => {
    void fetchAlerts().then((a) => setUnread(bellCount(a.alerts)), () => undefined);
  }, []);
  useEffect(() => {
    if (!inside) return;
    readUnread();
    const t = setInterval(readUnread, 60_000);
    return () => clearInterval(t);
  }, [inside, readUnread]);
  const keptTab = keptTabOf(route);
  /* The other screens' code and the chart library, fetched once the app is quiet. */
  useEffect(() => preloadWhenQuiet(Object.values(SCREENS)), []);
  useScrollPerTab(keptTab, route);
  const onAlertsSeen = useCallback(() => setUnread(0), []);
  /* After every hook, so the hooks run the same way whichever screen is shown. */
  const gate = gateFor({ configured: SIGN_IN_CONFIGURED, state, entered });
  if (gate === 'holding') return <Holding />;
  if (gate === 'landing') {
    return (
      <Landing
        configured={SIGN_IN_CONFIGURED}
        onEnter={() => {
          markEntered();
          setEntered(true);
        }}
      />
    );
  }
  return (
    <ComingSoonProvider>
      <main>
        <KeptTabs shown={keptTab} route={route} create={setCreating} unread={unread} onAlertsSeen={onAlertsSeen} readUnread={readUnread} />
        {keptTab === null ? (
          <Suspense fallback={null}>
            <Screen route={route} create={setCreating} unread={unread} onAlertsSeen={onAlertsSeen} readUnread={readUnread} />
          </Suspense>
        ) : null}
      </main>
      {route.screen === 'feed' ? <InstallPrompt /> : null}
      <TabBar current={tabOf(route)} />
      <RankUp signedIn={inside} />
      {/* Trador's ask for notifications, after sign-in, when push-ask.ts says this phone can and has not answered. */}
      <PushAsk signedIn={signedIn} />
      {creating !== null ? (
        <Suspense fallback={null}>
          <CreateCoin key={creating.title} from={creating} onClose={() => setCreating(null)} />
        </Suspense>
      ) : null}
    </ComingSoonProvider>
  );
}
