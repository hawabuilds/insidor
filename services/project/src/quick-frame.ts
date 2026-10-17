/**
 * THE QUICK FRAME: For You moved between full frames, by the posts that changed (Policy.rising.quickFrame).
 *
 * Its own file because it answers a different question from rising.ts. The full frame asks "which
 * posts are on For You now?" of every post in the day's window and takes 90 seconds on the service,
 * nearly all of it weighing coins for hundreds of passing posts (post-match.ts). The quick frame asks
 * "what do the posts that changed since the last frame began do to the For You on screen?" — a
 * judge's new answer, a coin's new link to a post the judge passed, or the owner's call on a post —
 * and weighs only those. A post that crosses the view bar on a new reading with no new answer is the
 * full frame's: readings land every few seconds and would keep this running for little.
 *
 * What it does, in one transaction:
 *   1. the changed posts: every post with an answer filed after the cursor's answer id, and every post
 *      the judge passed that a coin linked, or the owner called, after the cursor's time;
 *   2. those posts built exactly as the full frame builds them (rising.ts `buildRising` with `only`):
 *      the same judge, kind, signal, view and coin bars, the same six hours, the same coin evidence;
 *   3. For You is the committed list with each changed post put in, re-placed or taken off, in
 *      For You's own order (newest first), the variety rule over the whole list, cut to `maxRows`.
 *      An unchanged card is kept exactly as the last frame wrote it.
 *   4. written as the full frame writes For You: the rows and a new tick, the cards' feed membership,
 *      the changed posts' coin lists and name ideas, and why a changed post that left did so.
 * Popular, the board and every other post are the full frame's, which still runs on its minute.
 *
 * ★ THE STORY'S COIN IS THE COMMITTED BOARD'S. A post in a promoted story offers the coin the story's
 * row on screen names (public.board_row), as the full frame's post would offer its own run's.
 *
 * ★ NEVER ALONGSIDE ANOTHER FRAME. The project service runs its jobs one at a time; this is one of
 * them, started only when `quickDue` says so: something changed, the answers have been quiet for
 * `settleMs` (a pass files its kind answers after its yeses, so a post is not shown between the
 * two), and the last quick frame was at least `minGapMs` ago.
 *
 * What breaks if changed carelessly: the cursor. It is read BEFORE a frame starts, and the next quick
 * frame looks only past it; read after, an answer filed while a frame ran would be in neither.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { PgFeedRejectionRepo, type Db } from '@insidor/store';

import { loadMembership, writeMembership } from './feed-members.ts';
import { keepFeedHistory } from './feed-history.ts';
import { loadNameIdeas, writeNameIdeas } from './post-match.ts';
import { onePolicy, type AnswerPolicies } from './judge-cutoff.ts';
import { buildRising, forYouOrder, kindDetail, loadCandidates, varied, writeRising, type WireRisingPost } from './rising.ts';
import { replaceSameNameCoins } from './same-name.ts';
import type { WireCoinLink } from './wire.ts';

/** The spark's window, as the full frame draws it (main.ts SPARK_WINDOW_MS). A presentation bound. */
const SPARK_WINDOW_MS = 30 * 60_000;
/** The most changed posts one quick frame weighs; past it the full frame, a minute away, has them. */
const MAX_CHANGED = 300;
/** The newest links looked at for a passed post: a few minutes of launches. */
const RECENT_LINKS = 200;

/** Where the last frame began: the newest answer's id, and the database's clock. */
export interface QuickCursor {
  readonly answerId: number;
  readonly atMs: number;
}

/** The cursor now; when the newest answer was filed; the newest link to a passed post; the newest owner call on a post. */
export interface QuickProbe extends QuickCursor {
  readonly answerAtMs: number | null;
  readonly linkAtMs: number | null;
  readonly callAtMs: number | null;
}

const ms = (v: Date | string | null | undefined): number | null => (v === null || v === undefined ? null : new Date(v).getTime());

