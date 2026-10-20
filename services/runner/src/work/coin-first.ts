/**
 * THE COIN-FIRST ROUTE IN THE RUNNER (Policy.rising.coinFirst): a post a RUNNING coin's own link ties
 * — the original its linked post points at — read by id if we do not hold it, judged once if nobody
 * has, and credited to the `coin_link` lane so For You reads it. Whether it then joins For You is the
 * projector's (services/project coin-first.ts): the judge's yes and the one-coin pick.
 *
 * Its own step in the finders loop, after the coin links and the instant judge, on its own clock
 * (`CHECK_EVERY_MS`): the coin links read a launch's document within seconds, but a coin is not
 * known to run until it has traded for minutes, and the pick waits `oneCoin.judgeFromMs` anyway.
 *
 * ★ THE ORIGINAL, NEVER THE POINTER (`coinFirst.origin`, 0118). The coin's linked post is usually the
 * launcher's explanation of someone else's viral post. Each pass walks from it (core
 * match/coin-origin.ts `resolveOrigin`) — repost, quote, a post its links name, an earlier post with
 * the same video — reading by id what the walk needs and we do not hold (or a post whose links were
 * never read), and only the post the walk ends at is judged, credited and recorded as the original.
 * The linked post, and every post read on the way, is recorded as a `pointer`: never judged,
 * credited or admitted by the route. A linked post that is itself the viral post goes on as before.
 *
 * ★ MONEY ONLY FOR A COIN THAT COULD BE PICKED. A post is read or judged here only when one of the
 * coins tying it has traded at `oneCoin.minCapUsd` or more — the running rule's own cap bar, which no
 * pick can be made under. Replayed over 13-20 Oct that is about 115 coins a day of the ~13,000 that
 * link a post; judging every linked post at the link would have been 5,000 a day.
 *
 * ★ ONCE, AND CAPPED. Each post is read at most once and asked at most once by this route (0117 keeps
 * the times), and a UTC day's reads and asks stop at `fetchesPerDay` / `judgementsPerDay`, so a wave
 * of copycats linking one viral post costs one read and one answer, and a wave of different posts
 * cannot run past the day. Each is also bounded per pass (`perPass`). The walk's reads count against
 * the same cap. A dry run reads and asks nothing and stamps nothing.
 *
 * ★ THE SAME JUDGE. The asks go to `scorePosts` over a queue of just these posts (as the instant
 * judge does): the same post judge, precedents, kind question and not-a-meme hold, past the view bar
 * because the running coin stands in for it.
 *
 * What breaks if changed carelessly: the credit, and the role. For You reads only posts some lane
 * credits; a post this route judged and did not credit could never be shown, however its coin ran.
 * And a post recorded as an original is one For You may take: a pointer written as one is the
 * launcher's post on For You again.
 */

import type { Item, ItemId, Millis } from '@insidor/contracts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { coinFirstBars, coinFirstStep, firstTie, isLauncher, resolveOrigin, type CoinFirstStep, type OriginFacts, type OriginLookup, type OriginOutcome } from '@insidor/core';
import type { CoinFirstRow, CoinFirstWrite, CoinOriginPost, PgCoinFirstRepo, PgItemRepo } from '@insidor/store';

import type { Logger } from '../log.ts';
import { readMissing, type CoinLinkDeps } from './coin-links.ts';
import type { ScoringResult } from './score-posts.ts';

/** How often the route looks: the running bar is crossed minutes after a launch, never seconds. */
const CHECK_EVERY_MS = 15_000;
/** The tied posts read per pass at most: an hour of running coins was 9 on 20 Oct, a busy one a few hundred. */
const ROWS_READ = 2_000;
const DAY_MS = 86_400_000;

