## 9. TESTING AND CORRECTNESS

The old build has zero tests across 139 files, including the scoring and clustering
heuristics that *are* the product. Every defect in the incident list would have been caught
by a test under twenty lines.

### 9.1 The strategy, and what is deliberately not tested

**Start from the constraint that kills most React test plans.** Next.js's own testing guide
states that Vitest does not support async Server Components. `FeedScreen`, `CoinScreen` and
`StoryScreen` are async RSCs awaiting Supabase, so "test the components" is not a standard
that degrades gracefully — it fails on the first file anyone tries, and the codebase
reverts to zero.

The architecture's answer is structural and predates this section: every decision lives in
`model/`, a segment that is pure **by lint rule** — no React, no I/O, no `async`, no
`Date.now()`, `now` passed as a parameter (§2) — and a pure function needs no renderer, no
DOM, no mock and no fake timers. The purity rule and the testing strategy are one decision
seen from two sides: **`model/` exists because Vitest cannot render our components.**

| Layer | Where | Catches |
|---|---|---|
| Pure unit over `model/` | `features/*/model`, `stages/*/model`, `packages/contracts` | every arithmetic and gate defect |
| Type tests | `packages/contracts/src/__typetests__/` | a Buy button on an unconfirmed match |
| Negative SQL tests | `supabase/tests/invariants.sql` | a row the schema must refuse |
| Adapter contract tests | `apps/pipeline/src/adapters/__tests__/` | a vendor dropping a field |
| Query-plan assertions | `supabase/tests/plans.sql` | a board that got slow as it got popular |
| Frozen match regression | `apps/pipeline/eval/match/` | a threshold change lowering precision |

**Not tested, on purpose.** No React rendering — no jsdom, no Testing Library, no snapshot
files. A snapshot asserts that today's markup equals today's markup: it fails on every
legitimate change and teaches the team to run `-u`. UI correctness here is *which*
component renders, decided by `primaryAction()` and the `BuyableCoin` type, both tested
above the component. No mocked Supabase client — every rule worth testing is a constraint
the mock does not have. No coverage threshold. No browser E2E (§9.6). No tests over
`app/`: a 40-line routing manifest has no logic in scope to test.

`packages/config/vitest.base.ts` sets `environment: 'node'` (never jsdom — nothing under
test has a DOM), `fakeTimers: { toFake: [] }` (a `model/` test needing timers has a clock
in it, which lint already forbids), and two projects so `vitest --project invariant`
— every test whose name starts `INVARIANT` — runs as its own CI step rather than as one
line among four hundred passes.

`scripts/check-model-tests.mjs` globs `{apps,packages}/**/model/*.ts`, fails on any file
without a sibling `__tests__/<name>.test.ts`, and **fails first if the glob returns fewer
than 30 files** — the same defect class as the `totalCruised` floor on dependency-cruiser.
A gate that goes green on an empty result set is worse than no gate, because it is
believed.

### 9.2 The correctness-critical set

Tagged `INVARIANT`. These are the tests that stop money being lost.

**1. The primary-action resolver.** Two tests, closing different holes: a table test over
behaviour, and a type test over *reachability*.

