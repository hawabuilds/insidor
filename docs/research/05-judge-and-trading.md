# THE JUDGE, THE NAMER, AND THE BUY BUTTON
**Three founder objections, answered with arithmetic. Corrected against the adversarial pass.**

> **Read this first.** You said three things: *"CANT NOT HAVE CLAUDE BE THE JUDGE NEED TO FIGURE OUT OTHER MACHINE LEARNING ALGORITHMS THAT SOLVE THIS PROBLEM"*, that naming *"via claude"* will drive cost, and that you want to understand *"how the buying mechanism actually works in the background"*.
>
> You are right about the principle on all three. You are wrong about the size of two of them, and the third — the buying mechanism — turns out to contain the largest unaddressed risk in the product. This document gives you the straight version, including the parts that contradict what you were expecting.
>
> Where the numbers here disagree with earlier research documents, **these are the corrected numbers.** Several earlier figures were off by a factor of four or more in both directions.

---

## 1. THE ANSWER, IN ONE PAGE

**Build the classifier. Do not build it to save money — there is almost no money to save today. Build it because the thing you are actually short of is coverage, and coverage is currently rationed by a spend cap.**

Here is the fact that reframes your objection. `worker/lib/anthropic-budget.js` sets `ANTHROPIC_DAILY_BUDGET` to **$2/day** by default, and it is enforced: `canSpendType()` returns a `budget_skip` result and `setScoringPaused()` flips `worker_pipeline_state.scoring_paused` when the cap is hit. So the LLM judge cannot cost you £3,000/month at 100× volume. **It cannot cost you more than about $61/month at any volume, ever.** What happens instead at 100× is that the judge stops reading posts partway through the day, and the board goes thin. The failure mode is not an invoice. It is silence.

That changes the argument entirely. The question is not *"how do we stop paying $3,456/month"* — that invoice was never going to arrive. The question is *"how do we judge 100,000 posts a day when we can only afford to judge about 3,000."*

### What replaces the Judge

**INSIDOR-JUDGE-V1**: a frozen text embedding + a frozen image embedding + ~38 hand-engineered features, fed to a gradient-boosted tree ensemble with isotonic calibration. It runs in-process in `worker/`, on CPU, with no network call. Roughly **40 ms per text post, ~175 ms with media**, against Haiku's measured p50 of 1.4 s and p90 of 4 s. The trained artefact is about 40 KB of JSON evaluated by a plain tree-walker.

**The safety gate is not part of it and never will be.** Minors, deaths, violence against a named person, identifiable private individuals — that is a separate deterministic rule layer plus a small dedicated classifier tuned for recall, sitting *before* the coinability model. It shares no threshold with coinability and is never traded against coinability accuracy. Section 3 explains why fusing them is the one genuinely catastrophic mistake available here.

### Where an LLM stays, and why

You asked to remove Claude from the judge. That is achievable. Removing Claude from the *product* is not, and you should not want it. Four places, all priced, all bounded by something other than post volume:

| # | Where | Why it cannot be a small model | Volume | Cost |
|---|---|---|---|---|
| 1 | **One-off teacher labelling** | You need ~30–40k labelled examples and you have 60. Nothing else produces them at this price. | 40,000 posts, **once** | **~$14, one time** |
| 2 | **Abstain-band escalation** | The classifier will be genuinely uncertain on 15–25% of posts. That band is where accuracy is contested and where a novel meme format lands. | **Hard cap 100 calls/day, written into code** | $1.83/mo |
| 3 | **Story namer + two-line blurb** | Proposing `$GERALD` for a frog is generative and culturally fluent. It is not classification. A 400M-parameter model is materially worse and this is the thing users are paying for. | ~30 stories/day, bounded by *display*, not by the firehose | $1.50/mo |
| 4 | **Nightly safety retro-sweep** | Re-reads the 30 surfaced narratives at a lower threshold. A second opinion on the only decision that can end the company. | 30/day | $0.60/mo |

**Retained LLM spend: ~$4/month, and it is the same $4 at 1,200 posts/day, 10,000/day and 100,000/day**, because every one of those four is bounded by a constant or by narrative count rather than by traffic. That invariance is the property you are actually asking for, and it matters more than the absolute number.

### What it costs to build

**12–18 engineering days.** At a £500/day contractor equivalent that is roughly **$9,600**. Plus $14 of labelling, plus a RAM bump on the worker box (~$10–16/month — the two quantised ONNX models total roughly 340 MB and will not fit alongside the snapshotter on a 4 GB instance).

### What the product loses

**Roughly 5% of recall, concentrated entirely in genuinely novel jokes** — a post whose humour depends on a referent that did not exist last month has no neighbourhood in the training data. At ~30 narratives/day that is about 1.5 stories/day before mitigation, and about 0.5/day after the abstain band and the weekly retrain catch up. Plus the free-text `reason` string, which gets replaced by feature attributions and a nearest-neighbour ("closest to the $MOODENG post") — arguably better, because the user can click it.

**What it gains is larger.** The judge today reads only the fastest movers because each call costs money and seconds. A free 40 ms classifier can read everything. That is a coverage gain the LLM path cannot buy at any price short of tearing the budget cap out, and the budget cap is there for a reason.

### The part you will not like

**At 1,200 posts/day this saves you approximately nothing.** The honest arithmetic is in Section 2, and it says: the current judge costs about **$20/month uncapped, $61/month at the cap**, and the self-hosted replacement costs about **$14–20/month** once you include the box and the retained LLM calls. The saving is a rounding error against $9,600 of engineering.

**Payback at today's volume: never. At 10× volume: about 64 months. At 100×: about 5.8 months.**

So the case for building it now is not cost. It is three other things: (a) the training data is perishable — X media URLs rot, TikTok covers expire, deleted posts vanish, and you cannot buy this history back later at any price; (b) with a cheap tier in place an Anthropic outage degrades the board instead of emptying it, which is a failure this repo has already experienced from the ingest side; (c) a model needs three weeks of shadow validation before cutover, and the volume that makes it necessary will arrive about six weeks before you notice.

**If you want a cost decision today rather than a capability decision, the answer is different and much cheaper: downsample the TikTok thumbnails.** `worker/lib/meme-score.js` sends the cover image unresized, up to 5 MB, which pins it at or near Haiku's ~1,600-token image cap. A TikTok judge call is ~$0.0022 against ~$0.0006 for a text call — **3.7× — and virtually all of that gap is the image.** Resizing to the smallest edge that still supports "is there one nameable subject in frame" cuts the most expensive call in the system by roughly half, and it is an afternoon of work with `sharp`. Do that regardless of what you decide about the classifier.

---

## 2. THE COST ARITHMETIC

### 2.1 What a call actually costs

Claude Haiku 4.5 is **$1.00 per million input tokens, $5.00 per million output tokens**. `worker/lib/meme-score.js:14` pins `claude-haiku-4-5-20251001`; `worker/lib/anthropic-pricing.js:8-9` hardcodes exactly those rates.

There are **three** billed call types, not one. `CALL_TYPES = ['score_x', 'score_tt', 'title']`, and `TITLE_BUDGET_PCT = 0.25` reserves a quarter of the daily budget for cluster titling. Any cost model that talks about "the judge" and omits `title` is understating total AI spend by up to a third.

Measured from the shipped prompts:

```
score_x   SYSTEM_PROMPT_X is 843 chars  ≈ 230 tok
          + user block (handle, text, filter label)  ≈  70 tok
          = ~300 tok in ·  ~60 tok out (the JSON reply)

          300 × $1.00/1,000,000  = $0.000300
           60 × $5.00/1,000,000  = $0.000300
                                   ─────────
                                   $0.000600   →  $0.60 per 1,000

score_tt  SYSTEM_PROMPT_TT is 1,545 chars ≈ 420 tok
          + user block                     ≈  80 tok
          + thumbnail                      ≈ 1,400 tok
          = ~1,900 tok in ·  ~60 tok out

          1,900 × $1.00/1,000,000 = $0.001900
             60 × $5.00/1,000,000 = $0.000300
                                    ─────────
                                    $0.002200   →  $2.20 per 1,000

title     ~350 tok in · ~60 tok out       = $0.000650   →  $0.65 per 1,000
```

**The image is the whole story on the TikTok path.** Haiku 4.5 sits on the pre-4.7 vision tier: the long edge caps at 1,568 px and tokens run at roughly (width × height) ÷ 750. A 720×1280 cover is ~1,229 tokens; a 1080×1920 cover downscales to 882×1568 and costs ~1,600. `fetchThumbnailBase64` does **no** resizing — it accepts up to `THUMB_MAX_BYTES` = 5 MB raw — so every TikTok call sits near the cap. That single unresized image is ~74% of the input on the most expensive call in the system.

Two things you cannot use to fix this:

- **Prompt caching does not fire.** Haiku 4.5's minimum cacheable prefix is 4,096 tokens. The system prompts are 230 and 420 tokens. Adding `cache_control` would silently no-op — `cache_creation_input_tokens` comes back 0, no error. There is no caching saving available at this model tier.
- **The Batch API's 50% discount is unusable in the hot path.** Batches take up to 24 hours against a product whose entire claim is a 20-minute lead. Batch is for offline labelling and nightly evaluation only. That is exactly what makes the one-off labelling run in §2.3 so cheap.

