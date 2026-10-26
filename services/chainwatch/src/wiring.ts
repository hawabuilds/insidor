/**
 * The composition root: the ONE file in this service that names other packages.
 *
 * The feed is built here and nowhere else, and this file is the only one in the
 * service that knows which venue is being watched. The `stream` transport is
 * implemented against the venue adapter's socket client; the `poll` transport is
 * still a `NotImplemented`, and that asymmetry is honest rather than untidy — a
 * poll over an offset cursor was the plan when the only available source was a
 * REST list, and it is not the thing that is running.
 *
 * ★ THE SEAM. The service declares what it needs from a push transport in
 * stream.ts, in words that name no vendor, no chain and no venue. The adapter's
 * socket client satisfies that shape without either side importing the other,
 * because TypeScript is structural. `createFeed` below is the one function that
 * knows both exist. Everything that makes this process worth deploying — the
 * durable cursor, the backoff, the coverage log, the run records — remains
 * transport agnostic and untouched by any of it.
 *
 * THREE THINGS ABOUT THE STORE SIDE ARE WORTH READING BEFORE CHANGING THEM.
 *
 * 1. THE ROLE IS `internal`, NOT `service`. This process writes
 *    `internal.mint_coverage` and `internal.stage_runs`, and the `service` role
 *    holds SELECT on that schema and nothing more (0001_schemas.sql). A pool
 *    opened as `service` would come up, read fine, and fail on the first gap it
 *    tried to record — which is the one write whose absence is invisible.
 *
 * 2. THE SINGLETON LOCK IS HELD FOR THE LIFE OF THE PROCESS, so the runtime is a
 *    scope rather than a value: `withRuntime(cfg, log, run)`. A session advisory
 *    lock is released when its session ends, so the session has to outlive the
 *    loop, and the only way to say that in a type is to hand the loop the lock's
 *    connection. Two watchers on one cursor is two watchers each convinced they
 *    have full coverage, and neither of them does.
 *
 * 3. THERE IS NO CURSOR TABLE, AND THAT IS DELIBERATE. The resume position lives
 *    on the coverage row (`mint_coverage.cursor_ref`), so saving it and declaring
 *    the window it closed are one write. Resuming is therefore a read of the most
 *    recent coverage row, and a process that has never run finds nothing and
 *    starts cold — which is a different thing from a process that restarted and
 *    lost its place, because that one finds a watermark and the silence since it
 *    becomes a recorded gap.
 *
 * 4. THE LAUNCH LISTING WRITES COINS AND NOTHING ELSE (`buildListing`). It shares this
 *    process's one connection and its lock, adds rows only where none exist, and never
 *    touches the coverage log, which stays the socket's own record.
 *
 * 5. THE TRADE FEED (`buildTrades`) shares the connection and the lock too: the lock is what
 *    makes it the only writer of the trade tables, which it writes whole rather than by
 *    increment. Its key is HELIUS_API_KEY, put into the socket and RPC addresses here and
 *    nowhere else; no log line, error or note carries either address.
 */

import { createHash } from 'node:crypto';

import {
  DB_ROLE,
  PgAssetRepo,
  PgStageRunRepo,
  PgTradeFeedRepo,
  createPool,
  withAdvisoryLock,
  type Db,
} from '@insidor/store';
import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { BASE_URLS, geckoterminal } from '@insidor/market-geckoterminal';
import { curveAddress, curvePlaces, launchOpening, transactionLogs } from '@insidor/venue-solana-pumpfun/curve-rpc.ts';
import { curveEvents } from '@insidor/venue-solana-pumpfun/events.ts';
import { createRelayTradeSocket } from '@insidor/venue-solana-pumpfun/relay-trade-socket.ts';
import { createTradeSocket } from '@insidor/venue-solana-pumpfun/trade-socket.ts';
import {
  ACCOUNTS_PER_CALL,
  CHAIN,
  TOKEN_DECIMALS,
  VENUE_ID,
  assetFromSearch,
  createMintStream,
  openWebSocket,
  tokenMetadata,
} from '@insidor/venue-solana-pumpfun';

import { backoffDelayMs } from './backoff.ts';
import type { ChainwatchConfig } from './config.ts';
import { coldCursor, type CursorStore } from './cursor.ts';
import type { MintFeed, MintSink } from './feed.ts';
import { createListing, type Listing } from './listing.ts';
import type { Logger } from './log.ts';
import { NotImplemented } from './not-implemented.ts';
import type { StageRunRecorder } from './run-record.ts';
import { createStreamFeed } from './stream-feed.ts';
import { createTradeWatch, type ChainPort, type TradeWatch } from './trade-watch.ts';