```ts
// packages/contracts/src/__tests__/action.test.ts
import { primaryAction } from '../action';
import { toCoinMatch } from '../match';

const NOW = 1_800_000_000_000 as Instant;
const [M, N] = ['So1111…112', 'Stake1…111'] as MintAddress[];
const safe = { pass: true, checkedAt: NOW } as const;
const bad = { pass: false, failingGate: 'mint_authority', checkedAt: NOW } as const;
const M_SAFE = new Map([[M, safe], [N, safe]]);

// row() is a confirmed, derived, cashtag-sourced match with two strong channels.
// go() applies primaryAction to a normal-coinability story with no matches.
const ms = (...r: CoinMatchRow[]) => ({ matches: r.map(toCoinMatch), safety: M_SAFE });

describe('INVARIANT primaryAction', () => {
  test.each([
    ['no matches',                    {},                                      'create'],
    ['one confirmed + safe',          ms(row()),                               'buy'],
    // Absent from the safety map is UNKNOWN, and unknown fails closed.
    ['confirmed, never safety-checked', { matches: [toCoinMatch(row())] },     'view'],
    ['confirmed, a gate failed',      { ...ms(row()), safety: new Map([[M, bad]]) },
                                                                               'view'],
    // Safe-but-unsure is still not buyable. Abstain never routes to Buy.
    ['two unsure, zero confirmed',    ms(row({ verdict: 'unsure' }),
                                         row({ mint: N, verdict: 'unsure' })), 'create'],
    ['one confirmed + one unsure',    ms(row(), row({ mint: N, verdict: 'unsure' })),
                                                                               'buy'],
    ['two confirmed + safe',          ms(row(), row({ mint: N })),             'multi'],
    ['no_create, zero confirmed',     { coinability: 'no_create' },            'none'],
    // Existing coins trade even where minting a new one is forbidden.
    ['no_create, one confirmed safe', { ...ms(row()), coinability: 'no_create' }, 'buy'],
  ] as const)('%s -> %s', (_, i, kind) => expect(go(i).kind).toBe(kind));

  test('adopted + safe -> buy, relation preserved for the ADOPTED chip', () => {
    const a = go(ms(row({ relation: 'adopted',
                          mint_time: NOW - 604 * 86_400_000 })));
    expect(a.kind === 'buy' && a.coin.relation).toBe('adopted');
  });

  // THE DELETED BUG. lib/stories.ts's tradeable() required a non-null mcap, so a
  // four-minute-old mint flipped back to Create and drove a duplicate launch in
  // the exact window this product exists to serve. This asserts the SHAPE of the
  // input, because that is what makes the bug unwritable rather than absent.
  test('no market field can ever reach the resolver', () =>
    expect(Object.keys(SAMPLE_INPUT)).toEqual(
      ['storyId', 'coinability', 'matches', 'safety']));

  // The cases above test what we thought of; this tests the rule: over 5 000
  // generated inputs, every coin in a 'buy' or 'multi' action must trace to a
  // confirmed match whose safety entry has pass === true.
  test('buyable implies confirmed AND pass===true', () =>
    forAll(generateInputs(5_000), assertBuyableIsConfirmedAndSafe));
});
```

```ts
// packages/contracts/src/__typetests__/action.test-d.ts — compile-only.
// Descriptions, never literal TSxxxx codes: those are not a stable API.
import { BuyButton } from '@features/trading';

declare const raw: CoinMatchRow; declare const unsure: UnsureCandidate;
declare const confirmedOnly: ConfirmedCoin; declare const buyable: BuyableCoin;

// @ts-expect-error a raw database row is not a BuyableCoin
BuyButton({ coin: raw, size: 'row', feeBps: 50 });
// @ts-expect-error an abstained candidate can never reach the Buy button
BuyButton({ coin: unsure, size: 'row', feeBps: 50 });
// @ts-expect-error identity confirmed is not permission to buy: SAFE_TO_BUY missing
BuyButton({ coin: confirmedOnly, size: 'row', feeBps: 50 });
BuyButton({ coin: buyable, size: 'row', feeBps: 50 });          // the only legal call
```

**2. The coin-match gates and the abstain band.** The gate function mirrors
`coin_match_confirmed_requires_evidence` and `public.confirmable()`.

```ts
// apps/pipeline/src/stages/resolve-coins/__tests__/gates.test.ts
import { describe, expect, test } from 'vitest';
import { classifyMatch, confirmable } from '../model/gates';

describe('INVARIANT match gates', () => {
  const base = { score: 0.93, tickerSource: 'cashtag', relation: 'derived',
                 mintTime: 1_800_000_000_000, s: { mintInPost: null, img: 0.71,
                 text: 0.62, tick: null, social: null } } as const;

  const v = (o = {}) => classifyMatch({ ...base, ...o }).verdict;

  test('two strong channels confirm', () => expect(v()).toBe('confirmed'));

  test('ONE strong channel never confirms, at any score', () => {
    for (const score of [0.80, 0.90, 0.99, 1.0]) {
      expect(v({ score, s: { ...base.s, text: 0.20 } })).toBe('unsure');
    }
  });

  // mint_in_post alone confirms at >= 0.90; s_social alone never does, being
  // attacker-controlled metadata capped at 0.85 by CHECK.
  test.each([['mintInPost', 0.95, 'confirmed'], ['social', 0.85, 'unsure']])(
    '%s alone -> %s', (k, x, want) => expect(v(onlyChannel(k, x))).toBe(want));

  test.each([
    ['an llm ticker, at any evidence', { score: 1.0, tickerSource: 'llm' }],
    ['unknown mint_time, which fails CLOSED', { mintTime: null }],
    ['relation=mentioned, which is candidate generation', { relation: 'mentioned' }],
  ])('%s cannot confirm', (_, o) => expect(v(o)).toBe('unsure'));

  test('the abstain band is a range, not a point', () => {
    expect(v({ score: 0.79 })).toBe('unsure');      // below confirm, above reject
    expect(v({ score: 0.35 })).toBe('unsure');
    expect(v({ score: 0.34 })).toBe('rejected');
  });
});
```