/** A few index reads: cheap enough to ask every few seconds. Times are the database's, never this host's. */
export async function readProbe(db: Db): Promise<QuickProbe> {
  const rows = await db.query<{ answer_id: string | null; answer_at: Date | string | null; link_at: Date | string | null; call_at: Date | string | null; now: Date | string }>(
    `select a.id::text as answer_id, a.recorded_at as answer_at,
            (select max(l.found_at)
               from (select source, source_item_id, found_at from internal.coin_post_link order by found_at desc limit $1) l
              where exists (select 1 from internal.post_judgement j
                             where j.item_id = l.source || ':' || l.source_item_id
                               and j.prompt_id not like 'post-kind%' and j.coinable)) as link_at,
            (select max(o.created_at) from internal.owner_feedback o where o.subject_kind = 'post') as call_at,
            now() as now
       from (select 1) one
       left join lateral (select id, recorded_at from internal.post_judgement order by id desc limit 1) a on true`,
    [RECENT_LINKS],
  );
  const r = rows[0];
  return {
    answerId: r?.answer_id === null || r?.answer_id === undefined ? 0 : Number(r.answer_id),
    atMs: ms(r?.now) ?? 0,
    answerAtMs: ms(r?.answer_at),
    linkAtMs: ms(r?.link_at),
    callAtMs: ms(r?.call_at),
  };
}

/** Whether a quick frame should run now (the header's three conditions), given the last frame's cursor. */
export function quickDue(cursor: QuickCursor | null, lastQuickAtMs: number | null, probe: QuickProbe, nowMs: number, p: Policy = DEFAULT_POLICY): boolean {
  const q = p.rising.quickFrame;
  if (!q.on || cursor === null) return false;
  if (lastQuickAtMs !== null && nowMs - lastQuickAtMs < q.minGapMs) return false;
  const changed = probe.answerId > cursor.answerId || (probe.linkAtMs ?? 0) > cursor.atMs || (probe.callAtMs ?? 0) > cursor.atMs;
  const settled = probe.answerAtMs === null || probe.atMs - probe.answerAtMs >= q.settleMs;
  return changed && settled;
}

/** The posts that changed past the cursor (the header's step 1). */
export async function changedPosts(db: Db, cursor: QuickCursor): Promise<readonly string[]> {
  const rows = await db.query<{ item_id: string }>(
    `(select distinct item_id from internal.post_judgement where id > $1 order by item_id limit $3)
     union
     (select l.source || ':' || l.source_item_id as item_id
        from internal.coin_post_link l
       where l.found_at > $2
         and exists (select 1 from internal.post_judgement j
                      where j.item_id = l.source || ':' || l.source_item_id
                        and j.prompt_id not like 'post-kind%' and j.coinable)
       limit $3)
     union
     (select o.item_id from internal.owner_feedback o
       where o.subject_kind = 'post' and o.created_at > $2 and o.item_id is not null
       limit $3)`,
    [cursor.answerId, new Date(cursor.atMs).toISOString(), MAX_CHANGED],
  );
  return rows.map((r) => r.item_id);
}

/**
 * The committed For You with the changed posts put in, re-placed or taken off (the header's step 3,
 * before the variety rule and the cut): unchanged cards as they were, changed ones as built now,
 * newest first by `at`.
 */
export function mergeForYou<P extends { readonly id: string }>(
  showing: readonly P[],
  changed: ReadonlySet<string>,
  built: readonly P[],
  at: (post: P) => number,
): P[] {
  const kept = showing.filter((p) => !changed.has(p.id));
  const keptIds = new Set(kept.map((p) => p.id));
  const all = [...kept, ...built.filter((p) => !keptIds.has(p.id))];
  return all.sort((a, b) => forYouOrder({ at: at(a), id: a.id }, { at: at(b), id: b.id }));
}

