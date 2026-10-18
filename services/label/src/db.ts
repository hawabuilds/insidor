/**
 * EVERY STATEMENT OF SQL IN THIS SERVICE, IN ONE FILE.
 *
 * The house rule is that store/ is the only package where SQL lives, and this file bends
 * it knowingly rather than quietly — the same bend, for the same reason and with the same
 * containment, that `services/project/src/db.ts` makes and names. Four of the reads below
 * have no repository behind them and would each cost store/ a method invented for one
 * caller: the subject sweep over the decision log (live and archived, see below) is an aggregate no `DecisionRepo`
 * shape covers, the coin attribution is a parse of a subject id rather than a row read,
 * and `public.story_member` and `public.market_reading` have no repository at all.
 *
 * The two reads that DO have a repository — coverage, and labels — are NOT here. They go
 * through `PgAssetRepo` and `PgLabelRepo`, because getting either of them subtly wrong is
 * the failure this whole service exists to prevent, and a second spelling of
 * `hasCoverageGap` living in a service is exactly how the two spellings drift.
 *
 * ★ THE ROLE. This runs as the INTERNAL credential, which is the only role permitted to
 * write a judgement — `store/src/client.ts` names it "the runner and the labeller". It is
 * not a convenience: the app role has no USAGE on `internal` at all, so a labeller running
 * under the browser's connection would fail halfway through a batch rather than at boot,
 * having already written some rows.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY. `readings()` is bounded by the batch's
 * global span rather than by each subject's own window, and the caller slices per subject
 * in memory. That is correct and it is also the one thing here that does not scale
 * forever: at a thirty-day window and thousands of subjects per night the span is wide and
 * the row count is the product. The boundary to watch is the batch cap in `main.ts`; the
 * fix, when it is needed, is a lateral join per subject, not a wider fetch.
 */

import { chainId } from '@insidor/contracts';
import type { ChainId, Millis } from '@insidor/contracts';
import type { Db } from '@insidor/store';

/* ── the log, live and archived ───────────────────────────────────────── */

/**
 * ★ EVERY READ OF THE DECISION LOG BELOW IS THE UNION OF TWO PLACES (0103). internal.decisions
 * keeps only its newest day or two; each older day was copied into internal.decision_label_basis
 * (one row per day and subject: earliest origin, count, resolve verdicts) before it was archived
 * and dropped (tools/archive-decisions.ts, store label-basis.ts). A day is read from the basis
 * when internal.decision_label_basis_day lists it, and from the live partition otherwise — never
 * from both, so a day copied but not yet dropped is not counted twice, and a day half-copied is
 * still read whole from the partition. The answers are the ones the log alone used to give
 * (e2e/src/label-basis.test.ts).
 */
const LIVE_DAY_NOT_IN_BASIS =
  `(decided_at at time zone 'UTC')::date not in (select day from internal.decision_label_basis_day)`;

/**
 * Every resolve-stage candidate decision with one of the verdicts in `param` (a text[] parameter),
 * live and archived. `attributions()` reads it as the coins matched to stories, and the queue in
 * `dueSubjects()` reads it for the mint that anchors a story's or an item's window: one spelling,
 * so the two can never disagree about which coin came out of which story.
 */
const MATCHED_CANDIDATES = (param: string): string =>
  `select subject_id, verdict
     from internal.decisions
    where stage = 'resolve'
      and subject_kind = 'candidate'
      and verdict = any(${param}::text[])
      and ${LIVE_DAY_NOT_IN_BASIS}
   union
   select b.subject_id, v.verdict
     from internal.decision_label_basis b
     join internal.decision_label_basis_day using (day)
    cross join lateral unnest(b.resolve_verdicts) as v(verdict)
    where b.subject_kind = 'candidate'
      and b.resolve_verdicts is not null
      and v.verdict = any(${param}::text[])`;

/* ── the subjects a decision was made about ───────────────────────────── */

export interface SubjectRow {
  readonly subjectKind: 'item' | 'story' | 'candidate';
  readonly subjectId: string;
  /** The earliest origin the decision log ever recorded for this subject. Null when none did. */
  readonly subjectOriginMs: Millis | null;
  readonly decisions: number;
}

interface RawSubject {
  subject_kind: SubjectRow['subjectKind'];
  subject_id: string;
  origin_ms: string | number | null;
  decisions: string | number;
}

