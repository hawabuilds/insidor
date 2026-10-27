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
 * environment only says whether that port can be reached (its address and secret).
 *
 * ★ OUR OWN SPACES ONLY. The hosted model we used before our own has no port any more: a policy
 * naming its spaces ('multimodal-3.1024', still the space of older stored vectors) is dormant like
 * any other space with no port, so going back to it is a code change, not a policy edit.
 *
 * A space with no configured port is dormant: posts go without vectors and grouping falls back to
 * the free tiers (contracts/src/ports/embed.ts, TIER 2). The reason is returned so the boot log says
 * which, instead of a silent null.
 *
 * What breaks if changed carelessly: the port must report the policy's `postSpace` as its own
 * `postSpace` too. A port whose post space differs from the policy's would write post vectors no
 * reader asks for; `embedPortFor` refuses that pairing rather than build it.
 */

import type { Millis } from '@insidor/contracts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { httpClient as selfClient, POST_SPACES as SELF_POST_SPACES, SPACE as SELF_SPACE, selfEmbed } from '@insidor/embed-selfhost';

import type { RunnerConfig } from './config.ts';

export interface EmbedChoice {
  readonly port: EmbedPort | null;
  /** Why there is no port, for the boot log; null when there is one. */
  readonly dormant: string | null;
}

export function embedPortFor(
  cfg: Pick<RunnerConfig, 'selfEmbed'>,
  spaces: { readonly space: string; readonly postSpace: string },
  meter: Meter,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  now: () => Millis = () => Date.now() as Millis,
): EmbedChoice {
  /* Either of our own post spaces (policy.v180): the port is built for the one the policy names. */
  if (spaces.space === SELF_SPACE && SELF_POST_SPACES.includes(spaces.postSpace)) {
    if (cfg.selfEmbed.state !== 'configured') return { port: null, dormant: 'the policy names our own model and EMBED_SERVICE_URL or EMBED_SECRET is unset' };
    return { port: selfEmbed({ client: selfClient({ baseUrl: cfg.selfEmbed.baseUrl, secret: cfg.selfEmbed.secret, fetch: fetchFn }), meter, now, postSpace: spaces.postSpace }), dormant: null };
  }
  return { port: null, dormant: `no embedding port computes the policy's spaces (${spaces.space}, ${spaces.postSpace})` };
}
