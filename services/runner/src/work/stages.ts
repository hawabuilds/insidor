/**
 * WHERE EACH STAGE'S SUBJECTS COME FROM, AND WHAT HAPPENS AFTER IT DECIDES.
 *
 * Seven `StageWork` implementations, all reading the database and nothing else. No
 * vendor is called from this file and none can be: every input below is either a row
 * we already hold or a typed absence, which is what makes `pnpm db:decide` a real
 * exercise of the write path rather than a mock of one.
 *
 * ── ★ THE RULE THAT DECIDES WHICH STAGES ARE WIRED HERE ──────────────────
 *
 * A stage is wired when every input it cannot be given today has a TYPED ABSENCE and
 * a NAMED VERDICT for that absence. It is left refusing when an absence would have to
 * be spelled as a number.
 *
 * That line is not a convenience, it is the house rule applied to wiring:
 *
 *   `DetectInput.self` is `Baseline | null` and detect() answers a null with
 *   `D1_insufficient_history` → abstain. `QualifyInput.judgement` is `Judgement | null`
 *   and qualify() answers a null with `Q1_unjudged` → abstain. `GroupInput.corpus` is
 *   documented "Empty is the honest day-one state". `ResolveInput.venueLabelCounts`
 *   empty is `V4_venue_cold_start` → abstain, which resolve/stage.ts says is "enforced
 *   here rather than remembered". Every one of those is a real, correct, replayable
 *   row that says exactly what we did and did not know.
 *
 *   `RankInput.heat.rateLcbNorm` is a plain `number`. Nothing in core exports the
 *   Gamma-Poisson lower bound that produces it, so wiring RANK today would mean typing
 *   a `0` into this file and logging it as a measurement. A zero is a claim; an
 *   absence is not. So RANK refuses, loudly, naming what is missing — see `rank` at
 *   the bottom of this file.
 *
 * Six wired, one refusing, and the refusal is visible in `internal.stage_runs.err`
 * next to real failures rather than in a comment nobody opens.
 *
 * ── WHAT `apply` DOES, AND WHY SOME OF THEM THROW ────────────────────────
 *
 * `apply` is the side effect, and `applied_at` means "the side effect actually
 * succeeded". So an `apply` that does nothing must only mark a row applied when there
 * was genuinely nothing to do. Each one below therefore asks a single question — does
 * this verdict owe the world an action? — and:
 *
 *   no action owed   → returns, the row is marked applied, and that stamp is true.
 *   action owed, and the artefact to write it to does not exist yet
 *                    → throws NotImplemented, naming the artefact. The decision row
 *                      STANDS with `applied_at IS NULL`, which is exactly the state
 *                      `decisions_unapplied_idx` indexes and `PgDecisionRepo.unapplied`
 *                      selects. The gap reports itself through the repair queue the
 *                      log-then-act asymmetry was built to create.
 *
 * Marking those applied instead would be the one lie this table has no defence
 * against: every other falsehood is caught by a CHECK, and "the effect happened" is
 * not checkable from inside the database.
 */

import { candidateId } from '@insidor/contracts/ids.ts';
import type { ItemId } from '@insidor/contracts/ids.ts';
import type { Decision, Item, Millis, Observation, Policy } from '@insidor/contracts';
import type {
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgItemRepo,
  PgObservationRepo,
  PgStoryRepo,
} from '@insidor/store';

import type {
  AdmitInput,
  DetectInput,
  GroupInput,
  QualifyInput,
  RankInput,
  ResolveInput,
  StageWork,
  TrackInput,
} from '../loop.ts';
import { NotImplemented } from '../not-implemented.ts';

/* ── operational constants ────────────────────────────────────────────────
   Cadences, page sizes and lookbacks — how much is fetched, never what is decided.
   Every threshold a verdict turns on is in Policy and is hashed into the row; nothing
   here changes an outcome, so these literals are allowed to sit in a service and would
   not be allowed to sit in core. */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * How many extra rows a pull fetches before filtering out the ones this stage has
 * already decided.
 *
 * A page of subjects is read from `public`, then narrowed by
 * `PgDecisionRepo.decidedSubjects`. Without overscan a page that happens to be all
 * already-decided returns nothing and the loop stalls on a backlog it can see. Four is
 * a guess about how much of a page is typically stale and is safe to change: it costs
 * a wider read and cannot change any verdict.
 */
const PULL_OVERSCAN = 4;

/**
 * How far back each stage's pull reaches for candidate subjects.
 *
 * Presentation-style bounds, not judgements. ADMIT's own `maxAgeMin` still rejects
 * anything too old to have lead time left, so widening this cannot admit an item the
 * policy would refuse — it only decides how much is read.
 */
