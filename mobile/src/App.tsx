/**
 * THE PHONE APP'S SHELL. Routing, the tab bar, and the Coming-soon toast — no fetching and no
 * domain logic of its own.
 *
 * Routing is the hash (`shared/route.ts`), with no router dependency, for the desktop shell's
 * reason: a handful of screens is twenty lines, not a package.
 *
 * The tab bar is always there. A story and a coin page belong to whichever list they were
 * reached from, and light that tab, so the bar always says where "back" leads.
 */

import { useState } from 'react';
import { CreateCoin, type CreateFrom } from './features/create/CreateCoin.tsx';
import { Feed } from './features/feed/Feed.tsx';
import { InstallPrompt } from './features/install/InstallPrompt.tsx';
import { NarrativePage } from './features/narrative/NarrativePage.tsx';
import { Narratives } from './features/narratives/Narratives.tsx';
import { TokenPage } from './features/token/TokenPage.tsx';
import { ComingSoonScreen } from './features/soon/ComingSoonScreen.tsx';
import { WalletScreen } from './features/wallet/WalletScreen.tsx';
import { tabOf, type Route } from './shared/route.ts';
import { useRoute } from './shared/useRoute.ts';
import { noticeFor } from './shared/story-source.ts';
import { ComingSoonProvider } from './shared/ui/ComingSoon.tsx';
import { TabBar } from './shared/ui/TabBar.tsx';

function Screen({ route, create }: { route: Route; create: (from: CreateFrom) => void }) {
  switch (route.screen) {
    case 'feed':
      return <Feed onCreate={(row, sample) => create({ title: row.title, reach: row.reach, thumbUrl: row.thumbUrl, sample })} />;
    case 'narratives':
      return <Narratives onCreate={(s) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, sample: true })} />;
    case 'coin':
      return <TokenPage key={`${route.sample}:${route.storyId}:${route.coinId}`} storyId={route.storyId} coinId={route.coinId} sample={route.sample} />;
    case 'story':
      return (
        <NarrativePage
          key={`${route.sample}:${route.storyId}`}
          storyId={route.storyId}
          sample={route.sample}
          onCreate={(s) => create({ title: s.title, reach: s.reach, thumbUrl: s.thumbUrl, sample: route.sample || noticeFor(s, false) !== null })}
        />
      );
    case 'wallet':
      return <WalletScreen />;
    case 'search':
    case 'calls':
      return <ComingSoonScreen which={route.screen} />;
    default:
      return <ComingSoonScreen which="narratives" />;
  }
}

export function App() {
  const route = useRoute();
  /* The create modal sits over whichever screen opened it, so it lives here, above them. */
  const [creating, setCreating] = useState<CreateFrom | null>(null);
  return (
    <ComingSoonProvider>
      <main>
        <Screen route={route} create={setCreating} />
      </main>
      {route.screen === 'feed' ? <InstallPrompt /> : null}
      <TabBar current={tabOf(route)} />
      {creating !== null ? <CreateCoin key={creating.title} from={creating} onClose={() => setCreating(null)} /> : null}
    </ComingSoonProvider>
  );
}
