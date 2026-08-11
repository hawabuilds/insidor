/**
 * The vendor surface: one batched, structured-output call.
 *
 * Three things are deliberate about the shape:
 *
 *   BATCHED. Roughly four fifths of the spend on the previous build was one
 *   static prompt retransmitted once per item. Ten subjects per call amortises
 *   it, and the subject id travels in the payload so the answers can be matched
 *   back rather than positionally.
 *
 *   STRUCTURED OUTPUT, not a JSON fence. The hand-rolled fence-stripping path
 *   this replaces is deleted, and a malformed answer becomes an absent
 *   judgement rather than a salvaged one.
 *
 *   NO PROMPT CACHING. The minimum cacheable prefix on this model is 4,096
 *   tokens and the instruction set is well under that, so a cache_control
 *   marker would silently do nothing — no error, no warning, no saving.
 *   Padding the prefix past the minimum does pay, but it is a design decision
 *   with its own tradeoffs, not a flag to set here.
 */

import { NotImplemented } from '@insidor/vendor-kit';

/** Token counts as the vendor reports them. Cost is computed from these. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface JudgeResponse {
  /** One entry per subject the model answered. Order is not relied upon. */
  readonly answers: readonly unknown[];
  readonly usage: Usage;
}

export interface JudgeClient {
  judge(input: { readonly system: string; readonly instructions: string; readonly payload: unknown }): Promise<JudgeResponse>;
}

export interface JudgeClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Pinned. A model change is a decider change and must be visible in the log. */
  readonly model: string;
  readonly maxTokens: number;
  readonly fetch: typeof globalThis.fetch;
}

export function httpClient(_config: JudgeClientConfig): JudgeClient {
  return {
    judge: async (_input) => {
      // POST {baseUrl}/v1/messages
      //   headers: x-api-key, anthropic-version
      //   body: { model, max_tokens, system, messages, output_config: { format: … } }
      //   The structured-output schema is one array of { subjectId, coinable,
      //   proposedName, confidence } — the same shape to-judgement.ts decodes.
      throw new NotImplemented('POST /v1/messages');
    },
  };
}