*One caveat the repo does not yet reflect: `worker/lib/anthropic-budget.js` carries `COST_SCORE_X = $0.003` and `COST_SCORE_TT = $0.012` as fallback constants, 4–5× the figures above, explicitly commented "Fallback estimates until measured." If those constants are what the budget guard is using, the guard is 4–5× over-conservative and is pausing scoring at roughly a fifth of the affordable throughput. That is a live bug costing you coverage right now, and it is one query to confirm.*

### 2.2 The LLM path at three volumes

Assume 75% of admitted posts reach the judge (the rest are killed by the arrival prior and the pre-score gates), a 5% TikTok-vision rate (`DEFAULT_TT_VISION_RATE = 0.05`), and an 8% title rate.

**At 1,200 posts/day → ~900 judged:**
```
X     855 × $0.000600 = $0.5130
TT     45 × $0.002200 = $0.0990
title  72 × $0.000650 = $0.0468
                        ────────
                        $0.6588/day  →  $20.05/month
```

**At 10,000 posts/day → ~7,500 judged:**
```
X    7,125 × $0.000600 = $4.275
TT     375 × $0.002200 = $0.825
title  600 × $0.000650 = $0.390
                         ───────
                         $5.490/day  →  $167.11/month
```

**At 100,000 posts/day → ~75,000 judged:**
```
X   71,250 × $0.000600 = $42.75
TT   3,750 × $0.002200 = $ 8.25
title 6,000 × $0.000650 = $ 3.90
                          ──────
                          $54.90/day  →  $1,671/month
```

**Except none of those last two numbers will ever appear on an invoice, because the cap stops them.** `ANTHROPIC_DAILY_BUDGET` defaults to $2/day, `assertStartupBudget()` refuses to boot if the projection exceeds it, and `isDormant()` halts scoring when it is hit. So:

| | 1,200/day | 10,000/day | 100,000/day |
|---|---|---|---|
| **Uncapped LLM cost** | $20/mo | $167/mo | $1,671/mo |
| **What you actually pay** | $20/mo | **$61/mo (capped)** | **$61/mo (capped)** |
| **What you actually lose** | nothing | **~63% of posts go unjudged** | **~96% go unjudged** |

**That is the real cost curve, and it is a coverage curve, not a spend curve.**

One sensitivity worth flagging: the TikTok share is the lever. If TikTok grows from 5% to 30% of judged posts, the 100× figure goes from $1,671 to **$2,584/month** — the vision path is 3.7× the text path per call, so mix matters more than volume does.

### 2.3 The ML path at three volumes

**Serving compute is genuinely free at every volume this product will reach.**

```
Text encoder, int8 ONNX, ~40 ms/post:
    1,200/day  ×  0.040 s =     48 s/day
   10,000/day  ×  0.040 s =    400 s/day  =  6.7 min
  100,000/day  ×  0.040 s =  4,000 s/day  = 66.7 min

Image encoder ~70 ms + OCR ~90 ms, on the ~5% with media:
  100,000/day × 0.05 × 0.160 s = 800 s/day = 13.3 min

Total at 100× ≈ 80 minutes/day of one core.
A 2-vCPU box supplies 2,880 core-minutes/day → 2.8% utilisation.
```

Marginal cost per post is not "small." It is zero to four decimal places. The box is a fixed cost that does not move across two orders of magnitude of traffic.

**Fixed cost:** the worker already runs. What changes is memory — two quantised ONNX models plus an OCR engine is roughly 340 MB resident, which does not fit comfortably beside the snapshotter and cluster engine on a small instance. Budget a step up: **$10–16/month.** (Do not budget a GPU. See §2.5.)

**Retained LLM, from §1:**
```
Story namer + blurb   30/day × $0.000650   = $0.0195/day
Escalation, HARD CAP 100/day × $0.000600   = $0.0600/day
Nightly safety sweep  30/day × $0.000650   = $0.0195/day
                                             ──────────
                                             $0.0990/day  →  $3.01/month
```
**Identical at 1,200, 10,000 and 100,000 posts/day.**

**One-off labelling, 40,000 posts via Haiku 4.5 Batch (50% off → $0.50/$2.50 per MTok), at a 95/5 text/vision split:**
```
38,000 text : in  38,000 × 300 =   11.4 M tok × $0.50/M = $ 5.70
              out 38,000 ×  60 =    2.28 M tok × $2.50/M = $ 5.70
 2,000 image: in   2,000 × 1,900 =  3.80 M tok × $0.50/M = $ 1.90
              out  2,000 ×  60 =    0.12 M tok × $2.50/M = $ 0.30
                                                           ──────
                                            TOTAL ONE-OFF  $13.60
```

If you want a stronger teacher, Sonnet 5 on the same run is **$27.20** at the introductory $2/$10 rate — **which expires 2026-08-31, thirty days from now.** After that it is $3/$15 and the same run costs $40.80. Two things to set explicitly if you go that route: `thinking: {type: "disabled"}` (Sonnet 5 thinks by default and thinking tokens bill at the *output* rate — this can be a one-to-two-order-of-magnitude error in a classifier cost model), and note that Sonnet 5 uses a newer tokenizer that produces ~30% more tokens for the same text.

Cheaper teachers exist and are worse ideas: GPT-5-nano in batch is ~$0.74 for the text portion, Gemini 2.5 Flash-Lite ~$1.03. Saving $13 on the artefact that sets your student's accuracy ceiling is the wrong trade. Use Haiku or Sonnet.

### 2.4 The comparison, and which side of the crossover you are on

| | 1,200/day | 10,000/day | 100,000/day |
|---|---|---|---|
| LLM path (uncapped) | $20/mo | $167/mo | $1,671/mo |
| **ML path** (box + retained LLM) | **$13–19/mo** | **$13–19/mo** | **$13–19/mo** |
| Monthly saving | ~$4 | ~$150 | ~$1,655 |
| One-off: labelling | $14 | $14 | $14 |
| One-off: engineering (12–18 days) | ~$9,600 | ~$9,600 | ~$9,600 |
| **Payback** | **never** | **~64 months** | **~5.8 months** |

**You are decisively on the left of the crossover, and I am not going to dress that up.** At 1,200 posts/day the entire LLM judge costs about as much as a takeaway. Two to three weeks of engineering to save four dollars a month is not a cost decision, and if the plan is pitched internally as cost reduction it deserves to be torn apart.

Three things justify building it anyway, and they are the only three:

1. **The labels are perishable.** The Stage-0 backtest plus a $14 labelling run produces the training set. Post text, engagement curves, thumbnails and mint timings are being written today and will be gone in six months. You cannot buy this later.
2. **The cap is already binding on coverage, and it binds harder every week.** Every post the judge does not read is a narrative you cannot surface. That is the product.
3. **Three weeks of shadow validation is on the critical path.** By the time the volume makes this urgent, it is too late to start.

**What is emphatically *not* justified: a GPU.** A dedicated L4 is roughly $516/month on demand, ~$160/month spot, against a $61/month capped API bill. Self-hosting a generative model is **2.6–8.5× more expensive than the entire thing it would replace**, and the obvious candidate for it — Qwen3-32B — is a text-only causal language model that cannot process the TikTok cover image at all, which is precisely the path that costs the most. The encoder-plus-trees design runs on CPU on the box you already have. That is the whole point.

---

## 3. THE CLASSIFIER

### 3.1 Decompose "coinable" first — most of it is not a language problem

| # | Sub-signal | Needs language understanding? | How to get it |
|---|---|---|---|
| S1 | One concrete nameable subject | No | NER + noun-phrase head. `n_distinct_entities == 1` is the strongest single hand feature |
| S2 | Proper noun / coinable common noun | No | POS + capitalisation + generic-ticker denylist — **already exists** in `worker/lib/nameability.js` |
| S3 | **Absurd vs earnest** | **Yes** | Learned representation. One of two hard bits. |
| S4 | Visual anchor | No | `has_media`, already in the arrival payload |
| S5 | Recurring character vs one-off event | No | Entity document-frequency over 7/30-day windows — already computed for clustering |
| S6 | News / politics / sport / disaster | No | Outlet-handle gazetteer + politician/team entity lists + disaster lexicon. Highly lexical. |
| S7 | Playful register | Mostly no | Lowercase ratio, emoji density, elongation `/(.)\1{2,}/`, interjections, missing terminal punctuation |
| S8 | **Survives as a still image with a name attached** | **Yes** | Learned. Correlates with S1 ∧ S4 ∧ ¬S6 but is not reducible to it. |

**Only S3 and S8 need a neural component.** That is exactly the shape that makes this work: hand features carry the structure and the negative class; the encoder carries the two irreducible judgements.

It is also why a pure hand-feature model fails. A gradient-boosted tree on 38 scalars will reject news, politics and sport almost perfectly — that is a lexical problem with a gazetteer solution — and will be completely blind to whether something is funny. Expect a 20-point drop. Correct as a *component*, wrong as the *system*.

**The TikTok test survives the migration.** `SYSTEM_PROMPT_TT` currently asks: *"Would this still be funny or deployable as a still image with a name attached?"* That is real product insight and it is preserved structurally — as the interaction between the image embedding, a thumbnail-sharpness feature (is there a subject in frame?), and the single-dominant-entity feature. A video that only works as choreography has a blurry cover and no dominant entity, and the model learns that from data. The question also stays in the *teacher* prompt, so the student learns it as a supervised target rather than losing it.

### 3.2 The model

