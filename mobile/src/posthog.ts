/**
 * PRODUCT ANALYTICS (POSTHOG): THE ONE PLACE THE PHONE APP TALKS TO THE VENDOR.
 *
 * Screens import `posthog` from here and call `capture`, `identify`, `reset`, `captureException`
 * and `logger` on it; none imports the library itself. That keeps the library out of the bundle a
 * phone must download before it can draw anything.
 *
 * ★ IT NEVER HOLDS UP THE FIRST PAINT. The library is about 120 KB gzipped, which is two thirds
 * again on top of the app's first download. So it is its own chunk, fetched once the page has
 * loaded and the browser is idle, the way the wallet's code is (main.tsx). Every call made before
 * it arrives waits in a short queue and is replayed in order, so the first screen view, a
 * sign-in's identify or an early tap's event is not lost to the wait. An error thrown before it
 * arrives is the one thing it cannot see; the root boundary's report is queued like the rest.
 *
 * ★ A SCREEN IS A HASH. The router is the `#/` address (shared/route.ts), so a pageview must fire
 * on a change of hash, not only of path; without `hash: true` every launch reads as one page.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: a static `import posthog from 'posthog-js'` anywhere
 * in the app puts the library back in front of the first screen. Import the type only, and add a
 * method to the stand-in below when a screen needs one.
 */

import type { PostHog } from 'posthog-js';

const projectToken = import.meta.env.VITE_POSTHOG_KEY?.trim();
const apiHost = import.meta.env.VITE_POSTHOG_HOST?.trim();
/** How long after load the library may wait for an idle moment, at most. */
const LOAD_WAIT_MS = 3_000;
/** Calls held while the library loads; a session that never loads it does not grow without end. */
const QUEUE_MAX = 100;

if ((!projectToken || !apiHost) && import.meta.env.DEV) {
  const missingVariable = projectToken ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY';
  throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
}

const enabled = Boolean(projectToken && apiHost);
let client: PostHog | null = null;
const queue: ((p: PostHog) => void)[] = [];

function run(f: (p: PostHog) => void): void {
  if (!enabled) return;
  if (client !== null) f(client);
  else if (queue.length < QUEUE_MAX) queue.push(f);
}

function load(): void {
  void import('posthog-js').then(
    ({ posthog: ph }) => {
      ph.init(projectToken as string, {
        api_host: apiHost,
        /* A screen view on every in-app move as well as the first load (see the header). */
        capture_pageview: { path: true, hash: true },
        logs: {
          serviceName: 'insidor-mobile-web',
          environment: import.meta.env.MODE,
        },
        capture_exceptions: {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
          capture_console_errors: false,
        },
      });
      client = ph;
      for (const f of queue.splice(0)) f(ph);
    },
    (error: unknown) => console.warn('analytics failed to load', error),
  );
}

if (enabled && typeof window !== 'undefined') {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  const idle = () => (typeof w.requestIdleCallback === 'function' ? w.requestIdleCallback(load, { timeout: LOAD_WAIT_MS }) : window.setTimeout(load, 200));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

type Level = 'info' | 'warn' | 'error';
type LogAttributes = Record<string, string | number | boolean>;
const log = (level: Level) => (message: string, attributes?: LogAttributes) => run((p) => p.logger[level](message, attributes));

/** The calls the app makes, each sent at once or queued until the library has loaded. */
export const posthog = {
  capture: (...args: Parameters<PostHog['capture']>): void => run((p) => void p.capture(...args)),
  identify: (...args: Parameters<PostHog['identify']>): void => run((p) => p.identify(...args)),
  reset: (...args: Parameters<PostHog['reset']>): void => run((p) => p.reset(...args)),
  captureException: (...args: Parameters<PostHog['captureException']>): void => run((p) => void p.captureException(...args)),
  logger: { info: log('info'), warn: log('warn'), error: log('error') },
};
