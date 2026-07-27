## 6. THE PIPELINE SERVICE

`apps/pipeline` is one Node process. It runs fifteen stages and holds two websocket-shaped
clocks. Eleven of the stages are the funnel — the verbs the product is described in — and
four are infrastructure. The funnel verbs are the vocabulary; the stage ids below are what
appears in `ops_stage_run.stage`, `ops_stage_expected.stage` and the Inngest function id,
and nothing else may name a stage.

| Verb | Stage id | Cadence | `rows_out` means | Funnel counter |
|---|---|---|---|---|
| arrive | `ingest-x` | 180 s | posts written | `ops_funnel.arrived` |
| arrive | `ingest-tiktok` | 600 s | posts written | `ops_funnel.arrived` |
| admit | *(inside ingest)* | — | posts past the ~15-like floor | `ops_funnel.admitted` |
| track | `snapshot` | 60 s | `post_snapshot` + `coin_snapshot` rows | `ops_funnel.tracked` |
| trigger | *(inside snapshot)* | — | posts raised to `tracking_tier ≥ 2` | `ops_funnel.triggered` |
| qualify | `score` | 120 s | posts scored | — |
| cluster | `cluster` | 45 s | stories touched | `ops_funnel.clustered` |
| promote | `promote` | 45 s, after cluster | `story.promoted_at` writes | `ops_funnel.promoted` |
| name | `name` | 60 s | `story.title` writes + `story_ticker` rows | — |
| resolve | `resolve-coins` | 60 s | `coin_match` rows | — |
| rank | `rank-commit` | **20 s** | `board_state` rows committed | — |
| deliver | `deliver` | 30 s | `notification` rows | — |
| — | `clocks-ct` | 120 s | `ct_mention` rows | — |
| — | `clocks-mint` | 5 s (drain) | `coin` upserts from the socket | — |
| — | `outcomes` | nightly | `story_outcome` rows | — |
| — | `watchdog` | 60 s | SLIs evaluated | — |

`0010` seeded `ops_stage_expected` with three names from the old build (`ingest`,
`snapshotter`, `trends`) and is missing seven. `0014` reconciles the roster; migrations are
immutable, so the fix is a forward `INSERT … ON CONFLICT DO UPDATE` plus a `DELETE` of the
three dead ids, not an edit to `0010`.

---

### 6.1 The execution model

**One long-lived container on Fly.io, with Inngest as the durable scheduler inside it.**
The container is the substrate; Inngest is the clock, the singleton and the retry ledger.
Not two models, not a lockfile — one process, one scheduler, one place a stage can start.

The requirement that eliminates two of the four candidates immediately: **the mint clock is
a subscription whose silence is the signal.** A PumpPortal websocket must stay open across
minutes, and a disconnect must open a `sensor_gap` row *before* reconnecting, because a gap
means lost mints and a lost mint means `story_clock.unmeasurable` rather than a fabricated
lead time. There is no way to hold that connection in a function that is billed per
invocation and killed at the response.

**Against Vercel Cron with resumable progress.** Vercel's hard ceiling is per-invocation
duration (60 s on the default runtime, higher on paid Fluid tiers — ⚠ verify the current
maximum for our plan before relying on any figure). "Resumable progress" means every stage
grows a cursor table, a partial-work protocol and a re-entry path, and the 402 bug repeats
in a new shape: an invocation that dies at the ceiling looks identical to one that finished
with nothing to do. Cron also gives no singleton — two overlapping schedules or one
retried invocation both write `coin_match` — no backpressure, no retry semantics, and no
first-class "ran and produced nothing". That last absence is exactly the two-day outage.

**Against a queue with workers** (SQS/BullMQ/pg-boss + a worker pool). A queue is the right
shape for fan-out over independent units. Ours is fifteen singleton cadences with hard
ordering (`cluster` → `promote` → `name` → `resolve-coins`) and per-stage spend caps. On a
queue you write the scheduler anyway — something has to enqueue on a cron — then the
singleton (a visibility-timeout race is not a lock), the DLQ, the retry policy and the
observability. That is Inngest, hand-rolled, with a Redis to operate. `pg-boss` on the
existing Postgres is the closest honest alternative and stays on the table if Inngest
becomes a cost or availability problem; §6.2 is written so the scheduler is swappable in
one file (`src/inngest/functions.ts`).

**Against a durable-execution framework** — Temporal, Restate. Temporal answers a different
problem: multi-day workflows with human-in-the-loop steps and complex compensation. Ours are
15-second stages against a database that is already the source of truth. A Temporal cluster
plus workers plus the determinism constraint on workflow code is a second distributed system
to operate. Inngest gives the two properties we need from that category — a durable `step`
boundary and a global concurrency key — from an HTTP handler mounted in the process we
already have.

**Against a bare long-running container** (`setInterval`, no scheduler). This is what the old
build ran locally, and it is why the PID lockfile existed and was never called. A bare loop
has no cross-host singleton, no retry with backoff and no run history that survives the
process. Two machines run in production for canary deploys; two `setInterval` loops
double-ingest, which is double spend on the largest cost line in the system.

```
docker-entrypoint.sh
  └─ node dist/preflight.js      # exits non-zero → health check never passes → Fly rolls back
  └─ node dist/main.js
       ├─ Inngest serve handler  (all 15 stages)
       ├─ GET /health/live       (process is up)
       ├─ GET /health/ready      (preflight passed AND a stage ran productively recently)
       └─ PumpPortal websocket   (in-process; not a stage)
```

Preflight, in order, each fatal:

1. `packages/env` parses. No defaults, no fallbacks — `process.env.X ?? 'something'` is the
   same shape as the token lookup that returned age 0.
2. `assertEnvironment()` — `ops_environment.name = APP_ENV`. A production connection string
   in a laptop `.env.local` crashes here.
3. `max(version) FROM insidor.schema_migrations >= REQUIRED_SCHEMA_VERSION`.
4. `select count(distinct model) from post_embedding` must be ≤ 1 (open item 17).
5. One unmetered ping per vendor, recorded in `ops_event` at `info`. A 401 here fails the
   boot rather than pausing a stage four hours later.

---

### 6.2 The stage contract

One interface. Everything a stage may declare about itself is declarative — cadence,
budget, timeout, lock — so the runner can enforce it without the stage's cooperation.

