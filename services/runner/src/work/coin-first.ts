/**
 * THE COIN-FIRST ROUTE IN THE RUNNER (Policy.rising.coinFirst): a post a RUNNING coin's own link ties —
 * the post it names, or the post that one reposts or quotes — read by id if we do not hold it, judged
 * once if nobody has, and credited to the `coin_link` lane so For You reads it. Whether it then joins
 * For You is the projector's (services/project coin-first.ts): the judge's yes and the one-coin pick.
 *
 * Its own step in the finders loop, after the coin links and the instant judge, on its own clock
 * (`CHECK_EVERY_MS`): the coin links read a launch's document within seconds, but a coin is not
 * known to run until it has traded for minutes, and the pick waits `oneCoin.judgeFromMs` anyway.
 *
 * ★ MONEY ONLY FOR A COIN THAT COULD BE PICKED. A post is read or judged here only when one of the
 * coins tying it has traded at `oneCoin.minCapUsd` or more — the running rule's own cap bar, which no
 * pick can be made under. Replayed over 13-20 Oct that is about 115 coins a day of the ~13,000 that
 * link a post; judging every linked post at the link would have been 5,000 a day.
 *
 * ★ ONCE, AND CAPPED. Each post is read at most once and asked at most once by this route (0116 keeps
 * the times), and a UTC day's reads and asks stop at `fetchesPerDay` / `judgementsPerDay`, so a wave
 * of copycats linking one viral post costs one read and one answer, and a wave of different posts
 * cannot run past the day. Each is also bounded per pass (`perPass`). A dry run reads and asks
 * nothing and stamps nothing.
 *
 * ★ THE SAME JUDGE. The asks go to `scorePosts` over a queue of just these posts (as the instant
 * judge does): the same post judge, precedents, kind question and not-a-meme hold, past the view bar
 * because the running coin stands in for it.
 *
 * What breaks if changed carelessly: the credit. For You reads only posts some lane credits; a post
 * this route judged and did not credit could never be shown, however its coin ran.
 */

import type { Item, ItemId, Millis } from '@insidor/contracts';
import { itemId } from '@insidor/contracts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { coinFirstBars, coinFirstStep, firstTie, type CoinFirstStep } from '@insidor/core';
import type { CoinFirstRow, CoinFirstWrite, PgCoinFirstRepo, PgItemRepo } from '@insidor/store';

import type { Logger } from '../log.ts';
import { readMissing, type CoinLinkDeps } from './coin-links.ts';
import type { ScoringResult } from './score-posts.ts';

/** How often the route looks: the running bar is crossed minutes after a launch, never seconds. */
const CHECK_EVERY_MS = 15_000;
/** The tied posts read per pass at most: an hour of running coins was 9 on 20 Oct, a busy one a few hundred. */
const ROWS_READ = 2_000;
const DAY_MS = 86_400_000;

export interface CoinFirstDeps extends Pick<CoinLinkDeps, 'store' | 'meter' | 'mode' | 'log' | 'now'> {
  readonly repo: Pick<PgCoinFirstRepo, 'running' | 'spentSince' | 'record' | 'ties'>;
  readonly items: Pick<PgItemRepo, 'byIds' | 'markFoundBy'>;
  /** The sources, as the coin links build them (`handles` answers a post addressed by URL). */
  readonly sources: (handles: (source: string, sourceItemId: string) => string | null) => readonly PlatformAdapter[];
  /** The scoring pass over exactly this queue, each post past the view bar (coin-instant.ts `instantItems`). */
  readonly score: (queue: readonly Item[]) => Promise<ScoringResult>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface CoinFirstState {
  lastAt: number;
}

export const newCoinFirstState = (): CoinFirstState => ({ lastAt: 0 });

export interface CoinFirstResult {
  readonly posts: number;
  readonly fetched: number;
  readonly judged: number;
  readonly credited: number;
  readonly usd: number;
}

const NONE: CoinFirstResult = { posts: 0, fetched: 0, judged: 0, credited: 0, usd: 0 };

/** One row per post: the earliest-launched running coin tying it (the rows come oldest launch first). */
export function byPost(rows: readonly CoinFirstRow[]): readonly CoinFirstRow[] {
  const out = new Map<string, CoinFirstRow>();
  for (const r of rows) {
    const had = out.get(r.itemId);
    if (had === undefined || r.launchedAtMs < had.launchedAtMs) out.set(r.itemId, r);
  }
  return [...out.values()];
}

/** Each post's next step (core `coinFirstStep`). */
export function stepsOf(rows: readonly CoinFirstRow[], policy: Policy): readonly { readonly row: CoinFirstRow; readonly step: CoinFirstStep }[] {
  const bars = coinFirstBars(policy);
  return rows.map((row) => ({
    row,
    step: coinFirstStep({ held: row.held, postedAtMs: row.postedAtMs, launchedAtMs: row.launchedAtMs, judged: row.judged, credited: row.credited, fetchAsked: row.fetchAskedAtMs !== null, judgeAsked: row.judgeAskedAtMs !== null }, bars),
  }));
}

/** How many more of each the day allows, at most `perPass`. */
export function room(spent: { readonly fetches: number; readonly judgements: number }, policy: Policy): { readonly fetches: number; readonly judgements: number } {
  const c = policy.rising.coinFirst;
  return { fetches: Math.max(0, Math.min(c.perPass, c.fetchesPerDay - spent.fetches)), judgements: Math.max(0, Math.min(c.perPass, c.judgementsPerDay - spent.judgements)) };
}

export async function coinFirstPass(deps: CoinFirstDeps, state: CoinFirstState): Promise<CoinFirstResult> {
  const c = deps.policy.rising.coinFirst;
  if (!c.on) return NONE;
  const now = deps.now();
  if (now - state.lastAt < CHECK_EVERY_MS) return NONE;
  state.lastAt = now;

  const rows = byPost(await deps.repo.running((now - c.lookbackMs) as Millis, deps.policy.oneCoin.minCapUsd, ROWS_READ));
  if (rows.length === 0) return NONE;
  const steps = stepsOf(rows, deps.policy);
  const live = deps.mode === 'live';
  const left = room(await deps.repo.spentSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis), deps.policy);

