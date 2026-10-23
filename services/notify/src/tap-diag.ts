/**
 * A TAPPED NOTIFICATION'S TRAIL, AS THE PHONE RECORDED IT (2026-10-23). Tapping a push on the owner's
 * iPhone did not open the coin or the post, twice after fixes that worked everywhere we could test,
 * and an installed iPhone app cannot be watched from here. So the phone keeps a short trail of each
 * tap — the service worker's steps (the url it was given, the windows it found, what it told or
 * opened) and the page's (the address it woke at, what it read, what it opened) — and sends the
 * last rows on its next start: POST /diag/taps { device, rows }. This writes them as ONE log line,
 * `tap diagnostics`, with the person's id. Nothing is stored.
 *
 * Its own file so the whole thing comes out in one piece once the cause is known: this file, its
 * route in routes.ts, and the phone's side (mobile/src/shared/tap-log.ts, whose `TAP_LOG_ON` is the
 * switch, and the `note` calls in public/sw.js).
 *
 * ★ ONLY SHORT PLAIN VALUES PASS. A row is the phone's word, not ours: anything but a short string,
 * a number or a yes/no is dropped, a long string is cut, and at most `MAX_ROWS` rows of `MAX_FIELDS`
 * fields are written, so a wrong or hostile body cannot fill the log or carry more than a trail.
 */

const MAX_ROWS = 60;
const MAX_FIELDS = 16;
const MAX_TEXT = 160;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;

type Value = string | number | boolean;

function plain(v: unknown): Value | undefined {
  if (typeof v === 'string') return v.slice(0, MAX_TEXT);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  return undefined;
}

/** The rows of a body as they may be logged: plain fields only, cut to size; [] for anything else. */
export function tapRows(body: unknown): readonly Readonly<Record<string, Value>>[] {
  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.slice(-MAX_ROWS).flatMap((r) => {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return [];
    const kept = Object.entries(r as Record<string, unknown>)
      .filter(([k]) => KEY.test(k))
      .flatMap(([k, v]) => {
        const p = plain(v);
        return p === undefined ? [] : [[k, p] as const];
      })
      .slice(0, MAX_FIELDS);
    return kept.length === 0 ? [] : [Object.fromEntries(kept)];
  });
}