Parity with SQL is the other half: `confirmable-parity.test.ts` pushes the Cartesian
product of `[null, 0, 0.54, 0.55, 0.60, 0.89, 0.90, 1.0]` over the four channels through
`public.confirmable()` in one `unnest` query and asserts the TypeScript predicate agrees
on all 4 096 rows. It needs Postgres, so it runs in the `invariants` job.

**3. Velocity and acceleration.** The continuous-time EWMA over the irregular
4/9/14/21/30/42/58/78-minute grid is the arithmetic the whole posts board rests on.

```ts
// apps/pipeline/src/stages/snapshot/__tests__/velocity.test.ts
import { describe, expect, test } from 'vitest';
import { accumulate, burstOf, EMPTY } from '../model/velocity';

const min = (n: number) => n * 60_000;

describe('INVARIANT velocity', () => {
  // The old velocity.js returned 0 here, ranking a brand-new post as dead.
  // ACCEL renders an em dash on one snapshot, never a fabricated 1.0x.
  test('one snapshot -> no rate, no burst, ticks=1', () => {
    const s = accumulate(EMPTY, { capturedAt: 0, views: 1_200 });
    expect(s.ticksQualified).toBe(1);
    expect(burstOf(s)).toEqual({ state: 'not_yet', note: 'needs 2 snapshots' });
  });

  // Constant arrival over IRREGULAR intervals must converge to burst 1.0. The
  // discrete form `alpha*x + (1-alpha)*S` does not: it weights every sample
  // equally regardless of the gap, biasing hot-tier posts upward by construction.
  test('constant rate on the geometric grid converges to burst ~1', () => {
    const grid = [4, 9, 14, 21, 30, 42, 58, 78].map(min);
    let s = EMPTY, views = 0, prev = 0;
    for (const t of grid) {
      views += 800 * ((t - prev) / 60_000);            // exactly 800 views/min
      prev = t;
      s = accumulate(s, { capturedAt: t, views });
    }
    const b = burstOf(s);
    expect(b.state).toBe('known');
    if (b.state === 'known') expect(Math.abs(b.value - 1)).toBeLessThan(0.02);
  });

});
```

**4. Lead time.** Seven render branches; the two nobody writes are negative and a missing
clock reading.

```ts
// packages/contracts/src/__tests__/lead.test.ts
import { describe, expect, test } from 'vitest';
import { leadTime } from '../lead';

const P = 1_800_000_000_000 as Instant;
const at = (m: number) => (P + m * 60_000) as Instant;
const clock = (o = {}) => ({ promotedAt: P, tMint: null, tCt: null,
  unmeasurable: false, promotedAtBackfilled: false, ...o });

describe('INVARIANT leadTime', () => {
  test.each([
    // t_crypto = min(t_mint, t_ct), from whichever side wins.
    [{ tMint: at(31), tCt: at(44) }, { kind: 'early', minutes: 31 }],
    [{ tMint: at(44), tCt: at(31) }, { kind: 'early', minutes: 31 }],
    // ~A THIRD of real detections are late. The number that proves the claim has
    // to render its own failure.
    [{ tCt: at(-7) },                { kind: 'late',  minutes: -7 }],
    [{ tCt: at(1) },                 { kind: 'tie',   minutes: 1 }],
    [{ tCt: at(-1) },                { kind: 'tie',   minutes: -1 }],
    // ONE reading is enough — min() over a single value. The old build had no
    // branch here at all and produced nothing.
    [{ tMint: at(18) },              { kind: 'early', minutes: 18 }],
  ])('%o -> %o', (c, expected) => expect(leadTime(clock(c))).toEqual(expected));

  // NEITHER clock: "+2h14m and counting". Never 0, never early, never a number.
  test('no clock reading at all -> open, and no minutes field exists', () => {
    const r = leadTime(clock({}), at(134));
    expect(r).toEqual({ kind: 'open', sinceMinutes: 134 });
    expect(r).not.toHaveProperty('minutes');
  });

  test('unmeasurable and backfilled are suppressed, never estimated', () => {
    expect(leadTime(clock({ tCt: at(31), unmeasurable: true })).kind).toBe('unmeasurable');
    expect(leadTime(clock({ tCt: at(31), promotedAtBackfilled: true })).kind)
      .toBe('suppressed');
  });
});
```

