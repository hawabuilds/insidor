/**
 * The composition root: the ONE file that knows the names of other packages.
 *
 * Everything else in this service talks to the small ports declared in
 * `loop.ts` and `run-record.ts`. That is not ceremony — it is what keeps the
 * supervision machinery testable without a database, and it means a change to
 * the store's export names costs one file rather than fifteen.
 *
 * WHY THIS IS A `withRuntime(cfg, log, use)` AND NOT A `buildRuntime` THAT
 * RETURNS: the singleton guard is a SESSION advisory lock, and a session lock
 * lives exactly as long as the client that took it. `withAdvisoryLock` therefore
 * scopes it to a callback, and the only honest way to hold it for the lifetime of
 * the process is to run the process inside that callback. A version that returned
 * a Runtime would have to keep the lock alive by some side channel, and a
 * singleton guard that is subtly not held is worse than none: it reads as held.
 * Failure mode #2 of the build this replaces was two runners draining one claim
 * queue, and it produced double spend with no error anywhere.
 *
 * ★ THE STAGE WORK IS WIRED, AND IT IS WIRED AGAINST THE STORE. Every `pull`
 * below reads rows we already hold; none of them calls a vendor. That is what
 * makes the decision log fillable today rather than on the day the last adapter
 * lands — and `internal.decisions` is one of the two tables SETUP.md says cannot
 * be backfilled, so a day spent waiting for adapters is a day of training data
 * that never existed. Which stage is wired and which still refuses, and the rule
 * that decides, is argued in `work/stages.ts`.
 *
 * THE SEVEN STAGES ARE STILL WIRED AGAINST THE STORE. Their store-backed pulls
 * stand in for observation and the judge; where an input genuinely needs a vendor
 * it arrives as its typed absence and the stage returns the verdict that names
 * the absence. Replacing one with a real adapter changes one `pull` and no other
 * line in this service.
 *
 * ★ THE ADAPTERS ARE NOW IMPORTED — FOR DISCOVERY ONLY, AND THROUGH ONE CALL.
 * `resolvePlatforms` takes the environment slice that config.ts captured at boot
 * and returns the sources that could be built AND the ones that could not, with the
 * reason. It cannot throw for a missing credential, so ZERO LIVE SOURCES BOOTS
 * NORMALLY: the process starts, the health rows say what is dark and why, and the
 * discovery loop runs over an empty set. That is the whole activation story — a
 * credential in the environment is the only thing that turns a source on, and its
 * absence is a displayed state rather than an outage.
 *
 * ★ AND EVERY LIVE ADAPTER IS WRAPPED BEFORE IT LEAVES THIS FILE. `watchedRegistry`
 * is applied here, at the one place a registry is constructed, rather than at each
 * call site — a loop written later would otherwise reach for the unwrapped registry,
 * because that is what the registry function returns, and its calls would work
 * perfectly while the health record said the source had never answered.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { Author, Item, Millis } from '@insidor/contracts';
import type { DurableMeter } from '@insidor/meter';
import type { DecisionRepo, SourceHealthRepo } from '@insidor/contracts/ports/store.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { jobVendorLines, supplierRoles, vendorLines } from './vendor-lines.ts';
import { supplierWarnings } from './supplier-warnings.ts';
import { EXAMPLES_RECHECK_MS, learnedJudge } from './learned-examples.ts';
import type { JudgePort } from '@insidor/contracts/ports/judge.ts';
import { LEARN_ENDPOINT_PREFIX, type Meter } from '@insidor/contracts/ports/meter.ts';
import { JudgeNotConfigured, anthropicJudge, type JudgeQuestion, httpClient, priceFor, type JudgeClient } from '@insidor/judge-anthropic';
import { openDurableMeter } from '@insidor/meter';
import { httpClient as voyageClient, voyageEmbed } from '@insidor/embed-voyage';
import { resolvePlatforms, SUPPLIER_VENDORS, type PlatformRegistry, type PlatformRuntime } from '@insidor/platform-registry';
import {
  DB_ROLE,
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgBackfillRepo,
  PgCoinUniverseRepo,
  PgOlderCoinRepo,
  PgFeedFloorRepo,
  PgImageEmbeddingRepo,
  PgImagePairRepo,
  PgJudgementRepo,
  PgLearningRepo,
  PgPostJudgementRepo,
  PgItemRepo,
  PgMissedPostRepo,
  PgObservationRepo,
  PgOwnerAlertRepo,
  PgSourceHealthRepo,
  PgSpendRepo,
  PgRecallRepo,
  PgStageRunRepo,
  PgStoryRepo,
  asDb,
  createPool,
  withAdvisoryLock,
  type Db,
} from '@insidor/store';

import type { RunnerConfig } from './config.ts';
import { storeArrivals } from './work/arrivals.ts';
import { scorePosts, type ScoringResult } from './work/score-posts.ts';
import { embedImages } from './work/embed-images.ts';
import { backfillStories, type BackfillResult } from './work/backfill.ts';
import { type UniverseDeps } from './work/universe.ts';
import { chainClient, fetchMetadata } from '@insidor/venue-solana-pumpfun';
import { dexscreenerSearch, dexscreenerStandings } from '@insidor/market-dexscreener';
import { geckoterminal } from '@insidor/market-geckoterminal';
import { keepCoins } from './work/coin-keep.ts';
import { lookUpCoins } from './work/coin-lookup.ts';
import { checkOlderCoins } from './work/older-coins.ts';
import { measureDiscovery } from './work/discovery-settings.ts';
import { SPEND_WINDOW_MS, workMissedPosts, type MissedResult } from './work/missed-posts.ts';
import { pictureCoinMatches } from './work/coin-match.ts';

/** A coin search is abandoned after this long; the next pass asks again. */
const SEARCH_TIMEOUT_MS = 8_000;
import { advisoryLockKey, policyHash } from './hash.ts';
import type { Logger } from './log.ts';
import type { DecisionLog, LoopDeps } from './loop.ts';
import type { StageRunRecorder } from './run-record.ts';
import { declareSources, watchedRegistry, type WatchDeps } from './sources.ts';
import { storeWork, type StageRepos } from './work/stages.ts';