```ts
// apps/pipeline/src/lib/stage.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@insidor/contracts/generated/database.types';

export type StageName =
  | 'ingest-x' | 'ingest-tiktok' | 'snapshot' | 'score'
  | 'cluster' | 'promote' | 'name' | 'resolve-coins'
  | 'rank-commit' | 'deliver'
  | 'clocks-ct' | 'clocks-mint' | 'outcomes' | 'watchdog' | 'trending';

export type VendorSource = 'twitterapi' | 'apify' | 'anthropic' | 'gemini'
                         | 'jupiter' | 'helius' | 'rugcheck' | 'dexscreener';

export type StageResult = {
  /** Each stage sets this from its OWN output metric. `rows_out = 0, ok = true` is
   *  legal and meaningful — ran correctly, nothing to do — and it is precisely what
   *  the stall SLI counts. Never set it to "items considered". */
  rowsOut: number;
  rowsIn?: number;
  apiReads?: number;
  costUsd?: number;
  /** Written to ops_stage_run.detail. Cheap to add, and the only forensics that exist. */
  detail?: Record<string, unknown>;
};

export type StageCtx = {
  db: SupabaseClient<Database>;          // service role
  budget: BudgetHandle;                  // §6.4 — the ONLY route to a metered call
  log: Logger;                           // structured JSON, carries stage + runId
  /** Deadline-aware. Every stage checks it between units of work and returns what it
   *  has; the runner never has to kill anything mid-write. */
  deadline: AbortSignal;
  runId: number;
  now: Date;                             // injected — model code never calls Date.now()
};

export type StageDef = {
  name: StageName;
  /** Cron or interval. The single source; ops_stage_expected.interval_seconds is
   *  asserted equal to this at preflight, so the SLI and the schedule cannot drift. */
  schedule: { cron: string } | { everySeconds: number };
  /** Wall-clock ceiling. Enforced by AbortSignal, then by Inngest, then by Fly. */
  timeoutMs: number;
  /** Vendors this stage is permitted to spend against. budget.fetch() to any other
   *  source throws `vendor_contract` before the request leaves the process. */
  sources: readonly VendorSource[];
  /** Attempts, for retryable classes only. Terminal classes never retry. */
  retries: number;
  run: (ctx: StageCtx) => Promise<StageResult>;
};
```

Six guarantees follow from the runner rather than from discipline:

- **The row is opened before the work starts.** A stage killed mid-run leaves
  `ok = false, finished_at IS NULL`, which the watchdog reads as a crash, not as silence.
- **`rows_out` is always recorded** — on success, on failure, on timeout, on zero.
- **Idempotency is by natural key, on every write.** `post(platform, platform_post_id)`,
  `coin(mint)`, `coin_match(story_id, mint)`, `coin_snapshot(mint, captured_at)`,
  `ct_mention(handle, platform_post_id)`, `notification(dedupe_key)`. A retry after a
  partial failure converges. The one non-idempotent operation is PROMOTE, and
  `story.promoted_at` is frozen by trigger (`insidor.freeze_columns`), so a second attempt
  raises rather than moving the lead-time clock.
- **Checkpointing is a watermark, not a cursor into a batch.** A stage advances its
  watermark only over the range it *fully* processed. `clocks-ct` below is the reference
  implementation: `sensor_heartbeat.observed_through` moves to the oldest fully-scanned
  boundary, never to the newest row seen, because `story_clock` has a CHECK requiring both
  watermarks to be past `promoted_at`, and an optimistic watermark converts an unmeasurable
  lead into a published one.
- **Partial failure keeps its partial work.** Writes flush per batch; the result carries
  what landed. A stage that fails on batch 7 of 10 reports `rowsOut` for 6 and an error.
- **Nothing catches broadly.** `classify()` (§6.4) is total over a closed union; an
  unmatched error is `internal`, which is retryable *and* pages.

```ts
export async function runStage(def: StageDef): Promise<StageResult> {
  const startedAt = new Date();
  const gate = await checkPaused(def.name);            // §6.4 — 402/401 pause
  if (gate.paused) {
    await opsEvent('stage_paused_skip', 'warn', def.name, { reason: gate.reason });
    return { rowsOut: 0 };
  }

  const lease = await acquireLease(def.name, HOLDER_ID, def.timeoutMs + 30_000);
  if (!lease) return { rowsOut: 0 };                   // §6.3 — someone else holds it

  const runId = await openRun(def.name, startedAt);    // ops_stage_run, ok = false
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new StageTimeout(def.name)), def.timeoutMs);
  const budget = await budgetFor(def.name, def.sources, runId);

  try {
    const result = await def.run({
      db: service, budget, log: logger(def.name, runId),
      deadline: ac.signal, runId, now: startedAt,
    });
    await closeRun(runId, { ok: true, finishedAt: new Date(),
      apiReads: budget.reads, costUsd: budget.costUsd, ...result });
    return result;
  } catch (err) {
    const e = classify(err);
    await closeRun(runId, { ok: false, finishedAt: new Date(), rowsOut: 0,
      apiReads: budget.reads, costUsd: budget.costUsd,
      errorCode: e.code, errorDetail: e.detail });
    if (e.pauseStage) await pauseStage(def.name, e);   // loud, and stops the bleeding
    await opsEvent(`stage_${e.code}`, e.severity, def.name, { detail: e.detail });
    if (e.retryable) throw err;                        // Inngest retries with backoff
    return { rowsOut: 0 };
  } finally {
    clearTimeout(timer);
    await releaseLease(def.name, lease.fence);
    await budget.flush();                              // ops_spend is written even on throw
  }
}
```

#### One stage, fully implemented — `clocks-ct`

Clock B. ~300 handles, every two minutes, `t_ct = min(posted_at)` over the mentions it
finds. It is the stage worth writing out because it exercises every clause of the contract:
a metered vendor, a per-cycle budget, a watermark checkpoint, natural-key idempotency, a
deadline, and the rule that a sensor may never claim to have seen further than it scanned.

