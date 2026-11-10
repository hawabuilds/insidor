/**
 * THE RELAY'S LAUNCHES, HELD FOR THE LISTING: every launchpad `create` the trade relay sends (relay-trade-socket.ts
 * `LaunchHooks`), kept for `maxAgeMs` and handed to a listing (listing.ts) as its one page, newest first — so a launch
 * the launch socket missed is added seconds after it happens, through the same checks, archive and paired-token
 * marking as a listed one, with no page billed and no chain read (the frame carries the coin's own name, ticker and
 * metadata link).
 *
 * Why its own file and not a mode of the listing: the listing pages a remote API; this is a buffer filled by a
 * socket. The listing is unchanged and reads either.
 *
 * ★ IT ALSO SAYS WHETHER THE RELAY IS DELIVERING (`fresh`): the paid listing skips its pass while a create arrived
 * within `freshMs` (Policy.assets.launchListing.relay), and pages as before the moment the relay goes quiet — so a
 * relay outage costs minutes of lateness, never a launch.
 *
 * What breaks if changed carelessly: the age bound. Unbounded, a day of launches (about 30,000) would sit in memory
 * and be handed to every pass; the listing already drops what is older than its own `maxAgeMs`.
 */

import type { Millis } from '@insidor/contracts';
import type { LaunchHooks, RelayCreate } from '@insidor/venue-solana-pumpfun/relay-trade-socket.ts';

import type { ChainDetails, ListedLaunch } from './listing.ts';

export interface RelayLaunches {
  readonly hooks: LaunchHooks;
  /** The launches of the last `maxAgeMs`, newest first, as a listing page. */
  readonly page: () => readonly ListedLaunch[];
  /** The coins' own details as the relay sent them; a coin without all three is missing. */
  readonly details: (addresses: readonly string[]) => ReadonlyMap<string, ChainDetails>;
  /** Whether a create arrived within `freshMs`. */
  readonly fresh: (freshMs: number) => boolean;
}

/** The most launches held at once: an hour at three times today's busiest pace. */
const MAX_HELD = 6_000;

export function createRelayLaunches(maxAgeMs: number, now: () => Millis): RelayLaunches {
  const held = new Map<string, RelayCreate>();
  let lastAt = -Infinity;
  const prune = (t: number): void => {
    for (const [a, c] of held) {
      if (t - c.createdAt <= maxAgeMs && held.size <= MAX_HELD) break;
      held.delete(a);
    }
  };
  return {
    hooks: {
      onCreate: (c) => {
        const t = now();
        lastAt = t;
        if (!held.has(c.address)) held.set(c.address, c);
        prune(t);
      },
    },
    page: () => {
      prune(now());
      return [...held.values()]
        .map((c): ListedLaunch => ({
          address: c.address,
          name: c.name,
          ticker: c.ticker,
          venue: 'curve',
          marketAddress: c.marketAddress,
          createdAt: c.createdAt,
          marketCapUsd: c.marketCapUsd,
          imageUrl: null,
          source: 'relay',
          pairedWith: c.pairedWith,
        }))
        .reverse();
    },
    details: (addresses) => new Map(addresses.flatMap((a) => { const d = held.get(a)?.details; return d === undefined || d === null ? [] : [[a, d] as const]; })),
    fresh: (freshMs) => now() - lastAt <= freshMs,
  };
}
