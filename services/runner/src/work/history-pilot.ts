/**
 * THE HISTORY PILOT'S PAID STEP: coins still alive today, grouped into narratives, each
 * narrative's origin found ONCE, stored with its timeline and kept forever.
 *
 *   group    coins that share a name or ticker are compared by picture (embedded once, cached);
 *            a borderline pair is put to the judge; core/src/history/group.ts decides. Each
 *            narrative is saved at once, its origin "not searched yet".
 *   origin   biggest narratives first. The creator links of its coins (the 3.3 checks: promo,
 *            account, influencer) — then, only if none settles it, ONE search back from just
 *            after the narrative's first coin, its results checked by name and picture.
 *
 * ★ THE CAP IS CHECKED BEFORE EVERY PAID CALL, AGAINST THE LEDGER. `universe.history.pilotUsd`
 * is the whole pilot's, across runs: what was spent is summed from internal.history_spend, so a
 * restart cannot spend the cap twice. When the next call would cross it, the run stops cleanly —
 * nothing half-written — and says how much is left to do.
 *
 * ★ IT RESUMES WHERE IT STOPPED. Grouped coins are not grouped again (public.history_coin), a
 * narrative whose origin was searched is not searched again (its gap is no longer "not searched
 * yet"), and pictures and pair answers are cached by the ports.
 *
 * ★ A POST AFTER LAUNCH IS NEVER THE ORIGIN. It is kept as "went viral after launch"
 * (core's `decideOrigin`); only a post before the first coin, within the launch allowance, is
 * where a narrative started.
 *
 * Every paid call's cost is recorded with its supplier and step. This module never decides who
 * pays or whether it may run: tools/history-pilot.ts refuses to start it without SPEND=live and
 * --yes, and prints the estimate first.
 */

import type { Millis } from '@insidor/contracts';
import { isOrigin } from '@insidor/contracts/origin.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { decideOrigin, groupCoins, matchCandidates, type Candidate, type CreatorCheck, type HistoryCoin, type PicturePair } from '@insidor/core';
import type { HistoryGap, PastNarrative, PgHistoryRepo, SpendStep } from '@insidor/store';

import type { Logger } from '../log.ts';

export interface PilotCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: Millis | null;
  /** Today's market cap, from the batch lookup. */
  readonly marketCapUsd: number | null;
  readonly imageUri: string | null;
  readonly socialLink: string | null;
}

export interface Charge {
  readonly supplier: string;
  readonly step: SpendStep;
  readonly usd: number;
}

/** A port's answer and what it cost. A cached answer costs nothing and charges nothing. */
export interface Paid<T> {
  readonly value: T;
  readonly charges: readonly Charge[];
}

/** A post as the timeline shows it. */
export interface ShownPost {
  readonly postId: string;
  readonly authorLabel: string;
  readonly permalink: string | null;
  readonly postedAt: Millis | null;
}

export interface CreatorAnswer {
  readonly check: CreatorCheck;
  /** The linked post, when one was read. */
  readonly post: ShownPost | null;
  /** Why the link could not be followed, when that is the honest answer. */
  readonly gap: Extract<HistoryGap, 'possibly_deleted' | 'tiktok_not_searchable'> | null;
}

export interface PilotPorts {
  /** The two coins' picture similarity; embeds a picture not embedded yet. Null: not comparable. */
  pictureSimilarity(a: PilotCoin, b: PilotCoin): Promise<Paid<number | null>>;
  /** The judge on a borderline pair: the same subject? Null: not answered. */
  confirmPair(a: PilotCoin, b: PilotCoin): Promise<Paid<'yes' | 'no' | null>>;
  /** The creator's link, read and checked. */
  creator(coin: PilotCoin & { readonly launchedAt: Millis }): Promise<Paid<CreatorAnswer>>;
  /** One search back for `term`, nothing published after `untilMs`; each result with its picture verdict against `coin`. */
  searchBack(term: string, untilMs: Millis, coin: PilotCoin): Promise<Paid<readonly (Candidate & { readonly shown: ShownPost })[]>>;
  /** The coin's highest market cap in its price history (free). Null when unreadable. */
  peak(coin: PilotCoin): Promise<number | null>;
}

/** What each paid call is reserved at before it is made: the purse never starts what it cannot finish. */
export interface Reservations {
  readonly pictures: number;
  readonly confirm: number;
  readonly creator: number;
  readonly search: number;
}

