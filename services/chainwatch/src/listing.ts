/**
 * THE LAUNCH LISTING: the second way a launch reaches us, for the launches the socket never sends.
 *
 * WHY A SECOND SOURCE AT ALL, in a service built around one. Measured on 19 Oct: the socket
 * delivers launches made in legacy or v0 transactions and none made in version-1 transactions
 * (20 of 21 traced misses were version 1; none of 25 delivered launches was), and
 * over six minutes that afternoon it delivered 66 of 155 launches a listing named — under half.
 * The rest reached us only when a post's name search happened to find them, a median of about an
 * hour after launch, which is too late for anything that decides in minutes. The socket cannot be
 * asked for them. A listing of the chain's newest pools names them a few minutes after launch
 * (the source indexes about three minutes behind and caches each page up to a minute). It also
 * names the launches of the seconds the socket spends reconnecting, as far back as a pass reads.
 *
 * WHAT A PASS DOES. Read the newest pools page by page until a page reaches the newest pool the
 * previous pass saw, and one page more, or until `pagesPerPass` runs out. Keep the launches on
 * the curve no older than `maxAgeMs`; drop the ones we already hold; ask the chain for the rest's
 * own name, ticker and metadata link in one call; add them. A coin the socket delivered keeps its
 * row untouched.
 *
 * ★ IT IS NEVER A COVERAGE CLAIM. The coverage log is the socket's and says when the socket was
 * listening. A listing minutes behind, with a horizon of a few pages, cannot vouch that a window
 * is complete, so a pass writes no coverage row, and a pass that could not reach the previous one
 * says so in the log rather than in the table.
 *
 * ★ THE CHAIN READS ARE CAPPED BY THE DAY, in the key's credits (`dayCapCredits`): the key is the
 * trade feed's too, on a free day of 33k credits. One read asks `accountsPerCall` coins, so a pass
 * costs one read in ordinary traffic. Past the cap a pass skips the read, as if it had failed.
 *
 * ★ A CHAIN READ THAT FAILS DOES NOT STOP THE ADD. The coin is added with the listing's own name
 * and ticker and no metadata link, which costs it a picture; leaving it out would cost us the coin.
 *
 * Everything that touches a network or the database is injected, so the tests drive a pass with
 * plain functions. This file names no vendor, venue or chain: wiring.ts does.
 *
 * What breaks if changed carelessly: the high-water mark. It moves only after a pass that read
 * its pages AND stored what it found, so a failed pass is retried from where the last good one
 * stopped; moving it on a failure would skip that pass's pools for good.
 */

import type { Millis } from '@insidor/contracts';
import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

/** What the chain says about a coin itself: its own name, ticker and metadata link. */
export interface ChainDetails {
  readonly name: string;
  readonly symbol: string;
  readonly uri: string;
}

export interface ListingDeps {
  /** One page of the newest launches on the curve, newest first. Throws when the source could not answer. */
  page(n: number): Promise<readonly CoinSearchHit[]>;
  /** The coins among these we already hold. */
  known(addresses: readonly string[]): Promise<ReadonlySet<string>>;
  /** The chain's own details for these coins; a coin it does not know is missing. Throws when it could not be asked. */
  details(addresses: readonly string[]): Promise<ReadonlyMap<string, ChainDetails>>;
  /** Add these, leaving any coin already held untouched. Returns the addresses actually added. */
  add(launches: readonly { readonly hit: CoinSearchHit; readonly details: ChainDetails | null }[], seenAt: Millis): Promise<readonly string[]>;
  readonly now: () => Millis;
  readonly note: (msg: string, fields: Readonly<Record<string, unknown>>) => void;
}

export interface ListingOptions {
  readonly pagesPerPass: number;
  readonly maxAgeMs: number;
  /** Coins one chain read can ask about, and what one read costs on the key's day. */
  readonly accountsPerCall: number;
  readonly creditsPerCall: number;
  /** The most credits the chain reads may cost in a UTC day; past it, coins are added without details. */
  readonly dayCapCredits: number;
}

export interface ListingPassResult {
  /** Launches on the curve the pages listed. */
  readonly listed: number;
  /** Of those, the ones we did not already hold (and young enough to add). */
  readonly fresh: number;
  /** The ones actually added. */
  readonly added: number;
  /** How many of the added had no chain details (no metadata link). */
  readonly withoutDetails: number;
  readonly pagesRead: number;
  /** The pass ran out of pages before reaching the previous pass's newest pool. */
  readonly behind: boolean;
  /** Credits this pass's chain reads cost (counted when asked, whether or not they answered). */
  readonly credits: number;
}

