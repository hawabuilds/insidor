/**
 * THE OWNER'S MISSED POSTS AS A STANDING TEST: every post he pasted (internal.missed_post, done),
 * replayed through today's settings gate by gate — found, judged, over the views bar, shown before
 * its coin — and, for the re-tune, which of them a candidate judge passes.
 *
 * Its own module, apart from the CLI (tools/missed-replay.ts), because two callers need it: the
 * owner's table, and the re-tune's regression gate (tools/retune.ts), which calls
 * `missedPostsPassing` with the block it is testing. One loader, so the gate and the table read the
 * same posts with the same pictures.
 *
 * ★ EACH GATE IS THE LIVE GATE'S OWN CODE. Found: core's recall model (`verdict`) on today's
 * measured settings (services/runner/src/work/discovery-settings.ts) and core's outage check on the
 * stored pass record. Judged: the stored answer held to `postScoreReason`, or a fresh ask through
 * tools/lib/pass-rates.ts — the live question, one post a call, the kind question after. Bar:
 * `clearsReachBar` at the short-video scale for a short-video source. Nothing here re-implements a rule.
 *
 * ★ WHAT WE DO NOT KNOW IS SAID, NOT FILLED. A missed post was read once, hours or days after it
 * was made: its likes and views over time are not known. Found-or-not then rests on the recall
 * model's growth curve (its stated assumption), and a views bar is judged only on readings made
 * inside the feed's own window; a reading days later says "not known", never "yes".
 *
 * What breaks if changed carelessly: `missedPostsPassing` must grade with gradePosts exactly as the
 * re-tune grades gold. A second grading path would let the gate and the gold rate disagree on
 * the same judge.
 */

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import { clearsReachBar, type ReachLevel } from '../../core/src/qualify/reach-bar.ts';
import { postScoreReason } from '../../core/src/qualify/post-score.ts';
import { postWindow, type Outage, type PostWindow } from '../../core/src/learning/outage.ts';
import { searchFilter, verdict, type DiscoverySettings } from '../../core/src/sources/recall.ts';
import type { Db } from '../../store/src/index.ts';
import { pictureOf } from '../../services/project/src/db.ts';
import { gradePosts, type EvalPost, type EvalRow, type GradeOptions, type Usage } from './pass-rates.ts';

const MS_PER_MINUTE = 60_000;
/* The reply heuristic the runner's diagnosis uses (work/missed-posts.ts): a post opening with a mention. */
const REPLY_OPENING = /^@\w/;

/** One missed post with everything the replay asks of it, as stored. */
export interface MissedReplayPost {
  readonly rowId: number;
  readonly url: string;
  readonly itemId: string;
  readonly source: string;
  readonly postedAtMs: number | null;
  readonly text: string;
  readonly imageUri: string | null;
  readonly lang: string | null;
  readonly hasMedia: boolean;
  readonly isReply: boolean;
  readonly isRebroadcast: boolean;
  /** Likes at the one reading we have, and when. */
  readonly approvals: number | null;
  readonly approvalsAtMs: number | null;
  /** Every view reading we hold, oldest first. */
  readonly reach: readonly ReachLevel[];
  /** Held before the paste by a catch-all lane: which, and when. */
  readonly foundBy: { readonly lane: string; readonly atMs: number } | null;
  readonly firstSeenAtMs: number;
  /** The judge's latest stored answer; null when never asked. */
  readonly judgement: { readonly coinable: boolean; readonly confidence: number; readonly lookedAt: 'text' | 'picture' | 'videoFrame'; readonly proposedName: string | null; readonly judgedAtMs: number } | null;
  /** Its coin: the one the owner gave (gold addition), else the one the runner found; null when none is recorded. */
  readonly coin: { readonly address: string; readonly name: string | null; readonly launchedAtMs: number | null; readonly from: 'owner' | 'search' } | null;
  readonly diagnosis: string | null;
}

const ms = (d: Date | null | undefined): number | null => (d === null || d === undefined ? null : d.getTime());

