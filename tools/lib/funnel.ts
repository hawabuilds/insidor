/**
 * THE MEMEABLE VIRAL FUNNEL, PER DAY (the owner, 2026-10-18: "add the memeable viral funnel to the
 * 20:00 table, so I can watch 'never found' go down and 'shown early' go up"). Every memeable post
 * posted that UTC day is put at the first step that lost it:
 *
 *   never found      no search lane ever held it (a coin link or the missed-post tool is not finding it)
 *   found too late   found after its first coin, or already past 20% of the viral line when found
 *   views bar        For You's views bar (core `clearsReachBar`) cleared only at or after its deadline, or never
 *   judge said no    no answer before the deadline, or none that passed (core `postScoreReason`, held kinds)
 *   other            passed both, but For You did not show it before the deadline (another gate, or late)
 *   shown early      on For You before its deadline
 *
 * The deadline is the post's first coin or its first reading at `EARLY_SHARE` of the viral line,
 * whichever came first: "early" means before people coined it and before it was a fifth of viral.
 *
 * MEMEABLE here is the scratch funnel's set (2026-10-18), on posts we hold (public.item, observed,
 * X and TikTok): the owner's meme label, a gold sheet, the owner's missed list, or a coin launched
 * `lateMs` or more after it by an account that does not coin its own posts (store `coinedLate`)
 * when the post also crossed the viral line. ★ The owner's "Not a meme" wins over all of it: such a
 * post is left out, as the scorecard's coverage leaves it out.
 *
 * Its own file beside scorecard.ts because it reads a different set (posted, not shown) and replays
 * each gate in time, and the scorecard's coverage number is the last column of this one: the
 * funnel says where the rest were lost. Free and read-only, stored rows only.
 *
 * ★ EACH GATE IS THE LIVE GATE'S OWN CODE, replayed on stored rows: the views bar is core's with
 * today's policy (the short-video scale on TikTok); each answer is held to the cutoff of the block
 * applied when it was given and of the model that gave it (services/project judge-cutoff.ts), with
 * the kind label the kind question filed within `KIND_AFTER_MS` of it. Not replayed, said: the
 * picture boost and other accounts' crypto talk (both can only add passes, so "judge said no" may
 * hold a post a boost would have let through), and the projector's own timing ("other").
 *
 * What breaks if changed carelessly: the order of the steps. A post is counted at the FIRST step
 * that lost it; testing the judge before the views bar would move posts between the two columns
 * with nothing about the feed changing.
 */

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { clearsReachBar, heldKind, postScoreReason, type ReachLevel } from '../../core/src/index.ts';
import { answerPolicies, type AnswerPolicies } from '../../services/project/src/judge-cutoff.ts';
import { PgCoinModelRepo, type Db } from '../../store/src/index.ts';
import { EARLY_SHARE, VIRAL_LINE } from './scorecard.ts';

/** A reading this long after the find stands for "the views when found" (the scratch funnel's half hour). */
export const AT_FIND_MS = 30 * 60_000;
/** The kind question is asked right after the first answer; a kind label filed this long after it is that answer's. */
export const KIND_AFTER_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
/** The lane that is a coin's link back to its post: being linked from a coin is not being found. */
const COIN_LINK_LANE = 'coin_link';
const SHORT_VIDEO_SOURCE = 'tiktok';

export const STEPS = ['never found', 'found too late', 'views bar', 'judge said no', 'other', 'shown early'] as const;
export type Step = (typeof STEPS)[number];

export interface FunnelAnswer {
  readonly atMs: number;
  readonly judgeId: string | null;
  /** A kind answer (prompt post-kind…): `proposedName` holds its label. */
  readonly kind: boolean;
  readonly coinable: boolean;
  readonly confidence: number;
  readonly lookedAt: 'text' | 'picture' | 'videoFrame';
  readonly proposedName: string | null;
}

