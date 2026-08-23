/**
 * ★ THE OUTCOME LABELLER, RUN ONCE: find every subject whose horizon has closed, grade
 * it, append the answer, print what was written, exit.
 *
 * `pnpm db:label`. It is the other half of `pnpm db:decide`, and the half that does not
 * exist anywhere else: the system has been logging decisions across six stages and has
 * never once found out whether any of them was right. A decision log with no outcome
 * table beside it is not a system waiting to be switched on; it is training data that
 * never existed and cannot be bought later, because the answer arrives days after the
 * features have moved.
 *
 * ── WHY A ONE-SHOT AND NOT A LOOP ────────────────────────────────────────────────────
 * There is no cursor to lose. The work queue is DERIVED — every run recomputes it from
 * `internal.decisions` — so a labeller that did not run for a week finds everything that
 * became due while it was down, in one pass, with nothing to catch up on and nothing to
 * skip. That is a stronger property than a cursor and it is the reason this program can
 * simply exit. The same argument `services/project/src/main.ts` makes for the projector.
 *
 * ── ★ PENDING IS A STATE, AND IT DELIBERATELY WRITES NO ROW ───────────────────────────
 * `PgLabelRepo` offers `open()`, `due()`, `resolve()` and `censor()`: open a `pending`
 * row at decision time, then settle it later with an UPDATE. This service uses none of
 * them, and the choice is worth stating because it contradicts a design the repository
 * spells out elsewhere.
 *
 *   THE REASON IS THAT SETTLING BY UPDATE IS AN EDIT, and this table's central rule is
 *   that a settled outcome is never edited — a correction is a new row. A pipeline that
 *   opens a row and later mutates it has already conceded the principle for the most
 *   common transition in the system, and once `pending → resolved` is an update,
 *   `censored → resolved` is one keystroke away. Withholding the row until there is
 *   something true to say makes every row in the table a settled fact, which means every
 *   row is safe to read without asking when it was written.
 *
 *   WHAT THAT COSTS, HONESTLY: `first_signal_at`'s comment says it is recorded "even
 *   while the row is still pending", and no pending row means no place to record it as
 *   it happens. It is written at settlement instead, from `public.market_reading` —
 *   which is append-only, so the instant the first evidence arrived is still on disk and
 *   still recoverable, this month and in five years. The column that genuinely cannot be
 *   reconstructed is the decision's frozen feature vector, and that one is already being
 *   written by the runner. Nothing here is being deferred that decays.
 *
 *   AND WHAT IT BUYS BESIDES THE PRINCIPLE: a `pending` row is a row with a null value,
 *   and a null value one careless `coalesce` away from being a zero. The population that
 *   must never be coerced to negative is, in this design, not in the table to be coerced.
 *
 * ── ★ IDEMPOTENCE, AND WHY IT IS STRUCTURAL RATHER THAN GUARDED ───────────────────────
 * Run this twice and the second run writes nothing. Three mechanisms, in order of who
 * catches what:
 *
 *   1. A RESOLVED ROW IS TERMINAL. The window closed and we watched it; there is no
 *      further evidence that could change the answer, so a subject already resolved is
 *      skipped before anything is measured.
 *   2. AN UNCHANGED RECOMPUTATION IS NOT A CORRECTION. A censored or unresolvable
 *      subject IS re-measured every run — that is how a backfill gets noticed — but a
 *      result identical to the row already on disk writes nothing. Without this, every
 *      nightly run would append a new revision saying the same thing, and the revision
 *      number would count runs instead of counting corrections.
 *   3. `PgLabelRepo.record()` INSERTS WITH `on conflict do nothing`. Two labellers racing
 *      on the same window produce one row, and the loser is told it lost rather than
 *      overwriting. No advisory lock is taken: a lock would make concurrency an error,
 *      and this is a job where concurrency is simply a no-op.
 *
 * ── ★ A CORRECTION IS A NEW ROW, AND HOW A READER FINDS THE RIGHT ONE ─────────────────
 * When a censored subject becomes measurable — the coverage gap was backfilled, the
 * market series arrived late — the new answer is appended at the next revision, spelled
 * in `label_version` by `contracts/src/label.ts` (`v1`, then `v1.r2`, `v1.r3`). The old
 * row stays: "we could not tell in March and could in April" is a fact about the
 * pipeline, and a rising censoring rate is the earliest sign it is rotting.
 *
 * Readers take the LATEST REVISION, via `latestRevisionOf`. Two notes for whoever wires
 * a consumer:
 *   · A consumer filtering `status = 'resolved'` is already safe by construction, because
 *     a resolved row is terminal — at most one revision per key can ever hold that
 *     status. `internal.train_admit_v1` is in this group.
 *   · Every other consumer is not, and must not simply take any matching row.
 *
 * ── WHAT BREAKS IF THIS IS CHANGED CARELESSLY ────────────────────────────────────────
 * The order of the report's columns is cosmetic; the order of the checks in `outcome.ts`
 * is not, and neither is the rule that coverage is consulted before a negative is
 * asserted. If this file ever grows a path that writes a row for a subject whose window
 * is still open, delete the path — there is no version of that which is correct.
 */

