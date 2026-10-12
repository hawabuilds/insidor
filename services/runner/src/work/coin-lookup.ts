/**
 * LOOKING UP COINS WE NEVER SAW MINTED, BY A NARRATIVE'S OR A POST'S NAME.
 *
 * A promoted narrative, or a For You post, with no coin may have one the mint stream never told
 * us about — launched before we were watching. Its name (the judge's) is searched on the market
 * data sources; launchpad coins launched within `universe.lookup.withinMs` are added to the
 * universe as candidates (origin `backfill`), with their metadata link and launch time from the
 * chain when an RPC is configured. The universe loop then reads each one's metadata and checks
 * its origin like any coin's.
 *
 * ★ A SEARCH RESULT NEVER LINKS ANYTHING. This step only adds rows; whether a coin belongs to a
 * narrative is the projector's call, and for a search-found coin it requires the picture, the
 * name and the timing to agree (services/project). Free reads only, so it runs on a dry run.
 *
 * What breaks if changed carelessly: a term both sources failed on is NOT recorded, so it is
 * searched again next pass. Recording it would mark the narrative "searched, nothing found" and
 * show "no coin yet" on the strength of an outage.
 */

import type { Millis } from '@insidor/contracts';
import { assetKey } from '@insidor/contracts/ids.ts';
import type { CoinSearch } from '@insidor/contracts/ports/coin-search.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgAssetRepo, PgCoinUniverseRepo } from '@insidor/store';
import { mergeHits } from '@insidor/core';
import { assetFromSearch, CHAIN } from '@insidor/venue-solana-pumpfun';

import { errorText, type Logger } from '../log.ts';

export interface LookupDeps {
  readonly coins: Pick<PgCoinUniverseRepo, 'lookupTerms' | 'recordLookup' | 'lookupsSince' | 'knownAssets'>;
  readonly assets: Pick<PgAssetRepo, 'upsert'>;
  readonly sources: readonly CoinSearch[];
  /** The chain, for a candidate's metadata link and launch time. Null: neither is read. */
  readonly chain: { metadataUri(mint: string): Promise<string | null>; oldestSignatureBlockTime(address: string): Promise<number | null> } | null;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

const DAY_MS = 86_400_000;

export async function lookUpCoins(deps: LookupDeps): Promise<{ readonly searched: number; readonly added: number }> {
  const now = deps.now();
  const l = deps.policy.universe.lookup;
  const done = await deps.coins.lookupsSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis);
  const room = Math.min(l.termsPerPass, l.perDay - done);
  if (room <= 0) return { searched: 0, added: 0 };

  let searched = 0;
  let added = 0;
  for (const term of await deps.coins.lookupTerms((now - l.keepMs) as Millis, room)) {
    const answers = await Promise.allSettled(deps.sources.map((s) => s.search(term.term)));
    const read = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value.hits] : []));
    if (read.length === 0) {
      deps.log.warn('coin search unavailable on every source; the name is searched again later', { term: term.term });
      continue;
    }
    const hits = mergeHits(read)
      .filter((h) => h.createdAt !== null && h.createdAt >= now - l.withinMs)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, l.hitsPerTerm);
    const known = await deps.coins.knownAssets(hits.map((h) => assetKey({ chain: CHAIN, address: h.address })));
    let newHere = 0;
    for (const hit of hits) {
      if (known.has(assetKey({ chain: CHAIN, address: hit.address }))) continue;
      let metadataUri: string | null = null;
      let chainCreatedAt: Millis | null = null;
      if (deps.chain !== null) {
        try {
          metadataUri = await deps.chain.metadataUri(hit.address);
          const seconds = await deps.chain.oldestSignatureBlockTime(hit.address);
          chainCreatedAt = seconds === null ? null : ((seconds * 1_000) as Millis);
        } catch (e) {
          deps.log.info('chain read for a found coin failed; it is added with what the search gave', { coin: hit.address, err: errorText(e) });
        }
      }
      const asset = assetFromSearch(hit, { firstSeenAt: now, metadataUri, chainCreatedAt });
      if (asset === null) continue;
      await deps.assets.upsert([asset]);
      newHere += 1;
    }
    await deps.coins.recordLookup(term, hits.length, newHere, now);
    searched += 1;
    added += newHere;
  }
  if (searched > 0) deps.log.info('coins looked up by name', { searched, added });
  return { searched, added };
}
