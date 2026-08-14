/**
 * New assets, by polling the issuer's own list endpoint.
 *
 * The timestamp on that endpoint is the issuing program's own record of
 * creation, which is the best mint time available and the only one allowed to
 * be 'exact' once a chain read confirms it. See mint-time.ts for why nothing
 * else may be.
 *
 * Two things this file is careful about, both of which cost money further down:
 *
 *   `symbol` is OBSERVED, not an identifier. Nothing here or downstream may
 *   treat it as a key: a search for one meme's symbol returned hundreds of
 *   assets, and the dangerous answer is not the absurd one — it is the
 *   plausible survivor that looks like a reasonable match and is not.
 *
 *   `declaredSocial` is attacker-controlled and the field name says so. It is
 *   evidence to be scored, never a fact to be trusted.
 */

import type { Millis } from '@insidor/contracts';
import type { Asset } from '@insidor/contracts/asset.ts';
import { assetKey } from '@insidor/contracts/ids.ts';
import type { AssetRef, ChainId, VenueId } from '@insidor/contracts/ids.ts';
import type { MintEvent } from '@insidor/contracts/ports/venue.ts';
import { num, rec, str } from '@insidor/vendor-kit';

import { mintTime } from './mint-time.ts';
import type { MintTimeOptions } from './mint-time.ts';

export interface WatchContext {
  readonly chain: ChainId;
  readonly venue: VenueId;
  readonly seenAt: Millis;
  readonly decimals: number;
  readonly mintTimeOptions: MintTimeOptions;
}

/**
 * @param chainMintMs independent confirmation, when the caller has already done
 *                    the chain read. Null on the polling path, which is why a
 *                    freshly listed asset is 'bounded' rather than 'exact'
 *                    until a second source agrees.
 */
export function toMintEvent(raw: unknown, ctx: WatchContext, chainMintMs: Millis | null): MintEvent | null {
  const r = rec(raw);
  const address = str(r.mint) ?? str(r.address);
  if (address === null) return null;

  const ref: AssetRef = { chain: ctx.chain, address };
  const mintedAt = mintTime(
    // No `observedMs` on this path, and that is not an omission. This row came
    // from a list endpoint that carries the issuer's own creation timestamp, so
    // the instant we happened to fetch the page says nothing about when the coin
    // was made — it is the age of the request, not the age of the asset. Only a
    // push notification bounds a mint by its own arrival.
    { issuerMs: num(r.created_timestamp), chainMs: chainMintMs, vendorMs: null, observedMs: null },
    ctx.mintTimeOptions,
  );

  const declared: Record<string, string> = {};
  for (const [key, field] of [
    ['website', r.website],
    ['x', r.twitter],
    ['telegram', r.telegram],
  ] as const) {
    const value = str(field);
    if (value !== null) declared[key] = value;
  }

  const asset: Asset = {
    ref,
    key: assetKey(ref),
    chain: ctx.chain,
    venue: ctx.venue,
    mintedAt,
    symbol: str(r.symbol),
    name: str(r.name),
    imageUri: str(r.image_uri),
    decimals: ctx.decimals,
    creator: str(r.creator),
    declaredSocial: declared,
    firstSeenAt: ctx.seenAt,
  };

  return { asset, venue: ctx.venue, mintedAt, seenAt: ctx.seenAt };
}
