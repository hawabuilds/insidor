/**
 * THE OWNER'S COIN FOR A STORY, ON THE FEED'S NEW POSTS ABOUT IT ("Coin for this story").
 *
 * When the owner confirms a coin for a post (owner-calls.ts `loadCoinCalls`), that coin is the
 * confirmed coin for the post's story. This module reads what core `storyCoins` needs to decide
 * which feed posts are about the same story, and hands back its answer per post:
 *
 *   anchors      every post the owner confirmed a coin for (right), and every coin the owner said
 *                was wrong for a post — all of them, not only the feed's: a story confirmed
 *                yesterday still names today's posts
 *   similarity   the cosine of the two posts' words-and-picture vectors, in the same space: the
 *                feed post's from internal.post_embedding (0074, kept by the runner's precedents),
 *                else its labelled vector; the anchor's from internal.label_embedding (0069, the
 *                runner embeds every coin-confirmed post), else its kept one
 *   names        the judge's subject name for each post (the newest answer to the first question),
 *                and each confirmed coin's own ticker and name
 *   stories      the grouping's stories each post is a member of (public.story_member, unmerged)
 *
 * ★ BEFORE 0074 there are no feed-post vectors except for posts the owner labelled: the query
 * reads the label vectors alone, and almost no post gets a story coin. Nothing fails — the tables
 * are looked up first (`to_regclass`), never caught, since a failed statement would abort the
 * projector's transaction.
 *
 * ★ ONLY THE ANSWER LEAVES. The similarity, the bars and which anchor matched stay here and in
 * core; the wire carries the coin and "Coin for this story" (`storyCoin` on the evidence).
 *
 * ★ NOTHING HERE NAMES A STORY. Every coin the owner confirms, on any post, is read the same way
 * the moment it is saved; the bars (Policy.postCoin.storyCoin) are one set for every story.
 *
 * What breaks if changed carelessly: the space join. A post vector compared with a picture-only
 * vector is a number with no meaning, and Policy.postCoin.storyCoin was measured on post vectors.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { storyCoins, type PostCoinCalls, type StoryAnchor, type StoryCoin } from '@insidor/core';
import type { Db } from '@insidor/store';

/** Every anchor the owner's calls give: each post's own coin (right), and each coin called wrong on it. */
export function anchorsOf(calls: ReadonlyMap<string, PostCoinCalls>): readonly Omit<StoryAnchor, 'names' | 'stories'>[] {
  const out: Omit<StoryAnchor, 'names' | 'stories'>[] = [];
  for (const [itemId, c] of calls) {
    if (c.own !== null) out.push({ itemId, coin: c.own.address, atMs: c.own.atMs, kind: 'right' });
    for (const [coin, atMs] of c.wrong) out.push({ itemId, coin, atMs, kind: 'wrong' });
  }
  return out;
}

const vectors = (withKept: boolean, param: string, labelFirst: boolean) => {
  const label = `select item_id, space, embedding, ${labelFirst ? 0 : 1} as pref from internal.label_embedding where item_id = any(${param}::text[])`;
  const kept = `select item_id, space, embedding, ${labelFirst ? 1 : 0} as pref from internal.post_embedding where item_id = any(${param}::text[])`;
  return `select distinct on (item_id, space) item_id, space, embedding from (${withKept ? `${label} union all ${kept}` : label}) v order by item_id, space, pref`;
};

async function similarities(db: Db, postIds: readonly string[], anchorIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
  const run = (withKept: boolean) =>
    db.query<{ item_id: string; anchor: string; similarity: number | string }>(
      `with p as (${vectors(withKept, '$1', false)}), a as (${vectors(withKept, '$2', true)})
       select p.item_id, a.item_id as anchor, 1 - (p.embedding <=> a.embedding) as similarity
         from p join a on a.space = p.space and a.item_id <> p.item_id`,
      [[...postIds], [...anchorIds]],
    );
  /* Asked first, never caught: inside the projector's transaction a failed statement aborts the rest. */
  const [have] = await db.query<{ kept: boolean; labels: boolean }>(
    `select to_regclass('internal.post_embedding') is not null as kept, to_regclass('internal.label_embedding') is not null as labels`,
  );
  if (have === undefined || !have.labels) return new Map();
  const rows = await run(have.kept);
  return new Map(rows.map((r) => [`${r.item_id}|${r.anchor}`, Number(r.similarity)] as const));
}

async function namesAndStories(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, { readonly name: string | null; readonly stories: readonly string[] }>> {
  const rows = await db.query<{ item_id: string; name: string | null; stories: string[] | null }>(
    `select i.item_id,
            (select pj.proposed_name from internal.post_judgement pj
              where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
              order by pj.judged_at desc, pj.id desc limit 1) as name,
            (select array_agg(m.story_id) from public.story_member m join public.story s on s.story_id = m.story_id
              where m.item_id = i.item_id and s.merged_into is null) as stories
       from unnest($1::text[]) as i(item_id)`,
    [[...itemIds]],
  );
  return new Map(rows.map((r) => [r.item_id, { name: r.name, stories: r.stories ?? [] }] as const));
}

/** Each coin's own ticker and name, as we hold them: a post the judge names for the coin is named for its story. */
async function namesOfCoins(db: Db, addresses: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
  if (addresses.length === 0) return new Map();
  const rows = await db.query<{ address: string; symbol: string | null; name: string | null }>(
    `select distinct on (address) address, symbol, name from public.asset where address = any($1::text[]) order by address`,
    [[...addresses]],
  );
  return new Map(rows.map((r) => [r.address, [r.symbol, r.name].filter((n): n is string => n !== null)] as const));
}

/** Each feed post's story coin and the coins called wrong on its story; a post with neither is absent. */
export async function loadStoryCoins(db: Db, postIds: readonly string[], calls: ReadonlyMap<string, PostCoinCalls>, policy: Policy): Promise<ReadonlyMap<string, StoryCoin>> {
  const bare = anchorsOf(calls);
  if (postIds.length === 0 || bare.length === 0) return new Map();
  const anchorIds = [...new Set(bare.map((a) => a.itemId))];
  const sims = await similarities(db, postIds, anchorIds);
  if (sims.size === 0) return new Map();
  const meta = await namesAndStories(db, [...new Set([...postIds, ...anchorIds])]);
  const coinNames = await namesOfCoins(db, [...new Set(bare.map((a) => a.coin))]);
  const anchors: StoryAnchor[] = bare.map((a) => ({
    ...a,
    names: [meta.get(a.itemId)?.name ?? null, ...(coinNames.get(a.coin) ?? [])].filter((n): n is string => n !== null && n.trim() !== ''),
    stories: meta.get(a.itemId)?.stories ?? [],
  }));
  const posts = postIds.map((itemId) => ({ itemId, name: meta.get(itemId)?.name ?? null, stories: meta.get(itemId)?.stories ?? [] }));
  return storyCoins(posts, anchors, (p, a) => sims.get(`${p}|${a}`), policy.postCoin.storyCoin);
}
