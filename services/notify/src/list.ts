/**
 * THE ALERT LIST, A PAGE AT A TIME — what GET /alerts reads. The app's Feed tab and its
 * Notifications each ask for their own side of the list (core FEED_KINDS draws the line), twenty
 * rows at a time as Trador's Feed pages, with a cursor for the next twenty.
 *
 *   ?list=notifications                       what happened to you
 *   ?list=feed&tab=latest|rising|watching     what is happening; `since` (ms) bounds Rising's week
 *   &cursor=<from the last page>&limit=<1..50>
 *
 * Without `list` it answers as it always did — the newest `inboxLimit` rows of every kind, no
 * cursor — so an app already on someone's phone keeps working until it updates.
 *
 * ★ THE CURSOR IS THE LAST ROW'S (time, id), NOT AN OFFSET. Alerts arrive while someone reads; an
 * offset would show a row twice when one lands above it. One more row than the page is read, so
 * the cursor is null exactly when nothing is left and "Load more" never loads nothing.
 *
 * ★ THE BELL COUNTS NOTIFICATIONS ONLY, ALL OF THEM. `bell` is counted over every unread
 * notification, not over the rows on this page, so paging cannot change it.
 *
 * Apart from routes.ts because the query has grown its own rules (the sides, the tabs, the
 * cursor); routes.ts stays a list of routes. What breaks if changed carelessly: the hidden-post
 * rule (0050) must stay in the page AND the bell count, or the bell counts rows nobody can see.
 */

import { FEED_KINDS } from '@insidor/core';

import type { Db } from './deliver.ts';

/** Trador's FEED_PAGE, and its ceiling on what one ask may take. */
const PAGE = 20;
const MAX_PAGE = 50;
const TABS = ['latest', 'rising', 'watching'] as const;
type Tab = (typeof TABS)[number];

export interface ListQuery {
  readonly mode: 'all' | 'feed' | 'notifications';
  readonly tab: Tab;
  /** Rising's window: rows at or after this time (ms). */
  readonly since: number | null;
  readonly cursor: { readonly at: string; readonly id: number } | null;
  readonly limit: number;
}

/** The query string read into a list query; null when something in it is not one. */
export function parseList(params: URLSearchParams, inboxLimit: number): ListQuery | null {
  const list = params.get('list');
  if (list === null) return { mode: 'all', tab: 'latest', since: null, cursor: null, limit: inboxLimit };
  if (list !== 'feed' && list !== 'notifications') return null;
  const tab = (params.get('tab') ?? 'latest') as Tab;
  if (!TABS.includes(tab)) return null;
  const sinceRaw = params.get('since');
  const since = sinceRaw === null || sinceRaw === '' ? null : Number(sinceRaw);
  if (since !== null && !Number.isFinite(since)) return null;
  const cursor = cursorOf(params.get('cursor'));
  if (cursor === undefined) return null;
  const limitRaw = params.get('limit');
  const limit = limitRaw === null ? PAGE : Math.round(Number(limitRaw));
  if (!Number.isFinite(limit) || limit < 1) return null;
  return { mode: list, tab: list === 'feed' ? tab : 'latest', since, cursor, limit: Math.min(limit, MAX_PAGE) };
}

/** `<UTC time to the microsecond>|<id>`; null when absent, undefined when malformed. */
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
function cursorOf(raw: string | null): ListQuery['cursor'] | undefined {
  if (raw === null || raw === '') return null;
  const cut = raw.lastIndexOf('|');
  const at = raw.slice(0, cut);
  const id = Number(raw.slice(cut + 1));
  if (cut <= 0 || !AT.test(at) || !Number.isInteger(id) || id < 0) return undefined;
  return { at, id };
}

export interface ListRow {
  readonly id: number;
  readonly kind: string;
  readonly subject: string;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly at: string | Date;
  readonly atText: string;
  readonly facts: unknown;
}

/* Nothing about a post or narrative the feeds have since hidden (0050): the alert stays in the
   table, it is just not listed. A coin match's subject is "story id|coin". And one row per comment
   found useful, the newest, as Trador groups its votes: each new liker files a new row with the
   new count, and the older counts for the same comment are history, not news. */
const VISIBLE = `not exists (select 1 from public.feed_rejection r where r.subject_id = split_part(a.subject, '|', 1))
  and (a.kind <> 'comment_useful' or not exists (select 1 from people.alert b where b.user_id = a.user_id and b.kind = 'comment_useful' and b.subject = a.subject and b.alert_id > a.alert_id))`;

/**
 * A watched narrative's alerts: its id is the subject (or the subject's first part, for a coin
 * match), or, for a rising post, its link. Links are written `/#/story/<encodeURIComponent(id)>`,
 * and the only character a story id may carry that is encoded is ':' (routes.ts STORY).
 */
const WATCHED = `(a.kind = 'coin_matched' or exists (select 1 from people.watch w where w.user_id = a.user_id
  and (split_part(a.subject, '|', 1) = w.story_id or a.href = '/#/story/' || replace(w.story_id, ':', '%3A'))))`;

/** One page of the list, newest first, and the cursor for the next (null at the end). */
export async function readPage(db: Db, userId: string, q: ListQuery): Promise<{ readonly rows: readonly ListRow[]; readonly cursor: string | null }> {
  const rows = await db.query<ListRow>(
    `select a.alert_id::int as id, a.kind, a.subject, a.title, a.body, a.href, a.at, to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "atText", a.facts
       from people.alert a
      where a.user_id = $1
        and ${VISIBLE}
        and (case $2::text when 'feed' then a.kind = any($3::text[]) when 'notifications' then not (a.kind = any($3::text[])) else true end)
        and ($4::text <> 'rising' or a.kind = 'rising_post')
        and ($4::text <> 'watching' or ${WATCHED})
        and ($5::bigint is null or a.at >= to_timestamp($5::bigint / 1000.0))
        and ($6::timestamptz is null or (a.at, a.alert_id) < ($6::timestamptz, $7::bigint))
      order by a.at desc, a.alert_id desc
      limit $8`,
    [userId, q.mode, [...FEED_KINDS], q.tab, q.since, q.cursor?.at ?? null, q.cursor?.id ?? 0, q.mode === 'all' ? q.limit : q.limit + 1],
  );
  if (q.mode === 'all' || rows.length <= q.limit) return { rows, cursor: null };
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return { rows: page, cursor: last === undefined ? null : `${last.atText}|${last.id}` };
}

/** Unread notifications, all of them: the bell's number. */
export async function bellCount(db: Db, userId: string): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    `select count(*)::int as n from people.alert a
      where a.user_id = $1
        and a.at > coalesce((select s.seen_at from people.alert_seen s where s.user_id = $1), '-infinity'::timestamptz)
        and not (a.kind = any($2::text[]))
        and ${VISIBLE}`,
    [userId, [...FEED_KINDS]],
  );
  return row?.n ?? 0;
}
