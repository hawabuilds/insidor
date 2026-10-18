/**
 * THE FACE ON AN ALERT ROW: the person's picture for a follow or a reply, the poster's picture for
 * a rising post, and the coin's address for anything about a coin (the app builds the logo from
 * the address, as everywhere else). Trador shows a face on every row it can; a letter is only for
 * a row with no picture at all.
 *
 * ★ SAVED WHEN THE ALERT IS MADE, LOOKED UP WHEN IT WAS NOT. A new alert carries its picture in
 * its facts (`picture`, `address`), written by whoever queued it. An older one, or one whose
 * person or poster had no picture then, is looked up here when the list is read: the person's
 * profile, or the poster's account (public.author.picture_url, 0067). The saved one wins; a
 * lookup only fills a gap, which is the backfill for every alert made before this.
 *
 * ★ A LOOKUP THAT CANNOT RUN IS NO PICTURE, NEVER A FAILED LIST. Reading the poster's account
 * needs the grant in 0066 and the column in 0067; until both are applied that one read fails and
 * the rows show their letter or arrow, exactly as before.
 *
 * Only an https link is passed on: a picture is drawn by the phone, and anything else in a fact
 * is not a picture.
 */

import type { Db } from './deliver.ts';

export interface Person {
  readonly userId: string;
  readonly handle: string | null;
  readonly name: string | null;
  readonly picture: string | null;
}

export const httpsOrNull = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The coin an alert is about: its saved address, its token link, or a coin match's subject ("story|mint"). */
export function coinOf(a: { readonly kind: string; readonly subject: string; readonly href: string; readonly facts: Readonly<Record<string, unknown>> }): string | null {
  const saved = a.facts['address'];
  if (typeof saved === 'string' && MINT.test(saved)) return saved;
  const m = /#\/token\/([^/?#]+)/.exec(a.href);
  if (m?.[1] !== undefined) {
    let id = '';
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      id = '';
    }
    const address = id.startsWith('solana:') ? id.slice('solana:'.length) : id;
    if (MINT.test(address)) return address;
  }
  if (a.kind === 'coin_matched') {
    const mint = a.subject.split('|')[1] ?? '';
    if (MINT.test(mint)) return mint;
  }
  return null;
}

/**
 * Who a follow or a reply is from, by alert id. A follow's subject is the follower's handle (or
 * their id when they had none), and new ones carry `userId`; a reply's subject is the reply's own
 * comment id, whose author is the person.
 */
export async function peopleOf(db: Db, rows: readonly { readonly id: number; readonly kind: string; readonly subject: string; readonly facts: Readonly<Record<string, unknown>> }[]): Promise<Map<number, Person>> {
  const out = new Map<number, Person>();
  const follows = rows.filter((r) => r.kind === 'follow').map((r) => ({ id: r.id, key: typeof r.facts['userId'] === 'string' ? r.facts['userId'] : r.subject }));
  const replies = rows.filter((r) => r.kind === 'reply' && /^\d{1,18}$/.test(r.subject)).map((r) => ({ id: r.id, comment: r.subject }));
  if (follows.length > 0) {
    const found = await db.query<{ key: string; userId: string; handle: string | null; name: string | null; picture: string | null }>(
      `select distinct on (k.key) k.key, p.user_id as "userId", p.handle, p.name, p.picture_url as picture
         from unnest($1::text[]) as k(key) join people.profile p on p.user_id = k.key or p.handle = lower(k.key)
        order by k.key, (p.user_id = k.key) desc`,
      [follows.map((f) => f.key)],
    );
    const byKey = new Map(found.map((p) => [p.key, p]));
    for (const f of follows) {
      const p = byKey.get(f.key);
      if (p !== undefined) out.set(f.id, { userId: p.userId, handle: p.handle, name: p.name, picture: httpsOrNull(p.picture) });
    }
  }
  if (replies.length > 0) {
    const found = await db.query<{ comment: string; userId: string; handle: string | null; name: string | null; picture: string | null }>(
      `select c.comment_id::text as comment, p.user_id as "userId", p.handle, p.name, p.picture_url as picture
         from people.comment c join people.profile p on p.user_id = c.author_id
        where c.comment_id = any($1::bigint[])`,
      [replies.map((r) => r.comment)],
    );
    const byComment = new Map(found.map((p) => [p.comment, p]));
    for (const r of replies) {
      const p = byComment.get(r.comment);
      if (p !== undefined) out.set(r.id, { userId: p.userId, handle: p.handle, name: p.name, picture: httpsOrNull(p.picture) });
    }
  }
  return out;
}

/** The poster's picture for each post id, from their account; empty when it cannot be read. */
export async function posterPictures(db: Db, itemIds: readonly string[]): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  try {
    const rows = await db.query<{ itemId: string; picture: string | null }>(
      `select i.item_id as "itemId", a.picture_url as picture
         from public.item i join public.author a on a.author_key = i.author_key
        where i.item_id = any($1::text[])`,
      [[...new Set(itemIds)]],
    );
    const out = new Map<string, string>();
    for (const r of rows) {
      const p = httpsOrNull(r.picture);
      if (p !== null) out.set(r.itemId, p);
    }
    return out;
  } catch {
    /* Before 0066's grant or 0067's column: no pictures, the list still reads. */
    return new Map();
  }
}

/**
 * ★ THE PICTURE BESIDE A ROW ABOUT A POST OR A NARRATIVE (the owner, 2026-10-18: Notifications as
 * Trador's, every row showing what it is about). A post's row carries its picture or video cover
 * (`video` for a still of a video, so the phone draws a play mark) and its site's label for the
 * badge; a narrative's row its own picture. Coin rows show the coin's logo and people rows the
 * person's face (`coinOf`, `peopleOf`), so they get none here. The post is the alert's link
 * (`/#/post/<id>`) or the post part of its subject; the narrative its `/#/story/<id>` link.
 * A lookup that cannot run is no picture, never a failed list.
 */
