/**
 * THE EARLY PICK, IN THE RUNNER (Policy.oneCoin.early, core match/early-pick.ts): on every one-coin
 * pass, each open post's launch wave looked at on its latest market readings, and a coin made for the
 * post that is under $20K and rising five times every rival takes the post's pick — with the owner
 * told at once, in plain facts: "$BALDCAT from @x's post: $14K cap, 9 min old, 5× the other coins".
 *
 * Why its own step and not a bar of the one-coin rule: that rule's bars are the replay's for a coin
 * that is already running ($15K and three times every rival's net buying, on the trade feed), and its
 * holder discipline is what keeps a card from flipping. This rule fires once a post, in a coin's first
 * half hour, on the readings the market reader now takes of these coins every minute (market
 * firstHour). Its decision is written as an ordinary pick, so the card, the hand-overs and the launch
 * push read it as they read any other; `earlyPick` in the evidence is its record for a later replay.
 *
 *   decide   per post: core `earlyPick` over all its candidates; never on a post the owner made a coin
 *            call on, never on a pick the runner hand-over holds, never twice on a post (the stored
 *            pick carries `earlyPick` once it fired), never when the pick already holds that coin
 *   hold     ★ NO PING-PONG, as the runner hand-over: while the early coin is the post's pick, the
 *            one-coin rule may confirm it or hand it to a coin of its launch wave or later by its own
 *            three-times bar, but its "waiting" or "none" never drops it, and an older incumbent
 *            never takes it back (`holdEarly`) — that rule's bars are higher than this one's and an
 *            incumbent's cap is too, so either would undo every early pick on the next pass. Whatever
 *            the one-coin rule writes on such a post keeps the `earlyPick` record. A dead early pick
 *            is moved on by the runner hand-over (a later runner) or the missed-runner net.
 *   push     only in live mode, only when Policy.oneCoin.early.push.on, and only for a post that was on
 *            For You when the coin launched (or a coin-first post) — the launch push's own timing rule.
 *            To the owner's profiles while `everyone` is false (kind 'outage', as his other alarms:
 *            never paced away); to every profile as a `coin_launched` when he widens it, keyed by the
 *            coin, so the launch push of the same coin is the same claim and never a second push.
 *
 * What breaks if changed carelessly: letting the one-coin rule's "waiting" overwrite an early pick.
 * That rule wants $15K and the trade feed, which on 21-24 Oct had cut most of these coins by its
 * daily credit cap before they traded: every early pick would last one pass.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { earlyPick, type EarlyBars, type EarlyCoin, type EarlyPick, type MatchEvidence } from '@insidor/core';
import type { CandidateRow, PickWrite, StoredPick } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

/** The evidence word an early pick leaves on the pick, and its record's key. */
export const EARLY_PICK = 'early_pick';

/** The record an early pick leaves in the pick's evidence, kept by every later write on the post. */
export interface EarlyRecord {
  readonly address: string;
  readonly atMs: number;
  readonly capUsd: number;
  readonly ageMs: number;
  readonly riseUsd: number;
  readonly rivalRiseUsd: number;
  readonly rivals: number;
  readonly rivalsUnread: number;
  readonly ties: readonly MatchEvidence[];
  /** The post was on For You when the coin launched, or is a coin-first post: the push's timing rule. */
  readonly shownFirst: boolean;
  /** Who was told: nobody, the owner, or everyone. */
  readonly told: 'nobody' | 'owner' | 'everyone';
}

export const earlyBars = (P: Policy): EarlyBars => ({
  minCapUsd: P.oneCoin.early.minCapUsd,
  maxCapUsd: P.oneCoin.early.maxCapUsd,
  lead: P.oneCoin.early.lead,
  fromMs: P.oneCoin.early.fromMs,
  withinMs: P.oneCoin.early.withinMs,
  rivalWithinMs: P.oneCoin.early.rivalWithinMs,
  readingWithinMs: P.oneCoin.early.readingWithinMs,
  openingCapUsd: P.oneCoin.openingCapUsd,
  minLiquidityUsd: P.oneCoin.minLiquidityUsd,
});

/** The early record a stored pick carries, or null. */
export function earlyRecordOf(p: StoredPick | undefined): EarlyRecord | null {
  const r = p?.evidence['earlyPick'];
  return typeof r === 'object' && r !== null && typeof (r as { address?: unknown }).address === 'string' ? (r as EarlyRecord) : null;
}

/** Whether the early rule put the stored pick where it is (and it still holds that coin). */
export const heldByEarly = (p: StoredPick | undefined): boolean => p?.outcome === 'picked' && p.address !== null && earlyRecordOf(p)?.address === p.address;