const ADMIT_LOOKBACK_MS = 2 * MS_PER_DAY;
const TRACK_LOOKBACK_MS = 7 * MS_PER_DAY;
const DETECT_LOOKBACK_MS = 2 * MS_PER_DAY;
const GROUP_LOOKBACK_MS = 2 * MS_PER_DAY;
/** The window the observation series is fetched over, for the stages that difference it. */
const OBSERVATION_WINDOW_MS = 7 * MS_PER_DAY;
/** Open stories an arriving item is scored against. Bounded by recency, per StoryRepo. */
const GROUP_CANDIDATE_WINDOW_MS = 12 * MS_PER_HOUR;
const GROUP_CANDIDATE_LIMIT = 200;

/**
 * The re-read budget one TRACK pass may spend.
 *
 * ★ AN OPERATIONAL NUMBER AND NOT A POLICY ONE, which is worth arguing because it is
 * the sort of number that migrates. `Policy.track` owns the GRID — which tier waits how
 * long, when a tier is demoted, when tracking stops. This owns how many reads this
 * process can afford in one pass of one loop, which is a fact about our vendor bill and
 * our queue depth, not about how fast an item is moving. The two are different
 * questions and folding them together would mean a deploy that halves the batch size
 * silently retunes the tracking policy, with nothing in the decision row saying so.
 *
 * It is spent IN QUEUE ORDER: the Nth item due this pass sees `BUDGET − N` reads left,
 * so backpressure lands on whatever is least overdue. Deterministic, therefore
 * replayable — the alternative, serving whatever a scheduler happened to claim first,
 * makes the survivors a function of process order and destroys replay.
 */
const TRACK_READ_BUDGET = 250;

/* ── what this module needs from the store ────────────────────────────── */

export interface StageRepos {
  readonly items: PgItemRepo;
  readonly authors: PgAuthorRepo;
  readonly observations: PgObservationRepo;
  readonly stories: PgStoryRepo;
  readonly assets: PgAssetRepo;
  readonly decisions: PgDecisionRepo;
}

/* ── shared helpers ───────────────────────────────────────────────────── */

/**
 * ★ HOW OFTEN EACH STAGE IS ENTITLED TO DECIDE THE SAME SUBJECT AGAIN.
 *
 * `null` means once, ever. A number means "not again within this interval".
 *
 * The split is not a tuning choice, it is what each stage's question is about:
 *
 *   admit   once — an arrival is admitted once. Re-deciding a day-old item produces
 *           `A3_too_old` for ever, which is noise with a reason code attached.
 *   group   120s — and it is the one entry that is a cadence for a reason other than
 *           its own. See the note below: GROUP cannot be deduplicated by subject id
 *           at all, so this is its loop's cadence and nothing more.
 *   track   30s — SHORTER THAN THE FINEST GRID TIER (4 minutes), and that is the
 *           binding constraint. A claim queue polled less often than its shortest
 *           due-interval turns the schedule into a suggestion, and the slip is
 *           largest on the hottest items — exactly the ones the density was bought
 *           for. This is the one stage where "decide once per subject" would be a
 *           silent, total failure: everything ever seen would stop being tracked on
 *           the second pass.
 *   detect  60s — its answer changes when a new reading lands, and readings land on
 *           the track grid.
 *   qualify 120s — its answer changes when a story gains a member.
 *   resolve 60s — its answer changes when a new asset is minted inside the window.
 *
 * Each matches its loop's own cadence in `loops/`, because a loop that woke every
 * thirty seconds and then declined to decide anything would be a loop that had been
 * turned off by a constant in a different file.
 *
 * ★ AND THE CAVEAT THAT MAKES THIS FILTER PARTIAL FOR TWO STAGES, WHICH IS WORTH
 * KNOWING BEFORE SOMEBODY TRUSTS IT.
 *
 * The filter compares the id a `pull` iterates against `internal.decisions.subject_id`.
 * For five stages those are the same string. For two they are not, because the subject
 * of the decision is not the subject of the pull:
 *
 *   GROUP pulls ITEMS and writes `subjectKind: 'pair'` with `pairId(item, story)` —
 *   "is this item part of THAT story" is a question about a pair, and a row keyed by
 *   the item alone could not say which candidate it was about. So an item that joined
 *   is invisible to this filter and is re-decided every pass.
 *
 *   RESOLVE pulls STORIES and writes `candidateId(story, asset)` whenever a candidate
 *   survives, for the same reason.
 *
 * That is not a defect in the id scheme — the pair id is right, and `PairId`'s own
 * comment explains that deriving it from its two halves is what makes a re-decision
 * recognisable as a re-decision. It means the DURABLE filter for GROUP is membership
 * ("is this item already in a story") and for RESOLVE is the story→asset link, and
 * neither exists yet because neither stage's `apply` is wired. Matching on an id
 * PREFIX would work and is deliberately not done: it would couple this file to the
 * log's string format, which is exactly the coupling the label pipeline is warned off.
 *
 * Until those two writes land, GROUP re-decides on its cadence and its rows accumulate
 * — which is what a live runner would do anyway, and which is honest rather than
 * silently deduplicated against the wrong key.
 */
