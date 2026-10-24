/**
 * THE MISSED-RUNNER NET (Policy.runnerLink.missed): every few minutes, the coins that ran big while no
 * post's or narrative's pick held them, tied back to the post we hold that they came from — given to
 * it as its pick — and told to the owner, with or without a post.
 *
 * Why a net behind the matcher at all: the matcher (work/one-coin.ts) decides in a launch's first
 * minutes, on the posts of the hours before, and every one of its misses is silent. 23 Oct: "You
 * Missed Coin" ($BITCHES) ran to about $3.7M; we held its origin (@TocRadio, 84.5k views) and the post
 * that stated its name, and the coin was neither's — and nothing said so until the owner looked.
 *
 * One pass, DB only (no call, no cost):
 *   runners  coins launched in `seenWithinMs` whose market cap read `minCapUsd` or more on
 *            `minReadings` readings with a pool (oneCoin.minLiquidityUsd), that no pick holds (store
 *            PgMissedRunnerRepo.runners), biggest first, `perPass` at most
 *   posts    for each, the posts we hold from `postLookbackMs` before its launch to `launchLeadMs`
 *            after, whose words, English translation, judge's or namer's names carry its name or
 *            ticker; their picture similarity where both are embedded; ranked by core
 *            `rankRunnerPosts` (a name tie first, then the most views, then the earliest)
 *   link     the best post gets the coin: a candidate tied `missed_runner` (so the next one-coin pass
 *            judges it as the creators' coin, not a look-alike) and the pick, with the change recorded
 *            — unless the owner made a coin call on that post: his word stands, the coin is listed only;
 *            or the post's own coin ran as high or higher (`biggerCoinHeld`): it is kept, and told
 *   tell     the owner's alert (kind 'outage', what 'missed-runner'; services/notify text.ts): the
 *            coin, its cap, and the post — or "ran without a post we hold"
 * The post then reaches For You by its running pick (services/project running-picks.ts), and its
 * narrative is judged again with the coin by the next one-coin pass (the candidate is open).
 *
 * ★ ONCE A COIN. A coin handled is remembered by this process; a linked coin is a held pick and is not
 * a runner again; the alert is once per subject by its claim (0044). A restart looks again at the
 * coins with no post, and the alert claim drops the repeat.
 *
 * What breaks if changed carelessly: the owner's call. Writing the pick over a post he called would
 * re-open what he decided, the one thing the cards never do.
 */

import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { rankRunnerPosts, type RunnerMatch, type RunnerPost } from '@insidor/core';
import type { CandidateRow, PickWrite, RunnerCoinRow, RunnerPostRow, StoredPick } from '@insidor/store';
import { runnerKey } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';
import type { OwnerQueue } from '../supplier-warnings.ts';
import { heldByRunner } from './runner-handover.ts';

export interface MissedRunnerDeps {
  readonly runners: (sinceMs: number, minCapUsd: number, origins: readonly string[], limit: number, minLiquidityUsd: number, minReadings: number) => Promise<readonly RunnerCoinRow[]>;
  readonly postsFor: (phrases: readonly string[], keys: readonly string[], fromMs: number, toMs: number, limit: number) => Promise<readonly RunnerPostRow[]>;
  readonly pictureSimilarity: (assetKey: string, itemIds: readonly string[]) => Promise<ReadonlyMap<string, number>>;
  /** The posts of these ids whose newest coin call is not "cleared". */
  readonly ownerCalled: (itemIds: readonly string[]) => Promise<ReadonlySet<string>>;
  readonly picks: (itemIds: readonly string[]) => Promise<ReadonlyMap<string, StoredPick>>;
  /** The highest cap read for each address since `sinceMs` (store PgMissedRunnerRepo.peaks); absent when never read. */
  readonly peaks: (addresses: readonly string[], sinceMs: number) => Promise<ReadonlyMap<string, number>>;
  readonly upsertCandidates: (rows: readonly CandidateRow[], nowMs: number) => Promise<unknown>;
  readonly writePicks: (picks: readonly PickWrite[], previous: ReadonlyMap<string, StoredPick>, mode: 'shadow' | 'live', nowMs: number) => Promise<unknown>;
  readonly ownerWallets: readonly string[];
  readonly owner: OwnerQueue | null;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => number;
}

/** One coin the net handled: the post it went to (or none), and whether it was given the pick. */
export interface MissedRunner {
  readonly coin: RunnerCoinRow;
  readonly post: (RunnerMatch & { readonly handle: string | null; readonly postedAtMs: number }) | null;
  /** The posts weighed, best first (at most a few, for the owner's list). */
  readonly weighed: readonly RunnerMatch[];
  readonly linked: boolean;
  readonly ownerCalled: boolean;
  /** Not linked because the post's own coin ran as high or higher (`biggerCoinHeld`), or the runner hand-over took the post from this very coin. */
  readonly keptBigger: boolean;
}

