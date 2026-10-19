/**
 * The launchpad's own trade and launch events, read out of a transaction's log lines: who bought or
 * sold, how much, at what reserves, and who made the coin. Pure: bytes in, facts out.
 *
 * WHY OUR OWN READER. The launchpad's published SDK can decode these, and it is what a trader's
 * code imports — but its licence file reads "all rights reserved", its repo churns by the thousand
 * commits, and the trade feed would load its whole dependency tree into a process that only needs
 * two fixed layouts. So this file reads them, and the SDK is used only in the test, to check this
 * file against it on logs captured live (19 Oct 2026).
 *
 * WHAT IT BELIEVES.
 *   - Only a `Program data:` line emitted while the launchpad's program is the one running. The
 *     log is a call stack (`invoke [n]` … `success`/`failed`); an event from any other program —
 *     its swap pool after graduation, a router, a bot — that happens to share an event name (and so
 *     an eight-byte marker) is not ours, and reading it would invent a trade.
 *   - A trade's amounts in SOL only when the trade was quoted in SOL. The launchpad now runs curves
 *     quoted in other tokens; on those `sol_amount` is 0 and the money is in `quote_amount`. Such a
 *     trade is returned with `solQuoted: false` and NO SOL figures, so a caller cannot sum it as a
 *     zero-SOL buy. An event too short to name its quote is the older layout, which was SOL only.
 *   - A truncated log (the node cut it) is reported as truncated: what was read before the cut is
 *     returned, but the caller must not treat the list as complete.
 *
 * The market cap is the curve's price times the coin's whole supply: virtual SOL over virtual
 * tokens, times one billion tokens (every launch on this venue mints exactly that; the launch event
 * states it, and the decoder checks a launch against it).
 *
 * What breaks if changed carelessly: the offsets. A trade event is an eight-byte marker, then
 * mint(32) sol(u64) tokens(u64) is_buy(u8) user(32) timestamp(i64) virtual SOL, virtual tokens,
 * real SOL, real tokens (u64 each), fee recipient(32), fee bps, fee (u64), creator(32), creator fee
 * bps, creator fee (u64), track volume(u8), four u64/i64 counters, the instruction name (u32 length
 * and bytes), mayhem(u8), four u64 fee fields, the shareholder list (u32 count × 34 bytes), then the
 * quote mint(32). Little-endian throughout. A field read at the wrong offset is a plausible number.
 */

/** The launchpad's program: the only emitter whose events are believed. */
export const LAUNCHPAD_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
/** Every launch mints one billion tokens at six decimals. */
export const SUPPLY_UNITS = 1_000_000_000_000_000n;
const TOKEN_UNITS_PER_TOKEN = 1_000_000;
const LAMPORTS_PER_SOL = 1_000_000_000;
/** The quote of a SOL curve: the all-zero key (shown as the system program), or wrapped SOL. */
const SOL_QUOTES = new Set(['11111111111111111111111111111111', 'So11111111111111111111111111111111111111112']);

const TRADE_MARKER = [189, 219, 127, 211, 78, 230, 97, 238];
const CREATE_MARKER = [27, 114, 169, 77, 222, 235, 99, 118];
const COMPLETE_MARKER = [95, 114, 97, 156, 212, 46, 152, 8];

const DATA_PREFIX = 'Program data: ';
const TRUNCATED = 'Log truncated';
/** The fixed prefix up to and including `creator`. Shorter is not a trade event. */
const TRADE_FIXED_BYTES = 209;
/** One shareholder: a key and a u16 share. */
const SHAREHOLDER_BYTES = 34;
/** A shareholder list longer than this is not a list we were sent; stop reading. */
const SHAREHOLDERS_MAX = 64;
const STRING_MAX = 256;

export interface TradeFacts {
  readonly mint: string;
  readonly user: string;
  readonly creator: string;
  readonly isBuy: boolean;
  /** Seconds, the chain's clock. */
  readonly timestampS: number;
  readonly tokens: number;
  /** False: quoted in another token; the SOL fields below are null, never 0. */
  readonly solQuoted: boolean;
  readonly sol: number | null;
  /** The cap in SOL right after this trade. Null when not SOL-quoted or the reserves are empty. */
  readonly mcapSol: number | null;
}

export interface CreateFacts {
  readonly mint: string;
  readonly creator: string;
  readonly user: string;
  readonly timestampS: number;
  readonly solQuoted: boolean;
  readonly mcapSol: number | null;
}