import { DEFAULT_POLICY, LABEL_PEAK_MULTIPLE, labelVersion, latestRevisionOf, nextRevision } from '@insidor/contracts';
import type { ChainId, Label } from '@insidor/contracts';
import { DB_ROLE, PgAssetRepo, PgLabelRepo, asDb, createPool } from '@insidor/store';

import {
  assetFacts,
  attributions,
  dueSubjects,
  examinedStories,
  existingItems,
  itemStories,
  readings,
  storyFacts,
} from './db.ts';
import type { ReadingRow, SubjectRow } from './db.ts';
import { classify, labelWindow, populationOf, sameOutcome, sourceOf } from './outcome.ts';
import type { CoinEvidence, LabelOutcome, PriceObservation } from './outcome.ts';

/**
 * The subject kinds this service will grade, and the one it refuses.
 *
 * `pair` is absent on purpose: a pair subject asks whether two things are the same story,
 * and its outcome is a match being right rather than a coin peaking. There is a real
 * label to be written about a pair one day; it is not this one, and writing this one
 * against it would put a number next to a question nobody asked.
 */
const GRADED_KINDS = ['item', 'story', 'candidate'] as const;

/**
 * How many subjects one run will consider.
 *
 * ★ NOT IN `Policy`, AND THE DISTINCTION IS DELIBERATE. Everything in `Policy.labels`
 * changes what a label MEANS; this changes only how much work one process does before it
 * exits, and a row graded in tonight's batch is identical to the same row graded in
 * tomorrow's. Putting an operational cap in the object whose fields are pinned to a
 * definition string would make the definition move for a reason that has nothing to do
 * with the measurement.
 */
const DEFAULT_LIMIT = 5_000;

interface Tally {
  resolved: number;
  resolvedPositive: number;
  censored: number;
  unresolvable: number;
  pending: number;
  /** Already resolved on a previous run. Terminal, so not re-measured. */
  terminal: number;
  /** Re-measured and identical to what is already on disk. No row written. */
  unchanged: number;
  /** A new revision appended over a censored or unresolvable row. */
  superseded: number;
  /** A row another process wrote first. Correct, and not counted as ours. */
  raced: number;
}

function connectionUrl(env: Readonly<Record<string, string | undefined>>): string {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set; refusing to start. The labeller needs the credential that ' +
        'may both read internal.decisions and write internal.labels — the app role has no ' +
        'USAGE on that schema at all, and starting under it would fail partway through a ' +
        'batch having already written rows.',
    );
  }
  return url;
}

/* ── the sweep ────────────────────────────────────────────────────────── */

interface Prepared {
  readonly subject: SubjectRow;
  readonly coinKeys: readonly string[];
  readonly ungradeableReason: string | null;
  /**
   * Whether the resolve stage ever looked for a coin on this subject's behalf. See
   * `ClassifyInput.attributionAsked`: it is the difference between "nothing came out of
   * this narrative" and "nothing ever asked", which are the same empty list.
   */
  readonly attributionAsked: boolean;
}

/**
 * Which coins each subject's outcome could be about, and which subjects can never be
 * graded at all.
 *
 * The traversal differs per kind and each one is a different claim:
 *   · `candidate` names its coin in its own id. There is nothing to look up.
 *   · `story` takes every coin a resolve decision matched to it.
 *   · `item` takes every coin matched to any story the item belongs to. The outcome of a
 *     post is the outcome of the narrative it was part of; that is exactly the quantity
 *     the admission decision is a bet on.
 */
