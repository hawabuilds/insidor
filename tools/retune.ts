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
 *   measure [--baseline] [--rules-only] [--max-batch=<n>] [--rows=<file>] [--model=<id>]
 *           [--instructions=<file>] [--kind-coinable] [--no-auto]
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
 *                        `--no-auto` leaves auto gold out.
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
 *   4. the test, asked exactly as the live scorer asks (tools/lib/pass-rates.ts: ten posts a call,
 *      the same picture size and answer budget, then the kind question). HAND GOLD is the gold
 *      sheets, the owner's missed posts and the owner's own list (eval/src/gold/hand-gold.json:
 *      approved recall additions and any post we hold); every other recall addition is AUTO GOLD, graded and
 *      reported, never gated. A post passes when it would be on For You: the first question passes
 *      and its kind is not one Policy.judge.heldKinds holds (eval/src/feed/examples.ts):
 *        applied     when it BEATS the setup live now (its applied block, or its rules alone),
 *                    graded on the same posts beside the block's test: strictly more hand gold
 *                    (memes, news, tragedies alike) AND strictly fewer held-out live non-memes,
 *                    AND no missed post live catches is lost. Strict is the noise rule: both
 *                    sides run together at temperature 0, so a tie is not an improvement.
 *        goal        hand gold ≥ minGoldPass, live non-memes ≤ maxLiveNegativePass, missed ≥
 *                    minMissedPass: reported met or not met, never a block
 *      A post passes as live decides (core passesWithSignal): the judge, or — its kind not held —
 *      other accounts' crypto talk from its crypto-attention read; a shill never. A post with no
 *      such read is decided by the judge alone, and the run says how many.
 *      The live non-memes are the labels file's "not" posts and every "Not a meme" tap the owner
 *      makes, held out by the id split, so the set grows by itself day by day.
 *        no regress  every missed post the judge in use catches (its applied block, or its rules
 *                    alone) is still caught by the new block — one regression and it is not applied.
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
 * here drops `exampleIds` first; a gold addition that is also a taught missed post is not gold. The
 * one exception is `missed-taught`, graded for the regression rule only and never in a rate.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE, PgLearningRepo, PgOwnerAlertRepo, type GoldAddition } from '../store/src/index.ts';
import { isMissingTable } from '../store/src/repo/learning.ts';
import { buildBlock, caught, changed, currentCalls, gate, goalsText, latestSlot, ratesOf, regressions, share, type GradedPost, type NameCall, type OwnerCall, type Rate } from '../eval/src/feed/examples.ts';
import { postTimeFromId, xPlatform, httpClient as xClient } from '../adapters/platform/x/src/index.ts';
import { pictureOf } from '../services/project/src/db.ts';
import { onOutOfCredit } from '../adapters/kit/vendor/src/billing.ts';
import { openSharedMeter } from './lib/shared-meter.ts';
import { LineTooShort, goldOriginPosts, handGoldIds, gradePosts, judgeSetup, type EvalPost, type EvalRow } from './lib/pass-rates.ts';
import { refitForRetune } from './lib/score-model.ts';

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
/* `--model=<id>` (measure only) grades with another judge model than JUDGE_MODEL. */
const env = { ...process.env, ...(url === undefined ? {} : { DATABASE_URL_INTERNAL: url }), ...(command === 'measure' && arg('model') !== null ? { JUDGE_MODEL: arg('model') ?? '' } : {}) };

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

type G = 'gold' | 'auto' | 'live-not' | 'missed' | 'missed-taught';

