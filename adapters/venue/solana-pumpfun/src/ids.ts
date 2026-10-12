/**
 * This venue's identity: the chain it runs on and its venue id. Its own module so every file in
 * the package names the venue the same way without importing the package's barrel.
 */

import { chainId, venueId } from '@insidor/contracts/ids.ts';
import type { ChainId, VenueId } from '@insidor/contracts/ids.ts';

export const CHAIN: ChainId = chainId('solana');
export const VENUE_ID: VenueId = venueId(CHAIN, 'pumpfun');