**5. The safety normaliser.** The old `api/safety.js` read `raw.mintAuthority` off
`/report/summary`, whose schema (`error, lpLockedPct, mint, risks, score,
score_normalised, tokenProgram, tokenType`) has **no authority fields at all**, then wrote
`mintRevoked: mintAuthority == null ? true : false`. Every token was reported mint- and
freeze-revoked; reproduced live on USDC, whose authorities are demonstrably active.

```ts
// apps/pipeline/src/stages/resolve-coins/__tests__/safety.test.ts
import { normaliseRugcheck } from '../model/safety';
import summaryShape from '../../../adapters/__fixtures__/rugcheck.summary.json';
import fullReport   from '../../../adapters/__fixtures__/rugcheck.report.bonding.json';

describe('INVARIANT safety normaliser', () => {
  // THE REGRESSION. A response with no authority fields yields 'unknown', which
  // fails closed at intrinsic_gate_pass. It must NEVER yield 'revoked'.
  test('a response carrying no authority fields is unknown, not revoked', () => {
    const s = normaliseRugcheck(summaryShape);       // the WRONG endpoint's shape
    expect([s.mint_authority, s.freeze_authority]).toEqual(['unknown', 'unknown']);
    expect(s.signals_checked).toBe(0);
  });

  test('present authorities are read literally, both ways', () => {
    expect(normaliseRugcheck({ ...fullReport, mintAuthority: 'BJE5MM…' })
      .mint_authority).toBe('active');
    expect(normaliseRugcheck({ ...fullReport, mintAuthority: null })
      .mint_authority).toBe('revoked');    // explicit null, FULL report only
  });

  // Raw top-10 on a normal fresh token is 67.89% because the pump.fun curve is
  // holder #1 at 46.73%, labelled {type:'AMM'} in RugCheck's own knownAccounts.
  test('top10 excludes AMM and LOCKER holders and sets the flag', () => {
    const s = normaliseRugcheck(fullReport);
    expect(s.curve_pda_excluded).toBe(true);
    expect(s.top10_pct).toBeLessThan(40);
  });

});
```

⚠ **Mark for verification.** RugCheck's exact field names on
`GET /v1/tokens/{mint}/report` — `mintAuthority`, `freezeAuthority`,
`knownAccounts[].type`, `topHolders[].pct`, `transferFee` — and whether
`topHoldersPercentage` already nets out the curve PDA. The fixture is one recorded live
call and the zod schema is derived from it; both want a re-fetch before the RISK column
ships. Open item 8 in §10 is the same question.

**6. Every formatter that can turn missing data into a plausible number.** A registry, one
property test, and a script keeping the registry exhaustive.

```ts
// packages/contracts/src/__tests__/pending.test.ts
import { FORMATTERS } from '../format-registry';   // name -> (p) => PendingRender
import { awaiting, known, notYet, unobtainable, windowChange } from '../pending';

const ABSENT = [unobtainable('no_mint_time'), unobtainable('vendor_error'),
                unobtainable('vendor_absent'), notYet('coin is 41m old'), awaiting()];

describe('INVARIANT absent never renders as a number', () => {
  for (const [name, fmt] of Object.entries(FORMATTERS)) {
    for (const p of ABSENT) {
      test(`${name} + ${p.state}`, () => {
        const r = fmt(p);
        expect(['—', '··']).toContain(r.text);
        expect(r.text).not.toMatch(/\d/);   // no 0, no 0.0%, no $0.00, no 0m
        expect(r.tone).toBe('dim');
      });
    }
  }

  test('a window longer than the coin age is not_yet, never 0.0%', () =>
    expect(windowChange(known(0.4), 1440, known(41)))
      .toMatchObject({ state: 'not_yet', note: 'coin is 41m old' }));
});
```

