/**
 * BUY AND SELL ON THE LAUNCHPAD'S BONDING CURVE: a quote, then the same trade as an UNSIGNED
 * transaction. Built with the launchpad SDK's own instructions, so the accounts and fees are
 * the program's, not our reading of them.
 *
 * Its own module, kept out of index.ts, because the SDK brings a large dependency tree that
 * only the trade service needs; the runner and the read service import this package too and
 * must not load it.
 *
 * ★ THE QUOTE IS THE TRADE. `buildCurve` takes the quote back and builds exactly its amounts —
 * it never prices again. Re-pricing at build time would hand the person a transaction for a
 * price they did not agree to. The curve may have moved since the quote; the slippage the
 * person accepted is the program's bound on how far, and a move past it fails in simulation,
 * before anything is signed.
 *
 * ★ NOTHING HERE SIGNS OR SENDS. The transaction leaves as base64 for the person's own wallet;
 * no key is ever in this process.
 *
 * What breaks if changed carelessly: slippage is in basis points everywhere else in Insidor and
 * in PERCENT for the SDK. The conversion is in one place, `percentOf`.
 */

import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } from '@nirholas/pump-sdk';
import { ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';

export type CurveSide = 'buy' | 'sell';

/** A curve quote, as the person sees it and as the build takes it back. Amounts in base units, as strings. */
export interface CurveQuote {
  readonly venue: 'curve';
  readonly side: CurveSide;
  readonly mint: string;
  /** Buy: lamports in. Sell: token base units in. */
  readonly inAmount: string;
  /** Buy: tokens out. Sell: lamports out. Both before slippage. */
  readonly outAmount: string;
  /** The least the person accepts out (sell), or the most they pay in (buy), at their slippage. */
  readonly bound: string;
  readonly slippageBps: number;
}

export type CurveState = 'open' | 'complete' | 'none';

/** Priority fee per compute unit for a curve trade: enough to land in a busy minute, a fraction of a cent. */
const PRIORITY_MICRO_LAMPORTS = 100_000;
const COMPUTE_UNITS = 250_000;
const BPS = 10_000;

const percentOf = (bps: number): number => bps / 100;

function sdk(rpcUrl: string): { readonly online: OnlinePumpSdk; readonly connection: Connection } {
  const connection = new Connection(rpcUrl, 'confirmed');
  return { online: new OnlinePumpSdk(connection), connection };
}

/** Whether the coin is on its curve now: open, finished (it bonded), or no curve at all. */
export async function curveState(rpcUrl: string, mint: string): Promise<CurveState> {
  const { online } = sdk(rpcUrl);
  try {
    const curve = await online.fetchBondingCurve(new PublicKey(mint));
    return curve.complete ? 'complete' : 'open';
  } catch {
    return 'none';
  }
}

async function supplyOf(connection: Connection, mint: PublicKey): Promise<BN> {
  const supply = await connection.getTokenSupply(mint);
  return new BN(supply.value.amount);
}

/** Price a curve trade now. Throws when the coin is not on an open curve. */
export async function quoteCurve(rpcUrl: string, request: { readonly mint: string; readonly side: CurveSide; readonly amount: bigint; readonly slippageBps: number }): Promise<CurveQuote> {
  const { online, connection } = sdk(rpcUrl);
  const mint = new PublicKey(request.mint);
  const [global, feeConfig, curve, mintSupply] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig().catch(() => null),
    online.fetchBondingCurve(mint),
    supplyOf(connection, mint),
  ]);
  if (curve.complete) throw new Error('This coin has left its curve.');
  const amount = new BN(request.amount.toString());
  const out = request.side === 'buy'
    ? getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve: curve, amount })
    : getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve: curve, amount });
  const slip = new BN(request.slippageBps);
  const bound = request.side === 'buy'
    ? amount.add(amount.mul(slip).div(new BN(BPS)))
    : out.sub(out.mul(slip).div(new BN(BPS)));
  return {
    venue: 'curve',
    side: request.side,
    mint: request.mint,
    inAmount: amount.toString(),
    outAmount: out.toString(),
    bound: bound.toString(),
    slippageBps: request.slippageBps,
  };
}

/** The quoted trade, as an unsigned transaction for `user` to sign. Never re-priced. */
export async function buildCurve(rpcUrl: string, quote: CurveQuote, user: string): Promise<{ readonly transactionBase64: string; readonly lastValidBlockHeight: number }> {
  const { online, connection } = sdk(rpcUrl);
  const mint = new PublicKey(quote.mint);
  const owner = new PublicKey(user);
  const global = await online.fetchGlobal();
  const slippage = percentOf(quote.slippageBps);
  const instructions = quote.side === 'buy'
    ? await (async () => {
        const state = await online.fetchBuyState(mint, owner);
        return PUMP_SDK.buyInstructions({ global, ...state, mint, user: owner, amount: new BN(quote.outAmount), solAmount: new BN(quote.inAmount), slippage });
      })()
    : await (async () => {
        const state = await online.fetchSellState(mint, owner);
        return PUMP_SDK.sellInstructions({ global, ...state, mint, user: owner, amount: new BN(quote.inAmount), solAmount: new BN(quote.outAmount), slippage });
      })();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
      ...instructions,
    ],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  return { transactionBase64: Buffer.from(transaction.serialize()).toString('base64'), lastValidBlockHeight };
}

/** Who pays for a signed transaction: its first account. The allowlist is checked against it. */
export function payerOf(signedBase64: string): string {
  return VersionedTransaction.deserialize(Buffer.from(signedBase64, 'base64')).message.staticAccountKeys[0]?.toBase58() ?? '';
}

/**
 * A creator's unclaimed fees, in lamports, from both of the launchpad's programs (the curve and
 * its pool): what sits in their creator vaults above rent, read from the chain. Not "earned to
 * date" — fees already claimed are gone from the vault, and this does not pretend otherwise.
 */
export async function unclaimedCreatorFees(rpcUrl: string, creator: string): Promise<bigint> {
  const { online } = sdk(rpcUrl);
  return BigInt((await online.getCreatorVaultBalanceBothPrograms(new PublicKey(creator))).toString());
}