```ts
// apps/pipeline/src/stages/clocks-ct/index.ts
import { z } from 'zod';
import type { StageDef, StageCtx, StageResult } from '../../lib/stage';
import { CT_HANDLES } from './io/roster';           // curated, versioned, in git
import { extractTargets } from './model/extract';   // PURE: text -> {cashtags, mints, entities}

const HANDLES_PER_CALL = 20;                        // twitterapi.io advanced-search OR query
const COST_PER_POST_USD = 0.00015;

/** ⚠ VERIFY: twitterapi.io `/twitter/tweet/advanced_search` query syntax, its
 *  `has_next_page`/`next_cursor` field names, and whether `since_time` is unix
 *  seconds. Every one of these is asserted by the zod schema below, so a change
 *  is `vendor_contract` (terminal, pages) and never a silent empty result. */
const SearchResponse = z.object({
  tweets: z.array(z.object({
    id: z.string(),
    url: z.string().url(),
    text: z.string(),
    createdAt: z.string(),
    author: z.object({ userName: z.string() }),
  })),
  has_next_page: z.boolean(),
  next_cursor: z.string().nullable(),
});

export const clocksCt: StageDef = {
  name: 'clocks-ct',
  schedule: { everySeconds: 120 },
  timeoutMs: 90_000,                                 // < the 120s cadence, deliberately
  sources: ['twitterapi'],
  retries: 2,
  run: pollCryptoTwitter,
};

async function pollCryptoTwitter(ctx: StageCtx): Promise<StageResult> {
  const { db, budget, log, deadline, now } = ctx;

  const { data: hb } = await db.from('sensor_heartbeat')
    .select('observed_through').eq('sensor', 'ct_poll').single();

  // 90s of overlap. Duplicates are free (UNIQUE (handle, platform_post_id));
  // a hole is a broken earliness claim.
  const since = new Date((hb?.observed_through ?? new Date(now.getTime() - 6 * 3600_000))
    .valueOf() - 90_000);

  const batches = chunk(CT_HANDLES, HANDLES_PER_CALL);
  // THE checkpoint invariant: the watermark may only advance to the oldest boundary
  // that every batch reached. One failed batch holds the whole sensor back.
  let scannedThrough: Date | null = null;
  let written = 0;
  let posts = 0;
  const failed: string[] = [];

  for (const batch of batches) {
    if (deadline.aborted) { log.warn('deadline', { done: batches.indexOf(batch) }); break; }

    const q = batch.map((h) => `from:${h}`).join(' OR ');
    let cursor: string | null = null;
    const batchStart = new Date();
    const rows: CtMentionInsert[] = [];

    try {
      do {
        // Reserves BEFORE the call. A false return is budget_exhausted: terminal.
        await budget.reserve('twitterapi', 20, 20 * COST_PER_POST_USD);
        const raw = await budget.fetch('twitterapi', '/twitter/tweet/advanced_search', {
          query: { query: q, queryType: 'Latest', since_time: Math.floor(+since / 1000),
                   ...(cursor ? { cursor } : {}) },
          signal: deadline,
        });
        const page = SearchResponse.parse(raw);       // parse failure => vendor_contract
        posts += page.tweets.length;

        for (const t of page.tweets) {
          const targets = extractTargets(t.text);
          if (!targets.cashtags.length && !targets.mints.length && !targets.entities.length) continue;
          const link = await resolveTarget(db, targets);   // -> {storyId?, mint?, matchedOn}
          if (!link) continue;                              // ct_mention_targets_something
          rows.push({
            story_id: link.storyId ?? null,
            mint: link.mint ?? null,
            handle: t.author.userName.toLowerCase(),
            platform_post_id: t.id,
            posted_at: new Date(t.createdAt).toISOString(),
            observed_at: new Date().toISOString(),
            permalink: t.url,                                // the proof travels with the claim
            matched_on: link.matchedOn,
          });
        }
        cursor = page.has_next_page ? page.next_cursor : null;
      } while (cursor && !deadline.aborted);

      if (rows.length) {
        const { error, count } = await db.from('ct_mention')
          .upsert(rows, { onConflict: 'handle,platform_post_id', ignoreDuplicates: true,
                          count: 'exact' });
        if (error) throw error;                       // constraint_violation is a WIN, and loud
        written += count ?? 0;
      }
      scannedThrough = scannedThrough === null || batchStart < scannedThrough
        ? batchStart : scannedThrough;
    } catch (err) {
      failed.push(batch[0]);
      if (isTerminal(err)) throw err;                 // 402/401/contract: stop the whole cycle
      log.warn('batch_failed', { head: batch[0], err: String(err) });
      // scannedThrough is NOT advanced for this batch. The sensor stays honest.
    }
  }

  // Only advance the watermark if every batch reported. A partial sweep leaves the
  // watermark where it was, and story_clock's CHECK then refuses to record a lead
  // time measured by a sensor that had not caught up.
  const complete = failed.length === 0 && !deadline.aborted && scannedThrough !== null;
  await db.from('sensor_heartbeat').upsert({
    sensor: 'ct_poll',
    last_beat_at: new Date().toISOString(),
    observed_through: (complete ? scannedThrough! : (hb?.observed_through ?? since)).toISOString(),
    detail: { batches: batches.length, failed: failed.length, posts },
  });

  if (!complete) await openGapIfNeeded('ct_poll', 'supervisor', { failed });
  else await closeGapIfOpen('ct_poll');

  return { rowsOut: written, rowsIn: posts, detail: { batches: batches.length, failed } };
}
```

The load-bearing line is the second-to-last block. `last_beat_at` and `observed_through` are
two different facts — *alive* and *scanned through here* — and conflating them is how a
reconnected-but-empty sensor certifies a lead time it never measured.

---

### 6.3 Scheduling and concurrency

**What may overlap.** Different stages may run concurrently unless one writes what another
reads within the same tick. Every stage is a singleton against itself, always.

| Stage | May overlap with | Must not overlap with | Why |
|---|---|---|---|
| `ingest-x`, `ingest-tiktok` | everything | itself | double spend on the largest cost line |
| `snapshot` | ingest, score, clocks | itself | `post_snapshot(post_id, captured_at)` PK collisions and a corrupted EWMA |
| `score` | everything | itself | LLM spend |
| `cluster` | ingest, snapshot | itself, `promote`, `name` | centroid updates and `promoted_at` must see one consistent story set |
| `promote` | ingest, snapshot | itself, `cluster`, `resolve-coins` | promote → resolve is the ordering that makes a match attachable |
| `name` | ingest, snapshot | itself, `cluster` | writes `story.title`, `title_version` |
| `resolve-coins` | ingest, snapshot, score | itself, `promote` | sole writer of `coin_match` |
| `rank-commit` | everything | itself | sole writer of `board_state`; `tick_seq` must be strictly monotonic |
| `deliver` | everything | itself, `resolve-coins` | fires on a 0 → ≥1 confirmed transition |
| `clocks-ct`, `clocks-mint` | everything | itself | watermark integrity |
| `watchdog` | everything | itself | — |

Mutual exclusion between *different* stages is expressed as a shared Inngest concurrency
key (`cluster`, `promote` and `name` share `key: '"story-write"'`, limit 1), not as ordering
hope.