export interface Runtime {
  readonly feed: MintFeed;
  /** The second way launches arrive (listing.ts). Null when the policy turns it off. */
  readonly listing: Listing | null;
  readonly sink: MintSink;
  readonly cursors: CursorStore;
  readonly stageRuns: StageRunRecorder;
  /** The trade feed (trade-watch.ts) and how to stop its socket. Null when off or keyless. */
  readonly trades: { readonly watch: TradeWatch; readonly stop: () => void } | null;
}

/**
 * The feed, and the only place a venue's name appears in this service.
 *
 * ★ WHAT IS DELIBERATELY NOT HERE. No socket, no field name, no subscribe frame,
 * no launchpad marker, no idea that a create instruction exists. All of that is
 * in the venue adapter, because it is knowledge about one market on one chain,
 * and a service that learned any of it would be a service that has to be edited
 * to add a second venue. What crosses this line is the shared vocabulary — a
 * `MintEvent` — and the generic push port in stream.ts, which names nothing.
 *
 * The two halves meet by SHAPE and not by import: stream.ts declares what this
 * service needs from a push transport, the adapter's socket client happens to
 * satisfy it, and neither file references the other. This function is the only
 * thing that knows both exist.
 */
function createFeed(cfg: ChainwatchConfig, log: Logger): MintFeed {
  if (cfg.transport !== 'stream') {
    return {
      id: cfg.feedId,
      transport: cfg.transport,
      read: () =>
        Promise.reject(
          new NotImplemented(
            `mint feed ${cfg.feedId} (${cfg.transport}) — call the venue adapter's creation ` +
              'listing, confirm each mint time against the chain, and return a page whose ' +
              '`pageFull` is true when the source returned exactly the limit',
          ),
        ),
    };
  }

  const feedLog = log.child({ feed: cfg.feedId });

  const stream = createMintStream({
    url: cfg.streamUrl,
    chain: CHAIN,
    venue: VENUE_ID,
    decimals: TOKEN_DECIMALS,
    bufferLimit: cfg.streamBufferLimit,
    staleAfterMs: cfg.streamStaleAfterMs,
    // ★ How long a connection must last before its next failure retries at the
    // base delay, and it is the backoff CEILING rather than a value of its own.
    //
    // A connection that dies faster than the longest we were ever prepared to
    // wait has not proven the far end is willing to keep us, so retrying at the
    // base delay would mean hammering harder than we had already decided was
    // reasonable. Deriving it here rather than adding MINT_STREAM_HEALTHY_MS
    // keeps one answer to "how hard do we retry" — the same argument that put
    // `reconnectDelayMs` below on the supervisor's own schedule — and adds no
    // required variable to an environment that is already deployed.
    healthyAfterMs: cfg.backoffMaxMs,
    mintTimeOptions: {
      // Unused on this path — no two sources are being compared, because there
      // is only one — and stated rather than left to a default so the day a
      // chain confirmation is added beside the socket, the tolerance it will be
      // judged against is already a value someone chose.
      agreementToleranceMs: cfg.observationLagS * 1_000,
      observationLagS: cfg.observationLagS,
    },
    now: () => Date.now(),
    // ★ The same schedule the supervisor uses, not a second one. A transport
    // with its own retry curve is a second answer to "how hard do we retry",
    // and the two would drift the first time either was tuned.
    reconnectDelayMs: (attempt) =>
      backoffDelayMs(attempt, { baseMs: cfg.backoffBaseMs, maxMs: cfg.backoffMaxMs }, Math.random()),
    open: openWebSocket,
    // Unref'd: a pending reconnect must never be the reason a stopped process
    // stays alive, because the grace timer's answer to that is exit(1) and an
    // open run row.
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return () => clearTimeout(timer);
    },
    note: (n) => feedLog.warn(n.msg, n.fields),
  });

  // Started here rather than on the first read, so the socket is connecting
  // while the cursor load and the health server are still coming up. A stream
  // opened per read would make every cycle its own outage.
  stream.start();

  return createStreamFeed({
    feedId: cfg.feedId,
    stream,
    now: () => Date.now(),
    note: (msg, fields) => feedLog.warn(msg, fields),
  });
}

