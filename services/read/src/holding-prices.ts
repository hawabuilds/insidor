/**
 * What each coin in a wallet is worth in dollars and in SOL, from every source we already use —
 * the Portfolio's prices (wallet.ts), apart from it so the order of the sources and the
 * conversions can be tested with no network.
 *
 * Why it exists (the owner, 2026-10-21: "i should see the dollar value of my holdings at all
 * times"). The wallet used to ask one source in one go and take its answer as final, which lost
 * a held coin's dollars three ways:
 *   - a coin whose only pool is quoted in another coin (Laura, paired with MSTRx) gets no dollar
 *     price from that source, so it showed "Unpriced";
 *   - that source's "native" price is in the pair's quote coin, and was read as SOL, so the gain
 *     of a coin paired with MSTRx or USDC was measured in the wrong unit;
 *   - one failed batch dropped every price in the wallet, and the total with them.
 *
 * So, in order, each step only for what the steps before left unpriced:
 *   1. the keyless pair source, a batch at a time, a failed batch costing only its own coins;
 *   2. a pair quoted in another token is converted through that token's dollar price (SOL's,
 *      USDC's, MSTRx's), asked of the same source when it was not in the first answer;
 *   3. the on-chain token price source (CoinGecko's, through its key when one is set), which
 *      prices a coin from every pool it trades in, whatever the quote;
 * and a coin's SOL price is its dollar price over SOL's, never another token's price.
 *
 * ★ NO PRICE ANYWHERE IS A REASON, NEVER A ZERO. A coin still unpriced is `no_market` when every
 * source answered and none prices it, `not_read_yet` when a source that might have did not
 * answer. The screen shows a dash with that reason.
 *
 * ★ A PRICE IS KEPT `keepMs`, and only briefly: a wallet is a live reading, and every price
 * shown came from a source this minute.
 *
 * What breaks if changed carelessly: reading `quote.price` as SOL again. A coin paired with a
 * $146 stock token would be "worth" 146 times its SOL value in every gain on the screen.
 */

import type { CoinQuote } from '@insidor/market-dexscreener';

import type { Logger } from './log.ts';

/** Wrapped SOL's address: the chain's native coin as a token, and the key SOL's price is under. */
export const SOL = 'So11111111111111111111111111111111111111112';

/** A coin's price as the wallet uses it. Moves and names are the pair source's, when it listed the coin. */
export interface HoldingPrice {
  readonly priceUsd: number | null;
  readonly priceSol: number | null;
  /** Why there is no dollar price: nothing prices it, or a source did not answer. */
  readonly why: 'no_market' | 'not_read_yet';
  readonly quote: CoinQuote | null;
}

export interface HoldingPricesDeps {
  /** The keyless pair source: a coin it does not list is absent; a failed call throws. */
  readonly pairs: { readonly batch: number; quotes(addresses: readonly string[]): Promise<ReadonlyMap<string, CoinQuote>> };
  /** The on-chain token price source; null when not configured. A coin nothing prices is absent. */
  readonly tokenPrices: { prices(addresses: readonly string[]): Promise<ReadonlyMap<string, number>> } | null;
  readonly log: Logger;
  readonly now: () => number;
  /** How long one coin's answer is kept. */
  readonly keepMs: number;
}

