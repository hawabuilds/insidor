/**
 * ALERTS: which ones a person gets, at which level, and whether one is pushed or only listed.
 * Trador's rules (server/notifications/dispatch.ts, lib/notifications/milestones.ts,
 * quietHours.ts) plus the two it lacked: an hourly limit, and Insidor's own kinds.
 *
 *   1. ★ ONCE PER LEVEL, EVER. A holding that reaches 5× alerts once at 5×, and only the
 *      highest level crossed fires; the levels below it are spent with it. (The claim itself is
 *      a unique row in the database; `highestMilestone` is told which levels are spent.)
 *   2. ★ OFF MEANS NOTHING. A kind switched off, or everything muted, makes no row and no push.
 *   3. ★ QUIET HOURS AND THE HOURLY LIMIT DELAY NOTHING AND DROP NOTHING. The alert lands in the
 *      list; only the push is withheld. A rank-up is list-only, as in Trador.
 *   4. ★ A SUPPLIER WARNING IS THE OWNER'S, AND IT IS NEVER HELD BACK BY THE HOURLY LIMIT. It is
 *      queued only for the owner (services/runner), when a supplier's spend reaches a share of
 *      its daily line. It has no switch, so it cannot be turned off by accident on the settings
 *      screen; mute still silences it and quiet hours still withhold its push, because both are
 *      the owner's own explicit choices. The hourly limit is not: a busy hour of coin alerts must
 *      not be what keeps the one about money off the phone.
 *   4b. A SUPPLIER ACCOUNT ALERT IS THE SAME KIND OF ALARM: a supplier refused a call because its
 *      account is out of credit (or recovered). The owner's, no switch, past the hourly limit;
 *      mute and quiet hours still hold. The runner sends it at most once per supplier an hour.
 *   4c. "N PEOPLE FOUND YOUR COMMENT USEFUL" is Trador's votes notification: holders liking a
 *      comment of yours, one alert per comment that counts them (its level is the count, so each
 *      new liker is a new level and the list shows the newest). Its own switch, on to start.
 *   4d. A POST'S COIN IS PROVEN: someone tapped the bell on a post, and a coin was then proven to
 *      come from it. Once per person and post, on the coins switch (coins for what you watch).
 *   5. A RE-TUNE SUMMARY IS THE OWNER'S TOO: twice a day, what the judge learned from the owner's
 *      own calls and whether it was applied (tools/retune.ts). No switch, like the warning, but
 *      it waits behind the hourly limit like any other alert — it is a report, not an alarm.
 *
 * Pure: the local time and the counts come in as arguments (the service reads the clock and the
 * person's timezone). What breaks if changed carelessly:
 * `wants` is the only map from a kind to its switch. A new kind with no entry is off, never on.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';

export const ALERT_KINDS = [
  'follow',
  'reply',
  'rank_up',
  'holding_multiple',
  'watchlist_multiple',
  'graduating_soon',
  'graduated',
  'rising_post',
  'narrative_promoted',
  'narrative_coin',
  'coin_matched',
  'supplier_warning',
  'retune_summary',
  'supplier_account',
  'comment_useful',
  'post_coin',
  /* The namer's first-day watch switched it off (tools/name-watch.ts): pushed past the hourly limit, like the supplier warnings. */
  'namer_off',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * The kinds the app's Feed tab shows: what is happening on the pipeline, not what happened to
 * you. Every other kind is a notification, and only notifications are counted on the bell. The
 * alert service pages each side on its own with this list; the phone keeps a copy of it
 * (mobile/src/features/alerts/split.ts) because the app may not import core. A kind added later
 * and left off this list lands in Notifications, seen and counted, rather than nowhere.
 */
export const FEED_KINDS: readonly AlertKind[] = ['rising_post', 'narrative_promoted', 'narrative_coin', 'coin_matched'];

/** The switches a person sees, one per row of the settings screen. */
export const SWITCHES = ['follows', 'replies', 'useful', 'holdings', 'watchlist', 'graduations', 'rising', 'narratives', 'coins'] as const;
export type AlertSwitch = (typeof SWITCHES)[number];

const SWITCH_OF: Record<AlertKind, AlertSwitch | 'always'> = {
  follow: 'follows',
  reply: 'replies',
  rank_up: 'always',
  holding_multiple: 'holdings',
  watchlist_multiple: 'watchlist',
  graduating_soon: 'graduations',
  graduated: 'graduations',
  rising_post: 'rising',
  narrative_promoted: 'narratives',
  narrative_coin: 'narratives',
  coin_matched: 'coins',
  supplier_warning: 'always',
  retune_summary: 'always',
  supplier_account: 'always',
  comment_useful: 'useful',
  post_coin: 'coins',
  namer_off: 'always',
};

export interface AlertPrefs {
  readonly muted: boolean;
  readonly on: Readonly<Record<AlertSwitch, boolean>>;
  /** The multiples that count for holdings and the watchlist. Never empty. */
  readonly multiples: readonly number[];
  /** "HH:MM" local to `timezone`; both or neither. Equal ends mean off. */
  readonly quietStart: string | null;
  readonly quietEnd: string | null;
  readonly timezone: string;
  /** Pushes an hour; the rest wait in the list. */
  readonly perHour: number;
}