/**
 * A stable 32-bit key for `pg_try_advisory_lock`. Postgres keys advisory locks by
 * a bigint and configuration names the lock in words, so the name has to become a
 * number somewhere; doing it deterministically is what makes two chainwatches
 * reading the same `SINGLETON_LOCK_NAME` compete for the same lock across
 * restarts and deploys.
 *
 * Duplicated from the runner rather than shared, for the same reason the logger
 * is, and spelled identically so nobody reading both concludes the two schemes
 * were meant to agree on a value. They are not: different names, different locks.
 */
function lockKey(name: string): number {
  return createHash('sha256').update(name).digest().readUInt32BE(0);
}

/**
 * The launch listing, and the second place this service names a vendor.
 *
 * ★ WHY THESE TWO SOURCES. The newest-pools listing is the market data source the runner already
 * reads, and it lists launches on the curve a few minutes after they happen, whichever
 * transaction version made them — which is exactly what the socket misses.
 *
 * ★ WITH THE PLAN'S KEY WHEN THE SERVICE HAS ONE (COINGECKO_API_KEY), keyless otherwise. Reversed
 * on 20 Oct: keyless, from the host's shared address, the listing was refused (429) often enough
 * to fall behind. Keyed, each page costs one credit of the monthly plan the runner and the read
 * service already use, so the pages are capped by the day in policy (`dayCapPages`) and held to
 * an even pace through it; keyless, the cap is not applied, because nothing is billed. The chain
 * read is one `getMultipleAccounts` a pass for the
 * coins the listing found that we do not hold, on LISTING_RPC_URL when it is set and otherwise on
 * the trade feed's own keyed endpoint (HELIUS_API_KEY), counted against the policy's day of
 * credits for it.
 *
 * ★ NEVER THE CHAIN'S PUBLIC ENDPOINT (the owner: no outside service without asking). With
 * neither variable set the chain is not read at all: listed coins are added with the listing's
 * own name and ticker and no metadata link, and the boot says so once.
 *
 * ★ THE KEY IS NEVER LOGGED. The URL is built here and handed only to the reader; a failed read
 * reports the vendor and the status, never the URL.
 *
 * A listed coin is a `backfill` row (search-asset.ts): we learned of it after the fact, from a
 * listing, and its mint time is the listing's pool creation, ('vendor_field', 'bounded'). It is
 * added only when no row exists, so a coin the socket delivered first is never touched.
 */
