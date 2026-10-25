/**
 * THE HAND-OFF FROM THE UNIVERSE LOOP TO THE COIN-LINK STEP: the coins whose metadata document the
 * universe loop read first, with the fields it read, waiting for the coin-link step's next pass.
 *
 * Its own file because both loops' work files use it and neither may import the other's (the
 * coin-link step already imports the universe loop's document reader). The reason it exists, and
 * why it is a hand-off and not a second query or a migration, is work/coin-links.ts's header
 * ("whichever step reads the document first").
 *
 * What breaks if changed carelessly: a coin is taken ONCE. Keeping a taken coin, or putting back a
 * coin a pass finished, makes the coin-link step look at it again and spend a priced read again on
 * a named post it could not read. In process only: a coin handed in the moments before a restart is
 * not linked, and the age bound is what stops the map growing when the finders loop is stalled.
 */

import type { Millis } from '@insidor/contracts';
import type { FreshCoin } from '@insidor/store';

/** What a coin's document said about its links, as another step read it. */
export interface HandedMetadata {
  readonly description: string | null;
  readonly links: { readonly social: string | null; readonly website: string | null; readonly chat: string | null };
}

export interface HandedCoin {
  readonly coin: FreshCoin;
  readonly metadata: HandedMetadata;
  readonly at: Millis;
}

/**
 * The coins another step read the document of first, waiting for the coin-link step. Given by
 * the universe loop as it reads; taken once, oldest first; one given again replaces the first. One waiting longer than `maxAgeMs` is dropped and counted —
 * only a stalled finders loop leaves one that long, and without the drop it would grow for good.
 */
export interface CoinLinkHandOff {
  give(coin: FreshCoin, metadata: HandedMetadata, at: Millis): void;
  take(limit: number, now: Millis): { readonly coins: readonly HandedCoin[]; readonly expired: number };
  /** A pass that failed after taking puts its coins back, under their first time. */
  putBack(coins: readonly HandedCoin[]): void;
}

export function coinLinkHandOff(maxAgeMs: number): CoinLinkHandOff {
  const waiting = new Map<string, HandedCoin>();
  let expired = 0;
  const prune = (now: Millis): void => {
    for (const [key, h] of waiting) {
      if (now - h.at <= maxAgeMs) continue;
      waiting.delete(key);
      expired += 1;
    }
  };
  return {
    give(coin, metadata, at) {
      prune(at);
      waiting.delete(coin.assetKey);
      waiting.set(coin.assetKey, { coin, metadata, at });
    },
    take(limit, now) {
      prune(now);
      const coins = [...waiting.values()].sort((a, b) => a.at - b.at).slice(0, Math.max(0, limit));
      for (const h of coins) waiting.delete(h.coin.assetKey);
      const out = { coins, expired };
      expired = 0;
      return out;
    },
    putBack(coins) {
      for (const h of coins) if (!waiting.has(h.coin.assetKey)) waiting.set(h.coin.assetKey, h);
    },
  };
}
