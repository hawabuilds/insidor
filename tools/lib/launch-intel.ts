/**
 * THE LAUNCH-INTELLIGENCE ARITHMETIC (the owner, 2026-11-08/09): smart wallets, launch teams, how often
 * launches like this rug within an hour, when coins that run peak, and copy-tests of using that in our
 * pushes and picks — all from the launch archive's files (chainwatch launch-archive.ts), never the
 * database. Pure: tools/launch-intel.ts reads the files and hands them over; launch-intel.test.ts drives
 * this on made-up launches.
 *
 * Its own file so the rules are tested apart from the bucket and the clock, and so the report the owner
 * reads and any later app surface compute the same numbers.
 *
 * ★ OWNER-ONLY. Nothing here reaches users; the owner decides metric by metric when it does.
 *
 * ★ COUNTS, NEVER A VERDICT. Every rate carries the number of launches it rests on; a group with fewer
 * than `MIN_GROUP` says "too few", and a launch whose outcome window was not fully watched
 * (`complete: false`) is left out of every rate rather than counted as quiet.
 *
 * What breaks if changed carelessly: the bot filter. A wallet that buys into a large share of all launches
 * (a sniper or an exchange) is early to every winner by volume alone; without the filter it tops the smart
 * list and links unrelated launches into one giant "team".
 */

import type { LaunchRecord, OutcomeRecord } from '../../adapters/storage/supabase/src/launch-archive.ts';

/** A launch "ran": graduated, or reached this cap within 24 hours. */
export const WINNER_CAP_USD = 100_000;
/** A launch "rugged within an hour": its 1-hour record has a crash (cap to 20% of a peak at least twice the opening). */
export const EARLY_MS = 10_000;
export const MIN_GROUP = 30;
/** Smart: early to at least this many winners, at least `SMART_LIFT`× the base win rate, and not a bot. */
export const SMART_MIN_WINS = 2;
export const SMART_LIFT = 3;
/** A wallet early to more launches than this in the window is a bot or an exchange: never smart, never a team link. */
export const BOT_MAX_LAUNCHES = 60;
/** Early wallets per launch used for team links (pairs among them). */
const TEAM_WALLETS = 5;

export interface Outcomes { readonly h1?: OutcomeRecord; readonly h24?: OutcomeRecord; readonly d7?: OutcomeRecord }

/** The wallets that bought within `EARLY_MS` of the launch, the creator left out, in order, distinct. */
export function earlyWallets(l: LaunchRecord): string[] {
  const out: string[] = [];
  const add = (w: string) => { if (w !== l.creator && !out.includes(w)) out.push(w); };
  if (l.minuteBuys !== null) for (const b of l.minuteBuys) { if (b.ms <= EARLY_MS) add(b.w); }
  else if (l.firstBuyers !== null) for (const w of l.firstBuyers) add(w);
  return out;
}

export const ran = (o: Outcomes, graduated: boolean): boolean =>
  graduated || (o.h24?.peakCapUsd ?? 0) >= WINNER_CAP_USD || (o.d7?.peakCapUsd ?? 0) >= WINNER_CAP_USD || o.h1?.graduatedAt != null || o.h24?.graduatedAt != null;
export const ruggedInHour = (o: Outcomes): boolean | null => (o.h1 === undefined || !o.h1.complete ? null : o.h1.crashAt !== null);

export interface Rate { readonly n: number; readonly hits: number; readonly pct: number | null }
export const rate = (hits: number, n: number): Rate => ({ n, hits, pct: n < MIN_GROUP ? null : Math.round((1000 * hits) / n) / 10 });

/* ── smart wallets ───────────────────────────────────────────────── */

export interface WalletTally { launches: number; wins: number }
export interface SmartWallet { readonly wallet: string; readonly launches: number; readonly wins: number; readonly lift: number }

export function tallyWallets(launches: Iterable<{ readonly early: readonly string[]; readonly won: boolean }>): { readonly tally: Map<string, WalletTally>; readonly n: number; readonly wins: number } {
  const tally = new Map<string, WalletTally>();
  let n = 0;
  let wins = 0;
  for (const l of launches) {
    n += 1;
    if (l.won) wins += 1;
    for (const w of l.early) {
      const t = tally.get(w) ?? { launches: 0, wins: 0 };
      t.launches += 1;
      if (l.won) t.wins += 1;
      tally.set(w, t);
    }
  }
  return { tally, n, wins };
}

export function smartWallets(t: ReturnType<typeof tallyWallets>): SmartWallet[] {
  const base = t.n === 0 ? 0 : t.wins / t.n;
  if (base === 0) return [];
  const out: SmartWallet[] = [];
  for (const [wallet, v] of t.tally) {
    if (v.launches > BOT_MAX_LAUNCHES || v.wins < SMART_MIN_WINS) continue;
    const lift = v.wins / v.launches / base;
    if (lift >= SMART_LIFT) out.push({ wallet, launches: v.launches, wins: v.wins, lift: Math.round(lift * 10) / 10 });
  }
  return out.sort((a, b) => b.wins - a.wins || b.lift - a.lift);
}

