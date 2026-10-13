/**
 * THE NEWS FEED: news posts with a coin in them, kept apart from the memes.
 *
 * For You is memes only. A post the judge's second question called news (core kinds.ts
 * NEWS_KINDS: sport, show business, politics, company or media news) is held off For You and
 * Popular by its newest answer, and comes here instead when either
 *
 *   - the first question passed it: coinable, confident for what it looked at, a short name
 *     (core `postScoreReason`, without the picture boost — a boosted "no" is not coinable), or
 *   - its coin line is confident: the narrative's own `one`, or a `matched` coin (rising.ts
 *     `postCoins`).
 *
 * It must clear the same views bar as For You, and it gets the same card, coin line, Buy and
 * Create. The owner's "Not a meme" takes it off here too; "Is a meme" moves it to For You.
 *
 * Its own file because its load is a different question from For You's: For You reads each post's
 * newest answer, and a news post's newest answer is the kind label, so the first question's answer
 * — the one that says whether there is a coinable subject — has to be read from behind it.
 *
 * ★ THE KIND IS READ FROM THE NEWEST ANSWER ONLY. A post whose newest answer is a first-question
 * answer (re-judged since its kind was asked) is For You's to decide, never here: one post is never
 * on both feeds.
 *
 * What breaks if changed carelessly: dropping the `prompt_id` filter on the first-answer lateral
 * reads the kind label as the post's name, and "SPORT" passes the name test.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { NEWS_KINDS, heldKind, isNewsKind, postScoreReason } from '@insidor/core';
import type { Db } from '@insidor/store';

import type { WirePostCoinLink } from './wire.ts';

/** Every kind question's prompt id starts with this; its answers are labels, never names. */
const KIND_PROMPT_PREFIX = 'post-kind';

/**
 * What this file reads of a loaded news post: the first question's answer in the judge columns,
 * the owner's call, and its kind. The rest of the row is rising.ts's `RisingRow`, which the caller
 * names — this file does not import rising.ts, which imports it.
 */
export interface NewsAnswer {
  readonly coinable: boolean | null;
  readonly confidence: number | null;
  readonly looked_at: 'text' | 'picture' | 'videoFrame' | null;
  readonly proposed_name: string | null;
  readonly owner_call?: string | null;
  readonly kind: string;
}

/**
 * Every catch-all post in the window whose newest answer is a news kind, with the first question's
 * newest answer behind it, the owner's newest call and its promoted story. No picture similarity:
 * the boost does not make a news post coinable.
 */
export async function loadNewsCandidates<Row extends NewsAnswer>(db: Db, sinceMs: Millis): Promise<readonly Row[]> {
  return db.query<Row>(
    `select i.item_id, i.source, i.source_item_id, i.posted_at, i.first_seen_at, i.body, i.media,
            a.handle, a.display_name, a.source_author_id,
            q.coinable, q.confidence, q.looked_at, q.proposed_name,
            null::float8 as picture_similarity,
            s.story_id,
            oc.verdict as owner_call,
            k.proposed_name as kind
       from internal.item_found_by f
       join public.item i on i.item_id = f.item_id
       join public.author a on a.author_key = i.author_key
       join lateral (
              select pj.prompt_id, pj.proposed_name
                from internal.post_judgement pj
               where pj.item_id = i.item_id
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) k on true
       left join lateral (
              select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name
                from internal.post_judgement pj
               where pj.item_id = i.item_id and pj.prompt_id not like $3
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) q on true
       left join lateral (
              select ofb.verdict
                from internal.owner_feedback ofb
               where ofb.subject_kind = 'post' and ofb.item_id = i.item_id
               order by ofb.created_at desc, ofb.id desc
               limit 1
            ) oc on true
       left join lateral (
              select m.story_id
                from public.story_member m
                join public.story st on st.story_id = m.story_id
               where m.item_id = i.item_id and st.state = 'promoted' and st.merged_into is null
               order by m.joined_at asc
               limit 1
            ) s on true
      where i.origin = 'observed'
        and coalesce(i.posted_at, i.first_seen_at) >= $1
        and k.prompt_id like $3
        and upper(trim(k.proposed_name)) = any($2::text[])`,
    [new Date(sinceMs).toISOString(), [...NEWS_KINDS], `${KIND_PROMPT_PREFIX}%`],
  );
}

/**
 * Whether a loaded news post belongs on News, its views bar aside: a news kind, not called "Not a
 * meme" or "Is a meme" by the owner, and coinable by the first answer or with a confident coin.
 */
export function newsPasses(row: NewsAnswer, coins: WirePostCoinLink, policy = DEFAULT_POLICY): boolean {
  const kind = heldKind(row.kind);
  if (kind === null || !isNewsKind(kind)) return false;
  if (row.owner_call === 'not' || row.owner_call === 'meme') return false;
  if (coins.kind === 'one' || coins.kind === 'matched') return true;
  if (row.coinable === null || row.confidence === null || row.looked_at === null) return false;
  const first = { coinable: row.coinable, confidence: Number(row.confidence), lookedAt: row.looked_at, proposedName: row.proposed_name };
  return postScoreReason(first, policy, null) === 'passes';
}