function buildListing(cfg: ChainwatchConfig, assets: PgAssetRepo, log: Logger): Listing | null {
  const lp = DEFAULT_POLICY.assets.launchListing;
  if (!lp.on) return null;
  const keyed = cfg.listingMarketKey;
  const market = geckoterminal(
    keyed === null
      ? { plan: 'free', baseUrl: BASE_URLS.free, fetch: globalThis.fetch, timeoutMs: lp.timeoutMs, now: () => Date.now() }
      : { plan: keyed.plan, apiKey: keyed.key, baseUrl: BASE_URLS[keyed.plan], fetch: globalThis.fetch, timeoutMs: lp.timeoutMs, now: () => Date.now() },
  );
  const listingLog = log.child({ part: 'launch-listing' });
  const rpcUrl = cfg.listingRpcUrl ?? (cfg.tradeFeedKey === null ? null : TRADE_RPC_URL + cfg.tradeFeedKey);
  listingLog.info('launch listing on', { chainReads: cfg.listingRpcUrl !== null ? 'LISTING_RPC_URL' : rpcUrl !== null ? 'HELIUS_API_KEY' : 'none', dayCapCredits: lp.dayCapCredits, listingPlan: keyed?.plan ?? 'free', dayCapPages: keyed === null ? null : lp.dayCapPages });
  return createListing(
    {
      page: (n) => market.newLaunches(n),
      known: (addresses) => assets.knownAddresses(CHAIN, addresses),
      details: async (addresses) => (rpcUrl === null ? new Map() : tokenMetadata({ rpcUrl, fetch: globalThis.fetch, timeoutMs: lp.timeoutMs }, addresses)),
      add: (launches, seenAt) =>
        assets.addListed(
          launches.flatMap(({ hit, details }) => {
            const asset = assetFromSearch(
              { ...hit, name: details?.name ?? hit.name, ticker: details?.symbol ?? hit.ticker },
              { firstSeenAt: seenAt, metadataUri: details?.uri ?? null, chainCreatedAt: null },
            );
            return asset === null ? [] : [asset];
          }),
        ),
      /* ★ A paired token is marked only when the chain holds no curve for it (0122): a coin
         paired against another coin is a launch too, and keeps its row. Without a chain endpoint
         nothing can tell the two apart, so nothing is marked. */
      ...(rpcUrl === null
        ? {}
        : {
            markPaired: async (tokens: readonly { address: string; symbol: string | null; name: string | null }[], seenAt: Millis) => {
              const held = await assets.pairedAddresses(CHAIN, tokens.map((t) => t.address));
              const open = tokens.filter((t) => !held.has(t.address));
              if (open.length === 0) return { marked: [], settled: [...held], calls: 0 };
              const { places, calls } = await curvePlaces({ rpcUrl, fetch: globalThis.fetch, timeoutMs: lp.timeoutMs }, open.map((t) => t.address));
              const noCurve = open.filter((t) => places.get(t.address) === 'no_curve');
              const coins = open.filter((t) => places.get(t.address) === 'curve' || places.get(t.address) === 'graduated');
              const marked = await assets.markPaired(CHAIN, VENUE_ID, noCurve, seenAt);
              return { marked, settled: [...held, ...noCurve.map((t) => t.address), ...coins.map((t) => t.address)], calls };
            },
          }),
      now: () => Date.now() as Millis,
      note: (msg, fields) => listingLog.warn(msg, fields),
    },
    {
      pagesPerPass: lp.pagesPerPass,
      maxAgeMs: lp.maxAgeMs,
      accountsPerCall: ACCOUNTS_PER_CALL,
      creditsPerCall: lp.creditsPerCall,
      /* No chain to read: nothing is spent, whatever the cap says. */
      dayCapCredits: rpcUrl === null ? Number.POSITIVE_INFINITY : lp.dayCapCredits,
      /* Keyless pages are not billed: no cap, no pace. */
      dayCapPages: keyed === null ? Number.POSITIVE_INFINITY : lp.dayCapPages,
      paceSlackPages: keyed === null ? Number.POSITIVE_INFINITY : lp.paceSlackPages,
    },
  );
}

/** The chain socket and RPC behind the trade feed, keyed. */
const TRADE_SOCKET_URL = 'wss://mainnet.helius-rpc.com/?api-key=';
const TRADE_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=';

/**
 * The trade feed, and the third place this service names a vendor. Off when the policy says so
 * or no key is set: every watched coin then stays unmeasured, and the rule judges on readings.
 */
