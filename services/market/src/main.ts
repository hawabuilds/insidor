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
 * ★ AND `tradable` IS FALSE ON EVERY ROW THIS PROCESS WRITES, which is not a bug and
 * not a pessimistic default. Tradability is decided by asking a venue for a quote. The
 * venue here declares `read` and not `trade` — deliberately; the conformance suite
 * fails a venue whose declaration and implementation disagree — so there is nothing to
 * ask, no quote, and nothing to stand behind. A `true` we cannot back would put a Buy
 * button in front of an order that cannot fill, and 0010's
 * `tradable_requires_a_quoting_venue` makes that unwritable rather than merely unwise.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
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

import { assetsToRead, writeReadings } from './db.ts';
import { quotableBy, toReading } from './reading.ts';
import type { MarketReading } from './reading.ts';

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
          toReading(state, { venueId: String(VENUE_ID), quotedBy: quotableBy(venue) }),
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
        `spent_usd=${meter.spentUsd().toFixed(4)}`,
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