/** Trador's defaults, with ours added on: the watchlist off (a watchlist is for browsing), the rest on. */
export function defaultPrefs(P: NotifyPolicy): AlertPrefs {
  return {
    muted: false,
    on: { follows: true, replies: true, useful: true, holdings: true, watchlist: false, graduations: true, rising: true, narratives: true, coins: true },
    multiples: [...P.defaultMultiples],
    quietStart: null,
    quietEnd: null,
    timezone: 'UTC',
    perHour: P.defaultPerHour,
  };
}

/** Prefs as stored, made whole: a missing switch takes its default, a bad multiple is dropped, the limit is clamped. */
export function normalisePrefs(raw: Partial<AlertPrefs> & { readonly on?: Partial<Record<AlertSwitch, boolean>> }, P: NotifyPolicy): AlertPrefs {
  const d = defaultPrefs(P);
  const multiples = (raw.multiples ?? d.multiples).filter((m) => P.milestones.includes(m));
  const time = (t: string | null | undefined) => (typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t) ? t : null);
  const qs = time(raw.quietStart);
  const qe = time(raw.quietEnd);
  return {
    muted: raw.muted === true,
    on: Object.fromEntries(SWITCHES.map((s) => [s, typeof raw.on?.[s] === 'boolean' ? raw.on[s] : d.on[s]])) as Record<AlertSwitch, boolean>,
    multiples: multiples.length > 0 ? [...new Set(multiples)].sort((a, b) => a - b) : d.multiples,
    quietStart: qs !== null && qe !== null ? qs : null,
    quietEnd: qs !== null && qe !== null ? qe : null,
    timezone: typeof raw.timezone === 'string' && raw.timezone.length > 0 ? raw.timezone : d.timezone,
    perHour: Math.min(P.maxPerHour, Math.max(1, Math.round(raw.perHour ?? d.perHour))),
  };
}

export function wants(prefs: AlertPrefs, kind: AlertKind): boolean {
  const s = SWITCH_OF[kind];
  return s === 'always' || prefs.on[s] === true;
}

/**
 * The highest level `ratio` has crossed that is switched on and not yet spent; null when none.
 * Below the first milestone nothing fires.
 */
export function highestMilestone(ratio: number, enabled: readonly number[], spent: readonly number[], P: NotifyPolicy): number | null {
  if (!Number.isFinite(ratio)) return null;
  let hit: number | null = null;
  for (const step of P.milestones) {
    if (ratio < step) break;
    if (enabled.includes(step) && !spent.includes(step)) hit = step;
  }
  return hit;
}

/** The levels a fired level spends with it: itself and every switched-on level below. */
export const spentWith = (level: number, enabled: readonly number[]): readonly number[] => enabled.filter((m) => m <= level);

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * MINUTES_PER_HOUR + (m ?? 0);
};
const MINUTES_PER_HOUR = 60; // policy-allow: minutes in an hour — a clock fact

/**
 * Inside quiet hours. `localMinutes` is the minute of the day in the person's own timezone, read
 * by the service (null when the zone is unknown — never quiet). A window may wrap midnight.
 */
export function isQuiet(localMinutes: number | null, prefs: AlertPrefs): boolean {
  if (localMinutes === null || prefs.quietStart === null || prefs.quietEnd === null || prefs.quietStart === prefs.quietEnd) return false;
  const start = minutesOf(prefs.quietStart);
  const end = minutesOf(prefs.quietEnd);
  return start < end ? localMinutes >= start && localMinutes < end : localMinutes >= start || localMinutes < end;
}

export type Delivery =
  | { readonly kind: 'skip'; readonly why: 'muted' | 'off' }
  | { readonly kind: 'list'; readonly why: 'list-only' | 'quiet' | 'hourly-limit' | 'no-device' }
  | { readonly kind: 'push' };

/** What happens to one alert for one person, after its level was claimed. */
export function deliveryFor(r: { readonly kind: AlertKind; readonly prefs: AlertPrefs; readonly localMinutes: number | null; readonly pushedLastHour: number; readonly devices: number }): Delivery {
  if (r.prefs.muted) return { kind: 'skip', why: 'muted' };
  if (!wants(r.prefs, r.kind)) return { kind: 'skip', why: 'off' };
  if (r.kind === 'rank_up') return { kind: 'list', why: 'list-only' };
  if (isQuiet(r.localMinutes, r.prefs)) return { kind: 'list', why: 'quiet' };
  if (r.kind !== 'supplier_warning' && r.kind !== 'supplier_account' && r.kind !== 'namer_off' && r.pushedLastHour >= r.prefs.perHour) return { kind: 'list', why: 'hourly-limit' };
  if (r.devices === 0) return { kind: 'list', why: 'no-device' };
  return { kind: 'push' };
}
