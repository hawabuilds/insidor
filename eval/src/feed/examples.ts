/**
 * THE JUDGE'S LEARNED EXAMPLES, AS A PURE FUNCTION OF THE OWNER'S CALLS: which posts go in the block
 * the feed's post judge reads after its rules, which are held back to test it, what the block
 * says, and whether a tested block may replace the one in use.
 *
 * Shared by tools/judge-examples.ts (the labels file alone, by hand) and tools/retune.ts (twice a
 * day, from the labels file, the owner's taps, missed posts and name calls), so the hand-built
 * block and the scheduled one split posts the same way and are graded the same way.
 *
 * ★ A FIXED HALF IS HELD BACK, BY THE POST ID ALONE. Each non-meme and each missed post is put in
 * the examples or in the test by a hash of its id, so a test is always made of posts the judge was
 * never shown; a test made of the examples would grade nothing. Memes the owner tapped or labelled
 * may all go in. And nothing is dropped: a call the cap leaves out of the block is tested instead
 * (non-memes with the live non-memes, memes with gold), so every tap is used every run.
 *
 * ★ THE OWNER'S NEWEST CALL WINS. A post tapped "not" after the labels file said "meme" is a "not";
 * a missed post the owner later tapped "not" is a "not". One post, one call, one place in the block.
 *
 * ★ BALANCED, NEWEST FIRST, CAPPED. Each side gets half the room; room a short side leaves goes to
 * the other, so twelve memes do not throw away a hundred careful "no"s. Within a side, newest first.
 *
 * ★ ONE GATE AND A REGRESSION RULE, BOTH HERE AND PURE (the owner's decision, 2026-10-13). For
 * You is one feed for anything people could coin — memes, news, tragedies — so hand gold is one
 * set held to one bar beside the live non-memes. And a block that makes a missed post the judge
 * in use catches fail is never applied, whatever its rates.
 *
 * `latestSlot` is here too: which 08:00 or 20:00 London (Policy.learning) a run belongs to, pure so
 * the clock change is tested rather than found out in October.
 *
 * What breaks if changed carelessly: `isExample` must stay a pure function of the id. Anything else
 * (order, a draw, the date) moves posts between examples and test from one run to the next, and a
 * run would then be graded on posts an earlier block taught.
 */

import { createHash } from 'node:crypto';

import type { LearningPolicy } from '@insidor/contracts/policy.ts';
import { heldKind, type CryptoSignal } from '@insidor/core';

/** Examples or test, by the post id alone. */
export const isExample = (itemId: string): boolean => (createHash('sha256').update(itemId).digest()[0] ?? 0) % 2 === 0;

export type CallSource = 'tap' | 'missed' | 'labels';

/** One post with the owner's call on it. `at` is when the call (or, failing that, the post) was made. */
export interface OwnerCall {
  readonly itemId: string;
  readonly text: string;
  readonly imageUri: string | null;
  readonly label: 'meme' | 'not';
  readonly why: string;
  readonly at: number | null;
  readonly from: CallSource;
}

/** The owner's thumbs on a name the judge suggested for a post, or the owner's own better name. */
export interface NameCall {
  readonly itemId: string;
  readonly text: string;
  readonly name: string;
  readonly verdict: 'up' | 'down';
  readonly betterName: string | null;
  readonly at: number | null;
}

export interface Block {
  readonly text: string;
  readonly exampleIds: readonly string[];
  /** Held back to test the block: non-memes and missed posts, by `isExample`. */
  readonly testNegatives: readonly OwnerCall[];
  readonly testMissed: readonly OwnerCall[];
  /** The owner's own "meme" calls (taps, the labels file) the cap left out of the block: tested as gold. */
  readonly testMemes: readonly OwnerCall[];
  /** The owner's taps, counted: in the block, or in the test. Every tap is one or the other. */
  readonly taps: { readonly taught: number; readonly tested: number };
  /** What it learned from, counted in the block. */
  readonly used: { readonly taps: number; readonly missed: number; readonly labels: number; readonly names: number };
}