const REDECIDE_AFTER_MS: Readonly<Record<string, number | null>> = {
  admit: null,
  group: 120_000,
  track: 30_000,
  detect: 60_000,
  qualify: 120_000,
  resolve: 60_000,
};

/**
 * The subjects on this page this stage is entitled to decide right now.
 *
 * ★ THIS IS WHAT MAKES A PASS RE-RUNNABLE WITHOUT MAKING IT INERT. `pnpm db:decide`
 * is meant to be run twice in a row on a laptop; without this the second run writes a
 * second identical row for every subject, and the log stops being a record of
 * decisions and becomes a record of how many times somebody ran a script. With it
 * applied too broadly the opposite happens and TRACK stops tracking. `REDECIDE_AFTER_MS`
 * above is where the two are balanced, per stage, with the reason attached.
 *
 * It is NOT a uniqueness constraint and must not become one. Re-deciding a subject is
 * legitimate and expected, and a correction is a new row because the table is
 * append-only. This only says "not again yet".
 */
async function undecided<T>(
  repos: StageRepos,
  stage: Decision['stage'],
  subjects: readonly T[],
  idOf: (subject: T) => string,
  limit: number,
  now: Millis,
): Promise<readonly T[]> {
  const after = REDECIDE_AFTER_MS[stage] ?? null;
  const decided = await repos.decisions.decidedSubjects(
    stage,
    subjects.map(idOf),
    after === null ? null : now - after,
  );
  const fresh: T[] = [];
  for (const subject of subjects) {
    if (decided.has(idOf(subject))) continue;
    fresh.push(subject);
    if (fresh.length >= limit) break;
  }
  return fresh;
}

/** The newest reading of any counter, or first sight when nothing has been read. */
function lastReadAt(item: Item, observations: readonly Observation[]): Millis {
  let newest = item.firstSeenAt;
  for (const o of observations) if (o.capturedAt > newest) newest = o.capturedAt;
  return newest;
}

/**
 * Consecutive newest-first readings that produced no usable rate.
 *
 * A streak, not a count: `flatReadsToDemote` is about a RUN of silence, because one
 * censored reading in the middle of a live series is a hiccup and three in a row is
 * the source having changed shape under us. Counting all of them instead would demote
 * an item for something that stopped happening an hour ago.
 */
function censoredStreak(observations: readonly Observation[]): number {
  let streak = 0;
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    const o = observations[i];
    if (o === undefined || o.rate.kind !== 'censored') break;
    streak += 1;
  }
  return streak;
}

/* ── ADMIT ────────────────────────────────────────────────────────────── */

/**
 * ★ WHY `pull` READS `public.item` RATHER THAN CALLING DISCOVERY.
 *
 * In production ADMIT's subjects arrive from a platform adapter's `discover()`, and
 * the item is persisted on the way past. Here they are read back out of the table
 * that discovery already filled, which changes nothing about the decision: ADMIT
 * scores an `Item`, and an `Item` is an `Item` whether it arrived a second ago over a
 * socket or a day ago through the seed. What it does change is that this path needs no
 * key, no quota and no network — so the write path is exercisable on a laptop, which
 * is the whole point of `pnpm db:decide`.
 *
 * The consequence is that ADMIT's own side effect — persisting the item — has already
 * happened before the decision is taken. See `apply` below.
 */