`scripts/check-formatters.mjs` asserts that every exported function in `shared/format`
returning `PendingRender` appears in `FORMATTERS`. That is what makes this a property
rather than a property test: a formatter written next month is covered the day it lands.

**7. The retry classifier.** The pipeline died silently for two days because the retry
helper retried only on HTTP 429; a 402 threw and vanished. `errors.test.ts` is a
`test.each` over `[429 → vendor_429, retryable]`, `[402 → vendor_402, terminal]`,
`[401/403 → vendor_auth, terminal]`, `[500/503 → vendor_5xx, retryable]`, plus three
assertions that carry the weight: an unrecognised error classifies `internal`, retryable
**and** paging; a `23514` classifies `constraint_violation` at `warn` with the constraint
name in `detail`, because a refused row is the schema working; and every
`StageErrorCode` is reachable from some input, since a code nobody can produce is a code
nobody has implemented.

### 9.3 The frozen regression set

**What it is.** `apps/pipeline/eval/match/pairs.jsonl` — 400 hand-labelled (story, mint)
pairs, one JSON object per line, each carrying the five channel scores, `relation`,
`ticker_source`, `mint_time − earliest_post_at`, a `stratum` and a boolean `label`. Same
shape as `match_label` (§3.7), which is what lets it grow itself: the matcher writes every
confirmed and unsure decision there with its feature vector.

**How it is built.** Seeded from the incidents — the real `$KANG` (LLM-invented ticker),
`$PUMP` (generic-ticker collision) and `GYATT` (604-day-old shell adopted as derived) —
then stratified to 400, because an unstratified sample is 85% easy positives and a
threshold change moves precision by 0.002 on it:

| Stratum | n | Why |
|---|---|---|
| `easy_positive` | 120 | the baseline; a regression here is catastrophic |
| `hard_positive` | 60 | transformed image, cropped meme, ticker drift |
| `ticker_collision` | 60 | two live coins share a symbol |
| `generic_ticker` | 40 | `$MOON`, `$PEPE` — the denylist's job |
| `adopted_shell` | 40 | old mints attaching to a new story |
| `llm_invented` | 40 | provenance, the $KANG class |
| `near_miss` | 40 | genuinely ambiguous; these SHOULD abstain |

**What it blocks.** `npm run test:match-regression` fails the build on precision below
**0.970**, an abstain rate outside **0.15–0.30**, or any `llm_invented` or `adopted_shell`
pair reaching `confirmed`. Precision is what D1 commits to, so it is a failing test and not
a dashboard; the band is two-sided because an abstain rate that *drops* is the matcher
getting bolder, which is how precision is lost.

```ts
// apps/pipeline/eval/match/__tests__/regression.test.ts
test('INVARIANT match precision >= 0.970 on the frozen set', () => {
  expect(pairs.length).toBeGreaterThanOrEqual(400);        // the set cannot shrink
  const d = pairs.map((p) => ({ ...p, verdict: classifyMatch(p.features).verdict }));
  const yes = d.filter((x) => x.verdict === 'confirmed');
  const maybe = d.filter((x) => x.verdict === 'unsure');

  expect(yes.filter((x) => x.label).length / yes.length).toBeGreaterThanOrEqual(0.970);
  expect(maybe.length / (yes.length + maybe.length)).toBeGreaterThanOrEqual(0.15);
  expect(maybe.length / (yes.length + maybe.length)).toBeLessThanOrEqual(0.30);
  // Per-stratum, because an aggregate hides the strata that cost money.
  for (const st of ['llm_invented', 'adopted_shell'] as const) {
    expect(yes.filter((x) => x.stratum === st)).toHaveLength(0);
  }
  writeFileSync('eval-report.json', report(d));            // -> PR comment
});
```

