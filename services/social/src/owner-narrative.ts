/**
 * THE OWNER'S CALLS ON A NARRATIVE (the owner, 2026-10-16): "Not a narrative", "Merge with…",
 * "Remove this post", "Split", "Right coin" and "Wrong coin", from the narrative page, and "Rename"
 * and "Add a post" (2026-10-23).
 *
 *   POST /owner/narrative { action, storyId, intoStoryId?, itemId?, itemIds?, coin?, title?, postUrl?, note? }
 *     action  not_narrative | merge (into `intoStoryId`) | remove_post (`itemId`) | split (`itemIds`)
 *             | coin_right | coin_wrong (`coin`) | rename (`title`) | add_post (`postUrl` or `itemId`)
 *             | meme_war (`countries`: two to four country names, or none for "not a meme war")
 *             | war_coin (`coin`, or none to take it off: no `storyId`)
 *
 * ★ "COIN FOR TWITTER WORLD WAR" IS ONE CALL ON THE WHOLE WAR, NOT ON A NARRATIVE (the owner,
 * 2026-10-24): verdict 'right' with the coin, or 'cleared' with none, on the fixed id `WAR_ID` and
 * with no posts stored, so the runner's fold never applies it to a narrative (0134). The read
 * service shows it on the war's card through public.war_coin; the newest call wins.
 *
 * ★ "TWITTER WORLD WAR" IS HIS TO OVERRULE, as a rename is: the call (verdict 'fight', `name` the
 * countries or null) and the narrative's own `fight` with `fight_model = 'owner'`, which the titler's
 * answer never replaces. An empty list takes it out of the umbrella; countries put it in.
 *
 * ★ AN ADD NEEDS NO STORED POST. The link is read as the coin label reads one (owner-coin.ts
 * `postIdOf`: `x:<id>`, `tiktok:<id>`); a post we do not hold is queued in internal.missed_post for
 * the runner, which reads it with the missed-posts reader within a minute (the same path "Add missed
 * posts" uses, so it also counts as a post we missed). The call is saved at once either way, and the
 * runner moves the post in on the first pass after it is stored (core group/narrative-keep.ts
 * `ownerAdds`). A post already in this narrative is refused; one in another narrative moves here.
 *
 * ★ A RENAME IS WRITTEN TWICE, IN ONE GO: the call (verdict 'rename', `name` the title) for the
 * record, and the title itself on internal.narrative with `title_model = 'owner'` (0130), so the
 * projector's next frame shows it on the board, the page, the posts' tags and the pushes, and the
 * runner's titler, which writes only where the title is not the owner's, never replaces it.
 *
 * ★ A SPLIT NAMES ITS NEW NARRATIVE HERE, once: `n-<a moved post>` (else `-1`, `-2`… on the first),
 * never an id stored in internal.narrative in any state nor named by an earlier split, and saved as
 * the call's `other_id`, with the posts moved as `members` and the posts that stay as
 * `other_members`. The runner applies a split while that id is not stored yet, so the id is also
 * the mark that it was applied (core group/narrative-keep.ts `ownerSplits`). The posts moved are
 * checked against the narrative's posts now: at least one, and never all of them.
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
import { postIdOf } from './owner-coin.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

export const NARRATIVE_ACTIONS = ['not_narrative', 'merge', 'remove_post', 'split', 'coin_right', 'coin_wrong', 'rename', 'add_post', 'meme_war'] as const;
export type NarrativeAction = (typeof NARRATIVE_ACTIONS)[number];

const ID = /^[A-Za-z0-9_:.\-]{1,200}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_NOTE = 200;
/** The longest title the owner may type: owner_feedback.name's own bound (0054). */
const MAX_TITLE = 80;
/** The most countries one meme war names (Policy.narrative.fight.maxCountries' value; the server checks the shape only). */
const MAX_COUNTRIES = 4;
const COUNTRY = /^[\p{L}][\p{L} .'-]{0,38}[\p{L}.]$/u;
/** The titler's mark for a title the owner typed (0130): the runner never writes over it. */
export const OWNER_TITLE_MODEL = 'owner';
/** The most posts one split names: far over any narrative's page, a bound on the request only. */
const MAX_SPLIT = 1_000;
/** How many `-k` names a split tries on its first post once every `n-<post>` is taken. */
const SPLIT_SUFFIXES = 20;

export interface NarrativeCall {
  readonly action: NarrativeAction;
  readonly storyId: string;
  readonly intoStoryId: string | null;
  readonly itemId: string | null;
  /** Split: the posts moved to the new narrative, each once, in the order sent. */
  readonly itemIds: readonly string[];
  readonly coin: string | null;
  /** Rename: the title, spaces folded, 1 to `MAX_TITLE` characters. */
  readonly title: string | null;
  /** Add a post: the link pasted, when one was (an added post given by id has none). */
  readonly postUrl: string | null;
  /** Meme war: the countries, alphabetical, each once; empty for "not a meme war". */
  readonly countries: readonly string[];
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
  const rawIds = b['itemIds'];
  if (rawIds !== undefined && rawIds !== null && (!Array.isArray(rawIds) || rawIds.length > MAX_SPLIT || !rawIds.every((x) => typeof x === 'string' && ID.test(x.trim())))) return 'Those post ids are not ones we hold.';
  const itemIds = Array.isArray(rawIds) ? [...new Set(rawIds.map((x) => String(x).trim()))] : [];
  const rawCoin = typeof b['coin'] === 'string' ? b['coin'].replace(/^solana:/, '').trim() : null;
  if (rawCoin !== null && !MINT.test(rawCoin)) return 'That coin address is not a coin address.';
  const note = typeof b['note'] === 'string' ? b['note'].replace(/\s+/g, ' ').trim() : null;
  if (note !== null && note.length > MAX_NOTE) return `A note is up to ${MAX_NOTE} characters.`;
  const title = typeof b['title'] === 'string' ? b['title'].replace(/\s+/g, ' ').trim() : null;
  if (action === 'rename' && (title === null || title === '')) return '"Rename" needs the new title.';
  if (action === 'rename' && title !== null && title.length > MAX_TITLE) return `A title is up to ${MAX_TITLE} characters.`;
  const postUrl = typeof b['postUrl'] === 'string' && b['postUrl'].trim() !== '' ? b['postUrl'].trim().replace(/^http:/i, 'https:') : null;
  let added: string | null = null;
  if (action === 'add_post') {
    added = postUrl === null ? itemId : postIdOf(postUrl);
    if (postUrl !== null && added === null) return 'Paste the full link to an X or TikTok post.';
    if (added === null) return '"Add a post" needs the post\'s link.';
  }
  let countries: string[] = [];
  if (action === 'meme_war') {
    const raw = b['countries'];
    if (!Array.isArray(raw) || !raw.every((c) => typeof c === 'string')) return '"Twitter World War" needs the countries, or none.';
    const named = new Map<string, string>();
    for (const c of raw as string[]) {
      const t = c.replace(/\s+/g, ' ').trim();
      if (t === '') continue;
      if (!COUNTRY.test(t)) return `"${t.slice(0, 40)}" is not a country name.`;
      const cased = t.split(' ').map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
      named.set(cased.toLowerCase(), cased);
    }
    countries = [...named.values()].sort((x, y) => x.localeCompare(y));
    if (countries.length === 1 || countries.length > MAX_COUNTRIES) return `A meme war is between 2 and ${MAX_COUNTRIES} countries.`;
  }
  if (action === 'merge' && (intoStoryId === null || intoStoryId === storyId)) return '"Merge with…" names the other narrative.';
  if (action === 'remove_post' && itemId === null) return '"Remove this post" names the post.';
  if (action === 'split' && itemIds.length === 0) return '"Split" names the posts to move.';
  if ((action === 'coin_right' || action === 'coin_wrong') && rawCoin === null) return 'Say which coin.';
  return { action, storyId, intoStoryId: action === 'merge' ? intoStoryId : null, itemId: action === 'remove_post' ? itemId : action === 'add_post' ? added : null, itemIds: action === 'split' ? itemIds : [], coin: action === 'coin_right' || action === 'coin_wrong' ? rawCoin : null, title: action === 'rename' ? title : null, postUrl: action === 'add_post' ? postUrl : null, countries, note: note === '' ? null : note };
}

const VERDICT: Readonly<Record<NarrativeAction, string>> = {
  not_narrative: 'not_narrative',
  merge: 'merge',
  remove_post: 'remove_post',
  split: 'split',
  coin_right: 'right',
  coin_wrong: 'wrong',
  rename: 'rename',
  add_post: 'add_post',
  meme_war: 'fight',
};

/** The war's fixed id in internal.owner_feedback: public.war_coin (0134) reads exactly this. */
export const WAR_ID = 'twitter-world-war';

/** "Coin for Twitter World War": the coin (no `solana:`), null to take it off, or the sentence saying what is wrong. */
export function parseWarCoin(body: unknown): { readonly coin: string | null } | string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const raw = b['coin'];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { coin: null };
  if (typeof raw !== 'string') return 'That coin address is not a coin address.';
  const coin = raw.replace(/^solana:/, '').trim();
  return MINT.test(coin) ? { coin } : 'That coin address is not a coin address.';
}

