/**
 * SEND: SOL or a coin from the person's wallet to an address they typed, as an UNSIGNED
 * transaction. Ported from the shape of Trador's send, cut to SOL and launchpad coins.
 *
 * Its own module beside curve-trade.ts, for the same reason: it loads the chain library, which
 * only the trade service needs.
 *
 * ★ THE RECIPIENT'S COIN ACCOUNT IS CREATED IF IT IS MISSING, AND THE SENDER PAYS ITS RENT. That
 * is what a wallet does when sending a coin to someone who never held it, and it is why a coin
 * send costs ~0.002 SOL more than the coin; the simulation shows the person before they sign.
 *
 * Nothing here signs or sends.
 */

import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';

export interface TransferRequest {
  readonly from: string;
  readonly to: string;
  /** Null: SOL. Otherwise the coin's address. */
  readonly mint: string | null;
  /** Base units: lamports for SOL, the coin's units otherwise. */
  readonly amount: bigint;
}

export async function buildTransfer(rpcUrl: string, r: TransferRequest): Promise<{ readonly transactionBase64: string; readonly lastValidBlockHeight: number }> {
  const connection = new Connection(rpcUrl, 'confirmed');
  const from = new PublicKey(r.from);
  const to = new PublicKey(r.to);
  let instructions: TransactionInstruction[];
  if (r.mint === null) {
    instructions = [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: r.amount })];
  } else {
    const mint = new PublicKey(r.mint);
    const info = await connection.getParsedAccountInfo(mint);
    const owner = info.value?.owner;
    const data = info.value?.data;
    const decimals = data !== undefined && 'parsed' in data ? (data.parsed as { info?: { decimals?: number } }).info?.decimals : undefined;
    if (owner === undefined || decimals === undefined) throw new Error('This coin could not be read from the chain.');
    const source = getAssociatedTokenAddressSync(mint, from, false, owner);
    const target = getAssociatedTokenAddressSync(mint, to, true, owner);
    instructions = [
      createAssociatedTokenAccountIdempotentInstruction(from, target, to, mint, owner),
      createTransferCheckedInstruction(source, mint, target, from, r.amount, decimals, [], owner),
    ];
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({ payerKey: from, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return { transactionBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString('base64'), lastValidBlockHeight };
}
