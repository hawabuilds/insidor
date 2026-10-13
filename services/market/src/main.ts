/**
 * The market reader, run once: read the coins we hold, ask a venue what they are worth,
 * append what it said, print the counts, exit.
 *
 * A one-shot rather than a loop, for the same reason services/project is one: there is
 * no cursor to lose and no partial state that survives a crash, so a process that runs,
 * says what it wrote and exits is the whole thing. Put it behind a timer when the
 * cadence matters — `pnpm db:market`, or a cron entry — rather than growing a loop, a
 * health port and a shutdown grace around a program that does one pass.
 *
 * ★ EVERY CHUNK IS ITS OWN TRANSACTION, AND THE WHOLE PASS IS NOT ONE.
 * This is the opposite of the projector's choice and the difference is worth stating,
 * because it is the same reasoning applied to a different kind of value. A board is a
 * FRAME — `(tick, order)` is trusted absolutely and a half-written board is not a
 * slightly stale board, it is a board whose order points at rows that are not there. A
 * market reading is a FACT: what this venue said about this coin at this instant. Facts
 * do not need each other to be true. So a vendor that dies on the fourth chunk leaves
 * the first three readings written and correct, and the coins in the fourth keep the
 * absence they already had. Rolling them back would discard something we learned in
 * order to preserve a consistency that was never claimed.
 *
 * ★ AND `tradable` IS THE TRADE SERVICE'S OWN ROUTE, ASKED THE SAME WAY. The price
 * vendor cannot fill an order, so it is never asked whether a coin trades. Instead every
 * coin read gets the route the trade service's GET /venue would give it, through the same
 * rule (`routeAfter` in adapters/venue/solana-pumpfun/src/route.ts): its curve read from
 * the chain, a hundred accounts to a call, on every pass; and for a coin off its curve a
 * small quote from the aggregator, reused within Policy.market.poolRouteReuseMs and at
 * most Policy.market.maxPoolProbesPerPass a pass. Without chain access (no HELIUS_API_KEY)
 * nobody is asked and every row says so: not tradable, nobody named as quoting. A `true`
 * always carries the name of the route that would fill it, which 0010's
 * `tradable_requires_a_quoting_venue` insists on.
 */

import { DEFAULT_POLICY, assetKey } from '@insidor/contracts';
import type { AssetRef, Millis } from '@insidor/contracts';
import type { Budget } from '@insidor/contracts/ports/meter.ts';
import {
  CHAIN,
  MAX_ADDRESSES_PER_CALL,
  VENUE_ID,
  dexscreenerVenue,
  httpClient,
} from '@insidor/market-dexscreener';
import { inMemoryMeter } from '@insidor/meter';
import { asDb, createPool, DB_ROLE, withTransaction } from '@insidor/store';
import { jupiter, NATIVE } from '@insidor/venue-jupiter';
import { curveStates } from '@insidor/venue-solana-pumpfun/route.ts';

import { assetsToRead, lastAnswers, writeReadings } from './db.ts';
import { toReading, tradeAnswer } from './reading.ts';
import type { MarketReading } from './reading.ts';
import { routesFor } from './trade-route.ts';

/**
 * The vendor's host, overridable so a test or a staging run can point somewhere else.
 *
 * A default rather than a required variable because a fresh clone must be able to run
 * `pnpm db:market` without an .env, exactly as `tools/lib/pgclient.mjs` spells out its
 * local connection string rather than failing on a missing one. The credential is the
 * thing that must never have a default; a public host is not a credential.
 */
const DEFAULT_BASE_URL = 'https://api.dexscreener.com';

/**
 * A wall-clock ceiling for one request. A hung socket in a pass is indistinguishable
 * from a slow vendor, and a pass that never returns stops reading every other coin too
 * — so the deadline is here, at the caller, where it is a policy somebody chose rather
 * than a number buried in a client.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** The trade service's own ceiling on one aggregator quote (services/trade/src/main.ts). */
const ROUTER_TIMEOUT_MS = 8_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

const trimmed = (name: string): string | null => {
  const v = (process.env[name] ?? '').trim();
  return v === '' ? null : v;
};

function connectionUrl(env: Readonly<Record<string, string | undefined>>): string {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set; refusing to start. The market reader writes readings and ' +
        'must hold the service credential — the app role cannot write, deliberately, and ' +
        'starting under it would fail on the first insert rather than at boot.',
    );
  }
  return url;
}

/**
 * The budget handed to the venue.
 *
 * This vendor is free, so `capUsd` binds nothing and the honest ceiling is the one the
 * pass already obeys: the number of assets it asks about, which is
 * Policy.market.maxAssetsPerPass divided across calls of thirty. The Budget is
 * constructed truthfully anyway rather than left as zeroes, because a zero cap would
 * read downstream as "no money at all" and the day a paid venue is added behind the
 * same call site, an honest-looking zero is the worst thing to find there.
 */
function budgetFor(nowMs: Millis, calls: number): Budget {
  return {
    capUsd: DEFAULT_POLICY.budget.dailyUsd,
    spentUsd: 0,
    maxCalls: calls,
    deadline: nowMs + calls * REQUEST_TIMEOUT_MS,
  };
}