/** The calls a database may not take yet, and what the owner is told then. */
const LATER: ReadonlyMap<NarrativeAction, string> = new Map([
  ['split', 'Splitting a narrative'],
  ['rename', 'Renaming a narrative'],
  ['add_post', 'Adding a post to a narrative'],
  ['meme_war', 'Twitter World War'],
]);

/** POST /owner/narrative, for a person `owner.ts` has already checked is the owner (`ref`). */
export async function ownerNarrativeRoute(method: string, body: unknown, userId: string, ref: string, db: Db): Promise<Reply> {
  if (method !== 'POST') return json(405, { error: 'method not allowed' });
  const [ready] = await db.query<{ ok: boolean }>(
    `select to_regclass('internal.narrative_member') is not null
        and exists (select 1 from information_schema.columns where table_schema = 'internal' and table_name = 'owner_feedback' and column_name = 'members') as ok`,
  );
  if (ready?.ok !== true) return json(404, { error: 'Narrative calls are not set up yet.' });
  if (typeof body === 'object' && body !== null && (body as Record<string, unknown>)['action'] === 'war_coin') {
    const war = parseWarCoin(body);
    if (typeof war === 'string') return json(400, { error: war });
    const [saved] = await db.query<Record<string, unknown>>(
      `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, coin_address)
       values ($1, $2, 'narrative', $3, $4, $5)
       returning id, verdict as call, item_id as "storyId", coin_address as coin, (extract(epoch from created_at) * 1000)::float8 as at`,
      [ref, userId, WAR_ID, war.coin === null ? 'cleared' : 'right', war.coin],
    );
    return json(201, { saved: saved ?? null });
  }
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
  /* An add: not one already here; a post we do not hold is queued for the runner to read, which needs its link. */
  let queued = false;
  if (call.action === 'add_post' && call.itemId !== null) {
    if (members.includes(call.itemId)) return json(400, { error: 'That post is already in this narrative.' });
    const [stored] = await db.query<{ item_id: string }>(`select item_id from public.item where item_id = $1`, [call.itemId]);
    if (stored === undefined) {
      if (call.postUrl === null) return json(400, { error: "This post isn't in our system yet: paste its link." });
      await db.query(`insert into internal.missed_post (url, owner_ref) values ($1, $2) on conflict (owner_ref, url) do nothing`, [call.postUrl, ref]);
      queued = true;
    }
  }
  let otherId = call.intoStoryId ?? call.itemId;
  let saved = members;
  if (call.action === 'split') {
    if (call.itemIds.some((m) => !members.includes(m))) return json(400, { error: 'A post to move is not in this narrative; refresh and try again.' });
    if (call.itemIds.length >= members.length) return json(400, { error: 'Move some of its posts, not all of them.' });
    const first = [...call.itemIds].sort()[0] ?? '';
    const names = [...[...call.itemIds].sort().map((m) => `n-${m}`), ...Array.from({ length: SPLIT_SUFFIXES }, (_, k) => `n-${first}-${k + 1}`)].filter((x) => x.length <= 200);
    const taken = new Set(
      (await db.query<{ id: string }>(
        `select narrative_id as id from internal.narrative where narrative_id = any($1::text[])
         union select other_id as id from internal.owner_feedback where subject_kind = 'narrative' and verdict = 'split' and other_id = any($1::text[])`,
        [names],
      )).map((r) => r.id),
    );
    const name = names.find((x) => !taken.has(x));
    if (name === undefined) return json(409, { error: 'No free name for the new narrative; try moving other posts.' });
    otherId = name;
    otherMembers = members.filter((m) => !call.itemIds.includes(m));
    saved = [...call.itemIds];
  }
  const [row] = await db.query<Record<string, unknown>>(
    `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, coin_address, note, other_id, members, other_members, name)
     values ($1, $2, 'narrative', $3, $4, $5, $6, $7, $8::text[], $9::text[], $10)
     returning id, verdict as call, item_id as "storyId", other_id as "otherId", coin_address as coin, name as title, (extract(epoch from created_at) * 1000)::float8 as at`,
    [ref, userId, call.storyId, VERDICT[call.action], call.coin, call.note, otherId, saved, otherMembers, call.action === 'meme_war' ? (call.countries.length === 0 ? null : call.countries.join(', ')) : call.title],
  ).catch((e: unknown) => {
    /* Before the database takes a newer call (its owner_feedback check: 'split' 0108, 'rename' 0130), it is "not set up yet", like a 404 before 0093. */
    if (LATER.has(call.action) && (e as { code?: string } | null)?.code === '23514') return null;
    throw e;
  }) ?? [];
  if (row === undefined && LATER.has(call.action)) return json(404, { error: `${LATER.get(call.action) ?? 'That'} is not set up yet.` });
  /* The title itself, marked as his, so the next frame shows it and no titler pass replaces it. */
  if (call.action === 'rename' && call.title !== null) {
    await db.query(
      `update internal.narrative set title = $2, title_model = $3, title_posts = $4, titled_at = now() where narrative_id = $1`,
      [call.storyId, call.title, OWNER_TITLE_MODEL, members.length],
    );
  }
  /* His answer on the meme war, marked as his, so the next frame shows it and the titler never replaces it. */
  if (call.action === 'meme_war') {
    await db.query(`update internal.narrative set fight = $2::text[], fight_model = $3, fight_at = now() where narrative_id = $1`, [call.storyId, [...call.countries], OWNER_TITLE_MODEL]);
  }
  return json(201, { saved: row ?? null, ...(call.action === 'add_post' ? { queued } : {}) });
}