export interface CurveLogEvents {
  readonly trades: readonly TradeFacts[];
  readonly creates: readonly CreateFacts[];
  /** Mints whose curve completed (graduated) in this transaction. */
  readonly completed: readonly string[];
  /** The node cut the log: there may be events after the cut that are not here. */
  readonly truncated: boolean;
  /** Launchpad data lines with a known marker that did not decode. */
  readonly undecodable: number;
}

/* ── base58, for keys ────────────────────────────────────────────────── */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      const x = (digits[i] ?? 0) * 256 + carry;
      digits[i] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i] ?? 0];
  return out;
}

/* ── a bounds-checked reader ─────────────────────────────────────────── */

class Reader {
  readonly #b: Uint8Array;
  readonly #v: DataView;
  #at: number;
  constructor(b: Uint8Array, at: number) {
    this.#b = b;
    this.#v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.#at = at;
  }
  has(n: number): boolean {
    return this.#at + n <= this.#b.length;
  }
  skip(n: number): void {
    this.need(n);
    this.#at += n;
  }
  need(n: number): void {
    if (!this.has(n)) throw new RangeError('event shorter than its layout');
  }
  key(): string {
    this.need(32);
    const k = base58(this.#b.subarray(this.#at, this.#at + 32));
    this.#at += 32;
    return k;
  }
  u64(): bigint {
    this.need(8);
    const n = this.#v.getBigUint64(this.#at, true);
    this.#at += 8;
    return n;
  }
  i64(): bigint {
    this.need(8);
    const n = this.#v.getBigInt64(this.#at, true);
    this.#at += 8;
    return n;
  }
  u32(): number {
    this.need(4);
    const n = this.#v.getUint32(this.#at, true);
    this.#at += 4;
    return n;
  }
  bool(): boolean {
    this.need(1);
    const n = this.#b[this.#at] ?? 0;
    this.#at += 1;
    return n === 1;
  }
  str(): string {
    const n = this.u32();
    if (n > STRING_MAX) throw new RangeError('string longer than any field');
    this.need(n);
    const s = new TextDecoder().decode(this.#b.subarray(this.#at, this.#at + n));
    this.#at += n;
    return s;
  }
}

const startsWith = (b: Uint8Array, marker: readonly number[]): boolean => b.length >= 8 && marker.every((x, i) => b[i] === x);

/** Price × supply, in SOL. Null on an empty reserve: a cap is never 0. */
function capSol(vSol: bigint, vTok: bigint): number | null {
  if (vSol <= 0n || vTok <= 0n) return null;
  const cap = (Number(vSol) / LAMPORTS_PER_SOL) / (Number(vTok) / TOKEN_UNITS_PER_TOKEN) * (Number(SUPPLY_UNITS) / TOKEN_UNITS_PER_TOKEN);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/** One trade event's bytes (marker included). Null when it is not one. Throws when it is cut short. */
export function decodeTradeEvent(b: Uint8Array): TradeFacts | null {
  if (!startsWith(b, TRADE_MARKER)) return null;
  if (b.length < TRADE_FIXED_BYTES) throw new RangeError('trade event shorter than its fixed fields');
  const r = new Reader(b, 8);
  const mint = r.key();
  const sol = r.u64();
  const tokens = r.u64();
  const isBuy = r.bool();
  const user = r.key();
  const ts = r.i64();
  const vSol = r.u64();
  const vTok = r.u64();
  r.skip(8 + 8 + 32 + 8 + 8); // real SOL, real tokens, fee recipient, fee bps, fee
  const creator = r.key();
  /* The quote: present on the current layout only. Absent means the older, SOL-only layout. */
  let quote: string | null = null;
  r.skip(8 + 8 + 1 + 8 + 8 + 8 + 8); // creator fee bps, creator fee, track volume, four counters
  if (r.has(4)) {
    r.str(); // instruction name
    r.skip(1 + 8 + 8 + 8 + 8); // mayhem, cashback bps, cashback, buyback bps, buyback fee
    const holders = r.u32();
    if (holders > SHAREHOLDERS_MAX) throw new RangeError('shareholder list longer than any curve has');
    r.skip(holders * SHAREHOLDER_BYTES);
    quote = r.key();
  }
  const solQuoted = quote === null || SOL_QUOTES.has(quote);
  return {
    mint,
    user,
    creator,
    isBuy,
    timestampS: Number(ts),
    tokens: Number(tokens) / TOKEN_UNITS_PER_TOKEN,
    solQuoted,
    sol: solQuoted ? Number(sol) / LAMPORTS_PER_SOL : null,
    mcapSol: solQuoted ? capSol(vSol, vTok) : null,
  };
}

/** One launch event's bytes (marker included). Null when it is not one. Throws when it is cut short. */
export function decodeCreateEvent(b: Uint8Array): CreateFacts | null {
  if (!startsWith(b, CREATE_MARKER)) return null;
  const r = new Reader(b, 8);
  r.str();
  r.str();
  r.str(); // name, symbol, uri: the launch socket's job, not this one's
  const mint = r.key();
  r.key(); // bonding curve
  const user = r.key();
  const creator = r.key();
  const ts = r.i64();
  const vTok = r.u64();
  const vSol = r.u64();
  r.u64(); // real tokens
  const supply = r.u64();
  r.key(); // token program
  let quote: string | null = null;
  if (r.has(1 + 1 + 32)) {
    r.skip(2); // mayhem, cashback
    quote = r.key();
  }
  const solQuoted = quote === null || SOL_QUOTES.has(quote);
  return { mint, creator, user, timestampS: Number(ts), solQuoted, mcapSol: solQuoted && supply === SUPPLY_UNITS ? capSol(vSol, vTok) : null };
}

function decodeComplete(b: Uint8Array): string | null {
  if (!startsWith(b, COMPLETE_MARKER)) return null;
  const r = new Reader(b, 8);
  r.key(); // user
  return r.key();
}

const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const LEAVE = /^Program (\w+) (success|failed)/;

/** Every launchpad event in one transaction's log lines, in order. */
export function curveEvents(logs: readonly string[]): CurveLogEvents {
  const trades: TradeFacts[] = [];
  const creates: CreateFacts[] = [];
  const completed: string[] = [];
  const stack: string[] = [];
  let truncated = false;
  let undecodable = 0;
  for (const line of logs) {
    if (line.includes(TRUNCATED)) {
      truncated = true;
      continue;
    }
    const enter = INVOKE.exec(line);
    if (enter !== null) {
      stack.push(enter[1] ?? '');
      continue;
    }
    const leave = LEAVE.exec(line);
    if (leave !== null) {
      stack.pop();
      continue;
    }
    if (!line.startsWith(DATA_PREFIX) || stack[stack.length - 1] !== LAUNCHPAD_PROGRAM) continue;
    let bytes: Uint8Array;
    try {
      bytes = Buffer.from(line.slice(DATA_PREFIX.length), 'base64');
    } catch {
      continue;
    }
    try {
      const t = decodeTradeEvent(bytes);
      if (t !== null) {
        trades.push(t);
        continue;
      }
      const c = decodeCreateEvent(bytes);
      if (c !== null) {
        creates.push(c);
        continue;
      }
      const done = decodeComplete(bytes);
      if (done !== null) completed.push(done);
    } catch {
      undecodable += 1;
    }
  }
  return { trades, creates, completed, truncated, undecodable };
}

/**
 * The creator's opening buy, from the launch transaction's log: the launch event names the creator,
 * and the creator's own buys of that coin in the same transaction are the opening. No buy by the
 * creator is a real 0; a log with no launch event of this coin, a coin quoted in another token, or
 * a cut log with no buy read, is null — not recorded, never "bought nothing".
 */
export function openingBuy(logs: readonly string[], mint: string): { readonly creatorBuyTokens: number; readonly creatorBuySol: number; readonly launchMcapSol: number | null } | null {
  const ev = curveEvents(logs);
  const create = ev.creates.find((c) => c.mint === mint);
  if (create === undefined || !create.solQuoted) return null;
  const own = ev.trades.filter((t) => t.mint === mint && t.isBuy && t.user === create.creator && t.sol !== null);
  /* A cut log with no buy read cannot tell "bought nothing" from "the buy was past the cut". The
     opening buy comes straight after the launch, before any bundled buys, so a cut log that holds
     it is read. */
  if (ev.truncated && own.length === 0) return null;
  const last = own[own.length - 1];
  return {
    creatorBuyTokens: own.reduce((a, t) => a + t.tokens, 0),
    creatorBuySol: own.reduce((a, t) => a + (t.sol ?? 0), 0),
    launchMcapSol: last !== undefined ? last.mcapSol : create.mcapSol,
  };
}