function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const pool = createPool(DB_ROLE.service, {
    applicationName: 'insidor-market',
    env: { DATABASE_URL_SERVICE: connectionUrl(process.env) },
  });

  const now = (): Millis => Date.now();
  const meter = inMemoryMeter({
    /* The ledger lives and dies with this process, which is correct for a one-shot: it
       exists so a refused call is refused BEFORE the request, and so the pass can say
       what it asked for. Persisting it is the production meter's job, not a CLI's. */
    dailyCapUsd: DEFAULT_POLICY.budget.dailyUsd,
    softStop: DEFAULT_POLICY.budget.softStopFraction,
    now,
  });

  /* Constructed directly rather than through adapters/venue/registry, because the
     registry builds every venue at once and would need the trading venue's deps — a
     signer's worth of wiring — for a process that only reads. The cost is that this
     line names the venue: when a second read-only venue exists, this becomes a
     registry lookup and the rest of the file does not move. */
  const venue = dexscreenerVenue({
    client: httpClient({
      baseUrl: process.env['MARKET_BASE_URL'] ?? DEFAULT_BASE_URL,
      fetch: globalThis.fetch,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }),
    meter,
    now,
    /* Read from the store when the label table has rows for this venue. Zero is the
       true answer today and is passed explicitly rather than defaulted, because a
       venue under the policy floor may produce 'unsure' at most and a wrong count
       there would silently license a confident answer. Nothing in a READ path gates
       on it, which is why zero is safe to pass here and would not be in a resolve. */
    adjudicatedLabels: 0,
  });

  const read = venue.read;
  if (read === undefined) {
    throw new Error(
      `venue ${String(venue.id)} declares no read capability; there is nothing to ask it for`,
    );
  }

  try {
    const assets = await assetsToRead(
      asDb(pool),
      String(CHAIN),
      DEFAULT_POLICY.market.maxAssetsPerPass,
    );
    const refs: readonly AssetRef[] = assets.map((row) => ({
      chain: CHAIN,
      address: row.address,
    }));

    /* Where the trade service would route each coin, before any price is read: the same
       rule as its GET /venue (trade-route.ts). The RPC and the aggregator are the trade
       service's own: HELIUS_API_KEY, and JUPITER_API_KEY when it is set. */
    const heliusKey = trimmed('HELIUS_API_KEY');
    const rpcUrl = heliusKey === null ? null : `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
    const router = jupiter({
      baseUrl: trimmed('JUPITER_API_URL') ?? 'https://api.jup.ag',
      apiKey: trimmed('JUPITER_API_KEY'),
      fetch: globalThis.fetch,
      timeoutMs: ROUTER_TIMEOUT_MS,
    });
    const probeLamports = BigInt(Math.round(DEFAULT_POLICY.trade.probeSol * LAMPORTS_PER_SOL));
    const keyOf = (address: string): string => String(assetKey({ chain: CHAIN, address }));
    const addresses = assets.map((row) => row.address);
    const { routes, counts: routeCounts } = await routesFor(
      addresses,
      await lastAnswers(asDb(pool), addresses.map(keyOf)),
      keyOf,
      {
        curveStates: rpcUrl === null ? null : (mints) => curveStates(rpcUrl, mints),
        probe: (mint) =>
          router.quote({ inputMint: NATIVE, outputMint: mint, amount: probeLamports, slippageBps: DEFAULT_POLICY.trade.defaultSlippageBps }),
      },
      {
        nowMs: now(),
        reuseMs: DEFAULT_POLICY.market.poolRouteReuseMs,
        maxProbes: DEFAULT_POLICY.market.maxPoolProbesPerPass,
      },
    );

    const batches = chunk(refs, MAX_ADDRESSES_PER_CALL);
    const budget = budgetFor(now(), batches.length);

    let written = 0;
    let priced = 0;
    let noMarket = 0;
    let failed = 0;

    for (const batch of batches) {
      let readings: readonly MarketReading[];
      try {
        const result = await read.states(batch, budget);
        readings = result.value.map((state) =>
          toReading(state, { venueId: String(VENUE_ID), trade: tradeAnswer(routes.get(state.asset.address) ?? null) }),
        );
      } catch (error: unknown) {
        /* One chunk's worth of coins keeps the absence it already had, and the pass
           carries on. Failing the whole run here would mean a single throttled call
           threw away every reading taken before it — and the readings already taken
           are facts, which do not stop being true because a later call failed. */
        failed += batch.length;
        console.warn(
          `${batch.length} coins were not read: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      for (const reading of readings) {
        if (reading.priceUsd.kind === 'read') priced += 1;
        else if (reading.priceUsd.why === 'no_market') noMarket += 1;
      }

      written += await withTransaction(pool, (db) => writeReadings(db, readings));
    }

    console.log(
      `read venue=${String(VENUE_ID)} asked=${refs.length} calls=${batches.length} ` +
        `written=${written} priced=${priced} no_market=${noMarket} unread=${failed} ` +
        `spent_usd=${meter.spentUsd().toFixed(4)} ` +
        `route curve=${routeCounts.curve} pool=${routeCounts.pool} none=${routeCounts.none} ` +
        `not_asked=${routeCounts.notAsked} unavailable=${routeCounts.unavailable} ` +
        `probed=${routeCounts.probed} reused=${routeCounts.reused}${rpcUrl === null ? ' (no HELIUS_API_KEY: nobody asked)' : ''}`,
    );

    /* A pass in which every call failed is an outage, not an empty market, and the two
       must not exit the same way: a timer that sees 0 forever needs to be able to tell
       "nothing to read" from "nothing answered". */
    if (failed > 0 && written === 0 && refs.length > 0) {
      throw new Error(`every call failed; ${failed} coins went unread`);
    }
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`market read failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
