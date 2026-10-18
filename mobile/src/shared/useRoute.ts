/**
 * The current route, from the hash, kept in React state. One listener, owned by the shell.
 */

import { useEffect, useState } from 'react';
import { parseRoute, type Route } from './route.ts';

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    /* Where the new screen is scrolled to is the shell's (App.tsx): a kept tab comes back where
       it was left, any other screen starts at its top. */
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