export interface FunnelPost {
  readonly itemId: string;
  readonly source: string;
  readonly postedAtMs: number;
  /** Why it is memeable: label, gold, missed, coined. */
  readonly why: readonly string[];
  /** Every view reading, oldest first. */
  readonly reach: readonly ReachLevel[];
  /** The first time a search lane (not a coin's link) held it. */
  readonly foundAtMs: number | null;
  readonly lanes: readonly string[];
  /** The first coin launched at or after the post: linked, the owner's, the late-coin read, the missed list's. */
  readonly coinAtMs: number | null;
  readonly answers: readonly FunnelAnswer[];
  readonly shownAtMs: number | null;
}

/** One applied judge block: when, its cutoff, and the model it was chosen on. */
export interface BlockAt {
  readonly atMs: number;
  readonly cutoff: number | null;
  readonly chosenOn: string | null;
}

export interface Placed {
  readonly itemId: string;
  readonly step: Step;
  readonly detail: string;
}

const hrs = (ms: number): string => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/** The policies an answer given at `atMs` was held to: the newest block applied by then. */
export function policiesAt(blocks: readonly BlockAt[], atMs: number, base: Policy): AnswerPolicies {
  let b: BlockAt | null = null;
  for (const x of blocks) if (x.atMs <= atMs && (b === null || x.atMs > b.atMs)) b = x;
  return answerPolicies(base, { cutoff: b?.cutoff ?? null, chosenOn: b?.chosenOn ?? null });
}

/** Whether the post would have passed the judge at `t`: its newest answer by then, held to that answer's own cutoff, its kind label not held. */
export function passesAt(answers: readonly FunnelAnswer[], t: number, blocks: readonly BlockAt[], p: Policy): boolean {
  let ans: FunnelAnswer | null = null;
  for (const a of answers) if (a.atMs <= t && !a.kind && (ans === null || a.atMs >= ans.atMs)) ans = a;
  if (ans === null) return false;
  const first = ans;
  const kinds = answers.filter((a) => a.kind && a.atMs >= first.atMs && a.atMs <= Math.max(t, first.atMs + KIND_AFTER_MS)).sort((a, b) => a.atMs - b.atMs);
  const kind = kinds[kinds.length - 1]?.proposedName ?? null;
  if (heldKind(kind, p.judge.heldKinds) !== null) return false;
  return postScoreReason(first, policiesAt(blocks, first.atMs, p).of(first.judgeId), null, kind) === 'passes';
}

/** Where one memeable post was lost, or that it was shown early, by the order the header gives. */
export function place(post: FunnelPost, blocks: readonly BlockAt[], p: Policy = DEFAULT_POLICY, lines: Readonly<Record<string, number>> = VIRAL_LINE): Placed {
  const line = lines[post.source] ?? Infinity;
  const early = EARLY_SHARE * line;
  const read = post.reach.filter((r): r is { atMs: number; reach: number } => r.reach !== null).sort((a, b) => a.atMs - b.atMs);
  const t20 = read.find((r) => r.reach >= early)?.atMs ?? null;
  const deadline = Math.min(post.coinAtMs ?? Infinity, t20 ?? Infinity);
  const out = (step: Step, detail: string): Placed => ({ itemId: post.itemId, step, detail });

  const found = post.foundAtMs;
  if (found === null) return out('never found', post.lanes.length === 0 ? 'no lane held it' : `only via ${post.lanes.join(', ')}`);
  const near = read.find((r) => r.atMs >= found && r.atMs <= found + AT_FIND_MS) ?? [...read].reverse().find((r) => r.atMs <= found) ?? null;
  if (post.coinAtMs !== null && post.coinAtMs <= found) return out('found too late', `coined ${hrs(found - post.coinAtMs)} before it was found`);
  if (near !== null && near.reach >= early) return out('found too late', `${Math.round(near.reach / 1000)}k views when found (20% of the line is ${Math.round(early / 1000)}k)`);

  const scale = post.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1;
  let cleared: number | null = null;
  for (let i = 0; i < read.length && cleared === null; i++) if (clearsReachBar('fyp', read.slice(0, i + 1), post.postedAtMs, p, scale)) cleared = read[i]?.atMs ?? null;
  if (cleared === null) return out('views bar', `never cleared (most read ${Math.round(Math.max(0, ...read.map((r) => r.reach)) / 1000)}k)`);
  if (cleared >= deadline) return out('views bar', `cleared ${hrs(cleared - deadline)} after its deadline`);

  const answered = post.answers.filter((a) => !a.kind && !(a.judgeId ?? '').startsWith('rule:')).sort((a, b) => a.atMs - b.atMs)[0] ?? null;
  if (answered === null) return out('judge said no', 'never answered');
  if (answered.atMs >= deadline) return out('judge said no', `first answered ${hrs(answered.atMs - deadline)} after its deadline`);
  const times = [...post.answers.filter((a) => a.atMs < deadline).map((a) => a.atMs), Number.isFinite(deadline) ? deadline - 1 : Number.MAX_SAFE_INTEGER];
  if (!times.some((t) => passesAt(post.answers, t, blocks, p))) return out('judge said no', 'no answer before its deadline passed');

  if (post.shownAtMs === null) return out('other', 'passed both, never on For You');
  if (post.shownAtMs >= deadline) return out('other', `on For You ${hrs(post.shownAtMs - deadline)} after its deadline`);
  return out('shown early', Number.isFinite(deadline) ? `${hrs(deadline - post.shownAtMs)} before its deadline` : 'never coined or near the line');
}