**The lock.** Not a PID file, not an in-process mutex, not a Redis SETNX we would have to
operate. A **lease row in Postgres with a fencing token**, because Postgres is the one thing
every host already shares and the one thing that is authoritative about the writes anyway.
Session-scoped advisory locks were rejected: Supabase's pooler runs in transaction mode,
where a session lock is held by whichever backend the pooler happened to hand out and is
released at a moment unrelated to the caller.

```sql
-- 0014_environment_and_budget.sql
CREATE TABLE IF NOT EXISTS public.ops_stage_lease (
  stage       text PRIMARY KEY,
  holder      text NOT NULL,          -- fly machine id + pid
  fence       bigint NOT NULL,        -- strictly increasing; the anti-zombie token
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION public.acquire_stage_lease(
  p_stage text, p_holder text, p_ttl_ms integer
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_fence bigint;
BEGIN
  -- One statement. The predicate that decides whether the lease is free is inside
  -- the same UPDATE that takes it, so two machines cannot both observe "free".
  INSERT INTO public.ops_stage_lease (stage, holder, fence, expires_at)
  VALUES (p_stage, p_holder, 1, now() + make_interval(secs => p_ttl_ms / 1000.0))
  ON CONFLICT (stage) DO UPDATE
     SET holder = EXCLUDED.holder,
         fence  = public.ops_stage_lease.fence + 1,
         acquired_at = now(),
         expires_at  = EXCLUDED.expires_at
   WHERE public.ops_stage_lease.expires_at < now()      -- expired: reclaimable
      OR public.ops_stage_lease.holder = EXCLUDED.holder -- our own re-entry
  RETURNING fence INTO v_fence;

  RETURN v_fence;   -- NULL => held by someone else, still alive. Caller returns rows_out 0.
END $$;

CREATE OR REPLACE FUNCTION public.release_stage_lease(
  p_stage text, p_holder text, p_fence bigint
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  DELETE FROM public.ops_stage_lease
   WHERE stage = p_stage AND holder = p_holder AND fence = p_fence;
$$;
```

Three properties. A crashed holder's lease expires — `ttl = timeoutMs + 30 s`, so it is
always longer than the stage can legally run. A zombie that wakes after expiry holds a stale
fence and its `release` deletes nothing, so it cannot free a lease it no longer owns. And
the lock is visible: `select * from ops_stage_lease` during an incident says which machine
is holding what, which a PID file on a dead host does not.

Long stages (`outcomes`) renew mid-flight:

```ts
// apps/pipeline/src/lib/lease.ts
export function renewInBackground(stage: StageName, fence: bigint, ttlMs: number) {
  const t = setInterval(async () => {
    const { data } = await service.rpc('renew_stage_lease',
      { p_stage: stage, p_holder: HOLDER_ID, p_fence: Number(fence),
        p_ttl_ms: ttlMs });
    // Lost the lease while running: abort immediately rather than write behind a
    // holder that has already started. Split brain is loud, not silent.
    if (data !== true) throw new LeaseLost(stage, fence);
  }, Math.floor(ttlMs / 3));
  return () => clearInterval(t);
}
```

Inngest's `concurrency: { limit: 1, key: '"<stage>"' }` remains configured on every function.
It is defence in depth and it is *not* the guarantee — the lease is, because it also covers a
manual CLI invocation, a stuck-then-resumed function, and the two-machine canary window.

---

### 6.4 Budgets and the error taxonomy

#### The ledger

Ingestion is $0.00015/post and is the largest cost line at every DAU tier. A cap in a config
file is a cap a loop outruns between two reads, so **the reservation is the increment, in
one statement**, against the tables that actually exist in `0010`.

```sql
-- 0014_environment_and_budget.sql
SELECT insidor.add_column('public.ops_budget_cap', 'cycle_cap_reads', 'integer NOT NULL DEFAULT 0');
SELECT insidor.add_column('public.ops_stage_expected', 'paused_until',  'timestamptz');
SELECT insidor.add_column('public.ops_stage_expected', 'paused_reason', 'text');

CREATE TABLE IF NOT EXISTS public.ops_environment (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),   -- singleton
  name           text NOT NULL CHECK (name IN ('local','preview','staging','production')),
  network        text NOT NULL CHECK (network IN ('mainnet-beta','devnet')),
  ingest_mode    text NOT NULL CHECK (ingest_mode IN ('off','replay','live')),
  trading_mode   text NOT NULL CHECK (trading_mode IN ('off','simulate','live')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT env_live_trading_is_production_only
    CHECK (trading_mode <> 'live' OR (name = 'production' AND network = 'mainnet-beta')),
  CONSTRAINT env_live_ingest_is_deployed_only
    CHECK (ingest_mode <> 'live' OR name IN ('staging','production')),
  CONSTRAINT env_local_cannot_spend
    CHECK (name <> 'local' OR ingest_mode = 'replay')
);

-- Returns the granted read count. Partial grants are deliberate: a stage near the
-- cap does less work rather than failing, and learns exactly how much it may do.
CREATE OR REPLACE FUNCTION public.reserve_spend(
  p_source text, p_reads integer, p_cost_usd numeric
) RETURNS TABLE (granted integer, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_cap numeric; v_hard boolean; v_mode text; v_spent numeric; v_room integer;
BEGIN
  IF p_reads <= 0 THEN
    RAISE EXCEPTION 'reserve_spend: p_reads must be positive' USING ERRCODE = 'check_violation';
  END IF;

  SELECT ingest_mode INTO v_mode FROM public.ops_environment;
  IF v_mode <> 'live' THEN
    RAISE EXCEPTION
      'reserve_spend called with ingest_mode=% — this environment must not spend money. '
      'Set INGEST_MODE=replay and use fixtures.', v_mode USING ERRCODE = 'check_violation';
  END IF;

  SELECT daily_cap_usd, hard_stop INTO v_cap, v_hard
    FROM public.ops_budget_cap WHERE source = p_source;
  IF NOT FOUND THEN
    -- An unknown vendor has no cap, so it gets no money. Fail closed.
    RETURN QUERY SELECT 0, format('no ops_budget_cap row for source %s', p_source);
    RETURN;
  END IF;

  INSERT INTO public.ops_spend (utc_date, source)
  VALUES ((now() AT TIME ZONE 'utc')::date, p_source)
  ON CONFLICT (utc_date, source) DO NOTHING;

  -- The cap test is inside the UPDATE. Parallel stages cannot race past it.
  UPDATE public.ops_spend
     SET reads      = reads + p_reads,
         cost_usd   = cost_usd + p_cost_usd,
         updated_at = now()
   WHERE utc_date = (now() AT TIME ZONE 'utc')::date
     AND source   = p_source
     AND cost_usd + p_cost_usd <= v_cap
  RETURNING cost_usd INTO v_spent;

  IF v_spent IS NOT NULL THEN
    RETURN QUERY SELECT p_reads, NULL::text;
  ELSE
    RETURN QUERY SELECT 0, 'daily_cap_reached';   -- the caller STOPS. It never retries.
  END IF;
END $$;
```