export interface Runtime {
  readonly db: Db;
  readonly stageRuns: StageRunRecorder;
  readonly loopDeps: LoopDeps;
  /** Partition maintenance and the unapplied sweep. See `maintain` below. */
  readonly maintenance: Maintenance;
  /** Live sources, already wrapped so every call records its own outcome. */
  readonly platforms: PlatformRegistry;
  /** What `watched` needs, exposed so the discovery loop re-declares each pass. */
  readonly watch: WatchDeps;
  /** Where arrivals land. Narrow on purpose: discovery may write items and nothing else. */
  readonly store: (items: readonly Item[], authors: readonly Author[]) => Promise<number>;
  /**
   * The wallet. Exposed so the discovery loop can consult it BEFORE a call and record
   * a refusal with its numbers — a pause that says only "paused" is indistinguishable
   * from "we chose not to ask" a week later, when the question is whether the cap was
   * too low or the vendor was down.
   */
  readonly meter: DurableMeter;
  /** The catch-all search's lane floors, kept between passes. */
  readonly feedFloors: PgFeedFloorRepo;
  /** Score the catch-all posts the judge has not seen, alone and once each. */
  readonly scorePosts: () => Promise<ScoringResult>;
  /** Embed the first image of each new post once, for GROUP's image evidence. */
  readonly embedImages: () => Promise<unknown>;
  /** Follow promoted stories' quotes back to where they started. See work/backfill.ts. */
  readonly backfill: () => Promise<BackfillResult>;
  /** The coin universe loop's dependencies. See work/universe.ts. */
  readonly universe: Omit<UniverseDeps, 'now'>;
  /** Coins we never saw minted, looked up by a narrative's or post's name. See work/coin-lookup.ts. */
  readonly lookUpCoins: () => Promise<unknown>;
  /** Old coins asked about once, and the ones that do not matter deleted. See work/coin-keep.ts. */
  readonly keepCoins: () => Promise<unknown>;
  /** The owner's pasted missed posts, read on the learning book and diagnosed. See work/missed-posts.ts. */
  readonly missedPosts: () => Promise<MissedResult>;
}


/**
 * The judge port for this process, or null when it is dormant.
 *
 * ★ THE ONLY PLACE THE REAL `fetch` REACHES THE JUDGE, for the reason `runtimeDeps` below
 * gives for the platforms: every adapter takes it as a dependency so no test can reach
 * the network, and this file is the one entitled to hand over the real one.
 */
