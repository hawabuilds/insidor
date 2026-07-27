# INSIDOR — END-TO-END SYSTEM DESIGN
**One proposal. Decisive. Corrected against the adversarial pass.**

> **Read this first.** The adversarial review knocked down 10 of 12 load-bearing claims from the research. Four of the knock-downs change the architecture materially: the cheap author firehose does not exist, the ranking base is wrong, the realtime transport recommendation is backwards, and temporal ordering is the *strongest* coin-matching signal rather than the weakest. This document is the corrected design, not the research restated. Where I keep something the research got wrong, I say so. Where something is a bet, it is labelled **BET**.

---

## 1. THE SYSTEM IN ONE PAGE

A post becomes a story becomes a coin becomes a trade through eleven named stages. Nine are cheap and fast; two are where the product's whole claim is spent.

```
X / TikTok publish
   │
 ① ARRIVE      bytes in our process
   │
 ② ADMIT       zero-cost arrival prior, ~30% pass
   │
 ③ TRACK       geometric snapshot grid (τ = 4, 9, 14, 21, 30, 42, 58, 78 min)
   │
 ④ TRIGGER     kinetics gate crosses threshold  ← earliest possible alert
   │
 ⑤ QUALIFY     coinability / safety classifier (Haiku)
   │
 ⑥ CLUSTER     join a story, or open a provisional one
   │
 ⑦ PROMOTE     quorum met → story becomes display-eligible  ← promoted_at is set HERE, once, forever
   │
 ⑧ NAME        one structured-output call: title + blurb + subject + coinability + ticker candidates
   │
 ⑨ RESOLVE     story ⇄ mint matching, runs continuously against the mint stream
   │
 ⑩ RANK        board score recompute + committed rank tick
   │
 ⑪ DELIVER     change-driven broadcast to connected clients
```

### Latency budget, per hop

| # | Stage | p50 | p90 | Notes |
|---|---|---|---|---|
| ① | ARRIVE — roster Stream (author ≥5k followers) | 1–5 s | 15 s | Only path with sub-second delivery |
| ① | ARRIVE — filter rules (polled saved-search) | interval/2 | interval | **Not push.** `interval_seconds` min 0.05, default 60 |
| ① | ARRIVE — floor-search recall net | 90 s | 240 s | 3-min cycle, 6-min lookback window |
| ② | ADMIT | 40 ms | 120 ms | Pure compute, no API, no LLM |
| ③ | TRACK — first useful observation | τ = 4 min | τ = 4 min | Hard floor set by physics, not engineering |
| ④ | TRIGGER — earliest decision | τ = 9 min | τ = 14 min | Two observations minimum before any rate is meaningful |
| ⑤ | QUALIFY | 1.4 s | 4 s | Haiku, ~900 calls/day |
| ⑥ | CLUSTER | 20 s | 50 s | 45-second micro-batch cycle |
| ⑦ | **PROMOTE** | **0 s** | **8 min** | **The variable hop. This is where lead time is spent.** |
| ⑧ | NAME | 2 s | 6 s | Haiku; Sonnet for top-50/day by views |
| ⑨ | RESOLVE | 5 s | 30 s | Runs against a pre-populated mint index, not a search |
| ⑩ | RANK | 10 s | 20 s | 20-second rank-commit tick |
| ⑪ | DELIVER | 60 ms | 250 ms | Supabase Broadcast |

**End-to-end SLOs, stated separately because they are different problems:**

- **Discovery latency** (post published → visible on board): **p50 < 12 min, p90 < 22 min.** Dominated by stage ③④ (τ=9 min floor) and stage ⑦ (quorum wait). This is *not* a transport problem and cannot be fixed by faster infrastructure.
- **Update latency** (a number changes in the DB → pixel changes): **p50 < 400 ms, p90 < 1.5 s.**
- **Lead time** (promoted_at → t_crypto): the product claim. Target median **> 20 min**, measured, published with misses.

**The single most important structural fact:** the earliness claim is not made at stage ①. It is made at stage ⑦, and it is measured from `promoted_at`. Stage ① buys you 20–60 minutes over an engagement-threshold competitor; stages ③④⑦ spend 9–20 of those minutes back. The design is a fight to spend as few as possible without shipping false positives that cost users money.

**Two clocks run in parallel and independent of the pipeline**, because the earliness proof must be prospective:

- **Clock A** — PumpPortal `subscribeNewToken` websocket → every Solana mint into `coin_mints`. Free, ~21–42k/day, one connection only.
- **Clock B** — a ~300-account crypto-Twitter list polled every 2 min → `ct_mentions` inverted index. ~$34/mo.

`t_crypto = min(t_mint, t_ct)`. Both indexes are written *before* any alert. A retrospective search would have lookahead bias and would make the headline number a lie.

---

## 2. DETECTION — THE SENSOR

### 2.1 What changed, and why

The research's central proposal — a 12,000-account real-time author firehose at **$4.50/day** via twitterapi.io websocket filter rules — **does not exist as described.** Verified against primary sources:

1. **Filter rules are polled saved-searches, not a push stream.** `add_rule` takes a required `interval_seconds` (min 0.05, max 86400, default 60). Matches arrive batched in the standard lane as `event_type: "tweet"`.
2. **The sub-second path (`fast_tweet`) is a different, paid product** — the per-account Stream subscription — and only fires for authors with **≥5,000 followers**. A brand-new dev account posting about a token it just minted has *no* low-latency path by design.
3. **`Add User to Monitor` is a monthly per-account subscription**, not per-post billing: Scale is **$999/mo for 2,000 accounts, +$0.50/account** beyond. A 12,000-account roster is **~$5,999/month fixed**, not $135/month.
4. **Rule packing is 33% worse than budgeted.** At realistic ~11-char handles, `from:handle OR ` costs ~20 chars against a 255-char `value` cap → ~12 handles/rule, so ~1,000 rules for 12k handles, not 750.
5. **Max rules per account is genuinely undocumented.** And the *real* unknown is whether an active rule incurs the $0.00015 per-call minimum on **every** `interval_seconds` evaluation. At 1,000 rules polled every second that is ~$12,960/day. At the 60s default it is ~$216/day before a single post is delivered.

**Recommendation: a three-tier sensor, sized to what the vendor actually sells.**

| Tier | What | Latency | Cost | Job |
|---|---|---|---|---|
| **A — Stream** | ~500 hand-curated accounts on the per-account Stream subscription (Enterprise Plus $499/mo, 500 accounts, +$1 each) | 1–5 s for ≥5k-follower authors | **$499/mo** | The earliness edge on known amplifiers |
| **B — Filter rules** | ~2,000 second-tier accounts packed into ~170 rules at `interval_seconds = 60` | ~30 s median | **Unknown until the billing test** — $0 to $216/day | Bulk backfill of the long tail |
| **C — Floor search** | `min_faves:15`, 6-min window, every 3 min, existing `ingest-floors.js` controller retuned (FLOOR_MIN 300 → 15, recencyMin 60 → 6) | 90 s median | ~$3/day | Off-roster recall net **and** the only path that can catch an unknown account |

**Tier C is now load-bearing, not a safety net.** No roster of any size covers the cold-start case — a brand-new account, minted-token dev wallet, or sub-5k-follower first-mover. The Stream takes ~20 minutes to activate a newly added account. Accept this: roster-based detection is structurally retrospective on the *account* dimension. Tier C plus the PumpPortal mint stream are the only paths that see genuinely new actors.

**BET:** that Tier A on ~500 accounts buys enough earliness to justify $499/mo. This is unproven and must be validated by a 3-week shadow run measuring lead time on the same ledger against the current pipeline. Do not cut over on architectural conviction.

### 2.2 Roster composition and recruitment

