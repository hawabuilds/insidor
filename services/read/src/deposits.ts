/**
 * GET /deposit/:wallet/address?chain=… and GET /deposit/:wallet/arrivals?address=… — money from
 * any chain into the user's Solana wallet, as SOL, through Aurora Intents' persistent deposit
 * addresses (powered by NEAR Intents).
 *
 * Aurora gives every (user, chain) one fixed address. Anything the user sends there on that chain
 * is swapped by Aurora's solvers and paid out as SOL to the user's own wallet; nothing passes
 * through us and nothing is held by us. This file asks Aurora for that address and reads back what
 * has arrived, so the Receive sheet can show the address and then the deposit landing.
 *
 * Its own file, not part of the wallet route: it is the only place the Aurora key is used, and it
 * is a vendor edge with its own failure modes (not approved, rate limited, slow to mint).
 *
 * ★ THE KEY RIDES IN THE URL PATH. Aurora takes the key as a path segment, so no request URL from
 * here may ever reach a log line or a reply: errors are logged by status and error name only.
 *
 * ★ THE ADDRESS IS FIXED, SO IT IS KEPT. The same inputs always return the same address, so one
 * answer per (wallet, chain) is kept for the life of the process; the phone opening the sheet
 * again costs Aurora nothing. EVM chains share one address, so they are one entry, `evm`.
 *
 * ★ MISSING IS A REASON. No key, a key Aurora has not approved for address creation, Aurora down,
 * or our cap reached: each is `kind: 'missing'` with `why`, never an empty or made-up address.
 * An address is the one thing on this screen that loses money if it is wrong.
 *
 * ★ ARRIVALS ARE PAIRED IN ORDER. Aurora lists deposits that reached it (`received`) and payouts
 * that finished (`success`) or failed (`failed`) separately, with no id joining them. The n-th
 * deposit is paired with the n-th settled payout, oldest first; a deposit with no payout yet is
 * still swapping. A payout that failed is shown as failed with its transaction, never as arrived.
 *
 * What breaks if changed carelessly: the recipient is always the wallet in the path, so an address
 * handed out here can only ever pay that wallet. Changing what is sent as `recipient`, `sender` or
 * the destination asset mints a DIFFERENT address, and users who saved the old one would still be
 * paid by it, but this screen would stop showing its arrivals.
 */

import type { Logger } from './log.ts';

const BASE = 'https://intents-api.aurora.dev/api';
const TIMEOUT_MS = 15_000;
/** Native SOL as NEAR Intents names it: what every deposit is paid out as. */
const SOL_ASSET = 'nep141:sol.omft.near';
const TOKENS_KEEP_MS = 3_600_000;
const ARRIVALS_KEEP_MS = 6_000;
const KEPT_MAX = 5_000;
const COINS_SHOWN = 6;

/** The chains the sheet offers, by Aurora's short code. Stellar is left out: its deposits need a memo, and one sent without it is lost. */
export const DEPOSIT_CHAINS = ['evm', 'btc', 'tron', 'ton', 'sui', 'near', 'xrp', 'doge', 'ltc'] as const;
export type DepositChain = (typeof DEPOSIT_CHAINS)[number];
const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'bsc', 'pol', 'op', 'avax']);
/** The coins worth naming first when a chain accepts many. */
const COMMON = ['ETH', 'BTC', 'USDT', 'USDC', 'TRX', 'TON', 'SUI', 'NEAR', 'XRP', 'DOGE', 'LTC', 'BNB', 'POL', 'AVAX'];

export type DepositWhy = 'not_configured' | 'not_approved' | 'upstream_error' | 'busy';

export type DepositAddressReply =
  | { readonly kind: 'ready'; readonly chain: DepositChain; readonly address: string; readonly coins: readonly string[] | null }
  | { readonly kind: 'missing'; readonly why: DepositWhy };

export interface Arrival {
  /** When it reached Aurora, ms. */
  readonly at: number;
  readonly sentAmount: number | null;
  readonly sentCoin: string | null;
  readonly state: 'swapping' | 'arrived' | 'failed';
  /** SOL paid to the wallet; null until it is. */
  readonly gotSol: number | null;
  /** The deposit transaction on the chain it was sent from. */
  readonly txHash: string;
}

