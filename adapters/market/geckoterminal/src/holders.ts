/**
 * How many wallets hold a coin, from GeckoTerminal's token info — the one number on the token
 * page's Info tab that no other free source gives.
 *
 * Its own file, with its own small budget, rather than another method on the market client in
 * index.ts: that client's per-minute budget (`CALLS_PER_MINUTE`) is tuned for the chart and the
 * tape, which a person watches live, and a holder count must never take a chart's call. So this
 * asks at most `HOLDER_CALLS_PER_MINUTE` times a minute, keeps each answer ten minutes, and past
 * its budget serves the kept answer or none.
 *
 * ★ NOT REPORTED IS NOT ZERO. The vendor counts holders only for coins it has indexed; a reply
 * without a count is null, and the page shows a dash with its reason, never "0 holders".
 *
 * What breaks if changed carelessly: the two budgets add up against one free limit per address
 * (about thirty a minute). Raising this one without lowering the client's runs both into 429s.
 */

import { num, outOfCredit, rec, VendorUnavailable } from '@insidor/vendor-kit';

import { billingReason } from './billing.ts';

/** Holder reads a minute, beside the market client's own; together under the free limit. */
export const HOLDER_CALLS_PER_MINUTE = 4;
/** A holder count moves slowly; one answer is kept this long. */
export const HOLDERS_KEEP_MS = 600_000;
const MINUTE_MS = 60_000;

/** The count from a token info reply; null when it does not say. Pure. */
export function readHolders(raw: unknown): number | null {
  const count = num(rec(rec(rec(rec(raw).data).attributes).holders).count);
  return count === null || !Number.isInteger(count) || count < 0 ? null : count;
}

/** The key header for a CoinGecko plan, as the market client sends it; none on the free API. */
export function keyHeaders(plan: 'free' | 'demo' | 'pro', apiKey: string | null): Readonly<Record<string, string>> {
  if (plan === 'free' || apiKey === null || apiKey === '') return {};
  return plan === 'demo' ? { 'x-cg-demo-api-key': apiKey } : { 'x-cg-pro-api-key': apiKey };
}

export function geckoterminalHolders(config: { readonly baseUrl: string; readonly headers?: Readonly<Record<string, string>>; readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number; readonly now: () => number }) {
  const kept = new Map<string, { readonly at: number; readonly count: number | null }>();
  const sent: number[] = [];
  return {
    /** The count, kept ten minutes. Throws when it cannot be read now and none is kept. */
    async holders(mint: string): Promise<number | null> {
      const now = config.now();
      const hit = kept.get(mint);
      if (hit !== undefined && now - hit.at < HOLDERS_KEEP_MS) return hit.count;
      while (sent.length > 0 && now - (sent[0] ?? 0) >= MINUTE_MS) sent.shift();
      if (sent.length >= HOLDER_CALLS_PER_MINUTE) {
        if (hit !== undefined) return hit.count;
        throw new VendorUnavailable('geckoterminal', '/tokens/{mint}/info', "held back: this minute's holder reads are spent");
      }
      sent.push(now);
      let response: Response;
      try {
        response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}/networks/solana/tokens/${encodeURIComponent(mint)}/info`, { headers: { accept: 'application/json', ...(config.headers ?? {}) }, signal: AbortSignal.timeout(config.timeoutMs) });
      } catch (e) {
        if (hit !== undefined) return hit.count;
        throw new VendorUnavailable('geckoterminal', '/tokens/{mint}/info', `request failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
      if (!response.ok) {
        /* Told to the owner even when a kept count covers this read. */
        const billing = billingReason(response.status, await response.text().catch(() => ''));
        const refused = billing === null ? null : outOfCredit('geckoterminal', '/tokens/{mint}/info', billing, response.status);
        if (hit !== undefined) return hit.count;
        if (refused !== null) throw refused;
        throw new VendorUnavailable('geckoterminal', '/tokens/{mint}/info', `responded ${response.status}`, response.status);
      }
      const count = readHolders(await response.json());
      kept.set(mint, { at: config.now(), count });
      return count;
    },
  };
}