function buildJudge(
  cfg: RunnerConfig,
  meter: Meter,
  policy: Policy,
  log: Logger,
  /** The answer budget: QUALIFY's by default; the per-post score passes its smaller one. */
  maxOutputTokens: number = policy.judge.maxOutputTokens,
  /** QUALIFY asks about a group of posts; the feed's per-post score asks its own question. */
  question: JudgeQuestion = 'story',
  /** The owner's learned examples after the post question's rules (learned-examples.ts); null: none. */
  examples: string | null = null,
): JudgePort | null {
  const setup = cfg.judge;
  if (setup.state === 'dormant' || setup.state === 'misconfigured') {
    log.info('judge dormant: QUALIFY will abstain on every story (Q1_unjudged)', {
      set: 'ANTHROPIC_API_KEY and JUDGE_MODEL to turn it on',
    });
    return null;
  }
  const price = priceFor(setup.model);
  if (price === null) {
    throw new JudgeNotConfigured('JUDGE_MODEL', `is ${JSON.stringify(setup.model)}, which has no price in prices.ts`);
  }
  const client: JudgeClient =
    setup.state === 'configured'
      ? httpClient({
          /* The host's smaller named size: ~25% less input per post. Tested 2026-10-13 twice each
             against full size: gold 27 and 30 of 41 vs 29 and 28, non-meme 2 and 0 of 43 vs 2 and 1 —
             the same within the judge's own run-to-run noise. */
          pictureSize: 'small',
          apiKey: setup.apiKey,
          baseUrl: setup.baseUrl,
          model: setup.model,
          maxOutputTokens,
          effort: price.effort,
          timeoutMs: policy.judge.timeoutMs,
          maxAttempts: policy.judge.maxAttempts,
          backoffMs: policy.judge.backoffMs,
          maxWaitMs: policy.judge.maxWaitMs,
          maxFrameBytes: policy.judge.maxFrameBytes,
          fetch: globalThis.fetch,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        })
      : {
          judge: () => Promise.reject(new JudgeNotConfigured('ANTHROPIC_API_KEY', 'is not set; this judge can only price calls')),
          frame: () => Promise.reject(new JudgeNotConfigured('ANTHROPIC_API_KEY', 'is not set; this judge can only price calls')),
        };
  log.info('judge resolved', {
    state: setup.state,
    model: setup.model,
    mode: cfg.spend.kind,
    usdPerMillionInput: price.usdPerMillionInput,
    usdPerMillionOutput: price.usdPerMillionOutput,
  });
  return anthropicJudge({
    client,
    meter,
    now: () => Date.now(),
    model: setup.model,
    policy: { ...policy.judge, maxOutputTokens },
    maxBatch: policy.qualify.batchSize,
    question,
    examples,
  });
}
/**
 * The two calls on `PgDecisionRepo` that had no caller anywhere in the repository.
 *
 * They are a port rather than a direct use of the concrete class for the same reason
 * everything else in this service is: the supervision machinery stays testable without
 * a database. But the reason they exist AT ALL is worth stating, because both were
 * documented as "the runner does this" and neither was ever called:
 *
 *   ensurePartition — `internal.decisions` is partitioned by day, and 0006 defines a
 *   row landing in `decisions_default` as meaning "the partition-maintenance job
 *   stopped running". With nothing calling this, EVERY row lands there — so on day one
 *   a hundred percent of the log arrives in the signal that means the system is broken,
 *   and the signal is worthless from then on.
 *
 *   sweepUnapplied — `applied_at IS NULL` is the whole payoff of writing the log before
 *   performing the effect. `decisions_unapplied_idx` indexes it and nothing queried it,
 *   which means the asymmetry bought a repair queue nobody could see. Counting it at
 *   boot is the smallest honest version: a count that grows rather than drains is a
 *   stage failing after it logged.
 */
/** `2026-08-19`. The width of an ISO date, which is what ensure_decision_partition takes. */
const DATE_LENGTH = 10;
const MS_PER_DAY = 86_400_000;

export interface Maintenance {
  /** Create today's and tomorrow's partitions. Idempotent; safe to call every day. */
  ensurePartitions(now: Millis): Promise<readonly string[]>;
  /** How many logged decisions never had their side effect land. */
  countUnapplied(sinceMs: Millis, limit: number): Promise<number>;
}

/**
 * Opens the pool, takes the singleton lock, builds the ports, and runs `use`
 * inside all three. The lock is released and the pool closed only after `use`
 * resolves — releasing either while a loop is still writing would hand the queue
 * to a second runner mid-flight.
 */
