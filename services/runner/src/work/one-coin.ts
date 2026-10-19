/**
 * ONE POST, ONE COIN, IN THE RUNNER: every few seconds, new launches matched to the posts of the
 * last hours, their trades watched, and every open post's and narrative's single coin judged again
 * (core match/one-coin.ts), written to internal.post_coin_pick and narrative_coin_pick (0113).
 *
 * ★ WHY THE RUNNER AND NOT THE PROJECTOR. The decision has to be made within seconds of a launch and
 * re-made on every trade update; the projector runs a frame a minute inside one transaction and may
 * not call anything, while the matcher may pay to embed a picture and must register coins with the
 * trade feed (internal.coin_watch, 0112) the moment they become candidates — the runner's own job
 * shape, on its own supervised loop (loops/one-coin.ts) so a slow pass here never holds up discovery
 * or the judge. The projector only READS the pick, and only in `live` mode.
 *
 * One pass:
 *   match    launches of the last `rematchMs` (metadata and picture hashes arrive seconds to
 *            minutes after a launch, so each is looked at again until then) against the coinable
 *            posts of the last `postWindowMs`: link, exact judge/namer name, picture hash, and the
 *            picture's embedding where both are embedded. A name or link hit whose picture is not
 *            embedded is embedded now (the existing paid path, work/coin-match.ts), at most
 *            `perPass.embeds`, and compared on a later pass. Candidates written, coins watched
 *            until launch + `watchMs`. A post a launch LINKS — itself, or through the quote or
 *            re-share the coin links — is read by id whatever its age (core: a link is not bound
 *            by the window).
 *   existing a post new to this process whose coin already exists (it was launched more than
 *            `launchLeadMs` before the post): the biggest coin of its exact name with a recent
 *            reading over the bar (core `biggestOfName`), and beside it the most traded coins
 *            launched within `existing.lookbackMs` before the post that its names or its own words
 *            tie, with no reading bar (core `priorCoins`) — each a candidate judged from now.
 *   decide   every post with a candidate found or launched within `watchMs`, and every open
 *            narrative one of them belongs to (over all its posts' candidates): the rule on the
 *            trade feed's minutes when it is running, else on market readings — the pick's
 *            evidence says which, with the reason "no trade data" — written with every change of
 *            coin recorded (coin_pick_change).
 *
 * ★ SHADOW AND LIVE WRITE THE SAME. Policy.oneCoin.mode only decides whether the cards and pushes
 * read the pick (services/project, services/notify); here it is recorded on each change so the
 * shadow report can tell shadow picks from live ones.
 *
 * What breaks if changed carelessly: the holder. Each judgement starts from the coin stored for the
 * subject; judging without it would hand a coin over on any rival's lead instead of three times its
 * own, and the card would flip between coins every pass.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { biggestOfName, launchMatches, oneCoinBars, pickOneCoin, priorCoins, type Contender, type LaunchMatch, type MarketFacts, type MatchEvidence, type OneCoinOutcome } from '@insidor/core';
import type { CandidateRow, PgOneCoinRepo, PickWrite, RecentLaunch, RecentPost, StoredPick, TradeRollup } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';
import { HASH_VERSION } from './picture-hash.ts';

/** The recent posts are read again this often, not every pass: a launch is rematched for minutes, so a post judged since is still met. */
const POSTS_REFRESH_MS = 30_000;
/** The recent posts read at most: six hours of coinable posts was about 650 on 19 Oct. */
const POSTS_READ = 5_000;
/** How many coins of a name the second path reads before core picks the biggest. */
const NAMED_COINS_READ = 50;
/**
 * How many coins of the lookback a post reads before core keeps the tied ones: a post's words are
 * looked up as tickers, and a common word is the ticker of dozens of coins in two days.
 */
const PRIOR_COINS_READ = 500;
/** A post's words looked up as tickers, at most: a long post's tail adds lookups, not subjects. */
const WORDS_READ = 64;

/** A post's distinct words of two letters or more, as the ticker lookup reads them. */
const wordsOf = (text: string | null): string[] =>
  text === null ? [] : [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))].slice(0, WORDS_READ);

