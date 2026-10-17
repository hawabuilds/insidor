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
 * ★ BEAT LIVE, AND CATCH NO FEWER MISSED POSTS (the owner's rule, 2026-10-13; the missed part
 * changed 2026-10-16). For You is one feed for anything people could coin, so hand gold is one set.
 * A block is applied when it beats the setup live now on hand gold and on live non-memes, graded
 * together in one run, and catches no fewer held-out missed posts overall. One missed post live
 * catches and the new block does not used to refuse it alone; it kept version 9 out while that
 * block caught 10 of 16 missed posts to live's 7. Such a post is now named, not a refusal. The
 * 65% / 15% / 50% bars are the goal, reported, not a block.
 *
 * ★ AND BEFORE REFUSING, THE NEW BLOCK'S CUTOFF (the owner, 2026-10-16). `sweepCutoff` raises the
 * new block's yes/no cutoff on the answers already collected: rule A, the strictest cutoff with
 * hand gold and missed caught no worse than live and fewer live non-memes; rule B, the fewest
 * live non-memes no worse than live with more hand gold and missed caught no worse; else refused.
 * Raising only removes passes, so the strictest rule-A cutoff is the one that keeps the least
 * junk: on version 9's numbers it is 0.75 (gold 67, junk 88, missed 9), not 0.71.
 *
 * `latestSlot` is here too: which 08:00 or 20:00 London (Policy.learning) a run belongs to, pure so
 * the clock change is tested rather than found out in October.
 *
 * ★ A POST THE OWNER NAMES IS ALWAYS TAUGHT (Policy.learning.alwaysTeach, the owner 2026-10-16:
 * "add x:2109756994147983482 as a yes example so it learns it back"). An id on that list is on the
 * taught side whatever its hash says, and goes in the block ahead of the newest-first order, so it
 * is in every block the cap allows. The price: it is never tested again. A missed post on the list
 * leaves the held-out missed set for good, so the missed rate is out of one post fewer and nothing
 * measures whether the judge now catches it; it is graded only as `missed-taught`, for the record.
 *
 * ★ POSTS PEOPLE COINED ARE TAUGHT AS YES TOO (Policy.learning.coinedYes, the owner 2026-10-16:
 * "teach the re-tune with coined news and tragedy posts as yes examples"). `coinedYes` picks posts
 * several coins were launched for ten minutes or more after posting that the judge answered "no";
 * they get their own YES section, take their room in the block first, and are never tested. It
 * leaves out anything that would argue with the owner, the gate's test, the shill rule or the
 * held kinds (see the function). Tragedy is not a held kind, so a coined tragedy is taught.
 *
 * ★ THE OWNER'S FIXED TEST SET IS NEVER TAUGHT (the owner, 2026-10-17). An id on `alwaysTest`
 * (owner-split.json `test`) is on the test side whatever its hash or the teach list says, and is
 * never in the block from any source; `neverTeach` does the same for one run's own hold-outs.
 *
 * What breaks if changed carelessly: `isExample` must stay a pure function of the id (and the
 * always-teach and always-test lists, which change only with a commit). Anything else (order, a
 * draw, the date) moves posts between examples and test from one run to the next, and a run would
 * then be graded on posts an earlier block taught.
 */

import { createHash } from 'node:crypto';

import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { LearningPolicy, Policy } from '@insidor/contracts/policy.ts';
import { heldKind, isShillText, postScore, withJudgeCutoff, type CryptoSignal } from '@insidor/core';

/**
 * Examples or test, by the post id alone; an id on `alwaysTeach` (Policy.learning.alwaysTeach and the
 * owner's split, owner-split.ts) is always an example, and an id on `alwaysTest` (the owner's fixed
 * test set) never is — the test wins, so a post put on both is tested rather than graded on its lesson.
 */
export const isExample = (itemId: string, alwaysTeach: readonly string[] = [], alwaysTest: readonly string[] = []): boolean =>
  !alwaysTest.includes(itemId) && (alwaysTeach.includes(itemId) || (createHash('sha256').update(itemId).digest()[0] ?? 0) % 2 === 0);

