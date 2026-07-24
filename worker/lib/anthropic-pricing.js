'use strict';

/**
 * Token → USD from Anthropic usage blocks.
 * Override via ANTHROPIC_PRICE_<MODELSLUG>_INPUT_MTOK / _OUTPUT_MTOK env vars.
 */

const DEFAULT_INPUT_MTOK = Number(process.env.ANTHROPIC_PRICE_INPUT_MTOK) || 1;
const DEFAULT_OUTPUT_MTOK = Number(process.env.ANTHROPIC_PRICE_OUTPUT_MTOK) || 5;

function modelSlug(model) {
  return String(model || 'default').replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

function ratesForModel(model) {
  const slug = modelSlug(model);
  const input = Number(process.env[`ANTHROPIC_PRICE_${slug}_INPUT_MTOK`]);
  const output = Number(process.env[`ANTHROPIC_PRICE_${slug}_OUTPUT_MTOK`]);
  return {
    inputPerToken: (Number.isFinite(input) ? input : DEFAULT_INPUT_MTOK) / 1_000_000,
    outputPerToken: (Number.isFinite(output) ? output : DEFAULT_OUTPUT_MTOK) / 1_000_000,
  };
}

function costFromUsage(model, usage = {}) {
  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
  const { inputPerToken, outputPerToken } = ratesForModel(model);
  const usd =
    input * inputPerToken +
    output * outputPerToken +
    cacheRead * inputPerToken * 0.1 +
    cacheWrite * inputPerToken * 1.25;
  return {
    usd: Math.max(0, usd),
    input_tokens: input + cacheRead + cacheWrite,
    output_tokens: output,
    model: model || null,
  };
}

module.exports = {
  costFromUsage,
  ratesForModel,
  modelSlug,
};