/* ── teams ───────────────────────────────────────────────────────── */

export interface TeamLaunch { readonly address: string; readonly creator: string | null; readonly funder: string | null; readonly early: readonly string[]; readonly won: boolean; readonly rug: boolean | null; readonly peakAt: number | null; readonly launchedAt: number }
export interface Team { readonly id: string; readonly launches: readonly string[]; readonly wins: number; readonly rugs: number; readonly rugKnown: number; readonly via: readonly ('creator' | 'funder' | 'wallets')[] }

class Union {
  private readonly parent: number[] = [];
  add(): number { this.parent.push(this.parent.length); return this.parent.length - 1; }
  find(i: number): number { let r = i; while (this.parent[r] !== r) r = this.parent[r] ?? r; let x = i; while (this.parent[x] !== r) { const nx = this.parent[x] ?? r; this.parent[x] = r; x = nx; } return r; }
  join(a: number, b: number): void { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.parent[rb] = ra; }
}

/**
 * Launches joined into teams: the same creator, the same creator funder, or two of the same early wallets
 * (bots left out). Only teams of two or more launches are returned, biggest first.
 */
export function buildTeams(launches: readonly TeamLaunch[], bots: ReadonlySet<string>): Team[] {
  const u = new Union();
  const idx = launches.map(() => u.add());
  const via = new Map<number, Set<'creator' | 'funder' | 'wallets'>>();
  const seen = new Map<string, number>();
  const link = (key: string, i: number, kind: 'creator' | 'funder' | 'wallets') => {
    const j = seen.get(key);
    if (j === undefined) { seen.set(key, i); return; }
    u.join(j, i);
    const r = u.find(i);
    const s = via.get(r) ?? new Set();
    s.add(kind);
    via.set(r, s);
  };
  launches.forEach((l, i) => {
    if (l.creator !== null) link(`c:${l.creator}`, idx[i]!, 'creator');
    if (l.funder !== null && !bots.has(l.funder)) link(`f:${l.funder}`, idx[i]!, 'funder');
    const w = l.early.filter((x) => !bots.has(x)).slice(0, TEAM_WALLETS).sort();
    for (let a = 0; a < w.length; a += 1) for (let b = a + 1; b < w.length; b += 1) link(`w:${w[a]}|${w[b]}`, idx[i]!, 'wallets');
  });
  const groups = new Map<number, number[]>();
  launches.forEach((_, i) => { const r = u.find(idx[i]!); const g = groups.get(r); if (g === undefined) groups.set(r, [i]); else g.push(i); });
  const kinds = new Map<number, Set<'creator' | 'funder' | 'wallets'>>();
  for (const [r, s] of via) { const root = u.find(r); const k = kinds.get(root) ?? new Set(); for (const x of s) k.add(x); kinds.set(root, k); }
  const teams: Team[] = [];
  for (const [r, members] of groups) {
    if (members.length < 2) continue;
    const ls = members.map((i) => launches[i]!);
    teams.push({
      id: ls.map((l) => l.address).sort()[0]!,
      launches: ls.map((l) => l.address),
      wins: ls.filter((l) => l.won).length,
      rugs: ls.filter((l) => l.rug === true).length,
      rugKnown: ls.filter((l) => l.rug !== null).length,
      via: [...(kinds.get(r) ?? [])].sort(),
    });
  }
  return teams.sort((a, b) => b.launches.length - a.launches.length);
}

/* ── rug within an hour, and what it says ────────────────────────── */

export interface RugFacts { readonly devSoldEarly: boolean | null; readonly blockShare: number | null; readonly devBuySol: number | null; readonly buyers: number; readonly smart: number; readonly teamRugShare: number | null }

/** The groups the owner reads: each fact's launches and how many rugged within the hour. */
export function rugTable(rows: readonly { readonly f: RugFacts; readonly rug: boolean }[]): Record<string, Rate> {
  const groups: Record<string, (f: RugFacts) => boolean> = {
    'all launches': () => true,
    'dev sold in first minute': (f) => f.devSoldEarly === true,
    'dev held first minute': (f) => f.devSoldEarly === false,
    'launch block 30%+ of supply': (f) => (f.blockShare ?? 0) >= 0.3,
    'dev buy 10+ SOL': (f) => (f.devBuySol ?? 0) >= 10,
    '15+ first-second buyers': (f) => f.buyers >= 15,
    'a smart wallet early': (f) => f.smart > 0,
    'team rugged 70%+ before': (f) => f.teamRugShare !== null && f.teamRugShare >= 0.7,
  };
  const out: Record<string, Rate> = {};
  for (const [name, test] of Object.entries(groups)) {
    const g = rows.filter((r) => test(r.f));
    out[name] = rate(g.filter((r) => r.rug).length, g.length);
  }
  return out;
}

