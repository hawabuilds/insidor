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

import { ComingSoonScreen } from './features/soon/ComingSoonScreen.tsx';
import { tabOf, type Route } from './shared/route.ts';
import { useRoute } from './shared/useRoute.ts';
import { ComingSoonProvider } from './shared/ui/ComingSoon.tsx';
import { TabBar } from './shared/ui/TabBar.tsx';

function Screen({ route }: { route: Route }) {
  switch (route.screen) {
    case 'search':
    case 'calls':
    case 'wallet':
      return <ComingSoonScreen which={route.screen} />;
    default:
      return <ComingSoonScreen which="narratives" />;
  }
}

export function App() {
  const route = useRoute();
  return (
    <ComingSoonProvider>
      <main>
        <Screen route={route} />
      </main>
      <TabBar current={tabOf(route)} />
    </ComingSoonProvider>
  );
}
