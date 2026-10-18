/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/retune.ts <command> --yes`
 *
 * THE JUDGE LEARNS FROM THE OWNER, TWICE A DAY. Rebuilds the post judge's learned-examples block
 * from the owner's own calls, tests it on posts it does not contain, and applies it only if every
 * gate holds (Policy.learning). The live runner reads the latest APPLIED block within minutes
 * (services/runner/src/learned-examples.ts).
 *
 *   due [--detach]       what the `project` schedule runs every ten minutes: if the latest 00:00 or
 *                        12:00 London slot (Policy.learning.retuneAt/timeZone) has no run yet, runs
 *                        it. `--detach` starts that run and returns at once (see below).
 *   run [--dry] [--force] [--baseline] [--slot=<iso>] [--floor=<gold>,<junk>,<missed>]
 *                        one run now (by hand: the slot is this minute). `--dry` tests and records
 *                        the block but never applies it; `--force` builds even with nothing new;
 *                        `--baseline` also grades the same test posts with no learned block, for a
 *                        before-and-after on the same posts (about doubles the run's cost).
 *   measure [--baseline] [--rules-only] [--max-batch=<n>] [--rows=<file>] [--model=<id>]
 *           [--instructions=<file>] [--kind-coinable] [--no-auto] [--max-negatives=<n>]
 *                        build and test a block now and print the result, writing nothing to the
 *                        database (no slot, no gold additions, no version, no alert) and reading
 *                        any table not yet migrated as empty. Paid like a run, on the learning book.
 *                        `--rules-only` grades the judge's rules alone (no block, no regression
 *                        check): the baseline by itself, at half the cost. `--max-batch` measures
 *                        another number of posts per call than the live scorer's; `--rows` writes
 *                        every graded post's answers to a file. For experiments: `--model=<id>`
 *                        another judge model; `--instructions=<file>` text added after the rules
 *                        (a prompt variant, never the live file); `--kind-coinable` asks the kind
 *                        question of every "yes", so a looser bar can be tried on the same answers;
 *                        `--no-auto` leaves auto gold out; `--max-negatives=<n>` tests only the newest n
 *                        live non-memes, to fit a measurement in a small budget (the run tests them all).
 *   status               the last runs and the block in use. Free.
 *   compose              what the next run would teach and test, counted (examples, taps taught
 *                        and tested, hand gold, coin calls, non-memes). Free: no judge, no writes.
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
 *      Posts on Policy.learning.alwaysTeach (a missed post the owner wants learned back) are always
 *      taught, first, and so never in the test: the held-out missed set is one post smaller each.
 *      Then THE OWNER'S RULEBOOK (Policy.learning.rulebook, tools/lib/rulebook.ts): one call to a bigger
 *      open model (RULEBOOK_MODEL, Llama 4 Maverick by default) writes at most 25 rules from the
 *      block's own lines, the owner's standing decisions and counts over every input, and they go
 *      in the block under their own heading — so the test grades block and rulebook together.
 *      And posts people coined (Policy.learning.coinedYes, on): two or more coins launched ten
 *      minutes or more after the post, the judge's answer "no", no self-launching author, no
 *      owner call, no hand gold, no crypto talk, no held kind — the newest twenty, as their own
 *      YES section, in only the room the owner's own calls leave (the owner, 2026-10-18), and never an animal or object by the word test. Free: our own rows, no judge call.
 *      And last the owner's soft yes (Policy.learning.seenKept): posts on his screen for two seconds
 *      or opened, with no "Not a meme" in 24 hours and no call of his (0098, store owner-seen.ts),
 *      the newest `maxPerBlock`, after the coined posts, in whatever room is still left; never tested.
 *   4. the test, asked exactly as the live scorer asks (tools/lib/pass-rates.ts: ten posts a call,
 *      the same picture size and answer budget, then the kind question). HAND GOLD is the gold
 *      sheets, the owner's missed posts and the owner's own list (eval/src/gold/hand-gold.json:
 *      approved recall additions and any post we hold); every other recall addition is AUTO GOLD, graded and
 *      reported, never gated. A post passes when it would be on For You: the first question passes
 *      and its kind is not one Policy.judge.heldKinds holds (eval/src/feed/examples.ts):
 *        applied     when it BEATS the setup live now (its applied block, or its rules alone),
 *                    graded on the same posts beside the block's test: strictly more hand gold
 *                    (memes, news, tragedies alike) AND strictly fewer held-out live non-memes,
 *                    AND no fewer held-out missed posts caught than live. Strict is the noise
 *                    rule: both sides run together at temperature 0, so a tie is not an improvement.
 *        goal        hand gold ≥ minGoldPass, live non-memes ≤ maxLiveNegativePass, missed ≥
 *                    minMissedPass: reported met or not met, never a block
 *      A post passes as live decides (core passesWithSignal): the judge, or — its kind not held —
 *      other accounts' crypto talk from its crypto-attention read; a shill never. A post with no
 *      such read is decided by the judge alone, and the run says how many.
 *      ★ THE NEW BLOCK'S CUTOFF FIRST (the owner, 2026-10-16: "before refusing a new version, tune its
 *      yes/no cutoff, aiming for LESS junk"): on the answers already collected (no extra call), the
 *      new block's confidence cutoff is raised from the live bar (the applied block's own cutoff, or
 *      the policy's lowest bar) by Policy.learning.cutoffStep up to cutoffMax (eval sweepCutoff):
 *        A  the strictest cutoff with hand gold ≥ live, fewer live non-memes, missed caught ≥ live
 *        B  else the fewest live non-memes ≤ live with more hand gold, missed caught ≥ live
 *        else refused. The cutoff is applied WITH the block (internal.judge_examples_version
 *      .judge_cutoff, 0086) and the projector holds every answer to it; before 0086 a block that
 *      needs a cutoff above the policy bar is refused, since it could not be stored. A missed post
 *      the new block answered "no" is lost at every cutoff — a stricter cutoff only removes passes.
 *      ★ MISSED POSTS COUNTED, NOT NAMED (the owner, 2026-10-16): one missed post live catches and
 *      the new block does not no longer refuses a block that catches as many or more overall (it
 *      kept version 9 out at 10/16 against live's 7/16). Each such post is still named — the log's
 *      sweep line, the run's detail and the owner's alert — so the owner can teach it back.
 *      The setup live now is graded at ITS cutoff. The rule, the cutoff and new against live on hand
 *      gold, live non-memes and missed are in the log, the run's detail, status and the alert.
 *      ★ THE OWNER'S GATE DECIDES (Policy.learning.ownerGate, the owner 2026-10-17). The sweep still
 *      runs and proposes; the block is applied only where (1) it catches strictly more of the owner's
 *      fixed test set (eval/src/feed/owner-split.json `test`, never taught) than live, (2) its hand
 *      gold is not lower and (3) its junk is at most two points over live's. Junk here is the owner's
 *      "Not a meme" taps on posts first shown on For You in the last three days that the block did
 *      not teach; of those, the news-kind and picture-less ones (quotes, celebrity and company
 *      news) are held out of the block while in the window, so all of them are tested. At the
 *      sweep's cutoff when the gate holds there, else at the strictest that holds, else refused.
 *      Junk (b) beside it (the owner, 2026-10-18; tools/lib/junk-sample.ts): a seeded sample of 300
 *      untapped For You posts from the same window, labelled from the old judges' answers, its
 *      old-label "not" posts graded on both sides. Reported and flagged when it rises more than the
 *      same two points; junk (a) decides. `compose --unclear=<file>` writes its unclear posts for
 *      the owner to label (free).
 *      The owner's table (untaught misses caught x/6, the fixed set x/16, gold, junk, live beside
 *      each, the cost) is the `retune owner gate` log line, the run's detail and the alert's first line.
 *      The owner's split's `teach` half is taught with Policy.learning.alwaysTeach, and the owner's
 *      own rules (Policy.learning.rulebook.ownerRules) head the rulebook.
 *      The live non-memes are the labels file's "not" posts and every "Not a meme" tap the owner
 *      makes, held out by the id split, so the set grows by itself day by day.
 *        lost        every missed post the judge in use catches (its applied block, or its rules
 *                    alone) that the new block does not, at the chosen cutoff: named, not a gate.
 *   5. recorded (internal.judge_examples_version, 0056) applied or not, with why; then the owner's
 *      summary: a log line and an owner alert (`retune_summary`), with the matching lessons (the
 *      owner's right/wrong coin calls, counted and listed for the matching rules' owner) and the
 *      day's miss reasons in the log.
 *
 * THE TIKTOK PART (the owner, 2026-10-16: "re-tune the TikTok settings twice a day with the X
 * re-tune, same gate"), tools/lib/short-video-tune.ts, after the X block's test in every run:
 *   · the TikTok training set refreshed (internal.coined_video, 0085) — and at every `due` check,
 *     every ten minutes, so a new coined TikTok is in the set within minutes; free
 *   · what it teaches (the speed bar at 30/60/120 minutes, tags, sounds, creators, kinds, naming),
 *     and the learned bar's gate on our readings: no fewer coined TikToks caught, no more junk,
 *     better on one, no missed TikTok lost — PROPOSED to the owner when it holds, since the bar is code
 *   · with Policy.learning.shortVideo.gateOn, the TikTok coined videos graded beside the test (the
 *     same gradings, ~60 more posts): the block is applied only if it also catches no fewer coined
 *     TikToks, lets no more TikTok junk through and loses no missed TikTok the judge in use catches;
 *     "beat" (strictly better on both, X's rule) is reported. No-worse, not strict, for applying:
 *     strict on sets this small would keep every X block out too
 *   · X and TikTok side by side (tools/lib/side-by-side.ts), the biggest gap and what is changing
 *     for it — in the log, the run's detail and the owner's alert; recorded (internal.short_video_tuning)
 *
 * ★ THE PRIMARY GRADES BOTH SIDES (the owner, 2026-10-16: "no Anthropic API at all from now on";
 * 2026-10-17: "the re-tune tests with the primary"). The new block and the block in use are both
 * asked of the model the runner asks the post question of first (tools/lib/pass-rates.ts
 * `openGradeSetup`: Nemotron on Together with TOGETHER_API_KEY, else the router's Gemma 3), with its
 * own 40 precedents a post, and the block in use is
 * held at the cutoff the projector holds that model's answers to (core `answerCutoff`: the block's
 * own when it was chosen on that model, else its settings judge.cutoffs number, else the block's). The new block's cutoff is swept from the policy bar, not from the cutoff
 * in use: a confidence is a model's own scale. The cutoff chosen is stored with the block (0086)
 * with the model it was chosen on (0094), and holds that model's answers only. `--floor=<gold>,<junk>,<missed>` holds the new block to
 * given numbers instead of the live grading's (the switch of judge: the main judge's stored 07:00
 * UTC sweep, as shares); the open judge's grading of the block in use is still made and reported.
 *
 * ★ MONEY: the learning book (Policy.budget.learningLines, `learn:` rows on the ledger), never the
 * live feed's, and its reserve is the re-tune's alone (`retuneReserveUsd`); `measure` is a test,
 * held to the tests' $1 a day. The open host has no Message Batches: calls go four at a time. A
 * paid step refuses unless SPEND=live and --yes. A test whose pessimistic estimate the line cannot
 * cover is not started (kept, with the numbers). A skipped run costs nothing.
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
 * here drops `exampleIds` first; a gold addition that is also a taught missed post is not gold. The
 * one exception is `missed-taught`, graded for the regression rule only and never in a rate.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { JudgeEvidence } from '../contracts/src/judgement.ts';
import { lessonsLine, narrativeLessons } from './lib/narrative-lessons.ts';
import { asDb, createPool, DB_ROLE, PgLabelEmbeddingRepo, PgLearningRepo, PgOwnerAlertRepo, PgOwnerSeenRepo, type GoldAddition } from '../store/src/index.ts';
import { POST_SPACE } from '../adapters/embed/voyage/src/index.ts';
import { isMissingTable } from '../store/src/repo/learning.ts';
import { leadFacts, leadLines, leadRows, summarise } from './lib/lead-time.ts';
import { atCutoff, buildBlock, caught, changed, coinedYes, currentCalls, keptYes, type KeptPost, gate, goalsText, latestSlot, junkBRose, missedCaught, ownerLine, ownerSide, parseFloor, pickOwnerCutoff, ratesOf, regressions, withRulebook, share, strictestKeeping, sweepCutoff, type CutoffChoice, type CutoffPoint, type GradedPost, type NameCall, type OwnerCall, type OwnerPick, type OwnerSets, type OwnerSide, type Rate } from '../eval/src/feed/examples.ts';
import { OWNER_SPLIT, alwaysTeachIds } from '../eval/src/feed/owner-split.ts';
import { drawSample, readUntapped, unclearMarkdown } from './lib/junk-sample.ts';
import { postTimeFromId, xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { pictureOf } from '../services/project/src/db.ts';
import { onOutOfCredit } from '../adapters/kit/vendor/src/billing.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { LineTooShort, goldOriginPosts, handGoldIds, gradePosts, openGradeSetup, type EvalPost, type EvalRow } from './lib/pass-rates.ts';
import { refitForRetune } from './lib/score-model.ts';
import { answerCutoff } from '../core/src/qualify/post-score.ts';
import { answerSide } from '../adapters/judge/openai-compatible/src/setup.ts';
import { refitCoinMatchForRetune, withCoinMatch } from './lib/coin-match-fit.ts';
import { refitJunkForRetune } from './lib/junk-filter.ts';
import { refitCoinModelForRetune } from './lib/coin-model.ts';
import { PgCoinedVideoRepo, type Db } from '../store/src/index.ts';
import { refreshSet } from './lib/coined-videos.ts';
import { recordShortVideoPart, shortVideoPart, type ShortVideoPart } from './lib/short-video-tune.ts';
import { sideBySide, sideBySideLines } from './lib/side-by-side.ts';
import { RULEBOOK_HEADING, countCalls, withOwnerRules, writeRulebook } from './lib/rulebook.ts';

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
/* Twelve hours: the narrative calls since the slot before (08:00 and 20:00 are twelve hours apart). */
const NARRATIVE_LESSONS_MS = 43_200_000;
/* A day, for the owner's gate's junk window (Policy.learning.ownerGate.junkDays). */
const DAY_MS = 86_400_000;

const LABELS = new URL('../eval/src/feed/live-labels.json', import.meta.url);
const command = process.argv[2] ?? '';
const flag = (f: string) => process.argv.includes(f);
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
/* ★ THE RE-TUNE'S RESERVE (Policy.budget.learningLines.retuneReserveUsd) is for the scheduled run:
   `run` and `due`. `measure` is a test like any other tool, held to the tests' own day. */
const LEARNING_USE = command === 'measure' ? 'test' : 'retune';
const log = (level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, msg, job: 'retune', ...fields }));
/* ★ A SUPPLIER THAT REFUSES FOR BILLING is logged at error level once per vendor per run, and named
   in the run's reason (and so in the owner's summary alert) instead of "outage or the learning
   line": an empty account is the owner's to top up, not a bad minute. The runner sends the
   supplier_account push; this job only says it clearly. */
const billingRefused = new Map<string, string>();
onOutOfCredit({
  refused: (e) => {
    if (billingRefused.has(e.vendor)) return;
    billingRefused.set(e.vendor, e.reason);
    log('error', 'supplier out of credit', { vendor: e.vendor, endpoint: e.endpoint, reason: e.reason, status: e.status ?? null });
  },
});
const unansweredCause = (): string =>
  billingRefused.size === 0 ? 'outage or the learning line' : `refused for billing: ${[...billingRefused].map(([v, r]) => `${v} ${r}`).join(', ')}`;
/* A read of a table this database has not been migrated to yet is empty — for `measure`, which
   must work before 0054–0057 are applied. A write to one still fails the run. */
const soft = <T,>(read: Promise<T>, empty: T): Promise<T> => read.catch((e: unknown) => (isMissingTable(e) ? empty : Promise.reject(e)));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
/* `--model=<id>` (measure only) grades with another router model than OPEN_JUDGE_MODEL, and so on the router, not the second host. */
const env = { ...process.env, ...(url === undefined ? {} : { DATABASE_URL_INTERNAL: url }), ...(command === 'measure' && arg('model') !== null ? { OPEN_JUDGE_MODEL: arg('model') ?? '', OPEN_JUDGE_POST_FIRST: 'router' } : {}) };

/* `--floor=<gold>,<junk>,<missed>`: the bar to keep for a switch of judge (eval examples.ts parseFloor). */
const FLOOR = parseFloor(arg('floor'));

/**
 * Lead time on the last three days' coined posts (tools/lib/lead-time.ts): the main number from
 * 2026-10-15, in every re-tune's summary and status. A failed read is said, never a zero.
 */
const LEAD_DAYS = 3;
async function readLead(): Promise<{ facts: ReturnType<typeof leadFacts>; lines: readonly string[] } | { error: string }> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-retune-lead' });
  try {
    const summary = summarise(await leadRows(asDb(pool), new Date(Date.now() - LEAD_DAYS * 86_400_000)));
    return { facts: leadFacts(summary), lines: leadLines(summary) };
  } catch (e) {
    return { error: errText(e) };
  } finally {
    await pool.end();
  }
}

/** The posts the owner saw and kept in the last `seenKept.lookbackMs`, with their words and picture. */
async function keptPosts(db: Db, nowMs: number): Promise<readonly KeptPost[]> {
  const K = P.learning.seenKept;
  const now = new Date(nowMs);
  const kept = await new PgOwnerSeenRepo(db).keptIds({ since: new Date(nowMs - K.lookbackMs), until: now, keepWindowMs: K.keepWindowMs, now });
  if (kept.size === 0) return [];
  const rows = await db.query<{ item_id: string; body: string | null; media: unknown }>(`select item_id, body, media from public.item where item_id = any($1::text[])`, [[...kept.keys()]]);
  return rows.map((r) => ({ itemId: r.item_id, text: r.body ?? '', imageUri: pictureOf(r.media)?.uri ?? null, firstSeenAt: kept.get(r.item_id) ?? 0 }));
}

async function withRepo<T>(f: (repo: PgLearningRepo, owner: PgOwnerAlertRepo, labels: PgLabelEmbeddingRepo, db: Db) => Promise<T>): Promise<T> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-retune' });
  try {
    return await f(new PgLearningRepo(asDb(pool)), new PgOwnerAlertRepo(asDb(pool)), new PgLabelEmbeddingRepo(asDb(pool)), asDb(pool));
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
    const shared = await openSharedMeter(unheld.length * X_USD_PER_POST * 2, env, 'learning', LEARNING_USE);
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
  /* For the rulebook's counts (tools/lib/rulebook.ts): every call's label, source and own note. */
  const notes: { label: 'meme' | 'not'; from: string; note: string | null }[] = [];
  for (const p of labels) {
    const label = p.ownerLabel ?? p.label;
    if (label !== 'meme' && label !== 'not') continue;
    calls.push({ itemId: p.itemId, text: p.text, imageUri: p.imageUri, label, why: p.why, at: postedAtOf(p.itemId), from: 'labels' });
    notes.push({ label, from: 'labels', note: p.why });
  }
  for (const t of await soft(repo.postCalls(), [])) {
    if (t.body === null || t.body.trim() === '') continue;
    const why = t.note ?? (t.verdict === 'meme' ? "the owner's call: people could coin this" : "the owner's call: nothing to coin");
    calls.push({ itemId: t.itemId, text: t.body, imageUri: pictureOf(t.media)?.uri ?? t.shownPicture, label: t.verdict, why, at: t.at.getTime(), from: 'tap' });
    notes.push({ label: t.verdict, from: 'tap', note: t.note });
  }
  const missedDiagnoses: Record<string, number> = {};
  for (const m of await soft(repo.missedPosts(), [])) {
    calls.push({ itemId: m.itemId, text: m.body, imageUri: pictureOf(m.media)?.uri ?? null, label: 'meme', why: 'a post the owner says we missed: people coined or could coin it', at: m.at.getTime(), from: 'missed' });
    notes.push({ label: 'meme', from: 'missed', note: null });
    missedDiagnoses[m.diagnosis] = (missedDiagnoses[m.diagnosis] ?? 0) + 1;
  }
  const names: NameCall[] = (await soft(repo.nameCalls(), [])).flatMap((n) => (n.body === null ? [] : [{ itemId: n.itemId, text: n.body, name: n.name, verdict: n.verdict, betterName: n.betterName, at: n.at.getTime() }]));
  return { calls, names, labelsSha, notes, missedDiagnoses };
}

/* ── a run ───────────────────────────────────────────────────────────────────────────────────── */

type G = 'gold' | 'auto' | 'live-not' | 'missed' | 'missed-taught' | 'tt-coined' | 'untapped';

/* ── the TikTok side of the judge's test ─────────────────────────────────────────────────────── */

const TT = 'tiktok:';
/** Coined TikToks caught, TikTok junk let through, and which missed TikToks were caught, in one grading. */
function tiktokSide(rows: readonly GradedPost[], held: readonly string[]) {
  const answered = rows.filter((r) => r.coinable !== null && r.id.startsWith(TT));
  const coined = answered.filter((r) => r.group === 'tt-coined' || r.group === 'gold' || r.group === 'missed');
  const junk = answered.filter((r) => r.group === 'live-not');
  return {
    coined: { passed: coined.filter((r) => caught(r, held) === true).length, tested: coined.length },
    junk: { passed: junk.filter((r) => caught(r, held) === true).length, tested: junk.length },
    missed: new Map(answered.filter((r) => r.group === 'missed' || r.group === 'missed-taught').map((r) => [r.id, caught(r, held)] as const)),
  };
}

async function run(slot: Date, opts: { readonly dry: boolean; readonly force: boolean; readonly record: boolean; readonly baseline?: boolean; readonly rulesOnly?: boolean; readonly maxBatch?: number; readonly rowsFile?: string; readonly extraInstructions?: string; readonly kindCoinable?: boolean; readonly noAuto?: boolean; readonly composeOnly?: boolean; readonly maxNegatives?: number }): Promise<void> {
  await withRepo(async (repo, owner, labelRepo, db) => {
    if (opts.record && !(await repo.claimSlot(slot, new Date()))) {
      log('info', 'this slot already ran', { slot: slot.toISOString() });
      return;
    }
    const end = (outcome: 'skipped' | 'kept' | 'applied' | 'dry' | 'failed', versionId: number | null, detail: string | null, costUsd: number | null) =>
      opts.record ? repo.endRun(slot, { outcome, versionId, detail, costUsd, endedAt: new Date() }) : Promise.resolve();
    try {
      const gold = opts.record ? await growGold(repo) : { added: 0, waiting: 0, xUsd: 0 };
      if (opts.record) log('info', 'gold from live', { slot: slot.toISOString(), added: gold.added, waiting: gold.waiting, xUsd: gold.xUsd });
      /* The For You order model (tools/lib/score-model.ts): free, so refitted at every slot before the skip below; never fails the run. */
      /* The coin-matching weights are refitted on the owner's coin labels and gold at every slot too, and
         their score rides in the same order log and alert facts (tools/lib/coin-match-fit.ts). */
      const order = withCoinMatch(await refitForRetune(url, { record: opts.record && !opts.dry }), await refitCoinMatchForRetune(url, { record: opts.record && !opts.dry }));
      log('info', 'order model refitted', { slot: slot.toISOString(), ...order.log });
      /* The junk filter before the post judge (tools/lib/junk-filter.ts): free, refitted at every slot, never fails the run. */
      const junk = await refitJunkForRetune(url, { record: opts.record && !opts.dry });
      log('info', 'junk filter refitted', { slot: slot.toISOString(), ...junk.log });
      /* Our own coin model, the safety net (tools/lib/coin-model.ts): every target in Policy.judge.coinModel.targets, free, refitted at the slots
         Policy.judge.coinModel.refitAt names (the owner: the 20:00 one), replaced only when it catches
         more held-out missed posts with no more junk; never fails the run. */
      const slotClock = new Intl.DateTimeFormat('en-GB', { timeZone: L.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(slot);
      if (P.judge.coinModel.refitAt.includes(slotClock)) {
        const net = await refitCoinModelForRetune(url, { record: opts.record && !opts.dry });
        log('info', 'coin model refitted', { slot: slot.toISOString(), ...net.log });
      }

      const { calls, names, labelsSha, notes, missedDiagnoses } = await ownerCalls(repo);
      const last = await soft(repo.lastBuilt(), null);
      const newest = await soft(repo.newestInput(), null);
      const nothingNew = last !== null && last.labelsSha === labelsSha && (newest === null || (last.inputsThrough !== null && newest <= last.inputsThrough));
      if (nothingNew && !opts.force) {
        log('info', 'retune skipped: nothing new since the last block', { slot: slot.toISOString(), lastVersion: last.versionId });
        await end('skipped', null, 'nothing new since the last block', gold.xUsd);
        return;
      }

      const additions = await soft(repo.goldAdditions(), []);
      /* ★ HAND GOLD AND AUTO GOLD. Hand gold — the gold sheets, the owner's missed posts, and the
         owner's own list (eval/src/gold/hand-gold.json: approved recall additions, or posts we
         hold) — is the gate. Every other recall addition is auto gold: a creator linking a post
         does not prove the post is a meme origin, so it is graded and reported, never gated. */
      const listed = handGoldIds();
      const origins = goldOriginPosts();
      /* ★ THE OWNER'S COIN LABELS. "This is the coin" on a post is a confirmed coined post: it joins
         hand gold for the run, with its coin. So is the owner's pick after "Wrong coin" (`wrong` WITH a
         coin), which `matchCalls` already reads as `right` — unless it takes back a coin an earlier
         `right` named (store owner-coin-calls.ts). "No coin is from this" is a matching negative only —
         it says nothing about whether the post could be coined, so it is never a judge negative. */
      const coinCalls = await soft(repo.matchCalls(), []);
      const coinRight = coinCalls.filter((m) => m.verdict === 'right' && m.coinAddress !== null);
      /* ★ COINED POSTS TAUGHT AS YES (Policy.learning.coinedYes; eval examples.ts `coinedYes`). Never
         a post the owner called or one this run can test as hand gold: taught, it would leave the
         gate's test. A post the owner confirmed a coin for is hand gold, so it stays tested — the
         owner's coins count toward a post's coins, but such a post is never taught this way. */
      const handGoldIdsNow = new Set([
        ...origins.map((o) => o.id), ...listed, ...coinRight.map((m) => m.itemId),
        ...additions.filter((g) => !(g.source === 'recall' && !listed.has(g.itemId))).map((g) => g.itemId),
      ]);
      const C = L.coinedYes;
      const coinedRows = C.on ? await soft(repo.coinedPosts({ source: 'x', minCoins: C.minCoins, lateMs: C.lateMs, deployerWindowMs: C.deployerWindowMs, deployerMinPosts: C.deployerMinPosts }), []) : [];
      const coinedTaught = coinedYes(
        coinedRows.map((r) => ({ itemId: r.itemId, text: r.body, imageUri: pictureOf(r.media)?.uri ?? null, postedAt: r.postedAt.getTime(), coins: r.coins, firstLateAt: r.firstLateAt.getTime(), kind: r.kindLabel, names: r.names })),
        P,
        new Set([...calls.map((c) => c.itemId), ...handGoldIdsNow]),
      );
      /* ★ THE OWNER'S SOFT YES (Policy.learning.seenKept; eval examples.ts `keptYes`): posts he saw and
         kept, never one he called, one this run tests as hand gold, or one on his fixed test set. Before
         0098 there are none, and the block is what it was. */
      const K = L.seenKept;
      const keptRows = K.teach ? await soft(keptPosts(db, Date.now()), []) : [];
      const keptTaught = keptYes(keptRows, P, new Set([...calls.map((c) => c.itemId), ...handGoldIdsNow, ...OWNER_SPLIT.test]));
      /* ★ THE OWNER'S GATE'S JUNK SET (Policy.learning.ownerGate): the owner's current "Not a meme"
         calls on posts first shown on For You in the last `junkDays` days. Those that are news (a
         `newsKinds` label) or carry no picture are never taught while in the window, so every one of
         them is tested; the rest are split by hash as every call is, and only the held-out half is
         junk (a taught post graded is its own answer key). */
      const OG = L.ownerGate;
      const shown = OG.on ? await soft(repo.shownSince(OG.junkFeed, new Date(Date.now() - OG.junkDays * DAY_MS)), []) : [];
      const shownKind = new Map(shown.map((r) => [r.itemId, r.kind] as const));
      const recentNots = currentCalls(calls).filter((c) => c.label === 'not' && shownKind.has(c.itemId));
      const newsKinds = new Set(OG.newsKinds.map((k) => k.toUpperCase()));
      const newsOrText = new Set(recentNots.filter((c) => c.imageUri === null || newsKinds.has((shownKind.get(c.itemId) ?? '').toUpperCase())).map((c) => c.itemId));
      const examplesOnly = buildBlock(calls, names, L.maxExamples, { alwaysTeach: alwaysTeachIds(P), alwaysTest: OWNER_SPLIT.test, neverTeach: [...newsOrText], coinedYes: coinedTaught, keptYes: keptTaught, keptBeforeCoined: !K.afterCoined });
      /* ★ THE OWNER'S RULEBOOK (tools/lib/rulebook.ts): written from the block's own lines, the
         standing decisions and counts over every input, then put in the block, so the test below
         tests both. Not written for `compose` (free) or `--rules-only` (no block); a rulebook that
         cannot be written is left out and said. */
      let rulebook: { readonly model: string; readonly rules: number; readonly ownerRules: number; readonly usd: number } | { readonly why: string; readonly ownerRules: number; readonly usd: number } | null = null;
      let rules: string | null = null;
      if (L.rulebook.on && opts.composeOnly !== true && opts.rulesOnly !== true) {
        const shared = await openSharedMeter(L.rulebook.maxOutputTokens * 0.000_01 + 0.05, env, 'learning', LEARNING_USE);
        try {
          const w = await writeRulebook({ blockText: examplesOnly.text, missedCounts: missedDiagnoses, ...countCalls(notes, P) }, { env, meter: shared.meter, policy: P });
          /* The owner's own rules on top, the written ones after (tools/lib/rulebook.ts withOwnerRules). */
          rules = withOwnerRules(w.rules, P);
          rulebook = w.rules === null ? { why: w.why, usd: w.usd, ownerRules: L.rulebook.ownerRules.length } : { model: w.model, rules: w.rules.split('\n').length, ownerRules: L.rulebook.ownerRules.length, usd: w.usd };
        } finally {
          await shared.close();
        }
        log(rulebook !== null && 'why' in rulebook ? 'warn' : 'info', rulebook !== null && 'why' in rulebook ? "retune rulebook not written; the block is tested with the owner's own rules only" : 'retune rulebook written', { slot: slot.toISOString(), ...rulebook });
      }
      const block = withRulebook(examplesOnly, RULEBOOK_HEADING, rules);
      /* `--rules-only` teaches nothing, so nothing is held out: every missed post is tested. */
      const allMissed = currentCalls(calls).filter((c) => c.from === 'missed' && c.label === 'meme');
      const testMissed = opts.rulesOnly === true ? allMissed : block.testMissed;
      const taught = new Set(opts.rulesOnly === true ? [] : block.exampleIds);
      const testMissedIds = new Set(testMissed.map((m) => m.itemId));
      const inAdditions = new Set(additions.map((g) => g.itemId));
      const listedHeld = await soft(repo.heldPosts([...listed].filter((id) => !inAdditions.has(id) && !taught.has(id) && !testMissedIds.has(id))), []);
      /* Every missed post the owner gave, taught or held out: the held-out half is the `missed`
         group; the taught half is graded only for the regression rule. */
      const missedTaught = allMissed.filter((c) => !testMissedIds.has(c.itemId));
      const posts: EvalPost<G>[] = [
        ...origins,
        ...additions
          .filter((g) => !taught.has(g.itemId) && !testMissedIds.has(g.itemId) && !(opts.noAuto === true && g.source === 'recall' && !listed.has(g.itemId)))
          .map((g) => ({ group: g.source === 'recall' && !listed.has(g.itemId) ? ('auto' as const) : ('gold' as const), id: g.itemId, kind: `added ${g.addedOn} (${g.source})`, text: g.postText, imageUri: g.imageUri, coinRef: g.coinMint })),
        ...listedHeld.map((h) => ({ group: 'gold' as const, id: h.itemId, kind: "the owner's hand-gold list", text: h.body, imageUri: pictureOf(h.media)?.uri ?? null })),
        ...(opts.maxNegatives === undefined ? block.testNegatives : [...block.testNegatives].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity)).slice(0, opts.maxNegatives)).map((c) => ({ group: 'live-not' as const, id: c.itemId, kind: c.why, text: c.text, imageUri: c.imageUri })),
        ...testMissed.map((c) => ({ group: 'missed' as const, id: c.itemId, kind: 'missed', text: c.text, imageUri: c.imageUri })),
        ...missedTaught.map((c) => ({ group: 'missed-taught' as const, id: c.itemId, kind: 'missed (taught)', text: c.text, imageUri: c.imageUri })),
      ];
      /* The owner's "meme" calls the cap left out of the block, and the posts the owner confirmed a
         coin for: hand gold, unless already in the test or taught. A "meme" call whose note starts
         "teaching example" (e.g. a post from before a source was watched) teaches the judge but is
         never gold, by the owner's choice. */
      const inTest = new Set(posts.map((p) => p.id));
      const fresh = (id: string) => !inTest.has(id) && !taught.has(id);
      const tappedMemes = block.testMemes.filter((c) => fresh(c.itemId) && !/^teaching example/i.test(c.why ?? ''));
      for (const c of tappedMemes) { posts.push({ group: 'gold', id: c.itemId, kind: "the owner's meme call", text: c.text, imageUri: c.imageUri }); inTest.add(c.itemId); }
      const coinGold = await soft(repo.heldPosts(coinRight.map((m) => m.itemId).filter(fresh)), []);
      for (const h of coinGold) posts.push({ group: 'gold', id: h.itemId, kind: "the owner's coin call: this is the coin", text: h.body, imageUri: pictureOf(h.media)?.uri ?? null, coinRef: coinRight.find((m) => m.itemId === h.itemId)?.coinAddress ?? h.itemId });
      for (const h of coinGold) inTest.add(h.itemId);
      /* The TikTok training set's coined videos with words (Policy.learning.shortVideo.gateOn): graded
         beside the test for the TikTok gate, never in X's rates. Words only: a re-fetched video's
         still is not kept. */
      if (L.shortVideo.gateOn) {
        for (const v of await new PgCoinedVideoRepo(db).all()) {
          if (v.caption === null || v.caption.trim() === '' || !fresh(v.itemId)) continue;
          posts.push({ group: 'tt-coined', id: v.itemId, kind: `coined TikTok (${v.coinName ?? v.firstCoin})`, text: v.caption, imageUri: null, coinRef: v.firstCoin });
          inTest.add(v.itemId);
        }
      }
      /* ★ JUNK (B), THE OWNER'S SECOND MEASURE (tools/lib/junk-sample.ts, Policy.learning.ownerGate.untapped):
         a seeded sample of untapped For You posts from the window, labelled from the old judges'
         answers; only its old-label "not" posts are graded, in their own group, never in a rate. */
      const sample = OG.on ? drawSample(await soft(readUntapped(repo, P, new Date(Date.now() - OG.junkDays * DAY_MS), pictureOf), []), P, new Set([...inTest, ...taught])) : [];
      for (const u of sample) {
        if (u.old.label !== 'not') continue;
        posts.push({ group: 'untapped', id: u.itemId, kind: 'untapped For You post, old label not', text: u.text, imageUri: u.imageUri });
        inTest.add(u.itemId);
      }
      const unclearPosts = sample.filter((u) => u.old.label === 'unclear');
      if (arg('unclear') !== null) writeFileSync(arg('unclear') ?? '', unclearMarkdown(sample, new Date()));
      const composition = {
        examples: block.exampleIds.length, tapsTaught: block.taps.taught, tapsTested: block.taps.tested,
        handGold: posts.filter((p) => p.group === 'gold' || p.group === 'missed').length, ownerMemeCallsTested: tappedMemes.length, coinRightAddedToGold: coinGold.length,
        coinRight: coinCalls.filter((m) => m.verdict === 'right').length, coinNone: coinCalls.filter((m) => m.verdict === 'none').length,
        liveNegatives: block.testNegatives.length, missedTested: testMissed.length, autoGold: posts.filter((p) => p.group === 'auto').length,
        tiktokCoined: posts.filter((p) => p.group === 'tt-coined').length,
        coinedYesFound: coinedRows.length, coinedYesAfterTest: coinedTaught.length, coinedYesTaught: block.used.coined, keptYesFound: keptRows.length, keptYesTaught: block.used.kept, ownerYes: `${block.owner.yesTaught}/${block.owner.yesPool}`, ownerNo: `${block.owner.noTaught}/${block.owner.noPool}`,
        alwaysTaughtInBlock: `${alwaysTeachIds(P).filter((id) => block.exampleIds.includes(id)).length}/${alwaysTeachIds(P).length}`,
        ownerTest: OWNER_SPLIT.test.length, ownerTaught: alwaysTeachIds(P).filter((id) => block.exampleIds.includes(id)).length,
        recentNots: recentNots.length, recentNotsHeldOut: block.testNegatives.filter((c) => shownKind.has(c.itemId)).length, recentNewsOrText: newsOrText.size,
        untappedSample: sample.length, untappedNot: sample.filter((u) => u.old.label === 'not').length, untappedMeme: sample.filter((u) => u.old.label === 'meme').length, untappedUnclear: unclearPosts.length,
      };
      if (opts.composeOnly === true) {
        console.log(JSON.stringify({ msg: 'retune composition (nothing asked, nothing written)', slot: slot.toISOString(), ...composition }, null, 1));
        return;
      }
      /* The kind answers one grading gets are reused by the next this run, so the block, the
         baseline and the judge in use are held back on the same labels and pay for them once. */
      const kinds = new Map<string, string>();
      const maxBatch = opts.maxBatch ?? P.qualify.batchSize;
      const held = P.judge.heldKinds;

      /* The open judge must be there before anything is read for it: no key, no run. */
      const grader = await openGradeSetup(env);
      const judgeModel = grader.model.id;
      /* The grading model as its answers are filed (adapter `judgeModelKey`): whose cutoff this run measures. */
      const judgeKey = `judge:${grader.setup.vendor}/${grader.model.id}`;
      log('info', 'retune testing a block', { slot: slot.toISOString(), posts: posts.length, handGold: posts.filter((p) => p.group === 'gold').length, autoGold: posts.filter((p) => p.group === 'auto').length, liveNegatives: block.testNegatives.length, missed: testMissed.length, missedTaught: missedTaught.length, heldKinds: held, maxBatch, rulesOnly: opts.rulesOnly === true, examples: block.exampleIds.length, coinedYes: block.used.coined, chars: block.text.length });
      /* Bounded by the learning book's lines, not a guess per post: the test either fits what is left
         of them (mustFit) or is not started. */
      /* ★ A PICTURE IS EMBEDDED ONCE PER RUN. The block's test and the baseline grade the same
         posts minutes apart, and two embeddings of one file minutes apart came back bit-identical
         (2026-10-13), so the second grading reads the first's vectors. Not across runs: vectors
         stored hours earlier differed by up to 0.0003 cosine, which is not provably the same answer. */
      const runVectors = new Map<string, readonly number[]>();
      const vectors = {
        stored: async (uris: readonly string[]) => new Map(uris.flatMap((u) => { const v = runVectors.get(u); return v === undefined ? [] : [[u, v] as const]; })),
        keep: async (_id: string, uri: string, _space: string, v: readonly number[]) => void runVectors.set(uri, v),
      };
      let spentUsd = 0;
      const coined = await repo.coinedPictureVectors();
      /* ★ THE OWNER'S LABELS AS PRECEDENT, AS LIVE: every test post is sent with its closest labelled
         posts and held when very close to a "Not a meme" one (tools/lib/pass-rates.ts `precedents`).
         No stored labels (0069 not applied): graded without, as live then runs. */
      const labelled = await soft(labelRepo.all(POST_SPACE), []);
      const precedents = labelled.length === 0 ? null : { labels: labelled };
      /* One grading on the learning book. The kind labels it learns are kept, so a later grading
         this run splits gold exactly as this one did and does not pay to ask again. */
      const grade = async (of: readonly EvalPost<G>[], block: string | null) => {
        const examples = [block, opts.extraInstructions ?? null].filter((x): x is string => x !== null && x.trim() !== '').join('\n\n') || null;
        const shared = await openSharedMeter(P.budget.learningLines.dailyUsd, env, 'learning', LEARNING_USE);
        try {
          const out = await gradePosts(of, { env, meter: shared.meter, examples, batch: true, mustFit: true, coined, vectors, knownKinds: kinds, maxBatch, precedents, ...(opts.kindCoinable === true ? { kindAlso: (p: EvalPost<string>) => (p as EvalRow<string>).coinable === true } : {}) });
          for (const r of out.rows) if (r.postKind !== null) kinds.set(r.id, r.postKind);
          return out;
        } finally {
          spentUsd += shared.meter.spentUsd();
          await shared.close();
        }
      };
      /* ★ GRADED AS LIVE DECIDES: the judge, or (kind not held) other accounts' crypto signal; a shill
         never (core passesWithSignal). The signal is the post's crypto-attention read; a post with
         no read carrying the own/others split is decided by the judge alone, and counted. */
      const signals = await soft(repo.cryptoSignals(posts.map((p) => p.id)), new Map<string, { readonly others: boolean; readonly shill: boolean }>());
      const noFacts = posts.filter((p) => !signals.has(p.id) && p.group !== 'missed-taught').length;
      const graded = (rows: readonly EvalRow<G>[]): GradedPost[] =>
        rows.map((r) => ({
          id: r.id, group: r.group, coinable: r.coinable, firstPass: r.firstPass, kind: r.postKind, signal: signals.get(r.id) ?? null, similarity: r.similarity,
          answer: r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt as JudgeEvidence, proposedName: r.name },
        }));
      const GROUPS = { hand: ['gold', 'missed'], auto: 'auto', negatives: 'live-not', missed: 'missed' } as const;

      /* ★ THE SETUP LIVE NOW, graded on the same posts in the same run (its applied block, or its
         rules alone when none is): the block must be no worse on any of the three; a missed post it
         catches that the block does not is named. Graded beside the block's test, not after it, so a
         run still finishes inside `startAheadMs`. Not needed when the block IS the live one, and
         `--rules-only` has nothing to compare. */
      const inUse = await soft(repo.latestApplied(), null);
      const compare = opts.rulesOnly !== true && inUse?.text !== block.text;
      const wantBase = opts.baseline === true && opts.rulesOnly !== true;
      const [tested, nowGraded, baseGraded] = await Promise.all([
        grade(posts, opts.rulesOnly === true ? null : block.text),
        compare ? grade(posts, inUse?.text ?? null) : Promise.resolve(null),
        wantBase && !(compare && inUse === null) ? grade(posts, null) : Promise.resolve(null),
      ]);
      const rows = tested.rows;
      /* `--baseline`: the same test posts graded by the judge's rules alone (no learned examples),
         so the owner's table compares like with like. Paid on the learning book. */
      const baseRows: readonly EvalRow<G>[] | null = wantBase ? (baseGraded?.rows ?? (inUse === null ? (nowGraded?.rows ?? null) : null)) : null;
      const baseline = baseRows === null ? null : ratesOf(graded(baseRows), held, GROUPS);
      if (baseline !== null) log('info', 'retune baseline: the same posts, rules alone', { slot: slot.toISOString(), handGold: baseline.hand, liveNegatives: baseline.negatives, missed: baseline.missed, autoGold: baseline.auto });

      const nowRows = opts.rulesOnly === true ? null : inUse?.text === block.text ? rows : (nowGraded?.rows ?? null);
      /* The setup live now as live decides: its block at ITS cutoff (null: the policy bar). */
      /* ★ HELD AS THE PROJECTOR HOLDS THIS MODEL'S ANSWERS (services/project/src/judge-cutoff.ts, core
         `answerCutoff`): the block's own cutoff when it was chosen on this model, else this model's
         settings judge.cutoffs number, else the block's. */
      const liveCutoff = answerCutoff(P, { cutoff: inUse?.cutoff ?? null, chosenOn: inUse?.cutoffModel ?? null }, answerSide(judgeKey));
      const policyBar = Math.min(...Object.values(P.qualify.minJudgeConfidence));
      const liveGraded = nowRows === null ? null : atCutoff(graded(nowRows.filter((r) => r.coinable !== null)), liveCutoff, P);
      /* The open judge with the block in use, graded now: reported always, and the bar to keep
         unless `--floor` gives one (the switch of judge, see parseFloor). */
      const liveGrading = liveGraded === null ? null : ratesOf(liveGraded, held, GROUPS);
      const liveRates = liveGrading === null ? null : FLOOR === null ? liveGrading : { ...liveGrading, ...FLOOR };
      const liveCaught = nowRows === null ? null : missedCaught(atCutoff(graded(nowRows), liveCutoff, P), held);
      const costUsd = spentUsd + gold.xUsd + (rulebook?.usd ?? 0);

      /* Unanswered posts are out of every rate, and stop the block being applied. */
      const answered = rows.filter((r) => r.coinable !== null);
      const unanswered = rows.length - answered.length;
      const mineGraded = graded(answered);
      /* ★ THE TIKTOK GATE (gateOn): the block against the judge in use on TikTok's own posts, at each cutoff tried. */
      const liveTt = L.shortVideo.gateOn && liveGraded !== null ? tiktokSide(liveGraded, held) : null;
      const ttAt = (at: readonly GradedPost[]) => {
        if (liveTt === null) return null;
        const mine = tiktokSide(at, held);
        const lost = [...liveTt.missed].filter(([id, c]) => c === true && mine.missed.get(id) === false).map(([id]) => id);
        const guard = mine.coined.passed >= liveTt.coined.passed && mine.junk.passed <= liveTt.junk.passed && lost.length === 0;
        const beat = mine.coined.passed > liveTt.coined.passed && mine.junk.passed < liveTt.junk.passed && lost.length === 0;
        const why = guard ? null : `TikTok: coined ${mine.coined.passed}/${mine.coined.tested} against ${liveTt.coined.passed} live, junk ${mine.junk.passed}/${mine.junk.tested} against ${liveTt.junk.passed} live, ${lost.length} missed TikTok(s) lost`;
        return { coined: mine.coined, junk: mine.junk, liveCoined: liveTt.coined, liveJunk: liveTt.junk, lost, held: guard, beat, why };
      };
      /* ★ THE CUTOFF SWEEP, then the gate at the cutoff it chose (see the header). Without a live
         grading (the measure-only paths) nothing is compared and the old gate refuses as before. */
      const choice: CutoffChoice | null = liveRates === null || liveCaught === null ? null : sweepCutoff({
        /* ★ FROM THE POLICY BAR: a cutoff is a model's own scale, and the block in use may carry a
           cutoff tuned on another model's answers (version 9's 0.71 was the main judge's). */
        rows: mineGraded, live: liveRates, liveCaught, from: policyBar, held, groups: GROUPS, policy: P,
        extra: (at) => ttAt(at)?.why ?? null,
      });
      /* ★ THE OWNER'S GATE (Policy.learning.ownerGate, the owner 2026-10-17): the sweep above still
         runs and proposes a cutoff, but these three conditions decide — more of the fixed test set
         caught than live, hand gold not lower, junk at most two points up on the recent For You
         "Not a meme" taps the block did not teach. Both sides at their own cutoffs, as live holds them. */
      const ownerSets: OwnerSets = { test: new Set(OWNER_SPLIT.test), untaught: new Set(OWNER_SPLIT.untaughtMisses), junk: new Set(recentNots.map((c) => c.itemId)), untapped: 'untapped', hand: GROUPS.hand, negatives: GROUPS.negatives };
      const liveOwner: OwnerSide | null = liveGraded === null ? null : ownerSide(liveGraded, held, ownerSets);
      const ownerPick: OwnerPick | null = !OG.on || choice === null || liveOwner === null ? null : pickOwnerCutoff(
        choice.points.map((p) => ({ cutoff: p.cutoff, side: ownerSide(atCutoff(mineGraded, p.cutoff, P), held, ownerSets), extra: p.extra })),
        liveOwner, choice.rule === 'refused' ? null : choice.cutoff, OG.maxJunkRise,
      );
      /* The cutoff the block goes out with (null: refused), and the one its numbers are reported at. */
      const appliedCutoff: number | null = ownerPick !== null ? ownerPick.cutoff : (choice?.cutoff ?? null);
      const reportCutoff: number | null = choice === null ? null : (appliedCutoff ?? choice.point.cutoff);
      const chosenAt = reportCutoff === null ? mineGraded : atCutoff(mineGraded, reportCutoff, P);
      const rates = ratesOf(chosenAt, held, GROUPS);
      const regressed: readonly string[] = choice === null || liveCaught === null ? [] : regressions(liveCaught, missedCaught(chosenAt, held));
      const tt = ttAt(chosenAt);
      const baseGate = gate({ ...rates, regressions: regressed, live: liveRates }, L);
      /* The cutoff travels with the block (0086). A cutoff above the policy bar that cannot be stored is a refusal. */
      const needsCutoff = appliedCutoff !== null && appliedCutoff > policyBar;
      const canStore = needsCutoff ? await repo.hasJudgeCutoff().catch(() => false) : true;
      const decidedBy = ownerPick !== null ? "the owner's gate" : choice === null ? 'the gate' : `rule ${choice.rule}`;
      const xVerdict = choice === null
        ? baseGate
        : (ownerPick !== null ? ownerPick.cutoff === null : choice.rule === 'refused')
          ? { apply: false, why: ownerPick !== null ? (ownerPick.why ?? "the owner's gate did not hold") : choice.why, goals: baseGate.goals }
          : !canStore
            ? { apply: false, why: `${decidedBy} chose cutoff ${appliedCutoff}, but migration 0086 is not applied, so the cutoff cannot be stored with the block`, goals: baseGate.goals }
            : { apply: true, why: null, goals: baseGate.goals };
      const verdict = xVerdict;
      const fmtPoint = (p: CutoffPoint) => `${p.cutoff.toFixed(2)} gold ${p.hand.passed}/${p.hand.tested} junk ${p.negatives.passed}/${p.negatives.tested} missed ${p.missed.passed}/${p.missed.tested} lost ${p.lost.length}${p.extra === null ? '' : ' (TikTok gate fails)'}`;
      const ofN0 = (r: Rate) => `${r.passed}/${r.tested}`;
      const cutoffText = choice === null || liveRates === null
        ? 'cutoff: no live grading to compare with'
        : `cutoff: ${appliedCutoff === null ? `refused (${ownerPick === null ? 'no cutoff' : "the owner's gate held at no cutoff"} from ${choice.point.cutoff.toFixed(2)} to ${L.cutoffMax}; sweep rule ${choice.rule})` : `${ownerPick === null ? `rule ${choice.rule}` : `the owner's gate (sweep rule ${choice.rule}${choice.cutoff === null ? '' : ` ${choice.cutoff.toFixed(2)}`})`}, ${appliedCutoff.toFixed(2)} (live cutoff ${(liveCutoff ?? policyBar).toFixed(2)}${FLOOR === null ? '' : ', floor given'})`}; new gold ${ofN0(rates.hand)} vs live ${ofN0(liveRates.hand)}, junk ${ofN0(rates.negatives)} vs live ${ofN0(liveRates.negatives)}, missed ${ofN0(rates.missed)} vs live ${ofN0(liveRates.missed)}`;
      /* ★ THE OWNER'S TABLE, for the owner to relay: caught of the untaught misses and of the fixed test
         set, gold, junk (live beside each) and the run's cost, and how the junk set was made. */
      const junkNews = rows.filter((r) => r.group === GROUPS.negatives && r.coinable !== null && newsOrText.has(r.id)).length;
      const bRose = ownerPick === null || liveOwner === null ? null : junkBRose(ownerPick.side, liveOwner, OG.maxJunkRise);
      const ownerText = ownerPick === null || liveOwner === null
        ? null
        : `owner's gate ${appliedCutoff === null ? 'refused' : `held at cutoff ${appliedCutoff.toFixed(2)}`}: ${ownerLine(ownerPick.side, liveOwner, costUsd)}; junk set: ${ownerPick.side.junk.tested} "Not a meme" taps on For You posts first shown in the last ${OG.junkDays} days that the block did not teach (${junkNews} of them news or text-only, never taught; ${recentNots.length} such taps in all); junk (b) sample: ${sample.length} untapped posts drawn, ${composition.untappedNot} old-label not graded, ${composition.untappedMeme} old-label meme and ${unclearPosts.length} unclear left out${bRose === true ? `; FLAG: junk (b) rose more than ${Math.round(OG.maxJunkRise * 100)} points (junk (a) decides)` : ''}`;
      if (ownerText !== null) log(appliedCutoff === null ? 'warn' : 'info', 'retune owner gate', { slot: slot.toISOString(), line: ownerText, applies: appliedCutoff !== null, why: ownerPick?.why ?? null, cutoff: appliedCutoff, sweepRule: choice?.rule ?? null, sweepCutoff: choice?.cutoff ?? null, mine: ownerPick?.side ?? null, live: liveOwner, maxJunkRise: OG.maxJunkRise, junkSet: ownerPick?.side.junk.tested ?? null, junkBRose: bRose, unclear: unclearPosts.map((u) => u.itemId), junkNewsOrText: junkNews, recentNots: recentNots.length });
      if (choice !== null) log('info', 'retune cutoff sweep', { slot: slot.toISOString(), judge: judgeModel, rule: choice.rule, cutoff: choice.cutoff, strictestKeepingGoldAndMissed: liveRates === null ? null : (strictestKeeping(choice.points, liveRates)?.cutoff ?? null), from: policyBar, floor: FLOOR === null ? null : 'given', openLiveNow: liveGrading === null ? null : { gold: ofN0(liveGrading.hand), junk: ofN0(liveGrading.negatives), missed: ofN0(liveGrading.missed) }, live: liveRates === null ? null : { gold: ofN0(liveRates.hand), junk: ofN0(liveRates.negatives), missed: ofN0(liveRates.missed) }, lostMissed: choice.point.lost, points: choice.points.map(fmtPoint) });
      /* `--rows=<file>`: every graded post's answers, for comparing held-kind sets on one run. */
      if (opts.rowsFile !== undefined) writeFileSync(opts.rowsFile, JSON.stringify(rows.map((r) => ({ id: r.id, group: r.group, coinable: r.coinable, firstPass: r.firstPass, kind: r.postKind, name: r.name, confidence: r.confidence, lookedAt: r.lookedAt, similarity: r.similarity, imageUri: r.imageUri, signal: signals.get(r.id) ?? null, text: r.text.slice(0, 120) })), null, 1));
      const why = unanswered > 0 ? `${unanswered} of ${rows.length} test posts went unanswered (${unansweredCause()})${verdict.why === null ? '' : `; ${verdict.why}`}` : verdict.why;
      const apply = verdict.apply && unanswered === 0 && !opts.dry;
      const before = await soft(repo.appliedExampleIds(), []);
      const delta = changed(before, block.exampleIds);
      const sha = createHash('sha256').update(block.text).digest('hex').slice(0, 16);
      /* The version row's gold columns carry hand gold; auto gold and the regressions are in the
         run's detail, the log and the owner's alert. */
      const version = {
        builtAt: new Date(), text: block.text, sha, exampleIds: block.exampleIds,
        tapsUsed: block.used.taps, missedUsed: block.used.missed, labelsUsed: block.used.labels, namesUsed: block.used.names,
        inputsThrough: newest, labelsSha,
        goldPass: share(rates.hand), goldN: rates.hand.tested, liveNegativePass: share(rates.negatives), liveNegativeN: rates.negatives.tested, missedPass: share(rates.missed), missedN: rates.missed.tested,
        applied: apply, reasonNotApplied: apply ? null : opts.dry ? `dry run${why === null ? ': every gate held' : `: ${why}`}` : why, dry: opts.dry, costUsd,
        /* The chosen cutoff, stored whenever it can be (on a kept or dry row too, for the record). */
        judgeCutoff: needsCutoff && canStore ? choice?.cutoff ?? null : null,
        /* ★ AND WHOSE IT IS (0094): the projector holds only this model's answers to it; the other
           model keeps its own number. Before 0094 none is stored, and each model's number holds. */
        judgeCutoffModel: needsCutoff && canStore && (await repo.hasCutoffModel().catch(() => false)) ? judgeKey : null,
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
      /* ★ The narrative lessons (tools/lib/narrative-lessons.ts): the owner's narrative calls since the
         last slot, counted, and his pairs held against the grouping's meaning bar. A failure is said. */
      const narratives = await narrativeLessons(db, Date.now() - NARRATIVE_LESSONS_MS, P).catch((e: unknown) => {
        log('warn', 'the narrative lessons could not be read; the run goes on', { err: errText(e) });
        return null;
      });
      const narrativesText = narratives === null ? '' : `; ${lessonsLine(narratives)}`;
      const outcome = opts.dry ? 'dry' : apply ? 'applied' : 'kept';
      const lead = await readLead();
      /* The TikTok part: free (but the re-fetch, when on); a failure is said and never fails the X run. */
      let part: ShortVideoPart | null = null;
      try {
        part = await shortVideoPart(db, { env, paid: true, days: LEAD_DAYS, changing: tt === null ? [] : [`judge block ${apply ? 'applied' : 'kept'} with the TikTok gate ${tt.held ? 'holding' : 'not holding'}`] }, P);
        if (opts.record && !opts.dry) await recordShortVideoPart(db, slot, part, tt);
        log('info', 'retune tiktok part', { slot: slot.toISOString(), setSize: part.setSize, added: part.added, stored: part.stored, refetched: part.refetched, bar: part.bar, tags: part.learned.tags, sounds: part.learned.sounds, creators: part.learned.creators.length, judgeGate: tt, biggestGap: part.gapText, table: part.lines });
      } catch (e) {
        log('warn', 'the retune tiktok part failed; the X run is unaffected', { slot: slot.toISOString(), err: errText(e) });
      }
      const summary = {
        slot: slot.toISOString(), version: versionId, outcome, why, ownerGate: ownerText, cutoff: cutoffText, cutoffRule: choice?.rule ?? null, cutoffChosen: choice?.cutoff ?? null, liveCutoff, judge: judgeModel, floor: FLOOR, openLiveNow: liveGrading, leadTime: 'error' in lead ? lead.error : lead.facts,
        handGold: rates.hand, liveNegatives: rates.negatives, heldKinds: held, liveSetup: liveRates, goals: verdict.goals, goal: goalsText(rates, L), withoutCryptoFacts: noFacts, precedentLabels: labelled.length,
        autoGold: rates.auto, missed: rates.missed, regressions: regressed, judgeInUse: inUse === null ? 'rules alone' : `block ${inUse.versionId}`,
        unanswered, baseline, maxBatch, rulesOnly: opts.rulesOnly === true, composition,
        learnedFrom: block.used, rulebook, examples: block.exampleIds.length, added: delta.added, removed: delta.removed, chars: block.text.length,
        costUsd: Number(costUsd.toFixed(4)), batched: tested.batched, usage: tested.used, goldAdded: gold.added, missReasons, matchingLessons: lessons, narratives,
        tiktok: part === null ? 'the TikTok part could not run' : { setSize: part.setSize, added: part.added, bar: part.bar.why, judgeGate: tt, biggestGap: part.gapText },
      };
      log(apply || opts.dry ? 'info' : 'warn', `retune ${outcome}`, summary);
      const ofN = (r: Rate) => `${r.passed}/${r.tested}`;
      const tally = `${cutoffText}; hand gold ${ofN(rates.hand)}, live non-memes ${ofN(rates.negatives)}, missed ${ofN(rates.missed)}, auto gold ${ofN(rates.auto)} (not gated), missed posts live catches and this does not ${regressed.length === 0 ? '0' : `${regressed.length} (${regressed.join(', ')})`} (named, not gated)${liveRates === null ? '' : `; ${FLOOR === null ? 'live now' : 'the floor kept to'}: hand gold ${ofN(liveRates.hand)}, live non-memes ${ofN(liveRates.negatives)}, missed ${ofN(liveRates.missed)}`}; ${noFacts} test posts had no crypto facts (judge alone); ${goalsText(rates, L)}`;
      const ttTally = part === null ? '' : `; TikTok: set ${part.setSize} (+${part.added}), ${part.bar.why}, biggest gap ${part.gapText}`;
      await end(outcome, versionId, (ownerText === null ? '' : `${ownerText}. `) + (why === null ? `applied: ${tally}; matching lessons right ${lessons.right}, wrong ${lessons.wrong}, none ${lessons.none}` : `${why} (${tally})`) + ttTally + narrativesText, costUsd);

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
                goldPassed: rates.hand.passed, goldN: rates.hand.tested, negativePassed: rates.negatives.passed, negativeN: rates.negatives.tested, missedPassed: rates.missed.passed, missedN: rates.missed.tested,
                autoPassed: rates.auto.passed, autoN: rates.auto.tested, regressions: regressed.length, lostMissed: regressed, goal: goalsText(rates, L), ...order.facts,
                /* The owner's table (the owner's gate, 2026-10-17), as one line and as numbers. */
                ...(ownerText === null || ownerPick === null || liveOwner === null ? {} : {
                  ownerLine: ownerText,
                  untaughtPassed: ownerPick.side.untaught.passed, untaughtN: ownerPick.side.untaught.tested, liveUntaughtPassed: liveOwner.untaught.passed,
                  ownerTestPassed: ownerPick.side.test.passed, ownerTestN: ownerPick.side.test.tested, liveOwnerTestPassed: liveOwner.test.passed,
                  junkPassed: ownerPick.side.junk.passed, junkN: ownerPick.side.junk.tested, liveJunkPassed: liveOwner.junk.passed, liveJunkN: liveOwner.junk.tested,
                  junkBPassed: ownerPick.side.junkB.passed, junkBN: ownerPick.side.junkB.tested, liveJunkBPassed: liveOwner.junkB.passed, liveJunkBN: liveOwner.junkB.tested, junkBRose: bRose, unclearN: unclearPosts.length,
                  costUsd: Number(costUsd.toFixed(4)),
                }),
                ...(choice === null || liveRates === null ? {} : {
                  cutoffRule: choice.rule, cutoff: choice.cutoff, cutoffFrom: Number(policyBar.toFixed(2)),
                  liveGoldPassed: liveRates.hand.passed, liveGoldN: liveRates.hand.tested, liveNegativePassed: liveRates.negatives.passed, liveNegativeN: liveRates.negatives.tested, liveMissedPassed: liveRates.missed.passed, liveMissedN: liveRates.missed.tested,
                }),
                taps: block.used.taps, tapsTested: block.taps.tested, missed: block.used.missed, names: block.used.names, coined: block.used.coined, added: delta.added, removed: delta.removed, missReasons,
                ...(narratives === null ? {} : { narrativesShown: narratives.shown, notNarrative: narratives.notNarrative, wrongMerges: narratives.wrongMerges, mergesAsked: narratives.missedMerges, storyCoinsRight: narratives.coinRight, storyCoinsWrong: narratives.coinWrong }),
                ...(part === null ? {} : { tiktokSet: part.setSize, tiktokAdded: part.added, tiktokBar: part.bar.why, tiktokGap: part.gapText, ...(tt === null ? {} : { tiktokCoinedPassed: tt.coined.passed, tiktokCoinedN: tt.coined.tested, tiktokJunkPassed: tt.junk.passed, tiktokJunkN: tt.junk.tested, tiktokBeat: tt.beat }) }),
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
  await withRepo(async (repo, _owner, _labels, db) => {
    const applied = await repo.latestApplied();
    console.log(applied === null ? 'no block applied: the judge reads its rules alone' : `in use: version ${applied.versionId} (${applied.sha}), applied ${applied.appliedAt.toISOString()}, ${applied.text.length} characters, ${applied.cutoff === null ? 'the policy bar' : `its own cutoff ${applied.cutoff}`}`);
    const lead = await readLead();
    console.log(`lead time, last ${LEAD_DAYS} days:`);
    for (const line of 'error' in lead ? [`could not be read: ${lead.error}`] : lead.lines) console.log(`  ${line}`);
    try {
      for (const line of sideBySideLines(await sideBySide(db, LEAD_DAYS, P))) console.log(line);
      for (const t of await new PgCoinedVideoRepo(db).recentTunings(4)) console.log(`tiktok ${t.ranAt.toISOString()}  set ${t.setSize}  ${t.held === null ? '—' : t.held ? 'held' : 'not held'}  ${t.why ?? ''}  gap: ${t.gap ?? '—'}`);
    } catch (e) {
      console.log(`X and TikTok side by side could not be read: ${errText(e)}`);
    }
    for (const r of await repo.recentRuns(10)) console.log(`${r.slot.toISOString()}  ${r.outcome.padEnd(8)} ${r.costUsd === null ? '      ' : `$${r.costUsd.toFixed(3)}`}  ${r.versionId ?? ''}  ${r.detail ?? ''}`);
  });
} else if (command === 'compose') {
  /* Free: which posts the next run would teach and test, from today's data. No judge, no writes. */
  await run(new Date(), { dry: true, force: true, record: false, composeOnly: true });
} else if (command === 'measure') {
  if (process.env['SPEND'] !== 'live' || !flag('--yes')) {
    console.error('retune refused: this calls the paid judge. Set SPEND=live and pass --yes.');
    process.exit(1);
  }
  const mb = arg('max-batch');
  await run(new Date(), { dry: true, force: true, record: false, baseline: flag('--baseline'), rulesOnly: flag('--rules-only'), ...(mb === null ? {} : { maxBatch: Number(mb) }), ...(arg('rows') === null ? {} : { rowsFile: arg('rows') ?? '' }),
    ...(arg('instructions') === null ? {} : { extraInstructions: readFileSync(arg('instructions') ?? '', 'utf8') }), kindCoinable: flag('--kind-coinable'), noAuto: flag('--no-auto'),
    ...(arg('max-negatives') === null ? {} : { maxNegatives: Number(arg('max-negatives')) }) });
} else if (command === 'due' || command === 'run') {
  if (process.env['SPEND'] !== 'live' || !flag('--yes')) {
    console.error('retune refused: this calls the paid judge. Set SPEND=live and pass --yes.');
    process.exit(1);
  }
  const slotArg = arg('slot');
  /* `due` claims a slot `startAheadMs` before it, so the run is finished by 00:00 and 12:00, not started then. */
  const slot = command === 'due' ? new Date(latestSlot(Date.now() + L.startAheadMs, L.retuneAt, L.timeZone)) : new Date(slotArg ?? new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString());
  if (command === 'due') {
    /* ★ EVERY TEN MINUTES, FREE: new coined TikToks into the training set, so the learned list, the
       judge's precedents and the namer's examples see them within minutes, not at the next slot. */
    await withRepo(async (_r, _o, _l, db) => {
      try {
        const got = await refreshSet(db, new Date(), P);
        if (got.added > 0) log('info', 'tiktok training set: new coined videos added', { added: got.added, size: got.rows.length });
      } catch (e) {
        log('warn', 'tiktok training set refresh failed; tried again in ten minutes', { err: errText(e) });
      }
    });
    if (await withRepo((repo) => repo.hasRun(slot))) process.exit(0);
    /* A slot more than an hour past is skipped, not caught up: when the slots move, the newest slot
       before the change never ran, and running it then would put a re-tune at an hour nobody chose. */
    if (Date.now() > slot.getTime() + 3_600_000) process.exit(0);
  }
  if (flag('--detach')) {
    const args = ['run', '--yes', `--slot=${slot.toISOString()}`, ...(flag('--dry') ? ['--dry'] : []), ...(flag('--force') ? ['--force'] : []), ...(arg('floor') === null ? [] : [`--floor=${arg('floor') ?? ''}`])];
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1] ?? '', ...args], { detached: true, stdio: 'inherit' });
    child.unref();
    log('info', 'retune started, detached', { slot: slot.toISOString() });
    process.exit(0);
  }
  await run(slot, { dry: flag('--dry'), force: flag('--force'), record: true, baseline: flag('--baseline'), ...(arg('rows') === null ? {} : { rowsFile: arg('rows') ?? '' }) });
} else {
  console.error('usage: tools/retune.ts due|run|measure|status [--yes] [--dry] [--force] [--baseline] [--detach] [--slot=<iso>]');
  process.exit(2);
}