/** Every missed post read so far (`done`), oldest paste first. */
export async function loadMissedPosts(db: Db): Promise<readonly MissedReplayPost[]> {
  const rows = await db.query<{
    id: string; url: string; item_id: string; source: string; posted_at: Date | null; body: string; media: unknown; lang: string | null;
    rebroadcast: boolean; approvals: number | null; approvals_at: string | null; first_seen_at: Date; lane: string | null; found_at: Date | null;
    diagnosis: string | null; coin_mint: string | null; coin_name: string | null; coin_launched: Date | null; m_coin: string | null; m_coin_at: Date | null;
  }>(
    `select m.id::text, m.url, m.item_id, i.source, coalesce(m.posted_at, i.posted_at) as posted_at, i.body, i.media, i.lang,
            i.rebroadcast_of is not null as rebroadcast,
            (i.counters #>> '{approval,value}')::float8 as approvals, i.counters #>> '{approval,observedAt}' as approvals_at,
            i.first_seen_at, f.lane, f.found_at, m.diagnosis,
            g.coin_mint, coalesce(c.name, g.coin_name) as coin_name, coalesce(c.launched_at, g.launched_at) as coin_launched,
            m.coin_address as m_coin, m.first_coin_at as m_coin_at
       from internal.missed_post m
       join public.item i on i.item_id = m.item_id
       left join internal.item_found_by f on f.item_id = m.item_id and f.lane in ('all', 'media', 'slow', 'watch')
       left join internal.gold_addition g on g.item_id = m.item_id and g.source = 'missed'
       left join public.coin_name c on c.address = g.coin_mint
      where m.status = 'done'
      order by m.added_at, m.id`,
  );
  const ids = rows.map((r) => r.item_id);
  const reach = ids.length === 0 ? [] : await db.query<{ item_id: string; at: Date; v: number }>(
    `select item_id, observed_at as at, value::float8 as v from public.observation where item_id = any($1::text[]) and kind = 'reach' order by observed_at`,
    [ids],
  );
  const judged = ids.length === 0 ? [] : await db.query<{ item_id: string; coinable: boolean; confidence: number; looked_at: 'text' | 'picture' | 'videoFrame'; proposed_name: string | null; judged_at: Date }>(
    `select distinct on (item_id) item_id, coinable, confidence, looked_at, proposed_name, judged_at
       from internal.post_judgement where item_id = any($1::text[]) order by item_id, judged_at desc, id desc`,
    [ids],
  );
  return rows.map((r): MissedReplayPost => {
    const j = judged.find((x) => x.item_id === r.item_id);
    const media = Array.isArray(r.media) ? r.media : [];
    return {
      rowId: Number(r.id),
      url: r.url,
      itemId: r.item_id,
      source: r.source,
      postedAtMs: ms(r.posted_at),
      text: r.body,
      imageUri: pictureOf(r.media)?.uri ?? null,
      lang: r.lang,
      hasMedia: media.length > 0,
      isReply: REPLY_OPENING.test(r.body.trim()),
      isRebroadcast: r.rebroadcast,
      approvals: r.approvals === null ? null : Number(r.approvals),
      approvalsAtMs: r.approvals_at === null ? null : Number(r.approvals_at),
      reach: reach.filter((x) => x.item_id === r.item_id).map((x) => ({ atMs: x.at.getTime(), reach: Number(x.v) })),
      foundBy: r.lane === null || r.found_at === null ? null : { lane: r.lane, atMs: r.found_at.getTime() },
      firstSeenAtMs: r.first_seen_at.getTime(),
      judgement: j === undefined ? null : { coinable: j.coinable, confidence: Number(j.confidence), lookedAt: j.looked_at, proposedName: j.proposed_name, judgedAtMs: j.judged_at.getTime() },
      coin:
        r.coin_mint !== null
          ? { address: r.coin_mint, name: r.coin_name, launchedAtMs: ms(r.coin_launched), from: 'owner' }
          : r.m_coin !== null
            ? { address: r.m_coin, name: null, launchedAtMs: ms(r.m_coin_at), from: 'search' }
            : null,
      diagnosis: r.diagnosis,
    };
  });
}

/* ── the re-tune's gate ──────────────────────────────────────────────── */

export interface MissedPassOptions {
  readonly env: Record<string, string | undefined>;
  readonly meter: Meter;
  /** As the re-tune grades: one Message Batch at half price. Default true. */
  readonly batch?: boolean;
  /** The coined pictures for the boost, as gradePosts takes them; null leaves the boost out. */
  readonly coined: GradeOptions['coined'];
  /** Only these items (e.g. the held-back half); all missed posts when absent. */
  readonly only?: readonly string[];
  /** Refuse to start when the line cannot cover it (gradePosts' LineTooShort). Default true. */
  readonly mustFit?: boolean;
  readonly vectors?: GradeOptions['vectors'];
}