export interface QuickResult {
  readonly changed: number;
  readonly added: number;
  readonly removed: number;
  /** False when nothing on For You changed: no rows written, no tick. */
  readonly wrote: boolean;
}

/** The story coins on the committed board, by story id: what each story's row on screen names. */
async function committedStoryCoins(db: Db): Promise<ReadonlyMap<string, WireCoinLink>> {
  const rows = await db.query<{ story_id: string; coins: WireCoinLink | null }>(
    `select story_id, payload -> 'coins' as coins from public.board_row where view_id = 'default'`,
  );
  return new Map(rows.flatMap((r) => (r.coins === null ? [] : [[r.story_id, r.coins] as const])));
}

/** One quick frame, in the caller's transaction. */
export async function quickForYou(db: Db, nowMs: Millis, cursor: QuickCursor, policy: Policy = DEFAULT_POLICY, answers: AnswerPolicies = onePolicy(policy)): Promise<QuickResult> {
  const ids = await changedPosts(db, cursor);
  if (ids.length === 0) return { changed: 0, added: 0, removed: 0, wrote: false };
  const changed = new Set(ids);
  const showing = (await db.query<{ item_id: string; payload: WireRisingPost }>(`select item_id, payload from public.rising_row where feed_id = 'fyp' order by position`)).map((r) => r.payload);
  const membership = await loadMembership(db, nowMs - policy.rising.windowMs);
  const frame = await buildRising(db, nowMs, await committedStoryCoins(db), SPARK_WINDOW_MS, policy, membership === null ? null : { ...membership, refresh: [] }, answers, ids);

  const sinceMs = (nowMs - policy.rising.windowMs) as Millis;
  const mergedIds = [...new Set([...showing.map((p) => p.id), ...frame.fyp.map((p) => p.id)])];
  const rows = await loadCandidates(db, sinceMs, mergedIds, mergedIds);
  const rowAt = new Map(rows.map((r) => [r.item_id, new Date(r.posted_at ?? r.first_seen_at).getTime()] as const));
  const at = (p: WireRisingPost): number => rowAt.get(p.id) ?? p.postedAt.at ?? 0;
  const merged = mergeForYou(showing, changed, frame.fyp, at);
  const cards = merged.map((post) => ({ at: at(post), post }));
  const fyp = (policy.rising.varietyOn ? await varied(db, cards, rows, policy) : cards).slice(0, policy.rising.maxRows).map((c) => c.post);

  const before = new Set(showing.map((p) => p.id));
  const after = new Set(fyp.map((p) => p.id));
  const added = fyp.filter((p) => !before.has(p.id));
  const left = showing.filter((p) => !after.has(p.id));
  const replaced = fyp.filter((p) => before.has(p.id) && changed.has(p.id));
  if (added.length === 0 && left.length === 0 && replaced.length === 0) return { changed: ids.length, added: 0, removed: 0, wrote: false };

  /* Why a changed post that was showing left; one pushed off by the cut or the variety rule left for no failing of its own. */
  await new PgFeedRejectionRepo(db).record(left.flatMap((p) => {
    const why = changed.has(p.id) ? frame.whyNot.get(p.id) : undefined;
    return why === undefined ? [] : [{ kind: 'post' as const, id: p.id, reason: why, detail: kindDetail(frame.heldBy.get(p.id)) }];
  }));
  const fresh = [...added, ...replaced].map((p) => p.id);
  await replaceSameNameCoins(db, 'post', fresh, frame.sameName, frame.sameNameEvidence);
  await writeNameIdeas(db, await loadNameIdeas(db, fresh), fresh);
  await writeRising(db, 'fyp', fyp);
  if (membership !== null) await writeMembership(db, nowMs, { fyp: [...added, ...replaced], popular: [] }, [], []);
  await keepFeedHistory(db, nowMs);
  return { changed: ids.length, added: added.length, removed: left.length, wrote: true };
}