/** What the queue needs to know about the label it is filling. */
export interface QueueRule {
  readonly labelName: string;
  /** `Policy.labels.definition`: rows of an older definition do not make a subject final. */
  readonly definition: string;
  readonly windowDays: number;
  readonly nowMs: Millis;
}

/**
 * The subjects worth grading this run: every subject anything was ever decided about, with the
 * earliest origin recorded for it, less the ones already final and the ones whose window is
 * still open.
 *
 * ★ `min(subject_origin)` AND NOT THE LATEST ONE. A subject is decided about many times —
 * 773 of the live rows are one stage re-reading twenty-two items — and the recorded origin
 * can move between them when a story acquires an earlier member. The origin is "when the
 * thing itself began", so the earliest claim about the beginning is the beginning; taking
 * the latest would shorten the window every time the subject grew, and shorten it by an
 * amount that depends on when the labeller happened to run.
 *
 * ★ AND IT IS READ FROM THE DECISION LOG RATHER THAN FROM `public.story` / `public.item`.
 * Those tables hold today's origin, which a later correction may have moved. The decision
 * log holds what was true when we decided, which is what the decision has to be graded
 * against — the same discipline that makes the stored feature vector the only admissible
 * one, applied to the clock.
 *
 * ★ WHY THE QUEUE FILTERS, AND WHAT IT FILTERS (the owner, 2026-10-18: the labels must really
 * finish). The run takes at most `limit` subjects. Until now it took the oldest `limit` of ALL
 * subjects, finished or not, open or not, so once the log held more than that (52,000 on one
 * day of it) the same oldest few thousand were picked every run and nothing younger was ever
 * graded. Now a subject is skipped when:
 *   · its latest revision under this definition is FINAL — `resolved` (main.ts already treats
 *     it as terminal), or `unresolvable` for a reason that cannot change (the story merged or
 *     gone, the item gone, the id unparseable). `unresolvable: no_origin_recorded` is not final:
 *     a later decision can record an origin. `censored` is never final: a backfilled coverage
 *     gap is how it becomes measurable;
 *   · its window is still open, computed exactly as `labelWindow` does: from the earliest known
 *     mint among its coins (the candidate's own; a story's matched coins; an item's stories'
 *     matched coins), else from its own origin. A subject that main.ts would call ungradeable is
 *     always due, since its row can be written now.
 * Then the never-labelled go first, oldest first, and the censored re-measurements after them,
 * oldest first: censored subjects never leave the queue, and ahead of the rest they would fill
 * the cap again within a few weeks. A censored subject past the cap is re-measured on a later
 * run once the backlog clears; nothing is lost by the wait.
 *
 * What breaks if changed carelessly: the window here must stay the one `labelWindow` computes.
 * A later one here holds a subject back past its due date; an earlier one only costs a slot
 * that main.ts counts as pending.
 *
 * `pair` is deliberately absent from the kinds this service will accept: a pair subject is
 * a judgement about whether two things are the same story, and its outcome is a match
 * being right, not a coin peaking. Grading it under `peak_multiple` would put a number
 * next to a question nobody asked.
 */
