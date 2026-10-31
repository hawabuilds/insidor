/**
 * THE QUICK FRAME: For You moved between full frames, by the posts that changed (Policy.rising.quickFrame).
 *
 * Its own file because it answers a different question from rising.ts. The full frame asks "which
 * posts are on For You now?" of every post in the day's window and takes 90 seconds on the service,
 * nearly all of it weighing coins for hundreds of passing posts (post-match.ts). The quick frame asks
 * "what do the posts that changed since the last frame began do to the For You on screen?" — a
 * judge's new answer, a coin's new link to a post the judge passed, the owner's call on a post, or a
 * new reading that put a post the judge passed over For You's views bar — and weighs only those.
 * ★ A READING COUNTS ONLY WHEN IT CROSSES THE BAR (bar-cross.ts, `quickFrame.barCross`; 2026-10-30,
 * "beat the runner"): until then such a post waited for a full frame, 6.5 min after the reading at the
 * median (48 h to 30 Oct). Readings land every few seconds, so a post counts once — over the bar now, not over it
 * at the cursor — only if the judge passed it, it is inside the window and off For You, and at most
 * `barCross.maxPosts` a frame; the gap and the settle below hold as for an answer.
 *
 * What it does, in one transaction:
 *   1. the changed posts: every post with an answer filed after the cursor's answer id, every post
 *      the judge passed that a coin linked, or the owner called, after the cursor's time, every
 *      coin-first post (coin-first.ts) whose coin was picked since — the pick is what lets it in —
 *      and every passed post a reading since put over For You's views bar (bar-cross.ts);
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
 * ★ BESIDE THE FULL FRAME, NEVER UNDER IT. The project service runs this on its own, while a full
 * frame may be running (tools/railway-start.mjs): both build without a lock, then take For You's
 * one write lock (for-you-lock.ts) before they read the list as committed and write theirs, and the
 * full frame leaves every post that changed since it began as this frame placed it.
 *
 * ★ WHEN. `quickDue` says so: something changed, and either every yes since the cursor already has
 * its kind answer (`kindsInSkipsWait`: the instant coin path asks both questions in one pass, so its
 * post is ready seconds after the launch's answer), or the answers have been quiet for `settleMs` (a
 * pass files its kind answers after its yeses, so a post is not shown between the two) and the last
 * quick frame was at least `minGapMs` ago.
 *
 * What breaks if changed carelessly: the cursor. It is read BEFORE a frame starts, and the next quick
 * frame looks only past it; read after, an answer filed while a frame ran would be in neither.
 */


import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { PgFeedRejectionRepo, type Db } from '@insidor/store';

import { recordAdmitted } from './coin-first.ts';
import { beyondCap } from './late-no-coin.ts';
import { loadMembership, writeMembership } from './feed-members.ts';
import { keepFeedHistory } from './feed-history.ts';
import { changedPosts, lockForYou, type QuickCursor } from './for-you-lock.ts';
import { loadNameIdeas, writeNameIdeas } from './post-match.ts';
import { onePolicy, type AnswerPolicies } from './judge-cutoff.ts';
import { buildRising, forYouBarCheck, kindDetail, loadCandidates, mergeForYou, varied, writeRising, type WireRisingPost } from './rising.ts';
import { barCrossers } from './bar-cross.ts';
import { replaceSameNameCoins } from './same-name.ts';
import type { WireCoinLink } from './wire.ts';

export { changedPosts, mergeForYou, type QuickCursor };

/** The spark's window, as the full frame draws it (main.ts SPARK_WINDOW_MS). A presentation bound. */
const SPARK_WINDOW_MS = 30 * 60_000;
/** The newest links looked at for a passed post: a few minutes of launches. */
const RECENT_LINKS = 200;

/**
 * The yeses filed past the cursor: how many, and how many of them still wait for their kind answer.
 * A kind answer is a later `post-kind…` row (a held kind, or the not-a-meme hold) or the kind
 * question's note on that very answer (internal.kind_asked, 0095: OTHER files no row of its own).
 */
export interface KindsSince {
  readonly yeses: number;
  readonly awaitingKind: number;
}

/** The cursor now; when the newest answer was filed; the newest link to a passed post; the newest owner call on a post; and, past the cursor asked about, its yeses' kinds (null: not asked, or not readable). */
export interface QuickProbe extends QuickCursor {
  readonly answerAtMs: number | null;
  readonly linkAtMs: number | null;
  readonly callAtMs: number | null;
  /** The newest pick of a coin-first post (0116); absent or null when none or not readable. */
  readonly pickAtMs?: number | null;
  /** The newest pick change on a post For You shows (for-you-lock.ts `pickChanged`); absent or null when none or not asked. */
  readonly cardPickAtMs?: number | null;
  readonly kinds?: KindsSince | null;
  /** Past the cursor asked about, how many passed posts a reading put over For You's views bar (bar-cross.ts); absent or null when not asked or not readable. */
  readonly crossers?: number | null;
}