```
INSIDOR-JUDGE-V1 — replaces pipeline stage ⑤ QUALIFY
Runs in-process in worker/. No network call. No vendor.

FEATURES
  F_text   frozen text encoder, 768-d → PCA 256-d, ONNX int8, seq_len 96
  F_img    frozen vision encoder, 768-d → PCA 256-d
           ZERO VECTOR + has_image=0 when absent. Never impute a mean —
           absence is signal, which TT_NO_THUMB_CAP=0.4 already concedes.
  F_ocr    OCR of the thumbnail → same text encoder → PCA 128-d
           On TikTok the on-screen caption IS the meme more often than the
           audio. Probably worth more than the raw image embedding, and free.
  F_hand   38 scalars (below)

  X = [256 | 256 | 128 | 38] = 678-d

CLASSIFIER
  Gradient-boosted trees. ~400 trees, depth 6, lr 0.05, min_leaf 40,
  scale_pos_weight = n_neg/n_pos.
  Monotone constraints (4): is_news_outlet ↓ · n_distinct_entities ↓ ·
                            has_media ↑ · entity_novelty ↑
  Isotonic calibration on a held-out fold → p_coinable is an actual
  probability, which the current meme_score is not — which is exactly why
  MEME_MIN_X=0.6 and MEME_MIN_TT=0.75 had to be hand-tuned apart.

  Artefact ≈ 40 KB JSON, walked by ~50 lines of JS in under 1 ms.

DECISION
  p < 0.22          REJECT
  0.22 ≤ p < 0.55   ABSTAIN → escalate, HARD CAP 100/day in code
  p ≥ 0.55          ACCEPT
```

**Why trees on frozen embeddings rather than a fine-tuned encoder.** Below roughly 5,000–20,000 domain-shifted labels, frozen embeddings plus a tree ensemble beats full fine-tuning, needs no GPU, trains in about 90 seconds on CPU, and gives per-feature attributions for free — which the ops dashboard needs and a fine-tuned encoder cannot provide. Revisit when the labelled set passes 20,000; expect 1–3 points of AUC-PR for 12 minutes on a rented GPU.

**One caveat you should know about, because it is the most likely way the model underperforms.** The published evidence that a small model can match an LLM on classification with only tens of labels per class comes from work using embeddings from a *frozen ~7B generative model*, and the same paper's ablation shows that small sentence-embedding models collapse precisely on the sarcasm-heavy and jargon-heavy tasks — the ones nearest to memecoin culture. So do not assume a 150M encoder inherits that result. **Benchmark two encoder sizes on the same labels before committing**, and be prepared to pay for the larger one. It is still free to serve.

### 3.3 The 38 hand features

```
ENTITY / NAMEABILITY (8)
  n_person_ents · n_org_ents · n_gpe_ents · n_product_ents
  n_distinct_ents · has_single_dominant_entity
  longest_propn_span_len · top_entity_in_GENERIC_TICKERS

NOVELTY (5)   [already computed for clustering — free]
  max_entity_df_30d · min_entity_df_30d
  entity_novelty = 1 − persistence(top_entity)
  n_entities_first_seen_7d · cashtag_present

REGISTER (11)
  lowercase_ratio · caps_run_max · emoji_count · emoji_density
  exclaim_count · question_count · elongation_count
  interjection_count (bruh|lmao|omg|wtf|nah|bro|fr|deadass)
  ends_without_punct · avg_word_len · quote_char_present

NEGATIVE-TOPIC (6)
  news_outlet_handle (gazetteer) · politician_entity_hit
  sports_team_entity_hit · disaster_lexicon_hit
  url_to_news_domain · breaking_prefix

STRUCTURAL (5)
  char_len · token_count · is_thread_continuation
  is_quote_tweet · hashtag_count

MEDIA (3)
  has_media · media_is_video · thumbnail_laplacian_var
```

`thumbnail_laplacian_var` is the sharpness measure the create-flow already specifies for frame selection. Reusing it costs nothing and is a direct proxy for "is there a subject in frame" — the mechanical half of the TikTok test.

### 3.4 Where the labels come from

Five sources. Four of them are free.

**D_free — already paid for, already in the database.** `post_meme_scores` (created at `worker/schema-score.sql:3`, written at `worker/score.js:99`) persists every judgement the LLM has ever made: `meme_score`, `reason`, `suggested_ticker`, `suggested_name`, `model`, `raw`, `scored_at`. **Nobody is exporting it.** Run `select count(*), min(scored_at), max(scored_at) from post_meme_scores` before anything else — if that number is large, a chunk of the labelling run is already done and paid for.

**D_gold — the Stage-0 backtest. Outcome-grounded, never LLM-labelled.** For each of the top Solana memecoins of the last 18 months, trace back to the source post. Then — and this is the whole trick — sample the negatives from *the same virality tier*: the highest-view posts in the same 6-hour window that produced no coin. Sampling negatives at random teaches the model "viral," not "coinable."

**D_teacher — the $14 batch run.** Active-sampled, not random: 10,000 at random for calibration, then three rounds of 10,000 each drawn at maximum entropy under the current model. Ask for the `reason` field as well as the label — rationale-augmented distillation is materially stronger than label-only, and the prompt already emits it. Do not drop it.

**D_eval — human, frozen, never trained on.** This is the one that is currently missing and that everything else depends on. What exists today is `apps/pipeline/eval/score/panel.jsonl` at **60 posts**. That is not enough to measure anything: at n=60 the 95% confidence interval on a single accuracy figure is about ±9 points, and on the *difference* between two models it is roughly ±13 points. Any "is the classifier within 3 points of the LLM?" question is unanswerable at that size — the answer is noise.

**Grow it to 400–600 posts, stratified inside the 0.30–0.70 band, with two labellers on a 150-post overlap.** If Cohen's κ comes back under 0.7, the label *definition* is wrong, not the model, and no amount of training fixes it. This is the same protocol and the same sitting as the 300-pair clustering gold set already budgeted.

**D_outcome — continuous, free, and compounding.** Every surfaced narrative either does or does not produce a coin that trades. Clock A (PumpPortal `subscribeNewToken`, free) already writes every Solana mint; `narrative_tickers.match_state` and the story⇄mint matcher already exist for the earliness metric. The training label is a byproduct of a table that must exist anyway. Marginal cost: one nightly SQL job. At 30 narratives/day that is **210 labels per week, arriving forever, at zero cost.**

That last one is the actual argument, and it deserves to be stated plainly:

> **An LLM judge is a static asset that gets more expensive as you grow. An ML judge is an asset that gets better as you grow, for free.** After a year the classifier has seen ~11,000 real market outcomes on exactly your distribution. The LLM has seen none, and cannot.

**Two things about labels that are easy to get wrong and expensive to discover late:**

*Count labels per class, not in total.* The published "60–75 examples" figure is per class on balanced data. Coinability is severely imbalanced. If the positive rate is 1%, then 30,000 posts yields ~300 positives — which is marginal, not comfortable. At 0.1% it yields 30 and the whole plan fails. **Measure the base rate before declaring the label budget sufficient**, and size against 200–400 *positive* examples, not 30,000 rows.

*Use three tiers, not two.*
```
y = 1.0   matched mint within 6h AND peak FDV ≥ $100k
y = 0.5   matched mint within 6h AND peak FDV <  $100k
y = 0.0   no matching mint within 24h
```
The 0.5 tier is load-bearing. The judge's question is *"could someone make a coin out of this"* — **not** *"would that coin succeed."* Collapse it to binary and you have quietly retrained the model to predict market outcomes, which is a different and far harder problem, and it will start rejecting correct-but-unlucky calls. This is the easiest mistake in the design to make and the hardest to detect from metrics.

Also: "did not become a coin" does not mean "was not coinable" — it may mean nobody minted it. That is positive-unlabelled data, not clean binary. Fit it with a positive-unlabelled loss or a class-prior correction, with the prior estimated from the teacher-labelled subset. Plain binary cross-entropy on this will systematically suppress coinability predictions, and the model will look pleasingly conservative while being wrong.

### 3.5 The safety gate — three layers, none of them the coinability model

Different problem, catastrophically different cost of error. A false negative here is not a metric regression; it is a company-ending event.

**Layer 1 — deterministic rules, tuned to over-trigger.** Death and violence lexicon (~400 terms, multilingual). Minor lexicon including `\b(1[0-7]|[1-9])[- ]year[- ]old\b`. Private-individual heuristic: a PERSON entity with global 30-day document frequency below a threshold is not a public figure. News-outlet handle gazetteer routes to a news path with no coin CTA, ever. **Tune to recall ≥ 0.99 on a hand-built adversarial set and accept the precision cost.**

**Layer 2 — a small dedicated classifier with its own training data.** Four-way multi-label: `{death_violence, minor_present, identifiable_private_individual, ongoing_disaster}`. Positives must be *deliberately collected* by reverse-searching the lexicons over 90 days of posts, not sampled — they are under 2% of admits. **Operating point: recall 0.98, accept precision ~0.30.** At 1,200 posts/day and a 2% true rate that gates ~80 posts: 24 true, 56 false. Out of 1,200, a fine trade.

**Layer 3 — LLM adjudication on the intersection only.** A post reaches an LLM *and* a human queue when Layer 1 or 2 flags it **and** `p_coinable > 0.7` — high risk ∧ high value. Volume: ~12 posts/day.

