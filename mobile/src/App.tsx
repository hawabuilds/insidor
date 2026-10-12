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
 * ★ SIGN IN ONCE, AT THE DOOR. Every address is behind one gate (shared/sign-in.ts): signed in,
 * the app; signed out, the front door, with the address kept so signing in lands on it; a
 * returning person, a moment's hold while their session comes back. No screen inside asks anyone
 * to sign in.
 */

import { useCallback, useEffect, useState } from 'react';
import { CreateCoin, type CreateFrom } from './features/create/CreateCoin.tsx';
import { Feed } from './features/feed/Feed.tsx';
import { Learn } from './features/learn/Learn.tsx';
import { AlertSettings } from './features/alerts/AlertSettings.tsx';
import { AlertsScreen } from './features/alerts/AlertsScreen.tsx';
import { FollowList } from './features/people/FollowList.tsx';
import { Leaderboard } from './features/people/Leaderboard.tsx';
import { ProfileScreen } from './features/people/ProfileScreen.tsx';
import { RankUp } from './features/people/RankUp.tsx';
import { ImportScreen } from './features/portfolio/ImportScreen.tsx';
import { WalletsScreen } from './features/portfolio/WalletsScreen.tsx';
import { PEOPLE_SAMPLE, fetchAlerts, setTokenSource, syncMe, syncWatch } from './shared/api/people.ts';
import { useWatchlist } from './shared/hooks.ts';
import { InstallPrompt } from './features/install/InstallPrompt.tsx';
import { NarrativePage } from './features/narrative/NarrativePage.tsx';
import { Narratives } from './features/narratives/Narratives.tsx';
import { Search } from './features/search/Search.tsx';
import { SearchedToken } from './features/token/SearchedToken.tsx';
import { TokenPage } from './features/token/TokenPage.tsx';
import { ComingSoonScreen } from './features/soon/ComingSoonScreen.tsx';
import { PortfolioScreen } from './features/portfolio/PortfolioScreen.tsx';
import { Holding, Landing } from './features/landing/Landing.tsx';
import { forgetEntered, hasEntered, markEntered } from './features/landing/entered.ts';
import { SIGN_IN_CONFIGURED, gateFor } from './shared/sign-in.ts';
import { useWallet } from './shared/wallet.tsx';
import { tabOf, type Route } from './shared/route.ts';
import { useRoute } from './shared/useRoute.ts';
import { noticeFor } from './shared/story-source.ts';
import { ComingSoonProvider } from './shared/ui/ComingSoon.tsx';
import { TabBar } from './shared/ui/TabBar.tsx';

function Screen({ route, create, onAlertsSeen }: { route: Route; create: (from: CreateFrom) => void; onAlertsSeen: () => void }) {
  switch (route.screen) {
    case 'feed':
      return <Feed onCreate={(row, sample) => create({ title: row.title, reach: row.reach, thumbUrl: row.thumbUrl, sample, storyId: row.id })} />;
    case 'narratives':
      return <Narratives onCreate={(s) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, sample: true, storyId: s.id })} />;
    case 'coin':
      return <TokenPage key={`${route.sample}:${route.storyId}:${route.coinId}`} storyId={route.storyId} coinId={route.coinId} sample={route.sample} />;
    case 'story':
      return (
        <NarrativePage
          key={`${route.sample}:${route.storyId}`}
          storyId={route.storyId}
          sample={route.sample}
          onCreate={(s) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, sample: route.sample || noticeFor(s, false) !== null, storyId: s.id })}
        />
      );
    case 'portfolio':
      return <PortfolioScreen />;
    case 'search':
      return <Search />;
    case 'token':
      return <SearchedToken key={route.coinId} coinId={route.coinId} />;
    case 'learn':
      return <Learn />;
    case 'alerts':
      return <AlertsScreen onSeen={onAlertsSeen} />;
    case 'alert-settings':
      return <AlertSettings />;
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
    if (signedIn && !PEOPLE_SAMPLE) void syncMe().catch(() => undefined);
  }, [signedIn]);
  /* The narratives starred here are mirrored for alerts sent while the app is closed. */
  const watchedKey = watched.join(',');
  useEffect(() => {
    if (signedIn && !PEOPLE_SAMPLE) void syncWatch(watchedKey === '' ? [] : watchedKey.split(',')).catch(() => undefined);
  }, [signedIn, watchedKey]);
  /* The bell's count, read every minute while the app is open. */
  const readUnread = useCallback(() => {
    void fetchAlerts().then((a) => setUnread(a.unread), () => undefined);
  }, []);
  useEffect(() => {
    if (!inside) return;
    readUnread();
    const t = setInterval(readUnread, 60_000);
    return () => clearInterval(t);
  }, [inside, readUnread]);
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
        <Screen route={route} create={setCreating} onAlertsSeen={() => setUnread(0)} />
      </main>
      {route.screen === 'feed' ? <InstallPrompt /> : null}
      <TabBar current={tabOf(route)} unread={unread} />
      <RankUp signedIn={inside} />
      {creating !== null ? <CreateCoin key={creating.title} from={creating} onClose={() => setCreating(null)} /> : null}
    </ComingSoonProvider>
  );
}
