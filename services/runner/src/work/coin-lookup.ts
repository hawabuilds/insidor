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
 * ★ EVERY NAME, NOT ONE (2026-10-13). A subject is searched under each name the judge gave it —
 * the proposed name, then the alternates, up to `lookup.namesPerSubject` — and the answers are
 * merged by address. One name found the right coin for only 25 of 71 gold origin posts: the
 * coin is often named after the alternate, or the ticker. The subject counts as searched when
 * any name finished on any source; it failed only when every name failed on every source. The
 * caps count calls, so a pass takes `termsPerPass / namesPerSubject` subjects.
 *
 * ★ A SEARCH RESULT NEVER LINKS ANYTHING. This step only adds rows; whether a coin belongs to a
 * narrative is the projector's call, and for a search-found coin it requires the picture, the
 * name and the timing to agree (services/project). Free reads only, so it runs on a dry run.
 *
 * ★ AND THE NAMER'S GUESSES (2026-10-14). With the namer's switch on, a post is also searched
 * under its top guessed names and tickers (internal.name_guess), up to `guessNamesPerSubject`
 * after the judge's: on the owner's coin labels the real coin's own name or ticker is among the
 * namer's five for 16 of 20 posts, among the judge's names for 11.
 *
 * ★ THREE CAPS, ALL COUNTED IN THE STORE, SO A RESTART OR A ONE-OFF RUN SHARES THEM. Each pass
 * searches at most `termsPerPass` names, never more than `perMinute` in any rolling minute and
 * `perDay` in a UTC day, finished and failed searches alike. Feed posts come first, newest into
 * the feed first, then narratives (the store's `lookupTerms`). Every waiting subject is noted
 * before the caps apply, so one the caps leave for later still has the moment it began waiting.
 *
 * ★ THE ADDRESSES KEPT ARE RECORDED, NOT ONLY HOW MANY (0051). A card that says "3 coins use this
 * name" offers to list them, and the list is these addresses; `more` says the search found more
 * than `hitsPerTerm`, or a source cut its answer, so the card can say "10+" instead of a count
 * that is only the part we kept.
 *
 * ★ AND A POST'S OLDER COINS ARE NOTED, NOT ADDED (0060). Every coin a post's search returned
 * whose market predates the post goes to internal.older_coin through `older`: never the post's
 * coin, never a candidate, only measured for whether its trading jumped since (older-coins.ts).
 *
 * What breaks if changed carelessly: a term both sources failed on is NOT recorded as a search,
 * only as a failed attempt. Recording it would mark the post "searched, nothing found" and show
 * "no coin yet" on the strength of an outage. A failed name is tried again on later passes,
 * `1 + retries` times in all; after that the projector's "Couldn't check" is the honest answer.
 */

import type { Millis } from '@insidor/contracts';
import { assetKey } from '@insidor/contracts/ids.ts';
import type { CoinSearch } from '@insidor/contracts/ports/coin-search.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { LookupTerm, PgAssetRepo, PgCoinUniverseRepo, PgOlderCoinRepo } from '@insidor/store';
import { mergeHits } from '@insidor/core';
import { assetFromSearch, CHAIN } from '@insidor/venue-solana-pumpfun';

import { errorText, type Logger } from '../log.ts';

export interface LookupDeps {
  readonly coins: Pick<PgCoinUniverseRepo, 'queueLookups' | 'lookupTerms' | 'recordLookup' | 'recordFailedLookup' | 'searchesSince' | 'knownAssets'> & Partial<Pick<PgCoinUniverseRepo, 'withGuesses'>>;
  readonly assets: Pick<PgAssetRepo, 'upsert'>;
  readonly sources: readonly CoinSearch[];
  /** The chain, for a candidate's metadata link and launch time. Null: neither is read. */
  readonly chain: { metadataUri(mint: string): Promise<string | null>; oldestSignatureBlockTime(address: string): Promise<number | null> } | null;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
  /** Where a post's older coins are noted (0060). Absent: they are not. */
  readonly older?: Pick<PgOlderCoinRepo, 'recordFound'>;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export interface LookupResult {
  /** Names whose search finished on at least one source. */
  readonly searched: number;
  readonly added: number;
  /** Names every source failed on this pass; each is tried again later, up to `retries` times. */
  readonly failed: number;
}

/** The subject's names to search: distinct once case, spaces and punctuation go, at most `max`. */
export function searchNames(term: Pick<LookupTerm, 'term' | 'names' | 'guesses'>, max: number, guessMax = 0): readonly string[] {
  const key = (n: string) => n.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (names: readonly string[], cap: number) => {
    let n = 0;
    for (const name of names) {
      if (n >= cap) break;
      const k = key(name);
      if (k === '' || seen.has(k)) continue;
      seen.add(k);
      out.push(name.trim());
      n += 1;
    }
  };
  take([term.term, ...(term.names ?? [])], max);
  /* The namer's guesses after the judge's names, each only when it is a name not already searched. */
  take(term.guesses ?? [], guessMax);
  return out;
}

export async function lookUpCoins(deps: LookupDeps): Promise<LookupResult> {
  const now = deps.now();
  const l = deps.policy.universe.lookup;
  await deps.coins.queueLookups(now);
  const today = await deps.coins.searchesSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis);
  const thisMinute = await deps.coins.searchesSince((now - MINUTE_MS) as Millis);
  /* The namer's guesses are searched only while its switch is on (Policy.names.on): they are free
     reads, but each is a call against the per-minute and per-day caps. */
  const guessMax = deps.policy.names.on ? l.guessNamesPerSubject : 0;
  const names = Math.max(1, l.namesPerSubject + guessMax);
  const room = Math.floor(Math.min(l.termsPerPass, l.perMinute - thisMinute * names, l.perDay - today * names) / names);
  if (room <= 0) {
    deps.log.info('coin lookup held back by its caps; the names wait for the next pass', { today, thisMinute });
    return { searched: 0, added: 0, failed: 0 };
  }

  let searched = 0;
  let added = 0;
  let failed = 0;
  const waiting = await deps.coins.lookupTerms((now - l.keepMs) as Millis, l.retries, room);
  const terms = guessMax > 0 && deps.coins.withGuesses !== undefined ? await deps.coins.withGuesses(waiting) : waiting;
  for (const term of terms) {
    const perName = await Promise.all(searchNames(term, Math.max(1, l.namesPerSubject), guessMax).map((n) => Promise.allSettled(deps.sources.map((s) => s.search(n)))));
    const answers = perName.flat();
    const read = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value.hits] : []));
    if (read.length === 0) {
      const why = answers.map((a) => (a.status === 'rejected' ? errorText(a.reason) : '')).filter((e) => e !== '').join('; ');
      await deps.coins.recordFailedLookup(term, why, deps.now());
      failed += 1;
      const tries = term.attempts + 1;
      if (tries > l.retries) deps.log.warn('coin search failed on every source, the last try; the post shows it could not be checked', { term: term.term, tries, err: why });
      else deps.log.warn('coin search unavailable on every source; the name is searched again next pass', { term: term.term, tries, err: why });
      continue;
    }
    const merged = mergeHits(read);
    if (term.kind === 'post' && deps.older !== undefined) {
      const dated = merged.flatMap((h) => (h.createdAt === null ? [] : [{ address: h.address, name: h.name, ticker: h.ticker, launchedAt: h.createdAt as Millis }]));
      /* Never at the lookup's expense: a failure here (0060 not applied yet) loses only the note. */
      try {
        await deps.older.recordFound(term.id, dated, deps.policy.origin.launchAllowanceMs, now);
      } catch (e) {
        deps.log.warn('older coins for a post could not be noted; the lookup goes on', { post: term.id, err: errorText(e) });
      }
    }
    const isRecent = (h: { createdAt: number | null }) => h.createdAt !== null && h.createdAt >= now - l.withinMs;
    const newest = <T extends { createdAt: number | null }>(xs: readonly T[]) => [...xs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    /* Each name keeps its own newest `hitsPerTerm`, so a common alternate cannot crowd out the
       proposed name's coins; the union is listed newest first. */
    const kept = new Map<string, (typeof merged)[number]>();
    let cut = false;
    for (const answersOfName of perName) {
      /* A name every source failed on may hold coins we did not see: the list says "more". */
      if (answersOfName.every((a) => a.status === 'rejected')) cut = true;
      const recentOfName = newest(mergeHits(answersOfName.flatMap((a) => (a.status === 'fulfilled' ? [a.value.hits] : []))).filter(isRecent));
      if (recentOfName.length > l.hitsPerTerm) cut = true;
      for (const h of recentOfName.slice(0, l.hitsPerTerm)) if (!kept.has(h.address)) kept.set(h.address, merged.find((m) => m.address === h.address) ?? h);
    }
    const hits = newest([...kept.values()]);
    /* A source that cut its own answer short may have left out more coins of this name. */
    const more = cut || answers.some((a) => a.status === 'fulfilled' && a.value.capped);
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
    /* Stamped when the search ran, not when the pass began: the rolling minute counts by it. */
    await deps.coins.recordLookup(term, { hits: hits.map((h) => h.address), more }, newHere, deps.now());
    searched += 1;
    added += newHere;
  }
  if (searched > 0 || failed > 0) deps.log.info('coins looked up by name', { searched, added, failed, room });
  return { searched, added, failed };
}