export interface PilotDeps {
  readonly ports: PilotPorts;
  readonly reserve: Reservations;
  readonly history: Pick<PgHistoryRepo, 'spent' | 'recordSpend' | 'grouped' | 'pending' | 'save'>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface PilotResult {
  /** 'cap' when the next paid call would have crossed the cap; null when the work ran out first. */
  readonly stopped: 'cap' | null;
  readonly spentUsd: number;
  readonly grouped: number;
  readonly searched: number;
  readonly remaining: number;
}

class CapReached extends Error {}

/** The ledger-backed purse: checked before a call, charged after it. */
class Purse {
  #spent: number;
  readonly #cap: number;
  readonly #deps: PilotDeps;
  constructor(spent: number, deps: PilotDeps) {
    this.#spent = spent;
    this.#cap = deps.policy.universe.history.pilotUsd;
    this.#deps = deps;
  }
  get spent(): number {
    return this.#spent;
  }
  need(usd: number): void {
    if (this.#spent + usd > this.#cap) throw new CapReached();
  }
  async pay(charges: readonly Charge[], narrativeId: string | null): Promise<void> {
    for (const c of charges) {
      await this.#deps.history.recordSpend({ narrativeId, supplier: c.supplier, step: c.step, usd: c.usd }, this.#deps.now());
      this.#spent += c.usd;
    }
  }
}

const key = (s: string | null): string => (s ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const narrativeIdOf = (first: PilotCoin): string => `h_${first.address}`;
const launch = (c: PilotCoin): number => c.launchedAt ?? Number.POSITIVE_INFINITY;
const biggest = (coins: readonly PilotCoin[]): PilotCoin | undefined =>
  [...coins].sort((a, b) => (b.marketCapUsd ?? Number.NEGATIVE_INFINITY) - (a.marketCapUsd ?? Number.NEGATIVE_INFINITY))[0];

export async function runPilot(coins: readonly PilotCoin[], deps: PilotDeps): Promise<PilotResult> {
  const purse = new Purse(await deps.history.spent(), deps);
  const byAddress = new Map(coins.map((c) => [c.address, c]));
  let grouped = 0;
  let searched = 0;
  try {
    grouped = await group(coins, deps, purse);
    searched = await origins(byAddress, deps, purse);
  } catch (e) {
    if (!(e instanceof CapReached)) throw e;
    const remaining = (await deps.history.pending()).length + (coins.length - (await deps.history.grouped(coins.map((c) => c.address))).size);
    deps.log.info('history pilot stopped at its cap; run it again after raising the cap to continue', { spentUsd: purse.spent, remaining });
    return { stopped: 'cap', spentUsd: purse.spent, grouped, searched, remaining };
  }
  return { stopped: null, spentUsd: purse.spent, grouped, searched, remaining: (await deps.history.pending()).length };
}

/** Group the coins not grouped yet, and save each narrative with its origin not yet searched. */
async function group(coins: readonly PilotCoin[], deps: PilotDeps, purse: Purse): Promise<number> {
  const done = await deps.history.grouped(coins.map((c) => c.address));
  const todo = coins.filter((c) => !done.has(c.address));
  if (todo.length === 0) return 0;
  const bars = deps.policy.group.image;

  /* Only coins that share a name or a ticker can be one narrative by name; only they are compared. */
  const pairs: PicturePair[] = [];
  for (let i = 0; i < todo.length; i += 1) {
    for (let j = i + 1; j < todo.length; j += 1) {
      const a = todo[i];
      const b = todo[j];
      if (a === undefined || b === undefined) continue;
      const sameName = key(a.name) !== '' && key(a.name) === key(b.name);
      const sameTicker = key(a.ticker) !== '' && key(a.ticker) === key(b.ticker);
      if (!sameName && !sameTicker) continue;
      purse.need(deps.reserve.pictures);
      const sim = await deps.ports.pictureSimilarity(a, b);
      await purse.pay(sim.charges, null);
      if (sim.value === null) continue;
      let similarity = sim.value;
      if (similarity >= bars.borderline && similarity < bars.likely) {
        purse.need(deps.reserve.confirm);
        const asked = await deps.ports.confirmPair(a, b);
        await purse.pay(asked.charges, null);
        /* "Yes" counts as likely; "no" is a compared, different picture; unanswered is not a comparison. */
        if (asked.value === null) continue;
        similarity = asked.value === 'yes' ? bars.likely : 0;
      }
      pairs.push({ a: a.address, b: b.address, similarity });
    }
  }

  const historyCoins: HistoryCoin[] = todo.map((c) => ({ address: c.address, name: c.name, ticker: c.ticker, launchedAt: c.launchedAt, marketCapUsd: c.marketCapUsd, linkedPost: null }));
  const byAddress = new Map(todo.map((c) => [c.address, c]));
  const narratives = groupCoins(historyCoins, pairs, deps.policy);
  for (const n of narratives) {
    const members = n.coins.flatMap((c) => byAddress.get(c.address) ?? []);
    const first = [...members].sort((a, b) => launch(a) - launch(b))[0];
    const big = biggest(members);
    if (first === undefined || big === undefined) continue;
    await deps.history.save({
      narrativeId: narrativeIdOf(first),
      title: n.title,
      originPost: null,
      originGap: 'not_searched_yet',
      firstCoin: first.address,
      firstCoinAt: first.launchedAt,
      biggestCoin: big.address,
      peakMarketCapUsd: await deps.ports.peak(big),
      coins: members.map((c) => c.address),
    }, deps.now());
  }
  return narratives.length;
}

/** Each narrative's origin, once, biggest first. Returns how many were searched this run. */
async function origins(byAddress: ReadonlyMap<string, PilotCoin>, deps: PilotDeps, purse: Purse): Promise<number> {
  const pending = (await deps.history.pending())
    .map((n) => ({ ...n, members: n.coins.flatMap((a) => byAddress.get(a) ?? []) }))
    .filter((n) => n.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length || (biggest(b.members)?.marketCapUsd ?? 0) - (biggest(a.members)?.marketCapUsd ?? 0));
  let searched = 0;
  for (const n of pending) {
    const ordered = [...n.members].sort((a, b) => launch(a) - launch(b));
    const first = ordered[0];
    if (first === undefined || first.launchedAt === null) {
      deps.log.warn('a narrative with no known launch cannot be searched back; left as not searched', { narrative: n.narrativeId });
      continue;
    }
    const firstAt = first.launchedAt;
    const facts = { address: first.address, ticker: first.ticker ?? '', name: first.name ?? n.title, launchedAt: firstAt };

    /* 1. Creator links, earliest coin first. The first that proves an origin settles it. */
    let creator: CreatorCheck = { kind: 'fallThrough', why: 'no creator link was followed' };
    let creatorPost: ShownPost | null = null;
    let gapHint: CreatorAnswer['gap'] = null;
    for (const coin of ordered) {
      if (coin.socialLink === null || coin.launchedAt === null) continue;
      purse.need(deps.reserve.creator);
      const answer = await deps.ports.creator({ ...coin, launchedAt: coin.launchedAt });
      await purse.pay(answer.charges, n.narrativeId);
      gapHint = gapHint ?? answer.value.gap;
      if (answer.value.check.kind === 'origin') {
        creator = answer.value.check;
        creatorPost = answer.value.post;
        break;
      }
      if (creator.kind === 'fallThrough') creator = answer.value.check;
      creatorPost = creatorPost ?? answer.value.post;
    }

    /* 2. Only if the links did not settle it: one search back, to just after the first coin. */
    let found: readonly (Candidate & { readonly shown: ShownPost })[] = [];
    if (creator.kind !== 'origin') {
      purse.need(deps.reserve.search);
      const term = first.ticker !== null && first.ticker.trim() !== '' ? first.ticker.replace(/^\$/, '') : n.title;
      const result = await deps.ports.searchBack(term, (firstAt + deps.policy.origin.launchAllowanceMs) as Millis, first);
      await purse.pay(result.charges, n.narrativeId);
      found = result.value;
    }
    const match = creator.kind === 'origin' ? { kind: 'none' as const, why: 'settled by a creator link' } : matchCandidates(found, facts, deps.policy);
    const decision = decideOrigin(creator, match);

    const shown = (id: string | null): ShownPost | null =>
      id === null ? null : creatorPost?.postId === id ? creatorPost : found.find((f) => f.postId === id)?.shown ?? null;
    const post = shown(decision.postId);
    let originPost: PastNarrative['originPost'] = null;
    let originGap: HistoryGap | null = null;
    if (post !== null && (isOrigin(decision.status) || decision.status === 'viral_after_launch')) {
      originPost = { authorLabel: post.authorLabel, permalink: post.permalink, postedAt: post.postedAt, afterLaunch: decision.status === 'viral_after_launch' };
    } else {
      originGap = gapHint ?? 'origin_not_found';
    }
    const big = biggest(n.members) ?? first;
    await deps.history.save({
      narrativeId: n.narrativeId,
      title: n.title,
      originPost,
      originGap,
      firstCoin: first.address,
      firstCoinAt: firstAt,
      biggestCoin: big.address,
      peakMarketCapUsd: null,
      coins: n.members.map((c) => c.address),
    }, deps.now());
    searched += 1;
  }
  return searched;
}
