/**
 * THE PICTURE HASH STEP: every new coin's logo and every feed post's picture hashed once
 * (internal.image_hash, 0070), so the projector can find the coins that took a post's picture as
 * their logo, whatever they are named.
 *
 * Its own step because it downloads pictures, which the projector may not do, and because it costs
 * nothing but bandwidth: the hash is computed here (picture-hash.ts), not bought. That is what lets
 * it cover the whole mint stream, where embedding every logo would spend the embeddings line many
 * times over on coins no post ever matches.
 *
 * ★ COINS FIRST, NEWEST FIRST. A coin is a candidate for posts made in the window before its launch,
 * so a logo hashed an hour late is a picture match an hour late; posts' pictures are fewer, and a
 * post's picture matters only once the post has passed the judge (it was embedded).
 *
 * ★ A MISSING HASH DEGRADES, NEVER BLOCKS. A picture that cannot be read is recorded as unreadable
 * (no bits), tried `hashMaxAttempts` times in all, and is an unknown to the match — never
 * "different". Before 0070 is applied the store answers nothing due and the step does nothing.
 *
 * What breaks if changed carelessly: the gateway rewrite. A logo's link usually names the public
 * content gateway, which refuses bursts; reading it through the same gateways the metadata is read
 * through is what keeps a busy minute from failing every picture.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgImageHashRepo } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';
import { HASH_VERSION, hashPicture } from './picture-hash.ts';

export interface PictureHashDeps {
  readonly hashes: Pick<PgImageHashRepo, 'due' | 'record'>;
  /** The content gateways metadata is read through (config `metadataGateways`); the first is used. */
  readonly gateways: readonly string[];
  readonly fetch: typeof fetch;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

const MS_PER_HOUR = 3_600_000;
/** Pictures fetched at once. */
const CONCURRENCY = 8;

/** A content-addressed link rewritten onto our gateway; any other link as it is. */
export function throughGateway(uri: string, gateway: string | undefined): string {
  const m = /^(?:ipfs:\/\/|https?:\/\/[^/]+\/ipfs\/)([A-Za-z0-9]+(?:\/[^?#]*)?)/.exec(uri);
  return m === null || gateway === undefined ? uri : `${gateway.replace(/\/+$/, '')}/ipfs/${m[1]}`;
}

export async function hashPictures(deps: PictureHashDeps): Promise<{ readonly hashed: number; readonly unreadable: number }> {
  const pc = deps.policy.postCoin;
  const now = deps.now();
  let due;
  try {
    due = await deps.hashes.due(
      (now - deps.policy.universe.matchWindowMs) as Millis,
      (now - deps.policy.track.maxTrackedHours * MS_PER_HOUR) as Millis,
      pc.hashCoinsPerPass,
      pc.hashPostsPerPass,
      pc.hashMaxAttempts,
    );
  } catch (e) {
    deps.log.warn('pictures to hash could not be read; tried again next pass', { err: errorText(e) });
    return { hashed: 0, unreadable: 0 };
  }
  let hashed = 0;
  let unreadable = 0;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + CONCURRENCY).map(async (d) => {
        const hex = await hashPicture(throughGateway(d.uri, deps.gateways[0]), deps.fetch, pc.hashTimeoutMs);
        try {
          await deps.hashes.record(d.uri, hex, HASH_VERSION, deps.now());
          if (hex === null) unreadable += 1;
          else hashed += 1;
        } catch (e) {
          deps.log.warn('a picture hash could not be stored; it is hashed again later', { err: errorText(e) });
        }
      }),
    );
  }
  if (due.length > 0) deps.log.info('pictures hashed', { due: due.length, hashed, unreadable });
  return { hashed, unreadable };
}