export interface CoinFirstDeps extends Pick<CoinLinkDeps, 'store' | 'meter' | 'mode' | 'log' | 'now'> {
  readonly repo: Pick<PgCoinFirstRepo, 'running' | 'spentSince' | 'record' | 'ties' | 'origins' | 'accounts' | 'resolves'>;
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
  /** Linked posts the walk recorded as pointers this pass (they point at an original, or are a launcher's). */
  readonly pointers: number;
  readonly usd: number;
}

const NONE: CoinFirstResult = { posts: 0, fetched: 0, judged: 0, credited: 0, pointers: 0, usd: 0 };

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

/** What the walk read: each linked post's outcome, the held posts on the way, and when the route read or asked about each. */
export interface Walk {
  readonly outcomes: ReadonlyMap<string, OriginOutcome>;
  readonly held: ReadonlyMap<string, CoinOriginPost>;
  readonly fetchAskedAtMs: ReadonlyMap<string, Millis>;
  readonly judgeAskedAtMs: ReadonlyMap<string, Millis>;
}

/**
 * The walk from every linked post to its original (core `resolveOrigin`), reading the store a round
 * at a time: each round asks for the posts the last one wanted and does not have yet, so a chain of
 * `maxDepth` hops takes as many rounds. A post whose links were never read is read again only when
 * `rereadLinks` is on, its text has a link, the store keeps links (0118) and the route has not read
 * it before; else its links count as none. `maxDepth` 0 takes every linked post as it is (before 0118,
 * when no pointer can be recorded).
 */
export async function walk(deps: Pick<CoinFirstDeps, 'repo' | 'policy'>, linked: readonly string[], nowMs: number, maxDepth: number): Promise<Walk> {
  const o = deps.policy.rising.coinFirst.origin;
  const bars = { maxDepth };
  const launcherBars = { minLinkedPosts: o.launcherMinLinkedPosts, minLinkedShare: o.launcherMinLinkedShare, maxFollowers: o.launcherMaxFollowers };
  const mediaSince = (nowMs - deps.policy.rising.coinFirst.lookbackMs - deps.policy.oneCoin.linkMaxAgeMs) as Millis;
  const held = new Map<string, CoinOriginPost>();
  const fetchAsked = new Map<string, Millis>();
  const judgeAsked = new Map<string, Millis>();
  const launcher = new Map<string, boolean>();
  const queried = new Set<string>();
  let kept = false;

  const lookup: OriginLookup = (id) => {
    const p = held.get(id);
    if (p === undefined) return queried.has(id) && fetchAsked.has(id) ? 'gone' : 'unread';
    const reread = o.rereadLinks && kept && p.hasLink && !fetchAsked.has(id);
    const facts: OriginFacts = { ...p, refersTo: p.refersTo ?? (reread ? null : []), launcher: launcher.get(p.authorKey) === true };
    return facts;
  };

  let outcomes = new Map<string, OriginOutcome>();
  let pending = [...new Set(linked)];
  for (let round = 0; round <= maxDepth + 1 && pending.length > 0; round += 1) {
    const got = await deps.repo.origins(pending, mediaSince);
    kept = got.referencesKept;
    for (const id of pending) queried.add(id);
    for (const [k, v] of got.held) held.set(k, v);
    for (const [k, v] of got.fetchAskedAtMs) fetchAsked.set(k, v);
    for (const [k, v] of got.judgeAskedAtMs) judgeAsked.set(k, v);
    const authors = [...new Set([...got.held.values()].map((p) => p.authorKey))].filter((a) => !launcher.has(a));
    const accounts = await deps.repo.accounts(authors, (nowMs - o.launcherLookbackMs) as Millis);
    for (const a of authors) launcher.set(a, isLauncher(accounts.get(a) ?? { posts: 0, linked: 0, followers: null }, launcherBars));
    outcomes = new Map(linked.map((id) => [id, resolveOrigin(id, lookup, bars)] as const));
    pending = [...new Set([...outcomes.values()].flatMap((r) => (r.kind === 'read' && !queried.has(r.itemId) ? [r.itemId] : [])))];
  }
  return { outcomes, held, fetchAskedAtMs: fetchAsked, judgeAskedAtMs: judgeAsked };
}