export interface FunnelDay {
  readonly label: string;
  readonly n: number;
  readonly counts: Readonly<Record<Step, number>>;
}

export function funnelDay(label: string, placed: readonly Placed[]): FunnelDay {
  const counts = Object.fromEntries(STEPS.map((s) => [s, placed.filter((x) => x.step === s).length])) as Record<Step, number>;
  return { label, n: placed.length, counts };
}

/* ── the database ────────────────────────────────────────────────────────────────────────────── */

const LINKED_COINS = `
  select l.source || ':' || l.source_item_id as item_id, a.minted_at
    from internal.coin_post_link l join public.asset a on a.asset_key = l.asset_key
   where l.source || ':' || l.source_item_id = any($1::text[])
  union all
  select f.item_id, coalesce(a.minted_at, n.launched_at)
    from internal.owner_feedback f
    left join public.asset a on a.chain = 'solana' and a.address = f.coin_address
    left join public.coin_name n on n.address = f.coin_address
   where f.subject_kind = 'coin_match' and f.verdict = 'right' and f.coin_address is not null and f.item_id = any($1::text[])`;

export interface FunnelRows {
  readonly posts: readonly FunnelPost[];
  readonly blocks: readonly BlockAt[];
  /** The owner's missed posts posted in the window: their row id, the tool's diagnosis. */
  readonly missed: readonly { readonly id: number; readonly itemId: string; readonly diagnosis: string | null }[];
}