`budget.ts` is the only module in the repository permitted to construct a fetch against a
metered base URL — enforced by a dependency-cruiser rule, the same way the service key is.

```ts
// apps/pipeline/src/lib/budget.ts
export async function budgetFor(stage: StageName, sources: readonly VendorSource[], runId: number) {
  const caps = await loadCycleCaps(sources);        // ops_budget_cap.cycle_cap_reads
  const used: Record<string, number> = {};
  let reads = 0, costUsd = 0;

  return {
    get reads() { return reads; },
    get costUsd() { return costUsd; },

    async reserve(source: VendorSource, n: number, usd: number) {
      if (!sources.includes(source)) {
        throw new StageError('vendor_contract',
          `stage ${stage} is not declared against source ${source}`);
      }
      // The per-cycle cap is in-process, and it is only sound because §6.3 guarantees
      // exactly one runner. It is the guard against a cadence change shipped without a
      // matching budget reduction — the usual cause of a daily cap breach.
      used[source] = (used[source] ?? 0) + n;
      if (caps[source] > 0 && used[source] > caps[source]) {
        throw new StageError('cycle_budget_exhausted',
          `${stage} asked for ${used[source]} ${source} reads; cycle cap is ${caps[source]}`);
      }
      const { data } = await service.rpc('reserve_spend',
        { p_source: source, p_reads: n, p_cost_usd: usd });
      const row = data?.[0];
      if (!row || row.granted < n) {
        throw new StageError('budget_exhausted', row?.reason ?? 'daily_cap_reached');
      }
      reads += n; costUsd += usd;
    },

    async fetch(source: VendorSource, path: string, init: VendorInit) { /* adapters/ */ },
    async flush() { /* ops_stage_run.api_reads / cost_usd, already carried by runStage */ },
  };
}
```

Caps, per environment: production is set by the founder; staging is $0.30/day across all
sources; preview and local cannot spend, because `ops_environment` refuses. **Never raise a
cap to make an alert stop.** The usual cause is a cadence change without a matching
`cycle_cap_reads` reduction, and that is a revert.

#### The taxonomy

The old build's retry helper retried on HTTP 429 and only 429. A 402 fell out of the `if`,
threw, and vanished into a caller that logged nothing; posts stopped arriving; everything
aged past the 240-minute display gate; nothing alerted for two days. The replacement is a
**closed union with an explicit disposition per class, where the default is terminal, not
retryable** — an unrecognised status must never be treated as transient.

```ts
// apps/pipeline/src/lib/errors.ts
export type StageErrorCode =
  // retryable — the next run probably succeeds
  | 'vendor_timeout' | 'vendor_5xx' | 'vendor_429' | 'db_conflict' | 'internal'
  // terminal — retrying costs money, or makes it worse
  | 'budget_exhausted' | 'cycle_budget_exhausted'
  | 'vendor_402' | 'vendor_auth' | 'vendor_contract' | 'vendor_4xx'
  | 'constraint_violation' | 'schema_assert_failed' | 'lease_lost' | 'stage_timeout';

export type Classified = {
  code: StageErrorCode;
  retryable: boolean;
  /** THE difference from the old build: a class that must stop the stage entirely
   *  until a human clears it. Money and credentials are not transient conditions. */
  pauseStage: boolean;
  severity: 'info' | 'warn' | 'page';
  detail: string;
};

const DISPOSITION: Record<StageErrorCode, Omit<Classified, 'code' | 'detail'>> = {
  vendor_timeout:         { retryable: true,  pauseStage: false, severity: 'info' },
  vendor_5xx:             { retryable: true,  pauseStage: false, severity: 'info' },
  vendor_429:             { retryable: true,  pauseStage: false, severity: 'warn' },
  db_conflict:            { retryable: true,  pauseStage: false, severity: 'info' },
  internal:               { retryable: true,  pauseStage: false, severity: 'page' },
  budget_exhausted:       { retryable: false, pauseStage: true,  severity: 'warn' },
  cycle_budget_exhausted: { retryable: false, pauseStage: false, severity: 'warn' },
  vendor_402:             { retryable: false, pauseStage: true,  severity: 'page' },
  vendor_auth:            { retryable: false, pauseStage: true,  severity: 'page' },
  vendor_contract:        { retryable: false, pauseStage: true,  severity: 'page' },
  vendor_4xx:             { retryable: false, pauseStage: false, severity: 'warn' },
  constraint_violation:   { retryable: false, pauseStage: false, severity: 'warn' },
  schema_assert_failed:   { retryable: false, pauseStage: true,  severity: 'page' },
  lease_lost:             { retryable: false, pauseStage: false, severity: 'warn' },
  stage_timeout:          { retryable: true,  pauseStage: false, severity: 'warn' },
};

export function fromHttpStatus(status: number): StageErrorCode {
  if (status === 402) return 'vendor_402';
  if (status === 401 || status === 403) return 'vendor_auth';
  if (status === 408 || status === 425) return 'vendor_timeout';
  if (status === 429) return 'vendor_429';
  if (status >= 500) return 'vendor_5xx';
  if (status >= 400) return 'vendor_4xx';   // terminal by DEFAULT. Never falls through.
  return 'vendor_contract';                 // a non-error status reaching here is a bug
}

export function classify(err: unknown): Classified {
  const code =
    err instanceof StageError        ? err.code
  : err instanceof HttpError         ? fromHttpStatus(err.status)
  : err instanceof z.ZodError        ? 'vendor_contract'
  : isPgError(err, '23')             ? 'constraint_violation'   // integrity_constraint_violation
  : isPgError(err, '40')             ? 'db_conflict'            // serialization / deadlock
  : err instanceof StageTimeout      ? 'stage_timeout'
  : err instanceof LeaseLost         ? 'lease_lost'
  : 'internal';
  return { code, ...DISPOSITION[code], detail: describe(err) };
}
```

