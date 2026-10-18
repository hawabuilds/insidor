/**
 * THE LANGUAGE-DROP RULE (`notify.languageDrop`): from one source's finds per language in time
 * buckets, when a language went down (its last window fell by more than `dropShare` against the
 * same window a day before) and when it came back. Pure: buckets and instants in, changes out.
 *
 * Why it exists: from about 23:15 UTC on 2026-10-16 the text supplier answered an OR of languages
 * with the last one only. English finds went from 8,811 a day to 46, Japanese from 0 to 5,335, the
 * source's total hardly moved and nothing failed, so no alarm we had could see it. A count per
 * language, against the same hours of the day before, is the one reading that does.
 *
 * ★ REPLAYED, NOT REMEMBERED. Each pass replays the rule over `lookbackMs` of buckets, one step
 * every `everyMs`, from "nothing down". So the state — which languages are down, and since when —
 * is a function of the stored finds, the same after a restart as before it, and the drop's first
 * step names it (the deliverer's claim drops a second push of the same drop). The caller pushes a
 * change only when it is within `announceWithinMs` of now: the replay's own first steps can "see" a
 * drop that began before the lookback as if it were new, and those are always old.
 *
 * ★ HYSTERESIS. Down below (1 − `dropShare`) of the baseline; back only at `recoverShare` of the
 * window it dropped FROM, not of today's baseline: after a day down, the day before is the broken
 * day, and against it a broken language would look recovered.
 *
 * ★ A WHOLE SOURCE DOWN IS ONE CHANGE, NOT ONE PER LANGUAGE. Every language together is replayed
 * too (`lang` null). A language that goes down while the whole source is down is marked `inWhole`,
 * and the caller says the source once instead of each of its languages: on 15 and 18 Oct the
 * short-video source's finds fell in every language at once, and per language that was English and
 * Spanish said separately about one outage. A language falling while the source's total holds (the
 * 16 Oct bug: English down, Japanese up) is never in a whole drop, so it is always said.
 *
 * ★ TOO FEW TO SAY IS NOT A DROP. A baseline under `minBaselineFinds` (a small language's night, a
 * language added today) never takes a language down; the honest answer there is that we cannot
 * tell, and saying nothing is how this rule says it.
 *
 * What breaks if changed carelessly: a bucket that straddles a window's edge is counted whole, so
 * the caller must align buckets to `everyMs` (the runner buckets by it); taking the baseline from
 * the current day's figures instead of the drop's own lets a dead language recover by itself a day
 * later.
 */

import type { LanguageDropPolicy } from '@insidor/contracts/policy.ts';

/** Finds of one language in one bucket, `atMs` its start. */
export interface LanguageFinds {
  readonly lang: string;
  readonly atMs: number;
  readonly finds: number;
}

export interface LanguageDropChange {
  /** The language, or null for every language of the source together. */
  readonly lang: string | null;
  readonly state: 'down' | 'back';
  /** The step it changed at. */
  readonly atMs: number;
  /** The step the drop began at: the drop's name, the same on its "back". */
  readonly sinceMs: number;
  /** Finds in the last window at the change. */
  readonly finds: number;
  /** The window a day before, at the drop: what it fell from. */
  readonly baselineFinds: number;
  /** A language's drop that began while the whole source was down (always false for the whole). */
  readonly inWhole: boolean;
}

export interface LanguageNow {
  /** The language, or null for every language together. */
  readonly lang: string | null;
  readonly finds: number;
  readonly baselineFinds: number;
  /** When it went down, if it is down now. */
  readonly downSinceMs: number | null;
  /** Down now, in a drop that began inside a whole-source drop (so it was not said on its own). */
  readonly inWhole: boolean;
}

export interface LanguageDropReplay {
  readonly changes: readonly LanguageDropChange[];
  /** Every language seen, at the last step. */
  readonly now: readonly LanguageNow[];
}

/** Whether a window fell by more than the policy's share from a baseline big enough to say. */
export function dropped(finds: number, baselineFinds: number, p: LanguageDropPolicy): boolean {
  /* Said as the fall, not as a share left: (1 − 0.7) × 100 is 30.000000000000004 in floating point. */
  return baselineFinds >= p.minBaselineFinds && baselineFinds - finds > p.dropShare * baselineFinds;
}

/** Whether a language that dropped from `fromFinds` is back. */
export function recovered(finds: number, fromFinds: number, p: LanguageDropPolicy): boolean {
  return finds >= p.recoverShare * fromFinds;
}

/**
 * The rule stepped every `everyMs` from `fromMs` to `toMs` (both steps), each step comparing
 * [t − windowMs, t) with the same window `baselineAgoMs` earlier. `buckets` must reach back to
 * `fromMs − windowMs − baselineAgoMs`.
 */
export function replayLanguageDrops(buckets: readonly LanguageFinds[], fromMs: number, toMs: number, p: LanguageDropPolicy): LanguageDropReplay {
  const byLang = new Map<string, LanguageFinds[]>();
  for (const b of buckets) {
    const list = byLang.get(b.lang);
    if (list === undefined) byLang.set(b.lang, [b]);
    else list.push(b);
  }
  const whole = replayOne(null, buckets, fromMs, toMs, p, null);
  const changes: LanguageDropChange[] = [...whole.changes];
  const now: LanguageNow[] = [whole.now];
  for (const [lang, list] of [...byLang].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const one = replayOne(lang, list, fromMs, toMs, p, whole.downAt);
    changes.push(...one.changes);
    now.push(one.now);
  }
  return { changes, now };
}

/** One series stepped through: its changes, where it ended, and the steps it was down at. */
function replayOne(lang: string | null, list: readonly LanguageFinds[], fromMs: number, toMs: number, p: LanguageDropPolicy, wholeDownAt: ReadonlySet<number> | null) {
  const sum = (from: number, to: number): number => list.reduce((n, b) => (b.atMs >= from && b.atMs < to ? n + b.finds : n), 0);
  const changes: LanguageDropChange[] = [];
  const downAt = new Set<number>();
  let down: { sinceMs: number; fromFinds: number; inWhole: boolean } | null = null;
  let finds = 0;
  let baselineFinds = 0;
  for (let t = fromMs; t <= toMs; t += p.everyMs) {
    finds = sum(t - p.windowMs, t);
    baselineFinds = sum(t - p.windowMs - p.baselineAgoMs, t - p.baselineAgoMs);
    if (down === null) {
      if (!dropped(finds, baselineFinds, p)) continue;
      down = { sinceMs: t, fromFinds: baselineFinds, inWhole: wholeDownAt?.has(t) ?? false };
      changes.push({ lang, state: 'down', atMs: t, sinceMs: t, finds, baselineFinds, inWhole: down.inWhole });
    } else if (recovered(finds, down.fromFinds, p)) {
      changes.push({ lang, state: 'back', atMs: t, sinceMs: down.sinceMs, finds, baselineFinds: down.fromFinds, inWhole: down.inWhole });
      down = null;
    }
    if (down !== null) downAt.add(t);
  }
  const now: LanguageNow = { lang, finds, baselineFinds: down?.fromFinds ?? baselineFinds, downSinceMs: down?.sinceMs ?? null, inWhole: down?.inWhole ?? false };
  return { changes, now, downAt };
}