/** Every memeable post posted in [since, until), with what each gate needs. */
export async function funnelRows(db: Db, since: Date, until: Date, p: Policy = DEFAULT_POLICY, lines: Readonly<Record<string, number>> = VIRAL_LINE): Promise<FunnelRows> {
  const C = p.judge.coinModel;
  const late = await new PgCoinModelRepo(db).coinedLate({ lateMs: C.lateMs, deployerWindowMs: C.deployerWindowMs, deployerMinPosts: C.deployerMinPosts });
  const sets = await db.query<{ item_id: string; why: string }>(
    `select item_id, 'label' as why from (
       select distinct on (item_id) item_id, verdict from internal.owner_feedback
        where subject_kind = 'post' and item_id is not null and verdict in ('meme', 'not') order by item_id, created_at desc, id desc) o where verdict = 'meme'
     union all select item_id, 'gold' from internal.gold_addition where item_id is not null
     union all select item_id, 'missed' from internal.missed_post where item_id is not null and status = 'done'`,
  );
  const whyOf = new Map<string, Set<string>>();
  const add = (id: string, w: string) => whyOf.set(id, (whyOf.get(id) ?? new Set()).add(w));
  for (const r of sets) add(r.item_id, r.why);
  for (const id of late.keys()) add(id, 'coined');
  const items = await db.query<{ item_id: string; source: string; posted_at: Date; most: number | null; not_call: boolean }>(
    `select i.item_id, i.source, i.posted_at,
            (select max(o.value) from public.observation o where o.item_id = i.item_id and o.kind = 'reach') as most,
            coalesce((select o.verdict = 'not' from internal.owner_feedback o
                       where o.subject_kind = 'post' and o.item_id = i.item_id and o.verdict in ('meme', 'not')
                       order by o.created_at desc, o.id desc limit 1), false) as not_call
       from public.item i
      where i.item_id = any($1::text[]) and i.origin = 'observed' and i.source in ('x', 'tiktok')
        and i.posted_at >= $2 and i.posted_at < $3`,
    [[...whyOf.keys()], since, until],
  );
  const kept = items.filter((i) => {
    if (i.not_call) return false;
    const why = whyOf.get(i.item_id) ?? new Set();
    const viral = i.most !== null && Number(i.most) >= (lines[i.source] ?? Infinity);
    return why.has('label') || why.has('gold') || why.has('missed') || (why.has('coined') && viral);
  });
  const ids = kept.map((i) => i.item_id);
  const [reach, found, answers, shown, coins, missed, blocks] = await Promise.all([
    new PgCoinModelRepo(db).reachReadings(ids),
    db.query<{ item_id: string; lane: string; found_at: Date }>(`select item_id, lane, found_at from internal.item_found_by where item_id = any($1::text[])`, [ids]),
    db.query<{ item_id: string; judged_at: Date; judge_id: string | null; prompt_id: string | null; coinable: boolean; confidence: number; looked_at: string; proposed_name: string | null }>(
      `select item_id, judged_at, judge_id, prompt_id, coinable, confidence, looked_at, proposed_name from internal.post_judgement where item_id = any($1::text[]) order by judged_at, id`,
      [ids],
    ),
    db.query<{ item_id: string; first_shown_at: Date }>(`select item_id, first_shown_at from public.feed_post where feed_id = 'fyp' and item_id = any($1::text[])`, [ids]),
    db.query<{ item_id: string; minted_at: Date | null }>(LINKED_COINS, [ids]),
    db.query<{ id: string; item_id: string; diagnosis: string | null; first_coin_at: Date | null }>(
      `select m.id::text, m.item_id, m.diagnosis, m.first_coin_at from internal.missed_post m where m.status = 'done' and m.item_id = any($1::text[]) order by m.id`,
      [ids],
    ),
    db.query<{ applied_at: Date; cutoff: string | null; model: string | null }>(
      `select applied_at, to_jsonb(v) ->> 'judge_cutoff' as cutoff, to_jsonb(v) ->> 'judge_cutoff_model' as model
         from internal.judge_examples_version v where applied and applied_at is not null order by applied_at`,
    ),
  ]);
  const by = <R extends { item_id: string }>(rows: readonly R[]) => {
    const m = new Map<string, R[]>();
    for (const r of rows) m.set(r.item_id, [...(m.get(r.item_id) ?? []), r]);
    return m;
  };
  const foundBy = by(found);
  const answersBy = by(answers);
  const coinsBy = by(coins);
  const missedBy = by(missed);
  const shownBy = new Map(shown.map((s) => [s.item_id, s.first_shown_at.getTime()] as const));
  const posts = kept.map((i): FunnelPost => {
    const posted = new Date(i.posted_at).getTime();
    const lanes = foundBy.get(i.item_id) ?? [];
    const search = lanes.filter((f) => f.lane !== COIN_LINK_LANE).map((f) => new Date(f.found_at).getTime());
    const coinTimes = [
      ...(coinsBy.get(i.item_id) ?? []).map((c) => (c.minted_at === null ? null : new Date(c.minted_at).getTime())),
      late.get(i.item_id)?.firstLateAt.getTime() ?? null,
      ...(missedBy.get(i.item_id) ?? []).map((m) => (m.first_coin_at === null ? null : new Date(m.first_coin_at).getTime())),
    ].filter((t): t is number => t !== null && Number.isFinite(t) && t >= posted);
    return {
      itemId: i.item_id,
      source: i.source,
      postedAtMs: posted,
      why: [...(whyOf.get(i.item_id) ?? [])].sort(),
      reach: reach.get(i.item_id) ?? [],
      foundAtMs: search.length === 0 ? null : Math.min(...search),
      lanes: [...new Set(lanes.map((f) => f.lane))].sort(),
      coinAtMs: coinTimes.length === 0 ? null : Math.min(...coinTimes),
      answers: (answersBy.get(i.item_id) ?? []).map((a) => ({
        atMs: new Date(a.judged_at).getTime(),
        judgeId: a.judge_id,
        kind: (a.prompt_id ?? '').startsWith('post-kind'),
        coinable: a.coinable,
        confidence: Number(a.confidence),
        lookedAt: a.looked_at === 'picture' || a.looked_at === 'videoFrame' ? a.looked_at : 'text',
        proposedName: a.proposed_name,
      })),
      shownAtMs: shownBy.get(i.item_id) ?? null,
    };
  });
  return {
    posts,
    blocks: blocks.map((b) => ({ atMs: new Date(b.applied_at).getTime(), cutoff: b.cutoff === null ? null : Number(b.cutoff), chosenOn: b.model })),
    missed: missed.map((m) => ({ id: Number(m.id), itemId: m.item_id, diagnosis: m.diagnosis })),
  };
}

