/**
 * "SEE N COINS" AND "CHOOSE COIN": ONLY THE COINS THAT COULD COME FROM THIS POST OR ITS STORY.
 *
 * A post's name search returns every coin that shares a word with it — dozens for a common name,
 * most launched long before the post or about something else. The owner (2026-10-14) asked for a
 * short list of plausible coins instead. A coin stays when it is LINKED to the post by a fact, or
 * when its NAME and its TIMING both fit:
 *
 *   linked   its links name the post or the poster's account, its picture is the post's, its
 *            description shares at least `descriptionShare` of its words with the post, or an
 *            address under the post named it
 *   name     its name or ticker meets one of the subject's names (core `nameMatch`: exact, a
 *            short form, a misspelling, a longer form) — and is not a generic word on its own
 *            (Policy.group.genericSpans: "viral", "meme", "news"…); words the post merely says do
 *            not count here
 *   timing   launched after the post, or at most `graceBeforeMs` before it (an ongoing story);
 *            an unknown launch is not held against it
 *
 * and it is dropped when it is QUIET: launched over `quietAfterMs` ago, linked by nothing, and its
 * newest market reading says it cannot be traded. At most `maxCoins` stay, largest market cap
 * first (an unread cap after every read one). The card's count is the kept list's length; an
 * empty list is "No coin yet" with Create (rising.ts `postCoins`).
 *
 * ★ "NO TRADES IN 24 HOURS" IS NOT SOMETHING WE READ. We hold no per-coin trade count; the nearest
 * fact is the venue's own answer to a quote (`tradable`). A coin never quoted is not called dead.
 *
 * Its own file so the list's rule is one pure function the owner's labels can be measured on
 * (`plausibleCoins`), apart from the projector's feed membership, which another change owns.
 *
 * What breaks if changed carelessly: the owner's right coin must never drop out of the list more
 * often than before. Every bar here was measured on the owner's labels for that; a stricter bar
 * that hides the right coin trades a cleaner list for a wrong answer.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { compactName, nameMatch, type MatchBars, type PostCoinEvidence } from '@insidor/core';
import type { Db } from '@insidor/store';

/** What the list needs of one coin, beyond its evidence against the post. */
export interface ListedCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAtMs: number | null;
  readonly marketCapUsd: number | null;
  readonly tradable: boolean | null;
}

export interface ListBars {
  readonly graceBeforeMs: number;
  readonly quietAfterMs: number;
  readonly maxCoins: number;
  readonly descriptionShare: number;
  readonly generic: readonly string[];
  readonly name: Pick<MatchBars, 'minVariantLength'>;
}

export function listBars(p: Policy): ListBars {
  const l = p.postCoin.list;
  return { graceBeforeMs: l.graceBeforeMs, quietAfterMs: l.quietAfterMs, maxCoins: l.maxCoins, descriptionShare: l.descriptionShare, generic: p.group.genericSpans, name: p.postCoin };
}

/** Pure: the listed coins that could be the post's, at most `maxCoins`, largest market cap first. */
export function plausibleCoins(
  post: { readonly names: readonly string[]; readonly postedAtMs: number | null },
  listed: readonly string[],
  coins: ReadonlyMap<string, ListedCoin>,
  evidence: ReadonlyMap<string, Pick<PostCoinEvidence, 'linksPost' | 'linksAccount' | 'samePicture' | 'descriptionMatch' | 'addressByAuthor' | 'addressByOthers'>>,
  bars: ListBars,
  nowMs: number,
): readonly string[] {
  const generic = new Set(bars.generic.map((g) => compactName(g)));
  const kept = listed.flatMap((address) => {
    const c = coins.get(address);
    if (c === undefined) return [];
    const e = evidence.get(address);
    const linked =
      e !== undefined &&
      (e.linksPost === true || e.linksAccount === true || e.samePicture === true || (e.descriptionMatch ?? 0) >= bars.descriptionShare || e.addressByAuthor === true || (e.addressByOthers ?? 0) > 0);
    const own = [c.name, c.ticker].filter((n): n is string => n !== null).map((n) => compactName(n));
    const onlyGeneric = own.length > 0 && own.every((n) => generic.has(n));
    const match = onlyGeneric ? 'none' : nameMatch(post.names, c, bars.name);
    const named = match !== 'none';
    const after = post.postedAtMs === null || c.launchedAtMs === null ? null : c.launchedAtMs - post.postedAtMs;
    /* Launched before the post: only a coin of an ongoing story — one the venue still quotes, or
       one named exactly for the subject. */
    const timed = after === null || after >= -bars.graceBeforeMs || c.tradable === true || match === 'exact';
    const quiet = !linked && match !== 'exact' && c.launchedAtMs !== null && c.launchedAtMs < nowMs - bars.quietAfterMs && c.tradable === false;
    return !quiet && (linked || (named && timed)) ? [c] : [];
  });
  return kept
    .sort((a, b) => (b.marketCapUsd ?? -1) - (a.marketCapUsd ?? -1) || listed.indexOf(a.address) - listed.indexOf(b.address))
    .slice(0, bars.maxCoins)
    .map((c) => c.address);
}

