/**
 * The current route, from the hash, kept in React state. One listener, owned by the shell.
 */

import { useEffect, useState } from 'react';
import { parseRoute, type Route } from './route.ts';

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      /* A new screen starts at its top, not at the scroll position of the last one. */
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