/**
 * ★ A RUNNER NEVER TAKES A POST FROM A COIN THAT RAN HIGHER. Two coins of one name often both run, and
 * a post's coin may already be the bigger one. On 24 Oct, its first pass, the net:
 *   - wrote a $730K copy of $YMB, launched two minutes after it, over the $793K original on @TocRadio's post, seconds after linking the original;
 *   - wrote a $667K $fomo over the $1.8M $FOMO the matcher had given @MrketInsider's post.
 * The net exists for a coin a post does NOT show, so the post's own coin is kept whenever it read as
 * high or higher in the same window.
 */
async function biggerCoinHeld(deps: MissedRunnerDeps, prev: StoredPick | undefined, coin: RunnerCoinRow, sinceMs: number): Promise<boolean> {
  if (prev === undefined || prev.outcome !== 'picked' || prev.address === null || prev.address === coin.address) return false;
  const held = (await deps.peaks([prev.address], sinceMs)).get(prev.address);
  return held !== undefined && held >= coin.peakCapUsd;
}

/** The posts read for one coin, most viewed first. */
const POSTS_READ = 200;
/** The posts kept beside the chosen one in the alert's facts. */
const WEIGHED_KEPT = 5;

/** The coin's name without a trailing generic word ("You Missed Coin" → "You Missed"). */
function nameCore(name: string, generic: readonly string[]): string {
  const g = new Set(generic.map(runnerKey));
  const words = name.trim().split(/\s+/u);
  while (words.length > 1 && g.has(runnerKey(words[words.length - 1] ?? ''))) words.pop();
  return words.join(' ');
}

/** The phrases looked for in a post's words, and the compact keys its names are matched against. */
export function searchTerms(coin: Pick<RunnerCoinRow, 'name' | 'ticker'>, policy: Policy): { readonly phrases: readonly string[]; readonly keys: readonly string[] } {
  const min = policy.postCoin.minVariantLength;
  const core = coin.name === null ? null : nameCore(coin.name, policy.runnerLink.stated.genericWords);
  const ticker = coin.ticker !== null && runnerKey(coin.ticker).length >= min ? coin.ticker : null;
  const phrases = [coin.name, core, ticker].filter((x): x is string => x !== null && runnerKey(x).length >= min);
  const keys = [coin.name, core, ticker, core !== null && ticker !== null ? `${core}${ticker}` : null].filter((x): x is string => x !== null).map(runnerKey).filter((k) => k.length >= min);
  return { phrases: [...new Set(phrases)], keys: [...new Set(keys)] };
}

/** The ranked posts for one coin (DB reads, core ranking). */
export async function postsForCoin(deps: Pick<MissedRunnerDeps, 'postsFor' | 'pictureSimilarity' | 'policy'>, coin: RunnerCoinRow): Promise<{ readonly ranked: readonly RunnerMatch[]; readonly rows: ReadonlyMap<string, RunnerPostRow> }> {
  const P = deps.policy;
  if (coin.launchedAtMs === null) return { ranked: [], rows: new Map() };
  const { phrases, keys } = searchTerms(coin, P);
  const rows = await deps.postsFor(phrases, keys, coin.launchedAtMs - P.runnerLink.missed.postLookbackMs, coin.launchedAtMs + P.oneCoin.launchLeadMs, POSTS_READ);
  const sims = await deps.pictureSimilarity(coin.assetKey, rows.map((r) => r.itemId));
  const posts: RunnerPost[] = rows.map((r) => ({ itemId: r.itemId, postedAtMs: r.postedAtMs, judgeNames: r.judgeNames, guessNames: r.guessNames, hash: null, text: r.text, textEn: r.textEn, reach: r.views, pictureSimilarity: sims.get(r.itemId) ?? null }));
  const ranked = rankRunnerPosts(posts, coin, { minVariantLength: P.postCoin.minVariantLength, genericWords: P.runnerLink.stated.genericWords, minSimilarity: P.oneCoin.picture.minSimilarity, originShareOfTop: P.runnerLink.missed.originShareOfTop });
  return { ranked, rows: new Map(rows.map((r) => [r.itemId, r] as const)) };
}

export interface MissedRunnerState {
  readonly done: Set<string>;
}

export const newMissedRunnerState = (): MissedRunnerState => ({ done: new Set() });

