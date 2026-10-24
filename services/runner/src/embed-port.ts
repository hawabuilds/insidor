/**
 * Which embedding port the runner uses: the one whose space the policy names.
 *
 * ★ THE POLICY'S SPACE IS THE SWITCH, NOT AN ENVIRONMENT VARIABLE. A vector is only useful next to
 * vectors of its own space, and every reader — the runner's lookups AND the projector's (story
 * coins, For You's variety, the picture boost, the coin matches) — filters on
 * Policy.group.image.space / postSpace. If the runner chose its model from its own environment,
 * one Railway variable could make it write vectors in a space the projector never reads, under
 * bars measured for another model: everything would look healthy and nothing would match. So the
 * port is chosen here from the policy, which both services load from the same code, and the
 * environment only says whether that port can be reached (its key, or its address and secret).
 *
 * A space with no configured port is dormant, as an unset key always was: posts go without vectors
 * and grouping falls back to the free tiers (contracts/src/ports/embed.ts, TIER 2). The reason is
 * returned so the boot log says which, instead of a silent null.
 *
 * What breaks if changed carelessly: the port must report the policy's `postSpace` as its own
 * `postSpace` too. A port whose post space differs from the policy's would write post vectors no
 * reader asks for; `embedPortFor` refuses that pairing rather than build it.
 */

import type { Millis } from '@insidor/contracts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { httpClient as selfClient, POST_SPACE as SELF_POST_SPACE, SPACE as SELF_SPACE, selfEmbed } from '@insidor/embed-selfhost';
import { httpClient as voyageClient, POST_SPACE as VOYAGE_POST_SPACE, SPACE as VOYAGE_SPACE, voyageEmbed } from '@insidor/embed-voyage';

import type { RunnerConfig } from './config.ts';

export interface EmbedChoice {
  readonly port: EmbedPort | null;
  /** Why there is no port, for the boot log; null when there is one. */
  readonly dormant: string | null;
}

export function embedPortFor(
  cfg: Pick<RunnerConfig, 'embeddings' | 'selfEmbed'>,
  spaces: { readonly space: string; readonly postSpace: string },
  meter: Meter,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  now: () => Millis = () => Date.now() as Millis,
): EmbedChoice {
  if (spaces.space === VOYAGE_SPACE && spaces.postSpace === VOYAGE_POST_SPACE) {
    if (cfg.embeddings.state !== 'configured') return { port: null, dormant: 'the policy names the hosted space and VOYAGE_API_KEY is unset' };
    return { port: voyageEmbed({ client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: fetchFn }), meter, now }), dormant: null };
  }
  if (spaces.space === SELF_SPACE && spaces.postSpace === SELF_POST_SPACE) {
    if (cfg.selfEmbed.state !== 'configured') return { port: null, dormant: 'the policy names our own model and EMBED_SERVICE_URL or EMBED_SECRET is unset' };
    return { port: selfEmbed({ client: selfClient({ baseUrl: cfg.selfEmbed.baseUrl, secret: cfg.selfEmbed.secret, fetch: fetchFn }), meter, now }), dormant: null };
  }
  return { port: null, dormant: `no embedding port computes the policy's spaces (${spaces.space}, ${spaces.postSpace})` };
}
