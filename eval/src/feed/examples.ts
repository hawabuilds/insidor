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
 * all go in: the gold set is the test for "yes".
 *
 * ★ THE OWNER'S NEWEST CALL WINS. A post tapped "not" after the labels file said "meme" is a "not";
 * a missed post the owner later tapped "not" is a "not". One post, one call, one place in the block.
 *
 * ★ BALANCED, NEWEST FIRST, CAPPED. Each side gets half the room; room a short side leaves goes to
 * the other, so twelve memes do not throw away a hundred careful "no"s. Within a side, newest first.
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
  return {
    text: lines.join('\n'),
    exampleIds: inBlock.map((p) => p.itemId),
    testNegatives: current.filter((c) => c.label === 'not' && !isExample(c.itemId)),
    testMissed: current.filter((c) => c.label === 'meme' && isMissed(c) && !isExample(c.itemId)),
    used: {
      taps: inBlock.filter((p) => p.from === 'tap').length,
      missed: inBlock.filter(isMissed).length,
      labels: inBlock.filter((p) => p.from === 'labels').length,
      names: nameCalls.length,
    },
  };
}

/** Passed of tested, for one group. `tested` 0 means nobody could tell. */
export interface Rate {
  readonly passed: number;
  readonly tested: number;
}
export const share = (r: Rate): number | null => (r.tested === 0 ? null : r.passed / r.tested);

/**
 * May this block replace the one in use? Every gate must hold. Gold and the live non-memes must
 * have been tested; with no missed posts held out, "most missed posts pass" cannot be asked and
 * does not block — it is recorded as untested, never as zero.
 */
export function gate(r: { readonly gold: Rate; readonly negatives: Rate; readonly missed: Rate }, L: LearningPolicy): { readonly apply: boolean; readonly why: string | null } {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const fails: string[] = [];
  const gold = share(r.gold);
  const neg = share(r.negatives);
  const missed = share(r.missed);
  if (gold === null) fails.push('no gold post could be tested');
  else if (gold < L.minGoldPass) fails.push(`gold ${r.gold.passed}/${r.gold.tested} is under ${pct(L.minGoldPass)}`);
  if (neg === null) fails.push('no live non-meme could be tested');
  else if (neg > L.maxLiveNegativePass) fails.push(`live non-memes ${r.negatives.passed}/${r.negatives.tested} is over ${pct(L.maxLiveNegativePass)}`);
  if (missed !== null && missed < L.minMissedPass) fails.push(`missed posts ${r.missed.passed}/${r.missed.tested} is under ${pct(L.minMissedPass)}`);
  return { apply: fails.length === 0, why: fails.length === 0 ? null : fails.join('; ') };
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
