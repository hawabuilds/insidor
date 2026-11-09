/**
 * A launchpad coin found by searching (contracts/src/ports/coin-search.ts), as a row for the
 * coin universe — `origin: 'backfill'`, because we learned of it after the fact.
 *
 * The row carries only what can be stood behind: the address (checked), the name and ticker
 * the source reported (bounded), the metadata link from the chain when one was read (so the
 * universe reads the document by content id, as for any coin), and a mint time. The mint time
 * is the chain's first transaction when that was read, otherwise the source's market-creation
 * time — `vendor_field`, never `exact`. The source's picture is NOT the coin's picture: only a
 * content-addressed one, read through our gateway, ever is.
 *
 * ★ A POOL HIT IS A LAUNCHPAD COIN ONLY WITH THE CHAIN'S WORD FOR IT (the owner, 2026-11-09: "some
 * of these scam tokens are not launched through pump fun, they just have a pump swap liquidity, which
 * they then pull"). The search sources file a coin trading in the launchpad's graduated pool as a
 * launchpad coin, but anyone can open such a pool for a coin made elsewhere. Every launchpad coin has
 * a curve account at an address derived from its mint, and the account stays after graduation, so
 * its existence is the proof (`curveProven`). Without that proof a pool hit is not stored: stored
 * under this venue, every gate downstream — the Tape, the pushes, the coin match — would trust it.
 *
 * What breaks if changed carelessly: `origin`. A search-found coin is a candidate; the
 * projector holds it to a picture-plus-name-plus-timing match before naming it on a story.
 * Stored as `live_stream`, it would be named on a name match alone.
 */

import type { Millis } from '@insidor/contracts';
import type { Asset } from '@insidor/contracts/asset.ts';
import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { assetKey } from '@insidor/contracts/ids.ts';

import { curveAddress } from './curve-rpc.ts';
import { boundedText, httpsUri, mintAddress } from './hostile.ts';
import { CHAIN, VENUE_ID } from './ids.ts';

const SYMBOL_MAX = 32;
const NAME_MAX = 128;
const URI_MAX = 512;
/** The launchpad's coins all have six decimals. */
const DECIMALS = 6;
/** How far a market-creation time may sit from the true launch, in seconds, as we claim it. */
const VENDOR_BOUND_S = 300;

/**
 * Whether the chain holds this coin's launchpad curve: true for a coin launched on the launchpad,
 * graduated or not. Throws when the chain cannot be read — unknown is never an answer here.
 */
export async function curveProven(address: string, curveAccount: (curve: string) => Promise<unknown>): Promise<boolean> {
  const a = mintAddress(address);
  return a !== null && (await curveAccount(curveAddress(a))) !== null;
}

/** The row for a hit; null for a bad address, or a pool hit whose curve the caller has not proven (`curveProven`). */
export function assetFromSearch(hit: CoinSearchHit, ctx: { readonly firstSeenAt: Millis; readonly metadataUri: string | null; readonly chainCreatedAt: Millis | null; readonly curveProven?: boolean }): Asset | null {
  const address = mintAddress(hit.address);
  if (address === null) return null;
  if (hit.venue !== 'curve' && ctx.curveProven !== true) return null;
  const ref = { chain: CHAIN, address };
  const metadata = httpsUri(ctx.metadataUri, URI_MAX);
  const mintedAt =
    ctx.chainCreatedAt !== null
      ? { at: ctx.chainCreatedAt, source: 'chain_rpc' as const, confidence: 'bounded' as const, boundS: 1 }
      : hit.createdAt !== null
        ? { at: hit.createdAt as Millis, source: 'vendor_field' as const, confidence: 'bounded' as const, boundS: VENDOR_BOUND_S }
        : { at: null, source: 'none' as const, confidence: 'unknown' as const, boundS: null };
  return {
    ref,
    key: assetKey(ref),
    chain: CHAIN,
    venue: VENUE_ID,
    origin: 'backfill',
    mintedAt,
    symbol: boundedText(hit.ticker?.replace(/^\$/, '') ?? null, SYMBOL_MAX),
    name: boundedText(hit.name, NAME_MAX),
    imageUri: null,
    decimals: DECIMALS,
    creator: null,
    declaredSocial: metadata === null ? {} : { metadata },
    firstSeenAt: ctx.firstSeenAt,
  };
}
