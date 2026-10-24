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
 * not on screen (shared/screen-active.ts) and polls nothing.
 *
 * ★ BACK FINDS THE PAGE AS IT WAS LEFT (the owner, 2026-10-21: "when i press back on any page on the
 * app i want to see previous page and it not be reset"). Every other screen (a story, a coin page, a
 * profile) is drawn per history entry and kept drawn, hidden, while its entry is behind the one on
 * screen (shared/kept-pages.ts): Back shows the very same page, its chart window, tab, loaded posts
 * and any sheet left open, and it reads again in place. The window's scroll is kept per entry
 * (shared/entry-scroll.ts). A NEW visit is a new entry: it is drawn fresh and starts at its top.
 *
 * ★ SIGN IN ONCE, AT THE DOOR. Every address is behind one gate (shared/sign-in.ts): signed in,
 * the app; signed out, the front door, with the address kept so signing in lands on it; a
 * returning person, a moment's hold while their session comes back. No screen inside asks anyone
 * to sign in. Signed in is not let in: a first sign-in is asked about access (features/invites
 * useAccess.ts) and, without it, sees the door's code box or their place on the waitlist. Let in is
 * not signed up: a member with a sign-up step left (username, photo, Home Screen, alerts, done) sees
 * those screens first (features/onboarding), and only then the app.
 */

import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { CreateFrom } from './features/create/CreateCoin.tsx';
import { Feed } from './features/feed/Feed.tsx';
import { fetchUnread } from './shared/api/following.ts';
import { RankUp } from './features/people/RankUp.tsx';
import { resavePush, standalone } from './features/alerts/push.ts';
import { PushAsk } from './features/alerts/PushAsk.tsx';
import { fetchAlertSettings, notifyCall, setTokenSource, syncMe, syncWatch } from './shared/api/people.ts';
import { watchedPosts } from './shared/watched-posts.ts';
import { useWatchlist } from './shared/hooks.ts';
import { InstallPrompt } from './features/install/InstallPrompt.tsx';
import { Narratives } from './features/narratives/Narratives.tsx';
import { NOT_PROVEN } from './features/token/coin-opening.ts';
import { ComingSoonScreen } from './features/soon/ComingSoonScreen.tsx';
import { Holding, Landing } from './features/landing/Landing.tsx';
import { forgetEntered, hasEntered, markEntered } from './features/landing/entered.ts';
import { useAccess } from './features/invites/useAccess.ts';
import { useSignUp } from './features/onboarding/useSignUp.ts';
import { Waitlist } from './features/invites/Waitlist.tsx';
import { SIGN_IN_CONFIGURED, gateFor } from './shared/sign-in.ts';
import { useWallet } from './shared/wallet.tsx';
import { hrefFor, tabOf, type Route } from './shared/route.ts';
import { usePlace, type Place } from './shared/useRoute.ts';
import { arrive, type KeptPage } from './shared/kept-pages.ts';
import { noteInner, noteWindow, restoreInner, showEntry } from './shared/entry-scroll.ts';
import { noticeFor } from './shared/story-source.ts';
import { ComingSoonProvider } from './shared/ui/ComingSoon.tsx';
import { ScreenActive, ShownEntry } from './shared/screen-active.ts';
import { preloadWhenQuiet } from './shared/preload.ts';
import { later } from './shared/ui/later.ts';
import { TabBar } from './shared/ui/TabBar.tsx';
import { deviceOf, noteTap, startTapSending } from './shared/tap-log.ts';

/*
 * ★ For You and Narratives come with the app; every other screen is its own chunk, fetched ahead
 * once the app is quiet (shared/preload.ts) so opening one does not wait on it, and drawn at once
 * when it is here (shared/ui/later.ts). While a chunk is still on its way the screen's place is
 * empty for that moment, never a spinner.
 */
