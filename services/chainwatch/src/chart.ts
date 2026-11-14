/**
 * THE CHARTS: every trade the relay carries, priced in dollars and folded into our own candles
 * (chart-book.ts decides which coins and how), written to 0144 in batches, and each charted coin's
 * latest trades served to the read service on this process's private port.
 *
 * Why here: the trade relay allows one connection per address and this process holds it, so this
 * is the one place every trade passes. The read service draws the token chart from the rows this
 * writes and asks the market source only for a coin whose history began before we were recording.
 *
 * ★ MEASURED BEFORE IT WAS BUILT (15 minutes of the relay, 2026-10-27 ~13:00 London): 796 frames and
 * 435 trade legs a second; parsing every frame cost about 20 ms a second. Replayed through the book,
 * about 1,000 coins were charted in the quarter hour (out of 5,800 that traded), giving some 800,000
 * minute rows a day at about 140–300 bytes each, and about 45 minute-row upserts a second, written
 * every `FLUSH_MS` as one statement per table.
 *
 * ★ THE LATEST TRADES ARE ANSWERED FROM MEMORY. GET /trades?coin=<address> on the private port gives
 * a charted coin's last trades newest first, and `whole`: false when this process has not held the
 * coin long enough to know the list is complete (it restarted since the coin's launch and has not
 * seen `RECENT_MAX` trades since), so the read service can go to the market source instead of
 * showing a short list as the coin's whole trading.
 *
 * What breaks if changed carelessly: pricing. A trade in SOL is dollars only with a fresh SOL price
 * (live.ts's median); a trade in a quote token not priced here is left out of the candles, never
 * drawn at a guessed price.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { ChartBook, type ChartTake } from './chart-book.ts';
import { LaunchOpens, type LaunchOpenRow } from './launch-open.ts';

/** How often candles are written. */
const FLUSH_MS = 5_000;
/** Failed writes in a row after which the unwritten candles are dropped (and said so), not held forever. */
const KEEP_UNWRITTEN_FAILURES = 60;
/** How often the product's watched coins are reread. */
const LIST_EVERY_MS = 60_000;
/** Minute rows older than this leave the database once their day is copied to the candle archive
 * (0163, store coin-chart.ts `prune`; a day not copied stays however old); the hourly rows stay. */
export const MINUTE_RETENTION_MS = 7 * 86_400_000;
/** How long a launch's first-minute row is kept (0150), and a graduate's (0154): the policy's. */
const OPENS_KEEP_MS = DEFAULT_POLICY.launchSignals.keepMs;
const OPENS_KEEP_GRADUATES_MS = DEFAULT_POLICY.launchSignals.keepGraduatesMs;
/** How often old minute rows are deleted, and the most deleted at once. */
const PRUNE_EVERY_MS = 10 * 60_000;
const PRUNE_BATCH = 20_000;
/** The quote tokens a trade can be priced in: SOL at its live price, the two dollar stablecoins at one. */
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const DOLLARS = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

/** One leg of a trade as the relay socket hands it over, in this service's words. */
export interface ChartTick {
  readonly coin: string;
  readonly signature: string;
  readonly side: 'buy' | 'sell';
  readonly quoteAmount: number;
  readonly tokens: number;
  readonly trader: string;
  readonly priceQuote: number | null;
  readonly quoteMint: string;
  readonly pool: string;
  readonly poolAddress: string | null;
  /** The pool's depth in the quote token after the trade (main-pool.ts); absent when not known. */
  readonly poolQuote?: number | null;
  readonly atMs: number;
}

export interface ChartStorePort {
  /** Coins charted since `sinceMs`, with their last trade. */
  charted(sinceMs: number): Promise<readonly { readonly address: string; readonly lastTradeMs: number }[]>;
  /** The coins the product is watching now. */
  listed(nowMs: number): Promise<ReadonlySet<string>>;
  write(t: ChartTake): Promise<void>;
  /** Deletes up to `limit` minute rows older than `beforeMs`; how many went. */
  prune(beforeMs: number, limit: number): Promise<number>;
  /** Each launch's first second (0150, launch-open.ts); absent: not recorded. */
  writeOpens?(rows: readonly LaunchOpenRow[]): Promise<void>;
  /** Deletes the first-minute rows of launches before `beforeMs`, a graduate's only before `graduatesBeforeMs`. */
  pruneOpens?(beforeMs: number, graduatesBeforeMs: number): Promise<number>;
}

export interface Charts {
  /** The relay socket's hook. */
  readonly hooks: { readonly onTrades: (coin: string, ticks: readonly ChartTick[], launch: boolean, seenAtMs: number) => void };
  /** Serves GET /trades?coin=; false when the path is not this one's. */
  serve(req: IncomingMessage, res: ServerResponse): boolean;
  /** Runs until aborted: boot, then a write every `FLUSH_MS`. */
  run(signal: AbortSignal): Promise<void>;
}