**Four independent nets catch a false negative:** the promotion quorum (a story needs 2 distinct authors before it can display, which already exists and already catches single-post horrors); the nightly retro-sweep at a lower threshold; a one-tap user report that sets `needs_review = true` and suppresses the coin CTA immediately — **optimistic suppression, human unsuppression**; and an entity-key denylist kill switch.

**Two rules, non-negotiable: the safety gate is never trained on the coinability label, and never shares a threshold with it.** Fuse them and an accuracy win on coinability can silently degrade safety with nothing in the metrics to show it. Its false-negative rate goes on the ops dashboard weekly.

And be clear-eyed: **the gate will eventually miss something.** The system must be designed so the miss is caught within hours and retro-suppressible, not so the miss cannot happen. That is achievable. The other thing is not.

### 3.6 The cold start — what runs on day one

**On day one, nothing changes for users.** The LLM still decides everything. Here is the sequence:

| Phase | Days | What decides | What accumulates |
|---|---|---|---|
| 0 | 1–3 | LLM, unchanged | Export `post_meme_scores`. Measure the positive base rate. |
| 1 | 1–10 (parallel) | LLM, unchanged | Stage-0 backtest → `D_gold`. Grow `D_eval` 60 → 400+. |
| 2 | 11–12 | LLM, unchanged | Batch labelling run — **$14, once** |
| 3 | 13–20 | **LLM still decides.** Classifier scores every post in shadow; disagreements logged. | +7,000 labels |
| 4 | 21 | **Cutover gate** — see below | — |
| 5 | 22+ | Classifier decides. LLM sees only the capped abstain band. | +210 outcome labels/week, forever |

**The cutover gate — all four must hold on ≥2,000 shadow decisions:**
1. Precision at the accept threshold ≥ 0.95 against the teacher
2. Recall at the reject threshold ≥ 0.98 against the teacher
3. **Safety-layer recall ≥ 0.99 on the human eval set's flagged subset — hard gate, no override**
4. Abstain band ≤ 25% of traffic

If the band exceeds 25%, the features are weak and the cascade saves nothing. That is the same diagnostic already applied to clustering's `adjudication_rate` ("if > 12%, features are weak"). Reuse the instrument.

**Kill switch: one environment variable reverts to LLM-on-everything. Keep it for a year.**

Two evaluation rules that will otherwise produce a beautiful and completely false number:

- **Never use random cross-validation.** One viral moment produces dozens of near-duplicate posts on the same day; a random split puts near-duplicates on both sides. Expect 5–15 points of inflated AUC. Group by calendar date, and report the **temporal holdout** (train weeks 1–8, test week 9) as the headline, because that is what production is.
- **Report AUC-PR, not ROC-AUC.** The positive rate is low; ROC-AUC flatters imbalanced problems. Also report recall at the operating precision, and the abstain-band width, which is the cost dial.

### 3.7 Serving and retraining

```
worker/lib/judge/
  encode-text.js    onnxruntime-node · int8 · batch 32
  encode-image.js   onnxruntime-node · int8 · batch 8
  ocr.js            OCR on a 224px crop
  features.js       38 hand features · pure JS
  model.js          tree walker · <1 ms · zero deps
  policy-gate.js    Layer 1 rules + Layer 2 head
  escalate.js       abstain band + policy intersection, HARD DAILY CAP
```

**Cadence.** Nightly: outcome harvest, per-feature drift report, abstain-band width. Weekly: challenger trains on everything through Friday, **promoted only if** it holds on the frozen eval set (≥ champion − 0.005) **and** improves on the last 14 days of outcomes (≥ champion + 0.01). Otherwise discarded and an alert fires. Quarterly: refresh the eval set with 200 new human labels, retire the oldest 200.

**If frozen-set AUC falls while recent-outcome AUC rises, that is a feedback spiral. Halt promotion automatically. Do not wait for a human to notice.**

**Explainability, replacing the LLM's `reason` string:** top-3 feature attributions rendered as chips (`one named subject` · `playful register` · `not news`) plus a nearest neighbour from the training set — *"closest to the $MOODENG post."* The nearest neighbour is arguably better than a generated sentence, because it is verifiable.

---

## 4. THE SELECTION-BIAS PROBLEM

**The model decides what gets surfaced. Surfaced items generate the outcomes. The outcomes train the next model.** Left alone, that loop converges to a confident, narrow, progressively wrong classifier — and every internal metric will look like it is improving the entire time. This is the flaw that quietly degrades systems like this, and it is not hypothetical: it is the default behaviour of any policy trained on its own logs.

Four mechanisms. All four are required; three of them alone are cosmetic.

**1. ε-exploration on a shadow lane — the only one that actually fixes it.**
Reserve **5% of daily judge slots (≈60 posts/day) for posts sampled uniformly from the admitted pool, ignoring score.** They go down a shadow lane: never shown to users, but fully coin-matched against Clock A. This yields unbiased outcome labels across the *entire* score range, including the region the model currently rejects — which is the only region where you can learn that it is rejecting wrongly.

Cost: **zero.** Same pipeline, no extra API calls. Without this, the propensity weighting in (3) has no support to correct over and is decoration.

**2. Reverse-matching — free, bias-free positives, and the most underexploited asset in the design.**
A nightly job already specified for the earliness metric scans `coin_mints` for mints reaching ≥$100k FDV that reverse-match to entities the system never alerted on. **Every hit is a labelled false negative from exactly the region where the model is wrong.** That job is being built anyway. It doubles as the highest-value training signal in the system, at no marginal cost. Wire its output into the training set on day one.

**3. Clipped inverse-propensity weighting.**
Log the model's score `p̂` at decision time on every post, whether or not it was surfaced. Weight surfaced-outcome examples by `1 / max(p̂, 0.05)`. This is only valid *because* (1) makes the logging policy stochastic — with a deterministic policy the correction is undefined.

**4. Frozen sets gate every promotion.**
The human eval set and the backtest holdout are re-scored on every retrain and are never trained on. They are the only measurement that does not move with the policy. Combined with the halt-on-divergence rule in §3.7, this is what turns a spiral from a slow quality slide into an alert.

**One more source of censoring worth naming.** Outcomes exist only for posts that were surfaced *and* for which a coin was matched. Coin matching itself has a confidence threshold and an abstain band. So the label set is censored twice, and the effective number of usable labels is strictly below the nominal count by an unknown factor. Hold out the ε-exploration slice as an uncensored control and compare — that difference *is* the bias, measured rather than assumed.

---

## 5. NAMING AND THE TWO-LINE SUMMARY

You said naming "via claude" will drive cost. **You are right about the direction and wrong about which call is doing it — and the call that is actually costing you is not the namer.**

### 5.1 The actual defect

Naming and classification were welded into one call because `meme-score.js` emits `suggested_ticker` and `suggested_name` from the same request that classifies. That prices a job that needs to run ~30 times a day at the volume of a job that runs ~900 times a day.

Worse: `worker/lib/narrative-copy.js:15` regenerates the title and blurb whenever `membersAdded > 0` — i.e. every cluster cycle, for every live story. At a 60-second cadence with the 8-per-cycle cap that is **11,520 calls/day**. Because the cap is a flat 8 per cycle, **that spend is scale-invariant: identical whether you have 30 stories or 3,000, and allocated to whichever 8 stories the iteration order happened to reach.**

It does not show up as a big bill, because `TITLE_BUDGET_PCT` caps titles at 25% of $2/day. It shows up as **titles consuming their entire quarter of the daily budget on arbitrarily-chosen stories and then stopping** — and as stories whose titles change 40 times over their life instead of 1–3.

**This is a trigger bug, not a model bug. Fixing it costs one deleted `if` statement.**

### 5.2 The tiered split

| Tier | Runs on | Volume/day | Engine | Cost/day | Cost/mo |
|---|---|---|---|---|---|
| **1 — every admitted post** | 1,200 | deterministic harvest: cashtag → OCR → NER → head-noun → n-gram. **No LLM.** | **$0.00** | **$0.00** |
| **2 — promotion event only** | 30 stories × ~2.5 regens = **75 calls** | one structured call: title + blurb + subject + ticker candidates | $0.049 | **$1.48** |
| **3 — user opens the create sheet** | ~30, cached 20 min per story | re-rank of grounded spans | $0.027 | **$0.82** |
| | | | **$0.076** | **$2.30** |

**Naming and blurbs, all in: $2.30/month.** At 10× it is $23/month; at 100× it is $230/month, against a forecast ingestion bill an order of magnitude larger. **Naming was never the cost problem.** It just looked like one because it was riding inside the per-post call.

### 5.3 Tier 1 — the deterministic harvester

Six weighted sources, already specified in `docs/DESIGN.md` §05 and mostly already built:

```
cashtag   1.00   regex over post text AND replies, across the cluster
onscreen  0.85   OCR of the thumbnail — on TikTok the caption IS the meme
ngram     0.80   normalised n-grams (n=1..4) with df ≥ max(3, 0.25·n_posts)
entity    0.75   zero-shot NER over a memecoin subject taxonomy
verb      0.55   lemmatised root verb of the headline clause
```

Scored by distinctiveness × support × length-fit × (1 − collision pressure) × pronounceability × (1 − genericity). Pronounceability needs no model: a character-level 3-gram model fit on English words plus historical pump.fun symbols that cleared $100k FDV, a few hundred KB of counts, microsecond inference.

**Tested against the canonical examples, honestly:**

