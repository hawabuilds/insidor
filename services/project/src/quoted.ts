/**
 * THE POST A CARD'S POST QUOTES: read for the cards, and which picture the card leads with.
 *
 * The owner, 2026-10-24: "I want to see the original image of quote-tweeted posts along with the
 * quote-tweeted message." A quote post's card showed its own words only, and the meme is usually
 * the quoted post's picture. Every For You and Popular card whose post quotes another now carries
 * that post (`quote` on the wire, rising.ts), drawn inside the card as the source draws it.
 *
 * ★ TWO PLACES THE QUOTED POST CAN BE, AND THE POST ROW WINS. public.item when a search found it
 * too (its own row, kept fresh), else public.reproduced_post (0128) — the copy the quote's own
 * payload carried, which costs nothing. The account is public.author's row for the same key when
 * there is one, else the copy's. A post row slimmed a week after it was found has its picture link
 * emptied (post-slim.ts): the copy's picture is used then, never an empty one over a real one.
 *
 * ★ THE CARD'S OWN PICTURE FIRST (`mainPicture`). A quote with a picture of its own leads with it
 * and shows the quoted post's small; a quote with none leads with the quoted post's picture, so the
 * meme is on For You at a glance. Either way the picture is a real post's, never made up.
 *
 * Separate from rising.ts because both the cards and the quick frame load through it, and the
 * fallback (no 0128 yet) is one place. What breaks if changed carelessly: the order of preference.
 * Reading the copy over the post row would show a quoted post's words as they were at the first
 * quote we saw, after a search has read it fresh.
 */

import type { Db } from '@insidor/store';

import { pictureOf, type PostPicture } from './db.ts';

/** The quoted post as the card needs it. */
export interface QuotedRow {
  readonly item_id: string;
  readonly source: string;
  readonly source_item_id: string;
  readonly body: string;
  readonly media: unknown;
  readonly posted_at: Date | string | null;
  readonly handle: string | null;
  readonly display_name: string | null;
}

const FROM_BOTH = `
select x.id as item_id,
       coalesce(i.source, rp.source) as source,
       coalesce(i.source_item_id, rp.source_item_id) as source_item_id,
       coalesce(nullif(i.body, ''), rp.body, '') as body,
       case when jsonb_typeof(i.media) = 'array' and jsonb_array_length(i.media) > 0 then i.media else coalesce(rp.media, i.media) end as media,
       coalesce(i.posted_at, rp.posted_at) as posted_at,
       coalesce(nullif(a.handle, ''), rp.author_handle) as handle,
       coalesce(nullif(a.display_name, ''), rp.author_name) as display_name
  from unnest($1::text[]) as x(id)
  left join public.item i on i.item_id = x.id
  left join public.reproduced_post rp on rp.item_id = x.id
  left join public.author a on a.author_key = coalesce(i.author_key, rp.author_key)
 where i.item_id is not null or rp.item_id is not null`;

/** Before 0128: the post rows alone, as the cards had them. */
const FROM_ITEMS = `
select i.item_id, i.source, i.source_item_id, i.body, i.media, i.posted_at, a.handle, a.display_name
  from public.item i
  left join public.author a on a.author_key = i.author_key
 where i.item_id = any($1::text[])`;

/** Each quoted post we hold, by its id; a missing 0128 reads the post rows alone. */
export async function loadQuotedPosts(db: Db, ids: readonly (string | null | undefined)[]): Promise<ReadonlyMap<string, QuotedRow>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
  if (wanted.length === 0) return new Map();
  const [present] = await db.query<{ t: string | null }>(`select to_regclass('public.reproduced_post')::text as t`);
  const rows = await db.query<QuotedRow>((present?.t ?? null) === null ? FROM_ITEMS : FROM_BOTH, [wanted]);
  return new Map(rows.map((r) => [r.item_id, r] as const));
}

/** The picture a card leads with: its post's own, else the quoted post's; null when neither has one. */
export function mainPicture(ownMedia: unknown, quote: { readonly thumbUrl: string | null; readonly thumbIsVideo: boolean } | null): PostPicture | null {
  const own = pictureOf(ownMedia);
  if (own !== null) return own;
  return quote === null || quote.thumbUrl === null ? null : { uri: quote.thumbUrl, isVideo: quote.thumbIsVideo };
}