async function prepare(
  db: ReturnType<typeof asDb>,
  subjects: readonly SubjectRow[],
): Promise<readonly Prepared[]> {
  const storyIds = subjects.filter((s) => s.subjectKind === 'story').map((s) => s.subjectId);
  const itemIds = subjects.filter((s) => s.subjectKind === 'item').map((s) => s.subjectId);

  const [matched, examined, stories, items, memberships] = await Promise.all([
    attributions(db),
    examinedStories(db),
    storyFacts(db, storyIds),
    existingItems(db, itemIds),
    itemStories(db, itemIds),
  ]);

  const coinsByStory = new Map<string, string[]>();
  for (const attribution of matched) {
    const existing = coinsByStory.get(attribution.storyId);
    if (existing) existing.push(attribution.assetKey);
    else coinsByStory.set(attribution.storyId, [attribution.assetKey]);
  }

  const merged = new Map<string, string | null>();
  for (const story of stories) merged.set(story.storyId, story.mergedInto);

  /* An ungradeable subject is never classified, so the flag it carries is never read; it
     is written false rather than left optional so that every construction below states
     the same three things and none of them can be forgotten. */
  const ungradeable = (subject: SubjectRow, reason: string): Prepared => ({
    subject,
    coinKeys: [],
    ungradeableReason: reason,
    attributionAsked: false,
  });

  const out: Prepared[] = [];
  for (const subject of subjects) {
    if (subject.subjectKind === 'story') {
      if (!merged.has(subject.subjectId)) {
        out.push(ungradeable(subject, 'story_no_longer_exists'));
        continue;
      }
      const mergedInto = merged.get(subject.subjectId) ?? null;
      if (mergedInto !== null) {
        /* Absorbed into another story. Whatever came out of the narrative came out under
           the surviving id, so grading both would count one outcome twice. */
        out.push(ungradeable(subject, `merged_into:${mergedInto}`));
        continue;
      }
      out.push({
        subject,
        coinKeys: coinsByStory.get(subject.subjectId) ?? [],
        ungradeableReason: null,
        attributionAsked: examined.has(subject.subjectId),
      });
      continue;
    }

    if (subject.subjectKind === 'item') {
      if (!items.has(subject.subjectId)) {
        out.push(ungradeable(subject, 'item_no_longer_exists'));
        continue;
      }
      const keys = new Set<string>();
      const stories = memberships.get(subject.subjectId) ?? [];
      for (const storyId of stories) {
        for (const key of coinsByStory.get(storyId) ?? []) keys.add(key);
      }
      out.push({
        subject,
        coinKeys: [...keys],
        ungradeableReason: null,
        /* ★ EVERY story, not any. The item's outcome is the outcome of the narratives it
           belongs to, so a negative on it claims none of them produced a coin — and one
           unexamined story is enough to make that claim unassertable. An item in NO story
           is `false` by the same reading, and correctly so: nothing has yet looked for a
           coin on its behalf, because nothing has yet decided which narrative it is in. */
        attributionAsked: stories.length > 0 && stories.every((id) => examined.has(id)),
      });
      continue;
    }

    const cut = subject.subjectId.indexOf('|');
    if (cut <= 0 || cut === subject.subjectId.length - 1) {
      out.push(ungradeable(subject, 'unparseable_candidate_id'));
      continue;
    }
    out.push({
      subject,
      coinKeys: [subject.subjectId.slice(cut + 1)],
      ungradeableReason: null,
      /* A candidate subject IS a resolve decision, so by existing it proves the question
         was asked. It also always carries a coin, so the flag is never reached. */
      attributionAsked: true,
    });
  }
  return out;
}