| Story | Candidates | Rank 1 | Verdict |
|---|---|---|---|
| A frog called Gerald | GERALD, FROG, GARDEN | **GERALD** | Confident. Rare proper noun, repeated in replies, 6 chars, low collision. |
| Grandmother watering a plastic plant for 11 years | PLANT, PLASTIC, GRANDMA | **PLANT** | Right, *only* with a head-noun-over-modifier rule. On raw rarity PLASTIC wins. |
| A ferry captain's last horn | NORDKYST, FERRY, HORN, CAPTAIN | NORDKYST | **Wrong.** The proper noun wins on rarity; HORN — the emotional core — sits at rank 3. |
| A town paying people to move there | NORWAY, ALBINEN, MOVE, TOWN | **NORWAY** | Defensible. |

**Rank-1 correct on 2 of 4 confidently, 3 of 4 with the head-noun rule. Present in the top 4 on all four.** That is the number to plan against, and it is fine, because the shipped UI is "pick one of four with provenance, plus *Try another*" — not "accept one." The design already absorbs exactly the weakness extraction has.

**Where extraction is genuinely worse than an LLM or a human, stated plainly:** emotional-core selection (the ferry case — extraction ranks by rarity, humans rank by what made them feel something); humour; cross-modal jokes (if the cluster says "dog with hat" and the meme is `wif`, extraction finds `DOGHAT` and never `WIF`).

### 5.4 The ranker, and when to stop

The Stage-0 backtest gives you `(cluster corpus → the ticker actually minted)` pairs. That is *ranking* supervision over a closed candidate set — not generation supervision. Fit a small tree model on the ~7 scoring features. **Not** a fine-tuned generator: the realistic label count is 100–400 traceable clusters, which is comfortable for 7 features and hopeless for anything larger, and a generator throws away the closed-candidate-set property that lets the server reject an ungrounded symbol outright.

**Write `namer_run` at form open, not at submit**, with `outcome ∈ {accepted, edited, abandoned, typed_over}`. Abandonment is the strongest negative signal the namer produces, and a schema that only records submissions fits its weights on a hits-only sample — the same selection bias as §4, in miniature.

**Decision rule for whether Tier 3's LLM re-rank ever ships:** measure `P(accepted | deterministic #1)` over the first 200 rows. **≥ 0.60 → do not build it at all.** 0.40–0.60 → ship behind a flag and A/B it. Below 0.40 → the harvester has a bug, not a capability gap.

### 5.5 The blurb — pay per call and stop looking

Templating works for maybe 50–60% of coinable stories, because the coinability filter selects for posts that state one concrete absurd thing plainly, which is also the definition of a good blurb. For the other 40–50% — video-first TikToks whose caption is `#fyp #viral 😭😭`, reaction chains, image macros — there is nothing to extract and a template produces nothing.

**A 40–50% blank rate on the product's most-read text is not shippable**, and unlike a bad ticker the user cannot repair it: they read it and form a belief about the story.

The cost of doing it properly is **$0.59/month** (30 stories/day at $0.00065). Building and maintaining a local summariser to save seven dollars a year is negative-value work by two orders of magnitude.

**The vendor-dependency objection is real and is answered differently: keep `blurbFromPosts()` as a permanent, live fallback and exercise it in CI** — unset the API key in a test and assert the board still renders. An outage then degrades the blurb from *written* to *quoted*, and the board keeps working. That fallback exists today and, precisely because it is almost never hit, it will silently break unless something tests it.

### 5.6 The invariant, and how to keep it

The entire cost argument rests on naming running 30 times a day rather than 1,200. **The first product request for "show a suggested ticker on every post card" silently reinstates a per-post LLM path and the argument evaporates.**

**Route every naming and blurb call through one chokepoint** — `namerCall({trigger, storyId})` accepting only `promote`, `regen`, `create_sheet`, `backfill`, throwing on anything else, with per-trigger daily counters on the ops dashboard and a CI assertion that no other code path can reach it. Without that guard this section has a shelf life of about one sprint.

---

## 6. WHAT THE PRODUCT LOSES

Honestly, in four items. One is real, two are cosmetic, one is a risk rather than a loss.

**1. The genuinely novel joke. Real, and the only real one.**
A post whose humour depends on a referent that did not exist last month has no lexical or embedding neighbourhood in the training data. The LLM has a shot at it; a distilled classifier has almost none. If ~10% of true positives are novel-format and the model catches half of those, that is **~5% of recall ≈ 1.5 narratives/day.** Mitigated by the abstain band — novel items land there almost by definition, and that is what the escalation path is for — and by the weekly retrain, which closes a new format in about 7 days. **Residual after mitigation: ~0.5 narratives/day.**

**2. The free-text `reason`. Cosmetic.** Replaced by feature-attribution chips plus a clickable nearest neighbour. Verifiable, which the sentence was not.

**3. Emotional-core ticker selection. Cosmetic, and bounded by the UI.** The ferry case. Extraction ranks by rarity, so it will occasionally surface a technically correct, emotionally dead ticker at rank 1. The three-alternatives-plus-*Try another* interaction absorbs this, and `namer_run.outcome == 'typed_over'` measures it. If that rate is high, turn on the Tier 3 re-rank.

**4. Blurb voice, if you ever move it local. Do not.** $0.59/month.

### Does the 5% matter, given the abstain behaviour already in the design?

Mostly no, and here is the distinction that decides it.

**An 8-point accuracy drop applied uniformly across the distribution is unacceptable.** At 900 judged posts/day feeding ~30 narratives, that is 2–3 wrong narratives per day, on a product where a false positive means a user buys into a story that is not there.

**The same 8 points applied only to the confident head and tail, with the middle escalated, is under 0.5 narratives/day.** That difference is the entire case for a cascade over a straight model swap. **A straight swap of Haiku for a small encoder is the wrong answer and should be rejected. The cascade is the right one.**

**One place where the abstain band does *not* rescue you, and this is important.** Coinability accuracy is fungible; safety accuracy is not. A 3-point aggregate loss concentrated on the twelve safety cases in the eval panel is not a 3-point regression — it is a coin minted from a photograph of a dead child. At 97% per-post accuracy on that subset, a twelve-item zero-tolerance assertion fails 30.6% of nightly runs (0.97¹² = 0.694); at 99% it fails 11.4%. **Accuracy points cannot be traded on that tier at all**, which is why §3.5 puts it on its own model, its own threshold, its own recall target, and its own line on the dashboard.

### What the product gains

- **Coverage.** The judge today reads only the fastest movers, *because* calls cost money and seconds and the budget cap is real. A free 40 ms classifier removes that constraint. Under the current $2/day cap, moving off the LLM multiplies the judged population by roughly 25×. **That recall gain dwarfs the 5% novel-joke loss and it is not obtainable any other way.**
- **Determinism.** The same post scored twice by an LLM can differ. A tree ensemble cannot. On a product that ranks, unstable scores create board churn — the exact problem §4.3 of the design spends five separate mechanisms fighting.
- **Better news/politics/sport rejection**, not worse. LLMs are inconsistent on borderline "is this a news bulletin" calls; a trained classifier with a monotone constraint on `is_news_outlet` is not.
- **A calibrated probability** instead of a hand-tuned score, which lets `MEME_MIN_X`, `MEME_MIN_TT` and `CROSS_PLATFORM_DISCOUNT` be *derived* from a target precision rather than guessed apart.
- **No vendor in the hot path.** A judge outage cannot empty the board.
- **35× lower latency at p50, 100× at p90**, on the stage between TRIGGER and CLUSTER of a product whose entire claim is being early.

---

## 7. HOW BUYING ACTUALLY WORKS

You asked what happens between tapping Buy and owning the token. The short version: **Insidor never touches money, never touches keys, and never broadcasts anything the user did not sign.** Our server is a quote broker and a relay with three assertions attached. Everything financial happens in two places we do not control — the user's wallet enclave and the Solana ledger.

### 7.1 The full sequence

Timings measured live. Solana slot time measured at 413 ms.

