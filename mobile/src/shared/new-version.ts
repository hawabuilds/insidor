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
 * ★ NEVER IN THE HOME-SCREEN APP. An installed app on an iPhone that reloads itself comes back with
 * the page's box short of the screen, the WebKit bug tokens.css works around at launch, and the
 * work-around does not hold after a reload: the dark strip came back under the feed after the
 * 2026-11-13 deploy and left only when the app was closed and opened again. So the installed app
 * keeps the build it is running and takes the newer one at its next fresh open, which the worker
 * serves from its cache either way (public/sw.js). A tab in a browser still reloads as before.
 *
 * What breaks if changed carelessly: reloading on the message itself would throw away whatever the
 * person was doing a second after the app opened; reloading the installed app brings the strip back.
 */

import { noteTap } from './tap-log.ts';

/** How long after coming back to look for a tap in hand: the worker writes it as the tap lands. */
const HOLD_CHECK_MS = 1_000;
let newer = false;

/** Whether a newer build is taken by reloading in place: in a browser tab yes, in the installed app never (see the header). */
export function reloadsInPlace(installed: boolean): boolean {
  return !installed;
}

/** Opened from the home screen rather than in a browser tab. */
function installedApp(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function listenForNewVersion(holdIf: () => Promise<boolean> = () => Promise.resolve(false)): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<unknown>) => {
    const d = e.data;
    if (typeof d === 'object' && d !== null && (d as Record<string, unknown>)['type'] === 'insidor-new-version') newer = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!newer || document.visibilityState !== 'visible') return;
    if (!reloadsInPlace(installedApp())) {
      noteTap('reload-at-next-open', {});
      return;
    }
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