function admitWork(repos: StageRepos, policy: Policy): StageWork<AdmitInput> {
  return {
    async pull(limit, ctx) {
      const now = ctx.now();
      const page = await repos.items.admittedSince(
        now - ADMIT_LOOKBACK_MS,
        limit * PULL_OVERSCAN,
      );
      const items = await undecided(repos, 'admit', page, (i) => i.itemId, limit, now);
      if (items.length === 0) return [];

      const authors = await repos.authors.byKeys(items.map((i) => i.authorKey));

      /* ★ THE BAR IS A QUANTILE OF WHAT WE ACTUALLY SCORED, NOT A CONSTANT.
         admit/stage.ts: "A typed score floor drifts out of calibration the moment
         volume moves, and cannot be compared across sources at all." So it is read
         back off the log, and when the log has nothing to say — day one, which is
         today — it falls to `quantileFloor`, which is a bar somebody chose rather
         than a zero that would admit everything. Clamped both ways so one strange
         night cannot open or shut the gate. */
      const measured = await repos.decisions.scoreQuantile(
        'admit',
        now - MS_PER_DAY,
        policy.admit.quantile,
      );
      const admissionBar = Math.min(
        Math.max(measured ?? policy.admit.quantileFloor, policy.admit.quantileFloor),
        policy.admit.quantileCeiling,
      );

      /* The tracking budget, as a count of today's admissions. It is a query over the
         decision log and not a counter in memory, because a counter in memory resets
         on every deploy and a counter in its own table is a second thing to keep in
         step with the first. */
      const admittedToday = await repos.decisions.countSince(
        'admit',
        'pass',
        now - MS_PER_DAY,
      );
      const budgetExhausted = admittedToday >= policy.admit.dailyAdmitTarget;

      return items.map((item) => ({
        item,
        author: authors.get(item.authorKey) ?? null,
        /* ★ NULL, NOT ZERO, AND THE DIFFERENCE IS THE WHOLE FEATURE. Carrier
           acceleration is "how fast this item's carriers are spreading relative to
           their own trailing rate" — the one strong signal available at ZERO
           engagement, which is where lead time is made. It is computed by the carrier
           index, which accrues daily document frequency forward only and has nothing
           in it yet (`internal.term_daily` is empty). A zero here would say the
           carriers are spreading at exactly their trailing rate, which is a
           measurement; we have not measured anything. */
        carrierAcceleration: null,
        admissionBar,
        /* We found this item BY its id, so there is no second source id to have
           already admitted it under. The cross-source duplicate check needs a
           fingerprint lookup across sources, which the carrier index will answer once
           it holds anything. False is the honest answer to "have we seen this exact
           item under another id" when we have looked and the answer is no. */
        alreadyAdmitted: false,
        /* An empty suppression roster is EMPTY, not missing. There is no roster table
           and no account has ever been suppressed, so "is this account suppressed" has
           a real answer and it is no. This is the one place a `false` here is a fact
           rather than a default. */
        authorSuppressed: false,
        budgetExhausted,
        /* Discovery already happened and its cost was metered wherever it happened.
           Attributing it again to this decision would double-count the spend. */
        costUsd: 0,
      }));
    },

    subjectId: (input) => input.item.itemId,

    /**
     * ADMIT's side effect is persisting the item and its author, and on this path it
     * has already happened — `pull` read them back out of the tables discovery wrote.
     * So there is genuinely nothing left owed, on any verdict, and marking the row
     * applied is true rather than convenient.
     *
     * The one thing a `pass` would additionally owe is a place on the tracking queue.
     * `public.item` has no such column: items.ts says so where `dueForObservation`
     * throws — "there is no next_read_at column to schedule against". Until that
     * column exists the queue IS the decision log, and TRACK's pull below reads it
     * from there, so a pass owes nothing this file can write.
     */
    apply: () => Promise.resolve(),
  };
}

/* ── TRACK ────────────────────────────────────────────────────────────── */

function trackWork(repos: StageRepos, policy: Policy): StageWork<TrackInput> {
  return {
    async pull(limit, ctx) {
      const now = ctx.now();
      const page = await repos.items.admittedSince(
        now - TRACK_LOOKBACK_MS,
        limit * PULL_OVERSCAN,
      );
      const items = await undecided(repos, 'track', page, (i) => i.itemId, limit, now);
      if (items.length === 0) return [];

      const ids = items.map((i) => i.itemId);
      const series = await repos.observations.seriesForItems(
        ids,
        now - OBSERVATION_WINDOW_MS,
      );

      /* ★ THE STAGE RECOVERS ITS OWN STATE FROM ITS OWN LOG, and that is deliberate.
         The tier an item is on is `scheduledTier` in the vector TRACK logged last
         pass; the lane it was put in is `explore_arm` on the row ADMIT wrote. Keeping
         a mirror of either in `public` would be a second copy of the same fact, free
         to disagree with the first, and the log is the copy that cannot be quietly
         edited. */
      const lastTrack = await repos.decisions.latestForSubjects('track', ids);
      const lastAdmit = await repos.decisions.latestForSubjects('admit', ids);

      const probationTier = policy.track.tierMinutes.length - 1;

      return items.map((item, index) => {
        const observations = series.get(item.itemId) ?? [];
        const previous = lastTrack.get(item.itemId);
        const admitted = lastAdmit.get(item.itemId);

        return {
          item,
          observations,
          lastReadAt: lastReadAt(item, observations),
          /* ★ A NEW ITEM STARTS ON PROBATION, THE BOTTOM OF THE GRID, AND CLIMBS.
             Not the top: `nextRead` moves at most one tier per read in either
             direction, so starting an unknown item at tier 0 would hand it the most
             expensive cadence in the system on the strength of nothing, and it would
             take seven passes to come back down. Probation is where lead time is made
             and it is where an item we have not made our minds up about belongs. */
          tier: previous?.features['scheduledTier'] ?? probationTier,
          /* Null before anything scored it, and null is not zero — schedule.ts holds
             the current tier on a null and would demote on a zero. The score comes
             from ADMIT because that is the last stage to have decided anything about
             this item; when RANK is wired its score is fresher and wins. */
          lastScore: admitted?.score ?? null,
          censoredReadStreak: censoredStreak(observations),
          /* ★ AN INPUT AND NEVER RECOMPUTED HERE, per TrackInput's own doc: the
             lifecycle is built by a hysteresis machine over a series of readings, and
             recomputing it from one pass would be the flapping the hysteresis exists
             to prevent — applied to `T3_terminal`, the one verdict that ends an
             item's history. Null until something durable holds it. */
          lifecycle: null,
          /* The lane assignment made at admission. Never recomputed here: re-drawing
             it would mean an item could leave the holdout, and a hole in the unbiased
             record is the one thing that cannot be repaired later. */
          isHeldBack: admitted?.exploreArm === 'holdout',
          /* Spent in queue order — see TRACK_READ_BUDGET. Never below zero: a negative
             budget is not more exhausted than an empty one. */
          readsAvailable: Math.max(TRACK_READ_BUDGET - index, 0),
          costUsd: 0,
        };
      });
    },

    subjectId: (input) => input.item.itemId,

    /**
     * A TRACK `pass` means a read is due and affordable, and the read is the effect.
     * Performing it needs a platform adapter's `observe()`, which this service does
     * not import yet — so a pass owes an action nobody can take, and the row is left
     * unapplied rather than stamped with a claim that a source was contacted.
     *
     * Every other verdict owes nothing: `T6_not_due` and `T2_budget_shed` are holds
     * that resolve by waiting, and `T3_terminal` is the absence of any further read.
     */
    apply: (_input, receipt) => {
      if (receipt.decision.verdict !== 'pass') return Promise.resolve();
      return Promise.reject(
        new NotImplemented(
          'track.apply — the re-read itself: a platform adapter observe() plus ' +
            'ObservationRepo.append. Until then a due read is logged and not taken, ' +
            'and the row stays in the unapplied queue rather than claiming otherwise',
        ),
      );
    },
  };
}

