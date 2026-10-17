/**
 * TRENDING NARRATIVES — which story is picking up fastest right now, the Narratives tab's default
 * order (the owner, 2026-10-17: "works like token trending, not just highest views").
 *
 * Separate from narrative.ts because that file decides what a narrative IS (its posts, its coin, its
 * views); this one only decides an ORDER among narratives that already exist, from facts about them.
 * The facts (`trendFacts`) are things a reader can check — views gained in the window and in the one
 * before, new posts, accounts, sources, age, the checked coin's market cap and buys — and they are
 * what the cards show. The number made from them (`trendStanding`) is ordering only: it never leaves
 * the projector, and the weights are Policy.narrative.trend.
 *
 * ★ VIEWS ARE THE CHART'S. A window's gain is `reachGained` — each post's gain spread between its own
 * readings, added up — so the number that orders a card is the number its chart would show for that
 * span. No new reads: the readings are the ones the posts already have.
 *
 * ★ EACH ACCOUNT ONCE. New posts are counted by account: one account posting the same thing ten
 * times is one new post to the order (the card still says how many posts arrived). Breadth — the
 * share of new posts from different accounts — rewards many voices over one loud one.
 *
 * ★ A MISSING INPUT IS NOT A ZERO. A story none of whose posts was read in the window is `unread`
 * and goes after every ranked one: an outage is not a slow story. No reading in the window before:
 * the speed-up term is left out, not scored as a jump from zero. An unknown age does not fade. A
 * coin that is not checked or proven is not an input at all.
 *
 * What breaks if changed carelessly: putting the raw gain in without the logarithm makes the order
 * "biggest first" again — the thing the owner asked Trending not to be.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { reachGained, type MemberReach } from './narrative.ts';

/** One post of the story, as the order reads it. */
export interface TrendPost {
  /** Who posted it: one account's posts count once. */
  readonly authorKey: string;
  /** Where it was posted: two or more is the "both sites" boost. */
  readonly sourceKey: string;
  /** When we first saved it; null when not known (it is then never a new post). */
  readonly foundAtMs: number | null;
  readonly reach: MemberReach;
}

/** The narrative's checked or proven coin, from stored market readings and our own trades. */
export interface TrendCoin {
  /** Market cap at the window's start (the newest reading at or before it), and now; null: none read. */
  readonly capAtStart: number | null;
  readonly capNow: number | null;
  /** Buys made through us in the window. */
  readonly buys: number;
}

export interface TrendInput {
  readonly posts: readonly TrendPost[];
  /** First found: the earliest save of any of its posts. */
  readonly foundAtMs: number | null;
  /** Only a checked or proven coin; null for none, or for one that is not checked. */
  readonly coin: TrendCoin | null;
}

/** What the order is made of, all of it checkable. */
export interface TrendFacts {
  readonly windowMs: number;
  /** Views gained in the window; null when no post was being read in it. */
  readonly gained: number | null;
  /** Views gained in the window before; null when no post was being read then. */
  readonly gainedBefore: number | null;
  /** Posts we found in the window, and the accounts that posted them (each once). */
  readonly newPosts: number;
  readonly accounts: number;
  /** Sources the story is on, across all its posts. */
  readonly sources: number;
  /** Since we found its first post; null when not known. */
  readonly ageMs: number | null;
  /** The coin's market cap now over the window's start; null without a checked coin read at both ends. */
  readonly coinCapRatio: number | null;
  readonly coinBuys: number;
}

export function trendFacts(input: TrendInput, nowMs: number, windowMs: number): TrendFacts {
  const from = nowMs - windowMs;
  const members = input.posts.map((p) => p.reach);
  const fresh = input.posts.filter((p) => p.foundAtMs !== null && p.foundAtMs >= from && p.foundAtMs <= nowMs);
  const c = input.coin;
  return {
    windowMs,
    gained: reachGained(members, from, nowMs).value,
    gainedBefore: reachGained(members, from - windowMs, from).value,
    newPosts: fresh.length,
    accounts: new Set(fresh.map((p) => p.authorKey)).size,
    sources: new Set(input.posts.map((p) => p.sourceKey)).size,
    ageMs: input.foundAtMs === null ? null : Math.max(0, nowMs - input.foundAtMs),
    coinCapRatio: c === null || c.capAtStart === null || c.capNow === null || c.capAtStart <= 0 ? null : c.capNow / c.capAtStart,
    coinBuys: c === null ? 0 : c.buys,
  };
}

export type TrendStanding = { readonly kind: 'ranked'; readonly value: number } | { readonly kind: 'unread' };

/** The policy's window for `windowMs`, or the nearest one longer than it. */
function windowOf(windowMs: number, p: Policy): Policy['narrative']['trend']['windows'][number] {
  const ws = [...p.narrative.trend.windows].sort((a, b) => a.ms - b.ms);
  return ws.find((w) => w.ms >= windowMs) ?? ws[ws.length - 1] ?? { ms: windowMs, ageMs: windowMs };
}

/** The ordering number (see the header and Policy.narrative.trend). Never shown. */
export function trendStanding(f: TrendFacts, p: Policy): TrendStanding {
  const t = p.narrative.trend;
  if (f.gained === null) return { kind: 'unread' };
  const gained = Math.max(0, f.gained);
  let sum = t.reachWeight * Math.log10(1 + gained);
  let speedingUp = false;
  if (f.gainedBefore !== null) {
    const doublings = Math.log2((gained + t.speedUpEven) / (Math.max(0, f.gainedBefore) + t.speedUpEven));
    const held = Math.max(-t.speedUpMaxDoublings, Math.min(t.speedUpMaxDoublings, doublings));
    sum += t.speedUpWeight * held;
    speedingUp = held > 0;
  }
  sum += t.postWeight * Math.log2(1 + f.accounts);
  if (f.newPosts > 0) sum += t.breadthWeight * (f.accounts / f.newPosts);
  if (f.sources >= 2) sum += t.bothSourcesBoost;
  if (f.coinCapRatio !== null) sum += t.coinCapWeight * Math.log2(1 + Math.max(0, Math.min(t.coinCapMaxGrowth, f.coinCapRatio - 1)));
  sum += t.coinBuyWeight * Math.log2(1 + f.coinBuys);
  const w = windowOf(f.windowMs, p);
  const age = f.ageMs === null ? 0 : f.ageMs * (speedingUp ? t.keepAgeing : 1);
  sum -= t.ageWeight * Math.min(t.ageMaxUnits, age / w.ageMs);
  return { kind: 'ranked', value: sum };
}

/**
 * The trending order: ranked stories highest first (ties: more gained, then newer found, then id),
 * then the unread ones newest found first. Returns the ids in order.
 */
export function trendOrder(list: readonly { readonly id: string; readonly facts: TrendFacts; readonly foundAtMs: number | null }[], p: Policy): readonly string[] {
  const rows = list.map((x) => ({ ...x, s: trendStanding(x.facts, p) }));
  const found = (x: { foundAtMs: number | null }) => x.foundAtMs ?? -Infinity;
  const ranked = rows.filter((x) => x.s.kind === 'ranked').sort((a, b) => {
    const va = a.s.kind === 'ranked' ? a.s.value : 0;
    const vb = b.s.kind === 'ranked' ? b.s.value : 0;
    return vb - va || (b.facts.gained ?? 0) - (a.facts.gained ?? 0) || found(b) - found(a) || a.id.localeCompare(b.id);
  });
  const unread = rows.filter((x) => x.s.kind === 'unread').sort((a, b) => found(b) - found(a) || a.id.localeCompare(b.id));
  return [...ranked, ...unread].map((x) => x.id);
}
