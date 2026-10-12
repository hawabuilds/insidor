/**
 * CREATE A COIN ON THE LAUNCHPAD: an ordinary SOL-priced pump.fun coin, made with `create_v2`
 * and, if the creator wants, a first buy in the same transaction. Ported from Trador's
 * `pumpLaunch.ts` and `launchAssemble.ts`, with every stock step taken out: no quote mint, no
 * quote vault, no `quote-control` account — the coin is priced in SOL like every pump.fun coin.
 *
 * ★ THE RULES COME FROM THE CHAIN. Whether launches are open (`Global.createV2Enabled`) and what a
 * trade pays the creator (the fee config's tier for a new curve) are read, never assumed. Paused
 * launches are refused with that reason, before anything is built.
 *
 * ★ THE COSTS ARE MEASURED, NOT WRITTEN DOWN. The built transaction is simulated with the
 * creator's balance and every account it creates watched before and after: the network fee is
 * the signatures and priority set here, the rent is what the new accounts hold, and the
 * launchpad's fee is everything else the creator's balance fell by. Trador's method, kept.
 *
 * ★ ONE KEY IS MADE HERE, AND IT IS NOT A WALLET'S. A coin's address is a new keypair that must
 * sign its own creation, once. It is generated in memory for this build, signs that one
 * transaction, and is dropped — never stored, never logged. After the create it has no power:
 * the coin's supply belongs to its curve. The creator's wallet still signs the transaction; this
 * process never holds its key.
 */

import { OnlinePumpSdk, PUMP_SDK, computeFeesBps, getBuyTokenAmountFromSolAmount, newBondingCurve } from '@nirholas/pump-sdk';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';

export class LaunchRefused extends Error {}

export interface LaunchRules {
  /** False when the launchpad has paused new coins. */
  readonly open: boolean;
  /** What a trade on a new coin pays its creator, in basis points, from the chain's fee config. */
  readonly creatorFeeBps: number;
  /** What a trade pays the launchpad, in basis points. */
  readonly protocolFeeBps: number;
}

export interface CostLine {
  readonly key: 'network' | 'rent' | 'launchpad';
  readonly lamports: number;
}

export interface BuiltLaunch {
  /** Base64, signed by the coin's own new key only; the creator's signature is still needed. */
  readonly transactionBase64: string;
  readonly mint: string;
  readonly costs: readonly CostLine[];
  /** What the creator's balance falls by in all, dev buy included. */
  readonly totalLamports: number;
  readonly balanceLamports: number;
  readonly devBuy: { readonly lamports: number; readonly tokensOut: string; readonly supplyBps: number } | null;
}

const LAMPORTS_PER_SIGNATURE = 5_000;
const UNITS_BARE = 250_000;
const UNITS_WITH_BUY = 450_000;
const MICRO_LAMPORTS_PER_UNIT = 50_000;
const MAX_TRANSACTION_BYTES = 1_232;
/** Every launchpad coin: six decimals, one billion supply. */
const SUPPLY = 1_000_000_000_000_000n;
const DEV_BUY_SLIPPAGE_PERCENT = 1;

const sdk = (rpcUrl: string) => {
  const connection = new Connection(rpcUrl, 'confirmed');
  return { connection, online: new OnlinePumpSdk(connection) };
};

/** The launchpad's rules now, read from its global account and fee config. */
export async function launchRules(rpcUrl: string): Promise<LaunchRules> {
  const { online } = sdk(rpcUrl);
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
  const curve = newBondingCurve(global);
  const fees = computeFeesBps({ global, feeConfig, mintSupply: new BN(SUPPLY.toString()), virtualQuoteReserves: curve.virtualQuoteReserves, virtualTokenReserves: curve.virtualTokenReserves });
  return { open: Boolean(global.createV2Enabled), creatorFeeBps: fees.creatorFeeBps.toNumber(), protocolFeeBps: fees.protocolFeeBps.toNumber() };
}

/**
 * The create instruction alone — offline, so the test can read its accounts. A plain SOL-priced
 * coin: the SDK's own `create_v2`, with no account appended after it.
 */
export async function createInstruction(r: { mint: PublicKey; creator: PublicKey; name: string; symbol: string; uri: string }): Promise<TransactionInstruction> {
  return PUMP_SDK.createV2Instruction({ mint: r.mint, name: r.name, symbol: r.symbol, uri: r.uri, creator: r.creator, user: r.creator, mayhemMode: false });
}