/* ── the table ───────────────────────────────────────────────────────────────────────────────── */

/** One row a UTC day (by posted), then the window; a row per owner missed post posted in it. */
export function funnelLines(rows: FunnelRows, since: Date, until: Date, p: Policy = DEFAULT_POLICY, lines: Readonly<Record<string, number>> = VIRAL_LINE): readonly string[] {
  const placed = new Map(rows.posts.map((x) => [x.itemId, place(x, rows.blocks, p, lines)] as const));
  const days: FunnelDay[] = [];
  for (let d = Math.floor(since.getTime() / DAY_MS) * DAY_MS; d < until.getTime(); d += DAY_MS) {
    const inDay = rows.posts.filter((x) => x.postedAtMs >= Math.max(d, since.getTime()) && x.postedAtMs < Math.min(d + DAY_MS, until.getTime()));
    days.push(funnelDay(new Date(d).toISOString().slice(0, 10), inDay.flatMap((x) => placed.get(x.itemId) ?? [])));
  }
  days.push(funnelDay('all', [...placed.values()]));
  const head = ['posted (UTC)', 'n', ...STEPS];
  const cells = days.map((d) => [d.label, String(d.n), ...STEPS.map((s) => String(d.counts[s]))]);
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => (c[i] ?? '').length)));
  const row = (c: readonly string[]) => c.map((s, i) => s.padEnd(w[i] ?? 0)).join('  ').trimEnd();
  const missedLines = rows.missed.map((m) => {
    const x = placed.get(m.itemId);
    return `  #${m.id} ${m.itemId}: ${x === undefined ? 'not in the set (the owner called it Not a meme, or it is not held)' : `${x.step}: ${x.detail}`}${m.diagnosis === null ? '' : ` (the tool said: ${m.diagnosis})`}`;
  });
  return [
    row(head),
    ...cells.map(row),
    `Memeable: the owner's meme label, a gold sheet, your missed list, or coined ${Math.round(p.judge.coinModel.lateMs / 60_000)} min+ after posting and over the viral line (X ${lines['x']?.toLocaleString('en-GB')}, TikTok ${lines['tiktok']?.toLocaleString('en-GB')}); never your "Not a meme". Deadline: the first coin or the first reading at ${EARLY_SHARE * 100}% of the line. "judge said no" includes answered only after the deadline.`,
    ...(missedLines.length === 0 ? ['Owner missed posts posted in the window: none.'] : ['Owner missed posts posted in the window:', ...missedLines]),
  ];
}
