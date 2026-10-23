/**
 * THE TRADE ROUTE FOR EVERY COIN IN A PASS: what the trade service's GET /venue would answer,
 * worked out for hundreds of coins at once without asking anything more often than it must.
 *
 * Its own module, out of main.ts, so the pacing rules are tested against stand-ins for the chain
 * and the aggregator. The rule itself is not here: it is `routeAfter`, the one the trade service
 * routes orders with, so a card and the Buy sheet cannot disagree about a coin.
 *
 *   1. Every coin's curve is read on every pass, in batches (cheap: one call per hundred). An
 *      open curve priced in SOL is `curve` and the aggregator is never asked; one priced in
 *      another token (a stock pair) is asked like a coin off its curve.
 *   2. A coin off its curve reuses the aggregator's last answer inside the current window
 *      (reading.ts `reusableRoute`), else is asked, at most `maxProbes` coins a pass, in the
 *      order given — the coins on screen first.
 *   3. If the curve read fails, or there is no chain access, nobody is asked: every coin is
 *      `null`, written as not tradable with nobody named. An aggregator answer that is not
 *      "a route" or "no route" (a rate limit, a timeout) is waited out once (`retryAfterMs`) and
 *      the same coin asked again; a second failure stops the probing for this pass, so a
 *      struggling quote service is not asked forty more times.
 *
 * ★ THE PROBES ARE SPACED (`probeGapMs`), NOT SENT BACK TO BACK. Sent back to back, the
 * aggregator answered five and refused the sixth on every pass (the project service's log on
 * 2026-10-21: probed=6 unavailable=1, pass after pass, while the refused coin answered first
 * thing on the next pass), and the first refusal stopped the asking. About 40 coins off their
 * curve were never asked, written "not tradable, nobody asked", and the cards said "can't be
 * traded yet" under coins with $25K to $100K of liquidity that the aggregator had routed every
 * day before. Spaced, a pass asks its bound.
 *
 * What breaks if changed carelessly: reading a failed curve read as `none` would send every coin
 * to the aggregator, and every pump coin there gets "no route" — written as a FACT, not tradable,
 * for coins the trade service would happily fill on their curve.
 */

import { routeAfter, type CurveState } from '@insidor/venue-solana-pumpfun/route.ts';

import { reusableRoute, type LastAnswer, type TradeRoute } from './reading.ts';

export interface RoutePorts {
  /** Curve states for many mints; throws when the chain cannot be read. Null: no chain access. */
  readonly curveStates: ((mints: readonly string[]) => Promise<ReadonlyMap<string, CurveState>>) | null;
  /** A small aggregator quote for one mint; resolves on a route, throws otherwise. */
  readonly probe: (mint: string) => Promise<unknown>;
  /** Waits this long; absent, nothing waits (a test, or a caller that paces itself). */
  readonly pause?: (ms: number) => Promise<void>;
}

export interface RouteOptions {
  readonly nowMs: number;
  readonly reuseMs: number;
  readonly maxProbes: number;
  /** The wait before each probe after the first, so the aggregator's rate limit is not hit. */
  readonly probeGapMs?: number;
  /** The wait before asking a coin again after an answer that was not "route" or "no route". */
  readonly retryAfterMs?: number;
}

export interface RouteCounts {
  curve: number;
  pool: number;
  none: number;
  unavailable: number;
  notAsked: number;
  probed: number;
  reused: number;
}

/** Each address's route, or null when nobody was asked. `keyOf` turns an address into the asset key `last` is keyed by. */
export async function routesFor(
  addresses: readonly string[],
  last: ReadonlyMap<string, LastAnswer>,
  keyOf: (address: string) => string,
  ports: RoutePorts,
  opts: RouteOptions,
): Promise<{ readonly routes: ReadonlyMap<string, TradeRoute | null>; readonly counts: RouteCounts }> {
  const routes = new Map<string, TradeRoute | null>();
  const counts: RouteCounts = { curve: 0, pool: 0, none: 0, unavailable: 0, notAsked: 0, probed: 0, reused: 0 };
  const settle = (address: string, route: TradeRoute | null): void => {
    routes.set(address, route);
    if (route === null || route === 'unavailable') counts.notAsked += 1;
    else counts[route] += 1;
  };

  let states: ReadonlyMap<string, CurveState> | null = null;
  if (ports.curveStates !== null && addresses.length > 0) {
    try {
      states = await ports.curveStates(addresses);
    } catch {
      states = null;
    }
  }
  if (states === null) {
    for (const a of addresses) settle(a, null);
    return { routes, counts };
  }

  let probing = true;
  const pause = async (ms: number | undefined): Promise<void> => {
    if (ports.pause !== undefined && ms !== undefined && ms > 0) await ports.pause(ms);
  };
  for (const address of addresses) {
    const state = states.get(address);
    if (state === undefined) {
      settle(address, null);
      continue;
    }
    if (state === 'open') {
      settle(address, 'curve');
      continue;
    }
    const reused = reusableRoute(last.get(keyOf(address)), opts.nowMs, opts.reuseMs);
    if (reused !== null) {
      counts.reused += 1;
      settle(address, reused);
      continue;
    }
    if (!probing || counts.probed >= opts.maxProbes) {
      settle(address, null);
      continue;
    }
    if (counts.probed > 0) await pause(opts.probeGapMs);
    counts.probed += 1;
    let route = await routeAfter(state, () => ports.probe(address));
    if (route === 'unavailable') {
      /* Once more after a wait: a rate limit clears in seconds, and stopping at the first one left the pass's other coins unasked. */
      await pause(opts.retryAfterMs);
      route = await routeAfter(state, () => ports.probe(address));
    }
    if (route === 'unavailable') {
      /* Written as nobody answering, and the probing stops for this pass. */
      probing = false;
      counts.unavailable += 1;
      routes.set(address, null);
      continue;
    }
    settle(address, route);
  }
  return { routes, counts };
}