export interface OneCoinDeps {
  readonly repo: Pick<PgOneCoinRepo, 'recentLaunches' | 'recentPosts' | 'postsByIds' | 'similarities' | 'unembedded' | 'upsertCandidates' | 'watch' | 'openCandidates' | 'candidatesOf' | 'narrativesOf' | 'tradeFeedAt' | 'watched' | 'tradeFacts' | 'marketFacts' | 'coinsNamed' | 'coinsLaunchedBetween' | 'picks' | 'writePicks' | 'appliedFit'>;
  /** The paid picture path (work/coin-match.ts `embedCoinPictures`); absent: pictures are compared by hash only. */
  readonly embed?: (coins: readonly { readonly assetKey: string; readonly uri: string }[]) => Promise<number>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

/** What one process remembers between passes: the recent posts and which it has given the second path. */
export interface OneCoinState {
  postsReadAt: number;
  posts: readonly RecentPost[];
  existingDone: Set<string>;
  watchMissingSaid: boolean;
}

export const newOneCoinState = (): OneCoinState => ({ postsReadAt: 0, posts: [], existingDone: new Set(), watchMissingSaid: false });

export interface OneCoinResult {
  readonly launches: number;
  readonly candidates: number;
  readonly existing: number;
  readonly judged: number;
  readonly changed: number;
  readonly basis: 'trades' | 'market_readings' | null;
}

const evidenceOf = (m: LaunchMatch): Record<string, unknown> => ({ ties: m.evidence, hashDistance: m.hashDistance, similarity: m.similarity, launchedAfterMs: m.launchedAfterMs, ...(m.linkedThrough === null ? {} : { linkedThrough: m.linkedThrough }) });

/** A launch as the matcher reads it: its links as sets, the one-hop originals by the post that reaches them. */
const sideOf = (c: RecentLaunch, similarity: ReadonlyMap<string, number>) => ({
  ...c,
  linksPosts: new Set(c.linksPosts),
  linksThrough: new Map(c.linksThrough.map((t) => [t.itemId, t.via] as const)),
  similarity,
});

/** The ties a stored candidate carries, as core's evidence words. */
function tiesOf(c: CandidateRow): MatchEvidence[] {
  const t = c.evidence['ties'];
  const ties = Array.isArray(t) ? t.filter((x): x is MatchEvidence => typeof x === 'string') : [];
  return c.path === 'existing' && !ties.includes('existing') ? [...ties, 'existing'] : ties;
}

/** Contenders from candidate rows (a narrative's may name a coin twice: the ties are merged, the earliest find kept). */
export function contendersOf(rows: readonly CandidateRow[], trades: ReadonlyMap<string, TradeRollup> | null, watched: ReadonlySet<string>, market: ReadonlyMap<string, MarketFacts>): Contender[] {
  const by = new Map<string, { rows: CandidateRow[] }>();
  for (const r of rows) by.set(r.address, { rows: [...(by.get(r.address)?.rows ?? []), r] });
  return [...by].map(([address, { rows: rs }]) => {
    const existing = rs.every((r) => r.path === 'existing') ? Math.min(...rs.map((r) => r.foundAtMs)) : null;
    const t = trades?.get(address);
    return {
      address,
      launchedAtMs: rs.find((r) => r.launchedAtMs !== null)?.launchedAtMs ?? null,
      existingSinceMs: existing,
      evidence: [...new Set(rs.flatMap(tiesOf))],
      trades: t !== undefined ? t : trades !== null && watched.has(address) ? 'quiet' : null,
      market: market.get(address) ?? null,
    };
  });
}

/** The pick row for an outcome: the coin and since when, or no coin; the standings as the evidence. */
export function pickWrite(subjectId: string, o: OneCoinOutcome, prev: StoredPick | undefined, nowMs: number, mode: 'shadow' | 'live'): PickWrite {
  if (o.kind === 'none') return { subjectId, address: null, outcome: 'none', decidedAtMs: prev?.outcome === 'none' ? prev.decidedAtMs : nowMs, evidence: { mode, reason: 'no_candidates' }, basis: null };
  const note = o.basis === 'market_readings' ? 'no trade data: judged on market readings' : null;
  const standings = o.standings.map((s) => ({ address: s.address, ties: s.evidence, visible: s.visible, measured: s.measured, strength: s.strength, uniqueBuyers: s.uniqueBuyers, capUsd: s.capUsd, out: s.out, clears: s.clears }));
  if (o.kind === 'waiting') {
    return { subjectId, address: null, outcome: 'waiting', decidedAtMs: prev?.outcome === 'waiting' ? prev.decidedAtMs : nowMs, evidence: { mode, basis: o.basis, reason: o.reason, droppedHolder: o.droppedHolder, note, standings }, basis: o.basis };
  }
  return { subjectId, address: o.address, outcome: 'picked', decidedAtMs: o.sinceMs, evidence: { mode, basis: o.basis, confirmed: o.confirmed, handedOverFrom: o.handedOverFrom, note, standings }, basis: o.basis };
}

export async function oneCoinPass(deps: OneCoinDeps, state: OneCoinState): Promise<OneCoinResult> {
  const P = deps.policy.oneCoin;
  const now = deps.now();
  const { repo } = deps;
  if (now - state.postsReadAt >= POSTS_REFRESH_MS) {
    state.posts = await repo.recentPosts(now - P.postWindowMs, POSTS_READ, HASH_VERSION);
    state.postsReadAt = now;
  }
  const posts = state.posts;
  const bars = { launchLeadMs: P.launchLeadMs, postWindowMs: P.postWindowMs, linkMaxAgeMs: P.linkMaxAgeMs, maxHashDistance: P.picture.maxHashDistance, minSimilarity: P.picture.minSimilarity, minVariantLength: deps.policy.postCoin.minVariantLength };

  /* ── match: new launches to recent posts ─────────────────────────── */
  const launches = await repo.recentLaunches(now - P.rematchMs, P.perPass.launches, HASH_VERSION);
  /* A linked post older than the window is read by id: only a link may reach it. */
  const known = new Set(posts.map((p) => p.itemId));
  const linkedIds = [...new Set(launches.flatMap((c) => [...c.linksPosts, ...c.linksThrough.map((t) => t.itemId)]))].filter((id) => !known.has(id));
  const matchable = linkedIds.length === 0 ? posts : [...posts, ...(await repo.postsByIds(linkedIds, HASH_VERSION))];
  const noSimilarity = new Map<string, number>();
  const firstLook = launches.map((c) => ({ c, matches: launchMatches(sideOf(c, noSimilarity), matchable, bars) }));
  /* The embedding is compared only where a name or link tied the coin: read what is held, embed what is not. */
  const pairs = firstLook.flatMap(({ c, matches }) => matches.filter((m) => m.evidence.some((e) => e !== 'picture')).map((m) => ({ assetKey: c.assetKey, itemId: m.itemId })));
  const sims = await repo.similarities(pairs, deps.policy.group.image.space);
  const rows: CandidateRow[] = [];
  const wantPictures = new Map<string, string>();
  const watch: { address: string; untilMs: number }[] = [];
  for (const { c, matches } of firstLook) {
    if (matches.length === 0) continue;
    const similarity = new Map(matches.flatMap((m) => {
      const s = sims.get(`${c.assetKey}|${m.itemId}`);
      return s === undefined ? [] : [[m.itemId, s] as const];
    }));
    const final = similarity.size === 0 ? matches : launchMatches(sideOf(c, similarity), matchable, bars);
    for (const m of final) {
      rows.push({ itemId: m.itemId, address: c.address, path: 'launch', evidence: evidenceOf(m), launchedAtMs: c.launchedAtMs, foundAtMs: now });
      if (m.wantsPicture && c.imageUri !== null) wantPictures.set(c.assetKey, c.imageUri);
    }
    watch.push({ address: c.address, untilMs: c.launchedAtMs + P.watchMs });
  }

  /* ── existing: a new post whose coin already trades ──────────────── */
  let existing = 0;
  const fresh = posts.filter((p) => !state.existingDone.has(p.itemId)).slice(0, P.perPass.posts);
  for (const p of fresh) {
    state.existingDone.add(p.itemId);
    const names = [...p.judgeNames, ...p.guessNames];
    const coins = await repo.coinsNamed(names, NAMED_COINS_READ);
    /* Only a coin the launch path cannot reach: launched more than the lead before the post. */
    const older = coins.filter((c) => c.launchedAtMs !== null && c.launchedAtMs < p.postedAtMs - P.launchLeadMs);
    const best = biggestOfName(p, older, { minVariantLength: bars.minVariantLength, readingWithinMs: P.existing.readingWithinMs, minCapUsd: P.existing.minCapUsd }, now);
    const pool = await repo.coinsLaunchedBetween(names, wordsOf(p.text), p.postedAtMs - P.existing.lookbackMs, p.postedAtMs - P.launchLeadMs, PRIOR_COINS_READ);
    const prior = priorCoins(p, pool, { minVariantLength: bars.minVariantLength, launchLeadMs: P.launchLeadMs, lookbackMs: P.existing.lookbackMs, lookbackCoins: P.existing.lookbackCoins, minLiquidityUsd: P.minLiquidityUsd });
    const chosen = new Map<string, { launchedAtMs: number | null; capUsd: number | null; ties: MatchEvidence[] }>();
    if (best !== null) chosen.set(best.address, { launchedAtMs: best.launchedAtMs, capUsd: best.capUsd, ties: ['existing'] });
    for (const { coin, ties } of prior) chosen.set(coin.address, { launchedAtMs: coin.launchedAtMs, capUsd: coin.capUsd, ties: [...ties, 'existing'] });
    for (const [address, c] of chosen) {
      existing += 1;
      rows.push({ itemId: p.itemId, address, path: 'existing', evidence: { ties: c.ties, capUsd: c.capUsd, launchedAfterMs: c.launchedAtMs === null ? null : c.launchedAtMs - p.postedAtMs }, launchedAtMs: c.launchedAtMs, foundAtMs: now });
      watch.push({ address, untilMs: now + P.watchMs });
    }
  }
  /* A post that left the window is forgotten, so the set stays the window's size. */
  const inWindow = new Set(posts.map((p) => p.itemId));
  for (const id of state.existingDone) if (!inWindow.has(id)) state.existingDone.delete(id);

  await repo.upsertCandidates(rows, now);
  for (const until of new Set(watch.map((w) => w.untilMs))) {
    const ok = await repo.watch(watch.filter((w) => w.untilMs === until).map((w) => w.address), 'one_coin', now, until);
    if (!ok && !state.watchMissingSaid) {
      state.watchMissingSaid = true;
      deps.log.warn('trade feed watch list not there yet (0112); candidates are judged on market readings', {});
    }
  }
  if (deps.embed !== undefined && wantPictures.size > 0) {
    const missing = await repo.unembedded([...wantPictures.keys()], deps.policy.group.image.space);
    const due = [...wantPictures].filter(([k]) => missing.has(k)).slice(0, P.perPass.embeds).map(([assetKey, uri]) => ({ assetKey, uri }));
    if (due.length > 0) {
      try {
        await deps.embed(due);
      } catch (e) {
        deps.log.error('one coin: pictures not embedded; those coins are compared by hash only', { err: errorText(e) });
      }
    }
  }

  /* ── decide: every open post and its narratives ──────────────────── */
  const open = await repo.openCandidates(now - P.watchMs, P.perPass.subjects);
  const byPost = new Map<string, CandidateRow[]>();
  for (const r of open) byPost.set(r.itemId, [...(byPost.get(r.itemId) ?? []), r]);
  const narratives = await repo.narrativesOf([...byPost.keys()]);
  const memberRows = await repo.candidatesOf([...new Set([...narratives.values()].flat())].filter((m) => !byPost.has(m)));
  const allRows = [...open, ...memberRows];
  const addresses = [...new Set(allRows.map((r) => r.address))];
  const [trades, feedAt, watched, market, fit] = await Promise.all([
    repo.tradeFacts(addresses),
    repo.tradeFeedAt(),
    repo.watched(addresses, now),
    repo.marketFacts(addresses, now - P.postWindowMs - P.watchMs),
    repo.appliedFit(),
  ]);
  const running = trades !== null && feedAt !== null && now - feedAt <= P.tradeFeedFreshMs;
  const ruleBars = oneCoinBars(P, fit);
  const judge = (rs: readonly CandidateRow[], prev: StoredPick | undefined): OneCoinOutcome =>
    pickOneCoin(contendersOf(rs, running ? trades : null, watched, market), prev?.outcome === 'picked' && prev.address !== null ? { address: prev.address, sinceMs: prev.decidedAtMs } : null, now, running, ruleBars);

  const prevPosts = await repo.picks('post', [...byPost.keys()]);
  const postPicks = [...byPost].map(([id, rs]) => pickWrite(id, judge(rs, prevPosts.get(id)), prevPosts.get(id), now, P.mode));
  const changedPosts = await repo.writePicks('post', postPicks, prevPosts, P.mode, now);

  const rowsByItem = new Map<string, CandidateRow[]>();
  for (const r of allRows) rowsByItem.set(r.itemId, [...(rowsByItem.get(r.itemId) ?? []), r]);
  const prevNarratives = await repo.picks('narrative', [...narratives.keys()]);
  const narrativePicks = [...narratives].map(([id, members]) => {
    const rs = members.flatMap((m) => rowsByItem.get(m) ?? []);
    return pickWrite(id, judge(rs, prevNarratives.get(id)), prevNarratives.get(id), now, P.mode);
  });
  const changedNarratives = await repo.writePicks('narrative', narrativePicks, prevNarratives, P.mode, now);

  const changed = changedPosts + changedNarratives;
  const basis = byPost.size === 0 ? null : running ? 'trades' : 'market_readings';
  if (rows.length > 0 || changed > 0) {
    deps.log.info('one coin: launches matched and picks judged', { launches: launches.length, candidates: rows.length, existing, posts: postPicks.length, narratives: narrativePicks.length, changed, basis, mode: P.mode });
  }
  return { launches: launches.length, candidates: rows.length, existing, judged: postPicks.length + narrativePicks.length, changed, basis };
}