export interface Listing {
  pass(): Promise<ListingPassResult>;
}

export function createListing(deps: ListingDeps, opts: ListingOptions): Listing {
  /** The newest pool creation instant any completed pass saw. Null before the first. */
  let highWater: number | null = null;
  /** The chain reads' credits on the UTC day `day`, and whether the cap was said that day. */
  const spend = { day: '', credits: 0, capSaid: false };

  return {
    async pass() {
      const listed = new Map<string, CoinSearchHit>();
      let pagesRead = 0;
      let reached = false;
      let newest: number | null = highWater;

      for (let n = 1; n <= opts.pagesPerPass; n += 1) {
        // A throw here fails the whole pass and leaves `highWater` where it was: see the header.
        const hits = await deps.page(n);
        pagesRead += 1;
        if (hits.length === 0) {
          reached = true;
          break;
        }
        let oldestOnPage: number | null = null;
        for (const h of hits) {
          if (!listed.has(h.address)) listed.set(h.address, h);
          if (h.createdAt !== null) {
            if (newest === null || h.createdAt > newest) newest = h.createdAt;
            if (oldestOnPage === null || h.createdAt < oldestOnPage) oldestOnPage = h.createdAt;
          }
        }
        if (reached) break;
        // The first pass reads every page it is allowed: it is the one that follows a restart.
        // ★ ONE PAGE PAST THE OVERLAP, not zero. Each page is cached by the source on its own
        // clock (up to a minute), so page 1 can be newer than page 2; a pool that slid from the
        // bottom of the older page 1 to the top of the newer page 2 is on neither unless the
        // page after the overlap is read too.
        if (highWater !== null && oldestOnPage !== null && oldestOnPage <= highWater) reached = true;
      }

      const behind = highWater !== null && !reached;
      if (behind) {
        deps.note('launch listing fell behind; launches older than its last page and newer than the previous pass may be missing from it', {
          pagesRead,
          previousNewest: highWater,
        });
      }
      const nowMs = deps.now();
      const young = [...listed.values()].filter((h) => h.createdAt !== null && nowMs - h.createdAt <= opts.maxAgeMs);
      const held = await deps.known(young.map((h) => h.address));
      const fresh = young.filter((h) => !held.has(h.address));
      if (fresh.length === 0) {
        highWater = newest;
        return { listed: listed.size, fresh: 0, added: 0, withoutDetails: 0, pagesRead, behind, credits: 0 };
      }

      /* ★ THE DAY'S CREDIT CAP: the chain reads share a key's free day with the trade feed. Past the
         cap a coin is still added, from the listing's own name and ticker, without its link. */
      const day = new Date(nowMs).toISOString().slice(0, 10);
      if (spend.day !== day) Object.assign(spend, { day, credits: 0, capSaid: false });
      const cost = Math.ceil(fresh.length / Math.max(1, opts.accountsPerCall)) * opts.creditsPerCall;
      let details: ReadonlyMap<string, ChainDetails> = new Map();
      let credits = 0;
      if (spend.credits + cost > opts.dayCapCredits) {
        if (!spend.capSaid) {
          spend.capSaid = true;
          deps.note('launch listing: the day\'s chain-read credits are spent; listed launches are added without a metadata link until 00:00 UTC', { credits: spend.credits, capCredits: opts.dayCapCredits });
        }
      } else {
        spend.credits += cost;
        credits = cost;
        try {
          details = await deps.details(fresh.map((h) => h.address));
        } catch (e) {
          deps.note('chain details unavailable; listed launches are added without a metadata link', {
            err: e instanceof Error ? e.message : String(e),
            launches: fresh.length,
          });
        }
      }

      const added = await deps.add(
        fresh.map((hit) => ({ hit, details: details.get(hit.address) ?? null })),
        nowMs,
      );
      // Only now: a pass that failed anywhere above is read again from the same place.
      highWater = newest;
      const addedSet = new Set(added);
      const withoutDetails = fresh.filter((h) => addedSet.has(h.address) && !details.has(h.address)).length;
      return { listed: listed.size, fresh: fresh.length, added: added.length, withoutDetails, pagesRead, behind, credits };
    },
  };
}