/** One pass. Never throws: a failed coin is logged and looked at again next pass. */
export async function missedRunnerPass(deps: MissedRunnerDeps, state: MissedRunnerState): Promise<readonly MissedRunner[]> {
  const P = deps.policy.runnerLink.missed;
  if (!P.on) return [];
  const now = deps.now();
  let coins: readonly RunnerCoinRow[];
  try {
    coins = await deps.runners(now - P.seenWithinMs, P.minCapUsd, OBSERVED_ASSET_ORIGINS, P.perPass, deps.policy.oneCoin.minLiquidityUsd, P.minReadings);
  } catch (e) {
    deps.log.error('missed runners: the coins could not be read; trying again next pass', { err: errorText(e) });
    return [];
  }
  const out: MissedRunner[] = [];
  for (const coin of coins.filter((c) => !state.done.has(c.address))) {
    try {
      const { ranked, rows } = await postsForCoin(deps, coin);
      const best = ranked[0];
      const called = best === undefined ? new Set<string>() : await deps.ownerCalled([best.itemId]);
      const ownerCalled = best !== undefined && called.has(best.itemId);
      const prev = best === undefined || ownerCalled ? new Map<string, StoredPick>() : await deps.picks([best.itemId]);
      /* ★ Nor back to the coin the runner hand-over took the post from (work/runner-handover.ts): only that rule may move it back. */
      const handedFrom = best !== undefined && heldByRunner(prev.get(best.itemId)) && prev.get(best.itemId)?.evidence['handedOverFrom'] === coin.address;
      const keptBigger = best !== undefined && (handedFrom || (await biggerCoinHeld(deps, prev.get(best.itemId), coin, now - P.seenWithinMs)));
      const linked = best !== undefined && !ownerCalled && !keptBigger;
      if (best !== undefined && linked) {
        const ties = [...best.ties, 'missed_runner'];
        const launchedAfterMs = coin.launchedAtMs === null ? null : coin.launchedAtMs - (rows.get(best.itemId)?.postedAtMs ?? coin.launchedAtMs);
        await deps.upsertCandidates([{ itemId: best.itemId, address: coin.address, path: 'launch', evidence: { ties, peakCapUsd: coin.peakCapUsd, launchedAfterMs }, launchedAtMs: coin.launchedAtMs, foundAtMs: now }], now);
        await deps.writePicks(
          [{ subjectId: best.itemId, address: coin.address, outcome: 'picked', decidedAtMs: now, evidence: { mode: deps.policy.oneCoin.mode, basis: 'market_readings', missedRunner: true, ties, peakCapUsd: coin.peakCapUsd, replaced: prev.get(best.itemId)?.address ?? null, standings: [] }, basis: 'market_readings' }],
          prev,
          deps.policy.oneCoin.mode,
          now,
        );
      }
      const post = best === undefined ? null : { ...best, handle: rows.get(best.itemId)?.handle ?? null, postedAtMs: rows.get(best.itemId)?.postedAtMs ?? 0 };
      const found: MissedRunner = { coin, post, weighed: ranked.slice(0, WEIGHED_KEPT), linked, ownerCalled, keptBigger };
      out.push(found);
      state.done.add(coin.address);
      await tell(deps, found);
      deps.log.info('missed runner', { address: coin.address, ticker: coin.ticker, peakCapUsd: coin.peakCapUsd, itemId: post?.itemId ?? null, ties: post?.ties ?? [], linked, ownerCalled, keptBigger });
    } catch (e) {
      deps.log.error('missed runners: one coin could not be handled; trying again next pass', { address: coin.address, err: errorText(e) });
    }
  }
  return out;
}

/** The owner's alert for one missed runner, once by its subject. */
async function tell(deps: MissedRunnerDeps, m: MissedRunner): Promise<void> {
  if (!deps.policy.runnerLink.missed.alert || deps.owner === null || deps.ownerWallets.length === 0) return;
  const facts = {
    what: 'missed-runner',
    name: m.coin.name,
    ticker: m.coin.ticker,
    capUsd: Math.round(m.coin.peakCapUsd),
    launchedAt: m.coin.launchedAtMs === null ? null : new Date(m.coin.launchedAtMs).toISOString(),
    handle: m.post?.handle ?? null,
    itemId: m.post?.itemId ?? null,
    views: m.post?.reach ?? null,
    linked: m.linked,
    keptBigger: m.keptBigger,
  };
  try {
    for (const userId of await deps.owner.ownerIds(deps.ownerWallets)) await deps.owner.queue(userId, { kind: 'outage', subject: `missed-runner|${m.coin.address}`, rung: 0, facts, href: '/#/alerts' });
  } catch (e) {
    deps.log.error('missed runners: the owner alert could not be queued', { address: m.coin.address, err: errorText(e) });
  }
}
