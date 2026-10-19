/**
 * A launch's name, ticker and metadata link, read from its token account on the chain — many
 * coins in one call, from any plain RPC, no key and no indexer.
 *
 * WHY IT EXISTS. The launch socket hands us these three in its frame. A launch it never sent (see
 * the market adapter's new-pools.ts: version-1 transactions) is found by a pool listing that
 * carries a ticker and a display name but no metadata link — and without the link the coin has no
 * picture and no declared links, so it could never be matched to a post by picture. The launchpad's
 * current create stores all three inside the token account itself (the token program's metadata
 * extension), so one `getMultipleAccounts` for up to 100 coins answers it.
 *
 * WHAT IT BELIEVES. Only an account owned by the extended token program, of account type "mint",
 * whose metadata extension parses whole. Anything else — a classic token account, a truncated
 * extension, a length running past the data — is missing from the answer, never a guess. The
 * strings are the creator's; they are bounded by the caller exactly as the socket's are.
 *
 * What breaks if changed carelessly: the layout. A mint account is 82 bytes, padded to 165, then
 * one account-type byte (1 = mint), then extensions as (u16 type, u16 length, value). The metadata
 * extension (type 19) is update authority (32) and mint (32), then name, symbol and uri, each a
 * u32 little-endian length and that many UTF-8 bytes. An offset read wrong is a plausible string,
 * not an error.
 */

import { arr, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

/** The extended token program; only an account it owns can carry the metadata extension. */
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ACCOUNT_TYPE_OFFSET = 165;
const ACCOUNT_TYPE_MINT = 1;
const EXTENSION_TOKEN_METADATA = 19;
/** No field in this extension is longer than this; past it the bytes are not what we think. */
const FIELD_MAX_BYTES = 1_024;
/** The RPC's own limit on one getMultipleAccounts. */
export const ACCOUNTS_PER_CALL = 100;

export interface TokenMetadata {
  readonly name: string;
  readonly symbol: string;
  readonly uri: string;
}

/** Decode one account. Null when it is not a mint carrying a whole metadata extension. */
export function readTokenMetadata(data: Uint8Array, owner: string): TokenMetadata | null {
  if (owner !== TOKEN_2022_PROGRAM || data.length <= ACCOUNT_TYPE_OFFSET) return null;
  if (data[ACCOUNT_TYPE_OFFSET] !== ACCOUNT_TYPE_MINT) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = new TextDecoder('utf-8', { fatal: false });
  let at = ACCOUNT_TYPE_OFFSET + 1;
  while (at + 4 <= data.length) {
    const type = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    const start = at + 4;
    const end = start + length;
    if (end > data.length) return null;
    if (type === EXTENSION_TOKEN_METADATA) {
      let p = start + 64;
      const field = (): string | null => {
        if (p + 4 > end) return null;
        const n = view.getUint32(p, true);
        if (n > FIELD_MAX_BYTES || p + 4 + n > end) return null;
        const s = text.decode(data.subarray(p + 4, p + 4 + n));
        p += 4 + n;
        return s;
      };
      const name = field();
      const symbol = field();
      const uri = field();
      return name === null || symbol === null || uri === null ? null : { name, symbol, uri };
    }
    // Type 0 is unused padding: nothing after it is an extension.
    if (type === 0) return null;
    at = end;
  }
  return null;
}

export interface TokenMetadataConfig {
  readonly rpcUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
}

/**
 * Each coin's on-chain name, ticker and link, `ACCOUNTS_PER_CALL` coins a request. A coin the
 * chain does not know, or whose account carries no whole metadata, is missing from the map. A
 * failed request throws (unavailable), so the caller can tell "the chain had nothing" from "we
 * could not ask".
 */
export async function tokenMetadata(config: TokenMetadataConfig, addresses: readonly string[]): Promise<ReadonlyMap<string, TokenMetadata>> {
  const out = new Map<string, TokenMetadata>();
  for (let i = 0; i < addresses.length; i += ACCOUNTS_PER_CALL) {
    const batch = addresses.slice(i, i + ACCOUNTS_PER_CALL);
    let response: Response;
    try {
      response = await config.fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [batch, { encoding: 'base64' }] }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new VendorUnavailable('solana-rpc', 'POST rpc getMultipleAccounts', `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    if (!response.ok) throw new VendorUnavailable('solana-rpc', 'POST rpc getMultipleAccounts', `responded ${response.status}`, response.status);
    const body = rec(await response.json());
    if (body.error !== undefined && body.error !== null) {
      throw new VendorUnavailable('solana-rpc', 'POST rpc getMultipleAccounts', `rpc error: ${JSON.stringify(body.error).slice(0, 200)}`);
    }
    arr(rec(body.result).value).forEach((value, index) => {
      const address = batch[index];
      if (address === undefined || value === null || value === undefined) return;
      const v = rec(value);
      const data = arr(v.data)[0];
      const owner = str(v.owner);
      if (typeof data !== 'string' || owner === null) return;
      const meta = readTokenMetadata(Buffer.from(data, 'base64'), owner);
      if (meta !== null) out.set(address, meta);
    });
  }
  return out;
}