Five entries carry the weight.

**`vendor_402` and `vendor_auth` pause the stage.** `pauseStage` writes
`ops_stage_expected.paused_until = now() + 24h` with the reason, emits an `ops_event` at
`page`, and posts to `#insidor-page` naming the stage, the vendor and the status. The stage
then *skips* each tick and logs `stage_paused_skip` at `warn`, so `ops_stage_run` keeps
producing rows and the stall SLI keeps measuring. Pausing is loud, bounded, and cleared only
by a human:
`update ops_stage_expected set paused_until = null, paused_reason = null where stage = …`.
Retrying a 402 spends nothing and fixes nothing — a card needs topping up. Retrying a 401
burns rate limit against a key that has been rotated.

**`vendor_429` never widens concurrency.** Exponential backoff with full jitter, capped at
the stage's own cadence, so a stage never queues behind itself.

**`vendor_contract`** is a 200 whose *shape* we do not recognise. The worst vendor failure is
not an outage; it is an endpoint that quietly stops returning a field and a caller that reads
`?? null` and treats null as fine. That is the RugCheck defect exactly: `/report/summary`
carries no authority fields, `mintAuthority == null` read as revoked, and every token got a
green tick. Every adapter parses through zod; a parse failure is terminal and pages, never a
default. The schema's three-valued `authority_state` makes *storing* that lie impossible;
`vendor_contract` makes *fetching* it loud.

**`constraint_violation`** is `warn`, and it is a **success**: the database refused a row the
pipeline should not have built. The constraint name goes into `ops_stage_run.error_detail`,
so `coin_match_confirmed_requires_evidence` in the log is a matcher bug caught before a user
saw a Buy button. A rising rate is a regression; a flat low rate is the system working.

**`internal`** is retryable *and* pages. An unclassified error is a hole in the taxonomy, and
a hole that fails quietly is how two days of silence happened.

---

### 6.5 The websocket clock

One persistent PumpPortal connection, owned by `main.ts`, not by a stage. It is a
subscription whose silence is the signal, so it cannot be a cron.

```ts
// apps/pipeline/src/adapters/pumpportal.ts
const IDLE_TIMEOUT_MS = 45_000;   // mainnet mints ~40/90s; 45s of silence is a dead socket
const MAX_BACKOFF_MS  = 30_000;
const QUEUE_MAX       = 5_000;

export function startMintStream(deps: Deps) {
  let attempt = 0, ws: WebSocket | null = null, idle: NodeJS.Timeout;
  const queue: MintEvent[] = [];

  const connect = () => {
    ws = new WebSocket('wss://pumpportal.fun/api/data');
    const connectedAt = new Date();

    ws.on('open', async () => {
      attempt = 0;
      ws!.send(JSON.stringify({ method: 'subscribeNewToken' }));
      // Close the gap only AFTER the subscription is acknowledged by traffic, not on
      // socket open. An open socket with no subscription is a silent hole.
      await deps.markConnected('mint_stream', connectedAt);
      bumpIdle();
    });

    ws.on('message', (buf) => {
      bumpIdle();
      const parsed = MintEvent.safeParse(JSON.parse(buf.toString()));
      if (!parsed.success) {
        // A shape change on the mint stream is a broken earliness claim, not a warning.
        void deps.opsEvent('mint_stream_contract', 'page', 'clocks-mint',
          { issues: parsed.error.issues.slice(0, 3) });
        return;
      }
      if (queue.length >= QUEUE_MAX) {
        // Backpressure IS a gap. Dropping events silently is the failure this table exists for.
        void deps.openGap('mint_stream', 'supervisor', { reason: 'queue_overflow' });
        return;
      }
      queue.push(parsed.data);
    });

    ws.on('close', async (code) => {
      clearTimeout(idle);
      // Opened BEFORE the reconnect attempt, so the ledger is complete even if the
      // reconnect succeeds instantly and even if alerting is down.
      await deps.openGap('mint_stream', 'supervisor', { code });
      const wait = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt++) * (0.5 + Math.random() / 2);
      setTimeout(connect, wait);
    });

    ws.on('error', () => ws?.close());
  };

  const bumpIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ws?.close(4000, 'idle'), IDLE_TIMEOUT_MS);
  };

  connect();
  return { queue };
}
```

**Gap detection.** ⚠ VERIFY: PumpPortal's `subscribeNewToken` payload carries no sequence
number and no server-side replay, so a gap cannot be detected from the stream itself — only
from its boundaries. Three detectors, and all three write to the same `sensor_gap` table:

1. **Disconnect boundary.** `close` → `sensor_gap(sensor='mint_stream', started_at=now())`
   before the reconnect. Reconnect → `ended_at`.
2. **Idle timeout.** 45 s with no message closes the socket deliberately, which routes into
   detector 1. A socket that is open and receiving nothing is the failure that looks
   healthiest.
3. **Post-hoc reconciliation.** After a gap closes, `clocks-mint` backfills the window from
   the Helius mint index and writes any mint it finds with
   `coin.minted_at_source = 'helius_backfill'`, never `'pumpportal_create'`. The two sources
   are distinguishable forever, because a backfilled mint is evidence of a hole, not
   evidence of coverage.

**The consequence is refusal, not estimation.** Any story whose `[promoted_at, t_crypto]`
window intersects an open or historical `sensor_gap` gets
`story_clock.unmeasurable = true, unmeasurable_sensor, unmeasurable_gap_id`. The lead time
is suppressed everywhere it would render, and `story_outcome` records `unmeasurable`, which
`story_outcome_unmeasurable_has_no_lead` forces to carry no lead at all. Unmeasurable
windows are never wins.

**Coexistence with the scheduler.** The socket never writes to the database from its message
handler. It appends to a bounded in-process queue; `clocks-mint` — a real stage, with a
lease, a run row and a `rows_out` — drains it every 5 s and upserts `coin` on `mint`. Three
things follow: the socket cannot be blocked by database latency; `rows_out = 0` on the
drainer is a *legible* fact the stall SLI can read; and if the machine dies with a full
queue, the events were never acknowledged upstream, so the gap is the honest record of what
was lost. The queue high-water mark goes into `sensor_heartbeat.detail`.

`observed_through` for `mint_stream` is the timestamp of the last successfully *drained*
event, never the last received one — the same rule as `clocks-ct`.

---

### 6.6 Observability

