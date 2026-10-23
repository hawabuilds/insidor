/**
 * WHERE A COIN WOULD TRADE RIGHT NOW: on the launchpad's curve, through the aggregator, nowhere,
 * or "we could not tell". The one rule, shared by the trade service (which routes an order with
 * it) and the market reader (which writes `tradable` with it), so a card can never say a coin
 * trades when the Buy sheet would answer "can't be traded", or the other way round.
 *
 *   curve        the coin's curve is open and priced in SOL, so the launchpad's own instructions
 *                fill an order
 *   pool         the curve is finished, absent, or priced in another token, and the aggregator
 *                returned a route
 *   none         the same, and the aggregator said there is no route
 *   unavailable  something we asked did not answer; this is not a fact about the coin
 *
 * Its own module, out of curve-trade.ts, because the market reader asks for hundreds of coins a
 * pass and must not read curves one account at a time: `curveStates` reads them in batches of a
 * hundred with one call each, and decodes every account exactly as `curveState` does (the SDK's
 * own decoder; a missing or undecodable account is `none`).
 *
 * ★ A CURVE PRICED IN ANOTHER TOKEN IS NOT `curve`. The launchpad lets a coin's curve be priced in
 * a token other than SOL (a tokenised stock, a stablecoin): a "stock pair". Our curve trade sends
 * SOL, and the program refuses it on such a curve (UnsupportedQuoteMint, 6063 — measured on
 * 2Nyb…pump, paired with TTWo…bKo, 23 Oct 2026), and pricing SOL against its reserves gives a
 * number in the wrong unit. Such a curve is `paired`, and goes to the aggregator, which swaps SOL
 * into the pair token and buys on the curve in one transaction — what the launchpad's own site
 * does. If the aggregator has no route, it is `none`, said before the person taps Buy.
 *
 * What breaks if changed carelessly: the ORDER. An open curve is `curve` before the aggregator is
 * asked, because an aggregator can route a coin that is still on its curve and the trade service
 * builds a curve trade for it. And only the aggregator's "no route" is `none`; a timeout, a rate
 * limit or a dead RPC is `unavailable`, never "this coin cannot be traded".
 */

import { PUMP_SDK, bondingCurvePda, isLegacyQuoteMint } from '@nirholas/pump-sdk';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * open: on its curve, priced in SOL — the only state curve-trade.ts trades. paired: on a curve
 * priced in another token (above: it goes to the aggregator). complete: bonded. none: no curve.
 */
export type CurveState = 'open' | 'paired' | 'complete' | 'none';

export type TradeRoute = 'curve' | 'pool' | 'none' | 'unavailable';

/** The most accounts the chain returns for one multiple-accounts read. */
const ACCOUNTS_PER_CALL = 100;

/**
 * A decoded curve's state. A curve with no quote mint (the older layout) or the SOL marks (the
 * zero key, wrapped SOL) is priced in SOL; anything else is `paired`. A finished curve is
 * `complete` whatever it was priced in: it trades in its pool either way.
 */
export function curveStateOf(curve: { readonly complete: boolean; readonly quoteMint?: PublicKey | null }): CurveState {
  if (curve.complete) return 'complete';
  const quote = curve.quoteMint;
  return quote === undefined || quote === null || isLegacyQuoteMint(quote) ? 'open' : 'paired';
}

/**
 * The route, given the coin's curve state and a way to ask the aggregator for a small quote. The
 * probe is only called when the curve is not open; it resolves on a route and throws otherwise.
 */
export async function routeAfter(state: CurveState, probe: () => Promise<unknown>): Promise<TradeRoute> {
  if (state === 'open') return 'curve';
  try {
    await probe();
    return 'pool';
  } catch (e) {
    /* No route is a fact about the coin; any other failure is ours, and is not "no liquidity". */
    return e instanceof Error && /no route/.test(e.message) ? 'none' : 'unavailable';
  }
}

/**
 * Many coins' curve states, read in batches. A batch whose read fails throws: a dead RPC must not
 * turn into `none` for a hundred coins and send every one of them to the aggregator.
 */
export async function curveStates(rpcUrl: string, mints: readonly string[]): Promise<ReadonlyMap<string, CurveState>> {
  const connection = new Connection(rpcUrl, 'confirmed');
  const out = new Map<string, CurveState>();
  for (let i = 0; i < mints.length; i += ACCOUNTS_PER_CALL) {
    const batch = mints.slice(i, i + ACCOUNTS_PER_CALL);
    const keys = batch.map((m) => {
      try {
        return bondingCurvePda(new PublicKey(m));
      } catch {
        return null;
      }
    });
    const asked = keys.filter((k): k is PublicKey => k !== null);
    const infos = asked.length === 0 ? [] : await connection.getMultipleAccountsInfo(asked);
    let at = 0;
    batch.forEach((mint, j) => {
      if (keys[j] === null) {
        out.set(mint, 'none');
        return;
      }
      const info = infos[at++] ?? null;
      out.set(mint, stateOf(info));
    });
  }
  return out;
}

function stateOf(info: Parameters<typeof PUMP_SDK.decodeBondingCurve>[0] | null): CurveState {
  if (info === null) return 'none';
  try {
    return curveStateOf(PUMP_SDK.decodeBondingCurve(info));
  } catch {
    return 'none';
  }
}
