/**
 * A COIN YOU MADE GOT ITS FIRST BUYERS (the owner's notification design, 2026-10-18): "$PANCAKE has
 * its first buyers" / "2 wallets bought the coin you made", pushed at once to the person whose
 * wallet created it through Insidor (public.created_coin, 0040; granted to this service in 0110).
 *
 * ★ A BUYER IS ANOTHER WALLET, SEEN ON THE CHAIN. For each coin made under
 * Policy.notify.creatorBuyers.maxCoinAgeMs ago and not yet told, the newest `signaturesRead`
 * transactions touching its address are parsed (the same free-tier reads the holdings check
 * makes) and a buyer is a fee payer other than the creator whose own legs bought the coin. The
 * creator's own first buy, in the create transaction or after, is not a buyer.
 *
 * ★ ONCE PER COIN, AND NOTHING ABOUT THE PAST. Told coins are remembered in people.pipeline_seen
 * (`creator-buyers`); the first look remembers every coin already made and reads nothing, so a
 * deploy never tells anyone about buyers their coin had last week. A read that fails leaves the coin
 * for the next pass. At most `perPass` coins are read a pass, taken in turn (`CreatorState`), so
 * coins nobody buys cannot keep a newer one from being read.
 *
 * What breaks if changed carelessly: counting signatures instead of parsed buys — the create
 * transaction and the creator's own trades touch the coin too, so every new coin would "have buyers".
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';
import { tradesFromTx, type ParsedTx } from '@insidor/chain-portfolio';

import { coinFacts, type Quotes } from './coin-facts.ts';
import { queue, type Db } from './deliver.ts';
import { seenKeys } from './seen.ts';
import { tokenHref } from './pipeline.ts';

export const CREATOR_STREAM = 'creator-buyers';
const SEEDED = '#seeded';

export interface CreatorPorts {
  /** The newest transactions touching a coin's address, parsed. */
  readonly recentTxs: (address: string, limit: number) => Promise<readonly ParsedTx[]>;
  readonly quotes?: Quotes;
}

/** The wallets other than the creator that bought the coin in these transactions. Pure. */
export function buyersOf(txs: readonly ParsedTx[], mint: string, creator: string): readonly string[] {
  const out = new Set<string>();
  for (const tx of txs) {
    const payer = tx.feePayer;
    if (payer === undefined || payer === creator) continue;
    if (tradesFromTx(tx, payer).some((t) => t.mint === mint && t.side === 'buy')) out.add(payer);
  }
  return [...out];
}

/** Where the last pass stopped among the coins still waiting (in memory: a restart starts again at the oldest). */
export interface CreatorState {
  next: number;
}

/** One pass. Returns how many alerts were queued. */
export async function checkCreatorBuyers(db: Db, ports: CreatorPorts, P: NotifyPolicy, state: CreatorState = { next: 0 }): Promise<number> {
  const r = P.creatorBuyers;
  const seen = await seenKeys(db, CREATOR_STREAM);
  const coins = await db.query<{ address: string; creator: string; userId: string | null }>(
    `select c.address, c.creator, p.user_id as "userId" from public.created_coin c left join people.profile p on p.wallet = c.creator
      where c.created_at > now() - make_interval(secs => $1::float8 / 1000) order by c.created_at`,
    [r.maxCoinAgeMs],
  );
  const remember = async (keys: readonly string[]) => {
    if (keys.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [CREATOR_STREAM, [...keys]]);
  };
  if (!seen.has(SEEDED)) {
    await remember([SEEDED, ...coins.map((c) => c.address)]);
    return 0;
  }
  const waiting = coins.filter((c) => c.userId !== null && !seen.has(c.address));
  const start = waiting.length === 0 ? 0 : state.next % waiting.length;
  const due = [...waiting.slice(start), ...waiting.slice(0, start)].slice(0, r.perPass);
  state.next = start + due.length;
  let queued = 0;
  for (const c of due) {
    let buyers: readonly string[];
    try {
      buyers = buyersOf(await ports.recentTxs(c.address, r.signaturesRead), c.address, c.creator);
    } catch {
      continue;
    }
    if (buyers.length === 0) continue;
    const f = (await coinFacts(db, ports.quotes, [c.address])).get(c.address);
    await queue(db, { userId: c.userId as string, kind: 'creator_buyers', subject: c.address, rung: 0, facts: { symbol: f?.symbol ?? '', address: c.address, buyers: buyers.length, mcUsd: f?.mcUsd ?? null, logo: f?.logo ?? null }, href: tokenHref(c.address) });
    await remember([c.address]);
    queued += 1;
  }
  return queued;
}