/* ── DETECT ───────────────────────────────────────────────────────────── */

/**
 * ★ WHY ALL FOUR DERIVED INPUTS ARE NULL, AND WHY THAT IS A DECISION RATHER THAN A
 * SHORTFALL.
 *
 * `fast`, `slow`, `self` and `population` are an EWMA pair and two negative-binomial
 * fits. Every one of them is computed by a function in core — `kinetics/ewma.ts`,
 * `detect/baseline.ts` — and core's barrel deliberately exports twelve names, none of
 * which is a builder for them. Its header says why: "a service that needs a helper
 * directly is a service doing something core should be doing."
 *
 * Folding the EWMAs here would be doing exactly that, and it is the specific failure
 * `features/registry.ts` names — train/serve skew, where the trainer recomputes a
 * feature slightly differently from the server and the model quietly degrades. So this
 * file does not fold them. It passes the nulls, and DETECT answers them with
 * `D4_baseline_unavailable` and `D1_insufficient_history`, both ABSTAIN, both meaning
 * "we did not have what we needed" rather than "this item is quiet".
 *
 * detect/baseline.ts makes the same point about the value rather than the code: "an
 * absent baseline may never be replaced by a fabricated one. `expectation = 0` … makes
 * every count infinitely surprising, so an item with no history alerts on its first
 * reading, forever, on exactly the accounts an adversary creates for free."
 *
 * ★ THE ROWS ARE STILL WORTH WRITING, and this is the part that is easy to miss. The
 * absolute floor is checked BEFORE either baseline, because it is the one gate an
 * adversary cannot open — so a real count that clears or misses
 * `absoluteFloorByKind` produces `D3_below_absolute_floor`, a genuine drop, today,
 * with the count and the floor both in the vector. The stage is not idling; it is
 * running its first gate for real and abstaining honestly at the second.
 *
 * THE NAMED GAP: core needs an input builder — a pure function from an observation
 * series to a `DetectInput` — exported from its barrel. That is one function in core,
 * not a redesign here.
 */
function detectWork(repos: StageRepos): StageWork<DetectInput> {
  return {
    async pull(limit, ctx) {
      const now = ctx.now();
      const page = await repos.items.admittedSince(
        now - DETECT_LOOKBACK_MS,
        limit * PULL_OVERSCAN,
      );
      const items = await undecided(repos, 'detect', page, (i) => i.itemId, limit, now);
      if (items.length === 0) return [];

      const series = await repos.observations.seriesForItems(
        items.map((i) => i.itemId),
        now - OBSERVATION_WINDOW_MS,
      );

      return items.map((item) => ({
        item,
        observations: series.get(item.itemId) ?? [],
        fast: null,
        slow: null,
        self: null,
        population: null,
        costUsd: 0,
      }));
    },

    subjectId: (input) => input.item.itemId,

    /**
     * DETECT has no side effect in any design. Its output IS the row — the burst
     * verdict is consumed by whatever reads the log next, and there is nothing to
     * persist elsewhere. Every verdict marks applied, truthfully.
     */
    apply: () => Promise.resolve(),
  };
}

/* ── GROUP ────────────────────────────────────────────────────────────── */