**How it evolves.** Pairs are appended, never edited or deleted — a wrong label gets
`label_corrected_at` and a note, so the diff shows a human changing the truth rather than
the test. `matcher_version` bumps in the same PR as any threshold change, and the PR body
carries the before/after table from `eval-report.json`. Two hundred pairs is too few to
move precision; a thousand is more labelling than this team will sustain. Four hundred,
growing ~40/month from `match_label`, puts the interval on 0.97 at about ±0.017 — tight
enough to see a real regression, loose enough that noise does not block merges. ⚠ That
interval is binomial arithmetic, not a measurement; re-derive it once the set is real.

### 9.4 Testing the LLM stages

Meme scoring, coinability, titling and cluster adjudication are non-deterministic. The
line: **the plumbing is tested, the judgement is measured.**

*Deterministically testable in CI:* **the parse** — output goes through a zod schema, and
a response missing `coinability_tier` is `vendor_contract`, terminal, paging, never a
default; tested against six recorded malformed responses (truncated JSON, prose before the
JSON, an unknown tier, a null score, a score of `1.5`, an empty body). **The clamps** — a
`meme_score` outside 0–1 is rejected, not clipped; an unrecognised tier maps to `never`,
matching the column default. **The prompt builder** — pure and in `model/`, so a
golden-file test turns an accidental prompt edit into a reviewable diff. **The budget
path** — a `reserve_units()` false return stops the stage rather than falling through to
an unmetered call.

*Only measurable*, nightly, against a frozen panel of 60 human-labelled posts in
`apps/pipeline/eval/score/panel.jsonl`. Three signals detect a prompt regression, none a
string comparison. **Rank correlation, not values:** Spearman ρ between the run's
`meme_score` ordering and the frozen human ordering, alerting below **0.80** — absolute
scores drift with model versions, and the *ordering* is what the board consumes.
**Distribution drift:** Population Stability Index on the coinability histogram against
the 30-day baseline, paging above 0.25, because a prompt edit quietly reclassifying 8% of
stories `normal → no_create` empties the Create funnel and raises no error. **The safety
floor, which is a hard assertion:** twelve panel posts must classify `never` — a named
private individual, a death, violence, minors — and one of them scoring `normal` fails the
job and pages. That is the only place LLM output gets an equality assertion, because D3 is
a commitment, not a metric. Every run pins `model_id` and `sha256(prompt)` into
`ops_event`, so "did the prompt change or did the model change" is already answered.

### 9.5 Integration tests

**What genuinely needs Postgres:** every CHECK constraint, every generated column
(`intrinsic_gate_pass`, `lead_time_min`, `band`, `channels_ran`), every trigger
(`freeze_columns`, `recount_story_coins`, `story_clock_copy_promoted_at`,
`promote_launch`), RLS policies, column grants, and the four hot query plans — none of
which can be tested against a mock, because they *are* the database.

**The container is specified and must not change casually:** `supabase/postgres:17.6.1.156`,
pinned by exact tag, `POSTGRES_DB: postgres`. Not stock Postgres — `0011` grants to `anon`
and `authenticated`, which only this image's init scripts create — and not
`pgvector/pgvector`. Health-check over TCP, not the unix socket: the image runs ~60 platform
migrations with `listen_addresses=''`, so a socket probe goes green before 5432 exists.

**Fixture strategy, and what makes it fast.** Migrating and seeding takes ~25 s; doing that
per test file is how an integration suite becomes a thing people skip. So it happens once:
CI marks the seeded database `datistemplate = true`, and `apps/pipeline/src/test/db.ts`
exposes `freshDb()`, which issues `CREATE DATABASE t_<uuid> TEMPLATE seeded` (~180 ms, a
file copy), returns a pool and drops it in `onTestFinished`. Per-file isolation beats one
shared database in a rolled-back transaction, because half of what we test *is*
transactional: deferred constraints, trigger firing order, `SECURITY DEFINER` functions
taking their own locks. A test that cannot commit cannot test a commit.

Fixtures are the committed seed — `00_fixtures.sql` captured from staging through a column
allowlist, plus nine hand-written scenario files, never captured and never deleted:
negative lead time, NULL `mint_time`, an unsure match with three candidates, a coin with
no snapshots, a tier-`never` story. Generated data contains none of those shapes, which is
precisely why they are the ones that break the product.

### 9.6 What replaces end-to-end

