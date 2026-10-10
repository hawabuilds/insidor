/**
 * WHAT EACH MODEL COSTS, PER TOKEN — the judge's price book.
 *
 * Vendor facts, so they live in the vendor's folder, with the page they came from and the
 * day they were read. The model is chosen in configuration (`JUDGE_MODEL`); a model that is
 * not in this table cannot be priced, and an unpriced call is refused by the meter rather
 * than estimated — so `httpClient` refuses to build for one, at boot, naming the table.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing — base input and output
 * token prices, read 2026-10-10. Cache prices do not apply: the judge sends no cache_control,
 * because its instruction set is under every model's minimum cacheable prefix.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: a stale rate makes every estimate wrong in the
 * same direction, and the meter's pre-call check is only as good as the estimate it is
 * handed. Change a rate together with its date.
 */

export interface ModelPrice {
  readonly usdPerMillionInput: number;
  readonly usdPerMillionOutput: number;
  /**
   * Sent as `output_config.effort` where the model takes one, and absent where it does
   * not (Haiku 4.5 rejects the field). This is a one-word classification; low effort
   * is enough, and on a model whose thinking cannot be switched off it keeps the
   * thinking tokens — which are billed as output — small.
   */
  readonly effort: 'low' | null;
}

export const PRICES_READ_AT = '2026-10-10';

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-4-5': { usdPerMillionInput: 1, usdPerMillionOutput: 5, effort: null },
  'claude-sonnet-5-5': { usdPerMillionInput: 2, usdPerMillionOutput: 10, effort: 'low' },
  'claude-opus-5-5': { usdPerMillionInput: 4, usdPerMillionOutput: 20, effort: 'low' },
};

export function priceFor(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}

export const usdForTokens = (price: ModelPrice, inputTokens: number, outputTokens: number): number =>
  (inputTokens / 1e6) * price.usdPerMillionInput + (outputTokens / 1e6) * price.usdPerMillionOutput;