function groupWork(repos: StageRepos): StageWork<GroupInput> {
  return {
    async pull(limit, ctx) {
      const now = ctx.now();
      const page = await repos.items.admittedSince(
        now - GROUP_LOOKBACK_MS,
        limit * PULL_OVERSCAN,
      );
      const items = await undecided(repos, 'group', page, (i) => i.itemId, limit, now);
      if (items.length === 0) return [];

      const candidates = await repos.stories.openSince(
        now - GROUP_CANDIDATE_WINDOW_MS,
        GROUP_CANDIDATE_LIMIT,
      );

      /* ★ THE LINEAGE LOOKUP, WHICH IS WHY IT IS AN INPUT AND NOT SOMETHING THE STAGE
         DOES. GroupInput.lineage's own doc: "`Item.reproductionOf` names an ITEM and
         `Story` carries no member list, so turning 'points at item X' into 'points
         into story S' is a store lookup. A stage that could do a lookup could do a
         fetch." */
      const pointers: ItemId[] = [];
      for (const item of items) {
        const target = item.reproductionOf ?? item.rebroadcastOf;
        if (target !== null) pointers.push(target);
      }
      const storyOf = await repos.stories.storiesOfItems(pointers);

      return items.map((item) => {
        const reproduction = item.reproductionOf;
        const rebroadcast = item.rebroadcastOf;
        const target = reproduction ?? rebroadcast;
        const story = target === null ? undefined : storyOf.get(target);

        return {
          item,
          candidates,
          /* Empty because the embed port is not wired. carriers.ts is explicit that
             this must DEGRADE the match rather than block it, and the vector keeps
             `representationConsulted` and `representationPresent` as separate keys so
             an outage, a short circuit and a genuine dissimilarity stay three
             different rows for ever. */
          similarity: {},
          lineage:
            target === undefined || target === null || story === undefined
              ? null
              : {
                  via: reproduction !== null ? ('reproduction' as const) : ('rebroadcast' as const),
                  toItem: target,
                  story,
                },
          /* Empty is the honest day-one state, and carriers.ts handles it by weighting
             a carrier the corpus has never seen at FULL strength rather than at zero —
             "A zero default would mean nothing joins until fourteen days of history
             exist." */
          corpus: {},
          costUsd: 0,
        };
      });
    },

    subjectId: (input) => input.item.itemId,

    /**
     * A GROUP `pass` is a join and owes a `public.story_member` row; an
     * `M6_no_candidate_block` abstain owes a newly seeded candidate story. Both are
     * real writes against tables that exist, and both are deliberately NOT made here.
     *
     * The reason is that membership is the one artefact in this system that changes
     * what every later stage sees — QUALIFY counts members, RESOLVE dates the story
     * from them — so writing it is a change to the pipeline's behaviour rather than to
     * its record-keeping, and it belongs in the change that wires GROUP's actuation
     * rather than in the one that wires the log. Until then the join is decided,
     * logged in full with its seven match channels, and left unapplied.
     *
     * `M3_below_match_bar`, `M4_ambiguous_match`, `M5_generic_carrier` and
     * `M9_member_cap` owe nothing: none of them adds a member.
     */
    apply: (_input, receipt) => {
      const { verdict, reason } = receipt.decision;
      const owesAJoin = verdict === 'pass';
      const owesASeed = reason === 'M6_no_candidate_block';
      if (!owesAJoin && !owesASeed) return Promise.resolve();
      return Promise.reject(
        new NotImplemented(
          `group.apply — ${owesAJoin ? 'StoryRepo.addMembers for the join' : 'a seeded candidate story'}. ` +
            'Membership changes what QUALIFY and RESOLVE see, so it is wired with ' +
            "GROUP's actuation and not with the log",
        ),
      );
    },
  };
}

/* ── QUALIFY ──────────────────────────────────────────────────────────── */

function qualifyWork(repos: StageRepos): StageWork<QualifyInput> {
  return {
    async pull(limit, ctx) {
      const now = ctx.now();
      const page = await repos.stories.openSince(
        now - GROUP_CANDIDATE_WINDOW_MS,
        limit * PULL_OVERSCAN,
      );
      const stories = await undecided(repos, 'qualify', page, (s) => s.storyId, limit, now);
      if (stories.length === 0) return [];

      const members = await repos.stories.membersForStories(stories.map((s) => s.storyId));

      return stories.map((story) => ({
        story,
        members: members.get(story.storyId) ?? [],
        /* ★ NULL AND NEVER AN EMPTY JUDGEMENT, which the field's own doc insists on.
           The judge call happens in an adapter and is the only per-subject spend in
           the pipeline; it has not been made, so there is no judgement. QUALIFY
           answers a null with `Q1_unjudged` → ABSTAIN, which is "we never asked" and
           is a different population from "we asked and it said no" (`Q9`). Fabricating
           an empty judgement would merge the two and make every later recall number
           over this stage a lie. */
        judgement: null,
        /* No call, no cost. A judge cost of zero here is a fact, not a default. */
        judgeCostUsd: 0,
      }));
    },

    subjectId: (input) => input.story.storyId,

    /**
     * A QUALIFY `pass` owes a promotion and a rendered title — `StoryRepo.upsert` with
     * state `promoted`, then `setPresentation`. Both exist. They are not written here
     * for the same reason as GROUP: promotion decides what downstream stages are
     * allowed to look at, so it changes the pipeline rather than the record.
     *
     * With no judge wired every row is `Q1_unjudged` today, which owes nothing at all —
     * so this branch is currently unreachable and is written for the day it is not.
     */
    apply: (_input, receipt) => {
      if (receipt.decision.verdict !== 'pass') return Promise.resolve();
      return Promise.reject(
        new NotImplemented(
          'qualify.apply — promotion and presentation (StoryRepo.upsert + setPresentation). ' +
            'Promotion changes what downstream stages may look at, so it is wired with ' +
            "QUALIFY's actuation and not with the log",
        ),
      );
    },
  };
}