/* ── the run ──────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg === undefined ? DEFAULT_LIMIT : Number(limitArg.slice('--limit='.length));
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`--limit must be a positive integer`);

  const p = DEFAULT_POLICY.labels;
  const nowMs = Date.now();
  const population = populationOf(p, GRADED_KINDS);
  const source = sourceOf(p, DEFAULT_POLICY.version);

  const pool = createPool(DB_ROLE.internal, {
    applicationName: 'insidor-label',
    env: { DATABASE_URL_INTERNAL: connectionUrl(process.env) },
  });

  const tally: Tally = {
    resolved: 0,
    resolvedPositive: 0,
    censored: 0,
    unresolvable: 0,
    pending: 0,
    terminal: 0,
    unchanged: 0,
    superseded: 0,
    raced: 0,
  };
  const censorReasons = new Map<string, number>();

  try {
    const db = asDb(pool);
    const assets = new PgAssetRepo(db);
    const labels = new PgLabelRepo(db);

    const subjects = await dueSubjects(db, GRADED_KINDS, limit);
    const prepared = await prepare(db, subjects);

    /* Chains we have ever observed an asset on. This is the coverage question for a
       subject with NO coin: the claim "nothing was minted from this narrative" is only
       assertable if the asset stream was watched throughout, and there is no coin to tell
       us which chain to ask about. An empty list means we have no record of watching
       anything at all, which `hasCoverageGap` would itself report as a gap. */
    const watchedChains = await assets.chains();

    const keys = new Set<string>();
    for (const row of prepared) for (const key of row.coinKeys) keys.add(key);
    const facts = await assetFacts(db, [...keys]);
    const factByKey = new Map(facts.map((f) => [f.assetKey, f]));

    /* Windows first, so the reads below are bounded by the batch's real span rather than
       by all of history. A subject whose window has no clock has no span to contribute. */
    const windows = prepared.map((row) => {
      let coinOriginMs: number | null = null;
      for (const key of row.coinKeys) {
        const origin = factByKey.get(key)?.originMs ?? null;
        if (origin !== null && (coinOriginMs === null || origin < coinOriginMs)) coinOriginMs = origin;
      }
      return {
        row,
        window: labelWindow(
          {
            subjectOriginMs: row.subject.subjectOriginMs,
            coinOriginMs,
            ungradeableReason: row.ungradeableReason,
          },
          p,
        ),
      };
    });

    let spanFrom = Number.POSITIVE_INFINITY;
    let spanTo = Number.NEGATIVE_INFINITY;
    for (const { window } of windows) {
      if (window.kind !== 'window') continue;
      spanFrom = Math.min(spanFrom, window.originMs);
      spanTo = Math.max(spanTo, window.resolvesAtMs);
    }

    const observations = new Map<string, PriceObservation[]>();
    if (Number.isFinite(spanFrom) && Number.isFinite(spanTo)) {
      for (const reading of await readings(db, [...keys], spanFrom, spanTo)) {
        push(observations, reading);
      }
    }

    /* Everything already on disk for these subjects, in three round trips rather than one
       per subject. Unfiltered by status and by version on purpose: the censored and
       unresolvable rows are exactly the ones a later run may supersede. */
    const existing = new Map<string, Label[]>();
    for (const kind of GRADED_KINDS) {
      const ids = subjects.filter((s) => s.subjectKind === kind).map((s) => s.subjectId);
      for (const label of await labels.bySubjectKeys(kind, ids, LABEL_PEAK_MULTIPLE)) {
        const slot = existing.get(`${label.subjectKind} ${label.subjectId}`);
        if (slot) slot.push(label);
        else existing.set(`${label.subjectKind} ${label.subjectId}`, [label]);
      }
    }

    for (const { row, window } of windows) {
      const held = existing.get(`${row.subject.subjectKind} ${row.subject.subjectId}`) ?? [];
      const latest = latestRevisionOf(held, p.definition);

      /* Terminal before anything is measured. A resolved window cannot reopen, so
         re-measuring it would spend a coverage query to reach the same answer. */
      if (latest !== null && latest.status === 'resolved') {
        tally.terminal += 1;
        continue;
      }

      let outcome: LabelOutcome;
      let originMs: number;
      let resolvesAtMs: number;

      if (window.kind === 'ungradeable') {
        outcome = { status: 'unresolvable', reason: window.reason };
        /* A row still needs a window to satisfy `resolves_at > origin_ts`. It is the
           window the subject WOULD have had, and it is honest: the subject's own clock
           when it has one, and the moment we looked when it does not — an unresolvable
           row's clock grades nothing, which is what unresolvable means. */
        originMs = row.subject.subjectOriginMs ?? nowMs;
        resolvesAtMs = originMs + p.windowDays * 86_400_000;
      } else {
        originMs = window.originMs;
        resolvesAtMs = window.resolvesAtMs;

        /* ★ AN OPEN WINDOW COSTS NOTHING, AND THE SHORT-CIRCUIT IS NOT ONLY THRIFT. The
           coverage of a window that has not finished is not a fact yet — the part that
           has not happened cannot have been watched or missed — so asking about it would
           be measuring an interval that does not exist. On a young pipeline this is also
           almost every subject: two coverage queries each for thousands of open windows,
           every night, to reach an answer `classify` reaches from the clock alone. */
        if (nowMs < resolvesAtMs) {
          tally.pending += 1;
          continue;
        }

        const chains =
          row.coinKeys.length === 0
            ? watchedChains
            : [...new Set(row.coinKeys.map((k) => factByKey.get(k)?.chain).filter(isChain))];

        /* ★ THE WEAKEST CHAIN BOUNDS THE CLAIM. A subject whose coins live on two chains
           was only watched throughout if BOTH were, so the declared gaps are OR-ed and
           the covered span is the minimum. Taking the maximum would let a well-covered
           chain vouch for a dark one. */
        let gapDeclared = chains.length === 0;
        let coveredMs = chains.length === 0 ? 0 : Number.POSITIVE_INFINITY;
        for (const chain of chains) {
          if (await assets.hasCoverageGap(chain, originMs, resolvesAtMs)) gapDeclared = true;
          coveredMs = Math.min(coveredMs, await assets.coveredMs(chain, originMs, resolvesAtMs));
        }

        outcome = classify(
          {
            window: { originMs, resolvesAtMs },
            coverage: { gapDeclared, coveredMs: Number.isFinite(coveredMs) ? coveredMs : 0 },
            attributionAsked: row.attributionAsked,
            coins: row.coinKeys.map((key) => coinEvidence(key, factByKey.get(key)?.originMs ?? null, observations, originMs, resolvesAtMs)),
            nowMs,
          },
          p,
        );
      }

      if (outcome.status === 'pending') {
        tally.pending += 1;
        continue;
      }

      if (outcome.status === 'censored') bump(censorReasons, outcome.reason);

      /* An identical recomputation is not a correction. Comparing the settled shape and
         not the whole row: `computed_at` moves every run by construction, and a revision
         that only says "we looked again" is a revision that counts runs. */
      if (latest !== null && sameOutcome(latest, outcome)) {
        tally.unchanged += 1;
        continue;
      }

      const revision = latest === null ? 1 : nextRevision(latest.labelVersion);
      const label: Label = {
        subjectKind: row.subject.subjectKind,
        subjectId: row.subject.subjectId,
        labelName: LABEL_PEAK_MULTIPLE,
        labelVersion: labelVersion(p.definition, revision),
        windowDays: p.windowDays,
        originMs,
        resolvesAtMs,
        status: outcome.status,
        value: outcome.status === 'unresolvable' ? null : outcome.value,
        y: outcome.status === 'resolved' ? outcome.y : null,
        /* ★ AN UNRESOLVABLE ROW PUTS ITS REASON IN `censor_reason` TOO, and the column's
           name is the only thing wrong with that. The schema requires a reason on a
           censored row and merely permits one elsewhere, and there is no other column
           for it — so the alternative is a row that says "this can never be graded" and
           cannot say why, which is the shape of absence this whole system refuses. A
           reason under a slightly wrong column name is recoverable; a lost one is not. */
        censorReason:
          outcome.status === 'censored' || outcome.status === 'unresolvable' ? outcome.reason : null,
        population,
        source,
        firstSignalMs: outcome.status === 'unresolvable' ? null : outcome.firstSignalMs,
        computedAtMs: nowMs,
      };

      if (outcome.status === 'resolved') {
        tally.resolved += 1;
        if (outcome.y) tally.resolvedPositive += 1;
      } else if (outcome.status === 'censored') tally.censored += 1;
      else tally.unresolvable += 1;

      if (revision > 1) tally.superseded += 1;

      if (dryRun) continue;
      if (!(await labels.record(label))) tally.raced += 1;
    }

    report(tally, censorReasons, subjects.length, limit, dryRun, p.definition);
  } finally {
    await pool.end();
  }
}

