/**
 * A NEW DEPLOY, TAKEN AT THE NEXT RETURN TO THE APP. When the service worker had to open the app
 * from its kept copy (a slow connection) and the network's copy turned out to be a newer build, it
 * says so (public/sw.js, `insidor-new-version`). The page does not reload under the person's thumb:
 * it reloads the next time the app comes back to the foreground, which on a phone is the next
 * "open". Until then the build that is running keeps running; its hashed files stay in the cache.
 *
 * ★ NOT WHILE A TAPPED NOTIFICATION IS BEING OPENED. A tap is itself a return to the foreground, so
 * the reload used to land in the same moment the page was opening the tap's screen, and the screen
 * was lost (features/alerts/push-open.ts). The return waits `HOLD_CHECK_MS` and asks `holdIf`; held,
 * the newer build is taken at the next return instead.
 *
 * What breaks if changed carelessly: reloading on the message itself would throw away whatever the
 * person was doing a second after the app opened.
 */

import { noteTap } from './tap-log.ts';

/** How long after coming back to look for a tap in hand: the worker writes it as the tap lands. */
const HOLD_CHECK_MS = 1_000;
let newer = false;

export function listenForNewVersion(holdIf: () => Promise<boolean> = () => Promise.resolve(false)): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<unknown>) => {
    const d = e.data;
    if (typeof d === 'object' && d !== null && (d as Record<string, unknown>)['type'] === 'insidor-new-version') newer = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!newer || document.visibilityState !== 'visible') return;
    setTimeout(() => {
      void holdIf()
        .catch(() => false)
        .then((hold) => {
          noteTap(hold ? 'reload-held' : 'reload', {});
          if (!hold && newer && document.visibilityState === 'visible') location.reload();
        });
    }, HOLD_CHECK_MS);
  });
}
