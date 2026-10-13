/**
 * THE COINS THE OWNER NAMED, ADDED TO OUR COIN LIST: every coin a current "This is the coin" call
 * names (internal.owner_feedback, `right`) that public.asset does not hold yet.
 *
 * The owner can paste any coin's address on a post (services/social owner-coin.ts). The projector
 * shows that coin as the post's own only once we hold it (services/project owner-calls.ts), and
 * the social service has no write on coins — so this step, in the coin lookup's pass and with the
 * lookup's own free sources, searches each such address, keeps the hit whose address is exactly
 * it, and adds it as any search-found coin is added (`assetFromSearch`, origin `backfill`), with
 * its metadata link and launch time from the chain. The universe step then reads its metadata,
 * and the logo mirror copies its picture, as for every coin.
 *
 * Its own file, apart from coin-lookup.ts, because the lookup searches NAMES and keeps what is
 * recent; here the owner gave the ADDRESS, and the coin is added whatever its age.
 *
 * ★ A SOURCE THAT DOES NOT LIST THE ADDRESS ADDS NOTHING. The owner's label is kept; the coin is
 * asked about again after `RETRY_MS`, in this process. A coin no source ever lists is never
 * shown on the post, rather than shown with no name.
 *
 * What breaks if changed carelessly: the exact-address filter. A search by an address can return
 * other pools that mention it; adding one of those would put another coin on the owner's post.
 */

import type { Millis } from '@insidor/contracts';
import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import type { PgAssetRepo, PgLearningRepo } from '@insidor/store';
import { assetFromSearch } from '@insidor/venue-solana-pumpfun';

import { errorText, type Logger } from '../log.ts';

/** Addresses taken a pass. The owner pastes them one at a time. */
const PER_PASS = 5;
/** How long an address no source listed waits before it is asked about again. */
export const RETRY_MS = 600_000;

export interface OwnerCoinDeps {
  readonly learning: Pick<PgLearningRepo, 'ownerCoinsNotHeld'>;
  readonly assets: Pick<PgAssetRepo, 'upsert'>;
  readonly sources: readonly CoinSearch[];
  readonly chain: { metadataUri(mint: string): Promise<string | null>; oldestSignatureBlockTime(address: string): Promise<number | null> } | null;
  readonly log: Logger;
  readonly now: () => Millis;
}

const lastTried = new Map<string, number>();

export async function addOwnerCoins(deps: OwnerCoinDeps): Promise<number> {
  const now = deps.now();
  const due = (await deps.learning.ownerCoinsNotHeld(PER_PASS * 4)).filter((a) => now - (lastTried.get(a) ?? 0) >= RETRY_MS).slice(0, PER_PASS);
  let added = 0;
  for (const address of due) {
    lastTried.set(address, now);
    const answers = await Promise.allSettled(deps.sources.map((s) => s.search(address)));
    const hits: CoinSearchHit[] = answers.flatMap((a) => (a.status === 'fulfilled' ? a.value.hits.filter((h) => h.address === address) : []));
    const named = hits.find((h) => h.name !== null || h.ticker !== null);
    if (named === undefined) {
      deps.log.info("a coin the owner named is not listed by any source yet; asked again later", { coin: address, sources: answers.filter((a) => a.status === 'fulfilled').length });
      continue;
    }
    const created = hits.flatMap((h) => (h.createdAt === null ? [] : [h.createdAt]));
    let metadataUri: string | null = null;
    let chainCreatedAt: Millis | null = null;
    if (deps.chain !== null) {
      try {
        metadataUri = await deps.chain.metadataUri(address);
        const seconds = await deps.chain.oldestSignatureBlockTime(address);
        chainCreatedAt = seconds === null ? null : ((seconds * 1_000) as Millis);
      } catch (e) {
        deps.log.info("chain read for a coin the owner named failed; it is added with what the search gave", { coin: address, err: errorText(e) });
      }
    }
    /* The earliest market creation time stands in for the launch when the chain did not answer. */
    const asset = assetFromSearch({ ...named, createdAt: created.length === 0 ? null : Math.min(...created) }, { firstSeenAt: now, metadataUri, chainCreatedAt });
    if (asset === null) continue;
    await deps.assets.upsert([asset]);
    lastTried.delete(address);
    added += 1;
  }
  if (added > 0) deps.log.info('coins the owner named added to the coin list', { added });
  return added;
}