function buildTrades(cfg: ChainwatchConfig, db: Db, log: Logger): Runtime['trades'] {
  const tf = DEFAULT_POLICY.oneCoin.tradeFeed;
  const tradeLog = log.child({ part: 'trade-feed' });
  if (!tf.on || cfg.tradeFeedKey === null) {
    tradeLog.warn('trade feed off: watched coins stay unmeasured', { policyOn: tf.on, keySet: cfg.tradeFeedKey !== null });
    return null;
  }
  const reconnectDelayMs = (attempt: number): number => backoffDelayMs(attempt, { baseMs: cfg.backoffBaseMs, maxMs: cfg.backoffMaxMs }, Math.random());
  const schedule = (fn: () => void, ms: number): (() => void) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  };
  /* The free relay when its address is set (the owner's switch, 2026-10-26: the billed socket hit
     its day cap by 06:00 UTC daily); the keyed chain socket otherwise. */
  const socket =
    cfg.tradeRelayUrl !== null
      ? createRelayTradeSocket({
          url: cfg.tradeRelayUrl,
          staleAfterMs: tf.staleAfterMs,
          healthyAfterMs: cfg.backoffMaxMs,
          now: () => Date.now() as Millis,
          reconnectDelayMs,
          open: openWebSocket,
          schedule,
          note: (msg, fields) => tradeLog.warn(msg, fields),
        })
      : createTradeSocket({
          url: TRADE_SOCKET_URL + cfg.tradeFeedKey,
          accountOf: curveAddress,
          staleAfterMs: tf.staleAfterMs,
          probeEveryMs: tf.probeEveryMs,
          // The same answer to "how long must a connection last" as the launch stream's.
          healthyAfterMs: cfg.backoffMaxMs,
          now: () => Date.now() as Millis,
          reconnectDelayMs,
          open: openWebSocket,
          schedule,
          note: (msg, fields) => tradeLog.warn(msg, fields),
        });
  tradeLog.info('trade feed source', { relay: cfg.tradeRelayUrl !== null });
  const rpc = { rpcUrl: TRADE_RPC_URL + cfg.tradeFeedKey, fetch: globalThis.fetch, timeoutMs: tf.callTimeoutMs };
  const chain: ChainPort = {
    /* On the relay a graduated coin is still measured: its pool's trades come on the same stream
       (relay-trade-socket.ts), so only a coin with no curve at all is set aside. */
    places: async (coins) => {
      const r = await curvePlaces(rpc, coins);
      if (cfg.tradeRelayUrl === null) return r;
      return { ...r, places: new Map([...r.places].map(([a, p]) => [a, p === 'graduated' ? 'curve' : p] as const)) };
    },
    transactionTrades: async (signature, coin) => {
      const logs = await transactionLogs(rpc, signature);
      if (logs === null) return null;
      const ev = curveEvents(logs);
      const own = ev.trades.filter((t) => t.mint === coin);
      // Still cut, or a trade not in SOL: not readable whole here.
      if (ev.truncated || own.some((t) => !t.solQuoted)) return null;
      return own.map((t) => ({ coin, user: t.user, creator: t.creator, isBuy: t.isBuy, timestampS: t.timestampS, sol: t.sol, mcapSol: t.mcapSol }));
    },
    opening: async (coin) => {
      const r = await launchOpening(rpc, coin);
      return { opening: r.opening, historyCalls: r.calls };
    },
  };
  const watch = createTradeWatch({
    socket,
    chain,
    store: new PgTradeFeedRepo(db, cfg.chain),
    /* On the relay nothing is billed by the byte, so the day's credit cap would only replay the
       billed socket's spend from earlier in the same UTC day (the switch day opened capped at
       20,006). The chain calls left are bounded by their own per-day lookup counts. */
    policy:
      cfg.tradeRelayUrl === null
        ? DEFAULT_POLICY.oneCoin
        : { ...DEFAULT_POLICY.oneCoin, tradeFeed: { ...tf, dayCapCredits: Number.POSITIVE_INFINITY } },
    now: () => Date.now(),
    note: (level, msg, fields) => tradeLog[level](msg, fields),
  });
  socket.start();
  return { watch, stop: () => socket.stop() };
}

