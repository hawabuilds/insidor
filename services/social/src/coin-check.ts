/**
 * A COIN ADDRESS THE OWNER PASTED, CHECKED: does the coin exist, and what is it — for the preview
 * the owner reads before saving "This is the coin" on a post (owner-coin.ts).
 *
 * Read in the owner's order, every source free:
 *
 *   launchpad  the chain's own record of the token (its metadata link, through the RPC we already
 *              hold for likes), its first transaction (the launch, to the second), and the
 *              launchpad's image service (its copy of the coin's picture)
 *   market     the market sources searched by the address itself, keeping only hits whose
 *              address is exactly the one pasted: name, ticker, market cap now, and the market's
 *              creation time when the chain did not answer
 *   history    the coin's hourly price candles in its main pool: the highest price ever traded
 *              there, scaled by the market cap now over the last price, is the highest market cap
 *              so far. Not read, or no candles: null with the reason, never the cap now.
 *
 * The coin EXISTS when the chain knows the token or any market source lists the address. Nothing
 * else: a name search never stands in for the address, since a coin with the same name is another
 * coin.
 *
 * Its own file, apart from the route, so the rule runs under a test with stand-in sources; the
 * vendors themselves are wired in main.ts and live in adapters/.
 *
 * What breaks if changed carelessly: `exact`. Market searches return every pool whose text matches,
 * other coins included; keeping a hit that is not this address would show another coin's name and
 * cap in the preview the owner confirms.
 */

import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

/** What the owner sees before saving. Every number may be missing, and a missing one says why. */
export interface CoinPreview {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly logoUrl: string | null;
  readonly marketCapUsd: number | null;
  readonly highestMarketCapUsd: number | null;
  /** Why the highest is missing; null when it is there. */
  readonly highestWhy: string | null;
  /** The launch, in ms: the chain's first transaction, else the market's creation time. */
  readonly launchedAt: number | null;
}

export interface CoinCheck {
  /** The coin, or null when no source knows the address. Throws when no source could be read at all. */
  read(mint: string): Promise<CoinPreview | null>;
}

export interface CoinCheckPorts {
  /** The chain and the launchpad; null when no RPC is configured. Each read may fail on its own. */
  readonly launchpad: {
    /** True when the chain holds the token's metadata; false when it does not know the address. */
    known(mint: string): Promise<boolean>;
    /** The first transaction's time, in seconds; null when the chain has none. */
    launchedAtSeconds(mint: string): Promise<number | null>;
    /** The launchpad's copy of the picture; null when it has none. */
    picture(mint: string): Promise<string | null>;
  } | null;
  /** Searched by the address, in this order; the first hit's facts win, the earliest creation time is kept. */
  readonly markets: readonly CoinSearch[];
  /** Hourly candles' highs and last close in the coin's main pool; null when it has no pool. */
  readonly history: ((mint: string) => Promise<{ readonly highest: number | null; readonly last: number | null } | null>) | null;
}

const settled = async <T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
  try {
    return { ok: true, value: await p };
  } catch {
    return { ok: false };
  }
};

export function coinCheck(ports: CoinCheckPorts): CoinCheck {
  return {
    async read(mint) {
      const l = ports.launchpad;
      const [known, launched, picture, ...searches] = await Promise.all([
        l === null ? Promise.resolve({ ok: false as const }) : settled(l.known(mint)),
        l === null ? Promise.resolve({ ok: false as const }) : settled(l.launchedAtSeconds(mint)),
        l === null ? Promise.resolve({ ok: false as const }) : settled(l.picture(mint)),
        ...ports.markets.map((m) => settled(m.search(mint))),
      ]);
      const read = searches.filter((s) => s.ok);
      const exact: CoinSearchHit[] = read.flatMap((s) => (s.ok ? s.value.hits.filter((h) => h.address === mint) : []));
      const onChain = known.ok && known.value === true;
      if (!onChain && exact.length === 0) {
        /* Nobody answered at all: an outage, not "no such coin". */
        if (!known.ok && read.length === 0) throw new Error('no source could be read');
        return null;
      }
      const first = <K extends keyof CoinSearchHit>(k: K): CoinSearchHit[K] | null => exact.find((h) => h[k] !== null)?.[k] ?? null;
      const created = exact.flatMap((h) => (h.createdAt === null ? [] : [h.createdAt]));
      const chainLaunch = launched.ok && launched.value !== null ? launched.value * 1_000 : null;
      const marketCapUsd = first('marketCapUsd');
      let highestMarketCapUsd: number | null = null;
      let highestWhy: string | null = null;
      if (ports.history === null) highestWhy = 'not read here';
      else {
        const h = await settled(ports.history(mint));
        if (!h.ok) highestWhy = 'its price history could not be read just now';
        else if (h.value === null || h.value.highest === null || h.value.last === null || h.value.last <= 0) highestWhy = 'no price history yet';
        else if (marketCapUsd === null) highestWhy = 'no market cap to scale it by';
        else highestMarketCapUsd = Math.max(marketCapUsd, (marketCapUsd * h.value.highest) / h.value.last);
      }
      return {
        address: mint,
        name: first('name'),
        ticker: first('ticker')?.replace(/^\$/, '') ?? null,
        logoUrl: (picture.ok ? picture.value : null) ?? first('imageUrl'),
        marketCapUsd,
        highestMarketCapUsd,
        highestWhy,
        launchedAt: chainLaunch ?? (created.length === 0 ? null : Math.min(...created)),
      };
    },
  };
}