export async function buildLaunch(rpcUrl: string, r: { creator: string; name: string; symbol: string; uri: string; devBuyLamports: bigint }): Promise<BuiltLaunch> {
  const { connection, online } = sdk(rpcUrl);
  const global = await online.fetchGlobal();
  if (!global.createV2Enabled) throw new LaunchRefused('pump.fun has new coins paused right now.');

  const creator = new PublicKey(r.creator);
  const mint = Keypair.generate();
  let launch: TransactionInstruction[];
  let tokensOut = 0n;
  if (r.devBuyLamports > 0n) {
    const feeConfig = await online.fetchFeeConfig().catch(() => null);
    const out = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: new BN(r.devBuyLamports.toString()) });
    tokensOut = BigInt(out.toString());
    launch = await PUMP_SDK.createV2AndBuyInstructions({
      global, mint: mint.publicKey, name: r.name, symbol: r.symbol, uri: r.uri, creator, user: creator,
      amount: out, solAmount: new BN(r.devBuyLamports.toString()).muln(100 + DEV_BUY_SLIPPAGE_PERCENT).divn(100), mayhemMode: false,
    });
  } else {
    launch = [await createInstruction({ mint: mint.publicKey, creator, name: r.name, symbol: r.symbol, uri: r.uri })];
  }

  const units = r.devBuyLamports > 0n ? UNITS_WITH_BUY : UNITS_BARE;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: creator,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: MICRO_LAMPORTS_PER_UNIT }), ...launch],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([mint]);
  const bytes = transaction.serialize();
  if (bytes.length > MAX_TRANSACTION_BYTES) throw new LaunchRefused("This launch doesn't fit in one transaction. Shorten the name.");

  /* The accounts the launch writes, watched before and after a simulation: the costs, measured. */
  const writable = message.staticAccountKeys.filter((_, i) => message.isAccountWritable(i));
  const before = await connection.getMultipleAccountsInfo(writable, 'confirmed');
  const sim = await connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: false, accounts: { encoding: 'base64', addresses: writable.map((k) => k.toBase58()) } });
  const creatorIndex = writable.findIndex((k) => k.equals(creator));
  const balance = before[creatorIndex]?.lamports ?? 0;
  if (sim.value.err !== null) {
    const logs = sim.value.logs ?? [];
    const short = /insufficient|AccountNotFound/i.test(`${logs.join(' ')} ${JSON.stringify(sim.value.err)}`);
    throw new LaunchRefused(short ? `Not enough SOL in this wallet: it holds ${(balance / 1e9).toFixed(4)} SOL.` : `The launch would fail: ${logs.slice(-2).join(' ') || JSON.stringify(sim.value.err)}`);
  }
  const after = sim.value.accounts ?? [];
  /* Rent is what each new account must hold to exist, read from the chain for its size — not
     what it ends up holding: the curve account also receives the dev buy's SOL. */
  let rent = 0;
  for (const [i] of writable.entries()) {
    if (i === creatorIndex) continue;
    const post = after[i];
    if ((before[i] === null || before[i] === undefined) && post !== null && post !== undefined && post.lamports > 0) {
      const size = Buffer.from(post.data[0] ?? '', 'base64').length;
      rent += Math.min(post.lamports, await connection.getMinimumBalanceForRentExemption(size));
    }
  }
  const creatorAfter = after[creatorIndex]?.lamports ?? balance;
  const network = message.header.numRequiredSignatures * LAMPORTS_PER_SIGNATURE + Math.ceil((units * MICRO_LAMPORTS_PER_UNIT) / 1_000_000);
  const total = balance - creatorAfter;
  const devBuy = r.devBuyLamports > 0n ? Number(r.devBuyLamports) : 0;
  const launchpad = Math.max(0, total - network - rent - devBuy);

  return {
    transactionBase64: Buffer.from(bytes).toString('base64'),
    mint: mint.publicKey.toBase58(),
    costs: [
      { key: 'network', lamports: network },
      { key: 'rent', lamports: rent },
      { key: 'launchpad', lamports: launchpad },
    ],
    totalLamports: total,
    balanceLamports: balance,
    devBuy: r.devBuyLamports > 0n ? { lamports: devBuy, tokensOut: tokensOut.toString(), supplyBps: Number((tokensOut * 10_000n) / SUPPLY) } : null,
  };
}
