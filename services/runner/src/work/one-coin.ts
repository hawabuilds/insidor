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
 *            The coin-first route's coins (Policy.rising.coinFirst) are matched again for the whole
 *            watch: their post is judged only once the coin runs, after the rematch window. And
 *            each is tied to the original the route walked to from the post it links (0118).
 *   existing a post new to this process whose coin already exists (it was launched more than
 *            `launchLeadMs` before the post): the biggest coin of its exact name with a recent
 *            reading over the bar (core `biggestOfName`), and beside it the most traded coins
 *            launched within `existing.lookbackMs` before the post that its names or its own words
 *            tie, with no reading bar (core `priorCoins`) — each a candidate judged from now.
 *   decide   every post with a candidate found or launched within `watchMs`, and every open
 *            narrative one of them belongs to (over all its posts' candidates): the rule on the
 *            trade feed's minutes when it is running, else on market readings — the pick's
 *            evidence says which, with the reason "no trade data" — written with every change of
 *            coin recorded (coin_pick_change). A post whose pick the runner hand-over wrote is
 *            left to that rule.
 *   early    on the same pass, before the posts' picks are written: a coin made for the post, under
 *            $20K and rising five times every rival of its launch wave, takes the pick and the owner
 *            is told (work/early-pick.ts, Policy.oneCoin.early); held against this rule's "waiting".
 *   hand over every Policy.runnerLink.handover.everyMs, each held post pick against the later coins
 *            made for the post that run now (work/runner-handover.ts): a pick held on a dead first
 *            coin goes to the runner.
 *
 * ★ THE STATED NAME (Policy.runnerLink.stated, core match/stated-name.ts). A launch carrying a post's
 * whole stated name and ticker ties it up to two days after the post, and a post new to this process
 * is also matched against the coins launched since it was posted that carry its stated name — the
 * launch path met those before the post was ours. Once such a coin clears the bars, every look-alike
 * is out of the pick (core `behindStated`). Except on a post the owner made a coin call on: there
 * the stated tie is dropped before judging, so his word is never re-opened by it.
 *
 * ★ SHADOW AND LIVE WRITE THE SAME. Policy.oneCoin.mode only decides whether the cards and pushes
 * read the pick (services/project, services/notify); here it is recorded on each change so the
 * shadow report can tell shadow picks from live ones.
 *
 * What breaks if changed carelessly: the holder. Each judgement starts from the coin stored for the
 * subject; judging without it would hand a coin over on any rival's lead instead of three times its
 * own, and the card would flip between coins every pass. The holder's `underShareSinceMs` rides in
 * the pick's evidence: dropped, every pass would start the rug grace afresh and a held coin that
 * crashed would never be let go.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { biggestOfName, launchMatches, oneCoinBars, pickOneCoin, priorCoins, racingCoins, statedInText, statesName, type Contender, type OneCoinHolder as Holder, type LaunchMatch, type MarketFacts, type MatchEvidence, type OneCoinOutcome } from '@insidor/core';
import type { CandidateRow, CandleCap, PgOneCoinRepo, PickWrite, RecentLaunch, RecentPost, StoredPick, TradeRollup } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';
import { HASH_VERSION } from './picture-hash.ts';
import { decideEarly, holdEarly, tellEarly, type EarlyDecision, type EarlyPickDeps, type EarlyRecord } from './early-pick.ts';
import { heldByRunner, runnerHandoverPass, type Handover, type RunnerHandoverDeps } from './runner-handover.ts';

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
  readonly repo: Pick<PgOneCoinRepo, 'recentLaunches' | 'recentPosts' | 'postsByIds' | 'similarities' | 'unembedded' | 'upsertCandidates' | 'watch' | 'openCandidates' | 'candidatesOf' | 'narrativesOf' | 'tradeFeedAt' | 'watched' | 'tradeFacts' | 'marketFacts' | 'coinsNamed' | 'coinsLaunchedBetween' | 'picks' | 'writePicks' | 'appliedFit'> & Partial<Pick<PgOneCoinRepo, 'heldPostPicks' | 'waitingPostPicks' | 'lastHours' | 'launchesLinking' | 'coinFacts' | 'frozenPrices' | 'heldFrozenNarrativePicks'>>;
  /**
   * The coin-first route's launches (store `coinFirstLaunches`): coins tying a post the route recorded,
   * looked at for the whole watch rather than `rematchMs`, since such a post is judged only once its
   * coin runs. Absent: none, as before 2026-10-20.
   */
  readonly coinFirstLaunches?: (sinceMs: number, limit: number, hashVersion: string) => Promise<readonly RecentLaunch[]>;
  /**
   * The posts of these ids the owner made a coin call on ("Right coin", "Wrong coin", "No coin"):
   * their stated-name tie is never used, so the call stands. Absent: none.
   */
  readonly ownerCalled?: (itemIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /**
   * The runner hand-over's own reads (work/runner-handover.ts, Policy.runnerLink.handover): the held
   * post picks and the coins' last hours. Absent: no hand-over step, as before policy.v160.
   */
  readonly handover?: Pick<RunnerHandoverDeps, 'heldPostPicks' | 'lastHours'>;
  /**
   * The early pick's reads and its push (work/early-pick.ts, Policy.oneCoin.early). Absent: no early
   * pick is made, as before policy.v163 — an early pick already held is still kept by its discipline.
   */
  readonly early?: EarlyPickDeps;
  /**
   * Of these post-and-coin pairs, the ones the judge said are about different subjects (store 0151,
   * work/coin-post-check.ts), as `item|address`. Only a name-only candidate is dropped on it. Absent: none.
   */
  readonly refused?: (pairs: readonly { readonly itemId: string; readonly address: string }[]) => Promise<ReadonlySet<string>>;
  /**
   * Our own candles' caps for these launchpad coins (store `PgCandleCapRepo`, Policy.oneCoin.candles):
   * read once every `readEveryMs`, and laid over the readings the rule judges on. Absent: readings alone.
   */
  readonly candleCaps?: (addresses: readonly string[], sinceMs: number) => Promise<ReadonlyMap<string, CandleCap>>;
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
  /** When the runner hand-over step last ran: it runs every Policy.runnerLink.handover.everyMs, not every pass. */
  handoverAt: number;
  /** When every post of the window last met the coins linking it (`LINK_RECHECK_MS`). */
  linkingAt: number;
  /** Our candles' caps, and when they were read (Policy.oneCoin.candles.readEveryMs). */
  candleCaps: { readonly atMs: number; readonly caps: ReadonlyMap<string, CandleCap> } | null;
}

export const newOneCoinState = (): OneCoinState => ({ postsReadAt: 0, posts: [], existingDone: new Set(), watchMissingSaid: false, handoverAt: 0, linkingAt: 0, candleCaps: null });

/**
 * How often every post of the window meets the coins linking it (a post new to the pass meets them at
 * once). Five minutes: a coin we start charting is a candidate within that, and the read returns the
 * same few coins each time, about 20 over six hours of posts.
 */
const LINK_RECHECK_MS = 5 * 60_000;

/** A launchpad coin's address ends so (services/read trade-card.ts): only its supply is known, and so only its candle is a cap. */
const LAUNCHPAD_SUFFIX = 'pump';
const MINUTE_MS = 60_000;

/**
 * ★ OUR CANDLES OVER THE READINGS (Policy.oneCoin.candles). Each coin with a candle closed at most
 * `freshMs` ago is judged on its close and its highest close, with no pool figure (a launchpad coin's
 * cap is known, not quoted); every other coin keeps its reading.
 */
export function withCandleCaps(market: ReadonlyMap<string, MarketFacts & { readonly readAtMs: number; readonly liquidityUsd: number | null }>, caps: ReadonlyMap<string, CandleCap>, nowMs: number, freshMs: number): ReadonlyMap<string, MarketFacts & { readonly readAtMs: number; readonly liquidityUsd: number | null }> {
  if (caps.size === 0) return market;
  const out = new Map(market);
  for (const [a, k] of caps) {
    const closedAt = k.atMs + MINUTE_MS;
    if (nowMs - closedAt > freshMs || k.capUsd <= 0) continue;
    out.set(a, { capUsd: k.capUsd, peakCapUsd: Math.max(k.peakCapUsd, k.capUsd), readAtMs: Math.min(closedAt, nowMs), liquidityUsd: null });
  }
  return out;
}

export interface OneCoinResult {
  readonly launches: number;
  readonly candidates: number;
  readonly existing: number;
  readonly judged: number;
  readonly changed: number;
  readonly basis: 'trades' | 'market_readings' | null;
  /** The runner hand-overs this pass wrote (empty on a pass the step did not run). */
  readonly handovers: readonly Handover[];
  /** The early picks this pass wrote. */
  readonly early: readonly { readonly itemId: string; readonly address: string; readonly capUsd: number; readonly ageMs: number }[];
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

/**
 * ★ THE SECOND PATH'S OLDER COINS WHOSE QUOTE IS FROZEN, flagged on their market facts (core
 * match/one-coin.ts `priceFrozen`, the owner, 2026-11-09: $trump read $64k for two days on one trade).
 * Asked only for coins a post holds through the second path, so no other coin's facts change; a repo
 * without `frozenPrices` flags nothing. Run before `withCandleCaps`: a fresh candle of our own is a
 * trade, and its facts replace the flagged reading's.
 */
export async function withFrozenPrices<M extends MarketFacts>(repo: Pick<OneCoinDeps['repo'], 'frozenPrices'>, rows: readonly CandidateRow[], market: ReadonlyMap<string, M>): Promise<ReadonlyMap<string, M>> {
  if (repo.frozenPrices === undefined) return market;
  const older = [...new Set(rows.filter((r) => r.path === 'existing').map((r) => r.address))].filter((a) => market.has(a));
  if (older.length === 0) return market;
  const frozen = await repo.frozenPrices(older);
  if (frozen.size === 0) return market;
  const out = new Map(market);
  for (const a of frozen) {
    const m = out.get(a);
    if (m !== undefined) out.set(a, { ...m, priceFrozen: true });
  }
  return out;
}

/** The held coin's own standing in its stored pick names it an older coin (the second path's `existing` tie). */
const heldOlder = (p: StoredPick): boolean => {
  const standings = p.evidence['standings'];
  if (!Array.isArray(standings)) return false;
  const own = standings.find((x: unknown) => typeof x === 'object' && x !== null && (x as Record<string, unknown>)['address'] === p.address) as Record<string, unknown> | undefined;
  return Array.isArray(own?.['ties']) && (own['ties'] as unknown[]).includes('existing');
};

/**
 * ★ THE NARRATIVE HALF OF THE FROZEN-PRICE SWEEP. A narrative's pick is judged only while one of its
 * posts is inside its hour, so $trump's TRUMP narrative kept the frozen coin after its post's own pick
 * let it go. Every pass, the held narrative picks whose coin's newest reading is frozen (one light
 * query that returns only those) are judged again by the same rule on their members' candidates; a
 * coin made for the post is untouched by the flag, so its narrative keeps it. Returns how many changed.
 */
export async function frozenNarrativeSweep(
  repo: OneCoinDeps['repo'],
  judgedNow: ReadonlySet<string>,
  judge: (rs: readonly CandidateRow[], prev: StoredPick | undefined, facts?: { trades: ReadonlyMap<string, TradeRollup> | null; watched: ReadonlySet<string>; market: ReadonlyMap<string, MarketFacts> }) => OneCoinOutcome,
  now: number,
  P: OneCoinDeps['policy']['oneCoin'],
  /** The pass's SOL price over every open coin (solPriceOf), as the rug sweep takes it. */
  solUsd: number | null = null,
): Promise<number> {
  if (repo.heldFrozenNarrativePicks === undefined) return 0;
  const held = (await repo.heldFrozenNarrativePicks(now - RUG_SWEEP_MS, RUG_SWEEP_LIMIT)).filter((h) => !judgedNow.has(h.pick.subjectId) && h.members.length > 0);
  if (held.length === 0) return 0;
  const rows = await repo.candidatesOf([...new Set(held.flatMap((h) => h.members))]);
  const addresses = [...new Set(rows.map((r) => r.address))];
  const { trades, watched, market: read } = await factsOf(repo, addresses, now, { marketSinceMs: now - RUG_SWEEP_MS, trades: true, hoursSinceMs: null });
  const market = await withFrozenPrices(repo, rows, read);
  const facts = { trades: trades === null ? null : withDollarCaps(trades, market, solUsd ?? solPriceOf(trades, market)), watched, market };
  const byItem = new Map<string, CandidateRow[]>();
  for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  const prev = new Map(held.map((h) => [h.pick.subjectId, h.pick] as const));
  const writes = held.flatMap((h) => {
    const rs = h.members.flatMap((m) => byItem.get(m) ?? []);
    return rs.length === 0 ? [] : [pickWrite(h.pick.subjectId, judge(rs, h.pick, facts), h.pick, now, P.mode)];
  });
  return writes.length === 0 ? 0 : repo.writePicks('narrative', writes, prev, P.mode, now);
}

/** How far back the rug sweep looks for held picks, and how many it reads a pass. */
const RUG_SWEEP_MS = 2 * 86_400_000;
const RUG_SWEEP_LIMIT = 200;

/**
 * ★ THE RUG SWEEP (the owner, 2026-10-26, $DOUPI: "now showing the one that rugged at 2k"). A post is
 * judged only while its candidates are inside `oneCoin.watchMs` of being found, so a pick made at
 * minute 18 stood frozen on its coin once the hour passed, whatever the coin did next: $DOUPI (BEc9…)
 * fell from 941 SOL to 20 in a minute and the card kept it. Every pass, the held picks of the last
 * two days that the open posts above did not judge are looked at, and the ones whose coin has
 * crashed on the live trades (under `rugShareOfPeak` of its peak) are judged again by the same rule
 * on all their candidates: the floor drops a rug, the crash switch hands a coin made for the post
 * worth twice it the pick. A held coin that has not crashed is left as it is. Returns how many changed.
 */
export async function rugSweep(
  repo: OneCoinDeps['repo'],
  judgedNow: ReadonlySet<string>,
  judge: (rs: readonly CandidateRow[], prev: StoredPick | undefined, facts?: { trades: ReadonlyMap<string, TradeRollup> | null; watched: ReadonlySet<string>; market: ReadonlyMap<string, MarketFacts> }) => OneCoinOutcome,
  now: number,
  P: OneCoinDeps['policy']['oneCoin'],
  /** The pass's SOL price over every open coin (solPriceOf): a sweep's few coins are too few to set one. */
  solUsd: number | null = null,
): Promise<number> {
  if (repo.heldPostPicks === undefined) return 0;
  const held = (await repo.heldPostPicks(now - RUG_SWEEP_MS, RUG_SWEEP_LIMIT)).filter((p) => !judgedNow.has(p.subjectId) && p.address !== null);
  if (held.length === 0) return 0;
  const heldTrades = await repo.tradeFacts(held.map((p) => p.address as string));
  if (heldTrades === null) return 0;
  const crashedOnTrades = held.filter((p) => {
    const t = heldTrades.get(p.address as string);
    return t !== undefined && t.cap !== null && t.peakCap !== null && t.peakCap > 0 && t.cap < P.rugShareOfPeak * t.peakCap;
  });
  /* ★ And a held older coin whose quote is frozen (`withFrozenPrices`): it never trades, so it never crashes on trades. */
  const olderHeld = held.filter((p) => !crashedOnTrades.includes(p) && heldOlder(p));
  const frozenHeld = repo.frozenPrices === undefined || olderHeld.length === 0 ? new Set<string>() : await repo.frozenPrices(olderHeld.map((p) => p.address as string));
  const crashed = [...crashedOnTrades, ...olderHeld.filter((p) => frozenHeld.has(p.address as string))];
  if (crashed.length === 0) return 0;
  const rows = await repo.candidatesOf(crashed.map((p) => p.subjectId));
  const addresses = [...new Set(rows.map((r) => r.address))];
  const { trades, watched, market: read } = await factsOf(repo, addresses, now, { marketSinceMs: now - RUG_SWEEP_MS, trades: true, hoursSinceMs: null });
  const market = await withFrozenPrices(repo, rows, read);
  const facts = { trades: trades === null ? null : withDollarCaps(trades, market, solUsd ?? solPriceOf(trades, market)), watched, market };
  const byItem = new Map<string, CandidateRow[]>();
  for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  const prev = new Map(crashed.map((p) => [p.subjectId, p] as const));
  const writes = crashed.flatMap((p) => {
    const rs = byItem.get(p.subjectId);
    return rs === undefined || rs.length === 0 ? [] : [pickWrite(p.subjectId, judge(rs, p, facts), p, now, P.mode)];
  });
  return writes.length === 0 ? 0 : repo.writePicks('post', writes, prev, P.mode, now);
}

/**
 * A list of coins' watch, market, and optionally trades and last hour: in one statement through the
 * store (`coinFacts`, which sends the list once), or by the separate reads where a repo has none.
 */
async function factsOf(repo: OneCoinDeps['repo'], addresses: readonly string[], now: number, opts: { readonly marketSinceMs: number; readonly trades: boolean; readonly hoursSinceMs: number | null }) {
  if (repo.coinFacts !== undefined) return repo.coinFacts(addresses, now, opts);
  const [watched, market, trades, hours] = await Promise.all([
    repo.watched(addresses, now),
    repo.marketFacts(addresses, opts.marketSinceMs),
    opts.trades ? repo.tradeFacts(addresses) : Promise.resolve(null),
    opts.hoursSinceMs === null || repo.lastHours === undefined ? Promise.resolve(null) : repo.lastHours(addresses, opts.hoursSinceMs),
  ]);
  return { watched, market, trades, hours };
}

/** How far back the waiting sweep looks, how many posts it judges a pass, and the trade peak (in the quote token) a candidate needs. */
const WAITING_SWEEP_MS = 2 * 86_400_000;
const WAITING_SWEEP_LIMIT = 1_000;
export const WAITING_SWEEP_MIN_PEAK_QUOTE = 100;
/* Only readings this fresh count: a coin read hours ago at its peak ($DX1MhZ… read $41k at 03:10 and
   was at $2.7k by 10:40) must never be picked on that number. Ninety minutes: the market service reads
   each of these coins about once an hour (services/market db.ts `waitingCoins`). */
const WAITING_FRESH_MS = 90 * 60_000;

/**
 * ★ THE WAITING SWEEP (the owner, 2026-10-27, "paws at you": about thirty coins in ten minutes, the pick
 * "waiting, under the bars" at 01:58, and $paws Fp4Jkq… bonding at 04:13 and running to $44k with the
 * card still showing nothing). A post is judged only while its candidates are inside
 * `oneCoin.watchMs` of being found, so a post left waiting at the hour's end was never judged again,
 * whatever its coins did next. Every pass, the waiting posts of the last two days that the open posts
 * above did not judge, and that have a candidate whose trades peaked at
 * `WAITING_SWEEP_MIN_PEAK_QUOTE` or more, are judged again by the same rule on all their candidates,
 * on the market readings the market service keeps fresh for exactly these coins (services/market
 * db.ts `pickedCoins`). Only a pick is written: a post still waiting is left as it was, so its
 * decided time does not move. Returns how many changed.
 */
export async function waitingSweep(
  repo: OneCoinDeps['repo'],
  judgedNow: ReadonlySet<string>,
  judge: (rs: readonly CandidateRow[], prev: StoredPick | undefined, facts?: { trades: ReadonlyMap<string, TradeRollup> | null; watched: ReadonlySet<string>; market: ReadonlyMap<string, MarketFacts> }) => OneCoinOutcome,
  now: number,
  P: OneCoinDeps['policy']['oneCoin'],
): Promise<number> {
  if (repo.waitingPostPicks === undefined) return 0;
  const waiting = (await repo.waitingPostPicks(now - WAITING_SWEEP_MS, WAITING_SWEEP_LIMIT, WAITING_SWEEP_MIN_PEAK_QUOTE)).filter((p) => !judgedNow.has(p.subjectId));
  if (waiting.length === 0) return 0;
  const rows = await repo.candidatesOf(waiting.map((p) => p.subjectId));
  const addresses = [...new Set(rows.map((r) => r.address))];
  /* ★ ON FRESH READINGS ALONE. The coin watcher follows a coin's trades only while it is watched, so
     hours later its trade state is the state it had then (Fp4Jkq…'s last trade on file is 02:25, two
     hours before it bonded): judged on that, a coin that ran later would look like it never did. */
  const { watched, market: fresh, hours } = await factsOf(repo, addresses, now, { marketSinceMs: now - WAITING_FRESH_MS, trades: false, hoursSinceMs: repo.lastHours === undefined && repo.coinFacts === undefined ? null : now - WAITING_FRESH_MS });
  /* ★ ONLY A COIN THAT TRADED IN ITS LAST HOUR. A market source can keep answering a curve that
     stopped trading at its old price: $DX1MhZ… read $41,261 with $0 traded for nine hours while its
     trades had fallen to about $2k. Without a last hour that traded, a reading is not a price. */
  const market = hours === null ? fresh : new Map([...fresh].filter(([a]) => (hours.get(a)?.volume1hUsd ?? 0) > 0));
  const facts = { trades: null, watched, market };
  const byItem = new Map<string, CandidateRow[]>();
  for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  const prev = new Map(waiting.map((p) => [p.subjectId, p] as const));
  const writes = waiting.flatMap((p) => {
    const rs = byItem.get(p.subjectId);
    if (rs === undefined || rs.length === 0) return [];
    const o = judge(rs, p, facts);
    return o.kind === 'picked' ? [pickWrite(p.subjectId, o, p, now, P.mode)] : [];
  });
  return writes.length === 0 ? 0 : repo.writePicks('post', writes, prev, P.mode, now);
}

/** Pairs needed before the trades' caps are given a dollar value: fewer, and one odd reading would set it. */
const MIN_PRICE_PAIRS = 5;

/**
 * ★ THE TRADES' CAPS IN DOLLARS (the owner, 2026-10-26, $DOUPI: "now showing the one that rugged at
 * 2k"). The trade feed knows each coin's cap in SOL, live, and never in dollars, so every dollar bar
 * of the rule — the $10k floor that ends a held coin's grace, the keep bar, the crash switch, PvP —
 * fell back to the coin's market reading, which for a coin on its curve can stand still for an hour
 * after the curve is emptied: $DOUPI (BEc9…) read $41,293 six times while its trades said 20 SOL,
 * about $2k, and the card kept it. The SOL price is the median, over the coins read both ways, of the
 * reading's dollars over the trades' SOL — a median, so a frozen reading is outvoted — and every
 * trade rollup without a dollar cap gets its SOL cap times that. Too few pairs: unchanged.
 */
export function withDollarCaps(trades: ReadonlyMap<string, TradeRollup>, market: ReadonlyMap<string, MarketFacts>, solUsd: number | null = solPriceOf(trades, market)): ReadonlyMap<string, TradeRollup> {
  if (solUsd === null) return trades;
  return new Map([...trades].map(([a, t]) => [a, t.capUsd === null && t.cap !== null ? { ...t, capUsd: t.cap * solUsd } : t] as const));
}

/** The SOL price the coins read both ways agree on (the median); null with too few of them. */
export function solPriceOf(trades: ReadonlyMap<string, TradeRollup>, market: ReadonlyMap<string, MarketFacts>): number | null {
  const ratios = [...trades].flatMap(([a, t]) => {
    const m = market.get(a);
    return t.cap !== null && t.cap > 0 && m !== undefined && m.capUsd > 0 ? [m.capUsd / t.cap] : [];
  }).sort((x, y) => x - y);
  return ratios.length < MIN_PRICE_PAIRS ? null : ratios[Math.floor(ratios.length / 2)]!;
}

/** The pick row for an outcome: the coin and since when, or no coin; the standings as the evidence. */
export function pickWrite(subjectId: string, o: OneCoinOutcome, prev: StoredPick | undefined, nowMs: number, mode: 'shadow' | 'live'): PickWrite {
  if (o.kind === 'none') return { subjectId, address: null, outcome: 'none', decidedAtMs: prev?.outcome === 'none' ? prev.decidedAtMs : nowMs, evidence: { mode, reason: 'no_candidates' }, basis: null };
  const note = o.basis === 'market_readings' ? 'no trade data: judged on market readings' : null;
  const standings = o.standings.map((s) => ({ address: s.address, ties: s.evidence, visible: s.visible, measured: s.measured, strength: s.strength, uniqueBuyers: s.uniqueBuyers, capUsd: s.capUsd, out: s.out, clears: s.clears }));
  if (o.kind === 'waiting') {
    return { subjectId, address: null, outcome: 'waiting', decidedAtMs: prev?.outcome === 'waiting' ? prev.decidedAtMs : nowMs, evidence: { mode, basis: o.basis, reason: o.reason, droppedHolder: o.droppedHolder, note, standings }, basis: o.basis };
  }
  /* ★ The crash switch's coin is pushed like a runner hand-over (notify launch.ts): the mark stays while the pick does. */
  const crash = o.crash === true || (prev?.address === o.address && prev.evidence['crash_handover'] === true);
  return { subjectId, address: o.address, outcome: 'picked', decidedAtMs: o.sinceMs, evidence: { mode, basis: o.basis, confirmed: o.confirmed, handedOverFrom: o.handedOverFrom, underShareSinceMs: o.underShareSinceMs, note, standings, ...(crash ? { crash_handover: true } : {}) }, basis: o.basis };
}

/**
 * The coin a subject holds, from its stored pick: the coin, since when, and since when it has been
 * under the rug share on grace (written by `pickWrite`, so the grace survives a restart).
 */
export function holderOf(prev: StoredPick | undefined): Holder | null {
  if (prev?.outcome !== 'picked' || prev.address === null) return null;
  const under = prev.evidence['underShareSinceMs'];
  return { address: prev.address, sinceMs: prev.decidedAtMs, underShareSinceMs: typeof under === 'number' && Number.isFinite(under) ? under : null };
}

/** The ties that prove more than a name: a candidate holding one is never dropped on the judge's "no". */
const PROVING_TIES: ReadonlySet<string> = new Set(['link', 'picture', 'missed_runner']);

/**
 * ★ A NAME-ONLY CANDIDATE THE JUDGE SAID IS ABOUT SOMETHING ELSE IS OUT (Policy.oneCoin.postCheck): the
 * "vanilla" coins of @AFP's video on a post about a dog called Vanilla. Only "no" drops it — unsure, not
 * asked or no answer keeps it — and never a candidate tied by a link, a picture or a missed runner.
 */
export async function withoutRefused(deps: Pick<OneCoinDeps, 'refused' | 'log'>, rows: readonly CandidateRow[]): Promise<readonly CandidateRow[]> {
  if (deps.refused === undefined || rows.length === 0) return rows;
  const nameOnly = (r: CandidateRow): boolean => {
    const ties = r.evidence['ties'];
    return Array.isArray(ties) && !ties.some((t) => typeof t === 'string' && PROVING_TIES.has(t));
  };
  let refused: ReadonlySet<string>;
  try {
    refused = await deps.refused(rows.filter(nameOnly).map((r) => ({ itemId: r.itemId, address: r.address })));
  } catch (e) {
    deps.log.error('one coin: the judge\'s coin-post answers not read; every candidate is judged', { err: errorText(e) });
    return rows;
  }
  return refused.size === 0 ? rows : rows.filter((r) => !(nameOnly(r) && refused.has(`${r.itemId}|${r.address}`)));
}

/** The pass's repo with its two candidate reads filtered by the judge's "no"; every other read as it is. */
function refusing(deps: OneCoinDeps): OneCoinDeps['repo'] {
  const base = deps.repo;
  if (deps.refused === undefined) return base;
  return new Proxy(base, {
    get(target, key) {
      if (key === 'openCandidates') return async (...a: Parameters<typeof target.openCandidates>) => withoutRefused(deps, await target.openCandidates(...a));
      if (key === 'candidatesOf') return async (ids: readonly string[]) => withoutRefused(deps, await target.candidatesOf(ids));
      const v: unknown = Reflect.get(target, key);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export async function oneCoinPass(deps: OneCoinDeps, state: OneCoinState): Promise<OneCoinResult> {
  const P = deps.policy.oneCoin;
  const now = deps.now();
  /* ★ Every read of the candidates this pass makes — the decision, the narratives, both sweeps and the
     hand-over — goes through the judge's "no" (withoutRefused), so no path re-picks a refused coin. */
  const repo = refusing(deps);
  if (now - state.postsReadAt >= POSTS_REFRESH_MS) {
    state.posts = await repo.recentPosts(now - P.postWindowMs, POSTS_READ, HASH_VERSION);
    state.postsReadAt = now;
  }
  const posts = state.posts;
  const S = deps.policy.runnerLink.stated;
  const statedBars = S.on ? { minVariantLength: deps.policy.postCoin.minVariantLength, genericWords: S.genericWords, withinMs: S.withinMs } : undefined;
  const bars = { launchLeadMs: P.launchLeadMs, postWindowMs: P.postWindowMs, linkMaxAgeMs: P.linkMaxAgeMs, maxHashDistance: P.picture.maxHashDistance, minSimilarity: P.picture.minSimilarity, minVariantLength: deps.policy.postCoin.minVariantLength, ...(statedBars === undefined ? {} : { stated: statedBars }) };

  /* ── match: new launches to recent posts ─────────────────────────── */
  const recent = await repo.recentLaunches(now - P.rematchMs, P.perPass.launches, HASH_VERSION);
  /* ★ And the coin-first route's coins for the whole watch: their posts were judged after the rematch window. */
  const extra = deps.coinFirstLaunches !== undefined && deps.policy.rising.coinFirst.on ? await deps.coinFirstLaunches(now - P.watchMs, P.perPass.launches, HASH_VERSION) : [];
  const recentAddresses = new Set(recent.map((c) => c.address));
  /* A coin in both keeps the route's originals beside its own hop (store `coinFirstLaunches`: through the pointer it links). */
  const extraBy = new Map(extra.map((c) => [c.address, c] as const));
  const launches = [
    ...recent.map((c) => {
      const e = extraBy.get(c.address);
      return e === undefined ? c : { ...c, linksThrough: [...c.linksThrough, ...e.linksThrough.filter((t) => !c.linksThrough.some((o) => o.itemId === t.itemId))] };
    }),
    ...extra.filter((c) => !recentAddresses.has(c.address)),
  ];
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
    const best = biggestOfName(p, older, { minVariantLength: bars.minVariantLength, readingWithinMs: P.existing.readingWithinMs, minCapUsd: P.existing.minCapUsd, minLiquidityUsd: P.minLiquidityUsd }, now);
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
    /* ★ A coin carrying the post's stated name, launched after the post but before it was ours: the launch path never met them. */
    if (statedBars !== undefined) {
      const stated = [...names, ...statedInText(p.text)];
      const since = await repo.coinsLaunchedBetween(stated, wordsOf(p.text), p.postedAtMs, Math.min(now, p.postedAtMs + statedBars.withinMs), PRIOR_COINS_READ);
      for (const c of since) {
        if (c.launchedAtMs === null || chosen.has(c.address) || !statesName(stated, c, statedBars)) continue;
        rows.push({ itemId: p.itemId, address: c.address, path: 'launch', evidence: { ties: ['name_stated'], capUsd: c.capUsd, launchedAfterMs: c.launchedAtMs - p.postedAtMs }, launchedAtMs: c.launchedAtMs, foundAtMs: now });
        watch.push({ address: c.address, untilMs: now + P.watchMs });
      }
    }
  }
  /* ★ THE COINS THAT LINK A POST (store `launchesLinking`). A coin launched within a minute of its post
     was matched only while the judge had not yet answered for the post, and never again: 28-29 Oct,
     $DMnMwU linked a post the judge called coinable 41 minutes after we saw the coin and ran to $285k
     sixteen hours later, never the post's candidate. Each post new to this pass, and every
     `LINK_RECHECK_MS` every post of the window (a coin we start charting later), meets the coins whose
     own link names it, by the launch path's own rule (`launchMatches`); a pair already a candidate is
     left as it is, its ties and its watch untouched. 22-29 Oct: about 105 pairs a week, 6 of them
     coins that ran past $25k. */
  if (repo.launchesLinking !== undefined) {
    const recheck = now - state.linkingAt >= LINK_RECHECK_MS;
    const these = recheck ? posts : fresh;
    if (recheck) state.linkingAt = now;
    if (these.length > 0) {
      const linking = await repo.launchesLinking(these.map((p) => p.itemId), P.perPass.launches, HASH_VERSION);
      if (linking.length > 0) {
        const had = new Set([...rows, ...(await repo.candidatesOf(these.map((p) => p.itemId)))].map((r) => `${r.itemId}|${r.address}`));
        for (const c of linking) {
          for (const m of launchMatches(sideOf(c, noSimilarity), these, bars)) {
            if (!m.evidence.includes('link') || had.has(`${m.itemId}|${c.address}`)) continue;
            had.add(`${m.itemId}|${c.address}`);
            rows.push({ itemId: m.itemId, address: c.address, path: 'launch', evidence: evidenceOf(m), launchedAtMs: c.launchedAtMs, foundAtMs: now });
            watch.push({ address: c.address, untilMs: now + P.watchMs });
          }
        }
      }
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
  const [{ trades, watched, market }, feedAt, fit] = await Promise.all([
    factsOf(repo, addresses, now, { marketSinceMs: now - P.postWindowMs - P.watchMs, trades: true, hoursSinceMs: null }),
    repo.tradeFeedAt(),
    repo.appliedFit(),
  ]);
  const running = trades !== null && feedAt !== null && now - feedAt <= P.tradeFeedFreshMs;
  /* ★ Our candles over the readings (withCandleCaps), read at most once a `readEveryMs`; a failed read keeps the readings. */
  if (P.candles.on && deps.candleCaps !== undefined && (state.candleCaps === null || now - state.candleCaps.atMs >= P.candles.readEveryMs)) {
    try {
      state.candleCaps = { atMs: now, caps: await deps.candleCaps(addresses.filter((a) => a.endsWith(LAUNCHPAD_SUFFIX)), now - P.postWindowMs - P.watchMs) };
    } catch (e) {
      state.candleCaps = { atMs: now, caps: new Map() };
      deps.log.error('one coin: our candles were not read; the pick is judged on readings this minute', { err: errorText(e) });
    }
  }
  const flagged = await withFrozenPrices(repo, allRows, market);
  const ruled = P.candles.on && state.candleCaps !== null ? withCandleCaps(flagged, state.candleCaps.caps, now, P.candles.freshMs) : flagged;
  /* ★ The trades' caps in dollars (withDollarCaps): never a stale reading's when the trades are live. */
  const solUsd = trades === null ? null : solPriceOf(trades, market);
  const tradesUsd = trades === null ? null : withDollarCaps(trades, market, solUsd);
  const ruleBars = oneCoinBars(P, fit);
  const judge = (rs: readonly CandidateRow[], prev: StoredPick | undefined, facts?: { trades: ReadonlyMap<string, TradeRollup> | null; watched: ReadonlySet<string>; market: ReadonlyMap<string, MarketFacts> }): OneCoinOutcome =>
    facts === undefined
      ? pickOneCoin(contendersOf(rs, running ? tradesUsd : null, watched, ruled), holderOf(prev), now, running, ruleBars)
      : pickOneCoin(contendersOf(rs, running ? facts.trades : null, facts.watched, facts.market), holderOf(prev), now, running, ruleBars);
  /* ★ The owner's coin call stands: his posts are judged without the stated-name tie. */
  const called = deps.ownerCalled === undefined || byPost.size === 0 ? new Set<string>() : await deps.ownerCalled([...byPost.keys()]);
  const withoutStated = (rs: readonly CandidateRow[]): CandidateRow[] => rs.map((r) => (Array.isArray(r.evidence['ties']) && r.evidence['ties'].includes('name_stated') ? { ...r, evidence: { ...r.evidence, ties: r.evidence['ties'].filter((t: unknown) => t !== 'name_stated') } } : r));

  const prevPosts = await repo.picks('post', [...byPost.keys()]);
  /* ★ A pick the runner hand-over wrote is that rule's (work/runner-handover.ts): judged here again on first-hour buying, it would go straight back. */
  const open1 = [...byPost].filter(([id]) => !heldByRunner(prevPosts.get(id)));
  /* ★ The early pick (work/early-pick.ts): a coin made for the post, under $20K and rising five times every rival. Never over his call. */
  let early: readonly EarlyDecision[] = [];
  if (deps.early !== undefined && deps.policy.oneCoin.early.on) {
    try {
      early = await decideEarly(new Map(open1.filter(([id]) => !called.has(id))), market, prevPosts, deps.early, deps.policy, now);
    } catch (e) {
      deps.log.error('one coin: the early pick failed; the posts are judged as before', { err: errorText(e) });
    }
  }
  const earlyIds = new Set(early.map((d) => d.itemId));
  /* ★ An early pick is held against this rule's "waiting", and its record kept on every later write (early-pick.ts `holdEarly`). */
  /* ★ The race (core match/coin-race.ts): the coins made for the post that broke away together, kept
     on the pick's evidence so the card can offer them all ("See 2 coins"); off, nothing is written. */
  const raceBars = { ...P.race, rugShareOfPeak: P.rugShareOfPeak, creatorDumpShareOfPeak: P.creatorDumpShareOfPeak };
  const byId = new Map(open1);
  const withRace = (w: PickWrite): PickWrite => {
    const rs = byId.get(w.subjectId);
    if (!P.race.on || rs === undefined) return w;
    const racing = racingCoins(contendersOf(rs, running ? tradesUsd : null, watched, ruled), now, raceBars);
    return racing.length === 0 ? w : { ...w, evidence: { ...w.evidence, racing } };
  };
  const judged = open1.filter(([id]) => !earlyIds.has(id)).map(([id, rs]) => pickWrite(id, judge(called.has(id) ? withoutStated(rs) : rs, prevPosts.get(id)), prevPosts.get(id), now, P.mode));
  const launchedOf = new Map(open.filter((r) => r.launchedAtMs !== null).map((r) => [r.address, r.launchedAtMs] as const));
  const postPicks = [...holdEarly(judged, prevPosts, launchedOf, deps.policy.oneCoin.early.rivalWithinMs), ...early.map((d) => d.write)].map(withRace);
  const changedPosts = await repo.writePicks('post', postPicks, prevPosts, P.mode, now);
  if (early.length > 0 && deps.early !== undefined) {
    for (const d of early) deps.log.info('early pick', { itemId: d.itemId, address: d.pick.address, capUsd: d.pick.capUsd, ageMs: d.pick.ageMs, riseUsd: d.pick.riseUsd, rivalRiseUsd: d.pick.rivalRiseUsd, rivals: d.pick.rivals, rivalsUnread: d.pick.rivalsUnread, told: (d.write.evidence['earlyPick'] as EarlyRecord).told });
    await tellEarly(early, deps.early, deps.log);
  }

  const rowsByItem = new Map<string, CandidateRow[]>();
  for (const r of allRows) rowsByItem.set(r.itemId, [...(rowsByItem.get(r.itemId) ?? []), r]);
  const prevNarratives = await repo.picks('narrative', [...narratives.keys()]);
  const narrativePicks = [...narratives].map(([id, members]) => {
    const rs = members.flatMap((m) => rowsByItem.get(m) ?? []);
    return pickWrite(id, judge(rs, prevNarratives.get(id)), prevNarratives.get(id), now, P.mode);
  });
  const changedNarratives = await repo.writePicks('narrative', narrativePicks, prevNarratives, P.mode, now);

  /* ── the rug sweep: a held pick past its hour whose coin crashed ── */
  const swept = await rugSweep(repo, new Set(byPost.keys()), judge, now, P, solUsd);
  if (swept > 0) deps.log.info('one coin: the rug sweep moved held picks whose coin crashed', { changed: swept });
  const unfrozen = await frozenNarrativeSweep(repo, new Set(narratives.keys()), judge, now, P, solUsd);
  if (unfrozen > 0) deps.log.info('one coin: the narrative sweep let go of coins on a frozen price', { changed: unfrozen });
  /* ── the waiting sweep: a post left waiting at its hour's end whose coin ran later ── */
  const unstuck = await waitingSweep(repo, new Set(byPost.keys()), judge, now, P);
  if (unstuck > 0) deps.log.info('one coin: the waiting sweep picked a coin for posts left waiting', { changed: unstuck });

  /* ── hand over: a later coin made for a held post, running now ──── */
  let handovers: readonly Handover[] = [];
  const H = deps.policy.runnerLink.handover;
  if (deps.handover !== undefined && H.on && now - state.handoverAt >= H.everyMs) {
    state.handoverAt = now;
    try {
      handovers = await runnerHandoverPass({
        ...deps.handover,
        candidatesOf: (ids) => repo.candidatesOf(ids),
        ...(deps.ownerCalled === undefined ? {} : { ownerCalled: deps.ownerCalled }),
        writePicks: (picks, previous, mode, nowMs) => repo.writePicks('post', picks, previous, mode, nowMs),
        policy: deps.policy,
        log: deps.log,
        now: () => now,
      });
    } catch (e) {
      deps.log.error('one coin: the runner hand-over step failed; trying again next time', { err: errorText(e) });
    }
  }

  const changed = changedPosts + changedNarratives + handovers.length;
  const basis = byPost.size === 0 ? null : running ? 'trades' : 'market_readings';
  if (rows.length > 0 || changed > 0) {
    deps.log.info('one coin: launches matched and picks judged', { launches: launches.length, candidates: rows.length, existing, posts: postPicks.length, narratives: narrativePicks.length, changed, basis, mode: P.mode });
  }
  return { launches: launches.length, candidates: rows.length, existing, judged: postPicks.length + narrativePicks.length, changed, basis, handovers, early: early.map((d) => ({ itemId: d.itemId, address: d.pick.address, capUsd: d.pick.capUsd, ageMs: d.pick.ageMs })) };
}