/* ── RESOLVE ──────────────────────────────────────────────────────────── */

function resolveWork(repos: StageRepos, policy: Policy): StageWork<ResolveInput> {
  return {
    async pull(limit, ctx) {
      const now = ctx.now();
      const page = await repos.stories.openSince(
        now - GROUP_CANDIDATE_WINDOW_MS,
        limit * PULL_OVERSCAN,
      );
      const stories = await undecided(repos, 'resolve', page, (s) => s.storyId, limit, now);
      if (stories.length === 0) return [];

      /* The chain is asked for rather than named. A chain's name typed into a service
         is the first step of the leak the vocabulary gate stops one layer up, and the
         store already knows which chains it holds. */
      const chains = await repos.assets.chains();

      const inputs: ResolveInput[] = [];
      for (const story of stories) {
        /* ★ RETRIEVAL IS TIME-FIRST AND THE WINDOW IS THE GATES' OWN WINDOW.
           `[earliestPostAt + minLagMs, earliestPostAt + maxLagMs]` is exactly what
           `runGates` re-applies as G2 and G3, so retrieval cannot admit a candidate
           the gates would reject nor hide one they would accept. Symbol never selects
           this set — AssetRepo's own comment calls searching by symbol and then
           filtering by time "the inversion that produces a plausible, wrong,
           expensive answer". */
        const from = story.earliestPostAt + policy.resolve.minLagMs;
        const to = story.earliestPostAt + policy.resolve.maxLagMs;

        const candidates: ResolveInput['candidates'][number][] = [];
        for (const chain of chains) {
          /* ★ THE STORY'S OWN ORIGIN GOES INTO RETRIEVAL, and it is passed rather than
             assumed for the reason the parameter is required at all. This retrieval has
             TWO subjects — a story and the coins it may be compared against — and the
             version of it that named only the coin answered a different question: it
             asked "is this coin observed", which has a constant for an answer, in place of
             "may this coin be compared against this story", which does not.

             What that cost, measured through this loop and read back out of the decision
             log it wrote: every fixture story arrived at the gates with 43 candidates
             where its window held 51–54, and st_pigeon arrived with 0 where its window
             held 2 — logged, permanently, as `V3_no_candidates`. A stage that reports no
             candidates for a subject that had candidates does not merely abstain; it
             freezes a false negative into the append-only table every later recall number
             is computed over, and this file's own comment above calls those abstains "the
             training set".

             The direction is safe in the half that matters. `coinOriginsVisibleTo` gives
             an observed story exactly the list this call used to hardcode, so a fixture
             still cannot reach a real story's candidate set — which is the journey the
             repo method's header calls the furthest a fiction can travel here. */
          const assets = await repos.assets.mintedBetween(
            chain,
            from,
            to,
            policy.resolve.maxCandidates,
            story.origin,
          );
          for (const asset of assets) {
            candidates.push({
              candidateId: candidateId(story.storyId, asset.ref),
              asset,
              venue: asset.venue,
              /* No venue read has been made, so there is no market state. The gates
                 answer that with `G5_transfer_rules_unread` — "an unread rule is not a
                 passed rule" — which is the correct and conservative direction. */
              market: null,
              quote: null,
              /* ★ FALSE, AND THE DISTINCTION IS LOAD-BEARING. `quoteFailed` means the
                 quote is null because OUR vendor failed. Ours did not fail; it was
                 never asked. That keeps `G7_vendor_unavailable` and `G7_unquotable`
                 two different rows, which is the difference between "this asset cannot
                 be traded" and "we could not find out". */
              quoteFailed: false,
              /* All five channels unmeasured. score.ts scores an unmeasured channel as
                 zero without renormalising — that is the SCORE's rule — while the
                 vector keeps the null. Both are correct and they are not the same
                 rule; this file supplies the null and lets each apply its own. */
              signals: {
                symbol: null,
                collisionIdf: null,
                semantic: null,
                image: null,
                declared: null,
              },
            });
          }
        }

        inputs.push({
          story,
          candidates,
          /* ★ EMPTY, AND THAT IS WHY EVERY ROW HERE ABSTAINS. Scores are not comparable
             across venues — the collision statistic depends on that venue's symbol
             density and the time channel on its lag distribution — so a venue's first
             months are read-only until it has `minVenueLabels` adjudicated labels of
             its own. `internal.labels` holds zero. resolve/stage.ts calls this
             "enforced here rather than remembered", and `V4_venue_cold_start` is the
             row that says so. Those abstains are the training set: every one freezes
             the vector a human will later adjudicate against, which is how a venue
             clears its cold start at all. */
          venueLabelCounts: {},
          costUsd: 0,
        });
      }
      return inputs;
    },

    subjectId: (input) => input.story.storyId,

    /**
     * A RESOLVE `pass` owes the story→asset link, and there is nowhere to put it.
     * Verified against all twelve migrations: `public.story` has no asset column,
     * `public.asset` has no story column, and there is no `story_asset` table. The link
     * exists today only as the subject id of the passing row — `story_7f3a|solana:9xQe…`
     * encodes both halves — which is recoverable but couples anything that reads it to
     * the log's string format.
     *
     * So a pass is refused, naming the missing table. Every other verdict owes nothing:
     * `V4_venue_cold_start` is an abstain whose entire purpose is to write the vector
     * down and change nothing.
     */
    apply: (_input, receipt) => {
      if (receipt.decision.verdict !== 'pass') return Promise.resolve();
      return Promise.reject(
        new NotImplemented(
          'resolve.apply — the story→asset link. No `story_asset` projection table ' +
            'exists in any migration; the link lives only inside the passing row’s ' +
            'subject id, and the label pipeline must not have to parse that',
        ),
      );
    },
  };
}