/** A coin whose asset row we could not read contributes no chain, rather than a guessed one. */
const isChain = (v: ChainId | undefined): v is ChainId => v !== undefined;

function push(into: Map<string, PriceObservation[]>, reading: ReadingRow): void {
  const observation: PriceObservation = {
    atMs: reading.atMs,
    priceUsd: reading.priceUsd,
    absent: reading.absent,
  };
  const slot = into.get(reading.assetKey);
  if (slot) slot.push(observation);
  else into.set(reading.assetKey, [observation]);
}

function bump(counts: Map<string, number>, key: string): void {
  /* The reason strings carry a measured suffix — a covered fraction, a support count —
     which is what makes an individual row diagnosable. Grouped for the summary on the
     prefix alone, because a histogram with one bucket per fraction is not a histogram. */
  const head = key.split(':')[0] ?? key;
  counts.set(head, (counts.get(head) ?? 0) + 1);
}

function coinEvidence(
  assetKey: string,
  originMs: number | null,
  observations: ReadonlyMap<string, readonly PriceObservation[]>,
  fromMs: number,
  toMs: number,
): CoinEvidence {
  const all = observations.get(assetKey) ?? [];
  return {
    assetKey,
    originMs,
    observations: all.filter((o) => o.atMs >= fromMs && o.atMs < toMs),
  };
}

