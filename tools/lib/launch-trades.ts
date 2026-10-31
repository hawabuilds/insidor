/**
 * ONE LAUNCH'S TRADES, READ OUT OF FULL TRANSACTIONS (tools/odds-backfill.ts). Given the parsed
 * transactions an indexing RPC returns for a coin's address, oldest first, this pulls out what the
 * launch-odds research needs: who traded, which way, how much SOL, and the price after each trade.
 *
 * Why it reads the launchpad's own trade event and not balance changes: on the curve, the event carries
 * the curve's virtual reserves after the trade, which is the price exactly; a balance change mixes in the
 * priority fee and the platform's cut, and on a 0.01 SOL buy those are a fifth of the amount. After the
 * coin graduates its trades are on a pool, which has no such event in the logs, so there the price is the
 * pool's own balances after the trade (the account holding both the coin and wrapped SOL).
 *
 * ★ PRICES ARE IN SOL PER WHOLE TOKEN, never dollars. Every outcome the odds report is a ratio of two
 * prices within the same hour, where SOL's own move is noise; dollars would need a SOL price history we
 * do not hold. The creator's opening buy is the one figure compared with a dollar reading (launch_open),
 * and the bands tool converts it with a rate measured from the launches both sources saw.
 *
 * What breaks if changed carelessly: the event layout offsets. They are the launchpad program's
 * `TradeEvent` as of October 2026 (mint, sol, token, is_buy, user, timestamp, then the four reserves);
 * a program upgrade that reorders them would read nonsense prices, which the backfill's smoke run
 * (prices near 2.8e-8 SOL at launch) is there to catch.
 */

/** Anchor event discriminators: the first 8 bytes of sha256("event:<Name>"). */
const TRADE_EVENT = 'bddb7fd34ee661ee';
const CREATE_EVENT = '1b72a94ddeeb6376';
const COMPLETE_EVENT = '5f72619cd42e9808';
const WSOL = 'So11111111111111111111111111111111111111112';
const LAMPORTS = 1e9;
/** The launchpad's tokens have six decimals. */
const TOKEN_UNITS = 1e6;
const DATA_PREFIX = 'Program data: ';

export interface LaunchTrade {
  readonly slot: number;
  /** Seconds, the block's own clock. */
  readonly blockTime: number;
  readonly wallet: string;
  readonly side: 'buy' | 'sell';
  readonly sol: number;
  /** SOL per whole token after the trade. */
  readonly price: number;
  readonly venue: 'curve' | 'pool';
}

export interface TxReading {
  readonly trades: readonly LaunchTrade[];
  /** The creator, when this transaction is the launch itself. */
  readonly creator: string | null;
  /** The curve completed (the coin graduated) in this transaction. */
  readonly completed: boolean;
  /** Trades of this coin on a curve quoted in something other than SOL: seen, but with no SOL price. */
  readonly unpriced: number;
}