/* ── when coins that run peak ────────────────────────────────────── */

export const PEAK_BUCKETS = ['under 1 hour', '1-12 hours', '12-24 hours', '1-3 days', '3-7 days'] as const;
export function peakBucket(launchedAt: number, peakAt: number): (typeof PEAK_BUCKETS)[number] {
  const h = (peakAt - launchedAt) / 3_600_000;
  return h < 1 ? 'under 1 hour' : h < 12 ? '1-12 hours' : h < 24 ? '12-24 hours' : h < 72 ? '1-3 days' : '3-7 days';
}

export function peakTable(rows: readonly { readonly launchedAt: number; readonly peakAt: number }[]): Record<string, Rate> {
  const out: Record<string, Rate> = {};
  for (const b of PEAK_BUCKETS) out[b] = rate(rows.filter((r) => peakBucket(r.launchedAt, r.peakAt) === b).length, rows.length);
  return out;
}

/* ── copy-tests: what a rule would have done to our pushes and picks ── */

export interface PushCase { readonly address: string; readonly capAtPush: number | null; readonly early: boolean; readonly peak1h: number | null; readonly ranAfter: boolean; readonly rugRisk: boolean }

/**
 * Raising the early-pick line from `fromUsd` to `toUsd`: an early push under the new line is kept only if
 * the coin went on to cross it within the hour (it would have been pushed then, later), else it is dropped.
 */
export function copyTestEarlyLine(cases: readonly PushCase[], toUsd: number): { readonly before: Rate; readonly after: Rate; readonly dropped: number; readonly droppedGood: number; readonly delayed: number } {
  let dropped = 0;
  let droppedGood = 0;
  let delayed = 0;
  const kept: PushCase[] = [];
  for (const c of cases) {
    if (!c.early || c.capAtPush === null || c.capAtPush >= toUsd) { kept.push(c); continue; }
    if ((c.peak1h ?? 0) >= toUsd) { delayed += 1; kept.push(c); continue; }
    dropped += 1;
    if (c.ranAfter) droppedGood += 1;
  }
  return { before: rate(cases.filter((c) => c.ranAfter).length, cases.length), after: rate(kept.filter((c) => c.ranAfter).length, kept.length), dropped, droppedGood, delayed };
}

/** Holding pushes the rug rule flags: what it would have removed, good and bad. */
export function copyTestRugHold(cases: readonly PushCase[]): { readonly before: Rate; readonly after: Rate; readonly held: number; readonly heldGood: number } {
  const kept = cases.filter((c) => !c.rugRisk);
  const held = cases.filter((c) => c.rugRisk);
  return { before: rate(cases.filter((c) => c.ranAfter).length, cases.length), after: rate(kept.filter((c) => c.ranAfter).length, kept.length), held: held.length, heldGood: held.filter((c) => c.ranAfter).length };
}

export interface PickCase { readonly picked: string; readonly candidates: readonly { readonly address: string; readonly peak1h: number | null; readonly rugRisk: boolean; readonly smart: number }[] }

/**
 * Picks against the biggest coin an hour in (the scorecard's "+1h" measure), as picked and under the rule
 * "drop rug-flagged candidates; then most smart wallets; then the pick": how often each names the biggest.
 */
export function copyTestPicks(cases: readonly PickCase[]): { readonly asPicked: Rate; readonly withRule: Rate } {
  let right = 0;
  let ruleRight = 0;
  let n = 0;
  for (const c of cases) {
    const priced = c.candidates.filter((x) => x.peak1h !== null);
    if (priced.length < 2) continue;
    const best = priced.reduce((a, b) => ((b.peak1h ?? 0) > (a.peak1h ?? 0) ? b : a));
    n += 1;
    if (best.address === c.picked) right += 1;
    const safe = c.candidates.filter((x) => !x.rugRisk);
    const pool = safe.length > 0 ? safe : c.candidates;
    const topSmart = Math.max(...pool.map((x) => x.smart));
    const rulePick = topSmart > 0 ? pool.find((x) => x.smart === topSmart)!.address : pool.some((x) => x.address === c.picked) ? c.picked : pool[0]!.address;
    if (rulePick === best.address) ruleRight += 1;
  }
  return { asPicked: rate(right, n), withRule: rate(ruleRight, n) };
}

/** The rug rule used by the copy-tests: the dev sold in the first minute, or a team that rugged 70%+ of 3+ launches. */
export function rugRisk(f: RugFacts, teamLaunchesKnown: number): boolean {
  return f.devSoldEarly === true || (f.teamRugShare !== null && f.teamRugShare >= 0.7 && teamLaunchesKnown >= 3);
}