/**
 * What was written, on stderr, with every figure printed every run including the zeroes.
 *
 * ★ ZERO RESOLVED IS A LEGITIMATE ANSWER AND THE REPORT SAYS SO RATHER THAN LOOKING
 * BROKEN. With a thirty-day horizon, every subject decided about in the last month is
 * legitimately open, and a labeller that printed nothing in that case would be
 * indistinguishable from one that had crashed. `pending` is therefore a counted state
 * with a line of its own — it is the honest description of a young pipeline, and it is
 * the number that must never become a row.
 */
function report(
  tally: Tally,
  censorReasons: ReadonlyMap<string, number>,
  considered: number,
  limit: number,
  dryRun: boolean,
  definition: string,
): void {
  /* ★ A RUN THAT HIT THE CAP LOOKS EXACTLY LIKE A RUN THAT FINISHED THE QUEUE, and
     the numbers below are the same shape either way. The batch cap is not a policy
     number and truncating is harmless — the queue is derived, so whatever was left
     is found again next run, oldest first — but a reader watching the resolved count
     stop climbing deserves to know which of the two they are looking at. The cap is
     the one condition under which every figure here is a floor. */
  const cappedNote =
    considered >= limit
      ? `   ← AT THE BATCH CAP (--limit=${limit}). More subjects are waiting; every figure below is a floor.`
      : '';

  const lines: string[] = [
    '',
    `  outcome labeller  ·  definition ${definition}${dryRun ? '  ·  DRY RUN, nothing written' : ''}`,
    `  ${'─'.repeat(72)}`,
    `  subjects considered      ${considered}${cappedNote}`,
    '',
    `  resolved                 ${tally.resolved}   (of which positive: ${tally.resolvedPositive})`,
    `  censored                 ${tally.censored}   ← measured, but a lower bound: we were not watching throughout`,
    `  unresolvable             ${tally.unresolvable}   ← can never be graded. Not a bad outcome.`,
    `  pending                  ${tally.pending}   ← the horizon has not closed. NO ROW WRITTEN, and never a zero.`,
    '',
    `  already terminal         ${tally.terminal}   ← resolved on an earlier run; a resolved row is never re-graded`,
    `  unchanged                ${tally.unchanged}   ← re-measured, identical to disk, so no revision appended`,
    `  superseded               ${tally.superseded}   ← a NEW row at the next revision. The old one stays.`,
    `  lost a race              ${tally.raced}   ← another process wrote the same row first. Correct, not an error.`,
  ];
  if (censorReasons.size > 0) {
    lines.push('', '  why censored');
    for (const [reason, count] of [...censorReasons].sort((a, b) => b[1] - a[1])) {
      lines.push(`    ${reason.padEnd(24)} ${count}`);
    }
  }
  lines.push('');
  process.stderr.write(`${lines.join('\n')}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      `the labeller failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
