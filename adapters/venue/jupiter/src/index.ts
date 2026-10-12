/**
 * Jupiter: quotes and unsigned swap transactions for coins that have bonded, ported from
 * Trador's `lib/server/live/jupiter.ts`.
 *
 * A vendor edge: the hosts, the key header and the reply shapes, nothing about who may trade or
 * how much — that is the trade service's (services/trade).
 *
 * ★ THE QUOTE GOES BACK VERBATIM. Jupiter's build takes the quote reply itself (`raw`), and this
 * module never edits it: a build re-priced here would be a transaction for a price the person
 * did not see. A stale quote fails in simulation, before signing, and the person asks again.
 *
 * ★ NO PLATFORM FEE IS EVER SENT FROM HERE. Trador priced a fee on the quote and named a fee
 * account on the build, as a pair. Insidor's fee is off (policy `trade.platformFeeBps` is 0);
 * when it is turned on, both halves arrive together through `feeBps`/`feeAccount` or not at all.
 *
 * What breaks if changed carelessly: a build that comes back without a transaction throws.
 * Returning half an answer is how a person ends up signing something nobody checked.
 */

import { arr, num, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

const VENDOR = 'jupiter';
const QUOTE = 'GET /swap/v1/quote';
const SWAP = 'POST /swap/v1/swap';
/** SOL as a token: the other side of every launchpad trade. */
export const NATIVE = 'So11111111111111111111111111111111111111112';

export interface JupiterConfig {
  /** `https://api.jup.ag`; with a key, less rate limited. */
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
}

export interface PoolQuote {
  readonly venue: 'pool';
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inAmount: string;
  readonly outAmount: string;
  /** The least out at the accepted slippage. */
  readonly bound: string;
  readonly slippageBps: number;
  readonly priceImpactPct: number | null;
  readonly route: readonly string[];
  /** The reply itself; the build sends it back unchanged. */
  readonly raw: unknown;
}

export function readQuote(raw: unknown): PoolQuote {
  const r = rec(raw);
  const inAmount = str(r.inAmount);
  const outAmount = str(r.outAmount);
  const bound = str(r.otherAmountThreshold);
  const inputMint = str(r.inputMint);
  const outputMint = str(r.outputMint);
  if (inAmount === null || outAmount === null || bound === null || inputMint === null || outputMint === null) {
    throw new VendorUnavailable(VENDOR, QUOTE, 'the reply is not a quote');
  }
  const impact = Number(r.priceImpactPct);
  return {
    venue: 'pool',
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    bound,
    slippageBps: num(r.slippageBps) ?? 0,
    priceImpactPct: Number.isFinite(impact) ? impact : null,
    route: arr(r.routePlan).flatMap((s) => {
      const label = str(rec(rec(s).swapInfo).label);
      return label === null ? [] : [label];
    }),
    raw,
  };
}

/** Jupiter's own words for a refusal, when it gives them. */
function refusal(status: number, body: string, step: string): VendorUnavailable {
  let said: string | null = null;
  try {
    const parsed = rec(JSON.parse(body));
    said = str(parsed.error) ?? str(parsed.errorCode);
  } catch {
    said = null;
  }
  if (status === 429) return new VendorUnavailable(VENDOR, step, 'rate limited; try again in a moment', status);
  if (said !== null && /no routes?|could not find any route/i.test(said)) return new VendorUnavailable(VENDOR, step, 'no route', status);
  return new VendorUnavailable(VENDOR, step, said ?? `responded ${status}`, status);
}

export function jupiter(config: JupiterConfig) {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    accept: 'application/json',
    ...(config.apiKey !== null && config.apiKey !== '' ? { 'x-api-key': config.apiKey } : {}),
    ...extra,
  });
  const base = config.baseUrl.replace(/\/+$/, '');

  return {
    async quote(request: { readonly inputMint: string; readonly outputMint: string; readonly amount: bigint; readonly slippageBps: number }): Promise<PoolQuote> {
      const params = new URLSearchParams({
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount.toString(),
        slippageBps: String(request.slippageBps),
        restrictIntermediateTokens: 'true',
      });
      let response: Response;
      try {
        response = await config.fetch(`${base}/swap/v1/quote?${params}`, { headers: headers(), signal: AbortSignal.timeout(config.timeoutMs) });
      } catch (error) {
        throw new VendorUnavailable(VENDOR, QUOTE, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      if (!response.ok) throw refusal(response.status, await response.text(), QUOTE);
      return readQuote(await response.json());
    },

    async build(quote: PoolQuote, user: string): Promise<{ readonly transactionBase64: string; readonly lastValidBlockHeight: number | null }> {
      let response: Response;
      try {
        response = await config.fetch(`${base}/swap/v1/swap`, {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          signal: AbortSignal.timeout(config.timeoutMs),
          body: JSON.stringify({
            quoteResponse: quote.raw,
            userPublicKey: user,
            /* SOL is wrapped and unwrapped around the swap, so a person never holds wrapped SOL. */
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: 'medium', maxLamports: 4_000_000 } },
          }),
        });
      } catch (error) {
        throw new VendorUnavailable(VENDOR, SWAP, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      if (!response.ok) throw refusal(response.status, await response.text(), SWAP);
      const body = rec(await response.json());
      const transaction = str(body.swapTransaction);
      if (transaction === null || transaction === '') throw new VendorUnavailable(VENDOR, SWAP, 'no transaction in the reply');
      return { transactionBase64: transaction, lastValidBlockHeight: num(body.lastValidBlockHeight) };
    },
  };
}

export type Jupiter = ReturnType<typeof jupiter>;
