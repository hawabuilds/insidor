/**
 * ONE POST, ONE COIN ON THE CARDS (Policy.oneCoin.mode 'live'): each For You card and each
 * narrative page shows the single coin the runner picked for it by who is buying it
 * (internal.post_coin_pick, narrative_coin_pick, 0113), with Buy — or, when no coin is picked,
 * Create beside "See N coins": the coins made after the post, its top three by market cap, shown to
 * every reader since 2026-10-26 (the owner, after Dandy). Never the coins that merely share the name
 * from before the post.
 *
 * Its own file because it is a switch over what rising.ts and narrative-frame.ts already decide:
 * in 'shadow' none of this is read and every card is exactly what it was; in 'live' the pick
 * replaces the evidence's proven coin, the narrative's link and the "See N coins" list.
 *
 *   the owner's word first   "No coin is from this", his own coin for the post, and his coin for
 *                            the post's story stay over the pick: the owner's call is truth, the
 *                            pick is a rule. A coin he called wrong is never the pick shown.
 *   picked                   `matched`, the coin, `picked: true` ("Coin for this post"), and the
 *                            facts that hold of it as evidence (links this post, same picture,
 *                            launched N minutes after) — a link is evidence, the pick is the coin.
 *   waiting / none           Create: `none` when no coin was made after the post, else `unsure`
 *                            with up to three, "See N coins", for everyone.
 *   no pick row yet          the card as the name search left it while the search is still
 *                            pending or failed (a dash, "Couldn't check"); otherwise Create.
 *
 * ★ NOTHING OF THE RULE REACHES THE WIRE. Net buying, buyers and why a coin lost stay in the pick's
 * evidence column; the card carries the coin and the facts about the world, nothing else.
 *
 * What breaks if changed carelessly: reading picks in shadow mode. The whole point of shadow is
 * that the owner compares the picks with what ran while the cards keep today's behaviour; a card
 * that showed a shadow pick would make that comparison against itself.
 */

import type { Db } from '@insidor/store';
import { missingTable } from '@insidor/store';

import type { WireCoin, WireCoinEvidence, WirePostCoinLink } from './wire.ts';

/** A post's pick as the card needs it: the coin, or none, and the ties that found it. */
export interface CardPick {
  readonly address: string | null;
  readonly outcome: 'picked' | 'waiting' | 'none';
  readonly ties: readonly string[];
  readonly launchedAfterMs: number | null;
}

/** Each post's pick (0113), with the ties its candidate row recorded. Empty before 0113. */
export async function loadPostPicks(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, CardPick>> {
  if (itemIds.length === 0) return new Map();
  try {
    const rows = await db.query<{ item_id: string; address: string | null; outcome: CardPick['outcome']; ties: unknown; after: number | string | null }>(
      `select p.item_id, p.address, p.outcome, c.evidence -> 'ties' as ties, (c.evidence ->> 'launchedAfterMs') as after
         from internal.post_coin_pick p
         left join internal.one_coin_candidate c on c.item_id = p.item_id and c.address = p.address
        where p.item_id = any($1::text[])`,
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, {
      address: r.address,
      outcome: r.outcome,
      ties: Array.isArray(r.ties) ? r.ties.filter((t): t is string => typeof t === 'string') : [],
      launchedAfterMs: r.after === null || r.after === undefined || !Number.isFinite(Number(r.after)) ? null : Number(r.after),
    }] as const));
  } catch (e) {
    if (missingTable(e)) return new Map();
    throw e;
  }
}

/** Each narrative's picked coin (0113): the address, or null for waiting and none. Empty before 0113. */
export async function loadNarrativePicks(db: Db, narrativeIds: readonly string[]): Promise<ReadonlyMap<string, string | null>> {
  if (narrativeIds.length === 0) return new Map();
  try {
    const rows = await db.query<{ narrative_id: string; address: string | null }>(
      `select narrative_id, address from internal.narrative_coin_pick where narrative_id = any($1::text[])`,
      [[...narrativeIds]],
    );
    return new Map(rows.map((r) => [r.narrative_id, r.address] as const));
  } catch (e) {
    if (missingTable(e)) return new Map();
    throw e;
  }
}

/** The facts that hold of the picked coin against the post, as the card says them; unknown stays null. */
export function pickedEvidence(pick: CardPick, launchedAfterMs: number | null): WireCoinEvidence {
  return {
    linksPost: pick.ties.includes('link') ? true : null,
    samePicture: pick.ties.includes('picture') ? true : null,
    launchedAfterMs: pick.launchedAfterMs ?? launchedAfterMs,
    picked: true,
  };
}

/**
 * The card's coin line in live mode, from what the old rule would have shown (`before`), the pick,
 * and the picked coin's projection (null when we cannot project it: it waits, as any coin does).
 * `listed`: how many coins share the name (the owner's list). `wrong`: the coins the owner called wrong.
 */
export function liveCoinLine(
  before: WirePostCoinLink,
  pick: CardPick | undefined,
  coin: WireCoin | null,
  listed: { readonly count: number; readonly more: boolean },
  wrong: ReadonlySet<string>,
): WirePostCoinLink {
  if (pick?.outcome === 'picked' && pick.address !== null && coin !== null && !wrong.has(pick.address)) {
    const posted = before.kind === 'matched' ? before.evidence.launchedAfterMs : null;
    return { kind: 'matched', coin, evidence: pickedEvidence(pick, posted) };
  }
  /* Not judged yet: a search still pending or failed says so, as before; never a guessed Create. */
  if (pick === undefined && (before.kind === 'pending' || before.kind === 'unchecked')) return before;
  if (listed.count === 0) return { kind: 'none' };
  /* ★ EVERYONE SEES THE TOP THREE (the owner, 2026-10-26, Dandy): `listed` is the coins made after
     the post, at most three (rising.ts POST_COINS_SHOWN), so "See 3 coins" is shown to every reader,
     not the owner alone; the sheet lists the same three, highest market cap first. */
  return listed.more ? { kind: 'unsure', claimCount: listed.count, more: true } : { kind: 'unsure', claimCount: listed.count };
}