export interface RowThumb {
  readonly url: string;
  readonly video: boolean;
  readonly sourceLabel: string | null;
}
const POST_KINDS = ['rising_post', 'blowing_up', 'starred_big_account', 'story_post', 'watched_first_coin', 'watch_coin', 'fyp_coin', 'fyp_proven'];

/**
 * ★ A ROW ABOUT A POST IS THE POST'S OWN CARD (the owner, 2026-10-18): the For You card the read
 * service sends (public.feed_post, without its readings), with its poster's picture as the read
 * service adds it, so the phone draws the same card as For You under the notification's reason. A
 * post no feed has a card for gets none, and its row is drawn as before.
 */
export async function cardsOf(db: Db, rows: readonly { readonly id: number; readonly kind: string; readonly subject: string; readonly href: string }[]): Promise<Map<number, unknown>> {
  const posts = new Map(rows.flatMap((r) => {
    const id = postOfRow(r);
    return id === null ? [] : [[r.id, id] as const];
  }));
  if (posts.size === 0) return new Map();
  try {
    const found = await db.query<{ itemId: string; card: unknown }>(
      `select distinct on (f.item_id) f.item_id as "itemId", (f.payload - 'sheet') || jsonb_build_object('authorPictureUrl', a.picture_url) as card
         from public.feed_post f left join public.item i on i.item_id = f.item_id left join public.author a on a.author_key = i.author_key
        where f.item_id = any($1::text[]) and f.payload is not null
        order by f.item_id, f.feed_id = 'fyp' desc`,
      [[...new Set(posts.values())]],
    );
    const byItem = new Map(found.map((c) => [c.itemId, typeof c.card === 'string' ? (JSON.parse(c.card) as unknown) : c.card]));
    return new Map([...posts].flatMap(([alertId, itemId]) => (byItem.has(itemId) ? [[alertId, byItem.get(itemId)] as const] : [])));
  } catch {
    return new Map();
  }
}
const NARRATIVE_KINDS = ['starred_speed', 'blowing_up', 'narrative_promoted', 'narrative_coin', 'coin_matched'];
/* The site labels the app draws badges for (mobile shared/platform.ts), by the item's source. */
const SOURCE_LABEL: Readonly<Record<string, string>> = { x: 'X', tiktok: 'TikTok' };
const routeId = (href: string, route: string): string | null => {
  const m = new RegExp(`#/${route}/([^/?#]+)`).exec(href);
  try {
    return m?.[1] === undefined ? null : decodeURIComponent(m[1]);
  } catch {
    return null;
  }
};

/** The post a row is about, or null for a row about no one post. */
export function postOfRow(r: { readonly kind: string; readonly subject: string; readonly href: string }): string | null {
  if (!POST_KINDS.includes(r.kind)) return null;
  const linked = routeId(r.href, 'post');
  if (linked !== null) return linked;
  const parts = r.subject.split('|');
  return r.kind === 'starred_big_account' ? (parts[1] ?? null) : r.kind === 'blowing_up' ? null : (parts[0] ?? null);
}

export async function thumbsOf(db: Db, rows: readonly { readonly id: number; readonly kind: string; readonly subject: string; readonly href: string; readonly facts: Readonly<Record<string, unknown>> }[]): Promise<Map<number, RowThumb>> {
  const out = new Map<number, RowThumb>();
  const posts = new Map(rows.flatMap((r) => {
    const id = postOfRow(r);
    return id === null ? [] : [[r.id, id] as const];
  }));
  const stories = new Map(rows.flatMap((r) => {
    const id = NARRATIVE_KINDS.includes(r.kind) && !posts.has(r.id) ? routeId(r.href, 'story') : null;
    return id === null ? [] : [[r.id, id] as const];
  }));
  try {
    const items = posts.size === 0 ? [] : await db.query<{ itemId: string; source: string; media: unknown }>('select item_id as "itemId", source, media from public.item where item_id = any($1::text[])', [[...new Set(posts.values())]]);
    const byItem = new Map(items.map((i) => [i.itemId, i]));
    for (const r of rows) {
      const id = posts.get(r.id);
      if (id === undefined) continue;
      const item = byItem.get(id);
      const raw = typeof item?.media === 'string' ? (JSON.parse(item.media) as unknown) : item?.media;
      const first = (Array.isArray(raw) ? raw[0] : undefined) as { uri?: unknown; kind?: unknown; durationMs?: unknown; thumb?: unknown } | undefined;
      const url = httpsOrNull(r.facts['image']) ?? httpsOrNull(first?.kind === 'video' ? first.thumb : first?.uri);
      if (url === null) continue;
      out.set(r.id, { url, video: first !== undefined && (first.kind === 'video' || typeof first.durationMs === 'number'), sourceLabel: item === undefined ? null : (SOURCE_LABEL[item.source] ?? null) });
    }
    const pages = stories.size === 0 ? [] : await db.query<{ storyId: string; thumb: string | null }>(`select story_id as "storyId", payload ->> 'thumbUrl' as thumb from public.story_view where story_id = any($1::text[])`, [[...new Set(stories.values())]]);
    const byStory = new Map(pages.map((p) => [p.storyId, httpsOrNull(p.thumb)]));
    for (const [alertId, storyId] of stories) {
      const url = byStory.get(storyId) ?? null;
      if (url !== null) out.set(alertId, { url, video: false, sourceLabel: null });
    }
  } catch {
    /* No picture beside the row; the list still reads. */
  }
  return out;
}
