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
 * ★ THE LISTING PAGES ARE CAPPED BY THE DAY TOO (`dayCapPages`), because a keyed listing bills
 * each page against a monthly plan other code shares. Spending is held to an even pace through
 * the UTC day plus `paceSlackPages`: a pass that would run ahead is held, so a busy hour spaces
 * the passes out (each then reads more pages back) rather than raising the day's total. 20 Oct:
 * in its first 42 minutes the keyless listing began ten streaks of refusals (429, and one
 * timeout) from the host's shared address and fell behind three times after them.
 *
 * ★ A PAGE REFUSED AFTER THE FIRST KEEPS WHAT WAS READ. The earlier pages' launches are added and
 * the place is not moved, so the next pass reads back to the same previous pass. A refusal of the
 * first page fails the pass as before.
 *
 * ★ A CHAIN READ THAT FAILS DOES NOT STOP THE ADD. The coin is added with the listing's own name
 * and ticker and no metadata link, which costs it a picture; leaving it out would cost us the coin.
 *
 * ★ A TOKEN LAUNCHES ARE PAIRED AGAINST IS NEVER A LAUNCH. A curve can be priced in another token
 * (a stablecoin, a tokenised stock such as MSTRx, another coin), and the launch socket filed such
 * tokens as the coins launched against them: MSTRx stood in our store as "LAURA". The listing
 * names each launch's paired token beside it, so a pass hands the ones it has not settled yet to
 * `markPaired`, which marks those with no curve of their own (0122) — a coin paired against another
 * coin keeps its row, because that coin was launched too. A token marked, or found to be a coin, is
 * not asked about again by this process; one that could not be checked is asked next pass.
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

/** A token a launch is paired against, other than the chain's own coin. */
export interface PairedToken {
  readonly address: string;
  readonly symbol: string | null;
  readonly name: string | null;
}

/** A listed launch: the coin, and the token it is paired against when that is not the chain's own coin. */
export type ListedLaunch = CoinSearchHit & { readonly pairedWith?: PairedToken | null };

export interface ListingDeps {
  /** One page of the newest launches on the curve, newest first. Throws when the source could not answer. */
  page(n: number): Promise<readonly ListedLaunch[]>;
  /**
   * Mark these paired tokens as not launches where they have no curve of their own. `settled` is
   * every one answered (marked, already marked, or a coin); `calls` the chain reads it took.
   * Throws when it could not be asked. Absent: paired tokens are not looked at.
   */
  markPaired?(tokens: readonly PairedToken[], seenAt: Millis): Promise<{ readonly marked: readonly string[]; readonly settled: readonly string[]; readonly calls: number }>;
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
  /** The most listing pages a UTC day may ask for; past it, passes read nothing until 00:00 UTC. */
  readonly dayCapPages: number;
  /** How many pages the day's asking may run ahead of an even pace before a pass is held. */
  readonly paceSlackPages: number;
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
  /** Why the pass read no page at all: the day's page cap, or running ahead of the day's pace. */
  readonly held: 'cap' | 'pace' | null;
  /** A page after the first was refused: what the earlier pages listed is added, the place is kept. */
  readonly refused: string | null;
  /** Paired tokens this pass marked as not launches. */
  readonly pairedMarked: number;
}

export interface Listing {
  pass(): Promise<ListingPassResult>;
}

const DAY_MS = 86_400_000;