const tiesOf = (r: CandidateRow): MatchEvidence[] => {
  const t = r.evidence['ties'];
  return Array.isArray(t) ? t.filter((x): x is MatchEvidence => typeof x === 'string') : [];
};

/** A post's coins as the rule reads them: each address once, its ties merged, its newest reading. */
export function earlyCoinsOf(rows: readonly CandidateRow[], market: ReadonlyMap<string, { readonly capUsd: number; readonly readAtMs: number; readonly liquidityUsd: number | null }>): EarlyCoin[] {
  const by = new Map<string, CandidateRow[]>();
  for (const r of rows) by.set(r.address, [...(by.get(r.address) ?? []), r]);
  return [...by].map(([address, rs]) => {
    const m = market.get(address);
    return {
      address,
      launchedAtMs: rs.find((r) => r.launchedAtMs !== null)?.launchedAtMs ?? null,
      ties: [...new Set(rs.flatMap(tiesOf))].filter((t) => t !== 'existing'),
      reading: m === undefined ? null : { capUsd: m.capUsd, readAtMs: m.readAtMs, liquidityUsd: m.liquidityUsd },
    };
  });
}

/** The pick row an early pick writes. */
export function earlyWrite(itemId: string, p: EarlyPick, prev: StoredPick | undefined, record: EarlyRecord, mode: 'shadow' | 'live'): PickWrite {
  return {
    subjectId: itemId,
    address: p.address,
    outcome: 'picked',
    decidedAtMs: record.atMs,
    evidence: { mode, basis: 'market_readings', reason: EARLY_PICK, [EARLY_PICK]: true, earlyPick: record, handedOverFrom: prev?.outcome === 'picked' ? prev.address : null, ties: p.ties, standings: [] },
    basis: 'market_readings',
  };
}

/**
 * The one-coin rule's writes for the posts, with the early rule's discipline applied. While the early
 * coin holds the pick, the rule's "waiting" or "none" is dropped, and so is a pick of a coin OLDER
 * than the early coin's launch wave: the early rule beat the wave, not the incumbent, and on readings
 * the incumbent's higher cap ($CAT at $36K against $baldcat's $14K) would take the pick straight back
 * on the next pass. A pick of the same coin, or of another coin of its wave or later by the rule's own
 * three-times bar, is written. Every write on a post the early rule fired on keeps its record. Pure.
 *
 * `launchedOf`: each candidate's launch (null unknown, which counts as older); `waveMs`: the early
 * rule's `rivalWithinMs`.
 */
export function holdEarly(writes: readonly PickWrite[], prev: ReadonlyMap<string, StoredPick>, launchedOf: ReadonlyMap<string, number | null>, waveMs: number): PickWrite[] {
  return writes.flatMap((w) => {
    const p = prev.get(w.subjectId);
    const record = earlyRecordOf(p);
    if (record === null) return [w];
    if (heldByEarly(p)) {
      if (w.outcome !== 'picked' || w.address === null) return [];
      const early = launchedOf.get(record.address) ?? null;
      const to = launchedOf.get(w.address) ?? null;
      if (w.address !== record.address && (early === null || to === null || to < early - waveMs)) return [];
    }
    return [{ ...w, evidence: { ...w.evidence, earlyPick: record } }];
  });
}

export interface EarlyFacts {
  readonly ticker: string | null;
  readonly excerpt: string | null;
  readonly handle: string | null;
  readonly image: string | null;
}

export interface EarlyPushPort {
  ownerIds(wallets: readonly string[]): Promise<readonly string[]>;
  everyoneIds(): Promise<readonly string[]>;
  queue(userId: string, alert: { readonly kind: string; readonly subject: string; readonly rung: number; readonly facts: Readonly<Record<string, unknown>>; readonly href: string }): Promise<void>;
}

export interface EarlyPickDeps {
  /** When each post was first on For You, and whether it is a coin-first post (store `shownOf`). */
  readonly shownOf: (itemIds: readonly string[]) => Promise<ReadonlyMap<string, { readonly forYouMs: number | null; readonly coinFirst: boolean }>>;
  readonly pushFacts: (itemId: string, address: string) => Promise<EarlyFacts>;
  /** Null: nobody is told (the pick is still written). */
  readonly push: EarlyPushPort | null;
  readonly ownerWallets: readonly string[];
}

export interface EarlyDecision {
  readonly itemId: string;
  readonly pick: EarlyPick;
  readonly write: PickWrite;
}