  /* 1. Read by id what we do not hold, once each. */
  const toFetch = steps.filter((s) => s.step === 'fetch').slice(0, left.fetches).map((s) => s.row);
  const handles = new Map<string, string>();
  const sources = deps.sources((source, id) => handles.get(`${source}:${id}`) ?? null);
  const wanted = new Map<string, { adapter: PlatformAdapter; sourceItemId: string }>();
  for (const r of toFetch) {
    const adapter = sources.find((a) => String(a.id) === r.source);
    if (adapter === undefined) continue;
    const parsed = r.link === null ? null : adapter.parseLink?.(r.link) ?? null;
    if (parsed?.kind === 'post' && parsed.handle !== undefined) handles.set(`${r.source}:${r.sourceItemId}`, parsed.handle);
    wanted.set(r.itemId, { adapter, sourceItemId: r.sourceItemId });
  }
  const read = wanted.size === 0 ? { usd: 0, postsRead: 0 } : await readMissing(deps, wanted, wanted.size, 'posts running coins link');

  /* 2. Ask the judge once about what nobody has answered. */
  const toJudge = steps.filter((s) => s.step === 'judge').slice(0, left.judgements).map((s) => s.row);
  const held = toJudge.length === 0 ? new Map<ItemId, Item>() : await deps.items.byIds(toJudge.map((r) => r.itemId as ItemId));
  const queue = toJudge.flatMap((r) => {
    const item = held.get(r.itemId as ItemId);
    return item === undefined ? [] : [item];
  });
  const scored = queue.length === 0 ? null : await deps.score(queue);

  /* 3. Credit what has an answer, so For You reads it. */
  const toCredit = steps.filter((s) => s.step === 'credit').map((s) => s.row);
  if (live && toCredit.length > 0) await deps.items.markFoundBy(toCredit.map((r) => itemId(r.source as never, r.sourceItemId)), 'coin_link', deps.now());

  /* 4. The record: the coin that brought each post, its first coin, and what was paid for. */
  const touched = steps.filter((s) => s.step !== 'out_of_age' && s.step !== 'gone').map((s) => s.row);
  const ties = await deps.repo.ties(touched.map((r) => r.itemId));
  const fetchedIds = new Set(live ? [...wanted.keys()] : []);
  const judgedIds = new Set(live ? queue.map((i) => String(i.itemId)) : []);
  const creditedIds = new Set(live ? toCredit.map((r) => r.itemId) : []);
  const writes: CoinFirstWrite[] = touched.map((r) => ({
    itemId: r.itemId,
    address: r.address,
    launchedAtMs: r.launchedAtMs,
    via: r.via,
    firstCoinAddress: firstTie([...(ties.get(r.itemId) ?? []), { address: r.address, launchedAtMs: r.launchedAtMs }])?.address ?? null,
    fetchAsked: fetchedIds.has(r.itemId),
    judgeAsked: judgedIds.has(r.itemId),
    credited: creditedIds.has(r.itemId),
  }));
  await deps.repo.record(writes, deps.now());

  const result = { posts: rows.length, fetched: read.postsRead, judged: scored?.scored ?? 0, credited: creditedIds.size, usd: read.usd + (scored?.spentUsd ?? 0) };
  if (wanted.size > 0 || queue.length > 0 || creditedIds.size > 0) {
    deps.log.info('coin-first route: posts running coins link', { ...result, askedToRead: wanted.size, askedToJudge: queue.length });
  }
  return result;
}