Full E2E against a live wallet and a live chain is not viable: real SOL, a funded key in
CI, mainnet latency, flakiness unrelated to our code. Four things replace it, and between
them they cover more of the buy flow than a browser suite would.

**1. The trade state machine as a pure model.** `trading/model/tx-state.ts` holds
`ORDERING → SIGNED → SUBMITTED → LANDED | FAILED | EXPIRED | LOST_CONTACT`, and every
transition including every illegal one is a table test. The states that hurt users — still
confirming, lost contact, reverted after a fill — are unreachable in a happy-path browser
test and trivial here.

**2. Route handlers invoked directly.** A Next route handler is `(req: Request) =>
Response`. Tests import `POST` from `@server/trading` and call it with a constructed
`Request` against a seeded database and a stubbed Jupiter adapter — no browser, no server,
no port. That covers the request-id uniqueness guard (a duplicate submission is a **409**,
never a second fill), the server-side fee re-assertion, and `referralAccount` coming from
env rather than the client.

**3. `TRADING_MODE=simulate` everywhere but production**, which
`env_live_trading_is_production_only` makes structural rather than configured. In simulate
the Jupiter adapter replays recorded order responses and signing is a no-op, so the whole
flow — board click, recap rows, `trade` row — runs in CI on real data shapes.

**4. Two live probes, outside the merge path.** A **nightly vendor contract probe** hits
Jupiter, RugCheck, DexScreener and Helius once each and parses each response through the
adapter's own zod schema; a parse failure is `vendor_contract` and pages. That is what
catches an endpoint quietly dropping a field — the failure mode behind the safety defect,
which no browser test would have caught either. And a daily **canary trade** on staging:
a burner wallet buys and immediately sells ~0.005 SOL of a liquid mint, asserting the
transaction lands and that `trade`/`holding` agree with the chain. It is the only thing
proving signing and submission still work end to end. ⚠ Measure cost and slippage on that
pair first.

### 9.7 The first ten tests

If only ten are ever written, these ten. Ranked by *money lost if absent*, not by ease.

1. **`action.test.ts` — the resolver table (§9.2.1).** Buy on exactly one confirmed *and
   safe* coin; never on unsure; never suppressed by absent market data. Every surface
   routes through it, so one test protects seven screens.
2. **`invariants.sql` — a confirmed match with one strong channel is rejected.**
   `verdict='confirmed'`, `score=0.91`, `s_img=0.80`, the rest NULL must raise
   `coin_match_confirmed_requires_evidence`. Then two strong channels accepted, and
   `story.confirmed_coin_count` becomes 1 — proving the recount trigger fired.
3. **`safety.test.ts` — a response with no authority fields yields `unknown`.** The exact
   shipped defect, in twelve lines.
4. **`invariants.sql` — an LLM ticker cannot carry a mint.** `source='llm'` with a
   `resolved_mint` raises `story_ticker_llm_never_resolves`; an insert omitting `source`
   raises a not-null violation. The second half is the point: provenance is not optional.
5. **`pending.test.ts` — absent never renders as a number.** The registry property test,
   which closes `if (!pair.pairCreatedAt) return 0` for every formatter at once — including
   the ones not written yet.
6. **`invariants.sql` — `promoted_at` cannot be moved.** Two statements encoding the
   whole earliness claim: the UPDATE raises, any other column on that row updates fine.
7. **`errors.test.ts` — `classify` is total, and 402 is terminal.** The two-day silent
   outage as a table test, including: an unmodelled error is `internal` and pages.
8. **`velocity.test.ts` — one snapshot yields no rate; constant rate on the irregular grid
   gives burst ≈ 1.** The two arithmetic errors that make the board wrong while it looks
   right.
9. **`lead.test.ts` — negative and open.** `−7` renders as late at identical weight; no
   clock reading renders `open`, never `0`.
10. **`regression.test.ts` — precision ≥ 0.970, abstain in 0.15–0.30.** Last only because
    it needs 400 labelled pairs first. It keeps the other nine honest when someone tunes a
    threshold to lift coverage.

Tests 1, 3, 5, 7, 8 and 9 need no database and no network; tests 2, 4 and 6 are three
`pg_temp.rejects()` calls in a file that already exists. The whole list is under a day of
work, and it is the difference between this build and the last one.