export interface MissedPassResult {
  /** Each post graded: `passes` is the live rule's answer (postScore, the boost, the kind question). */
  readonly rows: readonly EvalRow<'missed'>[];
  readonly passed: number;
  /** Posts answered; an unanswered post is in `unanswered`, never counted as a fail. */
  readonly tested: number;
  readonly unanswered: readonly string[];
  readonly used: Usage;
}

/** The missed posts as gradePosts takes them. */
export function missedEvalPosts(posts: readonly MissedReplayPost[]): EvalPost<'missed'>[] {
  return posts.map((m) => ({ group: 'missed' as const, id: m.itemId, kind: 'missed', text: m.text, imageUri: m.imageUri, ...(m.coin === null ? {} : { coinRef: m.coin.address }) }));
}

/**
 * Which of the owner's missed posts a candidate judge passes: `examples` is the learned block
 * under test, or null for the written rules alone. Paid, on whatever meter is passed — the
 * re-tune's learning-book meter.
 */
export async function missedPostsPassing(db: Db, examples: string | null, o: MissedPassOptions): Promise<MissedPassResult> {
  const all = await loadMissedPosts(db);
  const posts = o.only === undefined ? all : all.filter((p) => o.only?.includes(p.itemId));
  if (posts.length === 0) return { rows: [], passed: 0, tested: 0, unanswered: [], used: { calls: 0, pictures: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, inputWithPicture: 0, inputWithout: 0 } };
  const { rows, used } = await gradePosts(missedEvalPosts(posts), { env: o.env, meter: o.meter, examples, batch: o.batch ?? true, mustFit: o.mustFit ?? true, coined: o.coined, ...(o.vectors === undefined ? {} : { vectors: o.vectors }) });
  const answered = rows.filter((r) => r.coinable !== null);
  return { rows, passed: answered.filter((r) => r.passes).length, tested: answered.length, unanswered: rows.filter((r) => r.coinable === null).map((r) => r.id), used };
}

/* ── the replay ───────────────────────────────────────────────────────── */

export interface ReplayContext {
  readonly settings: DiscoverySettings | null;
  readonly outages: readonly Outage[] | null;
  /** Minutes from posting to shown, for posts the main lanes found (median, last 12 h); null unmeasured. */
  readonly postToShownMin: number | null;
  /** The youngest a main-lane pass returns a post (median, minutes): the search's own lag. */
  readonly searchLagMin: number | null;
  /** The source whose views are counted at the short-video scale. */
  readonly shortVideoSources: readonly string[];
  readonly policy?: Policy;
}

export type Gate = { readonly ok: boolean | null; readonly said: string };

/**
 * What the search's own passes say about a post made while it ran: how many main-lane passes asked
 * for posts of its age, and the lowest likes among the posts those passes did return — the floor
 * then was at most that. A pass that asked for its age and did not return it says it was under the
 * floor then (the tool reads the passes; see tools/missed-replay.ts `passEvidence`).
 */
export interface PassEvidence {
  readonly mainPasses: number;
  readonly floorThenAtMost: number | null;
}

export interface ReplayRow {
  readonly post: MissedReplayPost;
  readonly window: PostWindow | null;
  /** Was discovery running when the post could have been found? */
  readonly running: Gate & { readonly why: 'up' | 'partly' | 'down' | 'not_yet' | 'unknown' };
  /** Would today's settings return it, had discovery been running? */
  readonly found: Gate & { readonly lane: string | null; readonly minutes: number | null; readonly why: string };
  readonly judge: Gate & { readonly asked: 'stored' | 'fresh' | 'never' };
  readonly bar: Gate;
  /** Would it have been shown before its coin launched, if every gate passed? */
  readonly beforeLaunch: Gate;
}

const round = (n: number) => Math.round(n);
const hm = (min: number): string => (min < 120 ? `${round(min)} min` : min < 2_880 ? `${(min / 60).toFixed(1)} h` : `${round(min / 1_440)} days`);
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