export type ArrivalsReply = { readonly kind: 'read'; readonly arrivals: readonly Arrival[] } | { readonly kind: 'missing'; readonly why: DepositWhy };

export interface DepositsDeps {
  /** Aurora Intents key (`AURORA_INTENTS_KEY`). Null: not configured. Never logged. */
  readonly apiKey: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly log: Pick<Logger, 'info'>;
  /** Calls to Aurora allowed per minute across every user. */
  readonly perMinute: number;
}

export interface Deposits {
  readonly address: (wallet: string, chain: DepositChain) => Promise<DepositAddressReply>;
  readonly arrivals: (address: string) => Promise<ArrivalsReply>;
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const isDepositChain = (v: string | null): v is DepositChain => v !== null && (DEPOSIT_CHAINS as readonly string[]).includes(v);

/** A raw on-chain amount in its smallest unit, as a plain number; null when either part is unreadable. */
export function scaled(amount: unknown, decimals: unknown): number | null {
  const a = str(amount);
  const d = num(decimals);
  if (a === null || !/^\d+$/.test(a) || d === null || d < 0 || d > 30) return null;
  const n = Number(a) / 10 ** d;
  return Number.isFinite(n) ? n : null;
}

/** The symbols a chain accepts, common ones first, from Aurora's token list. */
export function coinsOn(chain: DepositChain, tokens: readonly { readonly chain: string; readonly symbol: string }[]): readonly string[] {
  const on = new Set(tokens.filter((t) => (chain === 'evm' ? EVM_CHAINS.has(t.chain) : t.chain === chain)).map((t) => t.symbol));
  const first = COMMON.filter((s) => on.has(s));
  const rest = [...on].filter((s) => !first.includes(s)).sort();
  return [...first, ...rest].slice(0, COINS_SHOWN);
}

export interface Deposit { readonly at: number; readonly assetId: string | null; readonly amount: number | null; readonly txHash: string }

function decodeDeposits(body: unknown): readonly Deposit[] {
  const items = rec(body)['deposits'];
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw): Deposit[] => {
    const it = rec(raw);
    const at = Date.parse(String(it['created_at'] ?? ''));
    const txHash = str(it['tx_hash']);
    if (!Number.isFinite(at) || txHash === null) return [];
    return [{ at, assetId: str(it['asset_id']), amount: scaled(it['amount'], it['decimals']), txHash }];
  }).sort((a, b) => a.at - b.at);
}

/** Pairs deposits with settled payouts in order (see the header), newest first. */
export function pairArrivals(received: readonly Deposit[], success: readonly Deposit[], failed: readonly Deposit[], symbolOf: (assetId: string | null) => string | null): readonly Arrival[] {
  const settled = [...success.map((d) => ({ d, ok: true })), ...failed.map((d) => ({ d, ok: false }))].sort((a, b) => a.d.at - b.d.at);
  return received.map((r, i): Arrival => {
    const s = settled[i];
    return {
      at: r.at,
      sentAmount: r.amount,
      sentCoin: symbolOf(r.assetId),
      state: s === undefined ? 'swapping' : s.ok ? 'arrived' : 'failed',
      gotSol: s !== undefined && s.ok ? s.d.amount : null,
      txHash: r.txHash,
    };
  }).reverse();
}

