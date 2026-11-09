/**
 * EVERY LAUNCH AND WHAT IT DID, KEPT FOR GOOD IN THE PRIVATE ARCHIVE BUCKET (the owner, 2026-11-08:
 * "I want this data to start collecting today and not stop", and never add database load). From the
 * same trades the candles take, it follows each launch it saw and writes, one gzip file per hour:
 *
 *   launches/<day>/<HH>   creator, name, ticker, metadata link, every first-minute buy (wallet, SOL,
 *                         ms after launch), first-second buyers, dev buy, launch-block share
 *   outcomes/<h>/<day>/<HH>  at 1 hour, 24 hours and 7 days after launch: peak cap and when, end cap,
 *                         crash (to 20% of peak), graduation, dev and launch-block wallets selling
 *   graduations/<day>/<HH>   a launched coin first seen trading outside its launch pool
 *
 * These feed the team, peak-time, rug and smart-wallet work, all owner-only until the owner says.
 * NOTHING HERE TOUCHES THE DATABASE: the launch_open rows chart.ts writes are unchanged.
 *
 * Its own file beside chart.ts and launch-open.ts so the candles and the first-second rows cannot be
 * slowed or broken by it: wiring.ts hands it the same trades, and every failure here is noted and kept
 * for the next pass, never thrown into the trade path.
 *
 * ★ A RESTART IS A HOLE THAT IS SAID. The follow state is saved to the bucket every
 * `CHECKPOINT_EVERY_MS` and read back at boot; the time between the last save and the boot is a gap,
 * and any outcome whose window overlaps a gap is written `complete: false`. Launches during the gap were
 * never seen and are simply absent from their hour.
 *
 * ★ FOLLOWED FOR 7 DAYS ONLY WHILE ALIVE. After its 24-hour record a coin that is under `ALIVE_CAP_USD`
 * and has not traded for `QUIET_MS` is dropped; it gets no 7-day record. Without this every launch of
 * the week would be held in memory (about 300,000).
 *
 * What breaks if changed carelessly: the snapshot rule. A horizon's figures are taken from the trades
 * BEFORE launch + horizon (the first trade past it snapshots first), so a file written up to an hour
 * later still says what the coin had done by exactly that horizon.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import {
  encodeRecords, graduationsPath, launchesPath, outcomesPath, TRACKER_STATE_PATH,
  type GraduationRecord, type LaunchRecord, type OutcomeRecord,
} from '@insidor/storage-supabase/launch-archive.ts';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { ChartTick } from './chart.ts';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/** A file is written this long after the last moment it covers, for late trades to land. */
const SETTLE_MS = 3 * MINUTE_MS;
const HORIZONS = { '1h': HOUR_MS, '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS } as const;
type Horizon = keyof typeof HORIZONS;
/* Every 3 minutes: a redeploy's own save on the way out did not land in time (9 Nov), so a restart loses at most this. */
const CHECKPOINT_EVERY_MS = 3 * MINUTE_MS;
const PASS_EVERY_MS = MINUTE_MS;
/** Kept past 24 hours only when at least this big, or when it traded within `QUIET_MS`. */
const ALIVE_CAP_USD = 5_000;
const QUIET_MS = 6 * HOUR_MS;
/** "Crashed": the cap fell to this share of the peak so far, after a peak of `CRASH_MIN_RUN`× the opening cap. */
const CRASH_SHARE = 0.2;
const CRASH_MIN_RUN = 2;
const MAX_MINUTE_BUYS = 80;
const MAX_BUNDLE_WALLETS = 40;
/* Holders followed per coin, from trades (buys less sells); past this new wallets are not added and the share is marked capped. */
const MAX_HOLDERS = 5_000;
/** A hard ceiling on coins followed at once: past it new launches are counted and skipped, never crash the process. */
const MAX_COINS = 250_000;
const META_KEEP_MS = 15 * MINUTE_MS;
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const DOLLARS = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const SIGNALS = DEFAULT_POLICY.launchSignals;

export interface ArchivePort {
  put(path: string, body: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
}

export interface LaunchMeta { readonly name: string | null; readonly symbol: string | null; readonly creator: string | null; readonly metadataUri: string | null }

interface Snap { peak: number | null; peakAt: number | null; end: number | null; crashAt: number | null; grad: number | null; devFirstSell: number | null; devSoldShare: number | null; bundleFirstSell: number | null; bundleSoldShare: number | null; trades: number; buys: number; top10Share: number | null; holders: number | null }

interface Coin {
  a: string; t: number; pool: string | null; creator: string | null;
  name: string | null; symbol: string | null; uri: string | null;
  buys1m: { w: string; sol: number | null; ms: number }[] | null;
  firstSec: string[]; devBuySol: number | null; devBuyUsd: number | null;
  blockTokens: number; devTokens: number; devSold: number; devFirstSell: number | null;
  bundle: string[]; bundleTokens: number; bundleSold: number; bundleFirstSell: number | null;
  openCap: number | null; peak: number | null; peakAt: number | null; end: number | null; crashAt: number | null;
  grad: number | null; trades: number; buys: number; last: number;
  /** Each wallet's tokens from its own trades (buys less sells); wallet moves are not seen. */
  held: Record<string, number>; heldCapped: boolean;
  snaps: Partial<Record<Horizon, Snap>>;
}

interface Gap { from: number; to: number }

export interface LaunchArchiveDeps {
  readonly archive: ArchivePort | null;
  readonly solUsd: () => number | null;
  readonly now: () => number;
  readonly note: (level: 'info' | 'warn', msg: string, fields: Readonly<Record<string, unknown>>) => void;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface LaunchArchive {
  readonly onTrades: (coin: string, ticks: readonly ChartTick[], launch: boolean, seenAtMs: number) => void;
  readonly meta: (address: string, m: LaunchMeta) => void;
  run(signal: AbortSignal): Promise<void>;
}

const hourOf = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

/** The follow book on its own, without the bucket: what tests drive. */
export class LaunchBook {
  readonly coins = new Map<string, Coin>();
  readonly gaps: Gap[] = [];
  /** Hour start → which file kinds are written for it. */
  readonly written = new Map<number, Set<string>>();
  readonly grads = new Map<number, GraduationRecord[]>();
  private readonly pendingMeta = new Map<string, { m: LaunchMeta; at: number }>();
  skipped = 0;

  meta(address: string, m: LaunchMeta, now: number): void {
    const c = this.coins.get(address);
    if (c !== undefined) { c.name ??= m.name; c.symbol ??= m.symbol; c.uri ??= m.metadataUri; c.creator ??= m.creator; return; }
    if (this.pendingMeta.size > 20_000) for (const [k, v] of this.pendingMeta) if (now - v.at > META_KEEP_MS) this.pendingMeta.delete(k);
    this.pendingMeta.set(address, { m, at: now });
  }

  launched(address: string, atMs: number, creator: string | null): void {
    if (this.coins.has(address)) return;
    if (this.coins.size >= MAX_COINS) { this.skipped += 1; return; }
    const pm = this.pendingMeta.get(address)?.m;
    this.pendingMeta.delete(address);
    this.coins.set(address, {
      a: address, t: atMs, pool: null, creator: creator ?? pm?.creator ?? null,
      name: pm?.name ?? null, symbol: pm?.symbol ?? null, uri: pm?.metadataUri ?? null,
      buys1m: [], firstSec: [], devBuySol: null, devBuyUsd: null,
      blockTokens: 0, devTokens: 0, devSold: 0, devFirstSell: null,
      bundle: [], bundleTokens: 0, bundleSold: 0, bundleFirstSell: null,
      openCap: null, peak: null, peakAt: null, end: null, crashAt: null, grad: null, trades: 0, buys: 0, last: atMs, held: {}, heldCapped: false, snaps: {},
    });
  }

  private holderFacts(c: Coin): { top10Share: number | null; holders: number | null } {
    if (c.held === undefined) return { top10Share: null, holders: null };
    const pos = Object.values(c.held).filter((v) => v > 0).sort((a, b) => b - a);
    if (pos.length === 0) return { top10Share: null, holders: 0 };
    const top = pos.slice(0, 10).reduce((x, y) => x + y, 0);
    return { top10Share: c.heldCapped ? null : Math.min(1, top / SIGNALS.supplyTokens), holders: pos.length };
  }

  private snap(c: Coin): Snap {
    return {
      ...this.holderFacts(c),
      peak: c.peak, peakAt: c.peakAt, end: c.end, crashAt: c.crashAt, grad: c.grad,
      devFirstSell: c.devFirstSell, devSoldShare: c.devTokens > 0 ? Math.min(1, c.devSold / c.devTokens) : null,
      bundleFirstSell: c.bundleFirstSell, bundleSoldShare: c.bundleTokens > 0 ? Math.min(1, c.bundleSold / c.bundleTokens) : null,
      trades: c.trades, buys: c.buys,
    };
  }

  trade(t: { coin: string; side: 'buy' | 'sell'; maker: string; sol: number | null; usd: number | null; capUsd: number | null; tokens: number; pool: string; atMs: number }): GraduationRecord | null {
    const c = this.coins.get(t.coin);
    if (c === undefined) return null;
    for (const h of Object.keys(HORIZONS) as Horizon[]) if (c.snaps[h] === undefined && t.atMs >= c.t + HORIZONS[h]) c.snaps[h] = this.snap(c);
    const ms = Math.max(0, t.atMs - c.t);
    c.trades += 1;
    c.last = Math.max(c.last, t.atMs);
    let grad: GraduationRecord | null = null;
    if (c.pool === null) c.pool = t.pool;
    else if (t.pool !== c.pool && c.grad === null) { c.grad = t.atMs; grad = { address: c.a, seenAt: t.atMs, pool: t.pool }; }
    const isDev = c.creator !== null && t.maker === c.creator;
    if (c.held !== undefined) {
      if (c.held[t.maker] !== undefined || Object.keys(c.held).length < MAX_HOLDERS) c.held[t.maker] = (c.held[t.maker] ?? 0) + (t.side === 'buy' ? t.tokens : -t.tokens);
      else c.heldCapped = true;
    }
    if (t.side === 'buy') {
      c.buys += 1;
      if (c.buys1m !== null && ms < MINUTE_MS && c.buys1m.length < MAX_MINUTE_BUYS) c.buys1m.push({ w: t.maker, sol: t.sol, ms });
      if (ms < 1_000 && !isDev && !c.firstSec.includes(t.maker) && c.firstSec.length < SIGNALS.firstBuyersKept) c.firstSec.push(t.maker);
      if (ms <= SIGNALS.blockWindowMs) c.blockTokens += t.tokens;
      if (isDev) { c.devTokens += t.tokens; if (ms < MINUTE_MS) { c.devBuySol = (c.devBuySol ?? 0) + (t.sol ?? 0); c.devBuyUsd = (c.devBuyUsd ?? 0) + (t.usd ?? 0); } }
      else if (ms <= SIGNALS.blockWindowMs && c.bundle.length < MAX_BUNDLE_WALLETS) { if (!c.bundle.includes(t.maker)) c.bundle.push(t.maker); c.bundleTokens += t.tokens; }
      else if (c.bundle.includes(t.maker)) c.bundleTokens += t.tokens;
    } else {
      if (isDev) { c.devSold += t.tokens; c.devFirstSell ??= t.atMs; }
      if (c.bundle.includes(t.maker)) { c.bundleSold += t.tokens; c.bundleFirstSell ??= t.atMs; }
    }
    if (t.capUsd !== null && t.capUsd > 0) {
      c.openCap ??= t.capUsd;
      c.end = t.capUsd;
      if (c.peak === null || t.capUsd > c.peak) { c.peak = t.capUsd; c.peakAt = t.atMs; }
      if (c.crashAt === null && c.peak >= CRASH_MIN_RUN * (c.openCap ?? c.peak) && t.capUsd <= CRASH_SHARE * c.peak) c.crashAt = t.atMs;
    }
    return grad;
  }

  private complete(c: Coin, h: Horizon): boolean {
    const from = c.t;
    const to = c.t + HORIZONS[h];
    return !this.gaps.some((g) => g.from < to && g.to > from);
  }

  launchRecord(c: Coin): LaunchRecord {
    return {
      address: c.a, launchedAt: c.t, pool: c.pool, creator: c.creator, buyers: c.firstSec.length + (c.devBuySol !== null ? 1 : 0),
      buys: c.buys1m?.filter((b) => b.ms < 1_000).length ?? 0, devBuyUsd: c.devBuyUsd, devBuySol: c.devBuySol,
      blockShare: c.blockTokens > 0 ? Math.min(1, c.blockTokens / SIGNALS.supplyTokens) : null, firstBuyers: c.firstSec,
      devSold: c.devBuySol === null ? null : c.devFirstSell !== null && c.devFirstSell - c.t <= SIGNALS.devSellWindowMs,
      name: c.name, symbol: c.symbol, metadataUri: c.uri, minuteBuys: c.buys1m,
    };
  }

  outcomeRecord(c: Coin, h: Horizon): OutcomeRecord {
    const s = c.snaps[h] ?? this.snap(c);
    return {
      address: c.a, launchedAt: c.t, horizon: h, complete: this.complete(c, h),
      peakCapUsd: s.peak, peakAt: s.peakAt, endCapUsd: s.end, crashAt: s.crashAt, graduatedAt: s.grad,
      devFirstSellAt: s.devFirstSell, devSoldShare: s.devSoldShare, bundleFirstSellAt: s.bundleFirstSell, bundleSoldShare: s.bundleSoldShare,
      trades: s.trades, buys: s.buys, top10Share: s.top10Share, holders: s.holders,
    };
  }

  /** The files due at `now`, each with what to do once it is stored. */
  due(now: number): { path: string; body: Uint8Array; done: () => void }[] {
    const byHour = new Map<number, Coin[]>();
    for (const c of this.coins.values()) { const h = hourOf(c.t); const l = byHour.get(h); if (l === undefined) byHour.set(h, [c]); else l.push(c); }
    const out: { path: string; body: Uint8Array; done: () => void }[] = [];
    const mark = (h: number, kind: string) => { const s = this.written.get(h) ?? new Set<string>(); s.add(kind); this.written.set(h, s); };
    const has = (h: number, kind: string) => this.written.get(h)?.has(kind) === true;
    for (const [h, coins] of byHour) {
      if (!has(h, 'launches') && now >= h + HOUR_MS + MINUTE_MS + SETTLE_MS) {
        out.push({ path: launchesPath(h), body: encodeRecords(coins.map((c) => this.launchRecord(c))), done: () => { mark(h, 'launches'); for (const c of coins) c.buys1m = null; } });
      }
      for (const hz of Object.keys(HORIZONS) as Horizon[]) {
        if (has(h, hz) || now < h + HOUR_MS + HORIZONS[hz] + SETTLE_MS) continue;
        if (hz === '7d' && !has(h, '24h')) continue;
        out.push({
          path: outcomesPath(hz, h), body: encodeRecords(coins.map((c) => this.outcomeRecord(c, hz))),
          done: () => {
            mark(h, hz);
            if (hz === '24h') for (const c of coins) { if ((c.end ?? 0) < ALIVE_CAP_USD && now - c.last > QUIET_MS) this.coins.delete(c.a); }
            if (hz === '7d') { for (const c of coins) this.coins.delete(c.a); this.written.delete(h); }
          },
        });
      }
    }
    for (const [h, list] of this.grads) {
      if (now < h + HOUR_MS + SETTLE_MS) continue;
      out.push({ path: graduationsPath(h), body: encodeRecords(list), done: () => this.grads.delete(h) });
    }
    while (this.gaps.length > 0 && (this.gaps[0]?.to ?? 0) < now - HORIZONS['7d'] - 2 * HOUR_MS) this.gaps.shift();
    return out;
  }

  grad(g: GraduationRecord): void {
    const h = hourOf(g.seenAt);
    const l = this.grads.get(h);
    if (l === undefined) this.grads.set(h, [g]); else l.push(g);
  }

  save(now: number): Uint8Array {
    return gzipSync(Buffer.from(JSON.stringify({ savedAt: now, gaps: this.gaps, written: [...this.written].map(([h, s]) => [h, [...s]]), grads: [...this.grads], coins: [...this.coins.values()] })));
  }

  /** Restores a saved book; the time since it was saved becomes a gap. False when there was nothing usable. */
  restore(bytes: Uint8Array, now: number): boolean {
    const o = JSON.parse(gunzipSync(bytes).toString('utf8')) as { savedAt: number; gaps: Gap[]; written: [number, string[]][]; grads: [number, GraduationRecord[]][]; coins: Coin[] };
    if (typeof o.savedAt !== 'number' || now - o.savedAt > HORIZONS['7d']) return false;
    for (const g of o.gaps ?? []) this.gaps.push(g);
    this.gaps.push({ from: o.savedAt, to: now });
    for (const [h, s] of o.written ?? []) this.written.set(h, new Set(s));
    for (const [h, l] of o.grads ?? []) this.grads.set(h, l);
    for (const c of o.coins ?? []) if (!this.coins.has(c.a)) this.coins.set(c.a, c);
    return true;
  }
}

export function createLaunchArchive(deps: LaunchArchiveDeps): LaunchArchive {
  const book = new LaunchBook();
  const startedAt = deps.now();
  let ready = deps.archive === null;
  let failures = 0;
  const quoteUsd = (mint: string): number | null => (mint === WRAPPED_SOL ? deps.solUsd() : DOLLARS.has(mint) ? 1 : null);

  return {
    meta: (address, m) => book.meta(address, m, deps.now()),
    onTrades: (coin, ticks, launch, seenAtMs) => {
      if (deps.archive === null) return;
      try {
        if (launch) book.launched(coin, ticks[0]?.atMs ?? seenAtMs, ticks[0]?.trader ?? null);
        for (const t of ticks) {
          const q = quoteUsd(t.quoteMint);
          const priceUsd = q === null || t.priceQuote === null ? null : t.priceQuote * q;
          const g = book.trade({
            coin: t.coin, side: t.side, maker: t.trader, sol: t.quoteMint === WRAPPED_SOL ? t.quoteAmount : null,
            usd: q === null ? null : t.quoteAmount * q, capUsd: priceUsd === null ? null : priceUsd * SIGNALS.supplyTokens,
            tokens: t.tokens, pool: t.pool, atMs: t.atMs,
          });
          if (g !== null) book.grad(g);
        }
      } catch (e) {
        failures += 1;
        if (failures === 1 || failures % 1_000 === 0) deps.note('warn', 'launch archive: a trade was not followed', { err: e instanceof Error ? e.message : String(e), failures });
      }
    },
    async run(signal) {
      const archive = deps.archive;
      if (archive === null) { deps.note('info', 'launch archive: off (no archive bucket configured)', {}); return; }
      try {
        const saved = await archive.get(TRACKER_STATE_PATH);
        const restored = saved !== null && book.restore(saved, startedAt);
        deps.note('info', 'launch archive: started', { restored, coins: book.coins.size });
      } catch (e) {
        deps.note('warn', 'launch archive: saved follow state not read; starting fresh', { err: e instanceof Error ? e.message : String(e) });
      }
      ready = true;
      let savedAt = deps.now();
      let reportAt = deps.now();
      let filesWritten = 0;
      while (!signal.aborted) {
        const now = deps.now();
        for (const f of book.due(now)) {
          try { await archive.put(f.path, f.body); f.done(); filesWritten += 1; } catch (e) {
            deps.note('warn', 'launch archive: file not stored; tried again next pass', { path: f.path, err: e instanceof Error ? e.message : String(e) });
          }
        }
        if (now - savedAt >= CHECKPOINT_EVERY_MS) {
          try { await archive.put(TRACKER_STATE_PATH, book.save(now)); savedAt = now; } catch (e) {
            deps.note('warn', 'launch archive: follow state not saved', { err: e instanceof Error ? e.message : String(e) });
          }
        }
        if (now - reportAt >= HOUR_MS) {
          deps.note('info', 'launch archive: the last hour', { following: book.coins.size, filesWritten, skipped: book.skipped, ready });
          filesWritten = 0;
          reportAt = now;
        }
        await deps.sleep(PASS_EVERY_MS, signal);
      }
      try { await archive.put(TRACKER_STATE_PATH, book.save(deps.now())); } catch { /* the next boot records the gap */ }
    },
  };
}
