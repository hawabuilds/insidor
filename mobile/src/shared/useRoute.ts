/**
 * The current route, from the hash, kept in React state, with the history entry showing it (its id
 * and depth, shared/nav.ts). One listener, owned by the shell.
 *
 * The entry is part of where the app is: the same address reached by a new tap is a new entry and a
 * fresh page, while Back onto an old entry finds that entry's page as it was left (App.tsx,
 * shared/kept-pages.ts). Read after nav.ts has stamped the entry (its listener is added first, in
 * main.tsx), so a new entry already has its id here.
 */

import { useEffect, useState } from 'react';
import { entryNow } from './nav.ts';
import { parseRoute, type Route } from './route.ts';

export interface Place {
  readonly route: Route;
  /** The address as written, to tell two places apart cheaply. */
  readonly hash: string;
  /** The history entry's id and depth. */
  readonly id: string;
  readonly at: number;
}

function placeNow(): Place {
  const e = entryNow();
  const hash = window.location.hash;
  return { route: parseRoute(hash), hash, id: e.id, at: e.at };
}

export function usePlace(): Place {
  const [place, setPlace] = useState<Place>(placeNow);
  useEffect(() => {
    /* Where the new screen is scrolled to is the shell's (App.tsx, shared/entry-scroll.ts). A sheet's
       own entries (dismiss.ts) share their screen's id and address, so moving onto one changes nothing here. */
    const onMove = () =>
      setPlace((was) => {
        const now = placeNow();
        return now.id === was.id && now.at === was.at && now.hash === was.hash ? was : now;
      });
    window.addEventListener('hashchange', onMove);
    window.addEventListener('popstate', onMove);
    return () => {
      window.removeEventListener('hashchange', onMove);
      window.removeEventListener('popstate', onMove);
    };
  }, []);
  return place;
}

/** The current route alone, for a screen that does not care which visit it is. */
export function useRoute(): Route {
  return usePlace().route;
}
