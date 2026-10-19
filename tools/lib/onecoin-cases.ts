/**
 * ONE POST, ONE COIN, REPLAYED: the posts the matcher gave candidates in a window, each with its
 * candidates' stored trade minutes and market readings, and the real coin — the owner's call when
 * he made one (internal.owner_feedback coin_match: right with its coin, or "No coin is from this"),
 * else the biggest candidate an hour after its launch when that is at least the truth's floor.
 *
 * Shared by tools/onecoin-replay.ts (prints), tools/onecoin-refit.ts (proposes bars) and
 * tools/onecoin-shadow.ts (the truth beside each shadow pick), so "the real coin" is one thing in
 * all three. Read-only.
 *
 * ★ A POST WITH NO MEASURED CANDIDATE AT +1 H AND NO OWNER CALL IS LEFT OUT, never counted as
 * "nothing ran": an unmeasured coin is not a coin that did not run.
 *
 * What breaks if changed carelessly: the owner's "wrong" calls. A coin he called wrong is never the
 * +1 h truth, even when it was the biggest: otherwise the refit learns to pick the coins he rejects.
 */

import type { ReplayCase, ReplayCoin } from '../../core/src/index.ts';
import type { MatchEvidence } from '../../core/src/match/one-coin.ts';
import { PgOneCoinRepo, type Db } from '../../store/src/index.ts';

const HALF_HOUR_MS = 1_800_000;

export interface CaseBars {
  readonly truthAtMs: number;
  readonly truthMinCapUsd: number;
  readonly watchMs: number;
}

export interface Truth {
  /** The real coin; null when nothing ran (or the owner said no coin is from it). */
  readonly address: string | null;
  readonly by: 'owner' | 'owner_none' | 'plus_1h' | 'nothing_ran';
}

export interface LoadedCases {
  readonly cases: readonly ReplayCase[];
  readonly truths: ReadonlyMap<string, Truth>;
  /** Whether any candidate has trade minutes: the replay judges on trades, else on readings. */
  readonly useTrades: boolean;
  readonly posts: number;
  readonly unmeasured: number;
}

interface CandRow {
  item_id: string;
  address: string;
  path: 'launch' | 'existing';
  evidence: Record<string, unknown>;
  launched_at: string | null;
  found_at: string;
}

const ms = (v: string | null): number | null => (v === null ? null : new Date(v).getTime());

/** The owner's newest coin call per post: his coin, "none", and the coins he called wrong. */
export async function ownerCalls(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, { readonly right: string | null; readonly none: boolean; readonly wrong: ReadonlySet<string> }>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db.query<{ item_id: string; verdict: string; coin_address: string | null }>(
    `select item_id, verdict, coin_address from internal.owner_feedback
      where subject_kind = 'coin_match' and item_id = any($1::text[]) order by created_at`,
    [[...itemIds]],
  );
  const out = new Map<string, { right: string | null; none: boolean; wrong: Set<string> }>();
  for (const r of rows) {
    const c = out.get(r.item_id) ?? { right: null, none: false, wrong: new Set<string>() };
    if (r.verdict === 'right' && r.coin_address !== null) Object.assign(c, { right: r.coin_address, none: false });
    else if (r.verdict === 'none') Object.assign(c, { right: null, none: true });
    else if (r.verdict === 'wrong' && r.coin_address !== null) c.wrong.add(r.coin_address);
    else if (r.verdict === 'cleared') Object.assign(c, { right: null, none: false });
    out.set(r.item_id, c);
  }
  return out;
}

/** The cap nearest launch + `atMs`, within half an hour, from the minutes' USD caps and the readings. */
function capNear(c: ReplayCoin, atMs: number): number | null {
  if (c.launchedAtMs === null) return null;
  const goal = (c.existingSinceMs ?? c.launchedAtMs) + atMs;
  const points = [
    ...c.readings.map((r) => [r.atMs, r.capUsd] as const),
    ...c.minutes.flatMap((m) => (m.capUsd === null ? [] : [[m.atMs, m.capUsd] as const])),
  ].filter(([t]) => Math.abs(t - goal) <= HALF_HOUR_MS);
  points.sort((a, b) => Math.abs(a[0] - goal) - Math.abs(b[0] - goal));
  return points[0]?.[1] ?? null;
}

export async function loadCases(db: Db, fromMs: number, toMs: number, bars: CaseBars): Promise<LoadedCases> {
  const rows = await db.query<CandRow>(
    `select item_id, address, path, evidence, launched_at, found_at from internal.one_coin_candidate
      where found_at >= $1 and found_at < $2 order by item_id, found_at`,
    [new Date(fromMs).toISOString(), new Date(toMs).toISOString()],
  );
  const repo = new PgOneCoinRepo(db);
  const addresses = [...new Set(rows.map((r) => r.address))];
  const since = fromMs - bars.watchMs;
  const minutes = await repo.tradeMinutes(addresses, since);
  const readings = await repo.readings(addresses, since);
  const byPost = new Map<string, CandRow[]>();
  for (const r of rows) byPost.set(r.item_id, [...(byPost.get(r.item_id) ?? []), r]);
  const calls = await ownerCalls(db, [...byPost.keys()]);

  const cases: ReplayCase[] = [];
  const truths = new Map<string, Truth>();
  let unmeasured = 0;
  for (const [itemId, rs] of byPost) {
    const coins: ReplayCoin[] = rs.map((r) => {
      const t = r.evidence['ties'];
      const ties = (Array.isArray(t) ? t.filter((x): x is MatchEvidence => typeof x === 'string') : []) as MatchEvidence[];
      return {
        address: r.address,
        launchedAtMs: ms(r.launched_at),
        existingSinceMs: r.path === 'existing' ? new Date(r.found_at).getTime() : null,
        evidence: r.path === 'existing' ? [...ties, 'existing'] : ties,
        minutes: minutes.filter((m) => m.address === r.address),
        readings: readings.filter((x) => x.address === r.address).map((x) => ({ atMs: x.atMs, capUsd: x.capUsd })),
      };
    });
    const call = calls.get(itemId);
    let truth: Truth | null = null;
    if (call?.right) truth = { address: call.right, by: 'owner' };
    else if (call?.none) truth = { address: null, by: 'owner_none' };
    else {
      const measured = coins.filter((c) => !(call?.wrong.has(c.address) ?? false)).map((c) => ({ a: c.address, cap: capNear(c, bars.truthAtMs) })).filter((x): x is { a: string; cap: number } => x.cap !== null);
      if (measured.length === 0) {
        unmeasured += 1;
        continue;
      }
      const best = measured.sort((a, b) => b.cap - a.cap)[0]!;
      truth = best.cap >= bars.truthMinCapUsd ? { address: best.a, by: 'plus_1h' } : { address: null, by: 'nothing_ran' };
    }
    truths.set(itemId, truth);
    cases.push({ subject: itemId, coins, truth: truth.address });
  }
  return { cases, truths, useTrades: minutes.length > 0, posts: byPost.size, unmeasured };
}