const SOURCE_RANK: Readonly<Record<CallSource, number>> = { tap: 3, missed: 2, labels: 1 };
const EXCERPT = 140;
const excerpt = (t: string): string => t.replace(/https:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT);
const newestFirst = (a: { at: number | null; itemId: string }, b: { at: number | null; itemId: string }): number =>
  (b.at ?? -Infinity) - (a.at ?? -Infinity) || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);

/** One call per post: a tap beats a missed post beats the labels file; within a source, the newest. */
export function currentCalls(calls: readonly OwnerCall[]): readonly OwnerCall[] {
  const best = new Map<string, OwnerCall>();
  for (const c of calls) {
    const had = best.get(c.itemId);
    const wins = had === undefined || SOURCE_RANK[c.from] > SOURCE_RANK[had.from] || (SOURCE_RANK[c.from] === SOURCE_RANK[had.from] && (c.at ?? -Infinity) > (had.at ?? -Infinity));
    if (wins) best.set(c.itemId, c);
  }
  return [...best.values()];
}

export function buildBlock(calls: readonly OwnerCall[], names: readonly NameCall[], maxExamples: number): Block {
  const current = currentCalls(calls);
  const isMissed = (c: OwnerCall) => c.from === 'missed';
  const yesPool = current.filter((c) => c.label === 'meme' && (!isMissed(c) || isExample(c.itemId))).sort(newestFirst);
  const noPool = current.filter((c) => c.label === 'not' && isExample(c.itemId)).sort(newestFirst);
  const half = Math.floor(maxExamples / 2);
  const yesTake = Math.min(yesPool.length, Math.max(half, maxExamples - noPool.length));
  const noTake = Math.min(noPool.length, maxExamples - yesTake);
  const yes = yesPool.slice(0, yesTake);
  const no = noPool.slice(0, noTake);
  const nameCalls = [...names].sort(newestFirst).slice(0, half);

  const line = (p: OwnerCall) => `  "${excerpt(p.text)}"${p.imageUri === null ? '' : ' [picture]'} — ${p.why}`;
  const nameLine = (n: NameCall) =>
    n.betterName !== null
      ? `  "${excerpt(n.text)}" — not "${n.name}"; the owner's name: "${n.betterName}"`
      : `  "${excerpt(n.text)}" — "${n.name}" is ${n.verdict === 'up' ? 'a good name' : 'a poor name'}`;
  const lines = [
    "THE OWNER'S OWN CALLS ON REAL POSTS FROM THE FEED",
    'Learn where the line is from these. [picture] means the post carried one.',
    '',
    'YES — people could coin this:',
    ...yes.map(line),
    '',
    'NO — nothing to coin, though it may look busy:',
    ...no.map(line),
    ...(nameCalls.length === 0 ? [] : ['', 'NAMES — the owner\'s calls on names suggested for posts; name the way the owner does:', ...nameCalls.map(nameLine)]),
  ];
  const inBlock = [...yes, ...no];
  const taught = new Set(inBlock.map((p) => p.itemId));
  return {
    text: lines.join('\n'),
    exampleIds: inBlock.map((p) => p.itemId),
    /* ★ NO CALL IS DROPPED. A call on the taught side of the split that the cap left out goes to
       the test, so every label the owner taps is used each run: as an example, or tested. */
    testNegatives: current.filter((c) => c.label === 'not' && !taught.has(c.itemId)),
    testMissed: current.filter((c) => c.label === 'meme' && isMissed(c) && !taught.has(c.itemId)),
    testMemes: current.filter((c) => c.label === 'meme' && !isMissed(c) && !taught.has(c.itemId)),
    taps: { taught: inBlock.filter((p) => p.from === 'tap').length, tested: current.filter((c) => c.from === 'tap' && !taught.has(c.itemId)).length },
    used: {
      taps: inBlock.filter((p) => p.from === 'tap').length,
      missed: inBlock.filter(isMissed).length,
      labels: inBlock.filter((p) => p.from === 'labels').length,
      names: nameCalls.length,
    },
  };
}