```
T+0        USER taps BUY · 0.1 SOL on $BUN

T+0        BROWSER   POST /api/order {mint, amountLamports, wallet}

T+2ms      OUR SERVER  rate limit; INSERT trade(status='ORDERING', request_id)
                       Money endpoints are Route Handlers, never Server
                       Actions, because rate limiting needs the Request object.

T+5ms      OUR SERVER → JUPITER
           GET /swap/v2/order?inputMint=SOL&outputMint=<mint>
               &amount=100000000&taker=<wallet>
               &referralAccount=<Insidor PDA>&referralFee=50

T+~150ms   JUPITER  (measured 99–277 ms)
           · four routers compete: metis · dflow · okx · RFQ
           · slippage estimator picks a tolerance from live failure rates
           · builds and serialises a VersionedTransaction
           Returns (verified live, 4-minute-old pump.fun mint):
             outAmount              319,045,639,350
             otherAmountThreshold   287,140,790,069   ← exactly −10%
             slippageBps            1000
             feeBps                 10
             signatureFeeLamports   5,000
             prioritizationFeeLamports 245,867
             rentFeeLamports        2,039,280
             lastValidBlockHeight   414,701,064       ← 164 blocks ≈ 68 s
             routePlan              [{label:"Pump.fun", percent:100}]
             inUsdValue 7.1876  outUsdValue 6.7240

T+~155ms   OUR SERVER  store sha256(tx.message) on the trade row; return quote

T+~250ms   BROWSER  ← client-side, and this is the anti-tamper control
           · simulateTransaction against our RPC
           · decode instructions; assert exactly one swap program from an
             allow-list; assert the destination token account is owned by
             this wallet; assert no other writable account
           · render the fee sheet from the SIMULATION, not from our JSON

T+0.4–5s   USER reads it, taps Confirm

T+1–5s     PRIVY (client-side)
           Key is Shamir-split three ways: device share (browser),
           Privy share (secure enclave), recovery share. Any two reconstruct.
           Signing happens in the enclave.
           THE KEY NEVER EXISTS ON OUR SERVER AND NEVER CROSSES OUR WIRE.

T+~5s      BROWSER → OUR SERVER  POST /api/execute {requestId, signedTx}

T+~5s      OUR SERVER — three assertions
           (a) sha256(message) == stored digest        else 409
           (b) staticAccountKeys[0] == bound wallet    else 403
           (c) ed25519 signature verifies              else 400

T+~5s      OUR SERVER → JUPITER  POST /swap/v2/execute
           Resubmitting the same requestId within 2 min is idempotent —
           it polls, it does not double-execute.

T+~5.7s    JUPITER  private broadcast lane, 0–1 block landing

T+~6.1s    SOLANA   leader includes the tx. Returns {status, signature, slot}

T+~6.2s    OUR SERVER  trade.status='submitted'; signature = JUPITER'S answer.
           There is no code path that accepts a signature from a client.

T+6–19s    OUR SERVER  confirm loop. The holding row is written ONLY from
           postTokenBalances − preTokenBalances for (owner == bound wallet,
           mint == requested mint). Null → 'still_confirming'.
           Missing → 'unreadable', renders "—". ABSENT IS NEVER ZERO.
           Finalized ≈ 32 slots ≈ 13.2 s.

T+~19s     BROWSER  "You own 319,045,639,350 $BUN"
```

**Who does what:** our server does rate limiting, quote fetch, digest binding, relay, chain-read confirmation, database writes. The browser does simulation, decode, disclosure rendering. Privy's enclave does key reassembly and one signature, nothing else. Jupiter does routing, slippage estimation, transaction assembly, private broadcast, landing retries. Solana does execution, ordering, finality.

### 7.2 What goes wrong at each step

| # | Failure | Mechanism | What happens to the money | Mitigation |
|---|---|---|---|---|
| F1 | **Price moved between quote and signature** | The quote is a snapshot; the curve advanced. The transaction carries a minimum-output floor. Below it, the swap program aborts. | **Nothing swaps. SOL stays.** User loses base + priority fee: 250,867 lamports = **$0.018** | Re-quote every 10 s while the panel is open; grey out Confirm on a stale quote |
| F2 | **Blockhash expired** | Must land within `lastValidBlockHeight`. Measured window: **164 blocks ≈ 68 s.** A user who reads the disclosure for 90 seconds misses it. | **Nothing happens. Zero fee** — it never executed | Countdown in the UI; auto-requote at T+45 s; never silently resubmit an expired transaction |
| F3 | **Transaction never lands** | Leader dropped it; priority fee too low for the block | SOL untouched, no fee | Jupiter owns retry and the private lane. **This is the single biggest reason not to build routing ourselves** |
| F4 | **Congestion spike** | Priority fee sized at 245,867 lamports with the network idle. Under a graduation storm this goes 10–50× | Higher cost per attempt; more F3 | Show `prioritizationFeeLamports` from the quote as a live line, not a constant |
| F5 | **Sandwich (MEV)** | Solana has no public mempool, but transactions are forwarded to the current leader, and a leader or a co-located searcher can order a block. Attacker buys just ahead of you, pushing you up the curve; you fill worse; they sell immediately after. **Bonding curves are the ideal target because the price function is deterministic, so the extractable amount is computable exactly.** | **Up to the slippage tolerance of notional is extractable. At the measured 1000 bps that is 10% of the trade** — 0.01 SOL on a 0.1 SOL buy | Private broadcast lane; no order-flow sale to external searchers. **But the real control is capping slippage.** Cap at 500 bps, offer a strict 200 bps toggle, and put the number in the confirm sheet at the same visual weight as the price |
| F6 | **Partial fill** | **Does not exist on this path.** A Solana swap is one atomic transaction: it fully succeeds or fully reverts, including split routes | n/a | The analogue is F1 |
| F7 | **Token-2022 transfer fee or hook** | pump.fun's newer mint path uses Token-2022. Extensions can levy a transfer fee or run a hook that alters the amount that actually arrives | **User receives less than quoted, with no error** | Read transfer-fee and extension data before enabling Buy; hard-block on non-zero |
| F8 | **Rug between quote and confirm** | Dev dumps in the six seconds you were signing | Trade succeeds; the asset is worthless | Jupiter's free safety endpoint — verified live, returned `NOT_VERIFIED`, `LOW_ORGANIC_ACTIVITY`, `NEW_LISTING` on our test mint. Render every warning |
| F9 | **Our server 500s after Jupiter accepted** | Transaction is on-chain; our DB says `ORDERING` | User owns tokens but the app says nothing happened | `request_id` and `signature` both UNIQUE → replay is a constraint violation → **409, never a second fill.** Reconciler re-polls by request_id |
| F10 | **Rate limit** | Verified live: the keyless bucket 429'd inside six sequential requests. The free tier is **1 request/second shared across swap, price and token calls** | Buy button unresponsive at exactly the moment a narrative goes hot | Paid developer tier from day one. Never ship on free. Server-side quote cache keyed on (mint, size bucket), 3 s TTL |
| F11 | **"Buy exactly $50 worth" silently fails** | Verified live: exact-output mode on a fresh pump.fun mint returns `Failed to get quotes` while the identical exact-input request succeeds | Feature does not work as specified | Quote exact-input only; convert USD → lamports client-side and label it "about $50" |

### 7.3 What changes for a minutes-old token

**A bonding curve, in plain terms.** An ordinary token trades against a pool somebody funded — there is a counterparty. A brand-new pump.fun token has neither. The pump.fun program *is* the seller, and it sells from a published price schedule: constant-product against virtual reserves, roughly 30 virtual SOL against ~1.07 billion virtual tokens at launch, with ~800 million tokens available on the curve. **Price is a fixed function of how many tokens have already been sold.** Your buy always fills — there is nothing to run out of — but it moves you up the curve, and the next buyer pays more because you bought.

**Graduation.** When the curve allocation sells out (≈$69k market cap), remaining liquidity migrates into a real AMM pool. A fixed 0.015 SOL graduation fee comes out of the migrating liquidity, not out of a user's pocket.

**Three mints under three minutes old, quoted live at 0.1 SOL each:**

| Age | Router | Route | feeBps | slippageBps | All-in cost |
|---|---|---|---|---|---|
| ~2 min | metis | Pump.fun | 10 | 1000 | **6.45%** |
| ~3 min | dflow | Pump.fun | 10 | 1000 | **1.60%** |
| ~4 min | dflow | BisonFi → Pump.fun | 10 | 1000 | **22.72%** |

Four things fall out of that table, and they settle several open questions:

1. **The aggregator routes pre-graduation tokens fine.** The premise that a specialist terminal is needed for new-token coverage is false. This is the fact that decides §8.
2. **A non-default router won two of three.** Hard-wiring pump.fun's own SDK would have lost the better price twice.
3. **The fee came back at 10 bps, not the 50 bps published for tokens under 24 hours old.**
4. **All-in cost varied 14× across three tokens of identical age.** A fixed "0.5% fee" line in the UI is not disclosure. It is a lie by omission.

**Depth, measured on one mint:**

| Size (SOL) | Tokens per SOL | vs linear |
|---|---|---|
| 0.02 | 4.396e12 | — |
| 0.10 | 4.422e12 | +0.6% (better) |
| 0.50 | 4.487e12 | +2.1% (better) |
| 1.00 | 4.269e12 | **−2.9%** |
| 5.00 | 3.780e12 | **−14.0%** |

Under 0.5 SOL the curve is effectively flat and fixed costs dominate. Past ~1 SOL the slope takes over. **Default the buy panel to 0.1–0.5 SOL and warn above 1 SOL.**

Also: chart providers return **no liquidity object at all** for bonding-curve pairs. Absent, not zero. Reading `pair.liquidity.usd` on a pre-graduation token crashes.

**The most important honest finding in this whole section:** the slippage tolerance came back at **1000 bps (10%)** on every fresh mint, against 20 bps on SOL→USDC. That 10% is what makes the trade land. **It is also the exact budget a sandwich bot has to work with.** The auto-slippage that guarantees execution and the sandwich exposure are the same number. It must be displayed, capped, and not hidden behind the words "MEV protected."

### 7.4 The fee stack, worked

At SOL = $71.88, on a **0.1 SOL ($7.19) buy of a 4-minute-old mint**. Every line is from the live quote, not from a doc.

| Line | lamports / bps | SOL | USD | Goes to | Refundable |
|---|---|---|---|---|---|
| Network base fee (1 signature) | 5,000 | 0.000005 | **$0.00036** | burned / validator | No |
| Priority fee | 245,867 | 0.00024587 | **$0.01767** | validator | No |
| Token-account rent deposit | 2,039,280 | 0.00203928 | **$0.14658** | locked in the account | **Yes — on close** |
| pump.fun venue fee 1.25% | 125 bps | 0.00125 | **$0.08986** | 0.95% protocol + 0.30% creator | No |
| Curve slope (true price impact) | ~510 bps | 0.005101 | **$0.36666** | the curve — you own the tokens | n/a |
| Aggregator platform fee | 10 bps | 0.0001 | **$0.00719** | Jupiter | *Documented as waived when an integrator fee is set — **unverified***, see §10 |
| **Insidor integrator fee** | **50 bps** | 0.0005 | **$0.03594** | Insidor 40 bps + Jupiter's 20% cut | No |

