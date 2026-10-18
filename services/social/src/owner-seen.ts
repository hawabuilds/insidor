/**
 * WHAT WAS ON THE OWNER'S SCREEN (the owner, 2026-10-18: "Track what's on my screen in the app"):
 *
 *   POST /owner/seen { posts: [{ itemId, surface, onScreenAt?, openedAt? }] }
 *     surface     fyp | narrative | sheet — where the app saw it
 *     onScreenAt  ms: the card was at least half visible for two seconds, from this moment
 *     openedAt    ms: the post sheet was opened
 *
 * The phone batches these (every ten seconds and when the page is hidden) and this writes them to
 * internal.owner_seen (0098), one row per post, each time only ever moved EARLIER (`least`): the first
 * sight starts the owner's 24-hour window, and seeing it again must not restart it. Read back as the
 * "seen and kept" soft yes (store owner-seen.ts); nothing here is shown on any screen.
 *
 * Its own file beside owner.ts because it is not a call: no tap, no feed changes, and a lost batch
 * costs only a soft label. A time from the phone is the phone's clock: one in the future is taken as
 * now, and one older than `MAX_AGE_MS` (a batch stuck offline for days) is refused rather than
 * back-dating a window that has long closed.
 *
 * ★ 404 BEFORE 0098: the app drops the batch quietly, which is exactly true on a database without
 * the table.
 *
 * What breaks if changed carelessly: the owner check happens in owner.ts before this is reached
 * (`ownerRefOf`). Calling this from anywhere else would record anyone's scrolling as the owner's.
 */

import { json, type Reply } from './http.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export const SEEN_SURFACES = ['fyp', 'narrative', 'sheet'] as const;
export type SeenSurface = (typeof SEEN_SURFACES)[number];

const ID = /^[A-Za-z0-9_:.\-]{1,200}$/;
/** A batch is at most this many posts: a long scroll in ten seconds is a few dozen. */
export const MAX_SEEN_BATCH = 200;
/** A sight older than this (two days) is not taken: its 24-hour window closed long ago. */
export const MAX_AGE_MS = 2 * 86_400_000;

export interface SeenPost {
  readonly itemId: string;
  readonly surface: SeenSurface;
  readonly onScreenAt: number | null;
  readonly openedAt: number | null;
}

/** The body as posts, the phone's times clamped to now; or the sentence saying what is wrong. */
export function parseSeen(body: unknown, nowMs: number): readonly SeenPost[] | string {
  if (typeof body !== 'object' || body === null) return 'Send the posts.';
  const list = (body as Record<string, unknown>)['posts'];
  if (!Array.isArray(list)) return 'Send the posts.';
  if (list.length > MAX_SEEN_BATCH) return `Up to ${MAX_SEEN_BATCH} posts at once.`;
  const time = (v: unknown): number | null | 'bad' => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'bad';
    if (v < nowMs - MAX_AGE_MS) return 'bad';
    return Math.min(v, nowMs);
  };
  const out: SeenPost[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) return 'Each post is an object.';
    const r = raw as Record<string, unknown>;
    const itemId = typeof r['itemId'] === 'string' ? r['itemId'].trim() : '';
    if (!ID.test(itemId)) return 'That post id is not one we hold.';
    const surface = SEEN_SURFACES.find((s) => s === r['surface']);
    if (surface === undefined) return `A surface is one of ${SEEN_SURFACES.join(', ')}.`;
    const onScreenAt = time(r['onScreenAt']);
    const openedAt = time(r['openedAt']);
    if (onScreenAt === 'bad' || openedAt === 'bad') return 'That time is not one we take.';
    if (onScreenAt === null && openedAt === null) return 'Say when it was seen or opened.';
    out.push({ itemId, surface, onScreenAt, openedAt });
  }
  return merged(out);
}

/** One entry per post, each time the earliest given and the surface of the first: one insert cannot touch a row twice. */
function merged(posts: readonly SeenPost[]): readonly SeenPost[] {
  const early = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
  const by = new Map<string, SeenPost>();
  for (const p of posts) {
    const had = by.get(p.itemId);
    by.set(p.itemId, had === undefined ? p : { ...had, onScreenAt: early(had.onScreenAt, p.onScreenAt), openedAt: early(had.openedAt, p.openedAt) });
  }
  return [...by.values()];
}

/** POST /owner/seen, for a person `owner.ts` has already checked is the owner (`ref`). */
export async function ownerSeenRoute(method: string, body: unknown, ref: string, db: Db, nowMs: number): Promise<Reply> {
  if (method !== 'POST') return json(405, { error: 'method not allowed' });
  const posts = parseSeen(body, nowMs);
  if (typeof posts === 'string') return json(400, { error: posts });
  const [ready] = await db.query<{ ok: boolean }>(`select to_regclass('internal.owner_seen') is not null as ok`);
  if (ready?.ok !== true) return json(404, { error: 'Not set up yet.' });
  if (posts.length === 0) return json(200, { saved: 0 });
  await db.query(
    `insert into internal.owner_seen (owner_ref, item_id, first_seen_on_screen_at, opened_at, first_surface)
     select $1, p.item_id,
            case when p.on_screen is null then null else to_timestamp(p.on_screen / 1000.0) end,
            case when p.opened is null then null else to_timestamp(p.opened / 1000.0) end,
            p.surface
       from unnest($2::text[], $3::float8[], $4::float8[], $5::text[]) as p(item_id, on_screen, opened, surface)
     on conflict (owner_ref, item_id) do update
        set first_seen_on_screen_at = least(internal.owner_seen.first_seen_on_screen_at, excluded.first_seen_on_screen_at),
            opened_at = least(internal.owner_seen.opened_at, excluded.opened_at),
            updated_at = now()`,
    [ref, posts.map((p) => p.itemId), posts.map((p) => p.onScreenAt), posts.map((p) => p.openedAt), posts.map((p) => p.surface)],
  );
  return json(200, { saved: posts.length });
}
