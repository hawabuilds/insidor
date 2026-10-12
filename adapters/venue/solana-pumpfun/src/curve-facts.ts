/**
 * TWO FACTS ABOUT A LAUNCHPAD COIN, READ FROM THE CHAIN, for ranks and alerts: the price every
 * coin starts its curve at, and how far along its curve one coin is.
 *
 *   - The starting price is the launchpad's global initial reserves, SOL over tokens. Every coin
 *     on the curve starts there, so it is each coin's earliest price — what "bought early"
 *     (under three times it) is measured against, in SOL, the unit a wallet's buys are in.
 *   - Progress is tokens sold off the curve, 0..1, and 1 once the curve has completed (the coin
 *     graduated). `none` is a coin with no curve at all, which is not "0%".
 *
 * Its own module, out of index.ts, for curve-trade.ts's reason: the launchpad SDK is a large
 * tree that only the services needing it should load.
 */

import { OnlinePumpSdk } from '@nirholas/pump-sdk';
import { Connection, PublicKey } from '@solana/web3.js';

import { INITIAL_REAL_TOKEN_UNITS, curveProgressOf } from './curve-account.ts';

const LAMPORTS_PER_SOL = 1_000_000_000;
/** Every launchpad coin has six decimals. */
const TOKEN_UNITS = 1_000_000;

const sdk = (rpcUrl: string) => new OnlinePumpSdk(new Connection(rpcUrl, 'confirmed'));

/** What one token costs, in SOL, the moment any coin's curve opens. */
export async function launchPriceSol(rpcUrl: string): Promise<number> {
  const g = await sdk(rpcUrl).fetchGlobal();
  const sol = Number(g.initialVirtualSolReserves.toString()) / LAMPORTS_PER_SOL;
  const tokens = Number(g.initialVirtualTokenReserves.toString()) / TOKEN_UNITS;
  return sol / tokens;
}

export type CurveFact = { readonly kind: 'curve'; readonly progress: number; readonly complete: boolean } | { readonly kind: 'none' };

export async function curveOf(rpcUrl: string, mint: string): Promise<CurveFact> {
  let curve;
  try {
    curve = await sdk(rpcUrl).fetchBondingCurve(new PublicKey(mint));
  } catch {
    return { kind: 'none' };
  }
  const realTokenUnits = BigInt(curve.realTokenReserves.toString());
  const progress = curveProgressOf({
    virtualTokenUnits: 0n,
    virtualSolLamports: 0n,
    realTokenUnits: realTokenUnits > INITIAL_REAL_TOKEN_UNITS ? INITIAL_REAL_TOKEN_UNITS : realTokenUnits,
    realSolLamports: 0n,
    totalSupplyUnits: 0n,
    complete: curve.complete,
  });
  return { kind: 'curve', progress, complete: curve.complete };
}