/** A post the route takes as the original for a coin: the coin, and the pointer it was reached from. */
interface Target {
  readonly itemId: string;
  readonly coin: CoinFirstRow;
  readonly pointer: string | null;
  readonly resolvedBy: string | null;
  readonly step: CoinFirstStep;
}

const split = (id: string): { readonly source: string; readonly sourceItemId: string } => {
  const at = id.indexOf(':');
  return { source: id.slice(0, at), sourceItemId: id.slice(at + 1) };
};

export async function coinFirstPass(deps: CoinFirstDeps, state: CoinFirstState): Promise<CoinFirstResult> {
  const c = deps.policy.rising.coinFirst;
  if (!c.on) return NONE;
  const now = deps.now();
  if (now - state.lastAt < CHECK_EVERY_MS) return NONE;
  state.lastAt = now;

  const rows = byPost(await deps.repo.running((now - c.lookbackMs) as Millis, deps.policy.oneCoin.minCapUsd, ROWS_READ));
  if (rows.length === 0) return NONE;
  const live = deps.mode === 'live';
  const left = room(await deps.repo.spentSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis), deps.policy);
  const bars = coinFirstBars(deps.policy);

  /* 0. The walk from each linked post to its original. */
  /* Before 0118 no pointer can be recorded: every linked post is taken as it is, as before. */
  const w = await walk(deps, rows.map((r) => r.itemId), now, (await deps.repo.resolves()) ? c.origin.maxDepth : 0);
  const targets = new Map<string, Target>();
  const reads = new Map<string, CoinFirstRow>();
  const pointers = new Map<string, CoinFirstRow>();
  for (const r of rows) {
    const out = w.outcomes.get(r.itemId);
    if (out === undefined || out.kind === 'gone') continue;
    if (out.kind === 'read') {
      if (!reads.has(out.itemId)) reads.set(out.itemId, r);
      if (out.itemId !== r.itemId) pointers.set(r.itemId, r);
      continue;
    }
    if (out.kind === 'pointer') {
      pointers.set(r.itemId, r);
      continue;
    }
    const itemId = out.kind === 'original' ? out.itemId : r.itemId;
    if (out.kind === 'original') pointers.set(r.itemId, r);
    const had = targets.get(itemId);
    if (had !== undefined && had.coin.launchedAtMs <= r.launchedAtMs) continue;
    const p = w.held.get(itemId);
    const step = coinFirstStep({
      held: p !== undefined, postedAtMs: p?.postedAtMs ?? null, launchedAtMs: r.launchedAtMs, judged: p?.judged ?? false, credited: p?.credited ?? false,
      fetchAsked: w.fetchAskedAtMs.has(itemId), judgeAsked: w.judgeAskedAtMs.has(itemId),
    }, bars);
    targets.set(itemId, { itemId, coin: r, pointer: out.kind === 'original' ? r.itemId : null, resolvedBy: out.kind === 'original' ? out.hops.join('>') : null, step });
  }
  /* A post the walk ended at for one coin is an original, whatever another coin's walk passed it as. */
  for (const id of targets.keys()) {
    pointers.delete(id);
    reads.delete(id);
  }

  /* 1. Read by id what the walk needs, once each: a post we do not hold, or one whose links were never read. */
  const toFetch = [...reads.entries()].filter(([id]) => !w.fetchAskedAtMs.has(id)).slice(0, left.fetches);
  const handles = new Map<string, string>();
  const sources = deps.sources((source, id) => handles.get(`${source}:${id}`) ?? null);
  const wanted = new Map<string, { adapter: PlatformAdapter; sourceItemId: string }>();
  const reread = new Set<string>();
  for (const [id, r] of toFetch) {
    const { source, sourceItemId } = split(id);
    const adapter = sources.find((a) => String(a.id) === source);
    if (adapter === undefined) continue;
    if (id === r.itemId) {
      const parsed = r.link === null ? null : adapter.parseLink?.(r.link) ?? null;
      if (parsed?.kind === 'post' && parsed.handle !== undefined) handles.set(`${source}:${sourceItemId}`, parsed.handle);
    }
    if (w.held.has(id)) reread.add(id);
    wanted.set(id, { adapter, sourceItemId });
  }
  const read = wanted.size === 0 ? { usd: 0, postsRead: 0 } : await readMissing(deps, wanted, wanted.size, 'posts running coins link', reread);

  /* 2. Ask the judge once about the originals nobody has answered. */
  const toJudge = [...targets.values()].filter((t) => t.step === 'judge').slice(0, left.judgements);
  const heldItems = toJudge.length === 0 ? new Map<ItemId, Item>() : await deps.items.byIds(toJudge.map((t) => t.itemId as ItemId));
  const queue = toJudge.flatMap((t) => {
    const item = heldItems.get(t.itemId as ItemId);
    return item === undefined ? [] : [item];
  });
  const scored = queue.length === 0 ? null : await deps.score(queue);

  /* 3. Credit the originals that have an answer, so For You reads them. */
  const toCredit = [...targets.values()].filter((t) => t.step === 'credit');
  if (live && toCredit.length > 0) await deps.items.markFoundBy(toCredit.map((t) => t.itemId as ItemId), 'coin_link', deps.now());

  /* 4. The record: each original with the coin that brought it and its pointer, each pointer, each post read on the way. */
  const kept = [...targets.values()].filter((t) => t.step !== 'out_of_age' && t.step !== 'gone');
  const ties = await deps.repo.ties([...kept.map((t) => t.itemId), ...pointers.keys(), ...reads.keys()]);
  const fetchedIds = new Set(live ? [...wanted.keys()] : []);
  const judgedIds = new Set(live ? queue.map((i) => String(i.itemId)) : []);
  const creditedIds = new Set(live ? toCredit.map((t) => t.itemId) : []);
  const first = (itemId: string, r: CoinFirstRow): string | null => firstTie([...(ties.get(itemId) ?? []), { address: r.address, launchedAtMs: r.launchedAtMs }])?.address ?? null;
  const writes: CoinFirstWrite[] = [
    ...kept.map((t) => ({
      itemId: t.itemId, address: t.coin.address, launchedAtMs: t.coin.launchedAtMs, via: t.pointer === null ? t.coin.via : ('hop' as const),
      firstCoinAddress: first(t.itemId, t.coin), fetchAsked: fetchedIds.has(t.itemId), judgeAsked: judgedIds.has(t.itemId), credited: creditedIds.has(t.itemId),
      role: 'original' as const, pointerItemId: t.pointer, resolvedBy: t.resolvedBy,
    })),
    ...[...new Set([...pointers.keys(), ...reads.keys()])].map((id) => {
      const r = pointers.get(id) ?? reads.get(id) as CoinFirstRow;
      return {
        itemId: id, address: r.address, launchedAtMs: r.launchedAtMs, via: id === r.itemId ? r.via : ('hop' as const),
        firstCoinAddress: first(id, r), fetchAsked: fetchedIds.has(id), role: 'pointer' as const,
      };
    }),
  ];
  await deps.repo.record(writes, deps.now());

  const result = { posts: rows.length, fetched: read.postsRead, judged: scored?.scored ?? 0, credited: creditedIds.size, pointers: pointers.size, usd: read.usd + (scored?.spentUsd ?? 0) };
  if (wanted.size > 0 || queue.length > 0 || creditedIds.size > 0) {
    deps.log.info('coin-first route: posts running coins link', { ...result, askedToRead: wanted.size, askedToJudge: queue.length });
  }
  return result;
}