export async function dueSubjects(
  db: Db,
  kinds: readonly SubjectRow['subjectKind'][],
  limit: number,
  rule: QueueRule,
): Promise<readonly SubjectRow[]> {
  const rows = await db.query<RawSubject>(
    `with per_day as (
       select subject_kind, subject_id, min(subject_origin) as origin, count(*)::bigint as n
         from internal.decisions
        where subject_kind = any($1::text[])
          and ${LIVE_DAY_NOT_IN_BASIS}
        group by subject_kind, subject_id
       union all
       select b.subject_kind, b.subject_id, b.origin_min, b.decisions::bigint
         from internal.decision_label_basis b
         join internal.decision_label_basis_day using (day)
        where b.subject_kind = any($1::text[])
     ),
     subjects as (
       select subject_kind, subject_id, min(origin) as origin, sum(n)::bigint as n
         from per_day
        group by subject_kind, subject_id
     ),
     matched as (
       select distinct split_part(subject_id, '|', 1) as story_id,
                       substr(subject_id, strpos(subject_id, '|') + 1) as asset_key
         from (${MATCHED_CANDIDATES('$6')}) m
        where strpos(subject_id, '|') > 1 and strpos(subject_id, '|') < length(subject_id)
     ),
     story_coin as (
       select m.story_id, min(a.minted_at) as minted
         from matched m
         join public.asset a on a.asset_key = m.asset_key
        where a.minted_at is not null
        group by m.story_id
     ),
     item_coin as (
       select sm.item_id, min(sc.minted) as minted
         from public.story_member sm
         join story_coin sc on sc.story_id = sm.story_id
        group by sm.item_id
     ),
     latest as (
       select distinct on (subject_kind, subject_id) subject_kind, subject_id, status, censor_reason
         from internal.labels
        where label_name = $3
          and (label_version = $4 or (left(label_version, length($4) + 2) = $4 || '.r'
                                      and substr(label_version, length($4) + 3) ~ '^[0-9]+$'))
        order by subject_kind, subject_id,
                 case when label_version = $4 then 1 else substr(label_version, length($4) + 3)::int end desc
     ),
     judged as (
       select s.subject_kind, s.subject_id, s.origin, s.n, l.status, l.censor_reason,
              coalesce(
                case s.subject_kind
                  when 'candidate' then ca.minted_at
                  when 'story' then sc.minted
                  else ic.minted
                end,
                s.origin) as anchor,
              case s.subject_kind
                when 'story' then st.story_id is null or st.merged_into is not null
                when 'item' then it.item_id is null
                else strpos(s.subject_id, '|') <= 1 or strpos(s.subject_id, '|') = length(s.subject_id)
              end as ungradeable
         from subjects s
         left join latest l using (subject_kind, subject_id)
         left join public.asset ca
           on s.subject_kind = 'candidate' and ca.asset_key = substr(s.subject_id, strpos(s.subject_id, '|') + 1)
         left join story_coin sc on s.subject_kind = 'story' and sc.story_id = s.subject_id
         left join item_coin ic on s.subject_kind = 'item' and ic.item_id = s.subject_id
         left join public.story st on s.subject_kind = 'story' and st.story_id = s.subject_id
         left join public.item it on s.subject_kind = 'item' and it.item_id = s.subject_id
     )
     select subject_kind,
            subject_id,
            (extract(epoch from origin) * 1000)::bigint as origin_ms,
            n                                           as decisions
       from judged
      where coalesce(status, '') <> 'resolved'
        and not (coalesce(status, '') = 'unresolvable' and coalesce(censor_reason, '') !~ '^no_origin_recorded')
        and (ungradeable
             or anchor is null
             or anchor + make_interval(days => $5::int) <= to_timestamp($7::double precision / 1000))
      order by (status is not null), origin asc nulls last, subject_id asc
      limit $2`,
    [kinds, limit, rule.labelName, rule.definition, rule.windowDays, MATCHED_VERDICTS, rule.nowMs],
  );
  return rows.map((row) => ({
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    subjectOriginMs: row.origin_ms === null ? null : Number(row.origin_ms),
    decisions: Number(row.decisions),
  }));
}

/* ── which coin, if any, came out of a story ──────────────────────────── */

/** The verdicts that count as "a coin was matched to this story". */
export const MATCHED_VERDICTS = ['pass', 'abstain'] as const;

export interface Attribution {
  readonly storyId: string;
  readonly assetKey: string;
  readonly verdict: string;
}

/**
 * ★ THE ONLY LINK BETWEEN A NARRATIVE AND A COIN, AND IT IS THE DECISION LOG.
 *
 * There is no story-to-asset table in `public`. The one place the system has ever
 * recorded that a coin came out of a story is a resolve-stage decision, whose subject is
 * the pair itself: `subject_kind = 'candidate'`, `subject_id = '<story>|<chain>:<address>'`.
 * That id is reproducible rather than allocated, which is what makes reading it back a
 * lookup rather than a guess.
 *
 * ★ AND WHY BOTH `pass` AND `abstain` COUNT. `pass` is "we are confident this is the
 * coin"; `abstain` is "we found it and could not separate it from the runner-up". Both
 * mean a coin was matched. Taking only `pass` would define the population as the coins we
 * were sure about, which is a survivorship filter on the outcome side — the same shape of
 * error as measuring peak multiples over graduated coins and reporting a rate about all
 * of them. `drop` is excluded because a dropped candidate was eliminated by a gate: it is
 * a coin we looked at and rejected, not a coin the story produced.
 */