export function createDeposits(deps: DepositsDeps): Deposits {
  const key = deps.apiKey;
  if (key === null) {
    const missing = { kind: 'missing', why: 'not_configured' } as const;
    return { address: async () => missing, arrivals: async () => missing };
  }

  const asked: number[] = [];
  const addresses = new Map<string, DepositAddressReply & { kind: 'ready' }>();
  const arrivalsKept = new Map<string, { readonly at: number; readonly reply: ArrivalsReply }>();
  let tokens: { readonly at: number; readonly list: readonly { readonly assetId: string; readonly chain: string; readonly symbol: string }[] } | null = null;

  const room = (): boolean => {
    const now = deps.now();
    while (asked.length > 0 && now - (asked[0] ?? 0) >= 60_000) asked.shift();
    if (asked.length >= deps.perMinute) return false;
    asked.push(now);
    return true;
  };

  const call = async (path: string, init?: RequestInit): Promise<{ readonly status: number; readonly body: unknown }> => {
    const res = await deps.fetch(`${BASE}/${path}`, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  const tokenList = async () => {
    if (tokens !== null && deps.now() - tokens.at < TOKENS_KEEP_MS) return tokens.list;
    if (!room()) return tokens?.list ?? null;
    try {
      const r = await call(`tokens/${encodeURIComponent(key)}`);
      if (r.status !== 200 || !Array.isArray(r.body)) return tokens?.list ?? null;
      const list = r.body.flatMap((raw) => {
        const t = rec(raw);
        const assetId = str(t['assetId']);
        const chain = str(t['blockchain']);
        const symbol = str(t['symbol']);
        return assetId === null || chain === null || symbol === null ? [] : [{ assetId, chain, symbol }];
      });
      tokens = { at: deps.now(), list };
      return list;
    } catch (e) {
      deps.log.info('aurora tokens unavailable', { err: e instanceof Error ? e.name : 'unknown' });
      return tokens?.list ?? null;
    }
  };

  const address = async (wallet: string, chain: DepositChain): Promise<DepositAddressReply> => {
    const k = `${wallet}:${chain}`;
    const kept = addresses.get(k);
    if (kept !== undefined) return kept;
    if (!room()) return { kind: 'missing', why: 'busy' };
    try {
      const r = await call(`persistent-deposit-address/${encodeURIComponent(key)}`, {
        method: 'POST',
        body: JSON.stringify({ recipient: wallet, sender: wallet, depositChain: chain, destinationChain: 'sol', destinationAsset: SOL_ASSET }),
      });
      if (r.status === 403) {
        deps.log.info('aurora: key not approved for deposit addresses', { status: r.status });
        return { kind: 'missing', why: 'not_approved' };
      }
      if (r.status === 429) return { kind: 'missing', why: 'busy' };
      const depositAddress = str(rec(r.body)['depositAddress']);
      if (r.status !== 200 || depositAddress === null) {
        deps.log.info('aurora deposit address unavailable', { status: r.status });
        return { kind: 'missing', why: 'upstream_error' };
      }
      const list = await tokenList();
      const reply = { kind: 'ready', chain, address: depositAddress, coins: list === null ? null : coinsOn(chain, list) } as const;
      if (addresses.size >= KEPT_MAX) addresses.delete(addresses.keys().next().value ?? '');
      addresses.set(k, reply);
      return reply;
    } catch (e) {
      deps.log.info('aurora deposit address unavailable', { err: e instanceof Error ? e.name : 'unknown' });
      return { kind: 'missing', why: 'upstream_error' };
    }
  };

  const arrivals = async (depositAddress: string): Promise<ArrivalsReply> => {
    const hit = arrivalsKept.get(depositAddress);
    if (hit !== undefined && deps.now() - hit.at < ARRIVALS_KEEP_MS) return hit.reply;
    if (asked.length + 3 > deps.perMinute) return hit?.reply ?? { kind: 'missing', why: 'busy' };
    let reply: ArrivalsReply;
    try {
      const q = (type: string) => { room(); return call(`persistent-deposit-status/${encodeURIComponent(key)}?type=${type}&address=${encodeURIComponent(depositAddress)}`); };
      const [received, success, failed] = await Promise.all([q('received'), q('success'), q('failed')]);
      if ([received, success, failed].some((r) => r.status !== 200)) {
        deps.log.info('aurora deposit status unavailable', { status: [received.status, success.status, failed.status].join(',') });
        reply = { kind: 'missing', why: received.status === 429 ? 'busy' : 'upstream_error' };
      } else {
        const list = await tokenList();
        const symbols = new Map((list ?? []).map((t) => [t.assetId, t.symbol]));
        reply = { kind: 'read', arrivals: pairArrivals(decodeDeposits(received.body), decodeDeposits(success.body), decodeDeposits(failed.body), (id) => (id === null ? null : symbols.get(id) ?? null)) };
      }
    } catch (e) {
      deps.log.info('aurora deposit status unavailable', { err: e instanceof Error ? e.name : 'unknown' });
      reply = { kind: 'missing', why: 'upstream_error' };
    }
    if (arrivalsKept.size >= KEPT_MAX) arrivalsKept.delete(arrivalsKept.keys().next().value ?? '');
    arrivalsKept.set(depositAddress, { at: deps.now(), reply });
    return reply;
  };

  return { address, arrivals };
}
