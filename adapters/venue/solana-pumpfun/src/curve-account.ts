/**
 * A coin's bonding curve, read from the chain: the curve account's reserves, and how far along
 * the curve is — pump.fun's own measure, tokens sold out of those for sale.
 *
 * The account is read by address (for a coin on the curve, the market data source's pool
 * address is this account) and believed only if it IS one: owned by the launchpad's program and
 * carrying the curve account's eight-byte marker. Anything else is not a curve, and says so.
 *
 * ★ PROGRESS IS TOKENS SOLD, NOT SOL RAISED. A curve graduates when its real token reserve
 * reaches zero, and the launchpad shows progress as the share of the 793.1M tokens for sale that
 * have been sold. read.ts's `curveProgress` measures SOL raised against 85 SOL — the same end
 * point, a different path, and a different number on the way (a sixth of the way in tokens can
 * be a twentieth in SOL). This file is the one read straight from the account, so it measures
 * what the launchpad measures.
 *
 * What breaks if changed carelessly: the layout. Eight bytes of marker, then five little-endian
 * u64s — virtual token, virtual SOL, real token, real SOL, total supply — then one byte,
 * `complete`. A field read at the wrong offset is a plausible number, not an error.
 */

/** The launchpad's program. Only an account it owns is its curve. */
export const PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
/** The first eight bytes of every curve account: the account type's marker. */
const MARKER = '17b7f83760d8ac60';
/** Tokens for sale on a fresh curve, in raw units (793.1M, six decimals). */
export const INITIAL_REAL_TOKEN_UNITS = 793_100_000_000_000n;

export interface CurveAccount {
  readonly virtualTokenUnits: bigint;
  readonly virtualSolLamports: bigint;
  readonly realTokenUnits: bigint;
  readonly realSolLamports: bigint;
  readonly totalSupplyUnits: bigint;
  readonly complete: boolean;
}

/** Decode one account. Null when it is not a curve: wrong owner, wrong marker, too short. */
export function readCurveAccount(data: Uint8Array, owner: string): CurveAccount | null {
  if (owner !== PROGRAM_ID || data.length < 49) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const marker = Array.from(data.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  if (marker !== MARKER) return null;
  const u64 = (offset: number) => view.getBigUint64(offset, true);
  return {
    virtualTokenUnits: u64(8),
    virtualSolLamports: u64(16),
    realTokenUnits: u64(24),
    realSolLamports: u64(32),
    totalSupplyUnits: u64(40),
    complete: data[48] === 1,
  };
}

/** How far along the curve is, as a fraction: tokens sold out of those for sale. */
export function curveProgressOf(curve: CurveAccount): number {
  if (curve.complete) return 1;
  const sold = Number(INITIAL_REAL_TOKEN_UNITS - curve.realTokenUnits) / Number(INITIAL_REAL_TOKEN_UNITS);
  return sold < 0 ? 0 : sold > 1 ? 1 : sold;
}