export interface ChartDeps {
  readonly store: ChartStorePort;
  /** SOL in dollars now, or null when no price is fresh. */
  readonly solUsd: () => number | null;
  readonly now: () => number;
  readonly note: (level: 'info' | 'warn', msg: string, fields: Readonly<Record<string, unknown>>) => void;
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function createCharts(deps: ChartDeps): Charts {
  const book = new ChartBook();
  /* ★ Each launch's first second, from the same trades the candles take (launch-open.ts, 0150). */
  const opens = new LaunchOpens();
  let opensFailed = 0;
  /* Nothing is folded until the table has answered once: deployed before 0144 is applied, this
     stays idle instead of holding a day of candles it can never write. */
  let ready = false;
  let failures = 0;
  let writes = { rows: 0, statements: 0, ms: 0, legs: 0 };

  const quoteUsd = (mint: string): number | null => (mint === WRAPPED_SOL ? deps.solUsd() : DOLLARS.has(mint) ? 1 : null);

  const pass = async (): Promise<void> => {
    const t = book.take();
    if (t.coins.length + t.minutes.length + t.hours.length === 0) return;
    const started = deps.now();
    try {
      await deps.store.write(t);
    } catch (e) {
      if (failures < KEEP_UNWRITTEN_FAILURES) book.restore(t);
      else deps.note('warn', 'charts: candles dropped after repeated failed writes; the chart has a hole here', { minutes: t.minutes.length, failures });
      throw e;
    }
    writes = { rows: writes.rows + t.coins.length + t.minutes.length + t.hours.length, statements: writes.statements + 3, ms: writes.ms + (deps.now() - started), legs: writes.legs };
  };

  return {
    hooks: {
      onTrades: (coin, ticks, launch, seenAtMs) => {
        if (!ready) return;
        const now = deps.now();
        if (launch) opens.launched(coin, ticks[0]?.atMs ?? seenAtMs, now);
        if (ticks.length === 0) {
          if (launch) book.launched(coin, seenAtMs, now);
          return;
        }
        for (const t of ticks) {
          writes.legs += 1;
          const q = quoteUsd(t.quoteMint);
          const priceUsd = q === null || t.priceQuote === null ? null : t.priceQuote * q;
          const usd = q === null ? null : t.quoteAmount * q;
          book.apply({ coin: t.coin, tx: t.signature, side: t.side, tokens: t.tokens, usd, priceUsd, maker: t.trader, atMs: t.atMs, pool: t.pool, poolAddress: t.poolAddress, quoteMint: t.quoteMint }, launch, now);
          opens.trade({ coin: t.coin, side: t.side, maker: t.trader, usd, sol: t.quoteMint === WRAPPED_SOL ? t.quoteAmount : null, tokens: t.tokens, pool: t.pool, atMs: t.atMs }, now);
        }
      },
    },

    serve(req, res) {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname !== '/trades') return false;
      const coin = url.searchParams.get('coin') ?? '';
      const held = ADDRESS.test(coin) ? book.recent(coin) : null;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(held === null ? { held: false } : { held: true, whole: held.whole, trades: held.trades }));
      return true;
    },

    async run(signal) {
      for (let tries = 1; ; tries += 1) {
        if (signal.aborted) return;
        try {
          book.remember(await deps.store.charted(deps.now() - MINUTE_RETENTION_MS));
          ready = true;
          break;
        } catch (e) {
          if (tries === 1 || tries % 60 === 0) deps.note('warn', 'charts: charted coins not read (is 0144 applied?); idle until they are', { err: e instanceof Error ? e.message : String(e), tries });
          await deps.sleep(60_000, signal);
        }
      }
      let listedAt = Number.NEGATIVE_INFINITY;
      let prunedAt = Number.NEGATIVE_INFINITY;
      let reportAt = deps.now();
      while (!signal.aborted) {
        const now = deps.now();
        try {
          if (now - listedAt >= LIST_EVERY_MS) {
            listedAt = now;
            book.list(await deps.store.listed(now));
          }
          await pass();
          book.sweep(now);
          /* A launch's first second is a fact worth a row but not a retry: a write that fails (0150 not
             applied, say) drops those rows, noted, and the candles carry on. */
          const opened = opens.take(now);
          if (opened.length > 0 && deps.store.writeOpens !== undefined) {
            try {
              await deps.store.writeOpens(opened);
            } catch (e) {
              opensFailed += 1;
              if (opensFailed === 1 || opensFailed % 100 === 0) deps.note('warn', 'charts: launch first seconds not written (is 0150 applied?)', { rows: opened.length, failures: opensFailed, err: e instanceof Error ? e.message : String(e) });
            }
          }
          if (now - prunedAt >= PRUNE_EVERY_MS) {
            prunedAt = now;
            const gone = await deps.store.prune(now - MINUTE_RETENTION_MS, PRUNE_BATCH);
            await deps.store.pruneOpens?.(now - OPENS_KEEP_MS, now - OPENS_KEEP_GRADUATES_MS).catch(() => 0);
            if (gone >= PRUNE_BATCH) prunedAt = now - PRUNE_EVERY_MS + FLUSH_MS * 4;
          }
          failures = 0;
        } catch (e) {
          failures += 1;
          if (failures === 1 || failures % 20 === 0) deps.note('warn', 'charts: write failed; the trades wait for the next pass', { err: e instanceof Error ? e.message : String(e), failures });
        }
        if (now - reportAt >= 15 * 60_000) {
          deps.note('info', 'charts: the last quarter hour', { ...book.stats(), ...writes, msPerWrite: writes.statements === 0 ? null : Math.round((writes.ms * 3) / writes.statements) });
          writes = { rows: 0, statements: 0, ms: 0, legs: 0 };
          reportAt = now;
        }
        await deps.sleep(Math.min(120_000, FLUSH_MS * 2 ** Math.min(failures, 4)), signal);
      }
    },
  };
}