/** Each coin's name, launch and newest market reading, by address. */
export async function loadListedCoins(db: Db, addresses: readonly string[]): Promise<ReadonlyMap<string, ListedCoin>> {
  if (addresses.length === 0) return new Map();
  const rows = await db.query<{ address: string; name: string | null; ticker: string | null; launched_at: Date | string | null; market_cap_usd: number | string | null; tradable: boolean | null }>(
    `select x.address, coalesce(n.name, a.name) as name, coalesce(n.ticker, a.symbol) as ticker,
            coalesce(a.minted_at, n.launched_at) as launched_at, r.market_cap_usd, r.tradable
       from unnest($1::text[]) as x(address)
       left join public.coin_name n on n.address = x.address
       left join public.asset a on a.address = x.address
       left join lateral (select m.market_cap_usd, m.tradable from public.market_reading m
                           where m.asset_key = a.asset_key order by m.taken_at desc limit 1) r on true`,
    [[...new Set(addresses)]],
  );
  return new Map(rows.map((r) => [r.address, {
    address: r.address,
    name: r.name,
    ticker: r.ticker,
    launchedAtMs: r.launched_at === null ? null : new Date(r.launched_at).getTime(),
    marketCapUsd: r.market_cap_usd === null ? null : Number(r.market_cap_usd),
    tradable: r.tradable,
  }] as const));
}

/**
 * Every weighed post's listed coins cut to the plausible ones (`plausibleCoins`), in the lookups the
 * projector shows: the card's count and the "See N coins" list both read the cut list.
 */
export async function withPlausibleLists<L extends { readonly coins: readonly string[]; readonly more: boolean } | { readonly gaveUp: true }>(
  db: Db,
  lookups: ReadonlyMap<string, L>,
  weighed: ReadonlyMap<string, { readonly decision: { readonly kind: string; readonly ranked?: readonly PostCoinEvidence[] } }>,
  p: Policy,
  nowMs: number,
): Promise<ReadonlyMap<string, L>> {
  const ids = [...weighed.keys()].filter((id) => {
    const l = lookups.get(id);
    return l !== undefined && 'coins' in l && l.coins.length > 0;
  });
  if (ids.length === 0) return lookups;
  const posts = await db.query<{ item_id: string; at: Date | string | null; proposed_name: string | null; alternate_names: unknown }>(
    `select i.item_id, coalesce(i.posted_at, i.first_seen_at) as at, j.proposed_name, j.alternate_names
       from public.item i
       left join lateral (select pj.proposed_name, pj.alternate_names from internal.post_judgement pj
                           where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
                           order by pj.judged_at desc, pj.id desc limit 1) j on true
      where i.item_id = any($1::text[])`,
    [ids],
  );
  const byId = new Map(posts.map((r) => [r.item_id, r] as const));
  const coins = await loadListedCoins(db, ids.flatMap((id) => {
    const l = lookups.get(id);
    return l !== undefined && 'coins' in l ? l.coins : [];
  }));
  const bars = listBars(p);
  const out = new Map(lookups);
  for (const id of ids) {
    const l = lookups.get(id);
    if (l === undefined || !('coins' in l)) continue;
    const post = byId.get(id);
    const ranked = weighed.get(id)?.decision.ranked ?? [];
    const kept = plausibleCoins(
      { names: [post?.proposed_name ?? null, ...(Array.isArray(post?.alternate_names) ? post.alternate_names : [])].filter((n): n is string => typeof n === 'string' && n.trim() !== ''), postedAtMs: post?.at === null || post?.at === undefined ? null : new Date(post.at).getTime() },
      l.coins,
      coins,
      new Map(ranked.map((e) => [e.address, e] as const)),
      bars,
      nowMs,
    );
    /* The cut list is the whole list: "at least" (`more`) no longer applies to it. */
    out.set(id, { ...l, coins: kept, more: false });
  }
  return out;
}