- **500 Tier-A seats**, all ≥5,000 followers (below that the Stream gives you nothing the filter rules don't). Meme accounts, sports/culture reply guys, regional news breakers, clip accounts, niche-community anchors. **Explicitly not crypto accounts** — those go in the CT list and are the thing we are trying to beat.
- **~2,000 Tier-B handles**, no follower requirement.
- **Weekly recruitment** via Early Amplifier Score on retweeter sets of winners:

```
EAS(u) = Σ_{winners w reshared by u} 1 / (1 + rank_u(w))
         ────────────────────────────────────────────────
              ln(1 + total_reshares_by_u_this_week)
```

Promote top 20/week into Tier A (evicting bottom 20 by 30-day contribution), top 150/week into Tier B. Fixed-size, self-tuning. This is the mechanism that makes the sensor improve rather than decay.

### 2.3 Sampling schedule

Geometric in age, ratio ≈1.5, promotion-gated. Batched via `/twitter/tweets?tweet_ids=` (100/call, billed per tweet returned — `worker/lib/budget.js` already handles this correctly).

| Tier | Checks at τ (min) | Volume/day | Promotion rule |
|---|---|---|---|
| **0 — Arrival** | none (0 API cost) | ~30,000 | `P0 ≥ 1.0` → probation |
| **P — Probation** | 4, 9 | ~9,000 posts | at τ=9: `rate_LCB ≥ floor` **AND** `R ≥ 3` |
| **A — Candidate** | 14, 21, 30, 42, 58, 78 | ~900 posts | `S ≥ θ` → tracked; drop at τ=30 if decaying |
| **B — Tracked** | 12 min → 30 min → 120 min | ~120 stories | until lifecycle == DEAD |

Arrival prior (zero cost, computed from the stream payload alone):

```
P0 = 0.9·[author_in_roster] + 0.6·[has_media] + 0.5·[len ≤ 140]
   + 0.7·[named_entity_extracted]
   − 1.2·[engagement_bait_regex] − 1.0·[thread_continuation]
   − 0.8·[perceptual_hash_seen_in_30d]
```

Tune the constant weekly so admits ≈ 9,000/day.

**Budget reconciliation:** if projected spend for the next hour exceeds allocation, drop the *lowest* tier first (B before A before P). Never starve probation — that is where earliness is made.

### 2.4 The kinetics math — corrected

The research proposed a per-author z-score `z_a = (log1p(E) − β̂_a − γ·ln τ) / σ_eff` with a single per-author σ. **This is mis-specified in three ways that matter at τ ≈ 9 min:**

1. **The variance axis is wrong.** Szabó & Huberman's homoskedasticity is with respect to *popularity level* at a fixed observation pair, and σ is re-estimated per pair. At τ=9 min the residual spread is driven by expected count, not age: under Poisson/NB noise `σ_log ≈ 1/√μ`, and μ spans 2–3 orders of magnitude across authors at that single τ. A σ table indexed by τ cannot flatten that. You would build it, find the spread varies across authors rather than ages, and rebuild.
2. **Zeros.** At 9 minutes, weighted engagement is 0–3 for most non-top-tier authors. `log1p` biases β̂_a downward in a level-dependent way, systematically inflating z for low-baseline accounts — a structural false-positive generator aimed precisely at small accounts.
3. **The denominator ignores estimation error.** σ̂_a must be `sqrt(σ²_within(μ) + Var(β̂_a) + between-post variance)`. For a thin-history author, `Var(β̂_a)` dominates and the "signal" is mostly *how little you know about that author*.

**What to build instead.**

**(a) Shrunk arrival-rate lower bound — the gate.** Gamma-Poisson posterior on reshare arrival rate, with the prior supplying cold-start:

```
λ | data  ~  Gamma(a₀ + R(t),  b₀ + t)
rate_LCB   =  Gamma⁻¹(0.10 ; a₀ + R(t), b₀ + t)
```

`(a₀, b₀)` come from the author's follower-decile bucket. This does three jobs at once: kills the 3→30-reshares false positive, prices in bought engagement, and **the prior *is* the cold-start answer** for an author with no history.

**(b) Baseline-relative burst — the ranking signal.** Continuous-time EWMA (a discrete `α·x + (1−α)·S` is *wrong* under the 4/9/14/21… irregular grid and biases hot-tier posts upward by construction):

```
S ← S·exp(−Δt/τ) + (1 − exp(−Δt/τ))·(ΔR/Δt)

burst = S_fast / max(S_slow, ε)     τ_fast = 20 min,  τ_slow = 6 h
```

`burst` is scale-free — a 300-follower spike can beat a 500k-follower account's baseline traffic — and it is the one thing an HN-shaped score provably cannot do: detect a **second wave**.

**(c) Author-relative outlier, as a negative-binomial GLM.** Fit `log μ = β_a + γ·ln τ` with a per-author intercept shrunk toward the follower-bucket prior with weight `n_a/(n_a + 10)`, and derive σ from the fitted μ and dispersion φ:

```
z_rel = (log1p(E) − (β̂_a + γ·ln τ)) / sqrt(1/μ̂ + φ̂ + Var(β̂_a))
```

Same storage as a σ table, no lookup, handles zeros and single-digit counts natively.

**(d) Branching factor** — unchanged from the research, kept as a secondary signal:

```
R̂(t) = [R(t) − R(t−Tg)] / max(R(t−Tg) − R(t−2Tg), 1)     Tg = 5 min
```

`R̂ > 1` supercritical. `R̂ ≈ 1` peaking. `R̂ < 1` dying. **BET** — this is a count-only approximation of SEISMIC and will underperform on cascades driven by one very-high-degree resharer. It is the right point on the cost curve; SEISMIC proper would need a retweeters call per post per interval and exceed the entire ingest budget.

**(e) The trigger.**

```
TRIGGER  iff  rate_LCB ≥ floor_absolute          ← the gate: hard, unfakeable-ish
         AND  z_rel ≥ q(1 − α_budget)            ← empirical quantile, NOT Gaussian z
         AND  τ ≤ 25 min
         AND  censored_entry == false
         AND  hard_filters_pass
```

**Calibrate the cut from observed upper-tail quantiles at a target alert budget.** Do not assume z=3 means 1.3 false positives per 1000 — early-window log residuals on X are right-skewed and fat-tailed (quote-cascades, purchased bursts), and mild excess kurtosis puts the true rate 5–20× higher.

**z_rel ships as a re-ranker on top of the absolute gate, never as a standalone trigger.** β̂_a is under the adversary's control in both directions: depress your own baseline with filler posts, or buy ~100 likes on the target post. Either moves z_rel further than a genuine organic signal does. A detector that is cheapest to trigger for the party who benefits from triggering it inverts the product's value.

**Views never enter the trigger.** They are a display number and a bought-reach detector. This is where the sensor track and the ranking track disagreed, and both are right about their own job: views are a lagging, platform-controlled number and therefore useless as a *trigger*, but they are the only continuously-available reach measure and therefore fine as a *ranking base* once shrunk (see §4).

**View staleness handling:** `if V_i == V_{i−1} AND L_i > L_{i−1}` → mark the observation view-censored, emit no views-rate point, carry V forward. Today's `deltaPerMinute` silently emits 0 here, which reads as "cooling" and is wrong.

### 2.5 Lifecycle classifier — with hysteresis

```
HEATING  if  R̂ ≥ 1.15  OR  (g ≥ +0.020 AND v ≥ 0.5 reshares/min)
COOLING  if  v < 0.60·v_peak AND g ≤ −0.010, for 2 consecutive snaps
DEAD     if  v < 0.05·v_peak  OR  (v < 0.2 AND τ > 90)
PEAKING  otherwise
```

Leaving HEATING requires 2 consecutive qualifying snapshots. COOLING → HEATING forbidden unless `v` re-exceeds `0.80·v_peak`. DEAD is absorbing. The current `lifecycleFromViewsMetrics()` has the right three states but computes on views, uses a hardcoded `a < -500` absolute threshold that cannot be scale-correct, and has no hysteresis — so it flickers.

### 2.6 Proving earliness

Three numbers ship together, or the claim is cherry-picked:

1. **LEAD TIME** — median / p25 / p75 of `t_crypto − promoted_at`, over alerts where a coin appeared within 6h, `earliness_eligible` only.
2. **PRECISION** — % of alerts with any matching mint within 6h.
3. **RECALL MISSES** — mints reaching ≥$100k FDV that reverse-match to an entity we never alerted on, or alerted on after `t_crypto`. Nightly job scanning the mint index.

**Left-censored entry:** a post first seen already large gets `earliness_eligible = false` permanently, may appear under an "Already Hot" label, may never fire an alert on its own, and is **excluded from the earliness denominator**. Any other choice makes the headline metric a lie.

**Gap detection is mandatory.** PumpPortal allows one connection and timeout-bans reconnect storms. A dropped connection creates a silent gap in `coin_mints`, which silently *inflates* lead times for every narrative in that window. Supervised singleton + heartbeat + a gap-detection job that marks affected windows **unmeasurable** in the ledger rather than counting them as wins.

---

## 3. CLUSTERING

### 3.1 What the research got wrong

The research claimed the current embedding tier is "mathematically redundant with the keyword tier" and should be deleted. **It is not, and deleting it would destroy ~21% of legitimate merges.** Two independent reasons:

- **Different metric.** Keyword is Jaccard over token sets; embedding is L2-normalised-TF cosine. Not related by any monotone transform, so no threshold pair makes them equivalent. Measured rank inversions: a pair at J=0.167 / C=0.772 passes the embedding tier and fails the keyword tier.
- **Different comparison target.** Keyword compares the post to the **max over individual members**; embedding compares to the **renormalised mean centroid**. A centroid is a soft consensus that down-weights idiosyncratic per-member terms as membership grows — not expressible as a pairwise max.

At the live thresholds (`SIM_THRESHOLD 0.42`, `KEYWORD_OVERLAP_THRESHOLD 0.28`), **21.4% of matches are embedding-tier-only.**

The research also claimed multilingual clustering is "0% functional." **Half right.** The tokenizer does map CJK/Arabic/Thai/Cyrillic to the empty set — but the **cashtag tier is script-independent** (`/\$[A-Za-z][A-Za-z0-9]{1,9}/` against raw text), so a post reading `$BONK 要暴涨了` clusters perfectly. On a memecoin terminal, the ticker-bearing post is exactly the one that matters. And **the X lane is `lang:en`-hardcoded at ingest** (`ingest-query.js:11,22`, `subject-entity.js:39`), so non-English X posts are never ingested at all — the real exposure is TikTok-only.

**The argument that survives for a real embedding model is paraphrase**, not redundancy and not multilingual: three creators describing the same clip with no shared 4+ char word produce cosine 0 and three singleton narratives. That is the actual early-detection loss.

### 3.2 The build order — cheap structural fixes first

**Ship these before spending a dollar on embeddings. They are hours of work each.**

| # | Fix | File | Why |
|---|---|---|---|
| 1 | Remove the early `return` on first cashtag match | `cluster-engine.js:90` | Currently scores nothing else; iteration order is systematically biased (pre-existing narratives first, then meme-score-desc creation order), so wrong merges are *reproducible*, not noise |
| 2 | Add `membersShareAuthor` guard to the cashtag loop | `cluster-engine.js:84` | Keyword (`:102`) and embedding (`:121`) both have it; the cashtag loop does not, contradicting the function's own docstring at `:78`. One author can self-merge unboundedly |
| 3 | Import `GENERIC_TICKERS` from `nameability.js` into clustering | `cluster-engine.js` | **The denylist already exists** — 45 entries incl. SOL, PUMP, MEME, COIN, MOON, LFG, DEGEN — and the clustering path simply never imports it. Highest value-per-line change available |
| 4 | NFD-normalise before the character strip | `text-utils.js:62` | `.normalize('NFD').replace(/[\u0300-\u036f]/g,'')` recovers Spanish, Portuguese, Turkish, Vietnamese. "rápido" currently → "pido" |
| 5 | Lower the `w.length >= 4` token floor to 3 | `text-utils.js` | Drops "wif", "gm", most romanised CJK fragments |

**Do not gate any of this on measurement.** The research proposed a one-query production check of "% of merges whose sole trigger was a shared cashtag." That metric is **unobtainable by query** — `cluster_match` records which signal fired *first*, and the early return means the keyword/embedding counterfactual is never computed. Obtaining it requires a shadow replay. Meanwhile the fix is a two-line import.

### 3.3 The matching rule

Two-stage: cheap candidate generation → exact multi-feature scoring → banded decision.

**Candidate generation** (≤40 candidates, index-backed, bounded):
- ANN on `post_vectors.emb` vs story centroids, top 25, within the platform window (48h X / 72h TikTok)
- Inverted-index hit on `entity_keys && p.entities OR cashtags && p.tags`, top 25

**Features:**

```
sim_c    = cos(p.emb, s.centroid)                          clamp [0,1]
sim_max  = max over s.exemplars(≤8) of cos(p.emb, m.emb)
J_ent    = |p.entities ∩ s.entities| / |p.entities ∪ s.entities|
J_lex    = Σ_{t ∈ A∩B} w(t) / Σ_{t ∈ A∪B} w(t)
tag      = max over shared cashtags of w(t) / W_MAX          0 if ambient
recency  = exp(−Δt_minutes / 180)
```

**Term weighting — DF *persistence*, not raw IDF.** This is the correction that matters. Raw IDF treats high document frequency as evidence of ambience, so a genuinely new ticker that climbs from DF=1 to DF=80 inside a 24h window gets down-weighted *exactly when it matters most*. Single-window DF cannot distinguish "perennially ambient" from "exploding right now" — the two states this product exists to separate.

```
persistence(t) = |{ last 14 daily buckets where df_bucket(t) ≥ 3 }| / 14
idf_window(t)  = ln( (1 + N_stories_24h) / (1 + df_stories_24h(t)) )
w(t)           = idf_window(t) × (1 − persistence(t))
w(t)           = 0  if t ∈ GENERIC_TICKERS  (hard denylist)
```

`$PUMP` — high DF in 13 of 14 buckets → persistence ≈ 0.93 → weight ≈ 0. `$KANGAROOCOURT` — DF spike confined to the last two buckets → persistence ≈ 0.14 → near-full weight. In-window DF is **free**: `scoredPosts` is already fully materialised in memory each cycle, so no `term_df` table is needed for that half; only the 14-day persistence history needs storage.

**Score:**

```
S(p,s) = 0.34·sim_c + 0.20·sim_max + 0.24·J_ent + 0.10·J_lex + 0.06·tag + 0.06·recency
```

**Thresholds (starting values — refit from the gold set):**

```
TAU_JOIN      = 0.62      ≥ → join, no LLM
TAU_NEW       = 0.46      < → new provisional story
                          between → adjudicate top-2 with Haiku (~8% of posts)
TAU_MERGE     = 0.70      story↔story auto-merge
TAU_MERGE_ADJ = 0.60      story↔story adjudicate band
SAME_AUTHOR_MARGIN   = 0.08
SAME_AUTHOR_MIN_JENT = 0.34
DORMANT_PENALTY      = 0.04
```

**Same-author handling: raised bar, not a ban.** Today's blanket merge ban fragments legitimate threads into duplicate stories. Instead: same-author posts join at `TAU_JOIN + 0.08` and require `J_ent ≥ 0.34`. The thing you actually care about — one account manufacturing a displayable story — is blocked by the promotion quorum, not the merge rule.

**Tie-break** (`best.S − second.S < 0.03`): resolve deterministically by more shared entities → more distinct authors → older `first_post_at`, **and enqueue a merge candidate** — two stories that close are probably one story.

**Centroid update — time-decayed and incremental.** The current code recomputes a plain mean over all members inside the match loop, which is O(N·M) per cycle *and* lets a 500-post story's centroid get dragged by late off-topic stragglers:

```
λ    = 0.5 ^ (Δt_hours / 12)          12h half-life on prior mass
nEff = centroid_n · λ
c    = centroid·nEff + p.emb
centroid   = l2normalize(c)
centroid_n = nEff + 1
```

Exemplars: the 8 highest-view members. `sim_max` against them guards the case where the centroid has drifted but the post clearly matches the story's core.

**Embedding model:** `gemini-embedding-2` at 768 dims (MRL-truncated), stored as `halfvec(768)` with HNSW (`m=16, ef_construction=64`). 768 stays well under pgvector's 2000-dim ceiling, halves index memory vs 1536, and the model maps text *and* images into one space — so a TikTok thumbnail and a text tweet about the same moment share a vector column. ~$0.30/day at 25k posts/day.

**BET:** that gemini-embedding-2 @ 768 performs well on short, noisy, meme-heavy social text. MTEB is dominated by clean retrieval corpora. A/B it against 1536 and against `text-embedding-3-small` on the gold set **before** locking — one hour of work once the harness exists. Note the docs warn `gemini-embedding-001` and `-2` spaces are incompatible: `post_vectors.model` is load-bearing and any model change is a full re-embed of the retention window.

**Multimodal image pricing is unverified.** Gemini's page quotes $0.20/1M for *text* tokens and describes image rates as "varying." Get the actual number before committing to fused embeddings; the design degrades gracefully to caption-text-only.

### 3.4 Lifecycle

```
                ┌──────────────┐
unmatched post →│ provisional  │── 6h, no promotion ──→ [GC: delete story row,
                └──────┬───────┘                         orphan posts re-offered]
                       │
      n_authors ≥ 2 AND combined_views ≥ MIN_DISPLAY_VIEWS
                       ↓
                ┌──────────────┐  no new member for D min  ┌──────────┐
                │     open     │ ────────────────────────→ │ dormant  │
                └──────┬───────┘ ←──── S ≥ TAU_JOIN ────── └────┬─────┘
                       │              (REOPEN)                  │
                 absorbed by merge                         7 days
                       ↓                                        ↓
                   merged                                   closed
```

**PROVISIONAL** stories are never displayed, never LLM-named, never coin-matched, never searchable. They cost a row and a vector.

**PROMOTED** sets `promoted_at = now()` **once and never overwrites it.** This is the timestamp the earliness claim is measured from. The existing `cluster-persist.js:46-58` already has exactly this never-clobber logic for `lead_time_min` — carry that pattern verbatim.

Cross-platform exception: a single-author story with **both** an X and a TikTok member promotes at `n_authors ≥ 1`. Two platforms is independent corroboration.

**DORMANT** adapts to the story's own arrival rate rather than a fixed 12h:
```
D = clamp(90,  6 × median_inter_arrival_gap_min, 720)     # X
D = clamp(240, 6 × median_gap,                   4320)    # TikTok-only
```

**REOPEN** does not exist today, and its absence is why a story that goes quiet and returns produces a permanent duplicate (`closeAgedOut` sets `status='closed'`; `loadOpenNarratives` filters `.eq('status','open')`).

**MERGE semantics — get these exactly right:**
- **Survivor = the story with the earlier `promoted_at`** (fallback `first_post_at`). Not the bigger one. Not the newer one.
- Repoint posts, comments, watchlist entries; **301-redirect the absorbed slug**, never 404.
- Survivor takes `min(first_post_at)`, `min(promoted_at)`, recomputed centroid, rebuilt exemplars, unioned entity/cashtag/platform sets.
- Survivor **must be retitled** (`title_version++`).
- Cap 3 merges per story per hour (oscillation guard). Log every merge.

**SPLIT is deliberately not built.** When `coherence < 0.55`, set `needs_review = true`, **suppress the coin CTA**, and flag it on the ops dashboard. A small tail of garbage-bag stories will exist and will be visibly flagged rather than silently wrong. If the rate of `coherence < 0.55` exceeds ~3% of open stories, that call was wrong and split becomes a week of contingency work.

**The lead-time hazard nobody flagged:** a post merged into a large older narrative inherits `created_at` (oldest), `age_min`, and `lead_time_min` from the merge target, and `aggregateMemeScores` overwrites its meme score with the top-by-views member's. After which `deriveGateReason` can gate it `too_old`. **On a product whose value is lead time, a bad merge does not mislabel the early signal — it erases it.** That makes fixing the merge logic *more* urgent than a false-positive framing suggests.

### 3.5 Naming and subject extraction

**One structured-output call per story**, replacing three incompatible notions of "subject" spread across `narrative-title.js`, `subject-entity.js`, and `meme-score.js`.

**Deterministic pre-pass (per post, ~0 cost).** The current `extractSubjectEntity()` falls back to *the longest token in the post*, which reliably picks "absolutely" or "unbelievable." The correct signal is distinctiveness — frequent inside the story, rare outside it:

```
distinctiveness(span, story) = (df_in_story(span) / story.n_posts)
                             × ln( N_posts_24h / (1 + df_global_24h(span)) )
```

Top 8 become `entity_keys` on the post (feeding `J_ent` and the inverted index) and the hint list for the naming call.

**The call.** `claude-haiku-4-5` with `output_config: {format: {type:'json_schema', ...}}` — which deletes the entire hand-rolled `extractJson()` / fence-stripping / brace-scanning path. Escalate to `claude-sonnet-5` for the top ~50/day by combined views. Schema returns `{title, blurb, subject, subject_type, coinable, ticker_candidates, confidence, sensitive}`.

Do **not** bother with prompt caching on Haiku — its minimum cacheable prefix is 4,096 tokens and this system prompt is ~700.

**Regeneration policy — the anti-churn fix.** Today `narrative-copy.js:15` regenerates whenever `membersAdded > 0` — every cycle for every live story — with a per-cycle cap of 8 that makes *which* stories get retitled effectively arbitrary. Replace with:

```
if (!title)                                       → 'first'
if (pending_merge_retitle)                        → 'merged'
if (now − titled_at < 20 min)                     → null       (hard cooldown)
if (cos(centroid, title_centroid) < 0.86)         → 'drift'
if (title_n_posts ≥ 3 && n_posts ≥ 2·title_n_posts) → 'growth'
if (GENERIC.has(norm(title)) && n_posts ≥ 3)      → 'generic'
```

Plus an accept-the-new-title check: if `jaccard(oldTokens, newTokens) ≥ 0.6`, keep the old title. Target: **1–3 title changes over a story's whole life, not 40.**

**Coinability enforcement, server-side, on top of the model's answer:**

```
coinable = model.coinable
        && model.confidence ≥ 0.55
        && !model.sensitive
        && model.subject
        && subject_type ∉ {event_only, none}
        && !isGenericSubject(subject_norm)
        && storyDf(subject_norm,'30d') / N_stories_30d < 0.02
        && normalizeTickers(ticker_candidates).length > 0
```

**Expect 50–70% of promoted stories to come back `coinable: false`, rendered with no CTA.** That is the correct outcome, not a coverage failure. A design that optimises this number upward reintroduces the $KANG bug. **BET** — the specific 50-70% band is a guess; the *shape* (most stories are not coinable) is not.

### 3.6 Evaluation without labels

**Continuous unlabelled proxies, on a dashboard, every cycle:** `coherence` (alert < 0.55), `dup_rate` (target < 5%), `singleton_rate`, `giant_rate`, `author_conc` (alert > 0.6), `adjudication_rate` (this is your cost dial — if > 12%, features are weak).

`singleton_rate` and `giant_rate` move in opposite directions as you turn `TAU_JOIN`. **Plot them against each other. That curve is the tuning instrument, not any single number.**

**The 300-pair gold set — the only place this design needs a human, and it is ~3 hours, once.** Label *pairs* ("same real-world moment? y/n", ~30s each), not clusters. Stratified where the threshold lives: 100 pairs in S∈[0.35,0.50], 100 in [0.50,0.65], 100 in [0.65,0.85]. Do not sample the easy tails.

What 3 hours buys: the precision/recall-vs-threshold curve (set `TAU_JOIN` at precision ≈ 0.92 — false merges render wrong coin CTAs), fitted L2-regularised weights replacing every hand-set `w`, and a regression suite that is non-negotiable before any embedding-model change. Two labellers on a 150-pair overlap; **if Cohen's κ < 0.7 the label definition is wrong, not the model.** Refresh 100 fresh pairs monthly.

**Do NOT use** silhouette, Davies-Bouldin, or Calinski-Harabasz. They assume fixed k and globular clusters in Euclidean space, none of which holds, and they will happily call a badly over-merged clustering excellent.

---

## 4. RANKING — BOTH LIVE FEED LANES

### 4.1 What changed

The research's core claim — "the base must be a decaying EWMA of deltas because every classic algorithm ranks cumulative quantities" — **is false on its own examples.** Reddit's `_confidence()` ranks a *proportion* p with n entering only as sample size for an uncertainty penalty; Bayesian average ranks a shrunk mean. Neither ranks a cumulative total. And HN's `(P-1)/(T+2)^1.8` **is** a decaying score.

The real axis is narrower and correct: **HN/Reddit-hot scores are monotonically non-increasing once inflow stops, so they structurally cannot detect a second wave** — which is the dominant pattern in memecoin attention. That is the whole argument, and it doesn't need a false universal.

Three failures of a raw-EWMA-of-deltas base:
- **Cold start.** `viewsVelocity` returns null with < 2 snapshots, and a newly ingested post lands in COLD tier (20 min X / 60 min TikTok). A rate base is **unrankable for 20–60 minutes** on a product whose entire value is being early. The codebase already concedes this with `qualifiesFastLane` → `views/1000`, an uncalibrated cumulative fallback.
- **Outage collapse.** The repo's own incident (ingestion dies → backlog ages out → site renders nothing) gets *worse* with EWMA: state decays through the gap, then fires a spurious burst on resumption when the whole accumulated delta lands in one interval.
- **Scale dominance and botting.** Raw rate always ranks a 500k-follower account at 10k views/min above a 300-follower account at 200 views/min — the second being the more informative signal. And at small n, `Δviews` is Poisson-noisy and purchasable for a few dollars.

### 4.2 The ranking primitive

**One primitive, both lanes:**

```
base    = rate_LCB_norm × burst^0.5
heat    = (base × O × D)^0.85 / ((age_min + 12)/12)^1.35 × C
```

- **`rate_LCB_norm`** — Gamma-Poisson lower confidence bound on view arrival rate, normalised by the platform's rolling 24h median hourly gain. This is the Wilson/Bayesian *mechanism* (counts as sample size), applied to the right quantity. It does three jobs: kills 3→30-view false positives, prices in bought views, and its prior **is** the cold-start answer.
- **Cold-start seeding:** the first observation seeds `rate = views / age_since_posted` (a cumulative-derived rate) instead of returning null. This removes the 20/60-minute blind window and makes an already-large first-seen post rank correctly instead of near-zero. Fix `velocity.js:50`.
- **`burst`** — `S_fast / S_slow`, continuous-time form, `τ_fast = 20 min`, `τ_slow = 6 h`. Scale-free and second-wave-sensitive.
- **`O` ∈ [0.15, 1.0]** — organic multiplier (§4.5).
- **`D` ∈ [0.4, 1.3]** — author-diversity multiplier at narrative level; 1.0 for a single post.
- **`C`** — crypto-pickup penalty: `0.35` once ≥3 distinct crypto-native accounts have quoted/replied, else `1.0`. **This is the formula's expression of the product thesis.** The moment CT finds it, Insidor's edge is gone and it should fall off the board even if it is still growing. No competitor's ranking does this because no competitor claims earliness.
- **`α = 0.85, γ = 1.35, t0 = 12 min`** — the tuning surface. At these values, age penalty at t=120 min is 25.5 and at t=10 min is 2.27, ratio 11.2 → the older item needs `11.2^(1/0.85) = 17.1×` the momentum to overtake. Board turns over in ~40 minutes.
- **Cumulative reach is an eligibility GATE, not the base**, and not a fallback ranking term. That is what `FAST_LANE_VIEWS` / `views/1000` should be refactored into.

**Outage handling:** freeze EWMA state (do not decay) across detected ingestion gaps, and amortise the accumulated delta over the true elapsed dt on resumption. Otherwise the original failure recurs inverted — a wave of fake bursts instead of an empty page.

**Narrative aggregation** aggregates the *bases*, not the heats (aggregating heats double-applies the age penalty), and uses the age of the **first** post — the timestamp the honest record is judged against.

**Presented heat** is `round(100 · min(1, heat / p95_heat_1h))`, self-calibrating so a dead night still shows spread and a wild night isn't all 100s.

**Before committing infra: run HN `(P-1)/(T+2)^G` as an offline control** against 7 days of existing `post_snapshots`, scored on early-detection precision (did the top-10 at time t contain narratives that produced ≥$100k coins after t). If the control wins, "HN with hotter constants" was the right answer and nothing was lost. This is a cheap experiment, not a design failure.

### 4.3 Post lane — eligibility, cadence, stability

**Gate (all must hold):** `age ≤ 240 min`, `rate_LCB ≥ floor`, `cumulative_views ≥ floor`, `meme_score ≥ 0.35`, `O ≥ 0.30`, author appears < 3× in current top 20, `ticks_qualified ≥ 2`. Narratives additionally: `distinct_authors ≥ 2` **OR** (1 author AND Google Trends lift ≥ 1.5×).

**Filters change the SET, sorts change the ORDER, and the gate applies to both.** A user sorting by `newest` still only sees gated items — otherwise "newest" returns 40,000 pieces of junk and the product looks broken. The one exception is `showRisky`, which relaxes a hard gate and must therefore be a visually loud toggle, not a checkbox in a drawer.

**Recompute cadence:**

| Layer | Cadence | Mechanism | Cost |
|---|---|---|---|
| Accumulator update | on snapshot arrival | worker writes `post_heat` | in snapshot cost |
| Heat refresh | 60 s | pg_cron, one SQL UPDATE | ~$0 |
| Rank commit | 20 s | `commit_board()` + tick insert | ~$0 |
| Delta push | on change | Supabase Broadcast | §6 |
| p95 / platform norms | hourly | pg_cron | $0 |

**Rank stability — five mechanisms, all necessary.** Ranking on smoothed heat alone swaps adjacent items constantly:

```
EPS_SWAP    = 0.08     challenger must beat incumbent by 8%
ENTER_TICKS = 2        consecutive ticks to enter
EXIT_TICKS  = 3        consecutive ticks below threshold to leave
PIN_MS      = 90_000   minimum dwell once on board
MAX_MOVE    = 5        max rank positions moved per tick
```

Plus two UI rules borrowed from Photon: **freeze-on-hover** (queue reorders while the pointer is over the list, apply on mouse-out) and **never reflow below the fold** (new entrants above row 12 batch into a "3 new" pill).

**Escape hatch:** entities whose `rate_LCB` exceeds a hard threshold **skip the 2-tick dwell** and enter immediately with a NEW badge. The dwell requirement otherwise costs ~40 s of the product's core claim.

**Values update live; positions do not.** Row values come from a `Map<id, Row>` that updates every tick unconditionally; only the ordering array is held.

### 4.4 Coin lane

**Data spine: Jupiter Tokens V2 on the $25/mo Developer tier (10 RPS) — not free.** The free tier is 1 RPS / 60 RPM **shared across Swap, Price, and Token calls**. The product already routes swap quotes through Jupiter, so one user working the trade panel starves the board. Legacy grandfathered portal limits expired 2026-06-30.

**Jupiter does not expose per-wallet data.** `organicScore` is per-token; the wallet-level organic/non-organic classification happens inside Jupiter. Smart-money and top-trader features stay on **Birdeye** (`api/_lib/birdeye-trades.js` → `api/toptraders.js`, already wired, `BIRDEYE_API_KEY` already provisioned). The research's "without a paid market-data vendor" premise is already false in the shipped codebase.

**Four bands, never one list.** No incumbent ranks a 3-minute-old $8k curve against a $40M AMM token in one column, and neither should we — a single score across four orders of magnitude of mcap is meaningless.

```
Fresh        curve_pct < 50                    → CoinHeat_fresh (age-penalised)
Graduating   curve_pct ≥ 50, not migrated      → curve_pct desc, tiebreak CoinHeat
Live         migrated / has AMM pool           → CoinHeat_live (no age term)
From a Story coins linked to a narrative       → narrative_heat × CoinHeat    ← Insidor-only
```

`Graduating` sorts by **progress, not heat** — progress is the whole reason a user looks at that column.

**CoinHeat:**

```
V5     = s5.buyVolume + s5.sellVolume
org    = (s5.buyOrganicVolume + s5.sellOrganicVolume) / max(V5, 1)
accel  = (V5 × 12) / max(V1h, 1)
breadth= log1p(s5.numTraders) / log1p(50)
netBuy = s5.numNetBuyers / max(s5.numTraders, 1)

quality  = (0.30 + 0.70·org) × clamp(1 + 0.5·netBuy, 0.6, 1.5) × safetyMultiplier
coreHeat = log1p(V5) × breadth × min(accel, 6)^0.5 × quality

CoinHeat_fresh = coreHeat / ((ageMin + 20)/20)^0.9
CoinHeat_live  = coreHeat
```

`log1p(V5)` rather than a power because coin volume spans six orders of magnitude. `min(accel, 6)` caps the reward for a single 5-minute burst — an uncapped acceleration term is the easiest thing in this entire design to wash-trade.

**Cold-start path — mandatory, and no vendor solves it.** Jupiter states outright that "fresh tokens will have volatile organic scores because there isn't enough history," and every `SwapStats` field is nullable. For tokens under ~10 minutes old — precisely Insidor's window — ranking must use a **separate formula that does not read `organicScore` at all**: raw `numNetBuyers`, holder distribution from Helius, and LP/mint-authority state.

```
coreHeat_cold = log1p(V5) × breadth × clamp(1 + 0.5·netBuy, 0.6, 1.5) × safetyMultiplier
```

**Safety — hard gates and soft multiplier.** Hidden unless "show risky": mint authority active, freeze authority active, `topHoldersPercentage > 60`, `live && liquidity < $3k`, `numSells == 0 && numBuys > 30` (honeypot proxy).

`devHoldingPct`, `sniperPct`, `bundlePct` are in every competitor's row and are **not available** from Jupiter or DexScreener — they need first-slot transaction analysis we are not building at MVP. **Render them as `—`, never as a reassuring green.** A grey dash is honest; a missing chip reads as "fine."

### 4.5 Anti-gaming

**The organic multiplier `O` for posts — five features, all computable from `post_snapshots` we already collect, at zero marginal cost.**

```
F1  STEP DETECTION.  maxShare = max(deltas)/sum(deltas)
    f1 = clamp(1 − (maxShare − 0.45)/0.40, 0.10, 1)
    Bought reach lands in one interval then flatlines; organic reach is an S-curve.

F2  ENGAGEMENT DEPTH.  lv = likes/views
    f2 = lv < 0.0015 ? 0.25 : lv < 0.004 ? 0.6 : clamp(lv/0.01, 0.6, 1.15)

F3  CONVERSATION RATIO.  rl = replies/likes
    f3 = rl < 0.005 ? 0.5 : clamp(0.7 + 4·rl, 0.7, 1.2)

F4  AUDIENCE PLAUSIBILITY.  overshoot = views/followers
    f4 = (overshoot > 200 && quotes < 5) ? 0.35 : 1

F5  MONOTONE SANITY.  f5 = any(delta < 0) ? 0.7 : 1

O = clamp(f1·f2·f3·f4·f5, 0.15, 1.0)
```

**Multiplicative** (failing any one test caps the score) and **bounded below at 0.15** rather than zero (a false positive demotes rather than erases — a hard filter on a noisy classifier deletes real stories).

**Honest caveat:** F1 is the strongest term and it is unvalidated. If modern engagement services drip-feed to mimic organic curves, F1 is worthless and the whole anti-gaming story rests on the economic argument below. **Log every `O < 0.5` with its per-feature breakdown** so the failures are auditable rather than invisible.

**Coordination detection at narrative level:**
```
D = clamp( (1 + 0.15·ln(distinct_authors))
         × (spread_p90_p10 < 3min && authors > 3 ? 0.4 : 1)
         × (authorHHI > 0.6 ? 0.6 : 1)
         × (share_accounts_under_30d > 0.5 ? 0.5 : 1),
         0.4, 1.3 )
```
Plus structural caps: max 2 rows per author in the top 20, max 3 rows per narrative.

**Coins:** use Jupiter's organic split directly — but note its bias direction. Jupiter flags a wallet non-organic only when it matches *identifiable* sniper/copy-trade/automation patterns; **everything else defaults to organic**, so the error is systematically false-*positive*. For a product where a false positive means the user buys a rug, pair `organicScore` with an independent holder-distribution check (Helius) and LP state. Add two cheap local detectors: trade-size Gini < 0.25 over ≥30 trades → ×0.5, and >60% of trades at exactly 0.1/0.5/1.0 SOL → ×0.6.

Funding-graph clustering (tracing wallets to a common funder) is the actual gold standard and needs a transaction indexer we are not building in weeks 1–4. Say so; don't fake the chips.

**The economic argument, which matters more than any of the above.** The board is 40 rows and the gate requires two independent authors or one author plus real Trends lift. Faking that costs meaningfully more than faking a like count. Combine with the CT-pickup penalty `C` and the attacker's problem becomes: buy enough genuine cross-account traction to enter, then exit before the board demotes you at 40 minutes. Ranking design cannot make gaming impossible; it can make it unprofitable, and the price of entry is the lever.

**Long-run defence:** once the honest record has ~200 outcomes, an author's Bayesian-shrunk hit rate becomes a prior on `O`. Hit rate cannot be farmed without repeatedly being genuinely right.

---

## 5. STORY-TO-COIN MATCHING — THE CORRECTNESS-CRITICAL PART

### 5.1 The two live bugs, correctly traced

**Plumbing (confirmed):** `cluster-engine.js:enrichPost` sets `suggestedTicker` from `post_meme_scores.suggested_ticker`; `extractTickers()` (240–274) keys LLM-invented tickers into the **same Map as real cashtags with no provenance field**, and can make an LLM ticker canonical (line 272, sorted by memeScore). `deriveNarrative` puts it on `narr.tickers`; `cluster.js:310` `upsertTickers` persists it; `:312` `enrichNarrativeTickers` resolves it against a live market. `narrative_tickers` has **no `source` column**, so provenance is unrecoverable downstream.

**Three corrections to the research's diagnosis:**

1. **`lookupTicker` does not "select the highest-24h-volume exact match."** `comparePairs` sorts **SOL-quote-vs-not first**, returning before ever comparing volume — a $0-volume SOL pair beats a $5M USDC pair. And the exact-symbol match is a **soft preference, not a filter**: `if (exact.length) pool = exact` means with zero exact matches the pool stays as *every* Solana pair returned, including name- and mint-substring hits. Stripping exact matches from a live `q=KANG` search makes `pickBestPair` return "Trump Account Fund" (symbol TA, mint `HdPBmLiA*kang*LMqZ…`) labelled as ticker KANG.
2. **KANG is not the reproducer.** `lookupTicker('KANG')` returns `{found:false}` today (one exact pair, no liquidity, rejected by the `liquidity <= 0` guard at `:153`). So the enrichment path is a **no-op** for KANG. The surfacing mechanism is `upsertTickers` at **`cluster.js:310`**, which writes the row and `site/live.js:773` maps every `narrative_tickers` row into the UI. **Aiming the fix at `:312` fixes the wrong line.**
3. **The same code produces systematic false *negatives*.** `q=BRAINROT` has 9 exact Solana pairs including a $23,844-liquidity one; the code picks a 1-day-old $0-liquidity pair with $1,756 volume, then returns `found:false`. Same for SKIBIDI and SIXSEVEN. Volume-first ranking + post-hoc liquidity rejection loses real matches.

### 5.2 Temporal ordering is the *strongest* signal, not the weakest

The research argued temporal has "near-zero discriminative power" because 30–42k mints/day means a 30-minute window holds 600–900 candidates. **That is the marginal count, and the design never uses time marginally — it uses it conjunctively with a ticker.** Measured against the live API:

| Ticker | Distinct Solana mints | Spread |
|---|---|---|
| TRUMP | 7 | 563 days |
| MOON | 6 | 291 days |
| PUMP | 4 | 70 days |
| KANG | 1 | — |

**Conditional on an exact symbol match, competing candidates are separated by months.** A 30-minute window collapses the set to essentially one. Even taken marginally, 48× reduction is ~5.6 bits — not "near-zero."

The correct sensitivity is the opposite of the one stated: what would degrade the gate is a spike in **same-ticker** minting (copycat swarms on a hot narrative), not total mint volume. Total volume could triple with no effect.

### 5.3 Getting mint time right — for free

The research recommended building an on-chain mint-time oracle because `pairCreatedAt` is "pool creation and can trail mint by hours." **Both halves are wrong, in opposite directions:**

- **For fresh bonding-curve tokens** — the regime the product exists to serve — `pairCreatedAt` **is** the mint time, exact to the second. Verified: a pump.fun token's DexScreener `pairCreatedAt` matched its genesis transaction timestamp exactly.
- **For mature tokens the error is 228 days, not hours** — and it's caused by *pair selection*, not by the field's semantics. `comparePairs` picks whichever pool later became most liquid; for Fartcoin that's an Orca pool created ~8 months post-mint, and the original pumpfun pair has been dropped from the response entirely.

**Fix (zero extra network cost, same response):** replace `ageMinFromPair(bestPair)` with `min(pairCreatedAt)` across **all** Solana pairs for that mint. `lookupMint()`/`lookupTicker()` already hold `data.pairs`. Verified to yield 646.8 days for Fartcoin against a true 646.8-day age, replacing the current 418.3-day answer. For pre-graduation tokens the pumpfun pair *is* the minimum, so one code path covers both regimes.

**Do not build the RPC oracle.** Paginating `getSignaturesForAddress` to genesis cost 12 calls for a 40-minute-old token and scales with signature count — hundreds of calls per mature token, on a latency-critical path. Reserve RPC for a narrow tie-break when two same-ticker candidates fall in the same window.

**The single most dangerous line in the codebase:** `lib/token-lookup.js:70` — `if (!pair.pairCreatedAt) return 0;`. Missing timestamp renders as `ageMin = 0`, i.e. **"brand new"** — maximally attractive on a terminal that sells earliness. **Missing data must fail closed** (null/unknown, suppress the buy affordance), never as zero.

### 5.4 Relations — three, never conflated

```
DERIVED    minted because of this story          → the main case
ADOPTED    pre-existing coin the story attached to → legit buy, weaker confidence, different UI
MENTIONED  the author typed a cashtag             → candidate generation input, NOT a verdict
SUGGESTED  an LLM invented a ticker               → CREATE-path prefill ONLY, never resolved against a market
```

Both live bugs are SUGGESTED or MENTIONED leaking into a DERIVED lookup. Any design that doesn't separate these will reproduce the bug in a new form.

**Do not drop `suggested_ticker`.** Add a `source` column ('cashtag' | 'llm' | 'mint_in_post') to `narrative_tickers`, carry it through `extractTickers` and `upsertTickers`, and render an unresolved LLM proposal distinctly. Deleting it deletes the **earliest signal the product has** — the pre-deployment ticker proposal.

### 5.5 Gates (hard, ordered, no scoring until all pass)

```
G1  mint_time = min(pairCreatedAt across ALL pairs for the mint).
    If null → UNKNOWN → fail closed, no Buy affordance, ever.
G2  mint_time ≥ earliest_post_at − 10 min      else DERIVED impossible → ADOPTED path only
G3  mint_time ≤ earliest_post_at + 48 h        else too late
G4  tradeable: filter liquidity > 0 BEFORE ranking, not reject after
G5  not a curated major                        DERIVED only; ADOPTED remains eligible
```

**G5 is not a blanket blocklist.** A story genuinely about Pump.fun *should* match $PUMP. Majors are excluded from DERIVED candidate generation and retained for ADOPTED gated on topical relevance — a different confidence story with its own UI treatment.

### 5.6 The scoring function

```
S_mint_in_post  1.00   the mint address literally appears in a tracked post in this narrative  ← strongest
S_img           0..1   two-channel image similarity (§5.8)                                     ← phase 2
S_text          0..1   max(cos(embed(token.name), embed(subject + title)), entity containment)
S_tick          0..1   max(exact, 0.75·jaroWinkler) × collision_idf
S_social        0..0.85 metadata twitter field links source post (0.85) or author (0.70)       ← capped, spoofable

collision_idf(sym) = log(1 + N_total/(1 + N_symbol(sym))) / log(1 + N_total)
                     N_symbol = live tokens with that symbol AND liquidity ≥ $1k

E = 0.14·S_mint_in_post + 0.34·S_img + 0.26·S_text + 0.12·S_tick + 0.14·S_social
```

**Time prior (multiplier, applied after E):**
```
Δ ≤ 5 min → 1.00   |   ≤30 → 0.95   |   ≤120 → 0.75
≤360 → 0.45        |   ≤1440 → 0.20 |   >1440 → 0.05
```

**Market plausibility:** low liquidity is *not* disqualifying for a fresh derived coin — it is expected. Absurd liquidity in the first minutes is the anomaly. `Δ ≤ 30 && liquidity > $2M → 0.2`; `holders ≥ 50 → 1.0`; else `0.7`.

```
raw   = E × timePrior × (0.85 + 0.15·marketPlausibility)
score = calibrate(raw)     Platt (n<500) → isotonic (n≥500), from match_labels
```

**S_social is downgraded from near-proof to 0.85.** The metadata `twitter` field is unverified attacker-controlled input. Once deployers learn Insidor's Buy button drives volume, stuffing the source post URL into token metadata is the first thing they will do. It must not be able to confirm alone.

### 5.7 The confirmation rule, thresholds, and the abstain band

```
strongChannels = [S_img ≥ 0.55] + [S_text ≥ 0.55] + [S_tick ≥ 0.60]
nearProof      = S_mint_in_post ≥ 0.90
confirmable    = nearProof OR strongChannels ≥ 2

T_CONFIRM = 0.80        T_FLOOR = 0.45

CONFIRMED  score ≥ 0.80 AND confirmable
UNSURE     0.45 ≤ score < 0.80,  OR  score ≥ 0.80 with only 1 strong channel
REJECTED   score < 0.45, or any gate veto
```

**Why this kills both live bugs:**
- **$KANG** — `S_tick` high-ish, `S_img ≈ 0`, `S_text ≈ 0` → 1 strong channel → forced UNSURE, no Buy button. And with SUGGESTED removed from resolution it never becomes a candidate at all.
- **$PUMP** — mint predates every story → **G2 veto before scoring**. Even without the veto, `collision_idf('PUMP')` with hundreds of live collisions crushes the only live channel.
- **GYATT-class** (resolves to a 604-day-old "Sophie Rain" token with $3,142 liquidity, currently written as `first_deployed: true` + `mint_ca` + `pump_url`) — **G2 veto.** This class is what Rule-1-alone does not touch, and it is the one that loses a user money.

**Targets:** Precision@CONFIRMED **≥ 0.97** (argue for 0.99 before paid acquisition). Recall@CONFIRMED 0.55–0.70. Recall@(CONFIRMED ∪ UNSURE) ≥ 0.90. Abstain rate 15–30%, monitored — a rising rate is a signal (corpus staleness, embedding regression), not a failure.

**The loss asymmetry is ~50:1**, and the second reason is Insidor-specific: **a miss degrades gracefully into the CREATE path, which is a valid, monetised product state.** You are the rare product where declining to answer is genuinely cheap. Design for that.

### 5.8 Image matching (phase 2)

No single embedding covers the transformation classes. The failure modes are **disjoint**, so the fusion is asymmetric:

| Class | pHash | DINOv2 | SigLIP2 |
|---|---|---|---|
| exact re-upload | ✅ | ✅ | ✅ low-prec |
| center-crop 16:9 → square | ❌ | ✅ | ✅ |
| screenshot, borders, watermark | ❌ | ✅ | ✅ |
| meme text overlay | ❌ | ✅ | ⚠️ |
| TikTok frame grab | ❌ | ⚠️ | ⚠️ |
| **AI cartoon "in the style of" source** | ❌ | ❌ | ✅ |
| different photo of same subject | ❌ | ❌ | ✅ |

```
S_img = max(
  1.00                                              if hamming(pHash) ≤ 6,
  clamp01((cos_dino   − 0.55)/(0.88 − 0.55)),
  0.60 × clamp01((cos_siglip − 0.72)/(0.95 − 0.72))   ← CAPPED: cannot confirm alone
)
```

The 0.60 cap is load-bearing. Memecoin logo space is extremely low-entropy — cartoon animal, bold text, flat background is the modal image — so any CLIP-family threshold loose enough to catch true matches admits hundreds of false ones.

**DINOv2 ViT-B/14 (Apache 2.0), not DINOv3.** DINOv3 reports a large instance-retrieval gain but ships under a custom Meta licence requiring named approval — a legal-review item, not a drop-in. Keep the channel swappable; the eval's ablation decides DINOv2 vs SSCD, not argument.

**Corpus is smaller than instinct suggests:** hot index ≈ 2–3 days of mints ≈ 80–130k tokens; warm index (ever exceeded $25k liquidity) order 10^5. **pgvector on the existing Supabase is sufficient.** Do not provision a dedicated vector DB.

Exclusions **before** embedding cut image work from ~40k/day to ~3–8k/day: liquidity < $500 and age > 30 min (85–95% of mints), non-SPL/NFT/LP/wrapped, majors, pHash-deduped identical AI-slop logos.

### 5.9 UI — how uncertainty is shown rather than hidden

The button is a function of the **CONFIRMED** count. UNSURE candidates live in a separate, non-actionable region and can never silently become a Buy.

| State | Primary CTA | Secondary |
|---|---|---|
| **CONFIRMED, n=1** | `Buy $TICKER` | Evidence chip: "matched · image + name · minted 4m after the post". Chip opens a popover with post media beside token logo and the Δ — **this doubles as the earliness proof surface** |
| **CONFIRMED, n≥2** | `Buy $TICKER` (highest score) | "3 more coins". Rank by score → earliest mint → liquidity, **never by volume alone**. Badge the earliest `first` |
| **UNSURE** | `Create the coin` | **No Buy button.** Muted, collapsed: "Possible match: $KANG — we're not confident this is related. View anyway" → coin page with persistent warning banner and a Buy control requiring a **second explicit confirm**. Never one-tap |
| **NONE** | `Create the coin` | Prefilled with `suggested_ticker` / `suggested_name` / post image. **The only place SUGGESTED belongs** |
| **ADOPTED** | `Buy $TICKER` | Labelled "existing coin, adopted by this story" with the token's real age shown |

**Confidence must be CATEGORICAL, not numeric.** Do not render "73% match" next to an actionable control — users treat 73% as good enough and do their own thresholding, which defeats the abstain band entirely. Three states, three treatments.

Log every CONFIRMED and every UNSURE with its full feature vector. That is the eval set growing itself, and it is the "misses alongside hits" promise applied to the buy path.

### 5.10 Ship order

**Day 1 — hours, no ML, no new infrastructure, removes both live defects:**
1. Stop feeding `suggested_ticker` into enrichment; add the `source` column instead.
2. Add the majors blocklist to the DERIVED path.
3. `min(pairCreatedAt)` across all pairs, replacing best-pair age.
4. Fail closed on missing `pairCreatedAt` (delete `return 0`).
5. G2 temporal veto.
6. Hard exact-symbol filter in `pickBestPair`; liquidity filter before ranking.
7. Collision IDF + the ≥2-channel rule; everything else renders UNSURE with the CREATE CTA.
8. Stop ranking by 24h volume; stop ranking SOL-quote first.
9. Close the second path: `worker/token-lookup.js:enrichAllOpenTickers` must respect the same provenance and age guards.
10. Fix cost: `cluster.js:312` passes no `opts`, so `enrich-tickers.js:79` never sleeps — unbounded serial DexScreener calls per narrative per cycle, with no cache, and `upsertTickers` deletes all rows every cycle so enrichment is re-fetched forever.

**Scope honestly: ~40+ lines across three files plus a schema migration and a backfill — not the "~5-line change" the research claimed.**

**Weeks 1–4:** mint stream (Stage A) → pHash + DINOv2 hot index → labelled set of 800–1,200 pairs → calibration → SigLIP2 and the Claude adjudicator only if the eval shows the abstain band is too wide.

**Eval composition matters more than size.** Mandatory strata, roughly equal, with the failure cases **over-represented** relative to natural frequency: easy positives 15%, transformed image 15%, ticker drift 10%, copycat swarm 10%, major-token collision (both the false case *and* the genuinely-about-crypto case) 15%, generic ticker 10%, predating coin 10%, true NONE 15%. **Report per-stratum precision, always.** An aggregate 0.97 hiding a 0.60 on the major-collision stratum is the current bug surviving the eval.

**A frozen 100-pair regression set including the actual $KANG, $PUMP, and GYATT cases runs in CI.** Those incidents become tests, and a threshold change cannot land silently.

---

## 6. REALTIME

### 6.1 What changed

The research recommended CDN-cached snapshot+delta polling for the board and rejected Supabase Broadcast on cost. **That is backwards on both sides.**

**Polling side — three errors:**
1. **Request collapsing does not apply.** Vercel documents it for **ISR and Image Optimization only**; header-based `s-maxage` on a Function is not on the list, because "request collapsing only works when a request is known to produce a cacheable response."
2. **Every poll is billed on a cache HIT.** Perfect collapsing saves nothing. 10k concurrent at 0.5 Hz = 5,000 req/s ≈ 13.0B CDN requests/month → **$25.9k–41.4k/mo** in Edge Requests, plus ~389 TB egress → **$58k–136k/mo**. Total **~$84k–177k/mo**. Even 500 concurrent is ~$1.3k/mo in requests alone.
3. **Silent cache bypass.** Cacheability requires no `Authorization` header and no `set-cookie` on the response. `site/live.js` already sends `Authorization: Bearer ${anonKey}` on its data fetches. Cache ratio 1:1, no error, no warning.
4. **Clock alignment is counterproductive.** With `s-maxage=2` and every client firing at `t ≡ 0 (mod 2s)`, the entry has *just* expired — every client deterministically gets the **stale** copy. Jittered polling gives uniform age in [0,2s), mean 1s. Alignment doubles mean staleness and converts a distribution into a worst case everyone hits.

**Broadcast side — the mechanic is right, the conclusion is wrong.** Supabase does bill per delivery per client ("one message sent plus one message per subscribed client that receives it"). But the honest unit is **client-HOURS**: 5M/mo ÷ 720 msg/client-hour = **6,944 client-hours/month**, which at 30-minute sessions twice daily is ~230 monthly actives — not "10 concurrent viewers." And quota exhaustion is a **$2.50/M meter, not a wall**: 100 always-on concurrent = **$117/mo**; 500 concurrent = **$635/mo**. Against an ingestion bill of $500–2,000/mo, that cannot drive a transport decision.

**The constraints that actually bind, in order:**
1. **Peak connections** — Pro 500 (hard fail); Pro-no-spend-cap / Team **10,000**.
2. **Messages/sec** — Pro 500; no-spend-cap / Team **2,500**.
3. The monthly message quota — a money meter, last.

Designing against #3 while leaving #1 and #2 unhandled is the specific mistake the research would have produced.

### 6.2 Delivery mechanism per surface

| Surface | Mechanism | Latency | Why |
|---|---|---|---|
| **Ranked board (both lanes)** | Supabase Broadcast, **change-driven with per-client coalescing** | p50 ~60 ms | Cheap at real scale; push preserves earliness, which polling structurally cannot |
| **Activity rail** | folded into the same tick envelope | ~60 ms | Zero marginal cost, zero marginal failure modes |
| **Comment thread** | Broadcast on a private per-narrative topic, `realtime.send()` from an AFTER trigger | ~50 ms | Sub-second matters; per-thread fan-out is tens of clients |
| **Coin price / last trade** | **one server-side subscriber** → folded into the board tick | ~60 ms | Keeps the provider key server-side; never a per-client WS to a vendor |
| **Initial hydration + disconnect fallback** | ISR route (`export const revalidate = 2`), jittered client polling | ~2 s | The **only** correct use of HTTP caching here |

**The defect is the unconditional fixed tick, not the transport.** Broadcast only when the board *changes*, coalescing per client into at most one frame per 500 ms. An idle 3 a.m. board costs ~zero. A large-post burst coalesces into one frame well inside Pro's 3,000 KB broadcast payload cap.

**Postgres Changes is disqualified.** With RLS, 4,000 clients cap at **5 changes/sec** — changes are processed on a single thread to preserve order, so compute upgrades don't help — and every change costs one authorization read *per subscribed client*. It also forces `replica identity full`, which writes the entire old row to WAL on every UPDATE. **Drop `replica identity full` from `narratives` and `narrative_posts`** (currently set in `worker/schema-realtime.sql`) in the same migration that adds Broadcast.

**If you serve the cached HTTP endpoint at all:**
```
Vercel-CDN-Cache-Control: public, s-maxage=2, stale-while-revalidate=8
Cache-Control:            public, max-age=0, must-revalidate
```
Strip `Authorization`, keep the URL global and anonymous, set no cookies, send cursor-keyed diffs. **Jitter, never clock-align.** Do not plan around `stale-if-error` — Vercel does not support it. Measure `x-vercel-cache` HIT/MISS/STALE ratio and the `Age` distribution, and budget against CDN Requests + egress, not origin invocations.

**Surface staleness in the UI.** Read `Age` / `x-vercel-cache` and render row age. In a product where a stale "safe" flag means a user buys a rug, silent staleness is a correctness bug, not a performance trade. `site/live.js` already has the right pattern (`realtimeConnected`, "Polling fallback") — extend it, don't replace it.

### 6.3 Scale and cost curve

| Peak concurrent | Avg (~20%) | Broadcast msgs/mo (change-driven) | Supabase cost | Binding constraint |
|---|---|---|---|---|
| 10 | 2 | ~1M | **$0** | none |
| 100 | 20 | ~10M | ~$13 | none |
| 500 | 100 | ~52M | ~$118 + $0 conn | approaching Pro conn cap → enable no-spend-cap |
| 2,000 | 400 | ~208M | ~$508 + $15 conn | fine |
| 10,000 | 2,000 | ~1.04B | ~$2,590 + $95 conn | **at the 10,000 peak-connection ceiling** |
| 50,000 | 10,000 | ~5.2B | ~$12,950 — **over plan ceiling** | connections and msgs/sec both blown |

**The escape hatch, and where it triggers.** At roughly **5,000 average concurrent**, self-hosted fan-out becomes better value than the meter: one Go service consuming Postgres logical replication and fanning out over WebSockets, ~$150/mo on Fly, ~2 weeks of engineering and permanent on-call. That is the documented decision point — do not build it before then, and do not discover it on a bill.

Mitigations that push the trigger later: subscribe to a comment thread only when it is on screen and the tab is visible; coalesce aggressively; send row diffs not full boards.

**Unverified and worth checking before relying on it:** whether the documented messages/sec limit is scoped per-project, per-channel, or per-client. The tier values are confirmed; the scope is not.

### 6.4 Pipeline execution home: Inngest

| Option | Verdict |
|---|---|
| **Vercel Cron (today)** | **Rejected.** No singleton, no retries, no backpressure, no concept of "ran but produced nothing." It *caused* the 2-day silent outage. `worker/lib/pipeline-lock.js` is a local **file** lock and guarantees nothing across invocations. |
| Long-running container (Railway/Fly) | **Viable, cheapest migration** (~$10/mo, `worker/index.js` runs unmodified) but single point of failure, deploys = downtime, and the file lock silently breaks at 2 instances |
| BullMQ + Redis | Rejected. You own scheduler, DLQ, dashboards, and a Redis. Weeks to reach day-one parity. Wrong allocation for a small team |
| **Inngest** | **Chosen** |
| Trigger.dev | Viable. Pick only if a stage needs >800 s — none do |

Inngest maps 1:1 onto the three requirements:
- `concurrency: { limit: 1, key }` **is** "must not run concurrently with itself"
- `step.run()` memoization **is** "survive partial failure without re-spending the API budget" — a retry replays `fetch` from memory and does not re-spend twitterapi.io reads
- `throttle` / `rateLimit` **are** the budget guards
- Built-in cron replaces `vercel.json` crons

**Premise correction:** Vercel's 60 s ceiling no longer exists. With Fluid compute, Pro is **300 s default / 800 s GA max / 1800 s beta**. That removes `worker/lib/time-guard.js` + `worker_cron_progress` as a *requirement*, though chunking remains good practice for progress reporting.

**Cost: $99/mo Pro** (Hobby's 50k executions is not enough at 1-min cadence across 7 stages ≈ 1.2M steps/mo). That is the honest price of the pipeline not silently dying.

**Migration, each step independently shippable:** add the serve route → wrap each `runCycle` in a `createFunction` (**`worker/` code does not change**) → delete the `crons` block, keeping `api/cron/*` behind auth for a week as manual escape hatches → delete `time-guard.js`, `cron-state.js`, `pipeline-lock.js`, `worker_cron_progress` → add `rank-commit` (cron every 20 s) → **add the watchdog and external dead-man's switch in the same PR**, not after.

### 6.5 Observability — the model that catches a silent death

**Principle: a heartbeat proves a process *ran*, not that it *produced anything*.** `worker_pipeline_state.last_heartbeat` would have ticked happily through all 48 hours of the outage. Alert on **output freshness and funnel yield**, and put the evaluator somewhere the pipeline's death cannot silence it.

| # | SLI | Warn | **Page** | Catches the outage? |
|---|---|---|---|---|
| 1 | `ingest_freshness` = `now() − max(first_seen_at)` | 15 m | **30 m** | ✅ |
| 2 | `stage_output_stall` = consecutive runs with 0 rows | 3 | **5 (~10 m)** | ✅ **fastest** |
| 3 | `gate_supply` = count where `display_eligible` | <8 | **0 for 10 m** | ✅ |
| 4 | `board_render_fallback` — `showingIneligible` fired | — | **immediately** | ✅ **at T+0 of user impact** |
| 5 | `stage_liveness` = `now() − last_success_at` | 2× interval | **3×** | crash-loop |
| 6 | `funnel_yield` = output/input vs 7-day baseline | −2σ | **−3σ** | "runs but the floor is too high" |
| 7 | `budget_burn` = reads_today / cap before 18:00 UTC | 0.9 | 1.0 pre-12:00 | budget starvation |
| 8 | `tick_freshness` | 60 s | **120 s** | board froze |
| 9 | `e2e_lead_time_p50` | <15 m | **<8 m** | the product claim is failing |
| 10 | `delta_divergence` = client resync rate | 1% | 5% | reconciliation bug |

**SLI #4 is the sharpest and costs nearly nothing:** `lib/stories.ts` **already computes** `showingIneligible` — the code knows the board is broken and renders a fallback in silence. Make it emit.

**Two independent observers:**
- **External dead-man's switch.** `watchdog` runs every 2 min, evaluates all 10 SLIs, pages Slack, then pings healthchecks.io. If Inngest, Vercel, or the watchdog itself dies, the external alarm fires at T+5 min. **Nothing inside the system can suppress this.**
- **In-database.** `pg_cron` every 5 min → `evaluate_health()` → `pg_net` POST to the Slack webhook on any `page`. Survives total loss of the app platform.

**Replay against the real incident:** T+4 min warn, **T+10 min page**, T+30 min second page, and the instant a user sees an empty board, an immediate page. **Detection: ~10 minutes. Was: 2 days.**

---

## 7. PROJECT STRUCTURE

### 7.1 Shape

Two-app npm-workspace monorepo. Feature folders inside `apps/web`, with `app/` as a routing manifest containing zero business logic.

```
insidor/
├─ apps/
│  ├─ web/                    # Next.js 16 — the only thing Vercel builds
│  └─ pipeline/               # Node service: ingest, snapshot, score, cluster, resolve-coins, trends
├─ packages/
│  ├─ contracts/              # DB row types + zod schemas + shared enums. ZERO runtime deps.
│  ├─ db/                     # SQL migrations, type generation, client factories
│  └─ config/                 # shared tsconfig / eslint / prettier / vitest bases
├─ scripts/
│  ├─ check-model-tests.mjs
│  └─ feature-graph.mjs       # THE DAG — single source of truth, imported by both lint configs
├─ .dependency-cruiser.cjs
├─ eslint.config.mjs
├─ turbo.json
└─ tsconfig.base.json
```

The monorepo is justified **per deployable**, not per feature. The worker is CommonJS Node holding a service-role key with long-running loops; the web app is Next 16 RSC on Vercel. You have already been forced to acknowledge this with `outputFileTracingExcludes` and `tsconfig.exclude: ["worker","site","design","api"]` — excluding half your repo from your own typechecker is the structural smell that says these are two programs.

**Per-feature packages are rejected.** Eight `package.json` files, a build graph, and a slower dev loop buy enforcement obtainable from ~100 lines of lint config.

### 7.2 The feature tree

```
apps/web/src/
├─ app/                       # ROUTING ONLY. Zero logic. Lint-enforced, max 40 lines/file.
├─ features/
│  ├─ feed/         narratives/   trading/     launch/
│  ├─ wallet/       watchlist/    search/      trending/    ops/
├─ shared/
│  ├─ ui/           # design system primitives — NO domain vocabulary in props
│  ├─ db/           # browserClient / serverClient / serviceClient factories
│  ├─ realtime/     # ONE ref-counted Supabase socket for the whole app
│  ├─ format/       hooks/       lib/
└─ test/
```

**Every feature has the same six segments, no exceptions:**

```
features/<name>/
├─ index.ts        # PUBLIC API, client-safe. The only cross-feature import target.
├─ server.ts       # PUBLIC API, server-only. Starts with: import 'server-only';
├─ README.md       # ≤15 lines: what breaks here, which tables, which external APIs
├─ model/          # PURE. No React, no I/O, no async. Tests MANDATORY here.
├─ server/         # queries, actions, route handlers. Never imported by ui/.
├─ ui/  hooks/  types.ts  __tests__/
```

**Why `model/` exists as a mandatory segment:** Vitest cannot render async Server Components (Next.js's own testing guide says so). If "test components" is the standard, people hit that wall in week two and testing quietly dies. So the pure logic is extracted by architectural rule and tested with five-line tests and no mocks. That is also where the coin-matching gate lives: `features/trading/model/risk.ts`.

### 7.3 The justification, corrected

The research argued feature folders because "the trade panel, watchlist toggle and coin row each render in 3+ routes." **Two of those three are false:**

- **The trade panel is not your component.** It is the Jupiter Plugin — `window.Jupiter` is a **global singleton** with one `integratedTargetId`. You cannot mount it per-card in a 20-row feed, and per-card quoting would exhaust Jupiter's rate limit outright. It is one provider in `app/(app)/layout.tsx` exposing a `useTrade()` hook, `displayMode:'modal'` for feed CTAs. There is no shared presentational component to colocate or not colocate.
- **The watchlist toggle renders once** in the settled design (`vStory`). Do not pre-extract for one call site.
- **The coin row does repeat** — 12 sites across 4 of 5 routes. That one holds.

**The real justification is the disclosure and null-state contracts:**
1. **The candidate-match stamp.** The design doc's own risk register: "every coin match must be presented as a candidate, never as a fact… A wrong 'Buy' button on a memecoin terminal is a user losing money." The prototype **already fails this** — `class="risk"` renders in exactly two places, while the pro table's Buy button and the search coin rows carry no qualifier at all. Make it structurally impossible to render a mint without its confidence stamp.
2. **The market-data null-state.** A seconds-old mint has no OHLCV, so price / 5m / 1h / 24h / liquidity / holders all return nothing. Every row needs an identical pending state.
3. **The lead-time ledger degrade.** A post first seen already large drives lead time to zero or negative; the "Insidor saw this story on X" line must degrade honestly in every surface.

**Next.js is unopinionated here** — its docs list three co-equal strategies and explicitly recommend none. Its third, "split project files by feature or route," **is the hybrid**: global shared code at the root, route-specific code in the segment that uses it. Adopt that, don't reject it. `components/` (or `features/*/ui`) holds cross-route primitives; `app/(app)/<route>/_components/` holds route-only pieces.

### 7.4 Enforcement

**TypeScript project references DO work with Next.js** — Next runs a real `tsc` pass (SWC only transpiles), `references` in tsconfig is preserved, and cross-package type errors are caught. The research's claim of incompatibility is false.

**But references do not enforce import boundaries.** A file importing a package absent from `references` type-checks clean via both source-paths and built-`.d.ts` resolution. References govern build ordering and incrementality only. And at this scale — one package, ~107 files, 1.3 s full typecheck — they buy nothing.

**So enforcement is lint-based, in three layers:**

```js
// scripts/feature-graph.mjs — THE single source of truth
export const FEATURE_DAG = {
  wallet:     [],
  watchlist:  ['wallet'],
  trading:    ['wallet'],
  launch:     ['wallet', 'trading'],
  narratives: ['trading', 'watchlist'],
  trending:   ['trading', 'watchlist'],
  search:     ['narratives', 'trading'],
  feed:       ['narratives', 'trading', 'watchlist'],
  ops:        [],
};
```

**Layer 1 — `no-restricted-imports` (core ESLint, zero config drift, catches ~80%):**

| Scope | Rule |
|---|---|
| `features/*/**` | No `@/features/*/*` deep imports (except `/server`); no `../../*` escaping the feature; never import `@/app/*` |
| `features/*/{ui,hooks}/**` | Never import `**/server/**`, `@/features/*/server`, or `@/shared/db` — **the service-key firewall** |
| `app/**` | Never import `@/shared/db` or feature internals; `max-lines: 40` |
| `shared/**` | Never import `@/features/*` — one-way graph |
| `features/*/model/**` | No `react`, no `next/navigation`, no `@supabase/supabase-js`, no `**/server/**` — **this is what makes it testable** |

**Layer 2 — `dependency-cruiser`, the authoritative CI gate.** One generated rule per feature from `FEATURE_DAG`, plus `no-deep-feature-import`, `shared-never-imports-features`, `app-has-no-logic`, `model-is-pure`, `client-never-touches-server`, `web-never-imports-pipeline`, `contracts-is-a-leaf`, `no-circular`, `no-unresolved`, `no-orphans`. `npm run depcruise:graph` renders `docs/architecture.svg` — **a diff to that SVG in a PR is the most legible possible signal that someone added a coupling.**

**Layer 3 — runtime backstop.** Every `features/*/server.ts` starts with `import 'server-only'`. Three characters that turn a lint bypass into a build failure and close the worst failure mode: a service key in the client bundle.

**Two gaps neither the research nor its fallback mentions, both higher-value than any of the above:**
1. **`worker/` (73 files — the entire ingest/score/cluster pipeline) is in tsconfig `exclude` and is never type-checked.** Add a second tsconfig covering it and run it in `typecheck`.
2. **There is no ESLint config file in the repo at all**, despite `eslint-config-next` being installed. `next lint` currently enforces nothing.

Also set `allowJs: false`. The current `allowJs: true` plus the exclusions means a large fraction of the code is untyped and unchecked; the rebuild is the moment to close that.

**CI:** `lint → typecheck → depcruise → check:model-tests → test --coverage`.

**Vercel config gotchas** that cost an afternoon if unanticipated: Root Directory = `apps/web`; `turbopack.root` must equal the injected `outputFileTracingRoot` (the workspace root) or Turbopack refuses to start. Set both explicitly.

**The `shared/` graduation rule** (write it in CONTRIBUTING.md verbatim): three call sites in three different features, zero domain vocabulary, and you would publish it to npm. Until all three hold, **duplicate the code.** Promotion is a PR titled `promote: <thing> → shared/<module>` that deletes both originals in the same commit. Demotion: anything in `shared/` with one importer for 30 days moves back.

The mechanical test that never produces an argument: `<Table columns rows />` — shared. `<CoinRow coin />` — feature. `<Sparkline points={number[]} />` — shared. `<TrendSparkline narrative />` — feature.

**Auth/wallet is deliberately NOT in `shared/`.** `features/wallet` owns the Privy provider, connect UI, signing hooks and address context, sitting at the bottom of the DAG. Putting a `WalletContext` in `shared/` means `shared/` imports Privy, which means `shared/` has business rules, which means the next thing goes in there too.

---

## 8. WHAT SURVIVES FROM THE CURRENT BUILD

The rebuild is full. These are not sentimental keeps — each is either correct, non-obvious, or expensive to rediscover.

### Keep verbatim

| File | Why |
|---|---|
| `worker/lib/budget.js` | Per-tweet billing is correct and the comment block documents real pricing. Extend the daily cap, keep the machinery. |
| `worker/lib/posted-at.js` | Correct ms/s normalisation; `postAgeMinutes` is exactly the τ the whole kinetics design needs. |
| `worker/lib/nameability.js` | `GENERIC_TICKERS` (45 entries) is the ambient denylist the clustering layer needs and has never imported. **This is the highest value-per-line asset in the repo.** |
| `worker/lib/meme-score.js` prompts | Especially the TikTok "would it survive as a screenshot" test. Only the prompt's *position* in the pipeline changes. |
| `worker/trends.js` | Becomes the third, *societal* clock — a distinct question from the crypto clock, never conflated with it. |
| `cluster-persist.js:46-58` | Never overwriting an established `lead_time_min` on upsert. Exactly the right instinct; port verbatim to `promoted_at`. |
| `cluster-persist.js:116-130` | Two-phase `sort_order` write to dodge the unique collision. Correct, non-obvious, easy to break. |
| `cluster.js:152` | Sorting unassigned posts by meme score descending so high-signal posts *seed* stories rather than joining noise. Right for a micro-batched stream. |
| `cluster.js:118-121, 155-164` | `timeGuard` + phase/index progress checkpointing. Inngest removes the *need*, but the resumability pattern is right and worth keeping for long stages. |
| `worker/lib/anthropic-budget.js` | Ledger + per-cycle call caps. Right shape; just change *which* calls it gates. |
| `titleContainsAuthorNoise()` | Rejecting titles that echo the poster's handle. Good guard; port as post-validation on the new structured output. |
| `lib/format.ts` | Already correct. Lift almost unchanged into `shared/format`. |
| `api/safety.js` | Mint/freeze revoked, LP burned, top-10 — wire directly into `safetyMultiplier()`. |
| `site/live.js` connection-state pattern | `realtimeConnected` + "Polling fallback" is exactly the right disconnect signalling. Extend it, don't replace it. |
| `design/insidor-prototype-clickable.html` | The locked visual source of truth. The design is settled; do not redesign. |
| **The embedding clustering tier** | 21.4% of merges are embedding-only. Do not delete it. |

### Reshape — right structure, wrong signal

| File | Change |
|---|---|
| `worker/snapshotter.js` | Batching, `dueForSnapshot`, prune, tier plumbing all reusable. Replace `assignTiers` (percentile-on-`viewsVelocity`, which is null for single-snapshot posts so new posts sort to COLD) with the age-driven geometric grid. Replace `{2,8,20}` intervals. |
| `worker/lib/near-miss.js` | Already the right idea — probation queue with TTL and re-check. Generalise into Tier P; promotion becomes rate-based instead of `views >= minViews`. |
| `worker/lib/ingest-floors.js` | Excellent per-lane controller with underutilisation decay and health alarms. Demote from primary discovery to recall net; retune `FLOOR_MIN 300 → 15`, `recencyMin 60 → 6`. |
| `worker/lib/cluster-engine.js` | Keep all three tiers. Remove the early return at `:90`, add the same-author guard to the cashtag loop, import `GENERIC_TICKERS`. |
| `worker/lib/text-utils.js` | Add NFD normalisation before the character strip; lower the 4-char token floor to 3. `extractCashtags` is already correct and script-independent. |
| `worker/lib/funnel-log.js` | Right shape (`8 in → 6 recent → 2 replication → 1 eligible`). Promote from `console.log` to a `stage_funnel` table feeding the ops dashboard. |
| `worker/ingest.js` | `MIN_INGEST_VIEWS = 30_000` must come down or τ≈9 min is unobservable and the entire kinetics design is unimplementable. This is a cost decision, not a code decision. |

### Replace

| File | Why |
|---|---|
| `worker/lib/velocity.js` | Two-point deltas (breaks on irregular Δt), views as the primary metric, no author normalisation, hardcoded `a < -500` (not scale-invariant), no hysteresis. Keep `engagement()`'s shape; reweight reposts 2→3, add quotes. Fix `:50` to seed rather than return null. |
| `lib/token-lookup.js` | SOL-quote-first ranking, soft exact-symbol match, best-pair age, `return 0` on missing timestamp, post-hoc liquidity rejection. Every one of these is a live defect. |
| `worker/lib/embeddings.js` | Sparse TF with no IDF. Replace with a real embedding model — for **paraphrase**, which is the actual loss. |
| `worker/lib/subject-entity.js` | "Longest token" fallback reliably picks "absolutely." Replace with the distinctiveness score. |
| `worker/lib/narrative-copy.js` | `if (membersAdded > 0) return true` fires every cycle for every live story. Replace with the drift/growth/cooldown policy. |
| `worker/lib/narrative-title.js` | The hand-rolled `extractJson()` / fence-stripping / brace-scanning path is deleted entirely by structured outputs. |
| Ingest entrypoint | The search loop stops being primary discovery. |
| 22 loose `worker/schema-*.sql` + 11 `apply-schema-*.js` | Not a migration system — no ordering guarantee, no idempotency proof, no record of what is applied to production. Convert to `supabase/migrations/` **before** adding `commit_board()` and the comment triggers. |

### Delete when replacements land

`site/`, `design/` (after extracting the design tokens), root `api/` — and with them the `outputFileTracingExcludes` and `tsconfig.exclude` entries, which are load-bearing workarounds that must not survive the rebuild.

---

## 9. COST

All figures are estimates. Three lines have real variance and are marked ⚠️.

### Beta (internal + ~50 invited, <20 concurrent)

| Line | Config | $/mo |
|---|---|---|
| twitterapi.io — Stream tier (test) | Growth, 20 accounts | 79 |
| twitterapi.io — filter rules | ⚠️ **pending billing test** | 0 – 6,500 |
| twitterapi.io — search + tracking | ~30k units/day | 135 |
| twitterapi.io — CT list (clock B) | 7.5k units/day | 34 |
| PumpPortal (clock A) | free | 0 |
| Claude — coinability + naming + adjudication | Haiku, ~1.5k calls/day | 110 |
| Embeddings | gemini-embedding-2, 25k posts/day | 9 |
| Jupiter Tokens V2 | Developer, 10 RPS | 25 |
| Birdeye | Starter, 8M CU | 99 |
| Helius | free/dev | 0 |
| Supabase | Pro | 25 |
| Vercel | Pro | 20 |
| Inngest | Pro (1-min cadence × 7 stages exceeds Hobby) | 99 |
| Modal (image embeddings, phase 2) | deferred | 0 |
| **TOTAL** | | **~$635** ⚠️ *(+ up to $6.5k if filter rules bill per-poll)* |

### 1,000 DAU (~60 avg concurrent, ~300 peak)

| Line | Config | $/mo |
|---|---|---|
| twitterapi.io — Stream | Enterprise Plus, 500 accounts | 499 |
| twitterapi.io — filter rules | ⚠️ ~170 rules @ 60 s | 0 – 1,100 |
| twitterapi.io — search + tracking | ~65k units/day | 300 |
| twitterapi.io — CT list | | 34 |
| Claude | ~4k calls/day | 250 |
| Embeddings | | 30 |
| Jupiter | Developer | 25 |
| Birdeye | Starter | 99 |
| Helius | paid tier | 49 |
| Supabase | Pro no-spend-cap + Realtime overage (~52M msgs) | 143 |
| Vercel | Pro + modest egress | 45 |
| Inngest | Pro | 99 |
| Modal (image embeddings) | ~5k img/day | 75 |
| **TOTAL** | | **~$1,650** ⚠️ |

### 50,000 DAU (~2,000 avg concurrent, ~10,000 peak)

| Line | Config | $/mo |
|---|---|---|
| twitterapi.io — Stream | Scale, 2,000 accounts | 999 |
| twitterapi.io — filter rules | ⚠️ | 0 – 3,000 |
| twitterapi.io — search + tracking | ~200k units/day | 900 |
| twitterapi.io — CT list (widened to 600) | | 68 |
| Claude | ~15k calls/day, Batch API where possible | 750 |
| Embeddings | 250k posts/day, batch tier | 150 |
| Jupiter | Launch, 50 RPS | 100 |
| Birdeye | Premium (20M CU, 500 WS) | 199 |
| Helius | business | 199 |
| **Realtime — Supabase Broadcast** | ~1.04B msgs + 10k peak conns | **2,685** |
| **Realtime — self-hosted Go fan-out** (alternative) | Fly + logical replication | **150** |
| Vercel | Pro + Cloudflare in front (egress ~$0) | 60 |
| Supabase | Team + storage/compute | 599 |
| Inngest | Pro + overage | 149 |
| Modal | ~30k img/day | 300 |
| **TOTAL — on Supabase Broadcast** | | **~$7,150** ⚠️ |
| **TOTAL — with self-hosted fan-out** | (+2 weeks eng, permanent on-call) | **~$4,600** ⚠️ |

**The three lines that determine whether these numbers are real:**

1. ⚠️ **twitterapi.io filter-rule billing.** If active rules incur the $0.00015 per-call minimum on every `interval_seconds` evaluation, the bulk-backfill tier costs $216–12,960/day and must be deleted from the design. **This is the single highest-variance unknown in the entire proposal and it must be tested first.**
2. ⚠️ **Realtime fan-out at 50k DAU.** $2,685/mo metered vs $150/mo self-hosted plus two weeks. The crossover is ~5,000 average concurrent.
3. ⚠️ **Snapshot cadence.** Board resolution is hard-capped by snapshot cadence, and cadence is the dominant twitterapi.io line. At the cheap config the board updates roughly every 2 minutes — that is a refresh, not a live feed. **"20–90 minutes ahead" survives the cheap config; "live feed" does not.** That is a business decision currently being made by an engineering constant.

**One structural cost note:** shortening ingest from 10 min to 60 s is only free if the per-cycle read budget shrinks by 10× **in the same change**. Ship them separately and the daily budget is exhausted before noon — the same visible symptom as the original outage, from the opposite cause. SLI #7 (`budget_burn`) exists specifically to catch this; ship it first.

---

## 10. RISKS AND OPEN QUESTIONS

### 10.1 Blocking tests — run these before writing production code

| # | Test | Why it's blocking |
|---|---|---|
| **T1** | **twitterapi.io filter-rule billing.** Create 3 rules with impossible-to-match `value` predicates at `interval_seconds` of 1, 60, 3600. Activate, leave 24h with the socket connected, read credit burn. **Zero burn ⇒ matched-only billing ⇒ architecture viable. Burn scaling with 1/interval ⇒ per-poll billing ⇒ the bulk tier is dead.** | Determines whether Tier B exists at all, and swings the sensor budget by up to $6,500/mo |
| **T2** | **Snapshot-age audit (one query).** Distribution of `first captured_at − posted_at`, joined against `posted_at`. Given `MIN_INGEST_VIEWS=30_000`, 10-min ingest, and cold-tier 20-min spacing, the near-certain result is p50 first-observation age well above 9 min, with the 4–30 min bin both **sparse and selected on "hit 30k views fast."** | If τ≈9 min is unobservable, §2.4 is unimplementable without lowering the view gate and tightening young-post cadence — an API-spend and architecture change, not a tuning change |
| **T3** | **Jupiter cold-start fill + coverage.** Over the 60 highest-volume minutes (not a 48h mean): of tokens doing >$50k in their first 10 min, what fraction ever appear in `/tokens/v2/recent` or `/toptrending/5m`, and at what age? At t+60/120/300s after pool creation, what fraction of `stats5m` fields are non-null? | Coverage and cold-start fill decide the coin lane, not latency. A feed 5 s fresh but listing the token 4 min late is useless here |
| **T4** | **Max active filter rules.** Binary-search until `add_rule` errors. Budget ~1,000 rules for 12k handles, not 750 | Determines roster ceiling |
| **T5** | **DexScreener indexing latency for brand-new pairs.** How soon does a fresh pair become queryable? | This, not timestamp fidelity, is the real earliness risk in coin matching |

### 10.2 Everything the adversarial pass knocked down

| Research claim | Verdict | What we do instead |
|---|---|---|
| 12k-account websocket roster at $4.50/day | **False.** Filter rules are polled; `add_user_to_monitor` is $5,999/mo for 12k; fast lane requires ≥5k followers | Three-tier sensor: 500 paid Stream seats + filter-rule backfill (pending T1) + floor-search recall net |
| Per-author z-score with single σ, testable via τ-binned residuals | **False.** Variance scales with expected count (1/√μ), not τ; zeros break log1p; denominator ignores Var(β̂); τ=9 min unobservable | NB-GLM with mean-variance relation, shrinkage prior, empirical quantile thresholds, z as re-ranker not trigger |
| Embedding tier is redundant with keyword tier | **False.** 21.4% embedding-only merges; different metric AND different comparison target | Keep it. Justify real embeddings on **paraphrase**, not redundancy |
| Multilingual clustering is 0% functional | **False.** Cashtag tier is script-independent; X lane is `lang:en`-hardcoded so exposure is TikTok-only | NFD fix (3 lines) + relax `lang:en` if multilingual is a goal |
| Measure cashtag-only merge rate with one query before building IDF | **False.** `cluster_match` records which fired first, not sole trigger — needs a shadow replay. And the denylist already exists unimported | Ship the structural fixes ungated; use DF **persistence**, not single-window IDF (which suppresses fast risers) |
| Ranking base must be EWMA of deltas; classics rank cumulative | **False.** Wilson and Bayesian rank rates; HN decays too | LCB_rate × burst_ratio × age penalty; cumulative as gate; cold-start seeding; benchmark HN as control |
| Jupiter free tier sufficient, no paid vendor | **False.** 60 rpm shared with swaps; no per-wallet data at any tier; Birdeye already a live dependency | $25/mo Developer tier; Birdeye retained for the wallet layer; mandatory cold-start ranking path |
| Supabase per-delivery billing kills WebSockets; use CDN polling | **Mechanic true, conclusion false.** It's a $2.50/M meter ($117/mo at 100 concurrent); polling at 10k viewers is $84k–177k/mo | Broadcast primary with change-driven coalescing; HTTP for hydration and fallback only |
| CDN `s-maxage` collapses N clients to ~1 origin request | **False.** Collapsing is ISR/Image-Optimization only; requests + egress billed on cache hits; `Authorization` header bypasses cache silently; clock-alignment guarantees max-staleness | ISR route if used at all; jitter not align; no auth header; measure `x-vercel-cache` and `Age` |
| TS project references incompatible with Next.js | **False.** They work — but they don't enforce boundaries either | Lint enforcement (`no-restricted-imports` + dependency-cruiser + `server-only`); skip references at this scale |
| Features aren't route-shaped (trade panel, watchlist, coin row) | **False on 2 of 3.** Trade panel is a Jupiter singleton; watchlist renders once | Keep feature folders, justified by the candidate-match stamp and null-state contracts |
| $KANG root cause is a ~5-line fix at `cluster.js:312` | **Partially.** Plumbing right, `lookupTicker` characterisation wrong, KANG returns `found:false` today so the surfacing is `:310`, scope is 40+ lines + migration | The Day-1 patch set in §5.10 |
| Temporal ordering has near-zero discriminative power | **False.** Conditional on ticker, same-ticker mints are separated by **months**. It's the strongest signal available. And `pairCreatedAt` is exact for fresh pairs; the 228-day error is in pair *selection* | Temporal as primary gate; `min(pairCreatedAt)` across all pairs at zero extra cost; **no RPC oracle** |

### 10.3 Where the research disagrees with itself — resolved

| Conflict | Resolution |
|---|---|
| Sensor: "views must never enter the trigger." Ranking: base is view deltas | **Both right about their own job.** Views are lagging and platform-controlled ⇒ useless as a *trigger*. They are the only continuously-available reach measure ⇒ fine as a shrunk *ranking* base. Different latency requirements, different signals |
| Sensor: LLM scoring at ingest is $10/day of waste. Clustering: Haiku adjudicator on 8% of posts | **Both right.** Memeability at ingest is waste (wrong question, 10× cost). Join-adjudication in a narrow uncertainty band is not — but cap `adjudication_rate` at 12% and treat it as the cost dial |
| Clustering wants a birth quorum (2 authors). Sensor sells 20–90 min lead | **Quorum wins, with instrumentation.** The cross-platform exception (X + TikTok promotes at 1 author) plus a `rate_LCB`-based single-author fast-path if the ledger shows regression. **Instrument `promoted_at − first_post_at` from day one** so you can detect it |
| Coin matching de-weights time. Realtime keys `board_rows.entity_id` on mint address | **Both point the same way.** Keying on mint is the transport-level insurance; temporal gating is the semantic fix. Do both — a ticker collision then cannot render the wrong Buy button no matter what the matcher believes |
| Project structure wants a monorepo; realtime wants Inngest invoking Vercel functions | **Compatible.** `apps/pipeline` Phase 1 exposes `POST /stages/:stage/run`; Inngest calls it. Phase 2 moves the scheduler into the service. Vercel crons reduce to a heartbeat |

### 10.4 Bets — labelled, because they are not verified patterns

1. **BET** — 500 paid Stream seats buy enough earliness to justify $499/mo. Validate by 3-week shadow run on the same ledger.
2. **BET** — the branching estimator R̂ from counts alone recovers the decision-relevant supercritical/subcritical signal. Cruder than SEISMIC; will underperform on single-high-degree-resharer cascades.
3. **BET** — quote-to-repost ratio separates "a post is spreading" from "a story is forming." Not from the literature. Instrument it, weight it modestly, let the fitted model decide.
4. **BET** — DF persistence across 14 daily buckets cleanly separates ambient from fast-rising. Untested.
5. **BET** — the birth quorum does not materially damage lead time.
6. **BET** — 50–70% of promoted stories coming back `coinable: false` is the correct rate. The *shape* is not a bet; the band is.
7. **BET** — change-driven coalescing keeps Broadcast message volume within budget at 50k DAU.
8. **BET** — `gemini-embedding-2` @ 768 dims performs adequately on short, noisy, meme-heavy social text.
9. **BET** — the step-detection organic feature (F1) separates bought from organic reach. If drip-feed services defeat it, the entire anti-gaming story rests on the economic argument alone.
10. **BET** — DINOv2 over SSCD for the copy channel. Decided by the eval's ablation, not by argument.
11. **BET** — the rank-stability constants (4% hysteresis, 2-tick dwell, 20 s commit, 90 s pin, 800 ms idle). No published prior art; synthesised from Bloomberg/TradingView/DexScreener behaviour.
12. **BET** — 300 labelled pairs is enough to fit 6 weights. Defensible, wide CIs. Grow to ~800 over three monthly refreshes.

### 10.5 Risks that will hurt

- **The recall-miss metric will produce numbers nobody wants to publish.** Building it is easy; the risk is that it gets quietly dropped from the UI when it's unflattering. If only lead time and precision ship, the earliness claim is not proven, it is cherry-picked. Default filter on `/record` must be **All**, not **Hits** — if a user must select "show misses," the record is marketing.
- **The abstain band is a revenue-visible engineering trade nobody has agreed to.** At 15–30% abstain, roughly one in four stories that *do* have a real coin renders CREATE instead of BUY. **Get the 0.97 precision floor agreed as a product commitment, not an engineering preference**, and put the frozen regression set in CI so a threshold change cannot land silently.
- **Adversarial pressure rises with traffic.** Once deployers learn Insidor's Buy button drives volume, they will stuff source-post URLs into token metadata and reuse post images with colliding generic tickers. Re-read the entire signal set as an adversarial surface at the first sign of gaming.
- **Entity extraction quality caps the whole earliness proof**, not just coin matching. Both clocks resolve through `entity_norm`; a story we normalise as "kang" when the market coins it "kangaroo" registers as a miss even though we alerted correctly. Alias sets must be generous, and the 0.60–0.85 match-confidence review queue needs an actual human weekly.
- **`applyDelta` / the reconciliation reducer is the highest-risk file in the codebase.** A bug there produces a board that is silently *wrong* rather than visibly broken — worse than an outage for a product selling provable earliness. Pure function, exhaustive unit tests, SLI #10 wired from day one.
- **Merge oscillation and ID churn.** Each merge changes a user-visible URL, invalidates cached pages, and repoints comments and watchlists. 3-merges-per-hour cap, permanent 301, audit table — all untested at scale. Watch merge frequency in week one.
- **γ and the view-lag L̂ are time-varying platform properties.** The weekly refit handles drift; it does not handle a step change. **Alarm on week-over-week Δγ** rather than silently refitting through a regime break.
- **Single-vendor dependency on twitterapi.io.** It is a reseller. If X cuts it off, the sensor stops. There is no second source at this price. This is an existential, unmitigated risk.
- **Cost estimates are unquoted.** The chain-data and Stream-tier lines are the widest and least grounded. Get quotes before committing.

### 10.6 Judgement calls research cannot settle — founder decisions

These are product, legal, and ethical, not technical. Each needs a decision before or during build.

1. **Do you render a Buy button at all for a coin you did not verify?** The design says no (abstain band). The commercial pressure will be to lower the threshold. Decide now, in writing.
2. **Regulatory posture on facilitating trades.** `api/swap.js` already forwards a `feeAccount`. Taking a fee on swaps of unregistered tokens is a regulated activity in several jurisdictions. Needs counsel, not a design doc.
3. **KYC and geoblocking.** Not addressed anywhere in the research. Decide before public launch, not after.
4. **The tragedy/death/disaster coinability blocklist.** Viral, uncoinable, and a reputational landmine. Where exactly is the line? A hurricane? A CEO shooting? A celebrity death? The classifier needs a policy, and the policy is not a technical artefact.
5. **Naming coins after private individuals.** Right of publicity and defamation exposure. The design blocks "private individual who did not seek attention," but that boundary is a judgement call that will be litigated at the margins.
6. **Publishing the recall-miss number.** The honest answer makes the product look worse in month one. Is that acceptable? If not, the earliness claim cannot be made at all.
7. **When can "20–90 minutes ahead" be stated in marketing?** The design says: not before the ledger has n ≥ 200 outcomes and Wilson intervals are rendered alongside. Confirm.
8. **Numeric vs categorical confidence in the UI.** The design says categorical, because 73% invites users to do their own thresholding. Some users will demand the number. Hold the line or don't, but decide.
9. **X and TikTok Terms of Service.** Scraping via a reseller, and TikTok ingestion generally. Legal review, and a contingency plan for the reseller being cut off.
10. **"Live feed" as a marketing claim.** At the cheap snapshot config the board resolves at ~2 minutes. Claiming "live" costs ~$970/mo more. Business decision, currently made by an engineering constant.
11. **Whether to build the self-hosted fan-out or pay the Supabase meter at 50k DAU.** $2,685/mo vs $150/mo plus two weeks of engineering and permanent on-call. Depends on team size and runway, not architecture.
12. **How long to run the sensor in shadow mode** before cutting over. The design says 3 weeks, cut over on measured lead time only. Under deadline pressure this will be the first thing compressed.