type Json = Record<string, unknown>;
const rec = (v: unknown): Json => (v !== null && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

const b58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = b58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

const u64 = (buf: Buffer, at: number): number => Number(buf.readBigUInt64LE(at));
const key = (buf: Buffer, at: number): string => base58(buf.subarray(at, at + 32));

function eventsIn(logs: readonly unknown[]): Buffer[] {
  const out: Buffer[] = [];
  for (const l of logs) if (typeof l === 'string' && l.startsWith(DATA_PREFIX)) out.push(Buffer.from(l.slice(DATA_PREFIX.length), 'base64'));
  return out;
}

/** The creator out of the launch's `CreateEvent`: three length-prefixed strings, then mint, curve, user, creator. */
function creatorOf(buf: Buffer): string | null {
  let at = 8;
  for (let i = 0; i < 3; i += 1) {
    if (at + 4 > buf.length) return null;
    at += 4 + buf.readUInt32LE(at);
  }
  /* mint, bonding curve, user, then creator */
  const creatorAt = at + 32 * 3;
  return creatorAt + 32 <= buf.length ? key(buf, creatorAt) : null;
}

function signerOf(tx: Json): string | null {
  const keys = arr(rec(rec(tx.transaction).message).accountKeys);
  const first = rec(keys[0]);
  return typeof first.pubkey === 'string' ? first.pubkey : typeof keys[0] === 'string' ? (keys[0] as string) : null;
}

interface Bal { readonly owner: string; readonly mint: string; readonly ui: number }
function balances(list: unknown): Bal[] {
  return arr(list).map((b) => {
    const r = rec(b);
    return { owner: String(r.owner ?? ''), mint: String(r.mint ?? ''), ui: Number(rec(r.uiTokenAmount).uiAmountString ?? rec(r.uiTokenAmount).uiAmount ?? 0) };
  });
}

/** A pool trade: the account holding both the coin and wrapped SOL is the pool; its balances after are the price. */
function poolTrade(tx: Json, mint: string, slot: number, blockTime: number): LaunchTrade | null {
  const meta = rec(tx.meta);
  const pre = balances(meta.preTokenBalances);
  const post = balances(meta.postTokenBalances);
  const signer = signerOf(tx);
  if (signer === null) return null;
  let best: { owner: string; coin: number; sol: number; dCoin: number; dSol: number } | null = null;
  for (const b of post) {
    if (b.mint !== mint || b.owner === signer) continue;
    const solAfter = post.find((p) => p.owner === b.owner && p.mint === WSOL);
    if (solAfter === undefined) continue;
    const coinBefore = pre.find((p) => p.owner === b.owner && p.mint === mint)?.ui ?? 0;
    const solBefore = pre.find((p) => p.owner === b.owner && p.mint === WSOL)?.ui ?? 0;
    if (best === null || b.ui > best.coin) best = { owner: b.owner, coin: b.ui, sol: solAfter.ui, dCoin: b.ui - coinBefore, dSol: solAfter.ui - solBefore };
  }
  if (best === null || best.coin <= 0 || best.sol <= 0 || best.dCoin === 0) return null;
  /* The pool gave coins away: someone bought. */
  const side = best.dCoin < 0 ? 'buy' : 'sell';
  return { slot, blockTime, wallet: signer, side, sol: Math.abs(best.dSol), price: best.sol / best.coin, venue: 'pool' };
}

/** Every trade of `mint` in one parsed transaction, in the order the program logged them. */
export function readTx(tx: unknown, mint: string): TxReading {
  const t = rec(tx);
  const meta = rec(t.meta);
  if (meta.err !== null && meta.err !== undefined) return { trades: [], creator: null, completed: false, unpriced: 0 };
  const slot = Number(t.slot);
  const blockTime = Number(t.blockTime);
  const trades: LaunchTrade[] = [];
  let creator: string | null = null;
  let completed = false;
  let unpriced = 0;
  for (const buf of eventsIn(arr(meta.logMessages))) {
    if (buf.length < 8) continue;
    const disc = buf.subarray(0, 8).toString('hex');
    if (disc === CREATE_EVENT) creator = creatorOf(buf);
    else if (disc === COMPLETE_EVENT) completed = true;
    else if (disc === TRADE_EVENT && buf.length >= 113 && key(buf, 8) === mint) {
      const vSol = u64(buf, 97);
      const vTok = u64(buf, 105);
      /* A curve quoted in something other than SOL logs zero SOL reserves: no SOL price, so no trade here. */
      if (vTok <= 0 || vSol <= 0) {
        unpriced += 1;
        continue;
      }
      trades.push({
        slot,
        blockTime,
        wallet: key(buf, 57),
        side: buf[56] === 1 ? 'buy' : 'sell',
        sol: u64(buf, 40) / LAMPORTS,
        price: vSol / LAMPORTS / (vTok / TOKEN_UNITS),
        venue: 'curve',
      });
    }
  }
  if (trades.length === 0 && creator === null) {
    const p = poolTrade(t, mint, slot, blockTime);
    if (p !== null) trades.push(p);
  }
  return { trades, creator, completed, unpriced };
}
