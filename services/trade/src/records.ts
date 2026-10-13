/**
 * THE TRADE RECORD: every transaction this service builds or sends, written to public.trade
 * (0062) at build, at send, and when it is seen landed — so the Portfolio and an audit can see
 * real trades, not reconstruct them from logs.
 *
 * Its own file because the routes must not know how a record is kept, and because the one rule
 * here is the opposite of the routes' rule: a trade path fails closed, a record fails OPEN. A
 * database that is down, or a migration not yet applied, logs one line and the trade goes on;
 * nobody's buy is refused because a bookkeeping write failed.
 *
 * ★ THE KEY IS THE MESSAGE HASH. A serialized transaction is its signatures followed by its
 * message, and the message is what the wallet signs. The unsigned transaction /build returns
 * and the signed one /send receives carry the same message, so hashing it links the two
 * without the app carrying an id. Hashing the whole transaction instead would give the signed
 * copy a different key and every send would look like a trade nobody built.
 *
 * ★ NOT SEEN IS NOT FAILED. After a send, the chain is asked a few times whether the
 * transaction landed. Landed and succeeded is `confirmed`, landed and failed is `failed`; never
 * found leaves the row `sent`, because a lookup that came back empty says nothing about the
 * trade.
 *
 * Never a key and never the transaction bytes: only the facts the 0062 header lists.
 */

import { createHash } from 'node:crypto';

export type TradeKind = 'buy' | 'sell' | 'transfer' | 'launch';

export interface BuiltRecord {
  readonly id: string;
  readonly wallet: string;
  readonly kind: TradeKind;
  readonly venue: 'curve' | 'pool' | null;
  /** Null: SOL itself. */
  readonly mint: string | null;
  readonly to: string | null;
  /** Base units, as decimal strings. */
  readonly inAmount: string | null;
  readonly outAmount: string | null;
  readonly bound: string | null;
  readonly slippageBps: number | null;
  readonly feeBps: number | null;
  readonly costLamports: number | null;
  readonly simulatedOk: boolean;
  readonly simulationError: string | null;
}

export interface TradeRecords {
  built(r: BuiltRecord): Promise<void>;
  /** `signature` null: the send was refused, and `error` says why. */
  sent(id: string, wallet: string, signature: string | null, error: string | null): Promise<void>;
  settled(id: string, signature: string, ok: boolean, error: string | null): Promise<void>;
}

/** What records nothing: no database configured. */
export const NO_RECORDS: TradeRecords = { built: async () => undefined, sent: async () => undefined, settled: async () => undefined };

/** The hash of a serialized transaction's message (hex), or null when the bytes are not one. */
export function messageKey(base64: string): string | null {
  const bytes = Buffer.from(base64, 'base64');
  /* The signature count is a compact-u16: seven bits a byte, high bit set while more follow. */
  let count = 0;
  let at = 0;
  for (let shift = 0; at < bytes.length && at < 3; shift += 7) {
    const b = bytes[at] ?? 0;
    at += 1;
    count |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
  }
  const start = at + count * SIGNATURE_BYTES;
  if (count === 0 || start >= bytes.length) return null;
  return createHash('sha256').update(bytes.subarray(start)).digest('hex');
}

const SIGNATURE_BYTES = 64;

interface Query {
  query(sql: string, params: readonly unknown[]): Promise<unknown>;
}

/** Records through 0062's functions. Every write's failure is logged and swallowed — see the header. */
export function pgRecords(db: Query, log: { error(msg: string, f?: Record<string, unknown>): void }): TradeRecords {
  const run = async (what: string, sql: string, params: readonly unknown[]): Promise<void> => {
    try {
      await db.query(sql, params);
    } catch (e) {
      log.error('trade record not written', { what, err: e instanceof Error ? e.message.slice(0, 200) : 'unknown' });
    }
  };
  return {
    built: (r) => run('built', 'select public.record_trade_built($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [
      r.id, r.wallet, r.kind, r.venue, r.mint, r.to, r.inAmount, r.outAmount, r.bound, r.slippageBps, r.feeBps,
      r.costLamports === null ? null : Math.round(r.costLamports), r.simulatedOk, r.simulationError,
    ]),
    sent: (id, wallet, signature, error) => run('sent', 'select public.record_trade_sent($1,$2,$3,$4)', [id, wallet, signature, error]),
    settled: (id, signature, ok, error) => run('settled', 'select public.record_trade_settled($1,$2,$3,$4)', [id, signature, ok, error]),
  };
}

/**
 * When the chain is asked whether a sent transaction landed, in ms after the send. Spread over
 * about two and a half minutes: most land in seconds, and a transaction whose blockhash has
 * expired (about a minute and a half) can no longer land at all.
 */
export const SETTLE_CHECKS_MS: readonly number[] = [3_000, 8_000, 20_000, 45_000, 90_000];

/**
 * Asks the chain at each check until the transaction is seen, then records how it ended. Run
 * without awaiting; it never throws. A lookup that fails is the same as not found yet.
 */
export async function watchSettlement(
  id: string,
  signature: string,
  deps: {
    readonly landed: (signature: string) => Promise<{ readonly ok: boolean } | null>;
    readonly records: TradeRecords;
    readonly sleep: (ms: number) => Promise<void>;
    readonly checksMs?: readonly number[];
  },
): Promise<'confirmed' | 'failed' | 'unseen'> {
  let waited = 0;
  for (const at of deps.checksMs ?? SETTLE_CHECKS_MS) {
    await deps.sleep(Math.max(0, at - waited));
    waited = at;
    let tx: { readonly ok: boolean } | null = null;
    try {
      tx = await deps.landed(signature);
    } catch {
      tx = null;
    }
    if (tx !== null) {
      await deps.records.settled(id, signature, tx.ok, tx.ok ? null : 'The transaction landed and failed on the chain.');
      return tx.ok ? 'confirmed' : 'failed';
    }
  }
  return 'unseen';
}