export async function attributions(db: Db): Promise<readonly Attribution[]> {
  const rows = await db.query<{ subject_id: string; verdict: string }>(
    `select distinct subject_id, verdict from (${MATCHED_CANDIDATES('$1')}) m`,
    [MATCHED_VERDICTS],
  );
  const out: Attribution[] = [];
  for (const row of rows) {
    const cut = row.subject_id.indexOf('|');
    /* Neither half of a candidate id may contain the separator — `candidateId` throws
       rather than construct one that does — so the first occurrence is the only one and
       the split is unambiguous. A row that does not split is a subject id this service
       does not understand, and inventing a story for it would attribute a coin to the
       wrong narrative. */
    if (cut <= 0 || cut === row.subject_id.length - 1) continue;
    out.push({
      storyId: row.subject_id.slice(0, cut),
      assetKey: row.subject_id.slice(cut + 1),
      verdict: row.verdict,
    });
  }
  return out;
}

/**
 * ★ EVERY STORY ANYTHING EVER LOOKED FOR A COIN ON BEHALF OF.
 *
 * WHY THIS EXISTS BESIDE `attributions()`, WHICH READS THE SAME STAGE. That one asks
 * "which coin was matched" and takes only the verdicts that mean one was. This asks the
 * prior question — "did we ever ASK" — so it takes EVERY verdict, `drop` included, and
 * both subject kinds the stage can write.
 *
 * A `drop` is the important row. `core/src/resolve/stage.ts` logs the STORY as the
 * subject when it found no candidate worth naming, and the CANDIDATE when it did; so a
 * story-kind resolve row carrying `drop` is the system saying "I looked here and there
 * was nothing", which is exactly the observation that makes a negative outcome a claim
 * about the world rather than a claim about our uptime. `attributions()` correctly
 * discards it — a dropped candidate is not a coin — and that is why the two reads cannot
 * be one.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY: narrow it to `pass` and every subject the
 * resolver examined and rejected becomes censored, which destroys the negative class —
 * the majority class, and the one a model needs most. Widen it to any stage and a
 * subject the DETECT stage happened to see would vouch for a coin search that never
 * happened, which is the failure this read exists to prevent, wearing a green test.
 */
export async function examinedStories(db: Db): Promise<ReadonlySet<string>> {
  const rows = await db.query<{ subject_kind: string; subject_id: string }>(
    `select subject_kind, subject_id
       from internal.decisions
      where stage = 'resolve'
        and subject_kind = any($1::text[])
        and ${LIVE_DAY_NOT_IN_BASIS}
     union
     select b.subject_kind, b.subject_id
       from internal.decision_label_basis b
       join internal.decision_label_basis_day using (day)
      where b.subject_kind = any($1::text[])
        and b.resolve_verdicts is not null`,
    [['story', 'candidate']],
  );
  const out = new Set<string>();
  for (const row of rows) {
    if (row.subject_kind === 'story') {
      out.add(row.subject_id);
      continue;
    }
    /* A candidate names its story in its own id. An id that does not split is one this
       service does not understand, and crediting an unparseable row with having examined
       some story would vouch for a search we cannot point at. */
    const cut = row.subject_id.indexOf('|');
    if (cut > 0 && cut !== row.subject_id.length - 1) out.add(row.subject_id.slice(0, cut));
  }
  return out;
}

/* ── does the subject still exist ─────────────────────────────────────── */

export interface StoryFact {
  readonly storyId: string;
  /** Non-null when this story was absorbed into another one. */
  readonly mergedInto: string | null;
}

/**
 * The stories that still exist, and which of them were merged away.
 *
 * A merged story is the schema's own example of a subject that can never be graded: its
 * members were absorbed, so whatever came out of the narrative came out under the
 * surviving id. Grading both would count one outcome twice — once under a story that no
 * longer exists as a thing in its own right.
 */
export async function storyFacts(
  db: Db,
  storyIds: readonly string[],
): Promise<readonly StoryFact[]> {
  if (storyIds.length === 0) return [];
  const rows = await db.query<{ story_id: string; merged_into: string | null }>(
    `select story_id, merged_into from public.story where story_id = any($1::text[])`,
    [storyIds],
  );
  return rows.map((row) => ({ storyId: row.story_id, mergedInto: row.merged_into }));
}