const SCREENS = {
  /* In the order they are fetched ahead: the tabs first, then where a tap most often leads. */
  Search: later(() => import('./features/search/Search.tsx'), (m) => m.Search),
  /* The Feed tab: the people you follow's trades and comments (the alert rows it showed before are in Notifications, behind the bell). */
  FollowingScreen: later(() => import('./features/following/FollowingScreen.tsx'), (m) => m.FollowingScreen),
  PortfolioScreen: later(() => import('./features/portfolio/PortfolioScreen.tsx'), (m) => m.PortfolioScreen),
  NarrativePage: later(() => import('./features/narrative/NarrativePage.tsx'), (m) => m.NarrativePage),
  TokenPage: later(() => import('./features/token/TokenPage.tsx'), (m) => m.TokenPage),
  SearchedToken: later(() => import('./features/token/SearchedToken.tsx'), (m) => m.SearchedToken),
  CreateCoin: later(() => import('./features/create/CreateCoin.tsx'), (m) => m.CreateCoin),
  Learn: later(() => import('./features/learn/Learn.tsx'), (m) => m.Learn),
  NotificationsScreen: later(() => import('./features/alerts/NotificationsScreen.tsx'), (m) => m.NotificationsScreen),
  FollowList: later(() => import('./features/people/FollowList.tsx'), (m) => m.FollowList),
  Leaderboard: later(() => import('./features/people/Leaderboard.tsx'), (m) => m.Leaderboard),
  ProfileScreen: later(() => import('./features/people/ProfileScreen.tsx'), (m) => m.ProfileScreen),
  ImportScreen: later(() => import('./features/portfolio/ImportScreen.tsx'), (m) => m.ImportScreen),
  WalletsScreen: later(() => import('./features/portfolio/WalletsScreen.tsx'), (m) => m.WalletsScreen),
};
/* Sign-up after sign-in (Username to Done): seen once per member, so its own chunk, never on For You's path. */
const SignUpSteps = lazy(() => import('./features/onboarding/SignUpSteps.tsx').then((m) => ({ default: m.SignUpSteps })));
const CreateCoin = SCREENS.CreateCoin.Component;
const Learn = SCREENS.Learn.Component;
const FollowingScreen = SCREENS.FollowingScreen.Component;
const NotificationsScreen = SCREENS.NotificationsScreen.Component;
const FollowList = SCREENS.FollowList.Component;
const Leaderboard = SCREENS.Leaderboard.Component;
const ProfileScreen = SCREENS.ProfileScreen.Component;
const ImportScreen = SCREENS.ImportScreen.Component;
const WalletsScreen = SCREENS.WalletsScreen.Component;
const NarrativePage = SCREENS.NarrativePage.Component;
const Search = SCREENS.Search.Component;
const SearchedToken = SCREENS.SearchedToken.Component;
const TokenPage = SCREENS.TokenPage.Component;
const PortfolioScreen = SCREENS.PortfolioScreen.Component;

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
function KeptTabs({ shown, entry, ...props }: ScreenProps & { shown: KeptTab | null; entry: string }) {
  const [opened, setOpened] = useState<readonly KeptTab[]>(() => (shown === null ? [] : [shown]));
  if (shown !== null && !opened.includes(shown)) setOpened([...opened, shown]);
  return (
    <>
      {KEPT_TABS.filter((t) => opened.includes(t)).map((t) => (
        <div key={t} style={{ display: t === shown ? 'contents' : 'none' }}>
          <ScreenActive.Provider value={t === shown}>
            <ShownEntry.Provider value={t === shown ? entry : null}>
              <Suspense fallback={null}>
                <Screen {...props} route={t === shown ? props.route : { screen: t }} />
              </Suspense>
            </ShownEntry.Provider>
          </ScreenActive.Provider>
        </div>
      ))}
    </>
  );
}

/**
 * The pages behind the one on screen, each drawn at its own history entry and kept, hidden, while
 * that entry is still behind us (shared/kept-pages.ts), so Back shows it exactly as it was left.
 * The bottom tabs are KeptTabs' and never here.
 */
function KeptPages({ place, page, ...props }: ScreenProps & { place: Place; page: boolean }) {
  const here: KeptPage<Route> = { id: place.id, at: place.at, route: place.route, href: hrefFor(place.route) };
  const [pages, setPages] = useState<readonly KeptPage<Route>[]>(() => arrive([], here, page));
  const next = arrive(pages, here, page);
  if (next !== pages) setPages(next);
  return (
    <>
      {next.map((p) => {
        const on = page && p.id === place.id;
        return (
          <div key={p.id} style={{ display: on ? 'contents' : 'none' }}>
            <ScreenActive.Provider value={on}>
              <ShownEntry.Provider value={on ? p.id : null}>
                <Suspense fallback={null}>
                  <Screen {...props} route={p.route} />
                </Suspense>
              </ShownEntry.Provider>
            </ScreenActive.Provider>
          </div>
        );
      })}
    </>
  );
}

/**
 * Where each visit was scrolled to, by history entry (shared/entry-scroll.ts): Back lands where it
 * left, a new visit to a page starts at its top, a new visit to a bottom tab where that tab was
 * left. Put back before the first paint of the arrival; a page not yet tall enough for its spot
 * (pictures and measured rows can settle its height a frame late) is tried once more on the next
 * frame, unless the person has moved it.
 * Inner scrollers (a chip row, a list in a sheet) are put back too.
 */
