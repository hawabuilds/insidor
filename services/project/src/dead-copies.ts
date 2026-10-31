/**
 * ★ A COPY THAT NEVER TOOK OFF IS OFF "SEE N COINS" (the owner, 2026-10-31: "a lot of the see n coins
 * are completely unrelated, the image doesnt match the post at all"; Policy.oneCoin.deadCopies).
 *
 * A coin leaves a post's list only when all four hold, each a fact known at the moment the list is
 * drawn: its picture was compared with the post's and is not the same (`samePicture === false`, never
 * "not compared"); it does not link the post; it is at least `minAgeMs` old; and every market cap we
 * have read for it is under `underCapUsd` (a reading worth more than 1,000x its pool is a misprint and is
 * not counted, as on the replay). A coin we never priced stays: unread is not proof of dead.
 *
 * Why not the picture alone: on the 31 Oct replay 63 coins with a different picture went past $100K,
 * one to $1.1M. Why not the coin's lifetime high: it is hindsight, and would hide a runner in its
 * first minutes. Why these numbers: on every post list we held (16k coins), the rule kept all 151 coins
 * the owner confirmed, every coin past $100K, and every alerted coin but two that died under $4K;
 * it hid 584 copies.
 *
 * Its own file so both writers of the post lists (rising.ts's full run and quick-frame.ts, which share
 * `buildRising`) apply the one rule, and the card's count and the sheet stay the same coins.
 *
 * What breaks if changed carelessly: dropping the vouching coin, the matched coin, or a coin with no
 * picture verdict. Each is a coin the evidence or the owner put there; this only removes what the
 * evidence itself says is someone else's picture. A list this would empty is left whole, so a card
 * never turns from "See N coins" into "No coin yet" on this rule alone.
 */

import type { Db } from '@insidor/store';

import type { WireCoinEvidence } from './wire.ts';

/** A post's search, as rising.ts `PostLookup` has it; written here by shape so the two files do not import each other. */
type Lookup =
  | { readonly coins: readonly string[]; readonly match?: { readonly kind: 'matched' } | { readonly kind: 'unsure'; readonly evidence: ReadonlyMap<string, WireCoinEvidence> } }
  | { readonly gaveUp: true };

export interface DeadCopyPolicy {
  readonly on: boolean;
  readonly minAgeMs: number;
  readonly underCapUsd: number;
}

/** What we know of one listed coin when the list is drawn. */
export interface CopyFacts {
  readonly launchedAtMs: number | null;
  /** The highest market cap among our readings so far; null when we never read one. */
  readonly highestCapUsd: number | null;
}

/** The candidates: coins on an unsure list whose picture was compared and differs, and which do not link the post. */
export function copyCandidates(lookups: ReadonlyMap<string, Lookup>): readonly string[] {
  const out = new Set<string>();
  for (const l of lookups.values()) {
    if (!('coins' in l) || l.match?.kind !== 'unsure') continue;
    for (const [address, e] of l.match.evidence) if (e.samePicture === false && e.linksPost !== true) out.add(address);
  }
  return [...out];
}

/** Each post's list with its dead copies taken out, by the rule in the header. */
export function withoutDeadCopies<L extends Lookup>(
  lookups: ReadonlyMap<string, L>,
  facts: ReadonlyMap<string, CopyFacts>,
  nowMs: number,
  policy: DeadCopyPolicy,
): ReadonlyMap<string, L> {
  if (!policy.on) return lookups;
  const dead = (address: string): boolean => {
    const f = facts.get(address);
    if (f === undefined || f.launchedAtMs === null || f.highestCapUsd === null) return false;
    return nowMs - f.launchedAtMs >= policy.minAgeMs && f.highestCapUsd < policy.underCapUsd;
  };
  return new Map(
    [...lookups].map(([id, l]) => {
      if (!('coins' in l) || l.match?.kind !== 'unsure') return [id, l] as const;
      const evidence = l.match.evidence;
      const kept = l.coins.filter((a) => {
        const e = evidence.get(a);
        return !(e !== undefined && e.samePicture === false && e.linksPost !== true && dead(a));
      });
      return [id, kept.length === 0 || kept.length === l.coins.length ? l : ({ ...l, coins: kept } as L)] as const;
    }),
  );
}

/**
 * ★ READ SPARINGLY: each coin's highest cap costs a few dozen milliseconds of disk, and the quick frame
 * rebuilds the lists every few seconds. So a coin's facts are kept in this process and read again only
 * after `REREAD_MS`, and at most `READS_PER_RUN` coins are read in one run, the never-read first. A
 * coin not read yet stays on its list; one that has since passed $5K is back within `REREAD_MS` (half an hour).
 */
const REREAD_MS = 30 * 60_000;
const READS_PER_RUN = 200;
const kept = new Map<string, CopyFacts & { readonly readAtMs: number }>();

/** Launch time and highest read cap of each candidate we hold; a coin not read yet is absent. */
export async function loadCopyFacts(db: Db, addresses: readonly string[], nowMs: number): Promise<ReadonlyMap<string, CopyFacts>> {
  const due = addresses
    .filter((a) => (kept.get(a)?.readAtMs ?? -Infinity) <= nowMs - REREAD_MS)
    .sort((a, b) => (kept.has(a) ? 1 : 0) - (kept.has(b) ? 1 : 0))
    .slice(0, READS_PER_RUN);
  if (due.length > 0) {
    const rows = await db.query<{ address: string; minted_at: Date | string | null; highest: string | number | null }>(
      `select a.address, a.minted_at,
              (select max(m.market_cap_usd) from public.market_reading m
                where m.chain = 'solana' and m.address = a.address and m.market_cap_usd is not null
                  and m.market_cap_usd < 1000 * coalesce(m.liquidity_usd, 1e12)) as highest
         from public.asset a
        where a.chain = 'solana' and a.address = any($1::text[])`,
      [due],
    );
    /* A coin with no asset row is remembered as unknown too, so it is not asked again every run. */
    for (const a of due) kept.set(a, { launchedAtMs: null, highestCapUsd: null, readAtMs: nowMs });
    for (const r of rows) {
      kept.set(r.address, {
        launchedAtMs: r.minted_at === null ? null : new Date(r.minted_at).getTime(),
        highestCapUsd: r.highest === null ? null : Number(r.highest),
        readAtMs: nowMs,
      });
    }
  }
  const out = new Map<string, CopyFacts>();
  for (const a of addresses) {
    const f = kept.get(a);
    if (f !== undefined) out.set(a, f);
  }
  return out;
}
