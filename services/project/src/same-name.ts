/**
 * THE COINS BEHIND AN UNSURE COUNT: which coins a narrative or a feed post shares its name with,
 * written to public.same_name_coin (0051) so "See 3 coins" lists exactly the three.
 *
 * Its own module because two writers share it and must agree on one rule: the frame writes the
 * narratives' lists (the coins the board weighed and could not choose between), the feed writes
 * the posts' lists (the coins its name search kept). Each kind is deleted and rewritten whole in
 * the caller's transaction, beside the rows whose count it backs — except a feed member's list the
 * run did not re-project, which stays beside the card it backs on the infinite scroll.
 *
 * ★ THE COUNT ON THE CARD IS THE LENGTH OF THIS LIST, NOT A SECOND NUMBER. For a narrative the
 * board's `claimCount` is the number of coins it weighed, and this writes those same coins; for
 * a post rising.ts sets `claimCount` from the list it hands here. A count that came from
 * anywhere else could promise three coins and list two.
 *
 * ★ A LIST, NEVER A LINK. Nothing here reaches a feed row's payload: the row still carries only
 * the count, so the card has no coin a Buy button could be built from. The list is read by the
 * read service when a person asks for it, and each coin opens its own page.
 *
 * What breaks if changed carelessly: writing a kind without deleting it first. A coin would stay
 * listed under a post or narrative the board has since settled, and the list would outgrow the
 * count on the card.
 */

import type { Db } from '@insidor/store';

import type { StoryFacts } from './project.ts';
import type { WireCoinEvidence, WireCoinLink } from './wire.ts';

export type SameNameKind = 'story' | 'post';

/**
 * Every list of one kind, replacing whatever the last run wrote for that kind. Each list is in
 * the order it will be shown (`position`); a post's list carries each coin's facts against the
 * post (0058) when its coins were weighed, and nulls — "not known", never "no" — otherwise.
 */
export async function writeSameNameCoins(
  db: Db,
  kind: SameNameKind,
  lists: ReadonlyMap<string, readonly string[]>,
  evidence: ReadonlyMap<string, ReadonlyMap<string, WireCoinEvidence>> = new Map(),
  /* Subjects whose list stands as last written: feed members this run did not project
     (feed-members.ts), whose cards on the infinite scroll still carry the count it backs. */
  keep: readonly string[] = [],
): Promise<number> {
  await db.query(`delete from public.same_name_coin where subject_kind = $1 and subject_id <> all($2::text[])`, [kind, [...keep]]);
  const ids: string[] = [];
  const addresses: string[] = [];
  const links: (boolean | null)[] = [];
  const pictures: (boolean | null)[] = [];
  const after: (number | null)[] = [];
  const positions: number[] = [];
  for (const [id, list] of lists) {
    [...new Set(list)].forEach((address, position) => {
      const e = evidence.get(id)?.get(address);
      ids.push(id);
      addresses.push(address);
      links.push(e?.linksPost ?? null);
      pictures.push(e?.samePicture ?? null);
      after.push(e?.launchedAfterMs ?? null);
      positions.push(position);
    });
  }
  if (ids.length === 0) return 0;
  await db.query(
    `insert into public.same_name_coin (subject_kind, subject_id, address, links_post, same_picture, launched_after_ms, position)
     select $1, s.id, s.address, s.links, s.picture, s.after, s.position
       from unnest($2::text[], $3::text[], $4::boolean[], $5::boolean[], $6::bigint[], $7::int[]) as s(id, address, links, picture, after, position)
     on conflict do nothing`,
    [kind, ids, addresses, links, pictures, after, positions],
  );
  return ids.length;
}

/**
 * Each unsure narrative's coins, from the facts the board was projected from: every coin it
 * weighed, since `unsure` is "none of them confident" and its count is all of them.
 */
export function storySameNameLists(
  facts: readonly StoryFacts[],
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const story of facts) {
    if (coinsByStory.get(story.storyId)?.kind !== 'unsure') continue;
    out.set(story.storyId, story.coins.map((c) => c.coin.address));
  }
  return out;
}