/** The replay of one post through today's gates. `fresh` is a judge answer asked now, for a post never judged. */
export function replayOne(m: MissedReplayPost, ctx: ReplayContext, fresh: EvalRow<'missed'> | null, evidence: PassEvidence | null = null): ReplayRow {
  const P = ctx.policy ?? DEFAULT_POLICY;
  const s = ctx.settings;
  const slowReach = s?.lanes.find((l) => l.lane === 'slow')?.reachMin ?? 0;
  const w = ctx.outages === null || m.postedAtMs === null ? null : postWindow(ctx.outages, m.postedAtMs, slowReach, P);
  const short = ctx.shortVideoSources.includes(m.source);

  /* 0. Running. */
  const running: ReplayRow['running'] =
    w === null
      ? { ok: null, why: 'unknown', said: 'the pass record could not be read' }
      : w.down
        ? w.beforeFirstPass
          ? { ok: false, why: 'not_yet', said: 'our search had not started yet (first pass 2026-10-12 22:12 UTC)' }
          : { ok: false, why: 'down', said: `down from ${utc(w.postedIn?.fromMs ?? 0)} to ${w.postedIn?.toMs === null || w.postedIn?.toMs === undefined ? 'now' : utc(w.postedIn.toMs)} UTC: no pass in its first ${w.windowMin} min${w.slowCoveredMin > 0 ? `; the slow lane was up only for the last ${round(w.slowCoveredMin)} of its ${round(w.slowReachMin)}-min reach` : ''}` }
        : w.coveredMin < w.windowMin
          ? { ok: true, why: 'partly', said: `up for ${round(w.coveredMin)} of its first ${w.windowMin} min (an outage ended inside them)` }
          : { ok: true, why: 'up', said: 'running' };

  /* 1. Found, by today's settings. */
  let found: ReplayRow['found'];
  const facts = { approvals: m.approvals ?? 0, lang: m.lang, hasMedia: m.hasMedia, isReply: m.isReply, isRebroadcast: m.isRebroadcast };
  const readAge = m.postedAtMs === null || m.approvalsAtMs === null ? null : (m.approvalsAtMs - m.postedAtMs) / MS_PER_MINUTE;
  const curve = `Likes over time not known (one reading: ${m.approvals?.toLocaleString('en') ?? '—'} likes${readAge === null ? '' : ` at ${hm(readAge)}`}); the model assumes the fitted growth curve`;
  const main = s?.lanes.find((l) => l.lane === 'all') ?? null;
  if (short) {
    found = { ok: null, lane: 'watch', minutes: null, said: 'the short-video search asks watched tags in turn; not modelled here', why: 'watch' };
  } else if (s === null) {
    found = { ok: null, lane: null, minutes: null, said: "today's settings could not be measured", why: 'unsure' };
  } else {
    const filter = searchFilter(facts, null, s);
    const v = verdict(facts, s);
    const lag = ctx.searchLagMin ?? 0;
    const sawIt = evidence !== null && evidence.mainPasses > 0 && m.foundBy === null && running.ok === true;
    if (filter !== null) {
      found = { ok: false, lane: null, minutes: null, said: `today's query leaves it out (${filter}${filter === 'language' ? ` '${m.lang}'` : ''})`, why: `not_in_search:${filter}` };
    } else if (sawIt && main !== null && evidence.floorThenAtMost !== null && main.floor >= evidence.floorThenAtMost) {
      /* The search asked for it and did not return it: under the floor then, and today's floor is no lower. */
      found = {
        ok: false, lane: null, minutes: null, why: 'under_floor_seen',
        said: `by the record: ${evidence.mainPasses} main-lane pass${evidence.mainPasses === 1 ? '' : 'es'} asked for posts its age and did not return it, so it had fewer likes than the floor then (at most ${evidence.floorThenAtMost}); today's main floor is ${main.floor}, no lower. The slow lane (floor ${s.lanes.find((l) => l.lane === 'slow')?.floor ?? '—'}, reaching ${round(slowReach)} min) did not return it either. The model alone would say yes at ${round(Math.max(v.kind === 'caught' ? v.delayMin : 0, lag))} min: it overstates early likes for a slow starter`,
      };
    } else if (v.kind === 'caught') {
      const minutes = Math.max(v.delayMin, lag);
      found = { ok: true, lane: v.lane, minutes, said: `by the model: ${v.lane} lane about ${round(minutes)} min after posting (model ${round(v.delayMin)} min; the search returns nothing younger than ${lag.toFixed(1)} min). ${curve}`, why: 'caught' };
    } else {
      found = { ok: false, lane: null, minutes: null, said: `by the model: ${v.reason}. ${curve}`, why: v.reason };
    }
  }

  /* 2. Judged. */
  let judge: ReplayRow['judge'];
  if (m.judgement !== null) {
    const said = postScoreReason(m.judgement, P);
    const j = m.judgement;
    judge = { ok: said === 'passes', asked: 'stored', said: `${said === 'passes' ? '' : `${said}; `}said ${j.coinable ? 'meme' : 'not a meme'} at ${j.confidence}, name ${j.proposedName === null ? '—' : `"${j.proposedName}"`}, looked at ${j.lookedAt}, ${utc(j.judgedAtMs)} UTC (stored)` };
  } else if (fresh !== null && fresh.coinable !== null) {
    judge = { ok: fresh.passes, asked: 'fresh', said: `said ${fresh.coinable ? 'meme' : 'not a meme'} at ${fresh.confidence}, name ${fresh.name === null ? '—' : `"${fresh.name}"`}, looked at ${fresh.lookedAt} (asked now, live rules, kind question after)` };
  } else {
    judge = { ok: null, asked: 'never', said: 'never judged; run with --judge to ask the live judge on the learning book' };
  }

  /* 3. The views bar, on readings inside the feed's window only. */
  const scale = short ? P.rising.shortVideoReachScale : 1;
  let bar: Gate;
  if (m.postedAtMs === null) bar = { ok: null, said: 'post time not known' };
  else {
    const inWindow = m.reach.filter((r) => r.atMs - (m.postedAtMs ?? 0) <= P.rising.windowMs);
    const last = m.reach[m.reach.length - 1];
    const fyp = P.rising.fypMinReach * scale;
    if (inWindow.length === 0) {
      bar = { ok: null, said: last === undefined ? 'no views reading' : `the only reading (${last.reach} views) came ${hm((last.atMs - m.postedAtMs) / MS_PER_MINUTE)} after posting, past the feed's ${hm(P.rising.windowMs / MS_PER_MINUTE)} window` };
    } else {
      const ok = clearsReachBar('fyp', inWindow, m.postedAtMs, P, scale);
      const top = inWindow.reduce((a, r) => Math.max(a, r.reach ?? 0), 0);
      bar = { ok, said: `${ok ? 'clears' : 'under'} For You's ${fyp.toLocaleString('en')}${short ? ' (short-video scale)' : ''}: ${top.toLocaleString('en')} views at ${hm(((inWindow[inWindow.length - 1]?.atMs ?? 0) - m.postedAtMs) / MS_PER_MINUTE)}; when it crossed is not known (no early readings)` };
    }
  }

  /* 4. Shown before its coin launched, if every gate passed: the timing alone. */
  let beforeLaunch: Gate;
  const coin = m.coin;
  if (coin === null || coin.launchedAtMs === null) beforeLaunch = { ok: null, said: 'no coin of its own recorded for this post' };
  else if (m.postedAtMs === null) beforeLaunch = { ok: null, said: 'post time not known' };
  else {
    const launchMin = (coin.launchedAtMs - m.postedAtMs) / MS_PER_MINUTE;
    const coinSaid = `${coin.name ?? coin.address.slice(0, 6)} (${coin.address.slice(0, 6)}…) launched ${utc(coin.launchedAtMs)} UTC`;
    const earliest = Math.max(found.minutes ?? 0, ctx.postToShownMin ?? 0);
    if (launchMin <= 0) beforeLaunch = { ok: false, said: `${coinSaid}, before this post: it cannot be first` };
    else if (earliest >= launchMin) beforeLaunch = { ok: false, said: `${coinSaid}, ${hm(launchMin)} after posting; our earliest show is about ${round(earliest)} min after posting: too late even if every gate passed` };
    else {
      const gates = [found.ok, judge.ok, bar.ok];
      const blocked = gates.includes(false);
      beforeLaunch = {
        ok: blocked ? false : gates.every((g) => g === true) ? true : null,
        said: `${coinSaid}, ${hm(launchMin)} after posting; we show a found post about ${round(earliest)} min after posting at the earliest, so in time IF every gate passed${blocked ? ', and one did not' : bar.ok === true ? '' : ' and it cleared the views bar before the launch (not known)'}`,
      };
    }
  }
  return { post: m, window: w, running, found, judge, bar, beforeLaunch };
}