function buildRuntime(cfg: ChainwatchConfig, db: Db, log: Logger): Runtime {
  const assets = new PgAssetRepo(db);

  /*
   * ★ The one place in this service where a contract is narrower than the column
   * it governs, called out rather than worked around.
   *
   * `StageRunRepo.open` takes a `StageName`, and STAGE_NAMES is the seven stages
   * of the DECISION pipeline — 'chainwatch' is not among them. But
   * `internal.stage_runs.stage` is free text on purpose, the watchdog's cadence
   * table names 'chainwatch' directly, and the reason this process writes to that
   * table at all is so the watchdog's "last successful run older than 3× cadence"
   * rule is written once instead of twice. So the repository is bound to this
   * service's own recorder port, whose stage is a string. Nothing is cast and
   * nothing is silenced; the widening is one TypeScript allows on a method. What a
   * human should decide is which side is wrong: whether a service belongs in
   * STAGE_NAMES, or whether StageRunRepo should take the column's own type.
   */
  const stageRuns: StageRunRecorder = new PgStageRunRepo(db);

  return {
    feed: createFeed(cfg, log),
    listing: buildListing(cfg, assets, log),
    trades: buildTrades(cfg, db, log),

    sink: {
      // A MintEvent already carries a whole Asset — the feed's job is to have
      // built one — so persisting a page is the vocabulary going straight in.
      //
      // ★ NOTHING HERE DECIDES WHETHER A MINT TIME MAY BE OVERWRITTEN, and it
      // must not start. `upsert` compares the incoming confidence against the
      // stored one and loses ties, so a time only ever goes up: the 'bounded'
      // reading a socket produces can later be raised to 'exact' by a chain
      // confirmation, and can never be lowered by re-seeing the same coin. A
      // second copy of that rule here would be a second place for it to be
      // wrong, and the way it goes wrong is a confident timestamp walking
      // backwards into a row that already had a better one.
      recordMints: async (mints) => {
        await assets.upsert(mints.map((mint) => mint.asset));
        // The creator's opening buy, where the transport stated one (0112). After the upsert,
        // because it updates the row the upsert just made; a frame without it adds nothing.
        await assets.recordOpenings(
          mints.flatMap((mint) => (mint.opening === undefined ? [] : [{ ref: mint.asset.ref, ...mint.opening }])),
        );
      },

      // A gap is a coverage row that says so, never a missing row. `gap.kind` is
      // carried into the reason because 'not_watching' and 'page_overflow' are
      // answered differently: one is a window nobody was looking at, the other is
      // a window we were connected for and still cannot vouch for.
      recordGap: (gap) =>
        assets.recordCoverage(cfg.chain, gap.fromMs, gap.toMs, null, {
          reason: `${gap.kind}: ${gap.detail}`,
        }),
    },

    cursors: {
      load: async (feedId) => {
        const latest = await assets.latestCoverage(cfg.chain);
        // No coverage row at all: this chain has never been watched. Cold, and
        // genuinely cold — there is no earlier window to have missed.
        if (latest === null) return coldCursor(feedId);
        return { feedId, position: latest.cursorRef, readAt: latest.toMs };
      },

      save: async (cursor, observed) => {
        if (cursor.readAt === null) {
          // Only a cold cursor has no read instant, and a cold cursor has closed
          // no window. Persisting one would write a coverage row asserting we
          // watched an interval that no read stands behind.
          throw new Error(
            'refusing to persist a cursor with no read instant: the coverage row it would ' +
              'land on claims a window this process never closed',
          );
        }

        /*
         * ★ Nothing to claim, and that is a legal outcome rather than an error.
         * The cycle's whole window was declared dark by the gaps it recorded a
         * moment ago — a socket that was down for the entire interval, say — and
         * there is no observed row to hang the resume position on.
         *
         * Inventing one is exactly the bug this shape exists to remove: a row
         * over that window with `gap = false` would say we watched it. So the
         * position is dropped, which costs a diagnostic string and nothing else.
         * The resume INSTANT is unaffected — `latestCoverage` reads `window_to`
         * off the most recent row, and the gap rows this cycle wrote already
         * carry it, because a gap is still a record of where we got to.
         */
        if (observed.length === 0) {
          log.warn('cycle covered no observable time; position not recorded', {
            feedId: cursor.feedId,
            readAt: cursor.readAt,
          });
          return;
        }

        // The position goes on the LAST window only. It is the answer to "where
        // had we got to when this cycle ended", and hanging that off an earlier
        // segment would tie it to an interval it did not close.
        const lastIndex = observed.length - 1;
        for (const [index, window] of observed.entries()) {
          await assets.recordCoverage(
            cfg.chain,
            window.fromMs,
            window.toMs,
            index === lastIndex ? cursor.position : null,
            null,
          );
        }
      },
    },

    stageRuns,
  };
}

/**
 * Open the pool, take the singleton lock, and run the watch loop inside it.
 *
 * `run` is handed the lock's own connection. That is not tidiness: everything the
 * loop writes then travels on the session that holds the lock, so there is no
 * window in which the lock has been released and writes are still in flight.
 */
export async function withRuntime(
  cfg: ChainwatchConfig,
  log: Logger,
  run: (runtime: Runtime) => Promise<void>,
): Promise<void> {
  const pool = createPool(DB_ROLE.internal, {
    applicationName: `insidor-chainwatch-${cfg.feedId}`,
    // The service takes one connection string and decides which role it is for,
    // rather than the pool reading an environment this process already validated
    // once at boot. Session mode is asserted, inside createPool, because of `session`.
    env: { DATABASE_URL_INTERNAL: cfg.databaseUrl },
    // Everything this process writes travels on the lock's own client (see above), so the
    // pool never lends a second one. One session-mode client is this service's whole share
    // of the session pooler, which caps clients per user; the role's default would have
    // let it hold five.
    session: true,
    max: 1,
  });

  try {
    const held = await withAdvisoryLock(pool, lockKey(cfg.singletonLockName), async (db) => {
      log.info('runtime ready', {
        feedId: cfg.feedId,
        chain: cfg.chain,
        transport: cfg.transport,
      });
      await run(buildRuntime(cfg, db, log));
      return true;
    });

    // null means the lock was not granted — `run` never started. Distinguishable
    // from `run` completing, which resolves true.
    if (held === null) {
      throw new Error(
        `another chainwatch already holds ${cfg.singletonLockName}; refusing to start a second one`,
      );
    }
  } finally {
    await pool.end();
  }
}
