/**
 * `node --env-file=.env.local --experimental-strip-types tools/judge-shadow-report.ts [--hours=N | --since=ISO [--until=ISO]] [--examples=10]`
 *
 * THE TWO FEED JUDGES SIDE BY SIDE, FROM THE SHADOW'S OWN ROWS (internal.judge_shadow, 0089): for
 * the window (default: today since 00:00 UTC), how often the main judge and the open model give the
 * same yes/no, the yes/no table, each model's cost and seconds a post, and the newest disagreements
 * each way — main yes / open no and main no / open yes — with the post's words, its link and both
 * answers. Then the feed judge's cost a day as it is billed now and as it would be with the other
 * model answering, at the same day's volume.
 *
 * Free: it reads the database and calls nothing. Each answer is held to its own model's cutoff, as
 * the projector holds it (tools/lib/judge-shadow.ts says what "yes" means here and what it leaves
 * out).
 *
 * What breaks if changed carelessly: the cost-a-day line multiplies the shadow's measured dollars a
 * post by the live judge's answer count. A window with few shadow rows makes that a rough figure,
 * and it says how many rows it stands on.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE, PgLearningRepo } from '../store/src/index.ts';
import { answerPolicies } from '../services/project/src/judge-cutoff.ts';
import { postLink, summarise, type ModelNumbers, type Pair, type ShadowRow, type Side } from './lib/judge-shadow.ts';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const say = (line = '') => console.log(line);
const DEFAULT_EXAMPLES = 10;
const TEXT_CHARS = 160;

const now = new Date();
const hours = arg('hours');
const since = hours !== null ? new Date(now.getTime() - Number(hours) * 3_600_000) : arg('since') !== null ? new Date(arg('since')!) : new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
const until = arg('until') !== null ? new Date(arg('until')!) : now;
const examples = Number(arg('examples') ?? DEFAULT_EXAMPLES);
if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || !(examples >= 0)) {
  console.error('judge-shadow-report: --hours, --since/--until (ISO times) and --examples must be numbers or times');
  process.exit(2);
}

const pool = createPool(DB_ROLE.internal, { applicationName: 'insidor-judge-shadow-report' });
const db = asDb(pool);
try {
  type Raw = {
    item_id: string; asked_at: Date; body: string | null; source: string; source_item_id: string; handle: string | null;
    live_judge_id: string; live_coinable: boolean; live_confidence: number; live_looked_at: Side['lookedAt']; live_name: string | null; live_cost_usd: string; live_s_per_post: number | null;
    shadow_judge_id: string | null; shadow_coinable: boolean | null; shadow_confidence: number | null; shadow_looked_at: Side['lookedAt'] | null; shadow_name: string | null; shadow_cost_usd: string; shadow_s_per_post: number | null; shadow_detail: string | null;
  };
  const raw = await db.query<Raw>(
    `select s.item_id, s.asked_at, i.body, i.source, i.source_item_id, a.handle,
            s.live_judge_id, s.live_coinable, s.live_confidence, s.live_looked_at, s.live_name, s.live_cost_usd::text, s.live_s_per_post,
            s.shadow_judge_id, s.shadow_coinable, s.shadow_confidence, s.shadow_looked_at, s.shadow_name, s.shadow_cost_usd::text, s.shadow_s_per_post, s.shadow_detail
       from internal.judge_shadow s
       join public.item i on i.item_id = s.item_id
       left join public.author a on a.author_key = i.author_key
      where s.question = 'post' and s.asked_at >= $1 and s.asked_at < $2
      order by s.asked_at`,
    [since, until],
  ).catch((e: unknown) => {
    /* Before 0089 is applied there is no shadow to read: said plainly, not as a stack trace. */
    if ((e as { code?: unknown } | null)?.code === '42P01') {
      say('judge-shadow-report: internal.judge_shadow does not exist yet; apply migration 0089 and let the runner shadow a while');
      process.exit(0);
    }
    throw e;
  });
  const rows: ShadowRow[] = raw.map((r) => ({
    itemId: r.item_id,
    askedAt: new Date(r.asked_at),
    text: (r.body ?? '').replace(/\s+/g, ' ').trim(),
    link: postLink(r.source, r.source_item_id, r.handle, r.item_id),
    live: { judgeId: r.live_judge_id, coinable: r.live_coinable, confidence: Number(r.live_confidence), lookedAt: r.live_looked_at, name: r.live_name, costUsd: Number(r.live_cost_usd), sPerPost: r.live_s_per_post },
    shadow: r.shadow_judge_id === null || r.shadow_coinable === null || r.shadow_confidence === null || r.shadow_looked_at === null
      ? null
      : { judgeId: r.shadow_judge_id, coinable: r.shadow_coinable, confidence: Number(r.shadow_confidence), lookedAt: r.shadow_looked_at, name: r.shadow_name, costUsd: Number(r.shadow_cost_usd), sPerPost: r.shadow_s_per_post },
    shadowCostUsd: Number(r.shadow_cost_usd),
    detail: r.shadow_detail,
  }));
  const block = await new PgLearningRepo(db).latestApplied();
  const policies = answerPolicies(DEFAULT_POLICY, block?.cutoff ?? null);
  const s = summarise(rows, policies, examples);
  const pct = (n: number, of: number) => (of === 0 ? '-' : `${Math.round((n / of) * 100)}%`);
  const openCut = DEFAULT_POLICY.judge.openCutoff;

  say(`judge shadow, ${since.toISOString()} to ${until.toISOString()}`);
  say(`cutoffs: main judge ${block?.cutoff ?? 'policy bar'} (applied block v${block?.versionId ?? '-'}), open model ${openCut ?? `${block?.cutoff ?? 'policy bar'} (not tuned yet: the block's)`}`);
  say(`rows ${s.rows}: ${s.pairs} answered by both, ${s.unanswered} the shadow did not answer${s.unanswered > 0 ? ` (first reason: ${rows.find((r) => r.shadow === null)?.detail ?? '-'})` : ''}`);
  say('');
  say(`agreement on yes/no at each model's own cutoff: ${s.agree}/${s.pairs} (${pct(s.agree, s.pairs)}); on the raw coinable answer: ${s.coinableAgree}/${s.pairs} (${pct(s.coinableAgree, s.pairs)})`);
  say('');
  say(`                 open yes   open no`);
  say(`  main yes   ${String(s.table.bothYes).padStart(9)} ${String(s.table.mainYesOpenNo).padStart(9)}`);
  say(`  main no    ${String(s.table.mainNoOpenYes).padStart(9)} ${String(s.table.bothNo).padStart(9)}`);
  say(`  main judge says yes to ${pct(s.table.bothYes + s.table.mainYesOpenNo, s.pairs)}, the open model to ${pct(s.table.bothYes + s.table.mainNoOpenYes, s.pairs)}`);
  say('');
  const line = (name: string, m: ModelNumbers) =>
    say(`  ${name.padEnd(11)} ${String(m.answers).padStart(6)} answers  $${m.usd.toFixed(4)}  ${m.usdPerPost === null ? '-' : `$${m.usdPerPost.toFixed(6)}`} a post  ${m.medianSPerPost === null ? '-' : `${m.medianSPerPost.toFixed(2)} s`} a post median, ${m.p90SPerPost === null ? '-' : `${m.p90SPerPost.toFixed(2)} s`} p90`);
  say('cost and speed in this window (the post question; seconds are each call over its posts):');
  line('main judge', s.main);
  line('open model', s.open);

  /* The feed judge's day: what the last 24 hours billed for both feed questions, and the same answer count at the other model's measured price. */
  const [day] = await db.query<{ post_n: string; kind_n: string; post_usd: string | null; kind_usd: string | null; open_n: string }>(
    `select count(*) filter (where prompt_id like 'post-coinability@%' and copied_from is null and judge_id like 'judge:%') as post_n,
            count(*) filter (where prompt_id like 'post-kind@%' and judge_id like 'judge:%') as kind_n,
            sum(cost_usd) filter (where prompt_id like 'post-coinability@%') as post_usd,
            sum(cost_usd) filter (where prompt_id like 'post-kind@%') as kind_usd,
            count(*) filter (where judge_id like 'judge:openrouter/%') as open_n
       from internal.post_judgement where judged_at > now() - interval '24 hours'`,
  );
  const [shadowDay] = await db.query<{ usd: string | null }>(`select sum(usd) as usd from internal.spend where endpoint = 'judge-shadow' and at > now() - interval '24 hours'`);
  const answers = Number(day?.post_n ?? 0) + Number(day?.kind_n ?? 0);
  const billed = Number(day?.post_usd ?? 0) + Number(day?.kind_usd ?? 0);
  say('');
  say(`the feed judge's day (both questions, last 24 h): ${day?.post_n ?? 0} post answers and ${day?.kind_n ?? 0} kind answers, $${billed.toFixed(2)} as billed (${day?.open_n ?? 0} of them from the open model)`);
  for (const [name, m] of [['main judge', s.main], ['open model', s.open]] as const) {
    if (m.usdPerPost !== null) say(`  with the ${name} answering all of them: about $${(m.usdPerPost * answers).toFixed(2)} a day (its $${m.usdPerPost.toFixed(6)} a post in this window, ${m.answers} answers)`);
  }
  say(`  the shadow itself: $${Number(shadowDay?.usd ?? 0).toFixed(2)} in the last 24 h (cap $${DEFAULT_POLICY.judge.shadow.dailyUsd} a day)`);

  const show = (title: string, xs: readonly Pair[]) => {
    say('');
    say(`${title} (newest ${xs.length}):`);
    for (const p of xs) {
      say(`  ${p.row.askedAt.toISOString().slice(0, 16)}  ${p.row.link}`);
      say(`    "${p.row.text.slice(0, TEXT_CHARS)}${p.row.text.length > TEXT_CHARS ? '…' : ''}"`);
      say(`    main: ${p.main.coinable ? 'yes' : 'no'} ${p.main.confidence.toFixed(2)} ${p.main.name ?? '-'} (${p.main.lookedAt})   open: ${p.open.coinable ? 'yes' : 'no'} ${p.open.confidence.toFixed(2)} ${p.open.name ?? '-'} (${p.open.lookedAt})`);
    }
  };
  show('main yes, open no', s.mainYesOpenNo);
  show('main no, open yes', s.mainNoOpenYes);
} finally {
  await pool.end();
}
