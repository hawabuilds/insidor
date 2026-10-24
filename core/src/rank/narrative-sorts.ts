/**
 * THE NARRATIVES TAB'S TRENDING, AS FOR YOU'S (the owner, 2026-10-18: "the Narratives tab works
 * exactly like For You's sorts"). A narrative's speeds now and before, from its posts' own readings,
 * and the Trending list made from them.
 *
 * ★ THE SPEEDS ARE FOR YOU'S, ADDED UP. Each post's two speeds are core `riserSpeeds` (post-sorts.ts):
 * views a minute over the last 30 minutes and over the hour before, each only when the post's
 * readings measure its span. A narrative's speed is the sum over its posts whose spans are measured,
 * and the same posts in both sums, so a post read once an hour can neither lift "now" nor sink
 * "before". No post measured: no speeds, and the narrative is not on Trending — an unread story is
 * not a slow one.
 *
 * ★ WHY IT LIVES IN CORE. The projector makes the speeds (it alone can read the readings) and the read
 * service orders the list (it alone answers the phone). The rule that turns speeds into a list is
 * here so both read Policy.rising.forYouSorts.risers the same way, the thresholds For You uses.
 *
 * THE LIST (`narrativeTrending`): a RISER is a fresh narrative whose speed now is over the floor (a
 * short video's views divided by the short-video scale first, as For You's floor) and at least
 * `minRatio` times its speed before; risers by how many times faster, a narrative that gained nothing
 * before faster than any ratio. Under `fillBelow` risers, the other fresh narratives over the floor
 * fill the list to `fillTo`, by the same ratio, so a filled card's own line says it is flat or slowing.
 * Ties: the faster now, then the id in byte order.
 *
 * What breaks if changed carelessly: summing a post into "now" that is not in "before" (or the
 * reverse) makes a narrative whose newest post was just read look like it is speeding up; and
 * ordering by the scaled speeds puts the ratio the card shows out of step with the order.
 */

import type { Policy } from '@insidor/contracts';

import { riserSpeeds, type SortReading } from './post-sorts.ts';

export interface NarrativePostReadings {
  readonly readings: readonly SortReading[];
  /** Where it was posted: the speeds now are also kept per source, so the floor can scale a short video's. */
  readonly source: string;
}

export interface NarrativeSpeeds {
  /** Views a minute over the last 30 minutes, the measured posts' speeds added up, real views. */
  readonly now: number;
  /** Views a minute over the hour before (30 to 90 minutes ago), the same posts. */
  readonly before: number;
  /** How many of its posts were measured over both spans. */
  readonly posts: number;
  /** `now` split by where the posts went up. */
  readonly nowBySource: Readonly<Record<string, number>>;
}

/** The narrative's two speeds, or null when none of its posts' readings measure both spans. */
export function narrativeSpeeds(posts: readonly NarrativePostReadings[], nowMs: number, policy: Policy): NarrativeSpeeds | null {
  let now = 0;
  let before = 0;
  let counted = 0;
  const bySource: Record<string, number> = {};
  for (const p of posts) {
    const s = riserSpeeds(p.readings, nowMs, policy);
    if (s === null) continue;
    now += s.now;
    before += s.before;
    counted += 1;
    bySource[p.source] = (bySource[p.source] ?? 0) + s.now;
  }
  return counted === 0 ? null : { now, before, posts: counted, nowBySource: bySource };
}

export interface TrendingNarrative {
  readonly id: string;
  readonly speeds: NarrativeSpeeds;
  /** Its speeds were made under `freshMs` ago. */
  readonly fresh: boolean;
}

/** Speed now for the floor: each source's views divided by its scale (a short video's by the short-video scale). */
export function floorSpeed(s: NarrativeSpeeds, scaleOf: (source: string) => number): number {
  return Object.entries(s.nowBySource).reduce((sum, [source, v]) => sum + v / scaleOf(source), 0);
}

