/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/retune.ts <command> --yes`
 *
 * THE JUDGE LEARNS FROM THE OWNER, TWICE A DAY. Rebuilds the post judge's learned-examples block
 * from the owner's own calls, tests it on posts it does not contain, and applies it only if every
 * gate holds (Policy.learning). The live runner reads the latest APPLIED block within minutes
 * (services/runner/src/learned-examples.ts).
 *
 *   due [--detach]       what the `project` schedule runs every ten minutes: if the latest 08:00 or
 *                        20:00 London slot (Policy.learning.retuneAt/timeZone) has no run yet, runs
 *                        it. `--detach` starts that run and returns at once (see below).
 *   run [--dry] [--force] [--baseline] [--slot=<iso>]
 *                        one run now (by hand: the slot is this minute). `--dry` tests and records
 *                        the block but never applies it; `--force` builds even with nothing new;
 *                        `--baseline` also grades the same test posts with no learned block, for a
 *                        before-and-after on the same posts (about doubles the run's cost).
 *   measure              build and test a block now and print the result, writing nothing to the
 *                        database (no slot, no gold additions, no version, no alert) and reading
 *                        any table not yet migrated as empty. Paid like a run, on the learning book.
 *   status               the last runs and the block in use. Free.
 *
 * A RUN, IN ORDER:
 *   1. gold grows from live (internal.gold_addition, 0057): the recall check's bonded coins whose
 *      creator linked an X post made before launch, and the owner's missed posts that got exactly
 *      one coin. A post we never held is read on X on the learning book; unreadable, it waits a day.
 *   2. nothing new since the last block (no owner call, missed post or gold addition after it, and
 *      the labels file unchanged) → skipped, a log line, no spend, no alert.
 *   3. the block: the labels file, the owner's meme/not taps (a note is the reason), missed posts
 *      as "yes", the owner's name calls as a names section — balanced, newest first, at most
 *      Policy.learning.maxExamples (eval/src/feed/examples.ts, shared with judge-examples.ts).
 *   4. the test, exactly as feed-pass-rates.ts grades (tools/lib/pass-rates.ts): gold (committed
 *      origin posts + additions) must pass ≥ minGoldPass; the held-out half of live non-memes may
 *      pass ≤ maxLiveNegativePass; the held-out half of missed posts must pass ≥ minMissedPass.
 *   5. recorded (internal.judge_examples_version, 0056) applied or not, with why; then the owner's
 *      summary: a log line and an owner alert (`retune_summary`), with the matching lessons (the
 *      owner's right/wrong coin calls, counted and listed for the matching rules' owner) and the
 *      day's miss reasons in the log.
 *
 * ★ MONEY: the learning book (Policy.budget.learningLines, `learn:` rows on the ledger), never the
 * live feed's. The test is sent as one Message Batch at half price when the batch's pessimistic
 * estimate fits what is left of the line, one call a post otherwise; prompt caching makes the long
 * block mostly cache reads either way. A paid step refuses unless SPEND=live and --yes. A test the
 * line cannot cover is not started (kept, with the numbers): one call at a time as the ledger frees
 * a cent took over an hour for a handful of posts. Measured 2026-10-13: 122 test posts, one batch,
 * 86% of the input read from cache, $0.15 a run; a skipped run costs nothing.
 *
 * ★ AN UNANSWERED POST IS NOT A FAILED ONE. A post the judge did not answer (an outage, the line
 * spent) is left out of its rate and the block is not applied — the gate cannot hold on a test
 * that was not run, and grading silence as "did not pass" would blame the block for an outage.
 *
 * ★ `--detach` FOR THE SAME REASON AS THE RECALL CHECK: the `project` schedule runs its jobs one
 * after another and is health-checked on the board being rebuilt every few minutes. A batch of a
 * hundred-odd posts takes minutes; awaited there it would starve the board and fail the health
 * check. The slot row (0056) is claimed by the run itself, so a second start finds it taken.
 *
 * What breaks if changed carelessly: the test must never contain a post in the block. Every group
 * here drops `exampleIds` first; a gold addition that is also a taught missed post is not gold.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE, PgLearningRepo, PgOwnerAlertRepo, type GoldAddition } from '../store/src/index.ts';
import { isMissingTable } from '../store/src/repo/learning.ts';
import { buildBlock, changed, gate, latestSlot, share, type NameCall, type OwnerCall, type Rate } from '../eval/src/feed/examples.ts';
import { postTimeFromId, xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { pictureOf } from '../services/project/src/db.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { LineTooShort, goldOriginPosts, gradePosts, judgeSetup, rateOf, type EvalPost, type EvalRow, type Usage } from './lib/pass-rates.ts';

const P = DEFAULT_POLICY;
const L = P.learning;

/* ── operational constants: how much is read and spent, never what is decided ─────────────────── */

/* What X bills per post returned (tools/gold-fetch.ts states the same price). */
const X_USD_PER_POST = 0.000_15;
/* How far back the recall check's coins are looked at for gold: a post unreadable today is tried
   again for this many days. */
const GOLD_RECALL_DAYS = 3;
/* The window "the day's miss reasons" covers. */
const MISS_REASONS_MS = 86_400_000;

const LABELS = new URL('../eval/src/feed/live-labels.json', import.meta.url);
const command = process.argv[2] ?? '';
const flag = (f: string) => process.argv.includes(f);
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const log = (level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, msg, job: 'retune', ...fields }));
/* A read of a table this database has not been migrated to yet is empty — for `measure`, which
   must work before 0054–0057 are applied. A write to one still fails the run. */
const soft = <T,>(read: Promise<T>, empty: T): Promise<T> => read.catch((e: unknown) => (isMissingTable(e) ? empty : Promise.reject(e)));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
const env = { ...process.env, ...(url === undefined ? {} : { DATABASE_URL_INTERNAL: url }) };

async function withRepo<T>(f: (repo: PgLearningRepo, owner: PgOwnerAlertRepo) => Promise<T>): Promise<T> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-retune' });
  try {
    return await f(new PgLearningRepo(asDb(pool)), new PgOwnerAlertRepo(asDb(pool)));
  } finally {
    await pool.end();
  }
}

/* ── 1. gold grows from live ─────────────────────────────────────────────────────────────────── */

async function growGold(repo: PgLearningRepo): Promise<{ readonly added: number; readonly waiting: number; readonly xUsd: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const recall = await repo.recallOrigins(GOLD_RECALL_DAYS);
  const unheld = recall.filter((r) => r.body === null || r.body.trim() === '');
  /* The posts we never held, read on X on the learning book. No key or no money: they wait. */
  const read = new Map<string, { text: string; imageUri: string | null }>();
  let xUsd = 0;
  if (unheld.length > 0 && (process.env['X_API_KEY'] ?? '') !== '') {
    const shared = await openSharedMeter(unheld.length * X_USD_PER_POST * 2, env, 'learning');
    try {
      const x = xPlatform({ client: xClient({ apiKey: process.env['X_API_KEY'] ?? '', baseUrl: process.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter: shared.meter, now: () => Date.now() });
      const line = shared.meter.line();
      const got = await x.lookup!(unheld.map((r) => r.postId), { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: Date.now() + 120_000 });
      for (const item of got.value.items) if (item.text.trim() !== '') read.set(item.sourceItemId, { text: item.text, imageUri: pictureOf(item.media)?.uri ?? null });
      xUsd = shared.meter.spentUsd();
    } catch (e) {
      log('warn', 'gold: the unheld origin posts could not be read; they wait for tomorrow', { posts: unheld.length, err: errText(e) });
    } finally {
      await shared.close();
    }
  }
  const rows: GoldAddition[] = [];
  for (const r of recall) {
    const held = r.body !== null && r.body.trim() !== '' ? { text: r.body, imageUri: pictureOf(r.media)?.uri ?? null } : (read.get(r.postId) ?? null);
    if (held === null) continue;
    rows.push({ itemId: `x:${r.postId}`, source: 'recall', coinMint: r.mint, coinName: r.coinName, postText: held.text, imageUri: held.imageUri, postedAt: r.postedAt, launchedAt: r.launchedAt, addedOn: today });
  }
  const inGold = new Set((await repo.goldAdditions()).map((g) => g.itemId));
  for (const m of await repo.missedPosts()) {
    if (m.coinAddress === null || inGold.has(m.itemId) || m.body.trim() === '') continue;
    if (m.postedAt !== null && m.firstCoinAt !== null && m.postedAt > m.firstCoinAt) continue;
    rows.push({ itemId: m.itemId, source: 'missed', coinMint: m.coinAddress, coinName: null, postText: m.body, imageUri: pictureOf(m.media)?.uri ?? null, postedAt: m.postedAt, launchedAt: m.firstCoinAt, addedOn: today });
  }
  const added = await repo.addGold(rows, new Date());
  return { added, waiting: recall.length - rows.filter((r) => r.source === 'recall').length, xUsd };
}

/* ── 3. the owner's calls, as the examples module reads them ─────────────────────────────────── */

interface Labelled { readonly itemId: string; readonly text: string; readonly imageUri: string | null; readonly label: string; readonly ownerLabel?: string; readonly why: string }

const postedAtOf = (itemId: string): number | null => {
  const m = /^x:(\d+)$/.exec(itemId);
  return m === null ? null : postTimeFromId(m[1] ?? '');
};

async function ownerCalls(repo: PgLearningRepo) {
  const raw = readFileSync(LABELS, 'utf8');
  const labelsSha = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const labels = (JSON.parse(raw) as { posts: Labelled[] }).posts;
  const calls: OwnerCall[] = [];
  for (const p of labels) {
    const label = p.ownerLabel ?? p.label;
    if (label !== 'meme' && label !== 'not') continue;
    calls.push({ itemId: p.itemId, text: p.text, imageUri: p.imageUri, label, why: p.why, at: postedAtOf(p.itemId), from: 'labels' });
  }
  for (const t of await soft(repo.postCalls(), [])) {
    if (t.body === null || t.body.trim() === '') continue;
    const why = t.note ?? (t.verdict === 'meme' ? "the owner's call: people could coin this" : "the owner's call: nothing to coin");
    calls.push({ itemId: t.itemId, text: t.body, imageUri: pictureOf(t.media)?.uri ?? t.shownPicture, label: t.verdict, why, at: t.at.getTime(), from: 'tap' });
  }
  for (const m of await soft(repo.missedPosts(), [])) {
    calls.push({ itemId: m.itemId, text: m.body, imageUri: pictureOf(m.media)?.uri ?? null, label: 'meme', why: 'a post the owner says we missed: people coined or could coin it', at: m.at.getTime(), from: 'missed' });
  }
  const names: NameCall[] = (await soft(repo.nameCalls(), [])).flatMap((n) => (n.body === null ? [] : [{ itemId: n.itemId, text: n.body, name: n.name, verdict: n.verdict, betterName: n.betterName, at: n.at.getTime() }]));
  return { calls, names, labelsSha };
}

/* ── a run ───────────────────────────────────────────────────────────────────────────────────── */

async function run(slot: Date, opts: { readonly dry: boolean; readonly force: boolean; readonly record: boolean; readonly baseline?: boolean }): Promise<void> {
  await withRepo(async (repo, owner) => {
    if (opts.record && !(await repo.claimSlot(slot, new Date()))) {
      log('info', 'this slot already ran', { slot: slot.toISOString() });
      return;
    }
    const end = (outcome: 'skipped' | 'kept' | 'applied' | 'dry' | 'failed', versionId: number | null, detail: string | null, costUsd: number | null) =>
      opts.record ? repo.endRun(slot, { outcome, versionId, detail, costUsd, endedAt: new Date() }) : Promise.resolve();
    try {
      const gold = opts.record ? await growGold(repo) : { added: 0, waiting: 0, xUsd: 0 };
      if (opts.record) log('info', 'gold from live', { slot: slot.toISOString(), added: gold.added, waiting: gold.waiting, xUsd: gold.xUsd });

      const { calls, names, labelsSha } = await ownerCalls(repo);
      const last = await soft(repo.lastBuilt(), null);
      const newest = await soft(repo.newestInput(), null);
      const nothingNew = last !== null && last.labelsSha === labelsSha && (newest === null || (last.inputsThrough !== null && newest <= last.inputsThrough));
      if (nothingNew && !opts.force) {
        log('info', 'retune skipped: nothing new since the last block', { slot: slot.toISOString(), lastVersion: last.versionId });
        await end('skipped', null, 'nothing new since the last block', gold.xUsd);
        return;
      }

      const block = buildBlock(calls, names, L.maxExamples);
      const taught = new Set(block.exampleIds);
      const testMissedIds = new Set(block.testMissed.map((m) => m.itemId));
      const additions = await soft(repo.goldAdditions(), []);
      type G = 'gold' | 'live-not' | 'missed';
      const posts: EvalPost<G>[] = [
        ...goldOriginPosts(),
        ...additions.filter((g) => !taught.has(g.itemId) && !testMissedIds.has(g.itemId)).map((g) => ({ group: 'gold' as const, id: g.itemId, kind: `added ${g.addedOn} (${g.source})`, text: g.postText, imageUri: g.imageUri, coinRef: g.coinMint })),
        ...block.testNegatives.map((c) => ({ group: 'live-not' as const, id: c.itemId, kind: c.why, text: c.text, imageUri: c.imageUri })),
        ...block.testMissed.map((c) => ({ group: 'missed' as const, id: c.itemId, kind: 'missed', text: c.text, imageUri: c.imageUri })),
      ];

      judgeSetup(env);
      log('info', 'retune testing a block', { slot: slot.toISOString(), posts: posts.length, gold: posts.filter((p) => p.group === 'gold').length, liveNegatives: block.testNegatives.length, missed: block.testMissed.length, examples: block.exampleIds.length, chars: block.text.length });
      /* Bounded by the learning book's lines, not a guess per post: the test either fits what is left
         of them (mustFit) or is not started. */
      /* ★ A PICTURE IS EMBEDDED ONCE PER RUN. The block's test and the baseline grade the same
         posts minutes apart, and two embeddings of one file minutes apart came back bit-identical
         (2026-10-13), so the second grading reads the first's vectors. Not across runs: vectors
         stored hours earlier differed by up to 0.0003 cosine, which is not provably the same answer. */
      const held = new Map<string, readonly number[]>();
      const vectors = {
        stored: async (uris: readonly string[]) => new Map(uris.flatMap((u) => { const v = held.get(u); return v === undefined ? [] : [[u, v] as const]; })),
        keep: async (_id: string, uri: string, _space: string, v: readonly number[]) => void held.set(uri, v),
      };
      const shared = await openSharedMeter(P.budget.learningLines.dailyUsd, env, 'learning');
      let rows: readonly EvalRow<G>[] = [];
      let used: Usage | null = null;
      let batched = false;
      try {
        const coined = await repo.coinedPictureVectors();
        ({ rows, used, batched } = await gradePosts(posts, { env, meter: shared.meter, examples: block.text, batch: true, mustFit: true, coined, vectors }));
      } finally {
        await shared.close();
      }
      /* `--baseline`: the same test posts graded by the judge as it runs before this block (its
         rules alone, no learned examples), so the owner's table compares like with like. Paid on
         the learning book, refused rather than dribbled when the line cannot cover it. */
      let baseline: Record<'gold' | 'negatives' | 'missed', Rate> | null = null;
      let baselineUsd = 0;
      if (opts.baseline === true) {
        const again = await openSharedMeter(P.budget.learningLines.dailyUsd, env, 'learning');
        try {
          const coined = await repo.coinedPictureVectors();
          const base = await gradePosts(posts, { env, meter: again.meter, examples: null, batch: true, mustFit: true, coined, vectors });
          const said = base.rows.filter((r) => r.coinable !== null);
          baseline = { gold: rateOf(said, 'gold'), negatives: rateOf(said, 'live-not'), missed: rateOf(said, 'missed') };
          log('info', 'retune baseline: the same posts, rules alone', { slot: slot.toISOString(), gold: baseline.gold, liveNegatives: baseline.negatives, missed: baseline.missed, unanswered: base.rows.length - said.length });
        } finally {
          baselineUsd = again.meter.spentUsd();
          await again.close();
        }
      }
      const costUsd = shared.meter.spentUsd() + gold.xUsd + baselineUsd;

      /* Unanswered posts are out of every rate, and stop the block being applied. */
      const answered = rows.filter((r) => r.coinable !== null);
      const unanswered = rows.length - answered.length;
      const rates: Record<'gold' | 'negatives' | 'missed', Rate> = { gold: rateOf(answered, 'gold'), negatives: rateOf(answered, 'live-not'), missed: rateOf(answered, 'missed') };
      const verdict = gate(rates, L);
      const why = unanswered > 0 ? `${unanswered} of ${rows.length} test posts went unanswered (outage or the learning line)${verdict.why === null ? '' : `; ${verdict.why}`}` : verdict.why;
      const apply = verdict.apply && unanswered === 0 && !opts.dry;
      const before = await soft(repo.appliedExampleIds(), []);
      const delta = changed(before, block.exampleIds);
      const sha = createHash('sha256').update(block.text).digest('hex').slice(0, 16);
      const version = {
        builtAt: new Date(), text: block.text, sha, exampleIds: block.exampleIds,
        tapsUsed: block.used.taps, missedUsed: block.used.missed, labelsUsed: block.used.labels, namesUsed: block.used.names,
        inputsThrough: newest, labelsSha,
        goldPass: share(rates.gold), goldN: rates.gold.tested, liveNegativePass: share(rates.negatives), liveNegativeN: rates.negatives.tested, missedPass: share(rates.missed), missedN: rates.missed.tested,
        applied: apply, reasonNotApplied: apply ? null : opts.dry ? `dry run${why === null ? ': every gate held' : `: ${why}`}` : why, dry: opts.dry, costUsd,
      };
      const versionId = opts.record ? await repo.recordVersion(version) : null;

      /* The matching lessons: the owner's coin calls, counted and listed for the matching rules. */
      const matches = await soft(repo.matchCalls(), []);
      const lessons = {
        right: matches.filter((m) => m.verdict === 'right').length,
        wrong: matches.filter((m) => m.verdict === 'wrong').length,
        none: matches.filter((m) => m.verdict === 'none').length,
        list: matches.filter((m) => m.verdict !== 'right').map((m) => `${m.itemId} ${m.verdict}${m.coinAddress === null ? '' : ` → ${m.coinAddress}`}${m.note === null ? '' : ` (${m.note})`}`),
      };
      const missReasons = await soft(repo.missReasons(new Date(Date.now() - MISS_REASONS_MS)), {});
      const outcome = opts.dry ? 'dry' : apply ? 'applied' : 'kept';
      const summary = {
        slot: slot.toISOString(), version: versionId, outcome, why,
        gold: rates.gold, liveNegatives: rates.negatives, missed: rates.missed, unanswered, baseline,
        learnedFrom: block.used, examples: block.exampleIds.length, added: delta.added, removed: delta.removed, chars: block.text.length,
        costUsd: Number(costUsd.toFixed(4)), batched, usage: used, goldAdded: gold.added, missReasons, matchingLessons: lessons,
      };
      log(apply || opts.dry ? 'info' : 'warn', `retune ${outcome}`, summary);
      await end(outcome, versionId, why ?? `applied: gold ${rates.gold.passed}/${rates.gold.tested}, live non-memes ${rates.negatives.passed}/${rates.negatives.tested}, missed ${rates.missed.passed}/${rates.missed.tested}; matching lessons right ${lessons.right}, wrong ${lessons.wrong}, none ${lessons.none}`, costUsd);

      /* The owner's alert, once per slot (the claim is on the subject). A dry run tells nobody. */
      if (!opts.dry && opts.record) {
        try {
          for (const userId of await owner.ownerIds(P.owner.wallets)) {
            await owner.queue(userId, {
              kind: 'retune_summary',
              subject: `retune|${slot.toISOString()}`,
              rung: 1,
              facts: {
                applied: apply, why,
                goldPassed: rates.gold.passed, goldN: rates.gold.tested, negativePassed: rates.negatives.passed, negativeN: rates.negatives.tested, missedPassed: rates.missed.passed, missedN: rates.missed.tested,
                taps: block.used.taps, missed: block.used.missed, names: block.used.names, added: delta.added, removed: delta.removed, missReasons,
              },
              href: '/#/alerts',
            });
          }
        } catch (e) {
          log('error', 'the re-tune summary could not be queued for the owner', { err: errText(e) });
        }
      }
    } catch (e) {
      if (e instanceof LineTooShort) {
        log('warn', 'retune kept the current block: the learning line cannot cover the test', { slot: slot.toISOString(), remainingUsd: e.remainingUsd, neededUsd: e.neededUsd });
        await end('kept', null, `not tested: ${e.message}`, null);
        return;
      }
      log('error', 'retune failed', { slot: slot.toISOString(), err: errText(e) });
      await end('failed', null, errText(e).slice(0, 500), null);
      process.exitCode = 1;
    }
  });
}

/* ── the commands ────────────────────────────────────────────────────────────────────────────── */

if (command === 'status') {
  await withRepo(async (repo) => {
    const applied = await repo.latestApplied();
    console.log(applied === null ? 'no block applied: the judge reads its rules alone' : `in use: version ${applied.versionId} (${applied.sha}), applied ${applied.appliedAt.toISOString()}, ${applied.text.length} characters`);
    for (const r of await repo.recentRuns(10)) console.log(`${r.slot.toISOString()}  ${r.outcome.padEnd(8)} ${r.costUsd === null ? '      ' : `$${r.costUsd.toFixed(3)}`}  ${r.versionId ?? ''}  ${r.detail ?? ''}`);
  });
} else if (command === 'measure') {
  if (process.env['SPEND'] !== 'live' || !flag('--yes')) {
    console.error('retune refused: this calls the paid judge. Set SPEND=live and pass --yes.');
    process.exit(1);
  }
  await run(new Date(), { dry: true, force: true, record: false });
} else if (command === 'due' || command === 'run') {
  if (process.env['SPEND'] !== 'live' || !flag('--yes')) {
    console.error('retune refused: this calls the paid judge. Set SPEND=live and pass --yes.');
    process.exit(1);
  }
  const slotArg = arg('slot');
  /* `due` claims a slot `startAheadMs` before it, so the run is finished by 08:00 and 20:00, not started then. */
  const slot = command === 'due' ? new Date(latestSlot(Date.now() + L.startAheadMs, L.retuneAt, L.timeZone)) : new Date(slotArg ?? new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString());
  if (command === 'due') {
    if (await withRepo((repo) => repo.hasRun(slot))) process.exit(0);
  }
  if (flag('--detach')) {
    const args = ['run', '--yes', `--slot=${slot.toISOString()}`, ...(flag('--dry') ? ['--dry'] : []), ...(flag('--force') ? ['--force'] : [])];
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1] ?? '', ...args], { detached: true, stdio: 'inherit' });
    child.unref();
    log('info', 'retune started, detached', { slot: slot.toISOString() });
    process.exit(0);
  }
  await run(slot, { dry: flag('--dry'), force: flag('--force'), record: true, baseline: flag('--baseline') });
} else {
  console.error('usage: tools/retune.ts due|run|measure|status [--yes] [--dry] [--force] [--baseline] [--detach] [--slot=<iso>]');
  process.exit(2);
}