export function createListing(deps: ListingDeps, opts: ListingOptions): Listing {
  /** The newest pool creation instant any completed pass saw. Null before the first. */
  let highWater: number | null = null;
  /** The chain reads' credits on the UTC day `day`, and whether the cap was said that day. */
  const spend = { day: '', credits: 0, capSaid: false };
  /** The listing pages asked on the UTC day `day` (refused ones too), and whether their cap was said. */
  const asked = { day: '', pages: 0, capSaid: false };

  /** Paired tokens this process has settled: marked, or found to be coins. Never asked about again. */
  const settledPaired = new Set<string>();

  const nothing = (extra: Partial<ListingPassResult>): ListingPassResult => ({
    listed: 0, fresh: 0, added: 0, withoutDetails: 0, pagesRead: 0, behind: false, credits: 0, held: null, refused: null, pairedMarked: 0, ...extra,
  });

  /** The day's credit spend: a day's first spend resets it. False when `cost` would pass the cap. */
  const spendCredits = (nowMs: number, cost: number): boolean => {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (spend.day !== day) Object.assign(spend, { day, credits: 0, capSaid: false });
    if (spend.credits + cost > opts.dayCapCredits) return false;
    spend.credits += cost;
    return true;
  };

  /**
   * The paired tokens on these pages that are not settled yet, marked where they have no curve.
   * Never fails the pass: a token that could not be checked is asked again next pass.
   */
  const settlePaired = async (listed: Iterable<ListedLaunch>, nowMs: number): Promise<{ marked: number; credits: number }> => {
    if (deps.markPaired === undefined) return { marked: 0, credits: 0 };
    const open = new Map<string, PairedToken>();
    for (const h of listed) {
      const p = h.pairedWith;
      if (p !== null && p !== undefined && !settledPaired.has(p.address) && p.address !== h.address) open.set(p.address, p);
    }
    if (open.size === 0) return { marked: 0, credits: 0 };
    const cost = Math.ceil(open.size / Math.max(1, opts.accountsPerCall)) * opts.creditsPerCall;
    if (!spendCredits(nowMs, cost)) return { marked: 0, credits: 0 };
    try {
      const r = await deps.markPaired([...open.values()], nowMs as Millis);
      for (const a of r.settled) settledPaired.add(a);
      if (r.marked.length > 0) deps.note('launch listing: tokens launches are paired against were marked as not launches', { marked: r.marked });
      return { marked: r.marked.length, credits: cost };
    } catch (e) {
      deps.note('paired tokens could not be checked; asked again next pass', { err: e instanceof Error ? e.message : String(e), tokens: open.size });
      return { marked: 0, credits: cost };
    }
  };

  return {
    async pass() {
      /* ★ THE DAY'S PAGES: a keyed listing bills each page. Past `dayCapPages` nothing is read
         until 00:00 UTC. Ahead of an even pace through the day by more than `paceSlackPages`,
         the pass is held and the next one reads further back — so a busy hour spaces the passes
         out instead of raising the day's total. */
      const startMs = deps.now();
      const today = new Date(startMs).toISOString().slice(0, 10);
      if (asked.day !== today) Object.assign(asked, { day: today, pages: 0, capSaid: false });
      if (asked.pages >= opts.dayCapPages) {
        if (!asked.capSaid) {
          asked.capSaid = true;
          deps.note('launch listing: the day\'s listing pages are spent; nothing is listed until 00:00 UTC', { pages: asked.pages, capPages: opts.dayCapPages });
        }
        return nothing({ held: 'cap' });
      }
      if (asked.pages >= (opts.dayCapPages * (startMs % DAY_MS)) / DAY_MS + opts.paceSlackPages) return nothing({ held: 'pace' });

      const listed = new Map<string, ListedLaunch>();
      let pagesRead = 0;
      let reached = false;
      let refused: string | null = null;
      let newest: number | null = highWater;

      for (let n = 1; n <= opts.pagesPerPass && asked.pages < opts.dayCapPages; n += 1) {
        asked.pages += 1;
        let hits: readonly ListedLaunch[];
        try {
          hits = await deps.page(n);
        } catch (e) {
          // Nothing read: the whole pass fails and `highWater` stays where it was (see the header).
          if (pagesRead === 0) throw e;
          // ★ A REFUSAL PAST THE FIRST PAGE KEEPS WHAT WAS READ: those pages' launches are added,
          // and the place is not moved, so the next pass reads back to the same previous pass.
          refused = e instanceof Error ? e.message : String(e);
          break;
        }
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

      // A refused pass is not "behind": it keeps its place and the next pass reads back to it.
      const behind = refused === null && highWater !== null && !reached;
      if (behind) {
        deps.note('launch listing fell behind; launches older than its last page and newer than the previous pass may be missing from it', {
          pagesRead,
          previousNewest: highWater,
        });
      }
      const nowMs = deps.now();
      const paired = await settlePaired(listed.values(), nowMs);
      const young = [...listed.values()].filter((h) => h.createdAt !== null && nowMs - h.createdAt <= opts.maxAgeMs);
      const held = await deps.known(young.map((h) => h.address));
      const fresh = young.filter((h) => !held.has(h.address));
      if (fresh.length === 0) {
        if (refused === null) highWater = newest;
        return nothing({ listed: listed.size, pagesRead, behind, refused, credits: paired.credits, pairedMarked: paired.marked });
      }

      /* ★ THE DAY'S CREDIT CAP: the chain reads share a key's free day with the trade feed. Past the
         cap a coin is still added, from the listing's own name and ticker, without its link. */
      const cost = Math.ceil(fresh.length / Math.max(1, opts.accountsPerCall)) * opts.creditsPerCall;
      let details: ReadonlyMap<string, ChainDetails> = new Map();
      let credits = paired.credits;
      if (!spendCredits(nowMs, cost)) {
        if (!spend.capSaid) {
          spend.capSaid = true;
          deps.note('launch listing: the day\'s chain-read credits are spent; listed launches are added without a metadata link until 00:00 UTC', { credits: spend.credits, capCredits: opts.dayCapCredits });
        }
      } else {
        credits += cost;
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
      // Only now, and not after a refusal: a pass that failed anywhere above is read again from the same place.
      if (refused === null) highWater = newest;
      const addedSet = new Set(added);
      const withoutDetails = fresh.filter((h) => addedSet.has(h.address) && !details.has(h.address)).length;
      return { listed: listed.size, fresh: fresh.length, added: added.length, withoutDetails, pagesRead, behind, credits, held: null, refused, pairedMarked: paired.marked };
    },
  };
}