/**
 * What a block is told beyond the owner's calls: the ids always taught, the ids never taught, and
 * coined posts (`coinedYes`) taught as yes. `alwaysTest` is the owner's fixed test set (a pure list);
 * `neverTeach` is this run's own hold-outs (the owner's gate's recent news and text-only "Not a meme"
 * taps). Neither is ever in the block, from any source: a tap, a label, a missed post or a coined post.
 */
export interface Teach {
  readonly alwaysTeach?: readonly string[];
  readonly alwaysTest?: readonly string[];
  readonly neverTeach?: readonly string[];
  readonly coinedYes?: readonly OwnerCall[];
}

/** `coined`: not the owner's call — a post several coins were launched for (`coinedYes`). */
export type CallSource = 'tap' | 'missed' | 'labels' | 'coined';

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
  readonly used: { readonly taps: number; readonly missed: number; readonly labels: number; readonly names: number; readonly coined: number };
}

const SOURCE_RANK: Readonly<Record<CallSource, number>> = { tap: 3, missed: 2, labels: 1, coined: 0 };
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

export function buildBlock(calls: readonly OwnerCall[], names: readonly NameCall[], maxExamples: number, teach: Teach = {}): Block {
  const current = currentCalls(calls);
  const always = teach.alwaysTeach ?? [];
  const tested = teach.alwaysTest ?? [];
  const kept = new Set([...tested, ...(teach.neverTeach ?? [])]);
  const teachable = (c: OwnerCall) => !kept.has(c.itemId);
  /* Coined posts take their room first (the caller capped them); a post the owner called is never one. */
  const called = new Set(current.map((c) => c.itemId));
  const coined = (teach.coinedYes ?? []).filter((c) => !called.has(c.itemId) && teachable(c)).slice(0, maxExamples);
  const room = maxExamples - coined.length;
  const isMissed = (c: OwnerCall) => c.from === 'missed';
  /* The owner's always-taught posts first, so the cap never pushes them out; then newest first. */
  const order = (a: OwnerCall, b: OwnerCall) => Number(always.includes(b.itemId)) - Number(always.includes(a.itemId)) || newestFirst(a, b);
  const yesPool = current.filter((c) => c.label === 'meme' && teachable(c) && (!isMissed(c) || isExample(c.itemId, always, tested))).sort(order);
  const noPool = current.filter((c) => c.label === 'not' && teachable(c) && isExample(c.itemId, always, tested)).sort(order);
  const half = Math.floor(room / 2);
  const yesTake = Math.min(yesPool.length, Math.max(half, room - noPool.length));
  const noTake = Math.min(noPool.length, room - yesTake);
  const yes = yesPool.slice(0, yesTake);
  const no = noPool.slice(0, noTake);
  const nameCalls = [...names].sort(newestFirst).slice(0, Math.floor(maxExamples / 2));

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
    ...(coined.length === 0 ? [] : ['', 'YES — not the owner\'s calls: posts several people coined, ten minutes or more after they were posted, that the judge had answered no. News and tragedies people coin are yes:', ...coined.map(line)]),
    '',
    'NO — nothing to coin, though it may look busy:',
    ...no.map(line),
    ...(nameCalls.length === 0 ? [] : ['', 'NAMES — the owner\'s calls on names suggested for posts; name the way the owner does:', ...nameCalls.map(nameLine)]),
  ];
  const inBlock = [...yes, ...coined, ...no];
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
      coined: coined.length,
    },
  };
}

/**
 * The block with the owner's rulebook after its examples, under `heading` (tools/lib/rulebook.ts).
 * Inside the block's text on purpose: it is versioned, applied and tested with the block, and the
 * runner sends it to the judge with no change of its own. Nothing else moves: the same examples,
 * the same posts held out.
 */
export function withRulebook(block: Block, heading: string, rules: string | null): Block {
  return rules === null || rules.trim() === '' ? block : { ...block, text: `${block.text}\n\n${heading}\n${rules.trim()}` };
}

/* ── coined posts, taught as yes ──────────────────────────────────────────────────────────────── */

