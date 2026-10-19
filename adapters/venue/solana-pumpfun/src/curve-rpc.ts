/**
 * The three chain reads the trade feed makes besides its socket: where a coin's curve is and
 * whether it is still trading there, one transaction's log lines, and the launch transaction's.
 * Each answer says how many calls it took, because on a metered key every call is a counted cost.
 *
 * WHY THE CURVE AND NOT THE COIN. The socket subscribes to the transactions that mention an
 * account. Measured live on 19 Oct 2026 over the matcher's 328 candidates, subscribing to the coin
 * itself delivered 1.3 MB a minute, nine tenths of it bot transactions on two coins that had already
 * left the curve (1,077 notifications a minute on one, 15 trades); subscribing to the coins' curve
 * accounts delivered 10 notifications on the same coin. Every buy and sell on the curve writes the
 * curve account, so its subscription carries every trade we want and little else. A coin whose curve
 * is complete (graduated) or that has no curve at all trades elsewhere and is NOT measured here,
 * which the caller must record as such: a silent curve after graduation is not a quiet coin.
 *
 * Errors are thrown (unavailable), never answered as "nothing": a failed read and an empty one
 * are different facts. The RPC address carries the key; nothing here prints it.
 *
 * What breaks if changed carelessly: the curve address's seed. It is the program-derived address
 * of ("bonding-curve", mint) under the launchpad's program; a wrong seed subscribes to an account
 * nobody writes, and every coin reads as quiet.
 */

import { PublicKey } from '@solana/web3.js';
import { arr, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

import { PROGRAM_ID, readCurveAccount } from './curve-account.ts';
import { openingBuy } from './events.ts';
import { ACCOUNTS_PER_CALL } from './token-metadata.ts';

const VENDOR = 'solana-rpc';
const CURVE_SEED = Buffer.from('bonding-curve');
/** The RPC's own page limit for an address's signatures. A page this full is not known to reach the first. */
const SIGNATURES_PAGE = 1_000;

export interface CurveRpcConfig {
  readonly rpcUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
}

/** The coin's curve account: the address every trade on the curve writes. */
export function curveAddress(mint: string): string {
  return PublicKey.findProgramAddressSync([CURVE_SEED, new PublicKey(mint).toBuffer()], new PublicKey(PROGRAM_ID))[0].toBase58();
}

async function call(config: CurveRpcConfig, method: string, params: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await config.fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw new VendorUnavailable(VENDOR, method, `request failed: ${error instanceof Error ? error.name : 'unknown'}`);
  }
  if (!response.ok) throw new VendorUnavailable(VENDOR, method, `responded ${response.status}`, response.status);
  const body = rec(await response.json());
  if (body.error !== undefined && body.error !== null) throw new VendorUnavailable(VENDOR, method, `rpc error: ${JSON.stringify(body.error).slice(0, 200)}`);
  return body.result;
}

/** Where a coin trades now, as far as its curve says. */
export type CurvePlace = 'curve' | 'graduated' | 'no_curve';

/** Each coin's curve state, 100 to a call. A coin the chain has no curve for is 'no_curve'. */
export async function curvePlaces(config: CurveRpcConfig, mints: readonly string[]): Promise<{ readonly places: ReadonlyMap<string, CurvePlace>; readonly calls: number }> {
  const places = new Map<string, CurvePlace>();
  let calls = 0;
  for (let i = 0; i < mints.length; i += ACCOUNTS_PER_CALL) {
    const batch = mints.slice(i, i + ACCOUNTS_PER_CALL);
    calls += 1;
    const result = rec(await call(config, 'getMultipleAccounts', [batch.map(curveAddress), { encoding: 'base64' }]));
    arr(result.value).forEach((value, index) => {
      const mint = batch[index];
      if (mint === undefined) return;
      if (value === null || value === undefined) {
        places.set(mint, 'no_curve');
        return;
      }
      const v = rec(value);
      const data = arr(v.data)[0];
      const owner = str(v.owner);
      const curve = typeof data === 'string' && owner !== null ? readCurveAccount(Buffer.from(data, 'base64'), owner) : null;
      places.set(mint, curve === null ? 'no_curve' : curve.complete ? 'graduated' : 'curve');
    });
  }
  return { places, calls };
}

/** One confirmed transaction's log lines, or null when the chain does not have it (yet). One call. */
export async function transactionLogs(config: CurveRpcConfig, signature: string): Promise<readonly string[] | null> {
  const result = await call(config, 'getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (result === null || result === undefined) return null;
  const meta = rec(rec(result).meta);
  if (meta.err !== null && meta.err !== undefined) return null;
  const logs = arr(meta.logMessages).filter((l): l is string => typeof l === 'string');
  return logs.length === 0 ? null : logs;
}

/**
 * The creator's opening buy, read from the coin's first transaction: its oldest signature (one
 * call), then that transaction (one more). Null when the first page does not reach the oldest
 * (a coin with a thousand transactions already), or the first transaction is not this coin's
 * launch: not recorded, never "bought nothing".
 */
export async function launchOpening(config: CurveRpcConfig, mint: string): Promise<{ readonly opening: ReturnType<typeof openingBuy>; readonly calls: number }> {
  const page = arr(await call(config, 'getSignaturesForAddress', [mint, { limit: SIGNATURES_PAGE, commitment: 'confirmed' }]));
  if (page.length === 0 || page.length >= SIGNATURES_PAGE) return { opening: null, calls: 1 };
  const oldest = str(rec(page[page.length - 1]).signature);
  if (oldest === null) return { opening: null, calls: 1 };
  const logs = await transactionLogs(config, oldest);
  return { opening: logs === null ? null : openingBuy(logs, mint), calls: 2 };
}
