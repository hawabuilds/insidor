/**
 * A NEW DEPLOY, TAKEN AT THE NEXT RETURN TO THE APP. When the service worker had to open the app
 * from its kept copy (a slow connection) and the network's copy turned out to be a newer build, it
 * says so (public/sw.js, `insidor-new-version`). The page does not reload under the person's thumb:
 * it reloads the next time the app comes back to the foreground, which on a phone is the next
 * "open". Until then the build that is running keeps running; its hashed files stay in the cache.
 *
 * What breaks if changed carelessly: reloading on the message itself would throw away whatever the
 * person was doing a second after the app opened.
 */

let newer = false;

export function listenForNewVersion(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<unknown>) => {
    const d = e.data;
    if (typeof d === 'object' && d !== null && (d as Record<string, unknown>)['type'] === 'insidor-new-version') newer = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (newer && document.visibilityState === 'visible') location.reload();
  });
}