/* ── RANK ─────────────────────────────────────────────────────────────── */

/**
 * ★ THE ONE STAGE THAT REFUSES, AND WHY REFUSING IS THE CORRECT ANSWER.
 *
 * Six of the seven are wired above, every one of them handing some stage a typed
 * absence that the stage has a named verdict for. RANK cannot be wired that way,
 * because its absences have nowhere to live:
 *
 *   `HeatInputs.rateLcbNorm` is a plain `number`, documented "A shrunk, normalised
 *   arrival rate. Never a raw count and never an absolute level", and heat.ts adds
 *   "The shrunk rate is the caller's job. Feeding a raw rate in reintroduces the
 *   small-sample problem this whole design is trying to avoid." The quantity is
 *   `rate_LCB = Gamma⁻¹(0.10 ; a₀ + R(t), b₀ + t)`. Nothing in core exports it.
 *
 *   `HeatInputs.quality` is a plain `number` in [0,1], and which function computes it
 *   is lane-specific — it is the only place the two lanes differ.
 *
 * Wiring RANK today would mean typing `0` into both and logging them as measurements
 * on every row. `rank/extract` writes them into the vector raw, `gate()` recomputes
 * heat from exactly those numbers, and a replay six months from now would read two
 * measured zeroes rather than two absences. That is the failure this repository names
 * in three separate files — a zero is a claim, an absence is not — and there is no
 * `burstMeasured`-style companion flag for either field to carry the truth instead.
 *
 * Note what RANK does provide for its third input: `burstMeasured` exists precisely
 * so the neutral stand-in fed to `heat.burst` cannot be mistaken for a measurement.
 * That is the shape the other two would need before this stage can honestly run.
 *
 * So it throws, and the throw lands in `internal.stage_runs.err` through the ordinary
 * finally path — the skeleton reporting its own gap in the same query that reports a
 * real failure, rather than in a comment nobody opens.
 */
function rankWork(): StageWork<RankInput> {
  const why =
    'rank.pull — HeatInputs.rateLcbNorm and .quality are plain numbers with no null, ' +
    'and nothing in core exports the Gamma-Poisson lower bound or the lane quality ' +
    'that produce them. Wiring this stage today would mean logging two typed zeroes ' +
    'as measurements. Needs a rate_LCB builder exported from core (see ' +
    'features/item.ts) before RANK can write an honest row';

  return {
    pull: () => Promise.reject(new NotImplemented(why)),
    subjectId: () => {
      throw new NotImplemented(why);
    },
    apply: () => Promise.reject(new NotImplemented(why)),
  };
}

/* ── the set ──────────────────────────────────────────────────────────── */

export interface StoreWork {
  readonly admit: StageWork<AdmitInput>;
  readonly track: StageWork<TrackInput>;
  readonly detect: StageWork<DetectInput>;
  readonly group: StageWork<GroupInput>;
  readonly qualify: StageWork<QualifyInput>;
  readonly resolve: StageWork<ResolveInput>;
  readonly rank: StageWork<RankInput>;
}

export function storeWork(repos: StageRepos, policy: Policy): StoreWork {
  return {
    admit: admitWork(repos, policy),
    track: trackWork(repos, policy),
    detect: detectWork(repos),
    group: groupWork(repos),
    qualify: qualifyWork(repos),
    resolve: resolveWork(repos, policy),
    rank: rankWork(),
  };
}