/** A post several coins were launched for well after it, that the judge answered "no" (store `coinedPosts`). */
export interface CoinedPost {
  readonly itemId: string;
  readonly text: string;
  readonly imageUri: string | null;
  readonly postedAt: number;
  readonly coins: number;
  readonly firstLateAt: number;
  /** The newest kind answer; null when never asked. */
  readonly kind: string | null;
}

const MS_PER_MIN = 60_000;
const wordsOf = (t: string): readonly string[] => t.replace(/https?:\/\/\S+/g, ' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

/**
 * Which coined posts the block teaches as "yes" (Policy.learning.coinedYes), newest first, at
 * most `maxPerBlock`. Never one that would argue with a rule the feed keeps or with the gate:
 *   · `exclude` — the owner's calls and every post the run tests as hand gold: the owner's call
 *     wins, and a hand-gold post taught would leave the gate's test;
 *   · a post whose own words talk crypto (the shill rule, or a coin or crypto-account word): its
 *     coins are about the coin talk, not the world, and a shill never passes anyway;
 *   · a reply (it opens with an @): a coin on a reply is about its thread, not its words;
 *   · a kind `held` holds: the kind question would hold it again, and a yes example would teach
 *     the first question the opposite of the second. A tragedy is not held (the owner, 2026-10-16),
 *     so a coined tragedy is taught. A kind never asked (the usual case after a "no") is not held.
 */
export function coinedYes(posts: readonly CoinedPost[], p: Policy, exclude: ReadonlySet<string>): readonly OwnerCall[] {
  const C = p.learning.coinedYes;
  if (!C.on) return [];
  const crypto = new Set([...p.attention.coinWords, ...p.attention.cryptoAccountWords].map((w) => w.toLowerCase()));
  return posts
    .filter((c) => c.coins >= C.minCoins && c.firstLateAt - c.postedAt >= C.lateMs)
    .filter((c) => !exclude.has(c.itemId) && !c.text.trimStart().startsWith('@'))
    .filter((c) => !isShillText(c.text, p.attention) && !wordsOf(c.text).some((w) => crypto.has(w)))
    .filter((c) => heldKind(c.kind, p.judge.heldKinds) === null)
    .sort((a, b) => b.postedAt - a.postedAt || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
    .slice(0, C.maxPerBlock)
    .map((c) => ({
      itemId: c.itemId, text: c.text, imageUri: c.imageUri, label: 'meme' as const, at: c.postedAt, from: 'coined' as const,
      why: `${c.coins} coins launched for it, the first ${Math.round((c.firstLateAt - c.postedAt) / MS_PER_MIN)} minutes after it was posted`,
    }));
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
  /** The first question's answer, so `atCutoff` can decide it again under a raised bar; absent: kept as graded. */
  readonly answer?: Pick<Judgement, 'coinable' | 'confidence' | 'lookedAt' | 'proposedName'> | null;
  /** The picture's closeness to a coined post's, for the boost under a raised bar. */
  readonly similarity?: number | null;
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
  /** Missed posts the judge in use catches that this block does not: named, never a block by itself (the count is). */
  readonly regressions: readonly string[];
  /** The setup live now, graded on the same posts in the same run; null when it was not. */
  readonly live?: { readonly hand: Rate; readonly negatives: Rate; readonly missed: Rate } | null;
}

/** Whether a run met the owner's goals (Policy.learning). Reported; no longer a bar to applying. */
export interface Goals {
  readonly hand: boolean | null;
  readonly negatives: boolean | null;
  readonly missed: boolean | null;
}

/**
 * May this block replace the one in use? The owner's rule (2026-10-13): apply a version that BEATS
 * the setup live now — more hand gold AND fewer live non-memes, on the same test posts graded in the
 * same run — and catches no fewer of the held-out missed posts than live (the owner, 2026-10-16:
 * counted overall, no longer one lost post blocking it). The 65% / 15% / 50% bars stay as the goal
 * and are reported met or not met, but they no longer block an improvement.
 *
 * ★ "BEATS" IS STRICT, AND THAT IS THE WHOLE NOISE RULE. Both sides are graded in the same run at
 * temperature 0, on the same posts in the same calls, so a tie is no evidence of a change and is
 * not applied; one post better on each side is. Compared as shares, so a post one side left
 * unanswered does not tip it (and any unanswered post keeps the block out anyway).
 *
 * With no live grading to compare (`live` null: the measure-only paths) nothing can be beaten and
 * nothing is applied.
 */
export function gate(r: GateInput, L: LearningPolicy): { readonly apply: boolean; readonly why: string | null; readonly goals: Goals } {
  const fails: string[] = [];
  const hand = share(r.hand);
  const neg = share(r.negatives);
  const missed = share(r.missed);
  const goals: Goals = {
    hand: hand === null ? null : hand >= L.minGoldPass,
    negatives: neg === null ? null : neg <= L.maxLiveNegativePass,
    missed: missed === null ? null : missed >= L.minMissedPass,
  };
  if (hand === null) fails.push('no hand gold post could be tested');
  if (neg === null) fails.push('no live non-meme could be tested');
  const live = r.live ?? null;
  if (live === null) fails.push('no live setup was graded to compare with');
  else if (hand !== null && neg !== null) {
    const liveHand = share(live.hand);
    const liveNeg = share(live.negatives);
    if (liveHand !== null && !(hand > liveHand)) fails.push(`hand gold ${r.hand.passed}/${r.hand.tested} does not beat live's ${live.hand.passed}/${live.hand.tested}`);
    if (liveNeg !== null && !(neg < liveNeg)) fails.push(`live non-memes ${r.negatives.passed}/${r.negatives.tested} are not fewer than live's ${live.negatives.passed}/${live.negatives.tested}`);
  }
  if (live !== null && missed !== null) {
    const liveMissed = share(live.missed);
    if (liveMissed !== null && missed < liveMissed) fails.push(`missed posts caught ${r.missed.passed}/${r.missed.tested} are fewer than live's ${live.missed.passed}/${live.missed.tested}`);
  }
  return { apply: fails.length === 0, why: fails.length === 0 ? null : fails.join('; '), goals };
}

/** The goals as one line: "hand gold 61% (goal 65%, not met); …". */
export function goalsText(r: Pick<GateInput, 'hand' | 'negatives' | 'missed'>, L: LearningPolicy): string {
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const g = gate({ ...r, regressions: [], live: null }, L).goals;
  const met = (b: boolean | null) => (b === null ? 'not tested' : b ? 'met' : 'not met');
  return `goal: hand gold ${pct(share(r.hand))} of ${pct(L.minGoldPass)} (${met(g.hand)}), live non-memes ${pct(share(r.negatives))} of at most ${pct(L.maxLiveNegativePass)} (${met(g.negatives)}), missed ${pct(share(r.missed))} of ${pct(L.minMissedPass)} (${met(g.missed)})`;
}

/**
 * The missed posts that would regress: caught (`ok`) under the judge in use, not under the new
 * block. A post either side did not answer is not a regression — an outage is not a verdict, and
 * the run already refuses to apply a block whose test went unanswered.
 */
export function regressions(current: ReadonlyMap<string, boolean | null>, next: ReadonlyMap<string, boolean | null>): readonly string[] {
  return [...current].filter(([id, ok]) => ok === true && next.get(id) === false).map(([id]) => id).sort();
}

/* ── the new block's own cutoff ───────────────────────────────────────────────────────────────── */

/**
 * A grading as it would be with the judge's bar raised to `cutoff` (core `withJudgeCutoff`): the
 * first question decided again from the answer it got. It only ever removes a pass — the kind
 * labels and the close-match hold stay as graded, because live asks and holds them at the policy
 * bar whatever cutoff a block carries. null: as graded.
 */
export function atCutoff(rows: readonly GradedPost[], cutoff: number | null, p: Policy): readonly GradedPost[] {
  if (cutoff === null) return rows;
  const q = withJudgeCutoff(p, cutoff);
  return rows.map((r) => (r.answer === undefined || r.answer === null || !r.firstPass ? r : { ...r, firstPass: postScore(r.answer, q, r.similarity ?? null) === 'passes' }));
}

/** Missed posts (held out and taught) caught or not, in one grading. */
export const missedCaught = (rows: readonly GradedPost[], held: readonly string[]): ReadonlyMap<string, boolean | null> =>
  new Map(rows.filter((r) => r.group === 'missed' || r.group === 'missed-taught').map((r) => [r.id, caught(r, held)] as const));

export interface CutoffPoint {
  readonly cutoff: number;
  readonly hand: Rate;
  readonly negatives: Rate;
  readonly missed: Rate;
  /** Missed posts live catches that the new block does not at this cutoff. */
  readonly lost: readonly string[];
  /** Any further guard the caller holds the block to (the short-video gate); its reason when it fails. */
  readonly extra: string | null;
}

export interface CutoffChoice {
  /** A: less junk, no less gold or missed. B: junk no worse, more gold, no less missed. refused: neither. */
  readonly rule: 'A' | 'B' | 'refused';
  /** The cutoff applied with the block; null when refused. */
  readonly cutoff: number | null;
  /** The point applied (or, refused, the one at the live bar) and every point tried. */
  readonly point: CutoffPoint;
  readonly points: readonly CutoffPoint[];
  readonly why: string | null;
}

export interface SweepInput {
  /** The new block's grading, answered posts only. */
  readonly rows: readonly GradedPost[];
  /** The setup live now, graded on the same posts at its own cutoff. */
  readonly live: { readonly hand: Rate; readonly negatives: Rate; readonly missed: Rate };
  /** Which missed posts live catches, at its own cutoff. */
  readonly liveCaught: ReadonlyMap<string, boolean | null>;
  /** The bar the sweep starts at: live's cutoff, or the policy's lowest bar. */
  readonly from: number;
  readonly held: readonly string[];
  readonly groups: Parameters<typeof ratesOf>[2];
  readonly policy: Policy;
  /** A further guard at each cutoff: null when it holds, else why not. */
  readonly extra?: (rows: readonly GradedPost[]) => string | null;
}

/**
 * The owner's rule, 2026-10-16, as changed the same day ("missed posts caught must not go down
 * overall (gold better, junk no worse)"). From the live bar up to `cutoffMax` in steps of
 * `cutoffStep`, each point graded on the answers already collected, then `chooseCutoff`.
 */
export function sweepCutoff(s: SweepInput): CutoffChoice {
  const L = s.policy.learning;
  const steps = Math.max(0, Math.floor((L.cutoffMax - s.from) / L.cutoffStep + 1e-9));
  const points: CutoffPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const cutoff = Number((s.from + i * L.cutoffStep).toFixed(6));
    const at = atCutoff(s.rows, cutoff, s.policy);
    const r = ratesOf(at, s.held, s.groups);
    points.push({ cutoff, hand: r.hand, negatives: r.negatives, missed: r.missed, lost: regressions(s.liveCaught, missedCaught(at, s.held)), extra: s.extra?.(at) ?? null });
  }
  return chooseCutoff(points, s.live);
}

const ofN = (r: Rate): string => `${r.passed}/${r.tested}`;

/**
 * Which point, if any. Compared as shares, as `gate` compares; a group nobody could test (0 tested
 * on either side) does not decide:
 *   A  the STRICTEST cutoff with hand gold ≥ live, live non-memes < live, missed caught ≥ live;
 *   B  else the one with the fewest live non-memes ≤ live, hand gold > live, missed caught ≥ live
 *      (ties: more gold, then the stricter);
 *   else refused.
 *
 * ★ MISSED POSTS ARE COUNTED, NOT NAMED (the owner, 2026-10-16). The held-out missed posts the new
 * block catches must not be fewer than live catches; one post live catches and the new block does
 * not is no longer a refusal by itself when the new block catches more of them overall. Each such
 * post is still in `lost` and named in the log and the owner's alert. Before this change version
 * 9 (07:00 UTC that day: 10/16 missed against live's 7/16) was refused for one lost post.
 */
export function chooseCutoff(points: readonly CutoffPoint[], live: SweepInput['live']): CutoffChoice {
  const liveHand = share(live.hand);
  const liveNeg = share(live.negatives);
  const liveMissed = share(live.missed);
  const base = points[0]!;
  const missedOk = (p: CutoffPoint) => share(p.missed) === null || liveMissed === null || share(p.missed)! >= liveMissed;
  const ok = (p: CutoffPoint) => p.extra === null && share(p.hand) !== null && share(p.negatives) !== null && liveHand !== null && liveNeg !== null && missedOk(p);
  const a = points.filter((p) => ok(p) && share(p.hand)! >= liveHand! && share(p.negatives)! < liveNeg!);
  const pickA = a[a.length - 1];
  if (pickA !== undefined) return { rule: 'A', cutoff: pickA.cutoff, point: pickA, points, why: null };
  const b = points.filter((p) => ok(p) && share(p.negatives)! <= liveNeg! && share(p.hand)! > liveHand!);
  const pickB = [...b].sort((x, y) => x.negatives.passed - y.negatives.passed || y.hand.passed - x.hand.passed || y.cutoff - x.cutoff)[0];
  if (pickB !== undefined) return { rule: 'B', cutoff: pickB.cutoff, point: pickB, points, why: null };
  const last = points[points.length - 1]!;
  const fails: string[] = [];
  if (!missedOk(base)) fails.push(`missed posts caught ${ofN(base.missed)} are fewer than live's ${ofN(live.missed)} even at the live bar; a stricter cutoff cannot bring back a post the new block answered "no" or held`);
  else fails.push(`no cutoff from ${base.cutoff} to ${last.cutoff} keeps hand gold at live's ${ofN(live.hand)} and missed posts caught at live's ${ofN(live.missed)} with live non-memes at or under live's ${ofN(live.negatives)}`);
  if (base.extra !== null) fails.push(base.extra);
  return { rule: 'refused', cutoff: null, point: base, points, why: fails.join('; ') };
}

/**
 * `--floor=<gold>,<junk>,<missed>` (each `passed/tested`): the numbers the new block must keep, in
 * place of the live grading's, for a switch of judge (the owner, 2026-10-16: tonight's cutoff is
 * the strictest that keeps gold and missed at least at the main judge's level; that judge can no
 * longer be asked, so its stored 07:00 UTC sweep is the floor). Compared as shares, as every rate
 * here is, so a set that has grown since is held to the same share. null: the live grading.
 */
export function parseFloor(text: string | null): { readonly hand: Rate; readonly negatives: Rate; readonly missed: Rate } | null {
  if (text === null) return null;
  const parts = text.split(',').map((x) => /^(\d+)\/(\d+)$/.exec(x.trim()));
  if (parts.length !== 3 || parts.some((m) => m === null || Number(m[2]) === 0)) throw new Error(`--floor=${text}: give gold,junk,missed as passed/tested, e.g. 70/117,98/513,10/16`);
  const r = (m: RegExpExecArray | null): Rate => ({ passed: Number(m?.[1]), tested: Number(m?.[2]) });
  return { hand: r(parts[0] ?? null), negatives: r(parts[1] ?? null), missed: r(parts[2] ?? null) };
}

/**
 * The owner's cutoff for a switch of judge (2026-10-16, item 4): the STRICTEST point whose hand gold
 * and missed caught are at least `floor`'s, as shares; junk is not asked here (rule A in
 * `chooseCutoff` asks it, and refuses when that point lets more through). null when none keeps both.
 */
export function strictestKeeping(points: readonly CutoffPoint[], floor: Pick<SweepInput['live'], 'hand' | 'missed'>): CutoffPoint | null {
  const fh = share(floor.hand);
  const fm = share(floor.missed);
  const ok = (p: CutoffPoint) => share(p.hand) !== null && fh !== null && share(p.hand)! >= fh && (share(p.missed) === null || fm === null || share(p.missed)! >= fm);
  return [...points].reverse().find(ok) ?? null;
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