async function run(slot: Date, opts: { readonly dry: boolean; readonly force: boolean; readonly record: boolean; readonly baseline?: boolean; readonly rulesOnly?: boolean; readonly maxBatch?: number; readonly rowsFile?: string; readonly extraInstructions?: string; readonly kindCoinable?: boolean; readonly noAuto?: boolean; readonly composeOnly?: boolean }): Promise<void> {
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
      /* The For You order model (tools/lib/score-model.ts): free, so refitted at every slot before the skip below; never fails the run. */
      const order = await refitForRetune(url, { record: opts.record && !opts.dry });
      log('info', 'order model refitted', { slot: slot.toISOString(), ...order.log });

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
      /* `--rules-only` teaches nothing, so nothing is held out: every missed post is tested. */
      const allMissed = currentCalls(calls).filter((c) => c.from === 'missed' && c.label === 'meme');
      const testMissed = opts.rulesOnly === true ? allMissed : block.testMissed;
      const taught = new Set(opts.rulesOnly === true ? [] : block.exampleIds);
      const testMissedIds = new Set(testMissed.map((m) => m.itemId));
      const additions = await soft(repo.goldAdditions(), []);
      /* ★ HAND GOLD AND AUTO GOLD. Hand gold — the gold sheets, the owner's missed posts, and the
         owner's own list (eval/src/gold/hand-gold.json: approved recall additions, or posts we
         hold) — is the gate. Every other recall addition is auto gold: a creator linking a post
         does not prove the post is a meme origin, so it is graded and reported, never gated. */
      const listed = handGoldIds();
      const inAdditions = new Set(additions.map((g) => g.itemId));
      const listedHeld = await soft(repo.heldPosts([...listed].filter((id) => !inAdditions.has(id) && !taught.has(id) && !testMissedIds.has(id))), []);
      /* Every missed post the owner gave, taught or held out: the held-out half is the `missed`
         group; the taught half is graded only for the regression rule. */
      const missedTaught = allMissed.filter((c) => !testMissedIds.has(c.itemId));
      /* ★ THE OWNER'S COIN LABELS. "This is the coin" on a post is a confirmed coined post: it joins
         hand gold for the run, with its coin. "No coin is from this" is a matching negative only —
         it says nothing about whether the post could be coined, so it is never a judge negative. */
      const coinCalls = await soft(repo.matchCalls(), []);
      const coinRight = coinCalls.filter((m) => m.verdict === 'right' && m.coinAddress !== null);
      const posts: EvalPost<G>[] = [
        ...goldOriginPosts(),
        ...additions
          .filter((g) => !taught.has(g.itemId) && !testMissedIds.has(g.itemId) && !(opts.noAuto === true && g.source === 'recall' && !listed.has(g.itemId)))
          .map((g) => ({ group: g.source === 'recall' && !listed.has(g.itemId) ? ('auto' as const) : ('gold' as const), id: g.itemId, kind: `added ${g.addedOn} (${g.source})`, text: g.postText, imageUri: g.imageUri, coinRef: g.coinMint })),
        ...listedHeld.map((h) => ({ group: 'gold' as const, id: h.itemId, kind: "the owner's hand-gold list", text: h.body, imageUri: pictureOf(h.media)?.uri ?? null })),
        ...block.testNegatives.map((c) => ({ group: 'live-not' as const, id: c.itemId, kind: c.why, text: c.text, imageUri: c.imageUri })),
        ...testMissed.map((c) => ({ group: 'missed' as const, id: c.itemId, kind: 'missed', text: c.text, imageUri: c.imageUri })),
        ...missedTaught.map((c) => ({ group: 'missed-taught' as const, id: c.itemId, kind: 'missed (taught)', text: c.text, imageUri: c.imageUri })),
      ];
      /* The owner's "meme" calls the cap left out of the block, and the posts the owner confirmed a
         coin for: hand gold, unless already in the test or taught. */
      const inTest = new Set(posts.map((p) => p.id));
      const fresh = (id: string) => !inTest.has(id) && !taught.has(id);
      const tappedMemes = block.testMemes.filter((c) => fresh(c.itemId));
      for (const c of tappedMemes) { posts.push({ group: 'gold', id: c.itemId, kind: "the owner's meme call", text: c.text, imageUri: c.imageUri }); inTest.add(c.itemId); }
      const coinGold = await soft(repo.heldPosts(coinRight.map((m) => m.itemId).filter(fresh)), []);
      for (const h of coinGold) posts.push({ group: 'gold', id: h.itemId, kind: "the owner's coin call: this is the coin", text: h.body, imageUri: pictureOf(h.media)?.uri ?? null, coinRef: coinRight.find((m) => m.itemId === h.itemId)?.coinAddress ?? h.itemId });
      const composition = {
        examples: block.exampleIds.length, tapsTaught: block.taps.taught, tapsTested: block.taps.tested,
        handGold: posts.filter((p) => p.group === 'gold' || p.group === 'missed').length, ownerMemeCallsTested: tappedMemes.length, coinRightAddedToGold: coinGold.length,
        coinRight: coinCalls.filter((m) => m.verdict === 'right').length, coinNone: coinCalls.filter((m) => m.verdict === 'none').length,
        liveNegatives: block.testNegatives.length, missedTested: testMissed.length, autoGold: posts.filter((p) => p.group === 'auto').length,
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

      judgeSetup(env);
      log('info', 'retune testing a block', { slot: slot.toISOString(), posts: posts.length, handGold: posts.filter((p) => p.group === 'gold').length, autoGold: posts.filter((p) => p.group === 'auto').length, liveNegatives: block.testNegatives.length, missed: testMissed.length, missedTaught: missedTaught.length, heldKinds: held, maxBatch, rulesOnly: opts.rulesOnly === true, examples: block.exampleIds.length, chars: block.text.length });
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
      /* One grading on the learning book. The kind labels it learns are kept, so a later grading
         this run splits gold exactly as this one did and does not pay to ask again. */
      const grade = async (of: readonly EvalPost<G>[], block: string | null) => {
        const examples = [block, opts.extraInstructions ?? null].filter((x): x is string => x !== null && x.trim() !== '').join('\n\n') || null;
        const shared = await openSharedMeter(P.budget.learningLines.dailyUsd, env, 'learning');
        try {
          const out = await gradePosts(of, { env, meter: shared.meter, examples, batch: true, mustFit: true, coined, vectors, knownKinds: kinds, maxBatch, ...(opts.kindCoinable === true ? { kindAlso: (p: EvalPost<string>) => (p as EvalRow<string>).coinable === true } : {}) });
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
      const graded = (rows: readonly EvalRow<G>[]): GradedPost[] => rows.map((r) => ({ id: r.id, group: r.group, coinable: r.coinable, firstPass: r.firstPass, kind: r.postKind, signal: signals.get(r.id) ?? null }));
      const GROUPS = { hand: ['gold', 'missed'], auto: 'auto', negatives: 'live-not', missed: 'missed' } as const;
      const caughtMap = (rows: readonly EvalRow<G>[]) => new Map(graded(rows).filter((r) => r.group === 'missed' || r.group === 'missed-taught').map((r) => [r.id, caught(r, held)] as const));

      /* ★ THE SETUP LIVE NOW, graded on the same posts in the same run (its applied block, or its
         rules alone when none is): the block must be no worse on any of the three, and every missed
         post it catches must still be caught. Graded beside the block's test, not after it, so a
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
      const regressed: readonly string[] = nowRows === null ? [] : regressions(caughtMap(nowRows), caughtMap(rows));
      const liveRates = nowRows === null ? null : ratesOf(graded(nowRows.filter((r) => r.coinable !== null)), held, GROUPS);
      const costUsd = spentUsd + gold.xUsd;

      /* Unanswered posts are out of every rate, and stop the block being applied. */
      const answered = rows.filter((r) => r.coinable !== null);
      const unanswered = rows.length - answered.length;
      const rates = ratesOf(graded(answered), held, GROUPS);
      const verdict = gate({ ...rates, regressions: regressed, live: liveRates }, L);
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
        handGold: rates.hand, liveNegatives: rates.negatives, heldKinds: held, liveSetup: liveRates, goals: verdict.goals, goal: goalsText(rates, L), withoutCryptoFacts: noFacts,
        autoGold: rates.auto, missed: rates.missed, regressions: regressed, judgeInUse: inUse === null ? 'rules alone' : `block ${inUse.versionId}`,
        unanswered, baseline, maxBatch, rulesOnly: opts.rulesOnly === true, composition,
        learnedFrom: block.used, examples: block.exampleIds.length, added: delta.added, removed: delta.removed, chars: block.text.length,
        costUsd: Number(costUsd.toFixed(4)), batched: tested.batched, usage: tested.used, goldAdded: gold.added, missReasons, matchingLessons: lessons,
      };
      log(apply || opts.dry ? 'info' : 'warn', `retune ${outcome}`, summary);
      const ofN = (r: Rate) => `${r.passed}/${r.tested}`;
      const tally = `hand gold ${ofN(rates.hand)}, live non-memes ${ofN(rates.negatives)}, missed ${ofN(rates.missed)}, auto gold ${ofN(rates.auto)} (not gated), regressions ${regressed.length}${liveRates === null ? '' : `; live now: hand gold ${ofN(liveRates.hand)}, live non-memes ${ofN(liveRates.negatives)}, missed ${ofN(liveRates.missed)}`}; ${noFacts} test posts had no crypto facts (judge alone); ${goalsText(rates, L)}`;
      await end(outcome, versionId, why === null ? `applied: ${tally}; matching lessons right ${lessons.right}, wrong ${lessons.wrong}, none ${lessons.none}` : `${why} (${tally})`, costUsd);

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
                autoPassed: rates.auto.passed, autoN: rates.auto.tested, regressions: regressed.length, goal: goalsText(rates, L), ...order.facts,
                taps: block.used.taps, tapsTested: block.taps.tested, missed: block.used.missed, names: block.used.names, added: delta.added, removed: delta.removed, missReasons,
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
    ...(arg('instructions') === null ? {} : { extraInstructions: readFileSync(arg('instructions') ?? '', 'utf8') }), kindCoinable: flag('--kind-coinable'), noAuto: flag('--no-auto') });
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