const ms = (v: Date | string | null | undefined): number | null => (v === null || v === undefined ? null : new Date(v).getTime());

/** The yeses past `afterAnswerId` and their kind answers; null when the read fails (0095 not applied, say): no shortcut, the settle holds. */
async function kindsSince(db: Db, afterAnswerId: number): Promise<KindsSince | null> {
  try {
    const rows = await db.query<{ yeses: string | number; awaiting: string | number }>(
      `select count(*) as yeses,
              count(*) filter (where not exists (select 1 from internal.post_judgement k
                                                  where k.item_id = j.item_id and k.prompt_id like 'post-kind%' and k.id > j.id)
                                 and not exists (select 1 from internal.kind_asked a
                                                  where a.item_id = j.item_id and a.answer_judged_at = j.judged_at)) as awaiting
         from internal.post_judgement j
        where j.id > $1 and j.prompt_id not like 'post-kind%' and j.coinable`,
      [afterAnswerId],
    );
    return { yeses: Number(rows[0]?.yeses ?? 0), awaitingKind: Number(rows[0]?.awaiting ?? 0) };
  } catch {
    return null;
  }
}

/** A few index reads: cheap enough to ask every few seconds. Times are the database's, never this host's. With a cursor, its yeses' kinds and the posts a reading put over the bar too. */
export async function readProbe(db: Db, since: QuickCursor | null = null, policy: Policy = DEFAULT_POLICY): Promise<QuickProbe> {
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
  const answerId = r?.answer_id === null || r?.answer_id === undefined ? 0 : Number(r.answer_id);
  return {
    answerId,
    atMs: ms(r?.now) ?? 0,
    answerAtMs: ms(r?.answer_at),
    linkAtMs: ms(r?.link_at),
    callAtMs: ms(r?.call_at),
    pickAtMs: await coinFirstPickAt(db),
    cardPickAtMs: policy.rising.quickFrame.pickChange ? await cardPickAt(db) : null,
    kinds: since === null || answerId <= since.answerId ? null : await kindsSince(db, since.answerId),
    crossers: since === null ? null : await crossersSince(db, since, policy),
  };
}

/** How many passed posts a reading put over For You's bar past the cursor; null when the read fails: no frame for it, the full frame still has them. */
async function crossersSince(db: Db, since: QuickCursor, policy: Policy): Promise<number | null> {
  try {
    return (await barCrossers(db, since.atMs, forYouBarCheck(policy))).length;
  } catch {
    return null;
  }
}

/** When a post For You shows last had its pick changed (internal.coin_pick_change's time index); null when none. */
async function cardPickAt(db: Db): Promise<number | null> {
  const rows = await db.query<{ at: Date | string | null }>(
    `select max(ch.changed_at) as at
       from (select subject_id, changed_at from internal.coin_pick_change
              where subject_kind = 'post' and mode = 'live' order by changed_at desc limit $1) ch
       join public.rising_row r on r.feed_id = 'fyp' and r.item_id = ch.subject_id`,
    [RECENT_LINKS],
  );
  return ms(rows[0]?.at);
}

/** When a coin-first post's coin was last picked (0113, 0116); null when none, or before 0116 (looked up, never failed into). */
async function coinFirstPickAt(db: Db): Promise<number | null> {
  const present = await db.query<{ t: string | null }>(`select to_regclass('internal.coin_first_post')::text as t`);
  if ((present[0]?.t ?? null) === null) return null;
  const rows = await db.query<{ at: Date | string | null }>(
    `select max(p.decided_at) as at from internal.coin_first_post c
       join internal.post_coin_pick p on p.item_id = c.item_id and p.outcome = 'picked'
      where c.launched_at > now() - interval '1 day'`,
  );
  return ms(rows[0]?.at);
}

/** Whether every yes past the cursor has its kind answer (and there is one): a post is ready to show now. */
export const kindsAllIn = (probe: QuickProbe): boolean => probe.kinds !== undefined && probe.kinds !== null && probe.kinds.yeses > 0 && probe.kinds.awaitingKind === 0;