/** Trending in order (see the header). Dead narratives are the caller's to leave out. */
export function narrativeTrending(rows: readonly TrendingNarrative[], scaleOf: (source: string) => number, policy: Policy): readonly TrendingNarrative[] {
  const r = policy.rising.forYouSorts.risers;
  const ratio = (x: TrendingNarrative): number => (x.speeds.before > 0 ? x.speeds.now / x.speeds.before : Infinity);
  const cmp = (a: TrendingNarrative, b: TrendingNarrative): number => {
    const ra = ratio(a);
    const rb = ratio(b);
    if (ra !== rb) return rb > ra ? 1 : -1;
    if (a.speeds.now !== b.speeds.now) return b.speeds.now > a.speeds.now ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const over = rows.filter((x) => x.fresh && floorSpeed(x.speeds, scaleOf) >= r.floorPerMin);
  const risers = over.filter((x) => x.speeds.now >= r.minRatio * x.speeds.before).sort(cmp);
  if (risers.length >= r.fillBelow) return risers;
  const taken = new Set(risers.map((x) => x.id));
  const fill = over.filter((x) => !taken.has(x.id)).sort(cmp);
  return [...risers, ...fill].slice(0, Math.max(r.fillTo, risers.length));
}

/** A narrative's views gained over the last hour, as its page says it (`viewsGained1h`), for the fill. */
export interface HourGain {
  readonly id: string;
  /** Measured views gained in the last hour; null when the page did not measure it. */
  readonly gained: number | null;
  /** Its page was made under `freshMs` ago. */
  readonly fresh: boolean;
}

/** A narrative's viral posts as its page counts them, for the steady list (policy.v162 `narrative.trend.list*`). */
export interface SteadyNarrative {
  readonly id: string;
  /** Accounts with a post that went up in the page's `listWindowHours` window and is at For You's views; null: the page did not say. */
  readonly viralAccounts: number | null;
  readonly fresh: boolean;
}

/**
 * ★ TRENDING NEVER EMPTY FOR WANT OF A HALF-HOURLY READING. The speeds need a reading in the last
 * 30 minutes AND in the hour before, a mark gap under 20 minutes, of the same posts. When re-reads
 * are paused (the X re-read day spent, as on 2026-10-21 from midday) or a post leaves For You, its
 * readings thin out and its narrative has no speeds: that day 2 of 638 live narratives had any,
 * both under the floor, and the tab said "Nothing is speeding up right now" while 19 fresh
 * narratives had measured last-hour gains of 5K to 587K views.
 *
 * So the fill (fewer than `fillBelow` risers, filled to `fillTo`) runs in two steps: first the
 * others over the floor by ratio (`narrativeTrending`), then, still short, the fresh narratives
 * with a measured gain in the last hour, the most first, ties by id. Each card says its own facts
 * (its gain in the last hour), so a filled card never claims to be speeding up. An unmeasured or
 * zero gain is not a gain: such a narrative stays off, never ranked as 0.
 *
 * ★ THE STEADY LIST (policy.v162): between the risers and the fill, every fresh narrative whose page
 * counts viral posts from `narrative.trend.listMinAccounts` accounts or more (`steady`), most first,
 * then the bigger last-hour gain. Its card says that count, the reason it is listed. A page that does
 * not say is not steady: an unknown is never a yes.
 */
export function narrativeTrendingIds(rows: readonly TrendingNarrative[], scaleOf: (source: string) => number, policy: Policy, hourGains: readonly HourGain[] = [], steady: readonly SteadyNarrative[] = []): readonly string[] {
  const r = policy.rising.forYouSorts.risers;
  const isRiser = (x: TrendingNarrative): boolean => x.fresh && floorSpeed(x.speeds, scaleOf) >= r.floorPerMin && x.speeds.now >= r.minRatio * x.speeds.before;
  const ranked = narrativeTrending(rows, scaleOf, policy).map((x) => x.id);
  const riserIds = new Set(rows.filter(isRiser).map((x) => x.id));
  const risers = ranked.filter((id) => riserIds.has(id));
  /* ★ Then the stories that keep having viral posts (`narrative.trend.list*`), most accounts first. */
  const t = policy.narrative.trend;
  const gainOf = new Map(hourGains.map((g) => [g.id, g.gained ?? Number.NEGATIVE_INFINITY] as const));
  const steadyIds = steady
    .filter((s): s is SteadyNarrative & { viralAccounts: number } => s.fresh && s.viralAccounts !== null && s.viralAccounts >= t.listMinAccounts && !riserIds.has(s.id))
    .sort((a, b) => b.viralAccounts - a.viralAccounts || (gainOf.get(b.id) ?? Number.NEGATIVE_INFINITY) - (gainOf.get(a.id) ?? Number.NEGATIVE_INFINITY) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => s.id);
  const head = [...risers, ...steadyIds];
  if (risers.length >= r.fillBelow) return head;
  const taken = new Set(head);
  const fill = ranked.filter((id) => !taken.has(id));
  for (const id of fill) taken.add(id);
  const more = hourGains
    .filter((g): g is HourGain & { gained: number } => g.fresh && g.gained !== null && g.gained > 0 && !taken.has(g.id))
    .sort((a, b) => b.gained - a.gained || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((g) => g.id);
  return [...head, ...fill, ...more].slice(0, Math.max(r.fillTo, head.length));
}