`watchdog` runs every 60 s and writes one `ops_sli_sample` row per SLI. The principle is that
**absence and zero must both breach**, because the outage that happened produced neither an
error nor a metric. `ops_sli_sample`'s `CHECK ((value IS NULL) = (state = 'unknown'))` means
an SLI that cannot be evaluated is `unknown` — a distinct colour on `/ops`, never green.

**SLI-2 · `stage_output_stall`. This is the one that catches the two-day outage inside three
cycles.** It is driven from `ops_stage_expected`, not from `ops_stage_run`, so a stage that
is dead and logging nothing scores 999 rather than scoring nothing at all.

```sql
WITH last_productive AS (
  SELECT stage, max(started_at) AS at
    FROM public.ops_stage_run
   WHERE rows_out > 0                       -- OUTPUT, not "ran". A heartbeat ticked
   GROUP BY stage                           -- happily through all 48 hours of the outage.
)
SELECT
  e.stage,
  e.interval_seconds,
  lp.at AS last_productive_at,
  (SELECT count(*) FROM public.ops_stage_run r
    WHERE r.stage = e.stage
      AND r.started_at > COALESCE(lp.at, '-infinity'::timestamptz)) AS zero_run_streak,
  CASE WHEN lp.at IS NULL THEN 999          -- ABSENCE breaches identically to ZERO
       ELSE ceil(extract(epoch FROM now() - lp.at) / e.interval_seconds)::int
  END AS intervals_since_output
FROM public.ops_stage_expected e
LEFT JOIN last_productive lp ON lp.stage = e.stage
WHERE e.enabled AND e.paused_until IS NULL
ORDER BY intervals_since_output DESC;
```

Warn at `intervals_since_output ≥ 3`, page at `≥ 5`. For `ingest-x` at 180 s that is a page
**15 minutes** into the outage instead of never. The `WHERE e.paused_until IS NULL` clause is
not a mute: a paused stage is covered by SLI-11 below, which pages harder.

**SLI-11 · `stage_paused`** — the direct 402/401 detector, and the reason a paused stage does
not simply disappear from monitoring.

```sql
SELECT e.stage, e.paused_reason, e.paused_until,
       extract(epoch FROM now() - COALESCE(
         (SELECT max(created_at) FROM public.ops_event v
           WHERE v.stage = e.stage AND v.severity = 'page'), now()))::int AS paged_ago_s
  FROM public.ops_stage_expected e
 WHERE e.paused_until IS NOT NULL;
```

Any row is a page, repeated every 30 minutes until cleared. A pause has no quiet mode.

**SLI-1 · `ingest_freshness`** — the product-level cross-check, independent of whether any
stage logged at all.

```sql
SELECT p.platform,
       extract(epoch FROM now() - max(p.first_seen_at))::int AS freshness_s,
       count(*) FILTER (WHERE p.first_seen_at > now() - interval '15 minutes') AS last_15m
  FROM public.post p
 WHERE p.first_seen_at > now() - interval '6 hours'
 GROUP BY p.platform;
```

Warn 15 min, page 30 min. A platform that produces **no group row at all** is `unknown`, and
`unknown` pages after 30 minutes — otherwise a `GROUP BY` with nothing to group is a green
board.

**SLI-6 · `sensor_gap_open`** — both sensors, one query, because the tables are symmetric.

```sql
SELECT g.sensor, 'open_gap' AS kind,
       extract(epoch FROM now() - g.started_at)::int AS seconds
  FROM public.sensor_gap g WHERE g.ended_at IS NULL
UNION ALL
SELECT h.sensor, 'stale_watermark',
       extract(epoch FROM now() - h.observed_through)::int
  FROM public.sensor_heartbeat h
 WHERE now() - h.observed_through > interval '3 minutes'
UNION ALL   -- a sensor with no heartbeat row at all
SELECT s, 'absent', 999999
  FROM unnest(enum_range(NULL::sensor)) s
 WHERE s NOT IN (SELECT sensor FROM public.sensor_heartbeat);
```

Warn 120 s, page 300 s.

**SLI-7 · `budget_burn`** — projected to UTC midnight, and it distinguishes "no data" from
"$0.00", which `ops_spend`'s own table comment demands.

```sql
SELECT c.source, c.daily_cap_usd, c.hard_stop,
       (s.utc_date IS NULL) AS no_row_today,          -- NOT the same as zero spend
       COALESCE(s.cost_usd, 0) AS spent_usd,
       COALESCE(s.cost_usd, 0) / NULLIF(c.daily_cap_usd, 0)
         / NULLIF(extract(epoch FROM (now() AT TIME ZONE 'utc')
                  - date_trunc('day', now() AT TIME ZONE 'utc')) / 86400.0, 0)
         AS projected_frac_at_midnight
  FROM public.ops_budget_cap c
  LEFT JOIN public.ops_spend s
    ON s.source = c.source AND s.utc_date = (now() AT TIME ZONE 'utc')::date;
```

Warn at 0.80 projected, page at 1.00. A `no_row_today = true` on a source whose stage is
enabled is itself a warn — it means the stage is not calling the vendor.

**SLI-3 · `funnel_yield`** — the semantic check the stall SLI cannot make: every stage
running and producing rows, and nothing reaching the board.

```sql
SELECT sum(arrived) AS arrived, sum(admitted) AS admitted, sum(tracked) AS tracked,
       sum(triggered) AS triggered, sum(clustered) AS clustered, sum(promoted) AS promoted,
       sum(promoted)::numeric / NULLIF(sum(arrived), 0) AS yield
  FROM public.ops_funnel
 WHERE bucket_at > now() - interval '1 hour';
```

Warn below 0.5%, page below 0.1% — and page on a zero denominator with a non-zero previous
hour, which is a stalled `arrive` that `ingest-x` reported as success.

The remaining SLIs keep their §6.8 definitions: `board_render_fallback` (2% / 10%),
`match_abstain_rate` (outside 0.15–0.30), `unclassified_outcomes` (1 / 10),
`e2e_lead_time_p50` (< 5 min / < 0 min), `delta_divergence` (2% / 5%).

**Degraded versus dead.** These are different pages and different runbook entries.

| | Degraded | Dead |
|---|---|---|
| Definition | The system is producing output, but less, later or less trustworthy than it should | An output measure has been flat for ≥ 5 intervals, or a stage is paused |
| Examples | `vendor_429` sustained · one `clocks-ct` batch failing · abstain rate at 0.38 · budget 85% burnt | `intervals_since_output ≥ 5` · `paused_until` set · `sensor_gap` open > 300 s · watchdog silent |
| Board | Renders with the amber staleness band and a live counter | Renders the last good tick stamped `as of HH:MM`, HEAT dimmed |
| Alert | `#insidor-ops`, `warn` | `#insidor-page`, `page`, repeated |
| Earliness claim | Still made, marked stale | **Suppressed** — an unmeasurable window is never a win |

