/**
 * A SHORT TRAIL OF EACH TAPPED NOTIFICATION, SENT TO OUR OWN NOTIFY SERVICE (2026-10-23). Tapping a
 * push on the owner's iPhone did not open the coin or the post, after fixes that worked everywhere we
 * could test, and an installed iPhone app cannot be watched from here. So the phone writes down what
 * happened, step by step, and the next start sends it.
 *
 *   the service worker   public/sw.js `note`: the push's url, the tap's url, the windows it found,
 *                        whether it told one, focused it, or opened the app (and at what address)
 *   the page             `noteTap`: the address it woke at, a message heard, the waiting screen
 *                        read from the cache, the screen opened and what was on screen a moment later
 *
 * Both write to one Cache Storage cache (`LOG`), each under its own key so neither overwrites the
 * other. `startTapSending` sends the merged newest rows to notify (POST /diag/taps), which writes
 * them as one log line, `tap diagnostics` (services/notify/src/tap-diag.ts), and the rows are then
 * deleted. Only rows of a tap are sent: a start with no tap in its trail sends nothing.
 *
 * ★ ONE SWITCH: `TAP_LOG_ON`. Off, the page deletes the cache, and the worker writes only while the
 * cache exists, so the worker falls silent too without a deploy of its own. To remove it all: this
 * file, its calls (grep `noteTap`, `startTapLog`, `startTapSending`), `note` in sw.js, and
 * services/notify's tap-diag.ts and its route.
 *
 * Nothing personal is written: screen addresses (public post and coin ids), step names, counts, and
 * the phone's kind and system version. Every write is best effort and never throws into the app.
 */

export const TAP_LOG_ON = true;

const LOG = 'insidor-taplog';
const PAGE_KEY = '/__insidor_taplog/page';
const SW_KEY = '/__insidor_taplog/sw';
/** Rows kept per writer; rows sent at once. Small: a trail is a few taps, not a history. */
const KEEP = 30;
const SEND = 50;
/** How long after a start or a return to the front the trail is sent: the tap's own steps are written by then. */
const SEND_AFTER_MS = 8_000;
/** Steps that mean a tap happened; a trail with none of them is not sent. */
const TAP_STEPS = new Set(['click', 'message', 'stash', 'launch-mark', 'open']);

type Field = string | number | boolean | null;
export type TapRow = Readonly<Record<string, Field>> & { readonly at: number; readonly by: string; readonly step: string };

/** One queue, so the page's own writes never overwrite each other. */
let queue: Promise<void> = Promise.resolve();
const enqueue = (f: () => Promise<void>): void => {
  queue = queue.then(f).catch(() => undefined);
};

const has = (): boolean => TAP_LOG_ON && typeof caches !== 'undefined';

async function rowsAt(cache: Cache, key: string): Promise<TapRow[]> {
  const hit = await cache.match(key);
  if (hit === undefined) return [];
  const v: unknown = await hit.json().catch(() => []);
  return Array.isArray(v) ? (v as TapRow[]) : [];
}

/** The rows to send: both writers' rows by time, the newest `SEND`, and only when a tap is among them. Pure, for the tests. */
export function trailToSend(page: readonly TapRow[], worker: readonly TapRow[]): readonly TapRow[] {
  const all = [...page, ...worker].sort((a, b) => a.at - b.at).slice(-SEND);
  return all.some((r) => TAP_STEPS.has(r.step)) ? all : [];
}

/** The phone's kind and system version, for reading a trail against platform quirks: "iPhone iOS 18_2 home-screen app". Pure. */
export function deviceOf(ua: string, standalone: boolean): string {
  const os = /OS (\d+(?:_\d+)*) like Mac/.exec(ua)?.[1];
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'other';
  return `${kind}${os === undefined ? '' : ` iOS ${os}`} ${standalone ? 'home-screen app' : 'browser tab'}`;
}

/** Write one page row. Never throws, never waits. */
export function noteTap(step: string, fields: Readonly<Record<string, Field>> = {}): void {
  if (!has()) return;
  const row = { ...fields, at: Date.now(), by: 'page', step };
  enqueue(async () => {
    const cache = await caches.open(LOG);
    const rows = await rowsAt(cache, PAGE_KEY);
    rows.push(row);
    await cache.put(PAGE_KEY, new Response(JSON.stringify(rows.slice(-KEEP)), { headers: { 'content-type': 'application/json' } }));
  });
}

/** Once, before the first frame: on, the log is made (the worker writes only into a log that exists); off, it is deleted. */
export function startTapLog(): void {
  if (typeof caches === 'undefined') return;
  if (TAP_LOG_ON) enqueue(async () => void (await caches.open(LOG)));
  else void caches.delete(LOG).catch(() => undefined);
}

/** Signed in: send the trail a little after this start and after each return to the front. Returns a stop. */
export function startTapSending(send: (body: { readonly device: string; readonly rows: readonly TapRow[] }) => Promise<unknown>, device: string): () => void {
  if (!has()) return () => undefined;
  const flush = () =>
    enqueue(async () => {
      const cache = await caches.open(LOG);
      const rows = trailToSend(await rowsAt(cache, PAGE_KEY), await rowsAt(cache, SW_KEY));
      if (rows.length === 0) return;
      await send({ device, rows });
      await cache.delete(PAGE_KEY);
      await cache.delete(SW_KEY);
    });
  let timer = setTimeout(flush, SEND_AFTER_MS);
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    clearTimeout(timer);
    timer = setTimeout(flush, SEND_AFTER_MS);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
