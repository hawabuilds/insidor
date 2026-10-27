/**
 * The embedding port a tool uses: our own embedding service (services/embed), built for the
 * policy's spaces exactly as the runner builds it (services/runner/src/embed-port.ts), from
 * EMBED_SERVICE_URL and EMBED_SECRET.
 *
 * Its own file because a dozen tools embed, and each used to build its own port from its own
 * imports. That is how several of them came to compute and read vectors in the hosted model's space
 * we used before our own, long after the policy had moved on: every read and write was well formed,
 * and nothing matched. One builder, keyed on the policy, means a tool's vectors are the live
 * system's vectors or there is no port at all.
 *
 * What breaks if changed carelessly: the spaces must be the policy's (`Policy.group.image`), the
 * same pair the runner and projector filter stored vectors on. A tool given a port for any other
 * post space writes or compares vectors no reader asks for; `embedPortFor` refuses a pairing it
 * cannot build, and this throws its reason rather than hand back a port that quietly mismatches.
 */

import type { Millis } from '../../contracts/src/vocabulary.ts';
import type { EmbedPort } from '../../contracts/src/ports/embed.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import { embedPortFor } from '../../services/runner/src/embed-port.ts';

export interface OwnEmbedOptions {
  /** Where EMBED_SERVICE_URL and EMBED_SECRET are read; process.env by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The picture and post spaces; the live policy's by default. */
  readonly spaces?: { readonly space: string; readonly postSpace: string };
}

/** The port, or null with the reason there is none (the service is not configured, or no port computes the spaces). */
export function ownEmbedChoice(meter: Meter, opts: OwnEmbedOptions = {}): { readonly port: EmbedPort | null; readonly dormant: string | null } {
  const env = opts.env ?? process.env;
  const baseUrl = (env['EMBED_SERVICE_URL'] ?? '').trim();
  const secret = (env['EMBED_SECRET'] ?? '').trim();
  const selfEmbed = baseUrl === '' || secret === '' ? ({ state: 'dormant' } as const) : ({ state: 'configured', baseUrl, secret } as const);
  return embedPortFor({ selfEmbed }, opts.spaces ?? DEFAULT_POLICY.group.image, meter, globalThis.fetch, () => Date.now() as Millis);
}

/** The port, or null when it cannot be built (for a tool that runs without vectors). */
export function ownEmbedOrNull(meter: Meter, opts: OwnEmbedOptions = {}): EmbedPort | null {
  return ownEmbedChoice(meter, opts).port;
}

/** The port; throws the reason when it cannot be built (for a tool that cannot run without it). */
export function ownEmbed(meter: Meter, opts: OwnEmbedOptions = {}): EmbedPort {
  const choice = ownEmbedChoice(meter, opts);
  if (choice.port === null) throw new Error(`no embedding port: ${choice.dormant ?? 'unknown'}`);
  return choice.port;
}
