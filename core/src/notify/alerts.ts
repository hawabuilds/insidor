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
 *   4e. THE OWNER'S PUSH LIST (2026-10-14), each on its own switch: a coin found or launched for a
 *      For You post (`fyp_coin`, once per post), a coin that links a For You post (`fyp_proven`),
 *      a new For You post on a story whose coin the owner confirmed (`story_post`), and a coin for
 *      a post someone watches (`watch_coin`, once per post and coin, past the hourly limit). The
 *      settings screen's test (`push_test`) has no switch and is listed like any other.
 *   4f. AN OUTAGE ALARM IS THE OWNER'S, LIKE THE SUPPLIER ACCOUNT ALERT (`outage`): For You has
 *      taken no new post for a while, the judge is asked but nothing it is asked is paid for, or the
 *      alert service cannot read the database — once when it starts, once when it is back. No
 *      switch, past the hourly limit; mute and quiet hours still hold.
 *   4g. A NARRATIVE YOU STARRED GOT ITS FIRST COIN (`starred_first_coin`, the owner 2026-10-18, for
 *      buyers): once per person and narrative, on its own switch, behind the hourly limit like any
 *      coin alert. Only a settled coin counts; coins that merely share its name do not.
 *   4h. THE OWNER'S NOTIFICATION DESIGN (2026-10-18) — people won't sit in the app, so a push must be
 *      worth opening: an urgent money moment, or something about you. Pushed: the first coin of a
 *      post you saved or a narrative you starred, a For You post or brand-new narrative blowing up
 *      (at most three a day, `DAILY_KINDS`), a starred narrative picking up speed, a big account
 *      posting in one, a reply, a coin you hold doubling or halving, a coin you made getting its
 *      first buyers; new followers and likes pushed as one group (`GROUPED_KINDS`). Everything else
 *      about the pipeline — every new For You post, every coin found for one — is `LIST_ONLY`.
 *   4i. ★ ONE PUSH (the owner, 2026-10-20: "only receive notifications if theres a coin that just
 *      launched and is running from that post"). `coin_launched` — the first coin the one-coin rule
 *      picks for a For You post or a narrative, launched after it was on For You — is the only kind
 *      that reaches a person's phone (`PUSHED_KINDS`), on for everyone, nothing to star, at most
 *      Policy.notify.launch.perDay a day. Every other kind above is still written to the list, so
 *      the Notifications tab keeps showing it, and is never pushed (a saved post's coin since 4j excepted): a starred
 *      narrative's first coin, blowing up, speed, big accounts, replies, holdings, follows and likes
 *      included. The owner's own alarms (4, 4b, 4f, the namer, 5) stay pushed while
 *      Policy.notify.launch.ownerAlarmsPush is on, and the settings screen's test always is.
 *   4j. ★ A SAVED POST ALWAYS PUSHES (the owner, 2026-10-24, after $KURIBO was only listed for him):
 *      `watched_first_coin` is pushed again — the first coin that launched after you saved the post,
 *      and once more if the coin that runs is another (services/notify saved-post.ts). It is past the
 *      hourly limit, has no daily cap, and is not counted against either (`UNCOUNTED_PUSH_KINDS`):
 *      the person asked for it by saving the post, so it must never cost them a launch push. Mute,
 *      its switch and quiet hours still hold — those are the person's own choices.
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
  /* The nightly launch-intelligence summary (tools/launch-intel.ts): owner-only, like the re-tune's. */
  'launch_intel',
  'supplier_account',
  'comment_useful',
  'post_coin',
  /* The namer's first-day watch switched it off (tools/name-watch.ts): pushed past the hourly limit, like the supplier warnings. */
  'namer_off',
  /* The owner's push list (2026-10-14): a coin found for a For You post, a coin that links one, a new
     For You post on a story whose coin the owner confirmed, a coin for a post someone watches, and
     the settings screen's test. */
  'fyp_coin',
  'fyp_proven',
  'story_post',
  'watch_coin',
  'push_test',
  /* The owner's outage alarm (services/notify alarm.ts): For You stalled, the judge refused, the database unreadable;
     and from the runner (language-alarm.ts), one language's finds fallen against the day before. */
  'outage',
  /* A narrative someone starred got its first coin (services/notify first-coin.ts). */
  'starred_first_coin',
  /* The owner's notification design (2026-10-18): a watched post's first coin, a For You post or new
     narrative blowing up (three a day), a starred narrative picking up speed, a big account posting
     in one, a coin you hold halving, and a coin you made getting its first buyers. */
  'watched_first_coin',
  'blowing_up',
  'starred_speed',
  'starred_big_account',
  'holding_down',
  'creator_buyers',
  /* The one push (2026-10-20): a coin that launched for a For You post and is picked as its coin (services/notify launch.ts). */
  'coin_launched',
  /* Every coin the one-coin rule picks for a post, the moment it is picked (services/notify launch.ts
     queuePicks; the owner, 2026-11-09): opt-in only, for people who want every pick on their phone. */
  'coin_picked',
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
export const SWITCHES = ['follows', 'replies', 'useful', 'holdings', 'watchlist', 'graduations', 'rising', 'narratives', 'coins', 'fypCoins', 'proven', 'storyCoins', 'watchedPosts', 'starredFirstCoin', 'blowingUp', 'starredSpeed', 'bigAccounts', 'createdCoins', 'launches', 'everyPick'] as const;
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
  launch_intel: 'always',
  supplier_account: 'always',
  comment_useful: 'useful',
  post_coin: 'coins',
  namer_off: 'always',
  fyp_coin: 'fypCoins',
  fyp_proven: 'proven',
  story_post: 'storyCoins',
  watch_coin: 'watchedPosts',
  push_test: 'always',
  outage: 'always',
  starred_first_coin: 'starredFirstCoin',
  watched_first_coin: 'watchedPosts',
  blowing_up: 'blowingUp',
  starred_speed: 'starredSpeed',
  starred_big_account: 'bigAccounts',
  holding_down: 'holdings',
  creator_buyers: 'createdCoins',
  coin_launched: 'launches',
  coin_picked: 'everyPick',
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
    on: { follows: true, replies: true, useful: true, holdings: true, watchlist: false, graduations: true, rising: true, narratives: true, coins: true, fypCoins: true, proven: true, storyCoins: true, watchedPosts: true, starredFirstCoin: true, blowingUp: true, starredSpeed: true, bigAccounts: true, createdCoins: true, launches: true, everyPick: false },
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

/**
 * The kinds the hourly limit never holds back: the owner's alarms about money, outages and the namer, a coin
 * for a post someone is watching (the owner: "notify me within seconds" — a busy hour of For You
 * posts must not be what keeps it off the phone), and the test someone just tapped.
 */
/* `coin_picked`: the person switched on every pick, knowing it is many a day; an hourly ceiling would quietly drop the runner they asked not to miss. */
const PAST_THE_LIMIT: readonly AlertKind[] = ['supplier_warning', 'supplier_account', 'namer_off', 'watch_coin', 'watched_first_coin', 'push_test', 'outage', 'coin_picked'];

/**
 * ★ LISTED, NEVER PUSHED (the owner's notification design, 2026-10-18: people won't sit in the app,
 * so a push must be worth opening — an urgent money moment or something personal). Every new For
 * You post, every coin found for one, a narrative reaching the board or matched to a coin, and each
 * further coin for a post you watch are in the list only. What is pushed about them instead: the
 * fastest risers (`blowing_up`, three a day), the first coin of what you saved or starred
 * (`watched_first_coin`, `starred_first_coin`). A rank-up was always list-only (Trador).
 */
export const LIST_ONLY: readonly AlertKind[] = ['rank_up', 'rising_post', 'narrative_promoted', 'narrative_coin', 'coin_matched', 'fyp_coin', 'fyp_proven', 'watch_coin'];

/**
 * ★ THE ONLY KINDS THAT REACH A PHONE (4i, 4j). A kind not here is listed and never pushed, whatever its
 * switch says — a kind added later is quiet until someone decides it is worth a phone. The owner's
 * alarms are pushed while Policy.notify.launch.ownerAlarmsPush is on (absent policy: on, so a
 * caller that forgets the policy never silences an outage).
 */
export const PUSHED_KINDS: readonly AlertKind[] = ['coin_launched', 'watched_first_coin', 'push_test', 'coin_picked'];

/**
 * ★ PUSHES THAT USE UP NO ALLOWANCE (4j): not counted in the hourly limit or any daily cap of the
 * person's other pushes. The deliverer leaves them out of both counts.
 */
/* `coin_picked` too: someone who asked for every pick still gets their other pushes; the picks are uncapped (no pacing) and pass their hourly ceiling (PAST_THE_LIMIT). */
export const UNCOUNTED_PUSH_KINDS: readonly AlertKind[] = ['watched_first_coin', 'coin_picked'];
export const OWNER_ALARM_KINDS: readonly AlertKind[] = ['supplier_warning', 'supplier_account', 'namer_off', 'outage', 'retune_summary', 'launch_intel'];
export const pushable = (kind: AlertKind, P?: NotifyPolicy): boolean => PUSHED_KINDS.includes(kind) || (OWNER_ALARM_KINDS.includes(kind) && (P?.launch.ownerAlarmsPush ?? true));

/**
 * ★ PUSHED AS A GROUP: each follow and each like is listed as it comes, but held from the phone and
 * pushed together ("3 new followers") by the deliverer's group pass (Policy.notify.grouped).
 */
export const GROUPED_KINDS: readonly AlertKind[] = ['follow', 'comment_useful'];

/**
 * ★ PACED KINDS: how often one may reach a person's phone; past it, it is listed (`daily-limit`).
 * Blowing up: at most `perDay` in any day, `minGapMs` apart, all of them together. A starred
 * narrative's speed and a big account posting in it: one push per narrative every `gapMs`, counted
 * per narrative (the subject up to its first `|` is the narrative).
 */
export interface Pacing {
  readonly perDay: number | null;
  readonly dayMs: number;
  readonly minGapMs: number;
  readonly per: 'kind' | 'narrative';
}
export function pacingOf(kind: AlertKind, P: NotifyPolicy): Pacing | null {
  if (kind === 'blowing_up') return { perDay: P.blowingUp.perDay, dayMs: P.blowingUp.dayMs, minGapMs: P.blowingUp.minGapMs, per: 'kind' };
  if (kind === 'starred_speed') return { perDay: null, dayMs: P.blowingUp.dayMs, minGapMs: P.starredSpeed.gapMs, per: 'narrative' };
  if (kind === 'starred_big_account') return { perDay: null, dayMs: P.blowingUp.dayMs, minGapMs: P.bigAccount.gapMs, per: 'narrative' };
  /* The one push: a daily count and no gap — two coins launching minutes apart are both news. */
  if (kind === 'coin_launched') return { perDay: P.launch.perDay, dayMs: P.launch.dayMs, minGapMs: 0, per: 'kind' };
  return null;
}
/** The narrative a paced alert counts against: its subject up to the first `|`. */
export const pacedScope = (subject: string): string => subject.split('|')[0] ?? subject;

export type Delivery =
  | { readonly kind: 'skip'; readonly why: 'muted' | 'off' }
  | { readonly kind: 'list'; readonly why: 'list-only' | 'quiet' | 'hourly-limit' | 'daily-limit' | 'no-device' }
  | { readonly kind: 'hold' }
  | { readonly kind: 'push' };

/** How many of this kind reached this person's phone in the last day, and how long ago the last did (null: none). */
export interface PushedOfKind {
  readonly lastDay: number;
  readonly sinceLastMs: number | null;
}

/** Whether a paced kind may still be pushed: under `perDay` in the day (when it has one) and `minGapMs` since the last. */
export function underDailyAllowance(o: PushedOfKind, rule: Pacing): boolean {
  return (rule.perDay === null || o.lastDay < rule.perDay) && (o.sinceLastMs === null || o.sinceLastMs >= rule.minGapMs);
}

/** Whether a held group is due its push: its oldest member waited `waitMs`, and the group's last push was `gapMs` ago or never. */
export function groupDue(oldestHeldAgoMs: number, sinceLastPushMs: number | null, rule: { readonly waitMs: number; readonly gapMs: number }): boolean {
  return oldestHeldAgoMs >= rule.waitMs && (sinceLastPushMs === null || sinceLastPushMs >= rule.gapMs);
}

/**
 * What happens to one alert for one person, after its level was claimed. `ofKind` and `policy` are
 * needed for a paced kind (`pacingOf`) (absent: it is held to the hourly limit alone); `grouped` is the
 * group pass asking for the group's one push, which is then decided like any other.
 */
export function deliveryFor(r: { readonly kind: AlertKind; readonly prefs: AlertPrefs; readonly localMinutes: number | null; readonly pushedLastHour: number; readonly devices: number; readonly ofKind?: PushedOfKind; readonly policy?: NotifyPolicy; readonly grouped?: boolean }): Delivery {
  if (r.prefs.muted) return { kind: 'skip', why: 'muted' };
  if (!wants(r.prefs, r.kind)) return { kind: 'skip', why: 'off' };
  if (LIST_ONLY.includes(r.kind) || !pushable(r.kind, r.policy)) return { kind: 'list', why: 'list-only' };
  if (isQuiet(r.localMinutes, r.prefs)) return { kind: 'list', why: 'quiet' };
  if (!PAST_THE_LIMIT.includes(r.kind) && r.pushedLastHour >= r.prefs.perHour) return { kind: 'list', why: 'hourly-limit' };
  const pacing = r.policy === undefined ? null : pacingOf(r.kind, r.policy);
  if (pacing !== null && r.ofKind !== undefined && !underDailyAllowance(r.ofKind, pacing)) return { kind: 'list', why: 'daily-limit' };
  if (r.devices === 0) return { kind: 'list', why: 'no-device' };
  if (GROUPED_KINDS.includes(r.kind) && r.grouped !== true) return { kind: 'hold' };
  return { kind: 'push' };
}
