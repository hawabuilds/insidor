/**
 * THE FEED'S ONE READ: the alert service's list, held with its three honest states, and a
 * refresh that resolves when the list has been read again (pull to refresh waits on it).
 *
 * Separate from `useLoad` because that one's reload cannot be awaited, and a pull that lets go
 * before the read lands would stop spinning on the old list. A failed refresh keeps the list
 * already on screen rather than replacing it with an error: what was read is still true.
 *
 * What breaks if changed carelessly: the first read failing must still say so (the screens say
 * the feed could not be read), never fall through to an empty list that looks like a quiet day.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAlerts, type Alert } from '../../shared/api/people.ts';
import type { Load } from '../../shared/hooks.ts';

export type AlertList = { readonly unread: number; readonly alerts: readonly Alert[] };

export function useAlertList(): { readonly list: Load<AlertList>; readonly refresh: () => Promise<void> } {
  const [list, setList] = useState<Load<AlertList>>({ state: 'loading' });
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const value = await fetchAlerts();
      if (alive.current) setList({ state: 'ready', value });
    } catch (error) {
      if (alive.current) setList((prev) => (prev.state === 'ready' ? prev : { state: 'failed', error }));
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  return { list, refresh };
}