export async function withRuntime<T>(
  cfg: RunnerConfig,
  log: Logger,
  use: (runtime: Runtime) => Promise<T>,
): Promise<T> {
  // The runner writes decisions and judgements, so it holds the `internal` role
  // and no other. Configuration owns the one read of process.env in this
  // service, which is why the URLs are handed in rather than read again here.
  //
  // TWO POOLS, ONE ROLE. The singleton lock is session state and gets a pool of one
  // client on a session-mode URL (createPool refuses the transaction pooler for it).
  // The loops' work runs on a second pool that may sit behind the transaction pooler,
  // so the runner holds ONE session-mode client however busy its loops are — the
  // session pooler caps clients per user, and seven loops used to take ten of them.
  const lockPool = createPool(DB_ROLE.internal, {
    applicationName: `insidor-runner-lock@${cfg.host}`,
    env: { DATABASE_URL_INTERNAL: cfg.lockDatabaseUrl },
    session: true,
    max: 1,
  });
  const pool = createPool(DB_ROLE.internal, {
    applicationName: `insidor-runner@${cfg.host}`,
    env: { DATABASE_URL_INTERNAL: cfg.databaseUrl },
  });

  try {
    // A session advisory lock, not a row. Session mode (5432) is required for
    // this to hold; transaction mode cannot keep a session lock, which is why
    // the lock pool is opened with `session: true`.
    //
    // The result is wrapped in an object so that "the lock was not free" (null)
    // stays distinguishable from "the work returned null" — the same distinction
    // between empty and dead that the rest of this service is built around.
    const outcome = await withAdvisoryLock(lockPool, advisoryLockKey(cfg.singletonLockName), async () => {
      // The lock-holding client does nothing else: repositories run on the pool,
      // so seven loops do not serialise behind one backend.
      const db = asDb(pool);
      const decisions = new PgDecisionRepo(db);
      const decisionRepo: DecisionRepo = decisions;

      /* ★ ASSIGNED DIRECTLY RATHER THAN THROUGH A LAMBDA, and that is what carries the
         widening. `StageRunRecorder.open` takes a `SupervisedName` — wider than the
         seven, because discovery is supervised and is not a decision stage — while
         `PgStageRunRepo.open` takes a `StageName`. A method parameter is bivariant in
         TypeScript, so the repository satisfies the wider port with nothing cast and
         nothing silenced; the column it writes to is free text, which is why the
         widening is safe at the database as well as at the type. chainwatch relies on
         exactly this and argues it at length. A wrapping lambda would have had to cast
         its own argument, which is the version that hides the decision. */
      const stageRuns: StageRunRecorder = new PgStageRunRepo(db);
      const sourceHealth: SourceHealthRepo = new PgSourceHealthRepo(db);

      const repos: StageRepos = {
        items: new PgItemRepo(db),
        authors: new PgAuthorRepo(db),
        observations: new PgObservationRepo(db),
        stories: new PgStoryRepo(db),
        assets: new PgAssetRepo(db),
        decisions,
        backfill: new PgBackfillRepo(db),
      };

      // The policy body lives in code and is hashed here, once, at boot. The
      // body is recorded under its hash before the first decision of that
      // version is written: a hash whose body nobody kept is not an audit
      // trail, it is a checksum of something we lost.
      const policy = DEFAULT_POLICY;
      const hash = policyHash(policy);
      await decisions.recordPolicy(hash, policy, `runner boot on ${cfg.host}`);
      log.info('policy loaded', { policyHash: hash });

      // Log first, act, then mark: `write` returns the row id the side effect is
      // stamped against, and nothing else in this service is allowed to reorder
      // those three.
      const decisionLog: DecisionLog = {
        write: (decision) => decisionRepo.append(decision),
        markApplied: (rowId, at) => decisionRepo.markApplied(rowId, at),
      };

      /* ── the sources ────────────────────────────────────────────────────
         Everything below is construction, and none of it can fail the boot. */

      const watch: WatchDeps = { health: sourceHealth, now: () => Date.now(), log };

      /**
       * ★ THE METER IS DURABLE, AND THAT IS THE DIFFERENCE BETWEEN A DAILY CAP AND A
       * PER-PROCESS-LIFETIME CAP.
       *
       * `openDurableMeter` reads today's ledger out of `internal.spend` before it
       * exists, so a process that boots into a day where $2.80 of a $3.00 line is
       * already gone gets $0.20 and not $3.00. Without that read, `main.ts` exiting on
       * an uncaught exception under any restarting supervisor hands out the whole
       * budget once per crash — each allocation individually enforced, the invoice a
       * multiple of the number in policy. It is the single failure mode where a cap
       * that genuinely refuses still fails to bound a bill.
       *
       * ★ AND IT IS AWAITED HERE, BEFORE ANY LOOP EXISTS. A meter that filled itself
       * in later would spend the first calls of every boot against a budget it had not
       * checked — and the first calls of a boot are exactly what a crash loop consists
       * of. A failed read fails the boot, which is the correct direction: a process
       * that cannot find out what it has already spent must not start spending.
       */
      const meter = await openDurableMeter({
        ledger: new PgSpendRepo(db),
        /* ★ THE LOWER OF THE TWO, ALWAYS. Policy is the ceiling any deployment may
           reach; the environment is this operator's tighter belt inside it. config.ts
           already refuses a value above the policy line at boot, so this `min` is the
           belt-and-braces spelling of a rule that is enforced there — and it is written
           out rather than assumed so that removing the check in config.ts cannot
           silently raise the cap here. */
        dailyCapUsd: Math.min(cfg.spend.dailyBudgetUsd, policy.budget.dailyUsd),
        /* ★ THE PER-SOURCE LINE, WHICH THE OLD WIRING SUPPORTED AND NEVER PASSED. One
           undifferentiated pot is spent in the order sources happen to be declared, so
           whichever source is asked first drains the day and the ones behind it are
           refused from mid-morning — which reads on the board as two dead sources
           rather than as one expensive one.

           It is the DEFAULT line rather than a map of named ones because the vendor
           token is an adapter's secret and this file holds source ids: the registry
           that could translate between them is built below, with this meter already in
           hand. A default is also the better rule — a source added next year gets a
           ceiling by existing rather than by somebody remembering to add it to a map,
           and the source nobody remembers is exactly the one that would have none. */
        defaultVendorCapUsd: policy.budget.perSourceUsdPerDay,
        /* ★ ONE LINE PER SUPPLIER, the owner's caps (Policy.budget.supplierLines), mapped
           here from role to the vendor that bills under it. Not paced: full speed every pass,
           the lines are brakes (see the note where policy once held `paceAheadMs`). */
        perVendorCapUsd: vendorLines(policy),
        softStop: policy.budget.softStopFraction,
        now: () => Date.now(),
        /* Reported, not acted on. A write that failed means the NEXT process will not
           know about these dollars; refusing calls over it would let a database blip
           stop the ingest, which is the monitoring taking down the thing it monitors. */
        onWriteFailure: (spend, error) =>
          log.error('a spend could not be persisted; the next process will not see it', {
            vendor: spend.vendor,
            endpoint: spend.endpoint,
            usd: spend.usd,
            err: error instanceof Error ? error.message : String(error),
          }),
      });

      log.info('wallet opened', {
        mode: cfg.spend.kind,
        dailyCapUsd: Math.min(cfg.spend.dailyBudgetUsd, policy.budget.dailyUsd),
        perSourceCapUsd: policy.budget.perSourceUsdPerDay,
        /* ★ WHAT TODAY HAS ALREADY COST, PRINTED AT BOOT. On a first boot it is zero
           and says the ledger is reachable; on the fourth restart of a crash loop it is
           the number that tells somebody what is happening, and it is the one line that
           could not exist before the ledger was durable. */
        spentTodayUsd: meter.openedWith.totalUsd,
      });

      /* ★ THE LINES ARE SHARED WITH ANY ONE-OFF PAID JOB (tools/jobs.ts), which writes to the same
         ledger. Re-read it on a timer so what the job spends counts here too; see `refresh` in
         the meter. Unref'd: it must never be what keeps a stopping runner alive. */
      /* ★ THE OWNER'S EARLY WARNING rides the same minute: after each re-read, any supplier
         at 80% or 95% of its line (Policy.budget.warnAt) is logged and queued for the owner,
         once a level a day. See supplier-warnings.ts. A failed re-read still checks, against
         the last balance, which is the most the meter itself knows. */
      const warnings = supplierWarnings({
        roles: supplierRoles(),
        line: (vendor) => meter.line(vendor),
        warnAt: policy.budget.warnAt,
        ownerWallets: cfg.ownerWallets,
        owner: new PgOwnerAlertRepo(db),
        log: log.child({ step: 'supplier-warnings' }),
        now: () => Date.now(),
      });
      log.info('supplier warnings', {
        at: policy.budget.warnAt,
        alert: cfg.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : 'queued for the owner',
      });
      setInterval(() => {
        meter
          .refresh()
          .catch((error: unknown) =>
            log.warn('the spend ledger could not be re-read; keeping the last balance', {
              err: error instanceof Error ? error.message : String(error),
            }),
          )
          .then(() => warnings.check())
          .catch((error: unknown) =>
            log.error('the supplier warning check failed', { err: error instanceof Error ? error.message : String(error) }),
          );
      }, policy.budget.ledgerRefreshMs).unref();

      /* ── the judge ──────────────────────────────────────────────────────
         Built after the meter, because every judge call is metered against it. Four
         states (config.ts has already failed the boot on the two that are faults):
           dormant      no judge; QUALIFY abstains with Q1 on every story
           priced       SPEND=dry with a model and no key: estimates only. The client it
                        holds refuses to run, and the dry run never asks it to.
           configured   the real client. In SPEND=dry it is still never called. */
      const judge = buildJudge(cfg, meter, policy, log);
      /* The per-post score's judge: the same model and prompt, with a smaller answer budget
         so ten short answers are not reserved at the cost of two long ones. */
      /* ★ WITH THE OWNER'S LEARNED EXAMPLES: the latest block the re-tune APPLIED (0056), read at
         boot and every few minutes, swapped in behind the same port (learned-examples.ts). None
         applied: no examples, the judge's rules alone. */
      const rulesOnlyPostJudge = buildJudge(cfg, meter, policy, log, policy.judge.postBatchMaxOutputTokens, 'post');
      const learning = new PgLearningRepo(db);
      const learned =
        rulesOnlyPostJudge === null
          ? null
          : learnedJudge({
              latest: () => learning.latestApplied(),
              build: (examples) => (examples === null ? rulesOnlyPostJudge : buildJudge(cfg, meter, policy, log, policy.judge.postBatchMaxOutputTokens, 'post', examples) ?? rulesOnlyPostJudge),
              log: log.child({ step: 'learned-examples' }),
            });
      if (learned !== null) {
        await learned.refresh();
        setInterval(() => void learned.refresh(), EXAMPLES_RECHECK_MS).unref();
      }
      const postJudge = learned?.port ?? null;
      /* The feed's second question — which kind of post — asked only of posts the first passed;
         see `kindJudge` in work/score-posts.ts. Same model, its own prompt set and hash. */
      const kindJudge = buildJudge(cfg, meter, policy, log, policy.judge.postBatchMaxOutputTokens, 'kind');

      const runtimeDeps: PlatformRuntime = {
        meter,
        now: () => Date.now(),
        /* Read off `globalThis` HERE and nowhere below. Every adapter takes it as a
           dep precisely so that no package under adapters/ can reach the network from
           a unit test; this is the one file entitled to hand over the real one. */
        fetch: globalThis.fetch,
        /**
         * ★ NO HANDLE LOOKUP YET, AND SAYING SO IS THE POINT.
         *
         * One source addresses posts by URL, so re-reading one needs the author's
         * handle. We hold that on the author row, but there is no synchronous read for
         * it and this signature is synchronous — an adapter cannot await a database.
         * Returning null means those posts are SKIPPED rather than requested under a
         * guessed URL, which is the honest failure: a wrong URL costs a paid run and
         * returns nothing, and the run would look like the source having nothing to
         * say. What changes it is a warmed handle cache loaded per pass and closed
         * over here; until then this is a stated absence rather than a silent one.
         */
        handles: () => null,
      };

      const platforms = watchedRegistry(resolvePlatforms(cfg.sourceEnv, runtimeDeps), watch);

      /* Built after the sources, because TRACK's re-read is a call to one of them. */
      const work = storeWork(
        repos,
        policy,
        {
          judge,
          judgements: new PgJudgementRepo(db),
          meter,
          mode: cfg.spend.kind,
          policy,
          log: log.child({ step: 'judge' }),
        },
        { platforms, meter, mode: cfg.spend.kind, log: log.child({ step: 'track' }), now: () => Date.now() as Millis },
        /* GROUP's picture evidence: stored image vectors, the judge's names, and the
           same-subject question for borderline pictures (asked with QUALIFY's judge). */
        {
          images: new PgImageEmbeddingRepo(db),
          postScores: new PgPostJudgementRepo(db),
          storyJudgements: new PgJudgementRepo(db),
          pairs:
            judge === null
              ? null
              : {
                  judge,
                  pairs: new PgImagePairRepo(db),
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'image-pairs' }),
                  now: () => Date.now() as Millis,
                },
        },
      );

      /* ★ WRITTEN AT BOOT AND NOT ONLY PER PASS. The dormant/failing distinction has to
         be true on a deploy where discovery is switched off entirely, and it has to be
         true within seconds of a restart rather than at the end of the first cadence —
         otherwise a fresh process spends five minutes with an indicator that says
         nothing at all about sources it already knows everything about. */
      await declareSources(platforms, watch);
      log.info('sources resolved', {
        live: platforms.all().map((a) => String(a.id)),
        dark: platforms.absent().map((a) => `${a.source}:${a.configuration}`),
      });

      const loopDeps: LoopDeps = {
        policy,
        policyHash: hash,
        decisions: decisionLog,
        log,

        admit: work.admit,
        track: work.track,
        detect: work.detect,
        group: work.group,
        qualify: work.qualify,
        resolve: work.resolve,
        rank: work.rank,
      };

      /**
       * ★ THE PARTITION IS CREATED BEFORE THE FIRST DECISION OF THE DAY, NOT AFTER.
       *
       * Today's and tomorrow's, both, and tomorrow's is the one that matters: a runner
       * that only ever creates today's has nothing in place at midnight, and the first
       * rows of the new day land in `decisions_default` — which is the row the schema
       * defines as "the partition-maintenance job stopped running". Creating a day
       * ahead means the maintenance signal only ever fires when maintenance has
       * genuinely stopped for more than a day.
       */
      const maintenance: Maintenance = {
        ensurePartitions: async (now) => {
          const made: string[] = [];
          for (const offset of [0, MS_PER_DAY]) {
            const day = new Date(now + offset).toISOString().slice(0, DATE_LENGTH);
            await decisions.ensurePartition(day);
            made.push(day);
          }
          return made;
        },
        countUnapplied: async (sinceMs, limit) =>
          (await decisions.unapplied(sinceMs, limit)).length,
      };

      /* The coin lookup's sources, made once for the life of the process. The on-chain search
         keeps its own per-minute count and a minute's cache of answers; made afresh each pass,
         both were thrown away every minute and the count guarded nothing. With a CoinGecko key
         `cfg.marketData` is the paid plan at its own host, and its limit is that plan's. */
      const onChainMarket = geckoterminal({ ...cfg.marketData, fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS, now: Date.now });
      const lookupSources = [
        dexscreenerSearch({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS }),
        onChainMarket,
      ];
      log.info('coin lookup sources', { onChainPlan: cfg.marketData.plan });

      return {
        value: await use({
          db,
          stageRuns,
          loopDeps,
          maintenance,
          platforms,
          watch,
          meter,
          store: storeArrivals(repos, policy, () => Date.now() as Millis),
          feedFloors: new PgFeedFloorRepo(db),
          embedImages: () =>
            embedImages({
              embed:
                cfg.embeddings.state === 'configured'
                  ? voyageEmbed({
                      client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                      meter,
                      now: () => Date.now() as Millis,
                    })
                  : null,
              images: new PgImageEmbeddingRepo(db),
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'embed-images' }),
              now: () => Date.now() as Millis,
            }),
          universe: {
            coins: new PgCoinUniverseRepo(db),
            metadata: {
              /* Each gateway in turn; the last one's failure is the coin's, retried later. */
              read: async (uri) => {
                let failure: unknown = null;
                for (const gateway of cfg.metadataGateways) {
                  try {
                    return await fetchMetadata(uri, { gateway, fetch: globalThis.fetch, timeoutMs: policy.universe.metadataTimeoutMs, maxBytes: policy.universe.metadataMaxBytes });
                  } catch (e) {
                    failure = e;
                  }
                }
                throw failure ?? new Error('no metadata gateway configured');
              },
            },
            platforms,
            items: repos.items,
            authors: repos.authors,
            postScores: new PgPostJudgementRepo(db),
            images: new PgImageEmbeddingRepo(db),
            store: storeArrivals(repos, policy, () => Date.now() as Millis),
            postJudge,
            embed:
              cfg.embeddings.state === 'configured'
                ? voyageEmbed({
                    client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                    meter,
                    now: () => Date.now() as Millis,
                  })
                : null,
            pairs:
              judge === null
                ? null
                : { judge, pairs: new PgImagePairRepo(db), mode: cfg.spend.kind, policy, log: log.child({ step: 'image-pairs' }), now: () => Date.now() as Millis },
            meter,
            mode: cfg.spend.kind,
            policy,
            log,
          },
          /* The lookup, then the picture evidence for what it found (work/coin-match.ts), then
             whether the older coins it saw are trading since their posts (work/older-coins.ts),
             read through the lookup's own on-chain instance so one per-minute count covers both. */
          lookUpCoins: async () => {
            const looked = await lookUpCoins({
              older: new PgOlderCoinRepo(db),
              coins: new PgCoinUniverseRepo(db),
              assets: repos.assets,
              sources: lookupSources,
              chain: cfg.chainRpcUrl === null ? null : chainClient({ launchpadBaseUrl: '', rpcUrl: cfg.chainRpcUrl, fetch: globalThis.fetch }),
              policy,
              log: log.child({ step: 'coin-lookup' }),
              now: () => Date.now() as Millis,
            });
            await pictureCoinMatches(
              {
                coins: new PgCoinUniverseRepo(db),
                images: new PgImageEmbeddingRepo(db),
                embed:
                  cfg.embeddings.state === 'configured'
                    ? voyageEmbed({
                        client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                        meter,
                        now: () => Date.now() as Millis,
                      })
                    : null,
                pairs:
                  judge === null
                    ? null
                    : { judge, pairs: new PgImagePairRepo(db), mode: cfg.spend.kind, policy, log: log.child({ step: 'image-pairs' }), now: () => Date.now() as Millis },
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'coin-match' }),
                now: () => Date.now() as Millis,
              },
              policy.universe.matchWindowMs,
            );
            try {
              await checkOlderCoins({ older: new PgOlderCoinRepo(db), candles: onChainMarket, log: log.child({ step: 'older-coins' }), now: () => Date.now() as Millis });
            } catch (e) {
              log.warn('older coins could not be measured this pass; tried again next pass', { err: e instanceof Error ? e.message : String(e) });
            }
            return looked;
          },
          /* ★ THE LEARNING BOOK, NOT THE LIVE ONE. Each pass with work opens its own meter on
             `learning` (Policy.budget.learningLines), reading today's ledger fresh, with every
             spend labelled `learn:` as tools/lib/shared-meter.ts labels it, and its own sources
             built on that meter with the handles the pasted links carry. The live meter above is
             never handed to it. */
          missedPosts: () =>
            workMissedPosts({
              missed: new PgMissedPostRepo(db),
              openLearning: async (handles) => {
                const book = await openDurableMeter({
                  ledger: new PgSpendRepo(db),
                  book: 'learning',
                  dailyCapUsd: policy.budget.learningLines.dailyUsd,
                  perVendorCapUsd: jobVendorLines(policy, 'learning'),
                  defaultVendorCapUsd: policy.budget.perSourceUsdPerDay,
                  softStop: policy.budget.softStopFraction,
                  now: () => Date.now(),
                  onWriteFailure: (spend, error) =>
                    log.error('a learning spend could not be persisted', { vendor: spend.vendor, usd: spend.usd, err: error instanceof Error ? error.message : String(error) }),
                });
                const learning: Meter = { ...book, record: (spend) => book.record({ ...spend, endpoint: `${LEARN_ENDPOINT_PREFIX}${spend.endpoint}` }) };
                const sources = resolvePlatforms(cfg.sourceEnv, { meter: learning, now: () => Date.now() as Millis, fetch: globalThis.fetch, handles: (source, id) => handles(String(source), id) });
                return { sources: sources.all(), meter: learning, close: () => book.drain() };
              },
              store: storeArrivals(repos, policy, () => Date.now() as Millis),
              coinSearch: lookupSources,
              settings: async () => (await measureDiscovery({ recall: new PgRecallRepo(db), floors: new PgFeedFloorRepo(db) }, Date.now() as Millis, policy))?.settings ?? null,
              /* The posts supplier's catch-all endpoint, as its adapter records it (its SEARCH). */
              searchUsdPerDay: () => new PgMissedPostRepo(db).liveSpendSince(SUPPLIER_VENDORS.posts, 'search', (Date.now() - SPEND_WINDOW_MS) as Millis),
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'missed-posts' }),
              now: () => Date.now() as Millis,
            }),
          keepCoins: () =>
            keepCoins({
              coins: new PgCoinUniverseRepo(db),
              standings: dexscreenerStandings({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS }),
              policy,
              log: log.child({ step: 'coin-keep' }),
              now: () => Date.now() as Millis,
            }),
          backfill: () =>
            backfillStories({
              platforms,
              stories: repos.stories,
              names: new PgJudgementRepo(db),
              items: repos.items,
              backfill: new PgBackfillRepo(db),
              store: storeArrivals(repos, policy, () => Date.now() as Millis),
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'backfill' }),
              now: () => Date.now() as Millis,
            }),
          scorePosts: () =>
            scorePosts({
              judge: postJudge,
              kindJudge,
              items: repos.items,
              scores: new PgPostJudgementRepo(db),
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'score-posts' }),
              now: () => Date.now() as Millis,
            }),
        }),
      };
    });

    if (outcome === null) {
      throw new Error(
        `another runner already holds ${cfg.singletonLockName}; refusing to start a second one`,
      );
    }
    return outcome.value;
  } finally {
    await pool.end();
    await lockPool.end();
  }
}
