/**
 * THE OWNER'S CALLS ON A NARRATIVE (the owner, 2026-10-16): "Not a narrative", "Merge with…",
 * "Remove this post", "Right coin" and "Wrong coin", from the narrative page.
 *
 *   POST /owner/narrative { action, storyId, intoStoryId?, itemId?, coin?, note? }
 *     action  not_narrative | merge (into `intoStoryId`) | remove_post (`itemId`) | coin_right | coin_wrong (`coin`)
 *
 * Saved as internal.owner_feedback rows with subject 'narrative' (0093), append-only like every
 * other call; the runner's next grouping pass and the projector's next frame obey it, and the
 * re-tune reads it (core group/narrative.ts `foldNarrativeCalls`).
 *
 * Its own file beside owner.ts because these calls are about a SET of posts, and which set is the
 * server's to say: the narrative's posts now are read from internal.narrative_member and stored
 * with the call (`members`, and the other narrative's as `other_members` for a merge) — never taken
 * from the request — so the call still names the posts it was about after the grouping has moved
 * the ids on. A narrative the grouping no longer holds is refused, since there is nothing to call.
 *
 * ★ 404 BEFORE 0093: the app reads a 404 here as "not supported yet" and says the call was not
 * saved, which is exactly true on a database without the narrative tables.
 *
 * What breaks if changed carelessly: the owner check happens in owner.ts before this is reached
 * (`ownerRefOf`). Calling this from anywhere else would let anyone hide a narrative.
 */

import { json, type Reply } from './http.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export const NARRATIVE_ACTIONS = ['not_narrative', 'merge', 'remove_post', 'coin_right', 'coin_wrong'] as const;
export type NarrativeAction = (typeof NARRATIVE_ACTIONS)[number];

const ID = /^[A-Za-z0-9_:.\-]{1,200}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_NOTE = 200;

export interface NarrativeCall {
  readonly action: NarrativeAction;
  readonly storyId: string;
  readonly intoStoryId: string | null;
  readonly itemId: string | null;
  readonly coin: string | null;
  readonly note: string | null;
}

/** The request body as one call, or the sentence saying what is wrong with it. */
export function parseNarrativeCall(body: unknown): NarrativeCall | string {
  if (typeof body !== 'object' || body === null) return 'Send a call.';
  const b = body as Record<string, unknown>;
  const action = NARRATIVE_ACTIONS.find((a) => a === b['action']);
  if (action === undefined) return `A narrative call is one of ${NARRATIVE_ACTIONS.join(', ')}.`;
  const id = (k: string): string | null | 'bad' => {
    const v = b[k];
    if (v === undefined || v === null) return null;
    return typeof v === 'string' && ID.test(v.trim()) ? v.trim() : 'bad';
  };
  const storyId = id('storyId');
  if (storyId === null || storyId === 'bad') return 'Say which narrative.';
  const intoStoryId = id('intoStoryId');
  if (intoStoryId === 'bad') return 'That narrative id is not one we hold.';
  const itemId = id('itemId');
  if (itemId === 'bad') return 'That post id is not one we hold.';
  const rawCoin = typeof b['coin'] === 'string' ? b['coin'].replace(/^solana:/, '').trim() : null;
  if (rawCoin !== null && !MINT.test(rawCoin)) return 'That coin address is not a coin address.';
  const note = typeof b['note'] === 'string' ? b['note'].replace(/\s+/g, ' ').trim() : null;
  if (note !== null && note.length > MAX_NOTE) return `A note is up to ${MAX_NOTE} characters.`;
  if (action === 'merge' && (intoStoryId === null || intoStoryId === storyId)) return '"Merge with…" names the other narrative.';
  if (action === 'remove_post' && itemId === null) return '"Remove this post" names the post.';
  if ((action === 'coin_right' || action === 'coin_wrong') && rawCoin === null) return 'Say which coin.';
  return { action, storyId, intoStoryId: action === 'merge' ? intoStoryId : null, itemId: action === 'remove_post' ? itemId : null, coin: action === 'coin_right' || action === 'coin_wrong' ? rawCoin : null, note: note === '' ? null : note };
}

const VERDICT: Readonly<Record<NarrativeAction, string>> = {
  not_narrative: 'not_narrative',
  merge: 'merge',
  remove_post: 'remove_post',
  coin_right: 'right',
  coin_wrong: 'wrong',
};

/** POST /owner/narrative, for a person `owner.ts` has already checked is the owner (`ref`). */
export async function ownerNarrativeRoute(method: string, body: unknown, userId: string, ref: string, db: Db): Promise<Reply> {
  if (method !== 'POST') return json(405, { error: 'method not allowed' });
  const [ready] = await db.query<{ ok: boolean }>(
    `select to_regclass('internal.narrative_member') is not null
        and exists (select 1 from information_schema.columns where table_schema = 'internal' and table_name = 'owner_feedback' and column_name = 'members') as ok`,
  );
  if (ready?.ok !== true) return json(404, { error: 'Narrative calls are not set up yet.' });
  const call = parseNarrativeCall(body);
  if (typeof call === 'string') return json(400, { error: call });
  const membersOf = async (id: string): Promise<string[]> =>
    (await db.query<{ item_id: string }>(`select item_id from internal.narrative_member where narrative_id = $1 order by item_id`, [id])).map((r) => r.item_id);
  const members = await membersOf(call.storyId);
  if (members.length === 0) return json(400, { error: 'That narrative is no longer grouped; refresh and try again.' });
  let otherMembers: string[] | null = null;
  if (call.action === 'merge' && call.intoStoryId !== null) {
    otherMembers = await membersOf(call.intoStoryId);
    if (otherMembers.length === 0) return json(400, { error: 'The narrative to merge with is no longer grouped.' });
  }
  if (call.action === 'remove_post' && call.itemId !== null && !members.includes(call.itemId)) return json(400, { error: 'That post is not in this narrative.' });
  const [row] = await db.query<Record<string, unknown>>(
    `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, coin_address, note, other_id, members, other_members)
     values ($1, $2, 'narrative', $3, $4, $5, $6, $7, $8::text[], $9::text[])
     returning id, verdict as call, item_id as "storyId", other_id as "otherId", coin_address as coin, (extract(epoch from created_at) * 1000)::float8 as at`,
    [ref, userId, call.storyId, VERDICT[call.action], call.coin, call.note, call.intoStoryId ?? call.itemId, members, otherMembers],
  );
  return json(201, { saved: row ?? null });
}