const positive = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createHoldingPrices(deps: HoldingPricesDeps) {
  const kept = new Map<string, { readonly at: number; readonly price: HoldingPrice }>();

  /** The pair source for these coins, a batch at a time; the coins of a failed batch are returned as unread. */
  async function pairQuotes(addresses: readonly string[]): Promise<{ quotes: Map<string, CoinQuote>; unread: Set<string> }> {
    const quotes = new Map<string, CoinQuote>();
    const unread = new Set<string>();
    const slices: string[][] = [];
    for (let i = 0; i < addresses.length; i += deps.pairs.batch) slices.push(addresses.slice(i, i + deps.pairs.batch));
    const answers = await Promise.allSettled(slices.map((s) => deps.pairs.quotes(s)));
    answers.forEach((a, i) => {
      if (a.status === 'fulfilled') for (const [k, q] of a.value) quotes.set(k, q);
      else {
        for (const k of slices[i] ?? []) unread.add(k);
        deps.log.info('wallet pair prices unavailable', { coins: slices[i]?.length ?? 0, err: errText(a.reason) });
      }
    });
    return { quotes, unread };
  }

  /** Read every coin not kept, in the order the header gives. */
  async function read(addresses: readonly string[]): Promise<Map<string, HoldingPrice>> {
    const { quotes, unread } = await pairQuotes(addresses);
    const usd = new Map<string, number>();
    for (const [a, q] of quotes) {
      const p = positive(q.priceUsd);
      if (p !== null) usd.set(a, p);
    }

    /* 2. A pair quoted in another token: through that token's dollar price. */
    const viaToken = (a: string): { token: string; price: number } | null => {
      const q = quotes.get(a)?.quote;
      const price = positive(q?.price);
      return q === undefined || price === null || q.address === a ? null : { token: q.address, price };
    };
    const quoteTokens = [...new Set(addresses.flatMap((a) => {
      const v = usd.has(a) ? null : viaToken(a);
      return v === null || usd.has(v.token) ? [] : [v.token];
    }))];
    if (quoteTokens.length > 0) {
      const more = await pairQuotes(quoteTokens);
      for (const [a, q] of more.quotes) {
        const p = positive(q.priceUsd);
        if (p !== null && !usd.has(a)) usd.set(a, p);
      }
    }
    const convert = (): void => {
      for (const a of addresses) {
        const v = usd.has(a) ? null : viaToken(a);
        const tokenUsd = v === null ? undefined : usd.get(v.token);
        if (v !== null && tokenUsd !== undefined) usd.set(a, v.price * tokenUsd);
      }
    };
    convert();

    /* 3. The token price source, for whatever is still unpriced (a quote token too, to convert through). */
    let tokenSourceFailed = false;
    const still = [...new Set(addresses.flatMap((a) => {
      if (usd.has(a)) return [];
      const v = viaToken(a);
      return v === null || usd.has(v.token) ? [a] : [a, v.token];
    }))];
    if (still.length > 0 && deps.tokenPrices !== null) {
      try {
        for (const [a, p] of await deps.tokenPrices.prices(still)) {
          const price = positive(p);
          if (price !== null && !usd.has(a)) usd.set(a, price);
        }
      } catch (e) {
        tokenSourceFailed = true;
        deps.log.info('wallet token prices unavailable', { coins: still.length, err: errText(e) });
      }
      convert();
    }

    const solUsd = usd.get(SOL) ?? null;
    const out = new Map<string, HoldingPrice>();
    for (const a of addresses) {
      const q = quotes.get(a) ?? null;
      const priceUsd = usd.get(a) ?? null;
      const priceSol = a === SOL ? 1 : priceUsd !== null && solUsd !== null ? priceUsd / solUsd : positive(q?.priceSol);
      /* Unpriced is "no market" only when a source that would have priced it answered without it. */
      const missed = tokenSourceFailed || (deps.tokenPrices === null && unread.has(a));
      out.set(a, { priceUsd, priceSol, why: missed ? 'not_read_yet' : 'no_market', quote: q });
    }
    return out;
  }

  return {
    /**
     * Every coin's price, SOL's included when asked for. A coin's answer is kept `keepMs`; one
     * left unpriced because a source did not answer is not kept, so the next read asks again.
     */
    async prices(addresses: readonly string[]): Promise<ReadonlyMap<string, HoldingPrice>> {
      const now = deps.now();
      for (const [k, v] of kept) if (now - v.at >= deps.keepMs) kept.delete(k);
      const unique = [...new Set(addresses)];
      const out = new Map<string, HoldingPrice>();
      const toRead: string[] = [];
      for (const a of unique) {
        const hit = kept.get(a);
        if (hit !== undefined) out.set(a, hit.price);
        else toRead.push(a);
      }
      /* SOL is read with the rest whenever anything is: a SOL price is what every conversion needs. */
      if (toRead.length > 0 && !toRead.includes(SOL)) toRead.unshift(SOL);
      if (toRead.length > 0) {
        const got = await read(toRead);
        const at = deps.now();
        for (const [a, p] of got) {
          if (p.priceUsd !== null || p.why === 'no_market') kept.set(a, { at, price: p });
          if (unique.includes(a)) out.set(a, p);
        }
      }
      return out;
    },
  };
}

export type HoldingPrices = ReturnType<typeof createHoldingPrices>;