/**
 * The early picks of this pass, decided (posts whose pick the owner called, or the runner hand-over
 * holds, are not passed in). Returns the writes; the caller writes them in place of the one-coin
 * rule's for those posts, then calls `tellEarly`.
 */
export async function decideEarly(
  byPost: ReadonlyMap<string, readonly CandidateRow[]>,
  market: ReadonlyMap<string, { readonly capUsd: number; readonly readAtMs: number; readonly liquidityUsd: number | null }>,
  prev: ReadonlyMap<string, StoredPick>,
  deps: Pick<EarlyPickDeps, 'shownOf'>,
  policy: Policy,
  nowMs: number,
): Promise<readonly EarlyDecision[]> {
  const E = policy.oneCoin.early;
  if (!E.on) return [];
  const bars = earlyBars(policy);
  const found: { itemId: string; pick: EarlyPick; launchedAtMs: number }[] = [];
  for (const [itemId, rows] of byPost) {
    const before = prev.get(itemId);
    if (earlyRecordOf(before) !== null) continue;
    const coins = earlyCoinsOf(rows, market);
    const pick = earlyPick(coins, nowMs, bars);
    if (pick === null || (before?.outcome === 'picked' && before.address === pick.address)) continue;
    found.push({ itemId, pick, launchedAtMs: nowMs - pick.ageMs });
  }
  if (found.length === 0) return [];
  const shown = await deps.shownOf(found.map((f) => f.itemId));
  const told = !E.push.on || policy.oneCoin.mode !== 'live' ? 'nobody' : E.push.everyone ? 'everyone' : 'owner';
  return found.map(({ itemId, pick, launchedAtMs }) => {
    const s = shown.get(itemId);
    const shownFirst = s !== undefined && (s.coinFirst || (s.forYouMs !== null && s.forYouMs <= launchedAtMs));
    const record: EarlyRecord = { address: pick.address, atMs: nowMs, capUsd: pick.capUsd, ageMs: pick.ageMs, riseUsd: pick.riseUsd, rivalRiseUsd: pick.rivalRiseUsd, rivals: pick.rivals, rivalsUnread: pick.rivalsUnread, ties: pick.ties, shownFirst, told: shownFirst ? told : 'nobody' };
    return { itemId, pick, write: earlyWrite(itemId, pick, prev.get(itemId), record, policy.oneCoin.mode) };
  });
}

/** The push's facts: what the text says (services/notify text.ts, what 'early-pick'). */
export function earlyAlertFacts(d: EarlyDecision, f: EarlyFacts): Record<string, unknown> {
  return {
    what: 'early-pick',
    symbol: f.ticker ?? '',
    address: d.pick.address,
    item: d.itemId,
    author: f.handle === null ? null : `@${f.handle}`,
    excerpt: f.excerpt,
    image: f.image,
    mcUsd: d.pick.capUsd,
    ageMs: d.pick.ageMs,
    rivals: d.pick.rivals,
    /* How many times the other coins' rise this one rose: null when no other coin rose at all. */
    multiple: d.pick.rivalRiseUsd > 0 ? d.pick.riseUsd / d.pick.rivalRiseUsd : null,
  };
}

/** Tells whoever the record says, once per coin per person (the deliverer's claim is keyed by the subject). Returns the alerts queued. */
export async function tellEarly(decisions: readonly EarlyDecision[], deps: EarlyPickDeps, log: Logger): Promise<number> {
  if (deps.push === null) return 0;
  let queued = 0;
  for (const d of decisions) {
    const record = d.write.evidence['earlyPick'] as EarlyRecord;
    if (record.told === 'nobody') continue;
    try {
      const facts = earlyAlertFacts(d, await deps.pushFacts(d.itemId, d.pick.address));
      const everyone = record.told === 'everyone';
      const ids = everyone ? await deps.push.everyoneIds() : await deps.push.ownerIds(deps.ownerWallets);
      const alert = everyone
        ? { kind: 'coin_launched', subject: d.pick.address, rung: 0, facts: { ...facts, early: true }, href: `/#/token/solana:${d.pick.address}` }
        : { kind: 'outage', subject: `early-pick|${d.pick.address}`, rung: 0, facts, href: `/#/token/solana:${d.pick.address}` };
      for (const userId of ids) await deps.push.queue(userId, alert);
      queued += ids.length;
    } catch (e) {
      log.error('early pick: the push was not queued; the pick stands', { itemId: d.itemId, address: d.pick.address, err: errorText(e) });
    }
  }
  return queued;
}