**The dead-man's switch.** `watchdog` pings healthchecks.io after each successful evaluation.
If the watchdog dies, healthchecks.io alerts. Nothing inside the system may be the only thing
able to report that the system is not running — that is the structural version of the
two-day lesson.

---

### 6.7 Local development

The requirement is running one real stage against real vendor shapes without spending the
production budget or writing to production. Three independent mechanisms, any one
sufficient, and none of them a convention:

1. `packages/env` refuses to start when a metered key is present and `INGEST_MODE ≠ 'live'`.
2. `assertEnvironment()` at preflight: `ops_environment.name` must equal `APP_ENV`. A
   production connection string in `.env.local` crashes on boot.
3. `reserve_spend()` raises when the database's `ingest_mode` is not `live`. Even with a key
   and a bad env, the first metered call fails inside Postgres.

The tool is a stage runner, not a copy of the scheduler:

```ts
// apps/pipeline/src/cli/run-stage.ts
//   npm run stage -w apps/pipeline -- clocks-ct --once
//   npm run stage -w apps/pipeline -- score --once --record     # capture cassettes
//   npm run stage -w apps/pipeline -- resolve-coins --once --dry --since 6h
const argv = parseArgs();
const def = STAGES[argv.stage];                         // same StageDef the scheduler uses
assertEnv(['local', 'staging']);                        // never production, no flag to force

if (argv.record) {
  // Records against staging keys, redacts on write, and commits under
  // src/adapters/__fixtures__/<vendor>/<hash>.json. Recording is the ONLY path
  // by which a real vendor response enters the repository.
  setVendorMode({ mode: 'record', budgetCeilingUsd: 0.50 });
} else {
  // INGEST_MODE=replay. Every adapter reads its cassette; a cache miss THROWS
  // rather than falling through to the network, so a missing fixture is a loud
  // test failure and never a surprise invoice.
  setVendorMode({ mode: 'replay' });
}

// --dry wraps the whole run in a transaction that is rolled back, and asserts the
// stage produced the writes it claims. Local Postgres only; the pooler cannot hold
// a transaction across the run.
const result = argv.dry ? await inRolledBackTx(() => runStage(def)) : await runStage(def);
console.log(JSON.stringify(result, null, 2));
```

The database is the Supabase CLI stack on the laptop, migrated by `scripts/migrate.mjs up`
and seeded from `supabase/seed/`. Cassettes let a developer run `score` fifty times against
the exact bytes that broke production; when a vendor's shape changes for real, the adapter
contract test in `src/adapters/__tests__/` fails in CI against the committed cassette — the
same `vendor_contract` failure, found before deploy.

Reproducing an incident is a fixture, not a connection string: pull the offending
`ops_stage_run.detail` and the cassette, replay, and the failure is deterministic because
`StageCtx.now` is injected and model code may not call `Date.now()` or `Math.random()`.

---

### 6.8 Deployment

**Where.** Fly.io, `insidor-pipeline`. Production runs two machines with a canary rollout;
staging runs one. Fly is chosen over Railway for one specific reason: `min_machines_running`
and rolling strategy give a first-class canary with an automatic rollback on a failing health
check, and the failure mode we must never have is a pipeline that deploys and then does not
run.

```toml
# apps/pipeline/fly.production.toml
app = "insidor-pipeline"
primary_region = "iad"                # co-located with the Supabase project

[build]
  dockerfile = "Dockerfile"

[deploy]
  strategy = "canary"                 # one machine, health-checked, before the second
  wait_timeout = "5m"

[env]
  APP_ENV = "production"
  PORT = "8080"

[[services]]
  internal_port = 8080
  protocol = "tcp"
  auto_stop_machines = false          # a scheduler that scales to zero is not a scheduler
  auto_start_machines = false
  min_machines_running = 2

  [[services.http_checks]]
    path = "/health/live"
    interval = "10s"
    timeout  = "2s"
    grace_period = "30s"

  [[services.http_checks]]
    path = "/health/ready"            # the check that gates the canary
    interval = "30s"
    timeout  = "5s"
    grace_period = "90s"
```

**Two health endpoints, and the difference is the whole point.**

```ts
// apps/pipeline/src/main.ts
app.get('/health/live', (_, res) => res.json({ ok: true, sha: BUILD_SHA }));

app.get('/health/ready', async (_, res) => {
  // Readiness is an OUTPUT measure. "The process is up" is /health/live and it is
  // exactly what stayed green for two days.
  const { data } = await service.rpc('stage_output_health');   // the SLI-2 query
  const worst = data?.[0];
  const socketOk = mintStream.connectedSince !== null;
  const ok = worst != null && worst.intervals_since_output < 5 && socketOk;
  res.status(ok ? 200 : 503).json({
    ok, sha: BUILD_SHA, schema: APPLIED_SCHEMA_VERSION,
    worstStage: worst?.stage, intervalsSinceOutput: worst?.intervals_since_output,
    mintSocket: socketOk,
  });
});
```

`/health/ready` returns 503 during the first ~90 s of a cold boot, which is why
`grace_period` is 90 s and why `min_machines_running = 2`: the canary must not be able to
take the last productive machine down.

**How it deploys.** `.github/workflows/release.yml` is the only path. Migrations first
(`scripts/release-plan.mjs` reads the `@phase` header and emits `db_first`), then Fly, then
Vercel. Expand-only migrations mean the running pipeline keeps working against the new
schema during the window; `REQUIRED_SCHEMA_VERSION` in preflight means the new pipeline
refuses to start against an old one.

**How it rolls back.**

```bash
fly deploy -a insidor-pipeline \
  --image "$(fly releases -a insidor-pipeline --json | jq -r '.[1].ImageRef')"
```

Done when `/health/ready` reports the previous SHA **and** a new `ops_stage_run` row exists
with `rows_out > 0`. A green health check without a productive run is not a completed
rollback — that distinction is the entire section.

If the pipeline will not start, read the last 20 log lines: preflight names the missing
variable or the mismatched environment. `fly secrets set` restarts it. **Never remove the
preflight.** If a budget is exhausted, the system is working: accept a quiet board until UTC
midnight, or raise the cap deliberately with the founder and write down why.
