/**
 * WHAT A WALLET HOLDS AND WHAT IT TRADED, read from the chain — Trador's `holdings.ts` and
 * `walletTrades.ts` as a vendor edge: the RPC calls and the parsed-transaction call, their reply
 * shapes, and nothing about what the Wallet tab shows.
 *
 * Balances are the chain's own (`getBalance`, and `getTokenAccountsByOwner` for both token
 * programs), never a provider's idea of a portfolio. Trades come from the provider's parsed
 * transactions, read through trades.ts by balance change, never by its label.
 *
 * ★ AN OUTAGE THROWS. A wallet whose balance could not be read is not a wallet holding nothing:
 * Trador wrote a zero into its chart once and learned that. Every reader here throws on a failed
 * call, and an empty answer always means the chain said so.
 */

import { arr, num, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

import type { ParsedTx } from './trades.ts';

export { NATIVE, positionsFrom, profitOf, tradesFromTx, walletLegs } from './trades.ts';
export type { ParsedTx, Position, Profit, Trade } from './trades.ts';

const VENDOR = 'chain-rpc';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export interface Held {
  readonly mint: string;
  /** Base units, exact. */
  readonly amount: string;
  readonly decimals: number;
}

export interface Balances {
  readonly lamports: string;
  /** Every coin with a non-zero balance, summed across its accounts. */
  readonly tokens: readonly Held[];
}

/** The three replies → a wallet's balances. Pure, tested against recorded replies. */
export function readBalances(balance: unknown, ...accountReplies: readonly unknown[]): Balances {
  const lamports = num(rec(rec(balance).result).value);
  if (lamports === null) throw new VendorUnavailable(VENDOR, 'getBalance', 'no balance in the reply');
  const byMint = new Map<string, { amount: bigint; decimals: number }>();
  for (const reply of accountReplies) {
    const value = rec(rec(reply).result).value;
    if (!Array.isArray(value)) throw new VendorUnavailable(VENDOR, 'getTokenAccountsByOwner', 'no accounts in the reply');
    for (const entry of value) {
      const info = rec(rec(rec(rec(rec(entry).account).data).parsed).info);
      const mint = str(info.mint);
      const t = rec(info.tokenAmount);
      const amount = str(t.amount);
      const decimals = num(t.decimals);
      if (mint === null || amount === null || !/^\d+$/.test(amount) || decimals === null || amount === '0') continue;
      const held = byMint.get(mint);
      byMint.set(mint, { amount: (held?.amount ?? 0n) + BigInt(amount), decimals });
    }
  }
  return { lamports: String(lamports), tokens: [...byMint].map(([mint, h]) => ({ mint, amount: h.amount.toString(), decimals: h.decimals })) };
}

export function readSignatures(raw: unknown): readonly string[] {
  return arr(rec(raw).result).flatMap((s) => {
    const sig = str(rec(s).signature);
    return sig === null || rec(s).err !== null && rec(s).err !== undefined ? [] : [sig];
  });
}

export interface PortfolioConfig {
  readonly rpcUrl: string;
  /** The parsed-transactions endpoint, key included; null: trades are not read. */
  readonly parseUrl: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
}

export function portfolioReader(config: PortfolioConfig) {
  const post = async (url: string, body: unknown, label: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await config.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (e) {
      throw new VendorUnavailable(VENDOR, label, `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    if (!response.ok) throw new VendorUnavailable(VENDOR, label, `responded ${response.status}`, response.status);
    const parsed: unknown = await response.json();
    if (rec(parsed).error !== undefined && rec(parsed).error !== null) throw new VendorUnavailable(VENDOR, label, 'rpc error');
    return parsed;
  };
  const rpc = (method: string, params: unknown) => post(config.rpcUrl, { jsonrpc: '2.0', id: 1, method, params }, method);

  return {
    async balances(owner: string): Promise<Balances> {
      const opts = { encoding: 'jsonParsed', commitment: 'confirmed' };
      const [balance, classic, t22] = await Promise.all([
        rpc('getBalance', [owner, { commitment: 'confirmed' }]),
        rpc('getTokenAccountsByOwner', [owner, { programId: TOKEN_PROGRAM }, opts]),
        rpc('getTokenAccountsByOwner', [owner, { programId: TOKEN_2022 }, opts]),
      ]);
      return readBalances(balance, classic, t22);
    },
    async signatures(owner: string, limit: number): Promise<readonly string[]> {
      return readSignatures(await rpc('getSignaturesForAddress', [owner, { limit }]));
    },
    /** Parsed transactions, at most a hundred a call. Empty when no parse endpoint is configured. */
    async parse(signatures: readonly string[]): Promise<readonly ParsedTx[]> {
      if (config.parseUrl === null || signatures.length === 0) return [];
      const out: ParsedTx[] = [];
      for (let i = 0; i < signatures.length; i += 100) {
        const reply = await post(config.parseUrl, { transactions: signatures.slice(i, i + 100) }, 'parse transactions');
        if (!Array.isArray(reply)) throw new VendorUnavailable(VENDOR, 'parse transactions', 'not a list');
        out.push(...(reply as ParsedTx[]));
      }
      return out;
    },
  };
}

export type PortfolioReader = ReturnType<typeof portfolioReader>;