**Cross-check against the vendor's own numbers.** The quote reported `inUsdValue 7.1876` and `outUsdValue 6.7240` — a gap of **6.451%**, which equals venue fee (1.25%) + curve slope (5.10%) + platform fee (0.10%). The decomposition reconciles exactly.

```
Non-refundable total (assuming the platform fee is waived):
  0.000005 + 0.00024587 + 0.00125 + 0.005101 + 0.0005
= 0.00710187 SOL = $0.5105 = 7.10% of a 0.1 SOL trade

Refundable on exit:   0.00203928 SOL = $0.1466
Insidor net revenue:  40 bps = 0.0004 SOL = $0.02875
```

**What the confirm sheet must literally say:**

```
You send             0.1000 SOL              $7.19
You receive        ≥ 287,140,790,069 $BUN
Price impact & venue fee             6.45%   $0.46
Insidor fee                          0.50%   $0.04
Network fee                     0.00025 SOL  $0.02
Account rent (refunded on sell)  0.00204 SOL $0.15
Max slippage                        10.00%
──────────────────────────────────────────────────
Worst case you receive   287,140,790,069 $BUN
```

**The 6.45% line is the one that matters and it is the one currently missing.** Measured today it ranged 1.60% to 22.72% across three mints of the same age. Leading with the 0.50% number and letting a user lose 22% breaks the disclosure commitment in fact even if it is met in letter.

**Selling differs in seven ways, one of which costs real money.** Same two calls, mints swapped. (1) The fee still comes out in SOL on both legs, so one referral token account serves buys and sells — do not build per-mint fee accounts. (2) The route label changed from `Pump.fun` to `Pump.fun Amm` between the buy and sell legs on the *same* mint: **the venue can change under you at graduation, which is exactly when volume peaks. Never cache a route.** (3) No account rent on a sell — the account already exists. (4) **Selling 100% should close the token account and refund the 0.00203928 SOL deposit. On a $7 position that is 2% of the trade — larger than every fee combined. If the sell flow does not close the account, users leak this on every exit and will never know why.** (5) No approvals — Solana has no separate approve step. (6) Sells are more slippage-hostile: everyone exits at once and the curve is thinner below you. (7) Exact-output is unavailable, so "sell $50 worth" must be computed as exact-input and labelled approximate.

### 7.5 What could a compromised Insidor server do to a user?

Not "nothing," and I am not going to give you the comfortable answer.

**It cannot** move existing funds, drain a wallet, or forge a signature. It holds no key material and the chain will not accept an unsigned instruction.

**It can return a malicious unsigned transaction from `/api/order`** — one that transfers the user's SOL to an attacker, or sets a token delegate over their holdings — under a button that says "Buy." The wallet will faithfully present it for signature. If the user taps Confirm, they are drained, and they authorised it.

**The sha256 message-digest binding does not stop this.** That check defends against a compromised *client* substituting a transaction. Our server computes both the stored digest and the comparison, so a compromised server simply stores the digest of its own malicious transaction and the check passes. The architecture document currently reads as though that binding is the whole defence. It is not.

A quieter attack: flip the integrator fee from 50 bps to the 255 bps ceiling, or swap the referral account to the attacker's. Users pay five times the disclosed fee and nothing looks wrong.

**Four controls, all client-side, because the server is the threat model:**

1. **Simulate before prompting.** Run the simulation from the browser, derive the balance deltas, and render *those* numbers. Never render the server's JSON as the disclosure.
2. **Decode and constrain.** Assert exactly one swap program from a hard-coded allow-list; assert every writable account is the user's wallet, the user's token account for the requested mint, or a known program account. Refuse anything else.
3. **Re-derive the fee client-side** from the quote's own `feeBps` and compare it against the constant the UI promised. Mismatch blocks, it does not warn.
4. **Fetch the quote in parallel from the browser** where rate limits allow, and diverge-check against the server's. The server stops being the sole source of truth about what the user is signing.

**One invariant to write down and enforce in CI.** Privy also ships server-side signing and scoped session signers — designed to let a server transact "without requiring real-time user interaction." The moment anyone enables those on the trading wallet to build one-tap or auto-buy, **"we never touch keys" becomes false in substance and Insidor's regulatory posture changes.** Never provision a session signer for the trading wallet; fail the build on any import of the server-side signing surface outside an explicitly allow-listed file; and if one-tap is ever wanted, do it with a wallet *policy* (program allow-list plus per-transaction cap), not an unbounded delegated signer.

**And the honest ranking: this is not Insidor's largest custody risk.** The plan to derive and hold addresses for a poster who never consented and never signed up is a money-transmission question, not an engineering one, and it dwarfs everything on this page.

---

## 8. THE PROVIDER DECISION

**Delete "Axiom or Photon" from the deck. Route everything through the Jupiter aggregator, with PumpPortal's local-mode endpoint as a bonding-curve-only fallback behind a flag.**

### 8.1 Why the deck's plan cannot be built

**Axiom publishes no supported developer API.** Its complete documentation index (34 entries) covers onboarding, referrals, fees, swap, portfolio, perpetuals, wallet tracking and tweet monitoring — and contains zero developer, API, integration or programmatic-trading pages. No partner programme is advertised anywhere.

**A private authenticated API does exist** — `api.axiom.trade` and a WebSocket endpoint, with email-and-password login plus email OTP — and two reverse-engineered SDKs target it. **Do not use them, for reasons that have nothing to do with cost:** they authenticate *as the user*, meaning Insidor would hold the user's Axiom password, and one of them additionally requires IMAP mailbox credentials to scrape the one-time code. Storing a user's password and full mailbox access, in a product that touches funds, is not a trade-off — it is a disqualification. Add: no stability contract on undocumented endpoints (a breakage arrives as silent data loss, not a build failure), no rate limits or SLA to design against, and Axiom is a direct competitor who can revoke access at will.

**Photon supports no API integrations either**, per Photon's own documentation, which contains no API, webhook or programmatic-access surface. The "Photon Solana API" that appears in search results is a third-party indexer reading Photon's on-chain router program — read-only historical trade data, not order routing. And that dataset is selection-biased to one front-end's routed flow, so it is unsuitable as a training or evaluation population without explicit reweighting.

### 8.2 The deck's stated reason was also backwards

The deck says Axiom is preferred because it "pays us an integrator fee, where Photon charges the user 1% and pays us nothing." Measured:

| Terminal | User pays | Insidor earns |
|---|---|---|
| GMGN | 1.50% | n/a |
| Photon | 1.00% | **£0 — no API** |
| BullX | 1.00% (0.90% w/ referral) | n/a |
| Axiom | 1.00% gross, 0.95% net | **£0 — no API** |
| **Insidor via Jupiter** | **0.50%** | **0.40% net** |

The 50 bps integrator floor was flagged as a worry. It is the opposite: **it makes Insidor the cheapest terminal in the category — half the price of every competitor — while still paying 40 bps.** Verified by probing the bounds: below 50 and above 255 both return an explicit out-of-range error; 50, 100 and 255 all validate.

### 8.3 The specification

**Primary — Jupiter Swap V2.** `GET /swap/v2/order` → `POST /swap/v2/execute`. Four routers compete on every quote; the non-default router won two of three fresh-mint quotes measured, which is the empirical case for the aggregator entry point over the single-router build endpoint. Setup requires a referral account plus one referral token account for SOL — and because the fee mint priority puts SOL first, that one account covers essentially the entire product on both buy and sell legs.

