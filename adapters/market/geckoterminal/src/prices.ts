/**
 * Dollar prices for many coins at once, from the on-chain token price the vendor works out from
 * every pool a coin trades in — the Portfolio's second source, asked only about the coins the
 * first source could not price (services/read holding-prices.ts).
 *
 * Its own file, with its own small budget, for the same reason as holders.ts: the market client's
 * per-minute budget in index.ts is the chart's and the tape's, and a wallet's prices must never
 * take a chart's call. At most `PRICE_CALLS_PER_MINUTE` requests a minute; each coin's answer is
 * kept `PRICE_KEEP_MS`, so a wallet read twice in a row, or two wallets holding one coin, ask once.
 *
 * ★ IT PRICES A COIN WHATEVER IT IS PAIRED WITH. A coin whose only pool is quoted in another
 * coin (Laura in MSTRx, 2026-10-20) gets no dollar price from the first source; this one prices
 * it through the quote coin's own dollar price, which is the whole reason to ask it.
 *
 * ★ NOT LISTED IS ABSENT, AND ONLY FROM AN ANSWER. A coin the reply leaves out, or prices at
 * nothing, is absent from the map: no market prices it. A failed call throws, so an outage is
 * never read as "no price".
 *
 * What breaks if changed carelessly: the batch size. The paid plan takes a hundred addresses a
 * call and the others thirty; past that the vendor refuses the whole call.
 */

import { outOfCredit, rec, VendorUnavailable } from '@insidor/vendor-kit';

import { billingReason } from './billing.ts';

/** Requests a minute for prices, beside the market client's and the holder reads' own budgets. */
export const PRICE_CALLS_PER_MINUTE = 10;
/** One coin's price is kept this long: brief, because a wallet's worth is read live. */
export const PRICE_KEEP_MS = 30_000;
/** Addresses a call, by plan: the paid plan's limit, and the others'. */
export const PRICE_BATCH: Readonly<Record<'free' | 'demo' | 'pro', number>> = { free: 30, demo: 30, pro: 100 };
const MINUTE_MS = 60_000;
const ENDPOINT = '/simple/networks/solana/token_price';

/** Each listed coin's dollar price from a reply; a coin left out or priced at nothing is absent. Pure. */
export function readTokenPrices(raw: unknown): ReadonlyMap<string, number> {
  const prices = rec(rec(rec(raw).data).attributes).token_prices;
  const out = new Map<string, number>();
  for (const [address, v] of Object.entries(rec(prices))) {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
    if (Number.isFinite(n) && n > 0) out.set(address, n);
  }
  return out;
}

export function geckoterminalTokenPrices(config: {
  readonly plan: 'free' | 'demo' | 'pro';
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly now: () => number;
}) {
  const kept = new Map<string, { readonly at: number; readonly price: number | null }>();
  const sent: number[] = [];
  const batch = PRICE_BATCH[config.plan];

  async function ask(addresses: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const now = config.now();
    while (sent.length > 0 && now - (sent[0] ?? 0) >= MINUTE_MS) sent.shift();
    if (sent.length >= PRICE_CALLS_PER_MINUTE) throw new VendorUnavailable('geckoterminal', ENDPOINT, "held back: this minute's price reads are spent");
    sent.push(now);
    let response: Response;
    try {
      response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}${ENDPOINT}/${addresses.map(encodeURIComponent).join(',')}`, {
        headers: { accept: 'application/json', ...(config.headers ?? {}) },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (e) {
      throw new VendorUnavailable('geckoterminal', ENDPOINT, `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    if (!response.ok) {
      const billing = billingReason(response.status, await response.text().catch(() => ''));
      if (billing !== null) throw outOfCredit('geckoterminal', ENDPOINT, billing, response.status);
      throw new VendorUnavailable('geckoterminal', ENDPOINT, `responded ${response.status}`, response.status);
    }
    return readTokenPrices(await response.json());
  }

  return {
    batch,
    /**
     * Dollar prices for these coins: a coin no market prices is absent. Kept answers are used
     * first; a batch that fails throws, after the batches before it are kept.
     */
    async prices(addresses: readonly string[]): Promise<ReadonlyMap<string, number>> {
      const now = config.now();
      const out = new Map<string, number>();
      const toAsk: string[] = [];
      for (const a of new Set(addresses)) {
        const hit = kept.get(a);
        if (hit !== undefined && now - hit.at < PRICE_KEEP_MS) {
          if (hit.price !== null) out.set(a, hit.price);
        } else toAsk.push(a);
      }
      for (const [k, v] of kept) if (now - v.at >= PRICE_KEEP_MS) kept.delete(k);
      for (let i = 0; i < toAsk.length; i += batch) {
        const slice = toAsk.slice(i, i + batch);
        const got = await ask(slice);
        const at = config.now();
        /* Asked and not listed is kept as "no price" too, so a dead coin is not asked again at once. */
        for (const a of slice) {
          const p = got.get(a) ?? null;
          kept.set(a, { at, price: p });
          if (p !== null) out.set(a, p);
        }
      }
      return out;
    },
  };
}
