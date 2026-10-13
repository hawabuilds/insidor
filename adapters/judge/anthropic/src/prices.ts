/**
 * WHAT EACH MODEL COSTS, PER TOKEN — the judge's price book.
 *
 * Vendor facts, so they live in the vendor's folder, with the page they came from and the
 * day they were read. The model is chosen in configuration (`JUDGE_MODEL`); a model that is
 * not in this table cannot be priced, and an unpriced call is refused by the meter rather
 * than estimated — so `httpClient` refuses to build for one, at boot, naming the table.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing — base input and output
 * token prices, read 2026-10-10; cache prices read 2026-10-13.
 *
 * ★ THREE KINDS OF INPUT TOKEN, PRICED APART. The judge marks its fixed prefix (system prompt and
 * instructions) for the vendor's prompt cache, so a reply's usage can split its input three ways:
 * fresh input, input written to the cache (dearer than fresh: 1.25x for the 5-minute cache), and
 * input read back from it (a tenth, or less on some models). Each has its own rate here, per
 * model, because the read discount is not the same on every model. A model whose minimum
 * cacheable prefix is longer than ours (Haiku 4.5: 4,096 tokens; our post prefix is ~1,600)
 * simply reports zero cache tokens and is billed as before.
 *
 * ★ THE BATCH DISCOUNT IS A MULTIPLIER ON EVERYTHING. A request sent through the Message Batches
 * API is billed at half of every rate above, cache rates included (read 2026-10-13). Only
 * one-off jobs use it, never the live feed, whose answers cannot wait for a batch.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: a stale rate makes every estimate wrong in the
 * same direction, and the meter's pre-call check is only as good as the estimate it is
 * handed. Change a rate together with its date.
 */

export interface ModelPrice {
  readonly usdPerMillionInput: number;
  readonly usdPerMillionOutput: number;
  /** Input written to the 5-minute prompt cache. */
  readonly usdPerMillionCacheWrite: number;
  /** Input read back from the prompt cache. */
  readonly usdPerMillionCacheRead: number;
  /**
   * Sent as `output_config.effort` where the model takes one, and absent where it does
   * not (Haiku 4.5 rejects the field). This is a one-word classification; low effort
   * is enough, and on a model whose thinking cannot be switched off it keeps the
   * thinking tokens — which are billed as output — small.
   */
  readonly effort: 'low' | null;
}

export const PRICES_READ_AT = '2026-10-13';

/** What a Message Batches request costs against the same request sent directly. */
export const BATCH_PRICE_FRACTION = 0.5;

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-4-5': { usdPerMillionInput: 1, usdPerMillionOutput: 5, usdPerMillionCacheWrite: 1.25, usdPerMillionCacheRead: 0.1, effort: null },
  'claude-sonnet-5-5': { usdPerMillionInput: 2, usdPerMillionOutput: 10, usdPerMillionCacheWrite: 2.5, usdPerMillionCacheRead: 0.2, effort: 'low' },
  'claude-opus-5-5': { usdPerMillionInput: 4, usdPerMillionOutput: 20, usdPerMillionCacheWrite: 5, usdPerMillionCacheRead: 0.2, effort: 'low' },
};

export function priceFor(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}

/** Fresh input and output, plus cache writes and reads when the reply reported any. */
export const usdForTokens = (
  price: ModelPrice,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0,
): number =>
  (inputTokens / 1e6) * price.usdPerMillionInput +
  (outputTokens / 1e6) * price.usdPerMillionOutput +
  (cacheWriteTokens / 1e6) * price.usdPerMillionCacheWrite +
  (cacheReadTokens / 1e6) * price.usdPerMillionCacheRead;