/** The items that still exist. One that does not was deleted at source and cannot be graded. */
export async function existingItems(
  db: Db,
  itemIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await db.query<{ item_id: string }>(
    `select item_id from public.item where item_id = any($1::text[])`,
    [itemIds],
  );
  return new Set(rows.map((row) => row.item_id));
}

/**
 * Which stories each item belongs to.
 *
 * ★ THIS IS THE ONE TRAVERSAL THAT READS TODAY'S STATE RATHER THAN THE LOG, and the
 * reason is that there is no alternative: membership is not recorded on a decision row.
 * It is safe in a way a feature would not be — membership is not an input the decider
 * saw, it is part of the outcome's own attribution chain, so reading it now is reading
 * what actually happened rather than reconstructing what we knew. The rule it must not
 * break is the other one: nothing in this service re-derives a FEATURE.
 */
export async function itemStories(
  db: Db,
  itemIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.length === 0) return out;
  const rows = await db.query<{ item_id: string; story_id: string }>(
    `select item_id, story_id from public.story_member where item_id = any($1::text[])`,
    [itemIds],
  );
  for (const row of rows) {
    const existing = out.get(row.item_id);
    if (existing) existing.push(row.story_id);
    else out.set(row.item_id, [row.story_id]);
  }
  return out;
}

/* ── the coins themselves ─────────────────────────────────────────────── */

export interface AssetFact {
  readonly assetKey: string;
  readonly chain: ChainId;
  /** When the asset began. Null when nothing has ever established it. */
  readonly originMs: Millis | null;
}

/**
 * The assets a subject's outcome might be about.
 *
 * `minted_at` is nullable and its absence is honest — `unknown_iff_absent` on
 * `public.asset` makes a null there mean "no source has told us", never "at the epoch".
 * A coin with no established origin cannot anchor a window, so the caller falls back to
 * the subject's own clock rather than inventing one.
 */
export async function assetFacts(
  db: Db,
  assetKeys: readonly string[],
): Promise<readonly AssetFact[]> {
  if (assetKeys.length === 0) return [];
  const rows = await db.query<{
    asset_key: string;
    chain: string;
    origin_ms: string | number | null;
  }>(
    `select asset_key, chain, (extract(epoch from minted_at) * 1000)::bigint as origin_ms
       from public.asset
      where asset_key = any($1::text[])`,
    [assetKeys],
  );
  return rows.map((row) => ({
    assetKey: row.asset_key,
    chain: chainId(row.chain),
    originMs: row.origin_ms === null ? null : Number(row.origin_ms),
  }));
}

export interface ReadingRow {
  readonly assetKey: string;
  readonly atMs: Millis;
  readonly priceUsd: number | null;
  readonly absent: string | null;
}

/**
 * Every price reading of these assets over the batch's whole span, ascending.
 *
 * ★ THE ABSENCE COLUMN TRAVELS WITH THE NUMBER AND THAT IS THE POINT OF THIS READ. The
 * table's `price_xor_reason` constraint makes "the venue said there is no market" and
 * "nobody filled this in" impossible to confuse on disk; selecting the price without its
 * reason would reintroduce the confusion in memory, one layer up, where it decides
 * whether an outcome is a negative or a censored one.
 */
export async function readings(
  db: Db,
  assetKeys: readonly string[],
  fromMs: Millis,
  toMs: Millis,
): Promise<readonly ReadingRow[]> {
  if (assetKeys.length === 0) return [];
  const rows = await db.query<{
    asset_key: string;
    at_ms: string | number;
    price_usd: number | null;
    price_absent: string | null;
  }>(
    `select asset_key,
            (extract(epoch from taken_at) * 1000)::bigint as at_ms,
            price_usd,
            price_absent
       from public.market_reading
      where asset_key = any($1::text[])
        and taken_at >= to_timestamp($2::double precision / 1000)
        and taken_at <  to_timestamp($3::double precision / 1000)
      order by asset_key, taken_at asc`,
    [assetKeys, fromMs, toMs],
  );
  return rows.map((row) => ({
    assetKey: row.asset_key,
    atMs: Number(row.at_ms),
    priceUsd: row.price_usd,
    absent: row.price_absent,
  }));
}