/* ── whether a graded post reaches the feed ─────────────────────────────────────────────────────── */

/** One post as the test graded it: the first question's answer and the kind question's label. */
export interface GradedPost {
  readonly id: string;
  readonly group: string;
  /** null: the judge did not answer — out of every rate. */
  readonly coinable: boolean | null;
  /** The first question passed (core's postScore, picture boost included). */
  readonly firstPass: boolean;
  /** The kind label, upper case; null when it was never asked or not answered. */
  readonly kind: string | null;
  /** Other accounts' crypto talk under it and whether it is a shill; null or absent: no facts (the judge alone decides). */
  readonly signal?: CryptoSignal | null;
}

/**
 * On For You, by core's rule (`passesWithSignal`): never a shill; otherwise the kind it got is
 * not one policy holds (`held` is Policy.judge.heldKinds, or a set being measured) and either
 * the first question passed or other accounts' crypto signal is present. Mirrors core rather than
 * calling it because a graded row carries the first answer already decided (with its picture
 * boost); the core test and this one hold the same cases.
 */
export const inFeed = (r: GradedPost, held: readonly string[]): boolean =>
  r.signal?.shill !== true && heldKind(r.kind, held) === null && (r.firstPass || r.signal?.others === true);
/** Caught: on For You; null when unanswered. */
export const caught = (r: GradedPost, held: readonly string[]): boolean | null => (r.coinable === null ? null : inFeed(r, held));

/**
 * The rates the gate reads, from one grading under one held set. `hand` names the groups that make
 * hand gold (the gold sheets, the owner's missed posts, the owner's hand-gold list); `auto` the
 * unapproved recall additions, reported only. An unanswered post is out of every rate.
 */
export function ratesOf(rows: readonly GradedPost[], held: readonly string[], groups: { readonly hand: readonly string[]; readonly auto: string; readonly negatives: string; readonly missed: string }) {
  const answered = rows.filter((r) => r.coinable !== null);
  const rate = (g: (r: GradedPost) => boolean): Rate => {
    const of = answered.filter(g);
    return { passed: of.filter((r) => inFeed(r, held)).length, tested: of.length };
  };
  return {
    hand: rate((r) => groups.hand.includes(r.group)),
    auto: rate((r) => r.group === groups.auto),
    negatives: rate((r) => r.group === groups.negatives),
    missed: rate((r) => r.group === groups.missed),
  };
}

/** Passed of tested, for one group. `tested` 0 means nobody could tell. */
export interface Rate {
  readonly passed: number;
  readonly tested: number;
}
export const share = (r: Rate): number | null => (r.tested === 0 ? null : r.passed / r.tested);

/** What a block is held to: the one gate, the held-out missed posts, and the regression list. */
export interface GateInput {
  /** Hand gold: memes, news and the rest alike, shown on For You. */
  readonly hand: Rate;
  readonly negatives: Rate;
  readonly missed: Rate;
  /** Missed posts the judge in use catches that this block does not: any one blocks it. */
  readonly regressions: readonly string[];
  /** The setup live now, graded on the same posts in the same run; null when it was not. */
  readonly live?: { readonly hand: Rate; readonly negatives: Rate; readonly missed: Rate } | null;
}

/**
 * May this block replace the one in use? Every rule must hold.
 *
 *   gate       hand gold passes at least minGoldPass AND live non-memes pass at most
 *              maxLiveNegativePass. Both must have been tested: a block is never applied on a
 *              test nobody ran.
 *   missed     the held-out missed posts pass at least minMissedPass; untested does not block —
 *              recorded as untested, never as zero.
 *   no regress ★ the owner's rule: no block is ever applied that makes a missed post the judge in
 *              use catches fail. One is enough.
 *   not worse  ★ and none that is worse than the setup live now on hand gold, non-memes or
 *              missed posts, graded on the same posts in the same run.
 */