**Cost:** free tier is 1 request/second and unusable (verified: the keyless bucket 429'd inside six sequential requests, and the limit is a *shared* bucket across swap, price and token calls, so one user mashing the buy panel starves the trending board). **Start on the paid developer tier from day one.**

| | Panels/day | `/order` calls/mo | Plan | $/mo |
|---|---|---|---|---|
| 1× | 500 | 62,250 | Developer, 10 RPS | **$25** |
| 10× | 5,000 | 622,500 | Launch, 50 RPS | **$100** |
| 100× | 50,000 | 6,225,000 | Pro, 150 RPS | **$500** |

**Credits never bind. Requests-per-second binds.**

**Fallback — PumpPortal local mode.** Verified live: returns raw unsigned transaction bytes, so it is non-custodial. It charges the user 0.5% and pays Insidor nothing, so it is a margin hole as well as a degraded experience. **Resilience path only, behind a flag, used when the primary 5xx's or has no route. Never the default.** Do not use its hosted-wallet mode — that is custody.

### 8.4 Why this is the one place renting is unambiguously correct

Revenue against cost, at a mean trade of 0.5 SOL ($35.94) and 40 bps net to Insidor ($0.1438/trade):

```
1×    2,250 trades/mo × $0.1438 =    $324/mo  vs   $25 cost  →  13×
10×  22,500 trades/mo × $0.1438 =  $3,236/mo  vs  $100 cost  →  32×
100× 225,000 trades/mo × $0.1438 = $32,355/mo  vs  $500 cost  →  65×
```

**This is the structural difference from the Judge.** The Judge is a pure cost centre scaling with *posts ingested* — a number you do not control, which grows whether or not anyone trades. The buy path scales with *trades executed*, and every incremental call is attached to revenue exceeding it by 13–65×. **Your instinct to strip vendor dependency out of the hot path is right for the Judge and wrong here.**

The failure surface is also not "call a DEX." It is four routers competing on price in 100 ms, a slippage estimator trained on live failure rates, a private transaction lane that dodges sandwich bots, retry logic bounded by a 68-second deadline, and per-venue support for a bonding-curve program that changes shape every quarter. Rebuilding that means not building the thing that is actually your product.

**Action: six places in the deck still say Axiom/Photon** — `docs/visual/sections/07-build-rent.html` and `docs/visual/insidor-walkthrough.html`. `docs/DESIGN.md:88` is already correct. Every investor or hire who reads the walkthrough currently reads a routing plan that cannot be built.

---

## 9. WHAT TO DO FIRST

Ordered. Steps 1–4 are days, not weeks, and three of them are free.

**1. Run the four measurement queries. One hour. Do this before anything else.**
- `select count(*), min(scored_at), max(scored_at) from post_meme_scores` — how much of the training set is already paid for.
- Pull the real token totals out of `worker_usage` where `source='anthropic'`, reading `input_tokens`/`output_tokens` out of the `cost_breakdown` JSONB per call type (`score_x`, `score_tt`, `title`). **Not from a column, and not from an `anthropic_usage` table — that does not exist.** This settles whether the per-call cost is the $0.0006/$0.0022 derived here or the $0.003/$0.012 fallback constants the budget guard is currently using. **A 4–5× discrepancy means the guard is throttling scoring at a fifth of what you can afford, right now.**
- The observed coinability base rate. This decides whether 30,000 labels is comfortable or marginal.
- The current judge's precision against `coin_mints` over the last 30 days. **The teacher is not ground truth**, and until this number exists, "5 points behind the LLM" has no meaning.

**2. Downsample TikTok thumbnails before sending. One afternoon.** `meme-score.js` sends the cover unresized up to 5 MB, pinning it near the 1,600-token image cap and making the vision call 3.7× the text call. Resize to the smallest edge that still supports the nameability judgement. This is the largest cost reduction available in the system and it requires no ML.

**3. Delete the `membersAdded > 0` regeneration trigger. Hours.** Replace with the regeneration policy already written in `docs/research/03-system-design.md` §3.5. Then add the `namerCall({trigger})` chokepoint with per-trigger daily counters, plus a CI assertion. Target 1–3 title changes over a story's whole life; alert above 4.

**4. Pass X post media to the judge.** The X lane currently sends text only — media is a boolean in the arrival prior and nothing more. Adjacent published work on multimodal meme classification consistently finds the image channel outperforms the text channel by a wide margin on this kind of task. **This is one prompt edit and it may be the largest accuracy gain available anywhere in this document.** A/B it on 200 posts before believing it.

**5. Run the Stage-0 backtest — and start with the two-day spike, not the model code.**
The load-bearing unknown is how many of the top ~400 Solana memecoins of the last 18 months can actually be traced back to an identifiable source post. Historical search is expensive and lossy, and for many coins the "source" is a Discord screenshot or a deleted TikTok. **If the recovery rate is under 20%, the outcome-grounded set is too small to fine-tune on**, the bootstrap becomes teacher-labels-only, and you lose 2–4 points plus the strongest de-biasing signal you have. **Measure the recovery rate first. The answer changes the plan.**

**6. Grow the human eval set from 60 to 400–600 posts. One sitting.** Stratified inside the abstain band, two labellers on a 150-post overlap, κ reported. **Nothing downstream is measurable without this** — at n=60 the confidence interval on a model comparison is roughly ±13 points, which is wider than every difference anyone will want to argue about.

**7. Run the $14 labelling batch.** Active-sampled, `reason` field included, teacher held at Haiku or Sonnet (do not cheapen the teacher to save $13 — it sets your ceiling). If you go with Sonnet, do it **before 31 August**, when the introductory rate expires, and set `thinking: disabled` explicitly.

**8. Build and shadow for three weeks.** Classifier scores every post; the LLM still decides everything; disagreements logged. Cut over only on the four gates in §3.6, with the safety-recall gate non-negotiable.

**9. In parallel, on the trading side:** switch the deck's six Axiom/Photon references to Jupiter; stand up the referral account and **measure `feeBps` on the very first live referral quote** (see §10); ship the client-side simulate-decode-and-constrain controls before the buy button is public; wire the account-close-on-full-sell path so the rent deposit comes back.

---

## 10. OPEN QUESTIONS

Each with the test that settles it.

**1. Is the referral base-fee waiver real?**
Documentation says setting an integrator fee waives the platform's own base fee. Untested — it needs a live referral account. **If false, every user pays 60 bps while the UI says 50, which breaks a disclosure commitment on a product that explicitly promises to disclose fees before confirmation.**
*Test:* read `feeBps` from the response on the first live referral quote. Ten minutes. **Gate the public buy button on it.**

**2. What is the actual per-call LLM cost — $0.0006 or $0.003?**
The derivation here and the repo's own fallback constants differ by 4–5×, and the budget guard is using the constants.
*Test:* the `worker_usage` / `cost_breakdown` query in §9.1. One hour, and it is the highest-value hour available.

**3. How many memecoins trace back to a findable source post?**
The whole cold-start plan rests on 150–300 recoverable positives, and that is a guess.
*Test:* two-day spike over the top ~400 coins by peak FDV. **Below 20% recovery, the plan changes.**

**4. Does a 150M-parameter encoder actually carry S3 and S8?**
The published evidence that small models match LLMs on classification with few labels comes from work using embeddings from a much larger frozen generative model, and the same work's ablation shows small sentence-embedding models collapsing on exactly the sarcasm-and-jargon tasks nearest to meme culture.
*Test:* benchmark two encoder sizes on the same labels during shadow mode, before committing serving code. Cheap, and it may force a larger encoder — still free to serve.

**5. What is the coinability positive base rate?**
Everything about label sufficiency turns on it. At 1% a 30,000-post run yields ~300 positives (marginal). At 0.1% it yields 30 (fails).
*Test:* count matched mints against surfaced narratives over the last 90 days.

**6. Is the abstain band actually 15–25%?**
The entire cascade case rests on this and it is an estimate, not a measurement. Above 30% the features are weak and the cascade saves little.
*Test:* measure it on the shadow set. Do not budget against 20% until it is observed.

**7. Where exactly is the private-individual line?**
`docs/DESIGN.md:1212` already flags this and it is still open: *"the modal Insidor story is someone who was private until Tuesday."* **No labelling of the safety tier is meaningful until this has a written answer**, and it is not a technical artefact — it is a founder decision with legal exposure attached.
*Test:* none. Write the rule, then measure inter-annotator agreement on it. If two humans disagree on the boundary, no model number means anything.

**8. What does the real image-attachment rate look like?**
The cost model assumes 5% TikTok vision. If it is 30%, the 100× figure moves from $1,671 to $2,584/month, and the thumbnail downsampling in §9.2 becomes urgent rather than merely worthwhile.
*Test:* one query against `post_snapshots`.

**9. Is a second data vendor the larger cost target?**
The clustering path commits to a metered embedding API on the same growth curve as the judge, and its multimodal image pricing has never been verified. **At 100× it may be larger than the judge you are replacing.** Fixing the judge and leaving that in place solves half the problem you raised.
*Test:* get the per-image embedding rate before the clustering work locks in. Self-hosting the text and image encoders removes both dependencies in one migration rather than two.

**10. Is the sensor a bigger target than everything in this document combined?**
The Tier A sensor roster is ~$499/month — **roughly eight times the entire capped LLM bill** — and it is labelled a BET in the design, requiring a three-week shadow run to justify. Tier B's billing model is genuinely unknown, with a documented worst case of $216/day.
*Test:* the three-week shadow run that is already planned. Until it runs, optimising a $20–61/month line item while a $499/month unvalidated subscription sits upstream is a misallocation of attention, and you are entitled to hear that said plainly.

---

## SUMMARY — THE FIVE THINGS THAT MATTER

1. **The judge cannot cost you thousands. It is capped at $2/day in code.** What it costs you is coverage — at 100× volume the cap means ~96% of posts go unjudged. Build the classifier for coverage, not for money, and say so out loud when the invoice arrives.
2. **Naming was never the cost problem.** $2.30/month tiered. The actual defect is a title-regeneration trigger firing every cluster cycle, which burns a quarter of the daily budget on arbitrarily-chosen stories. One deleted `if` statement.
3. **An LLM stays in four places, all bounded by a constant rather than by traffic: ~$4/month, invariant at 1,200, 10,000 and 100,000 posts/day.** That invariance is what you were actually asking for.
4. **The buy path is the one place renting is unambiguously correct** — $25/month against $324/month of fee revenue at current volume, 65× at 100×. And Axiom and Photon cannot be built against at all; Jupiter is half the price of every competitor and pays 40 bps.
5. **The two numbers nobody is currently showing users are the two that will hurt: the 6.45% all-in trade cost (measured range 1.60%–22.72%) and the 10% slippage tolerance that is simultaneously what makes trades land and the exact budget a sandwich bot has to work with.** Neither is in the confirm sheet today. Both should be, at the same visual weight as the price.