/** Whether a quick frame should run now (the header's conditions), given the last frame's cursor. */
export function quickDue(cursor: QuickCursor | null, lastQuickAtMs: number | null, probe: QuickProbe, nowMs: number, p: Policy = DEFAULT_POLICY): boolean {
  const q = p.rising.quickFrame;
  if (!q.on || cursor === null) return false;
  const changed = probe.answerId > cursor.answerId || (probe.linkAtMs ?? 0) > cursor.atMs || (probe.callAtMs ?? 0) > cursor.atMs || (probe.pickAtMs ?? 0) > cursor.atMs || (probe.cardPickAtMs ?? 0) > cursor.atMs || (probe.crossers ?? 0) > 0;
  if (!changed) return false;
  /* ★ Every yes has its kind: nothing can show between its two answers, so no wait and no gap. */
  if (q.kindsInSkipsWait && kindsAllIn(probe)) return true;
  if (lastQuickAtMs !== null && nowMs - lastQuickAtMs < q.minGapMs) return false;
  return probe.answerAtMs === null || probe.atMs - probe.answerAtMs >= q.settleMs;
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
  const ids = await changedPosts(db, cursor, forYouBarCheck(policy), policy.rising.quickFrame.pickChange);
  if (ids.length === 0) return { changed: 0, added: 0, removed: 0, wrote: false };
  const changed = new Set(ids);
  const membership = await loadMembership(db, nowMs - policy.rising.windowMs);
  const frame = await buildRising(db, nowMs, await committedStoryCoins(db), SPARK_WINDOW_MS, policy, membership === null ? null : { ...membership, refresh: [] }, answers, ids);

  /* ★ Built; now the one right to write For You, and For You as committed under it (for-you-lock.ts). */
  await lockForYou(db);
  const showing = (await db.query<{ item_id: string; payload: WireRisingPost }>(`select item_id, payload from public.rising_row where feed_id = 'fyp' order by position`)).map((r) => r.payload);
  const sinceMs = (nowMs - policy.rising.windowMs) as Millis;
  const mergedIds = [...new Set([...showing.map((p) => p.id), ...frame.fyp.map((p) => p.id)])];
  /* Uncredited too: a late post (late-no-coin.ts) has no lane's credit and must still be found here. */
  const rows = await loadCandidates(db, sinceMs, mergedIds, mergedIds, null, mergedIds);
  const rowAt = new Map(rows.map((r) => [r.item_id, new Date(r.posted_at ?? r.first_seen_at).getTime()] as const));
  /* A post a huge account just shared is counted from the share, as the full frame counts it (resurfaced.ts). */
  const at = (p: WireRisingPost): number => Math.max(rowAt.get(p.id) ?? p.postedAt.at ?? 0, p.sharedBy?.at.at ?? 0);
  const merged = mergeForYou(showing, changed, frame.fyp, at);
  const cards = merged.map((post) => ({ at: at(post), post }));
  const variedAll = await varied(db, cards, rows, policy);
  const fyp = variedAll.slice(0, policy.rising.maxRows).map((c) => c.post);
  /* ★ The late route's posts the cut left under the list join For You's list all the same (late-no-coin.ts). */
  const cutHere = beyondCap(variedAll.map((c) => c.post), policy.rising.maxRows, frame.late ?? new Set(), membership?.fyp ?? new Set());
  const lateJoins = [...cutHere, ...(frame.lateJoins ?? []).filter((p) => !cutHere.some((c) => c.id === p.id))];

  const before = new Set(showing.map((p) => p.id));
  const after = new Set(fyp.map((p) => p.id));
  const added = fyp.filter((p) => !before.has(p.id));
  const left = showing.filter((p) => !after.has(p.id));
  const replaced = fyp.filter((p) => before.has(p.id) && changed.has(p.id));
  if (added.length === 0 && left.length === 0 && replaced.length === 0 && lateJoins.length === 0) return { changed: ids.length, added: 0, removed: 0, wrote: false };

  /* Why a changed post that was showing left; one pushed off by the cut or the variety rule left for no failing of its own. */
  await new PgFeedRejectionRepo(db).record(left.flatMap((p) => {
    const why = changed.has(p.id) ? frame.whyNot.get(p.id) : undefined;
    return why === undefined ? [] : [{ kind: 'post' as const, id: p.id, reason: why, detail: kindDetail(frame.heldBy.get(p.id)) }];
  }));
  const fresh = [...added, ...replaced, ...lateJoins].map((p) => p.id);
  await replaceSameNameCoins(db, 'post', fresh, frame.sameName, frame.sameNameEvidence);
  await writeNameIdeas(db, await loadNameIdeas(db, fresh), fresh);
  await writeRising(db, 'fyp', fyp);
  if (membership !== null) await writeMembership(db, nowMs, { fyp: [...added, ...replaced, ...lateJoins], popular: [] }, [], []);
  await recordAdmitted(db, added.filter((p) => frame.coinFirst?.has(p.id) === true).map((p) => p.id), nowMs);
  await keepFeedHistory(db, nowMs);
  return { changed: ids.length, added: added.length, removed: left.length, wrote: true };
}