export function gate(r: GateInput, L: LearningPolicy): { readonly apply: boolean; readonly why: string | null } {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const fails: string[] = [];
  const hand = share(r.hand);
  const neg = share(r.negatives);
  const missed = share(r.missed);
  if (hand === null) fails.push('no hand gold post could be tested');
  else if (hand < L.minGoldPass) fails.push(`hand gold ${r.hand.passed}/${r.hand.tested} is under ${pct(L.minGoldPass)}`);
  if (neg === null) fails.push('no live non-meme could be tested');
  else if (neg > L.maxLiveNegativePass) fails.push(`live non-memes ${r.negatives.passed}/${r.negatives.tested} is over ${pct(L.maxLiveNegativePass)}`);
  if (missed !== null && missed < L.minMissedPass) fails.push(`missed posts ${r.missed.passed}/${r.missed.tested} is under ${pct(L.minMissedPass)}`);
  /* ★ NEVER WORSE THAN THE SETUP LIVE NOW, on each of the three, measured on the same posts. */
  const live = r.live ?? null;
  if (live !== null) {
    const worse = (name: string, now: Rate, next: Rate, higherIsBetter: boolean) => {
      const a = share(now);
      const b = share(next);
      if (a !== null && b !== null && (higherIsBetter ? b < a : b > a)) fails.push(`${name} ${next.passed}/${next.tested} is worse than live's ${now.passed}/${now.tested}`);
    };
    worse('hand gold', live.hand, r.hand, true);
    worse('live non-memes', live.negatives, r.negatives, false);
    worse('missed posts', live.missed, r.missed, true);
  }
  if (r.regressions.length > 0) fails.push(`${r.regressions.length} missed post${r.regressions.length === 1 ? '' : 's'} caught now would fail: ${r.regressions.join(', ')}`);
  return { apply: fails.length === 0, why: fails.length === 0 ? null : fails.join('; ') };
}

/**
 * The missed posts that would regress: caught (`ok`) under the judge in use, not under the new
 * block. A post either side did not answer is not a regression — an outage is not a verdict, and
 * the run already refuses to apply a block whose test went unanswered.
 */
export function regressions(current: ReadonlyMap<string, boolean | null>, next: ReadonlyMap<string, boolean | null>): readonly string[] {
  return [...current].filter(([id, ok]) => ok === true && next.get(id) === false).map(([id]) => id).sort();
}

/** Examples added to and removed from the block in use. */
export function changed(before: readonly string[], after: readonly string[]): { readonly added: number; readonly removed: number } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: after.filter((id) => !b.has(id)).length, removed: before.filter((id) => !a.has(id)).length };
}

/* ── when the re-tune is due ──────────────────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000;
const localParts = (utcMs: number, timeZone: string): Readonly<Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>> => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: g('year'), month: g('month'), day: g('day'), hour: g('hour'), minute: g('minute'), second: g('second') };
};
/** The zone's offset from UTC at an instant, in ms. */
const offsetAt = (utcMs: number, timeZone: string): number => {
  const p = localParts(utcMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
};
/** A wall-clock time in the zone as an instant; across a clock change, the offset after it. */
const wallToUtc = (y: number, m: number, d: number, hh: number, mm: number, timeZone: string): number => {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetAt(guess, timeZone);
  const second = offsetAt(guess - first, timeZone);
  return guess - second;
};

/**
 * The latest scheduled re-tune at or before `nowMs`: each "HH:MM" of `times` in `timeZone`, today
 * or yesterday there. The slot is the run's identity — one run per slot, however often asked.
 */
export function latestSlot(nowMs: number, times: readonly string[], timeZone: string): number {
  const today = localParts(nowMs, timeZone);
  const slots: number[] = [];
  for (const back of [0, 1]) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day) - back * MS_PER_DAY);
    for (const t of times) {
      const [hh, mm] = t.split(':').map(Number);
      slots.push(wallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh ?? 0, mm ?? 0, timeZone));
    }
  }
  return Math.max(...slots.filter((s) => s <= nowMs));
}
