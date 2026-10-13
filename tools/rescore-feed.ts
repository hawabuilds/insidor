/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/rescore-feed.ts --yes [--unscored] [--sync]`
 *
 * RE-CHECKS EVERY POST NOW ON FOR YOU OR POPULAR AGAINST THE JUDGE AS IT IS TODAY. A post's score
 * is recorded once, under the prompt of its day; when the rules change (the sport, fandom and
 * celebrity rules, the coined-post profile, the picture) the posts already showing were passed
 * under the old ones. Each is judged again exactly as the live scorer judges it — alone, with its
 * picture — and the new answer recorded beside the old (the judgement log is append-only). The
 * projector's next frame then holds them to it, and a post that now fails leaves the feed with
 * its reason kept (public.feed_rejection).
 *
 * `--recent` instead re-scores every catch-all post inside the feed's window whose latest answer
 * came from an older prompt — the catch-up after the rules change, newest first, at most
 * `rising.postsPerPass` posts a run.
 * `--kind` asks every post on the feeds the second question (which kind of post) and files a
 * holding answer for AD, SPORT, FANDOM, SHOWBIZ or POLITICS — the live scorer's two-question gate,
 * applied to what is already showing. Spends on the learning line.
 * `--unscored` instead scores the runner's own waiting queue (catch-all posts never scored, inside
 * the feed's window, newest first) — the catch-up after the runner's scorer was paused.
 *
 * ★ SENT AS ONE MESSAGE BATCH BY DEFAULT, at half the judge's price: every post is the same
 * request the live scorer would send, so the answers are the same, but they arrive together
 * after minutes rather than one a second. Nobody watches a re-score, so the wait costs nothing
 * and the saving is real. `--sync` asks one post at a time instead (each answer recorded as it
 * comes), for when the answers are wanted now.
 *
 * Separate from the runner's scorer because that one only asks about posts never scored. Paid,
 * on the shared ledger as a job (tools/lib/shared-meter.ts): in the day's caps, not the runner's
 * pace. Only posts whose latest answer came from another prompt are asked.
 *
 * What breaks if changed carelessly: the subject id must be the scorer's own (`post-<id>`), so
 * an answer is filed under the post it is about.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { storyId, type ItemId } from '../contracts/src/ids.ts';
import type { JudgeOutcome } from '../contracts/src/ports/judge.ts';
import type { Item } from '../contracts/src/vocabulary.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup } from '../adapters/judge/anthropic/src/index.ts';
import { asDb, createPool, DB_ROLE, PgItemRepo, PgPostJudgementRepo } from '../store/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { heldKind } from '../core/src/qualify/kinds.ts';

const P = DEFAULT_POLICY;
const USD_PER_POST = 0.01;
const UNSCORED = process.argv.includes('--unscored');
const SYNC = process.argv.includes('--sync');
const RECENT = process.argv.includes('--recent');
const KIND = process.argv.includes('--kind');

if (process.env['SPEND'] !== 'live' || !process.argv.includes('--yes')) {
  console.error('rescore-feed refused: this calls the paid judge. Set SPEND=live and pass --yes.');
  process.exit(1);
}
const setup = readJudgeSetup(process.env);
if (setup.state !== 'configured') throw new Error(`the judge is ${setup.state}`);
const price = priceFor(setup.model);
if (price === null) throw new Error(`JUDGE_MODEL ${setup.model} has no price`);

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-rescore-feed' });
const db = asDb(pool);
const { meter, close } = await openSharedMeter(UNSCORED || RECENT ? 2 : 1, process.env, KIND ? 'learning' : 'jobs');
const judge = anthropicJudge({
  client: judgeClient({
    apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.postBatchMaxOutputTokens, effort: price.effort,
    timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }),
  meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1, question: KIND ? 'kind' : 'post', batch: !SYNC,
});

try {
  const showing = KIND
    ? await db.query<{ item_id: string }>('select distinct item_id from public.rising_row')
    : RECENT
    ? await db.query<{ item_id: string }>(
        `select i.item_id from internal.item_found_by f join public.item i on i.item_id = f.item_id
          where i.origin = 'observed' and i.first_seen_at >= now() - ($2::bigint * interval '1 millisecond')
            and (select pj.prompt_id from internal.post_judgement pj where pj.item_id = i.item_id order by pj.judged_at desc, pj.id desc limit 1) is distinct from $1
          order by i.first_seen_at desc limit $3`,
        [judge.promptId, P.rising.windowMs, P.rising.postsPerPass * 2],
      )
    : UNSCORED
    ? (await new PgItemRepo(db).catchAllUnscored((Date.now() - P.rising.windowMs) as never, P.rising.postsPerPass)).map((i) => ({ item_id: String(i.itemId) }))
    : await db.query<{ item_id: string }>(
    `select distinct r.item_id from public.rising_row r
      where (select pj.prompt_id from internal.post_judgement pj where pj.item_id = r.item_id order by pj.judged_at desc, pj.id desc limit 1) is distinct from $1`,
    [judge.promptId],
  );
  console.log(`${showing.length} ${RECENT ? 'recent posts were scored under an older prompt' : UNSCORED ? 'posts waiting for a first score' : 'posts on the feeds were scored under an older prompt'}; at most $${(showing.length * USD_PER_POST).toFixed(2)}.`);
  const items = await new PgItemRepo(db).byIds(showing.map((r) => r.item_id as ItemId));
  const scores = new PgPostJudgementRepo(db);
  let passed = 0;
  let failed = 0;
  const subjectOf = (item: Item) => ({
    storyId: storyId(`post-${String(item.itemId).replaceAll(':', '-').replaceAll('|', '-')}`),
    texts: item.text.trim() === '' ? [] : [item.text.trim().slice(0, P.judge.maxCharsPerText)],
    media: item.media,
    distinctAuthors: 1,
    distinctSources: 1,
  });
  const budget = () => ({ capUsd: meter.line().capUsd, spentUsd: meter.line().spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
  const keep = async (item: Item, o: JudgeOutcome | undefined): Promise<void> => {
    if (o?.kind !== 'judged') return;
    /* The kind question files only a holding answer; OTHER leaves the post's answer as it is. */
    if (!KIND || heldKind(o.judgement.proposedName, P.judge.heldKinds) !== null) await scores.record(item.itemId, o.judgement);
    if (o.judgement.coinable) passed += 1;
    else failed += 1;
    console.log(`${o.judgement.coinable ? 'yes' : 'no '} ${o.judgement.confidence.toFixed(2)} ${(o.judgement.proposedName ?? '-').padEnd(20)} ${item.text.replace(/\s+/g, ' ').slice(0, 80)}`);
  };
  const list = [...items.values()];
  if (SYNC) {
    for (const item of list) await keep(item, (await judge.judge([subjectOf(item)], budget())).value[0]);
  } else if (list.length > 0) {
    console.log(`sent as one batch at half price; waiting for it to end (minutes, at most an hour). --sync asks one at a time.`);
    const outcomes = (await judge.judge(list.map(subjectOf), budget())).value;
    for (const [i, item] of list.entries()) await keep(item, outcomes[i]);
  }
  console.log(`\nre-scored ${passed + failed}: ${passed} still memeable, ${failed} not; spent $${meter.line().spentUsd.toFixed(4)}. The projector's next frame applies it.`);
} finally {
  await close();
  await pool.end();
}