function useScrollPerEntry(place: Place, shown: KeptTab | null): void {
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Element && t !== document.documentElement && t !== document.body) noteInner(t);
      else noteWindow(window.scrollY);
    };
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
  useLayoutEffect(() => {
    const y = showEntry(place.id, shown);
    window.scrollTo(0, y);
    restoreInner();
    /* Only a page too short for its spot yet (still drawing) is tried again; one that got there is left alone. */
    if (Math.abs(window.scrollY - y) < 1) return;
    let moved = false;
    const touched = () => {
      moved = true;
    };
    window.addEventListener('touchstart', touched, { passive: true });
    window.addEventListener('wheel', touched, { passive: true });
    const frame = requestAnimationFrame(() => {
      if (!moved && Math.abs(window.scrollY - y) >= 1) window.scrollTo(0, y);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('touchstart', touched);
      window.removeEventListener('wheel', touched);
    };
  }, [place.id, place.hash]);
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
          openCoins={route.coins === true}
          onCreate={(s, from) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, labelled: noticeFor(s) !== null, storyId: s.id, ...(from === undefined ? {} : { link: from.link, postId: from.postId }) })}
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
      return <FollowingScreen unread={unread} onRefreshed={readUnread} />;
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
  const place = usePlace();
  const route = place.route;
  const { wallet, state } = useWallet();
  const [entered, setEntered] = useState(hasEntered);
  const signedIn = state.kind === 'connected';
  /* Signed in on a browser never let in before: does this person have access (invite only)? */
  const access = useAccess(signedIn, entered);
  /* Let in on this browser for the first time: where is this member in sign-up (features/onboarding)? */
  const signUp = useSignUp(signedIn && !entered && access.access === 'in');
  /* Once let in and signed up, this browser is held rather than shown the door while its session comes back. */
  if (signedIn && !entered && access.access === 'in' && signUp.signUp === 'done') {
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
  const myPicture = signedIn ? (wallet?.identity()?.pictureUrl ?? null) : null;
  useEffect(() => {
    if (signedIn) void syncMe(myPicture).catch(() => undefined);
  }, [signedIn, myPicture]);
  /* This phone's notifications, made sure of on every launch: a phone that allowed them is saved
     again, so a save that failed once heals itself (features/alerts/push.ts). No prompt is shown. */
  useEffect(() => {
    if (signedIn) void fetchAlertSettings().then((s) => resavePush(s.push.on && s.push.configured ? s.push.publicKey : null), () => undefined);
  }, [signedIn]);
  /* A tapped notification's trail, sent to notify once signed in (shared/tap-log.ts). */
  useEffect(() => (signedIn ? startTapSending((body) => notifyCall('POST', '/diag/taps', body), deviceOf(navigator.userAgent, standalone())) : undefined), [signedIn]);
  /* The posts watched here, read from the alert service once signed in (shared/watched-posts.ts). */
  useEffect(() => {
    if (signedIn) watchedPosts.load();
  }, [signedIn]);
  /* The narratives starred here are mirrored for alerts sent while the app is closed. */
  const watchedKey = watched.join(',');
  useEffect(() => {
    if (signedIn) void syncWatch(watchedKey === '' ? [] : watchedKey.split(',')).catch(() => undefined);
  }, [signedIn, watchedKey]);
  /* The Feed bell's dot: the alert service's unread count (GET /alerts/unread), read every minute while the app is open. */
  const readUnread = useCallback(() => {
    void fetchUnread().then(setUnread, () => undefined);
  }, []);
  useEffect(() => {
    if (!inside) return;
    readUnread();
    const t = setInterval(readUnread, 60_000);
    return () => clearInterval(t);
  }, [inside, readUnread]);
  const keptTab = keptTabOf(route);
  /* The other screens' code and the chart library, fetched once the app is quiet. */
  useEffect(() => preloadWhenQuiet(Object.values(SCREENS).map((x) => x.load)), []);
  useScrollPerEntry(place, keptTab);
  const onAlertsSeen = useCallback(() => setUnread(0), []);
  /* After every hook, so the hooks run the same way whichever screen is shown. */
  const gate = gateFor({ configured: SIGN_IN_CONFIGURED, state, entered, access: access.access, signUp: signUp.signUp });
  /* Which screen the gate showed, for a tap's trail: a tap that lands behind the door shows here. */
  useEffect(() => noteTap('gate', { gate }), [gate]);
  if (gate === 'holding') return <Holding />;
  const handle = wallet?.identity()?.handle ?? null;
  const signedInAs = handle !== null ? `@${handle}` : null;
  const picture = wallet?.identity()?.pictureUrl ?? null;
  const signOut = () => void wallet?.disconnect();
  if (gate === 'onboarding' && signUp.status !== null) {
    const status = signUp.status;
    return (
      <ComingSoonProvider>
        <Suspense fallback={<Holding />}>
          <SignUpSteps
            status={status}
            onSignOut={signOut}
            onFinished={(s) => {
              /* Open For You: the app, at For You, whatever address sign-up started on. */
              if (window.location.hash !== '' && window.location.hash !== '#/') window.location.hash = '#/';
              signUp.finish(s);
            }}
          />
        </Suspense>
      </ComingSoonProvider>
    );
  }
  if (gate === 'waitlist') return <Waitlist place={access.place} bring={access.bring} signedInAs={signedInAs} picture={picture} signOut={signOut} />;
  if (gate === 'invite' || gate === 'unchecked') {
    return (
      <Landing
        configured={SIGN_IN_CONFIGURED}
        onEnter={() => undefined}
        invite={{ unchecked: gate === 'unchecked', refusal: access.refusal, bring: access.bring, wait: access.wait, retry: access.retry, signedInAs, picture, signOut }}
      />
    );
  }
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
        <KeptTabs shown={keptTab} entry={place.id} route={route} create={setCreating} unread={unread} onAlertsSeen={onAlertsSeen} readUnread={readUnread} />
        <KeptPages place={place} page={keptTab === null} route={route} create={setCreating} unread={unread} onAlertsSeen={onAlertsSeen} readUnread={readUnread} />
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
