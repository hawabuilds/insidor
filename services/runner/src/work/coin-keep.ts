/**
 * THE COIN UNIVERSE'S KEEP RULE, ONE PASS: ask about the coins that have aged out of the
 * keep-everything window, then delete the ones that do not matter.
 *
 * Separate from the lookup and the origin pass because it is the one step here that deletes, and
 * its safety is that it only deletes on an ANSWER. A coin is asked about once, after
 * `universe.keep.allMs`; a source that fails writes nothing, so the coin is asked again next pass
 * and is never deleted for an outage. Which coins are always kept — named by a narrative or a
 * post, with a found origin, in the gold set, with a market reading — is decided in one place,
 * the store's sweep (store/src/repo/coin-universe.ts), and this step cannot widen it.
 *
 * What breaks if changed carelessly: `deletesPerPass` bounds the damage of a wrong rule to one
 * pass's worth of rows, and `checksPerPass` keeps the batch lookup inside the free source's
 * limit. Narratives, their posts and their coins are never touched here.
 */

import type { Millis } from '@insidor/contracts';
import type { CoinStandings } from '@insidor/contracts/ports/coin-search.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgCoinUniverseRepo, StandingRow } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

export interface KeepDeps {
  readonly coins: Pick<PgCoinUniverseRepo, 'agedUnasked' | 'recordStandings' | 'sweep'>;
  readonly standings: CoinStandings;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export async function keepCoins(deps: KeepDeps): Promise<{ readonly asked: number; readonly deleted: number }> {
  const k = deps.policy.universe.keep;
  const before = (deps.now() - k.allMs) as Millis;
  const aged = await deps.coins.agedUnasked(before, k.checksPerPass);

  let asked = 0;
  for (let i = 0; i < aged.length; i += deps.standings.batch) {
    const batch = aged.slice(i, i + deps.standings.batch);
    let answer: ReadonlyMap<string, { readonly bonded: boolean; readonly marketCapUsd: number | null }>;
    try {
      answer = await deps.standings.standings(batch.map((c) => c.address));
    } catch (e) {
      /* Nothing recorded: these coins are asked again next pass, and none is deleted meanwhile. */
      deps.log.warn('coin standings unavailable; asked again next pass', { coins: batch.length, err: errorText(e) });
      break;
    }
    const rows: StandingRow[] = batch.map((c) => {
      const s = answer.get(c.address);
      return s === undefined
        ? { assetKey: c.assetKey, listed: false, bonded: false, marketCapUsd: null }
        : { assetKey: c.assetKey, listed: true, bonded: s.bonded, marketCapUsd: s.marketCapUsd };
    });
    await deps.coins.recordStandings(rows, deps.now());
    asked += rows.length;
  }

  const deleted = await deps.coins.sweep(before, k.marketCapUsd, k.deletesPerPass);
  if (deleted > 0) deps.log.info('old coins that do not matter deleted', { deleted, asked });
  return { asked, deleted };
}
