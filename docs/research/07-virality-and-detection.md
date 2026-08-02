# VIRALITY AND DETECTION — how the platforms work, what actually happened, and what we train

**Confidence marks used throughout.** `[measured]` — we ran it against live data or the repo.
`[documented]` — stated in a primary source (platform source code, platform policy, a paper's
own text). `[inferred]` — a reasonable derivation that nobody has published. `[folklore]` —
widely repeated, no primary source, do not build on it. `[BET]` — our hypothesis, untested,
must be validated before it carries weight. `[unknowable]` — not measurable with any access we
can buy.

---

## 1. THE ANSWER IN ONE PAGE

**What we detect.** A *narrative* — a cluster of posts about one subject — that is being
reproduced rather than merely consumed, and that is accelerating relative to its own baseline.
Not "a viral post". Not "a coin was minted". A narrative with a measurable reproduction
derivative.

**What we train.** Two models against one label, plus one auxiliary head.

- **Model A — traction.** P(this narrative produces a matched mint whose *peak* market cap
  clears a threshold inside a fixed window). The label is peak, never existence and never
  current cap. Existence is 97% noise [measured]; current cap is 99% collapsed [measured].
- **Model B — selection.** Given a narrative and the *k* mints that match it, which one gets
  the money. This is not a detail. A single pump.fun search for "chill guy" returns 306
  distinct tokens [measured]. Meme-to-mint is many-to-one and always has been.
- **Auxiliary head — memeification.** K independent reproducers within 6h. Dense, free,
  regime-independent labels. It regularises the trunk and it is the part of the system most
  likely to survive a meta change. It is *not* the primary target, and section 6 explains why
  the case studies mislead on this point.

**The single most important number in this document.** Decoding X snowflake timestamps out of
the 135 coins in our top-1,050 sample that declare a source post gives a **median post-to-mint
lag of 3.8 minutes** — and the lag *shortens* as the outcome improves. For coins whose peak
cleared $1M (n=66) the median is 1.2 minutes and 80% are minted inside an hour; for those above
$10M (n=17), 1.1 minutes and 88% inside an hour [measured]. The famous cases — Chill Guy at
thirteen months, GOAT at ninety-five days — are the *tail*, not the population. On the coins we
can actually label, the pre-mint window is about two minutes wide and it is contested by bots
that fire in milliseconds.

That does not kill the product. It moves the clock. The winnable window is not "before the
mint", it is **"after the mint and before the run"**: post-to-peak median is roughly six days,
and **zero percent** of coins clearing $1M peaked within an hour of the source post [measured].
Insidor's claim is not "we mint first". It is *"of the things minted in the last hour, this one
is the real narrative and it is still climbing."*

**What we honestly cannot catch.**

1. **Authority launches.** LIBRA's token was created at 21:58 UTC and Milei promoted it at
   22:01 [documented]. The detection window is *negative three minutes*. HAWK launched at a
   pre-generated vanity address, meaning it was planned weeks ahead with no public precursor,
   and its meme was six months stale and causally unrelated. These are structurally
   undetectable and, on the LIBRA evidence — $251M of losses across 44,000–74,000 wallets
   against $87M of insider extraction — they are trades the product should refuse to surface.
2. **Crypto-native and AI-origin coins.** Fartcoin and GOAT never touched TikTok, Reddit, or
   mainstream X. GOAT had 95 days of visible build-up, all of it on *one account*. Fartcoin
   reached king-of-the-hill **57 seconds** after minting; GOAT in 7m37s [measured]. The buyers
   were assembled entirely off-platform. No virality detector sees either one. An account
   watchlist does, and that is a different sensor.
3. **Origin platforms we do not read.** Jimothy — the largest 2026 organic case — originated on
   *Instagram* on 14–16 July 2026 and was minted within 48 hours, before press coverage.
   PNUT's precondition was a 534,000-follower Instagram account that had existed since 2017.
   Instagram has no public post search; Discord prohibits scraping and enforces it; YouTube's
   free quota is 100 searches per day.
4. **The irreducible residual.** Controlling for speed of early adoption — which is exactly
   Insidor's situation, since every candidate is already fast — published accuracy on
   popularity prediction drops below 65% across four independent domains [documented]. The
   best ex-ante models in the literature explain under half the variance in cascade size and
   the authors argue the bound is close to irreducible. "Never miss" is not an engineering
   goal that more data reaches.

**The honest scope.** Recall is capped by physics and by platform coverage. Lead time is not.
The promise to make is not *"we never miss"* but *"of the coins that cleared $X, we surfaced
N%, and for those our median lead over the run was T."* Section 9 gives the number and shows
its construction.

---

## 2. HOW EACH PLATFORM ACTUALLY WORKS

### 2.1 X

**Propagation mechanism [documented].** The current published source is
`github.com/xai-org/x-algorithm` — first release 20 January 2026, most recent commit 15 May
2026, still the latest as of August 2026. The widely repeated four-week update cadence is
[folklore]: two publishes in seven months. It architecturally supersedes the 2023
`twitter/the-algorithm` repo; the README states the system has *"eliminated every single
hand-engineered feature and most heuristics"*, replacing SimClusters/RealGraph/TweepCred with a
Grok-derived transformer (Phoenix) that predicts 19 actions from the viewer's engagement-history
sequence and hash embeddings of user, post and author.

Candidates come from two sources: **Thunder**, an in-memory in-network store seeded with the
viewer's following list, and **Phoenix Retrieval**, a two-tower embedding search over the global
corpus. Both are ranked together. Out-of-network candidates are then multiplied by a factor
below 1 in `oon_scorer.rs`. The commonly quoted value of 0.7 is a blogger's illustrative
example and is [folklore].

**Two structural facts we can build on [documented].**

*Quotes are the only reshare primitive that creates additional retrievable objects.*
`retweet_deduplication_filter.rs` keys on `retweeted_tweet_id.unwrap_or(tweet_id)`, so N
retweets collapse to one feed candidate. `dedup_conversation_filter.rs` keys on
`conversation_id`, so an entire reply thread collapses to one. Quotes carry a distinct
`quoted_tweet_id` and match neither key — N quotes remain N candidates, each with its own
author, embedding and interest neighbourhood. A retweet adds zero new seeds; a quote adds one.
This is "people make their own versions" expressed in the platform's own ranking code.

*Per-author attenuation.* `author_diversity_scorer.rs` applies
`multiplier(position) = (1 − floor) · decay^position + floor` where position is that author's
occurrence index in the sorted candidate list. Many accounts posting one version each
out-distributes one account posting many versions, mechanically.

**What makes something break out [documented, with a caveat].** Out-of-network reach is
delivered by embedding similarity, not by an engagement threshold. A post can be distributed to
non-followers *before* it has accumulated public engagement — aggregate engagement counts are a
flag-gated context feature (`engagement_counts_hydrator.rs` fetches them only when
`EnableContextFeatures` or shadow traffic), not a core input. Being early is therefore
technically possible rather than merely aspirational: the platform is not gating on the counts
a competitor would be watching.

**What is withheld, and why no weight-based tuning is possible.** `weighted_scorer.rs` computes
`Σ(weight_i × P(action_i)) + NEGATIVE_SCORES_OFFSET`, but every constant is imported from a
`crate::params` module that is absent from the published tree — as are `clients` and `util`, so
the tree does not compile as shipped [measured, 244 blobs at main, zero matching `*param*`].
Three corollaries:

- **The only weights X has ever published are the 2023 ones** (fav 0.5, retweet 1.0, reply 13.5,
  reply_engaged_by_author 75.0, negative_feedback_v2 −74.0, report −369.0), and they live in a
  README, not in code — the 2023 Scala shipped all `ModelWeights` defaults at 0.0 or 1.0. They
  are three years and one full architecture change dead, and they map to a *different label
  set*: 2026 adds photo_expand, share_via_dm, share_via_copy_link, quote, quoted_click,
  continuous dwell_time, follow_author, and drops good_click_v1/v2. **There is no bookmark term
  in the 2026 scorer at all**, which makes "bookmarks are the highest-weighted signal"
  [folklore] against current published code.
- **`phoenix/run_pipeline.py` ships numeric weights** (fav 1.0, reply 0.5, rt 0.3, dwell 0.2)
  that are demo placeholders, inverted relative to the 2023 production ratios. Anyone grepping
  the repo for numbers finds these first. They must never be cited as production.
- **Even with the weights we could not compute the score.** They multiply per-viewer Phoenix
  probabilities from a production checkpoint that was not released — only a ~3GB mini model
  (256-dim, 4 heads, 2 layers). Of the 19 predicted actions, roughly six are observable to a
  third party. Dwell, profile clicks, photo expands, video watch fraction, author-follows and
  blocks/mutes/reports are exposed by no API tier, and resellers scrape the same public fields,
  so paying more does not buy them.

**Design consequence:** delete every numeric weight table from Insidor's design, from either
era. Use the published *action taxonomy* as a feature-selection prior — quote, share and
copy-link, profile click, reply, dwell are what the platform optimises, likes are the noisiest —
and fit thresholds empirically against our own labelled outcomes. Do not represent any Insidor
score as a replication of the For You ranking.

**Earliest observable signal.** The quote arrival series. `quoteCount` and `retweetCount` both
ship in the standard tweet object at zero marginal cost, so the replication-vs-broadcast scalar
is free on every post already being fetched. Quote *expansion* (`/twitter/tweet/quotes`,
20/page, `sinceTime`/`untilTime` filterable, full tweet objects with author and entities) turns
the ratio into a measurement — but gate it on `quoteCount` so you only pay for candidates.

**Hard limits on X.**

- **No reverse-image search.** "The same image posted by unrelated accounts" is undetectable
  except by perceptual-hashing media we have already ingested. Image-replication recall is
  permanently bounded by our own ingest footprint. This is not a budget problem.
- **No reshare timestamps.** `retweeted_by` returns user objects, capped around 100, with no
  time. Every temporal cascade feature in the literature is therefore only reachable *by
  polling counters and differentiating*, not by reading the cascade.
- **No audience split on impressions.** `viewCount` is a single aggregate; there is no
  follower/non-follower breakdown, so entry into out-of-network retrieval cannot be observed
  directly, only proxied.
- **`viewCount` freshness is [unverified] and must be measured.** The circulating "24–48 hour
  API lag" describes X's owner-facing analytics products, not the public object a scraper reads;
  these are different pipelines. X's internal serving cache uses a 5-minute TTL under 30 minutes
  of age and 10 minutes after, which is suggestive but is not the public surface. If viewCount
  is near-real-time it is a strong early signal; if it lags hours, the entire
  engagement-per-impression family is unavailable to us. Post-and-poll at 30-second intervals
  settles it in an afternoon.

### 2.2 TikTok

**Propagation mechanism.** TikTok's own newsroom names completion as the weighted signal, and
states that *"neither follower count nor whether the account has had previous high-performing
videos are direct factors"* [documented]. The leaked "Algo 101" score
`Plike·Vlike + Pcomment·Vcomment + Eplaytime·Vplaytime + Pplay·Vplay` has three of four terms
watch-based. ByteDance's Monolith paper documents real-time online training with a collisionless
embedding table, so a new item's representation updates within minutes of feedback
[documented] — which is consistent with rapid staged expansion but does **not** evidence
discrete audience buckets. **The "test pool of 300–500 users, then 1k, then 10k" model has no
primary source and is [folklore]**, as are the 70%-completion thresholds and the "distribution
waves" that circulate in marketing content.

One further complication: roughly 1–2% of TikTok's daily views come from employees manually
"heating" videos into the For You feed [documented, Forbes, from internal documents]. Some
fraction of apparent organic breakout is a commercial decision and is unpredictable from any
observable signal.

**What makes something break out — and why this makes TikTok harder, not easier.** Removing the
follower graph removes every prior that makes early detection tractable. No author prior: a
zero-follower account is as likely to break out as a large one, so the "monitor N high-signal
accounts" strategy that makes X tractable has no TikTok analogue. No recency prior: TikTok
re-boosts old content, which is exactly how a 2023 drawing broke out in August 2024 and again in
November, and how a 2007 Herzog clip broke out in January 2026. And the signals TikTok ranks on
— watch time, completion, rewatch — are invisible externally. The only reach number obtainable
is `playCount`, which is the *output* of the ranking decision, never an input. **We cannot
observe a TikTok video during its evaluation phase.**

*A common citation error worth flagging.* Boeker & Urman (WWW '22) found "the follow-feature has
the strongest influence" — but that is a sock-puppet audit of *consumer-side personalization of
the puppet's own feed*, not creator-side distribution. Following an account naturally makes its
content appear. Citing it as evidence that follower count drives TikTok reach inverts the
conclusion.

**Data access, measured 1–2 August 2026.** The split is clean and it is the opposite of
convenient: **TikTok gives away enrichment for free and gates discovery.**

- A video page (`/@user/video/{id}`) is fully server-side rendered, unauthenticated, unsigned —
  no cookie, no UA, no X-Bogus/msToken — returning
  `__UNIVERSAL_DATA_FOR_REHYDRATION__ → webapp.video-detail.itemInfo.itemStruct` with `stats`
  and `statsV2` (incl. `repostCount`), `music.id`, `challenges[]`/`textExtra[]`,
  `suggestedWords`, `effectStickers`, `diversificationLabels`, `locationCreated`,
  `textLanguage`, `authorStats.followerCount`, and `IsAigc`. Headers show `cache-control:
  no-store` with a CDN MISS, so it is rendered live per request. `SIGI_STATE`, the previous
  container name, now appears zero times — proof the shape has already churned once, and reason
  to re-verify before building.
- **Every discovery surface is stripped**: hashtag, search, explore, sound *and profile* pages
  return the rehydration script with zero video data. Unsigned API endpoints
  (`/api/post/item_list`, `/api/challenge/item_list`, `/api/search/general/full`) return HTTP 200
  with a zero-byte body. ID enumeration is infeasible: IDs encode unix seconds in the upper 32
  bits, but the low bits are sparse — 8 of 8 constructed IDs returned `statusCode 10204`.
- The Research API is unusable twice over: commercial entities are categorically ineligible,
  *and* new videos take up to 48 hours to index with statistics lagging up to 10 days
  [documented]. oEmbed, the one unambiguously lawful endpoint, returns no metrics at all.

**Design consequence:** TikTok is a **hydration and confirmation surface fed by seeds from
elsewhere**, never a discovery source. Buy narrow discovery from a reseller; enrich for free off
the SSR page. Budget and architect for that two-tier split rather than discovering it late.

**Two measurement traps that will otherwise cost weeks.**

1. **`playCount` and `diggCount` are rounded to four significant figures** [measured]. Observed:
   playCount 566,700 / 158,700; diggCount 98,800 / 35,100; followerCount 95,100,000. The control
   that proves this is quantization rather than coincidence: `collectCount` 58,554,
   `commentCount` 1,273 / 5,738 and `shareCount` 342 / 1,455 are all exact and non-conforming.
   The step scales with magnitude — 100 at ~570K views, 1,000 at 1.2M, 10,000 at 15M — so any
   inter-poll gain below the step reads as *exactly zero change*. This is almost certainly the
   mechanical cause of the flat-view problem the repo already works around in
   `worker/lib/tt-view-diagnostic.js` (`FLAT_VIEW_THRESHOLD` 0.8). That kill switch is treating
   a symptom. **Drive TikTok velocity off exact `commentCount`/`shareCount`/`collectCount`
   deltas; treat `playCount` as a coarse magnitude tier only.**
2. **The deny response is shaped like success, on both paths.** TikTok's unsigned deny is
   usually a 200 with `content-length: 0` — but `/api/recommend/item_list/` answers 200 with
   `{"status_code": 0}`: 18 bytes of valid JSON carrying the platform's *success* sentinel and
   no items. A non-empty-body guard passes it. `JSON.parse` passes it. Our actual exposure is
   one layer up: `runActorSync` in `worker/lib/tiktok-reader.js` accepts Apify's 2xx-with-`[]`
   for a run that completed but was blocked upstream, and `reads = Math.max(1, list.length)`
   charges a read for a zero-item run so the budget ledger shows activity while the lane is
   dead. With `SNAPSHOT_TT_MULTIPLIER=3` on a 10-minute poll, a silently dead TikTok lane costs
   hours before anything downstream notices. Validate *payload shape*, alarm on consecutive
   zero-item cycles per actor, stop charging budget for empty runs — and never try to infer
   *which* defence rejected you from an empty result, since stale signature, burned msToken,
   datacenter IP, ticket-guard failure, rate limit and region block all emit the same thing.

**Earliest observable signals on TikTok**, in order of how well they survive contact with the
coinable category:

- **Foreign adoption of an original sound**: `music.original == true AND music.authorName !=
  author.uniqueId`. Definitionally replication rather than consumption, near-zero false
  positive, fires on the *second* creator, free from a payload we already fetch.
- **Share-to-like and save-to-play ratios**: levels, not rates. Computable from a single
  snapshot with no time series, which closes the 20–60 minute cold-start hole that rate-based
  ranking leaves open.
- **Shared `effectStickers` ID adoption**: identical mathematics to sounds, but covers visual
  format copying that has no audio component.
- **Novel hashtag ID adopted by many distinct authors.** TikTok assigns hashtag IDs on creation,
  so a high-numbered ID appearing across unconnected authors is machine-checkable naming. The
  sequential-ID assumption is [inferred] from three observed values and must be verified before
  it is load-bearing.

**The caveat that reframes all of this.** On TikTok the cleanest replication signal and the most
coinable content are largely **disjoint**. Sound trends produce songs, dances and format bits.
Coins are produced by characters and faces, which propagate as slideshows and image edits over
incidental audio. A sound-adoption detector would have fired on **none** of Chill Guy, Moo Deng,
Hawk Tuah, Jimothy or Penguin. Chill Guy's replication was people redrawing the character — no
shared music ID, no effect ID, no stitch lineage; the only machine-readable link is visual
similarity. Build the sound lane, but understand it as coverage of the category we are least
likely to monetise, and keep shared-embedding visual clustering as the primary route for the
coinable category.

(Stitch/duet provenance is not available: `stitchDisplay`, `duetDisplay`, `stitchEnabled`,
`duetEnabled` are *permission flags*, not lineage pointers. Provenance survives only by caption
convention.)

### 2.3 Reddit

**Propagation mechanism [documented, and partly obsolete].** The legacy `hot` sort is fully
public in `r2/r2/lib/db/_sorts.pyx`:

```
order   = log10(max(abs(s), 1))            # s = ups − downs
seconds = date − 1134028003
score   = sign · order + seconds / 45000
```

The arithmetic consequence is exact: **45,000 seconds — 12.5 hours — of freshness is worth one
order of magnitude of score.** To outrank a post 1h newer needs 1.2× its score; 6h, 3.0×; 12h,
9.1×; 24h, 83×. And because of the `log10`, the first 10 upvotes contribute as much as the next
90. The famous steepness is in the vote compression, not the time term.

**But the question "how does a post break into r/all" no longer has a well-defined answer.**
Reddit deprecated r/all through 2025 after testing from December 2024, replacing it with
r/popular and an ML-ranked personalized Home feed. The `hot` formula is a 2017-frozen artifact;
production ranking is now an undocumented ML system spanning 30+ surfaces. Treat `hot` as
mechanism history, not as a live ranking model.

One structural property of `hot` is worth carrying anyway, because it is an argument for
Insidor's existence: the score is anchored to **submission** time and is monotonically
non-increasing once inflow stops. It structurally cannot represent a second wave. Chill Guy's
coinable moment was its second wave, 82 days after the first. A platform ranking of that shape
will never resurface it. That is precisely the gap an independent subject registry fills.

**Access, measured 2 August 2026.** The free unauthenticated JSON path is closed. Every
`www.reddit.com/*.json` request returns HTTP 403 with Reddit's own interstitial ("*If you're
running a script or application, please register or sign in with your developer credentials*"),
`old.reddit.com` 302-redirects to `/login/?reason=lor2`, and `robots.txt` is `User-agent: * /
Disallow: /`. **This is policy, not IP reputation**: the measurement was taken from a
residential Verizon FiOS address and reproduced independently from separate cloud
infrastructure, and an IP ban would not produce a login redirect.

Reddit's Data API Terms (effective 19 June 2023, last revised **20 July 2026** — current)
require a separate negotiated agreement for commercial use and prohibit deriving revenue from
the API without express written approval. OAuth is mandatory. The free 100 QPM tier is
explicitly non-commercial and therefore not available to us.

**The ~$12,000/month figure is [folklore] and should be deleted from any budget.** It traces to
Christian Selig's May 2023 statement that "50 million requests costs $12,000" — a *unit rate*
of $0.24 per 1,000, which is how the $1.7M/month Apollo figure was derived. It is neither a
floor nor monthly. Reddit's own terms contain no dollar figures at all, only "rates to be
determined at Reddit's sole discretion." Secondary sources cannot even agree whether $12,000 is
per month or per year, and every pricing source returned by search sells Reddit data or scraping
services.

**The path that actually exists.** The Arctic Shift mirror
(`arctic-shift.photon-reddit.com`) returns submissions unauthenticated with no API key, and
measured ingestion lag on high-traffic subs is **25 seconds** on r/AskReddit, 5m33s on
r/wallstreetbets, 6m16s on r/CryptoCurrency [measured]. Twenty-five seconds is comfortably
inside our detection window. Two honest caveats: it is volunteer-run with no SLA and is a single
point of failure, and it does **not** cure the legal exposure — a commercial Insidor consuming a
third-party mirror still sits inside the sublicensing and revenue-derivation prohibition. The
Reddit question is a legal and durability question, not a $12k line item.

**Earliest observable signal.** Comment velocity normalised against the subreddit's own trailing
distribution — **not** upvotes, which Reddit deliberately fuzzes; comments and `num_crossposts`
are unfuzzed. And `num_crossposts` deserves special mention: it is **the only native,
first-class replication counter on any major platform**. Every academic study of meme
replication had to build a perceptual-hash pipeline because no platform exposes this. Reddit
does, as a plain integer.

**How predictive.** The one directly on-task published curve: 46,578 Reddit meme posts, 25
subreddits, 8 languages, March–June 2025, 4.8% viral base rate, chronological train/test split.
XGBoost reaches PR-AUC **0.52 at 30 minutes**, 0.65 at 120, 0.75 at 240, **0.82 at 420**
[documented]. The ablation is the important part: removing temporal features collapses PR-AUC
from 0.65 to 0.43; removing network features drops it to 0.56; removing **visual** features
changes it by 0.00; removing **contextual** features *improves* it to 0.66. Deep multimodal
baselines lost to XGBoost at every window. Viral take-off happened at a mean of 29 minutes, with
peak engagement velocity at 7.6 hours.

**One methodological warning that applies to our whole validation plan.** When the Stanford
meme-diffusion team replicated their core analysis on Reddit alone, the regression coefficients
*reversed*. A model validated on a single platform can conclude the opposite of what holds
across the web. Do not validate Insidor on one platform.

### 2.4 4chan — the observability inversion

Worth a short section because it changes a build decision. 4chan is now **more observable than
Reddit and free**: `a.4cdn.org/{board}/catalog.json` needs no key, no auth and no contract, at a
documented 1 req/s, returning complete board state in one ~530KB call. Measured 2 August 2026:
/pol/ carried 201 live threads with a median age of 92 minutes and 72 threads under an hour old;
/v/ 200 threads at 163 min median; /b/ 150 at 165 min [measured]. Every thread carries unix
`time`, `replies` and `images`. Seven boards can be polled in full every ten seconds.

Its value is not as a direct source — /pol/'s normalized self-influence is 94.7%, so almost
everything stays put — but as the *first leg of a crossing*. The published finding is that 4chan
functions as an evolutionary filter: it posts by far the most memes and has the highest raw
influence, but the **lowest** influence once normalised by volume. Only the fittest escape,
which makes "4chan subject now appearing elsewhere" a high-precision signal available for free.

**The catch: there is no history.** Boards turn over in 1.5–3 hours and threads are deleted on
rollover; only a subset (4plebs covers /pol/, /adv/, /sp/ and others, not /b/ or /v/) is
archived. Start polling immediately or the training data does not exist.

### 2.5 The blind spots, stated plainly

| Platform | Status | Cost of the gap |
|---|---|---|
| Instagram | No public post search, no arbitrary-account discovery. Basic Display dead; hashtag search business-accounts-only; Content Library academic-only. | Jimothy (2026, minted <48h from an IG Reel) and PNUT (534K followers over 7 years) were both invisible. This is the largest single gap. |
| Discord | Scraping prohibited outright; self-bots ban-on-sight; enforcement is real (Spy.pet). Only sanctioned path is per-server bot invitation. | [unknowable]. Coordination is real and measurable only after the fact, via the on-chain social fields. |
| YouTube | 10,000 quota units/day free, `search.list` = 100 units → 100 searches/day, total. No paid tier. | Effectively a trickle. Usable for confirming a known video, not for discovery. |
| Twitch | Genuinely open and cheap via Helix/EventSub and IRC chat. | Uncovered rather than uncoverable. |

---

## 3. THE CASE STUDIES

Nine cases, reconstructed from dated primary sources and, where possible, from on-chain
timestamps rather than press reports. All on-chain figures are read from pump.fun's public API
and Solana RPC directly.

### 3.1 The table

| Case | Origin (date) | First detectable meme signal | Mint (UTC) | Traction | Peak | Today | Signal → mint | Class |
|---|---|---|---|---|---|---|---|---|
| **Chill Guy** | X, 2023-10-04 (creator's own caption) | TikTok slideshow 2024-08-30; Dexter edits 2024-09-04 (6.6M plays); sound at 5,700+ posts by 09-10; cosplay 09-09 | 2024-10-06 00:31:13 | **40.2 days of zero on-chain activity**; first buy 2024-11-15 06:20:13; KOTH 19:58:37; Raydium 20:08:22 | ~$580M, 2024-11-21 (Bukele post same day) | −98.6% | 36 d to a *dead* mint; ~24 h from the snowclone to traction | Organic replication |
| **Moo Deng** | Zoo IG, 2024-07-25 (~1,000 likes over 2 months) | Name chosen by public poll 2024-08-10; **Thai-language X post 2024-08-26, 4.6M views**; English spike 09-02; independent fan art 09-05→09-09 | 2024-09-10 17:25:28 | KOTH **+7m25s** — market already waiting | ~$320M around SNL 09-28; coin ATH 2024-11-15 | −94.8% | 15 d (Thai) / 8 d (English) / 5 d (fan art) | Organic replication |
| **Nietzschean Penguin** | Herzog film 2007; YouTube 2008; "Nihilist Penguin" 2015; r/natureismetal 2016 | TikTok natur_gamler **2026-01-16** (192K+ likes/6d); mobi.lek 01-17 (1.5M+); **format mutates to motivational 01-19** (390K+), andrewcm9 01-21 (3.3M+) | **2026-01-16 18:23:15 — same day** | Graduated (`complete=true`, PumpSwap pool). White House post ~01-23/24 | **$173.9M ATH 2026-01-24 19:21:27** — 28th of 1,049 by ATH; one of only 8 tokens created in 2026 clearing $100M | −99.3% (~$1.1M) | **~0 days** | Organic replication |
| **Jimothy** | **Instagram**, 2026-07-14/16 (~8M views) | The Reel itself | 2026-07-16 | Within 48h, **before** mainstream press 07-17/19 | White House mention later, +60% | — | <48 h | Organic, origin platform uncovered |
| **PNUT** | Instagram account created **2017**, 534K followers | Complaint 2024-10-19; NYSDEC 10-22; **seizure 2024-10-30** | 2024-10-31 14:21:41 | KOTH **+27m41s**, ~28 h after the seizure and *before* the mainstream news wave | >$1B, 2024-11-13 (Musk post 11-02, US election 11-05) | −98.4% | ~28 h from the news event | News landing on a pre-built audience |
| **GOAT** | @truth_terminal, first tweet 2024-06-17 | First "goatse_gospels" post **2024-07-07**; Andreessen $50K grant 07-08 — 95 days of visible build-up on **one account** | 2024-10-10 21:08:28, by an anonymous third party | KOTH **+7m37s** | ~$700M; ATH 2024-11-17 | −99.0% (~$13M) | 95 d, but invisible to any virality detector | AI / crypto-native |
| **Fartcoin** | Same account; name emerged inside Claude-to-Claude "Infinite Backrooms" logs (first utterance date [unsourced]) | **None public** | 2024-10-18 06:05:06 | KOTH **+57 seconds** — the fastest in the set | $2.48 / ~$2.5B, 2025-01-19, **93 days** after mint | −94.9% (~$126M) | 0 | AI / crypto-native |
| **HAWK** | Street-interview clip, June 2024 — genuine mass replication | Real, and **six months stale** | 2024-12-04 22:08, at pre-generated vanity address `HAWKThXRcNL9ZG…` | ~$490–500M within hours, then −90% in the same session | ~$500M | — | Meme signal predicted the launch date **not at all** | Authority launch |
| **LIBRA** | None | None | 2025-02-14 21:58 | Milei's promoting post **22:01 — three minutes later**; $5.20 / $4.6B within ~40 min | $4.6B | — | **−3 minutes** | Authority launch |

Additional structural facts, all [measured]:

- 97% of HAWK's supply sat in ten wallets at launch, with a 3% public float.
- LIBRA: nine founding accounts held 70% of supply and extracted ~$87M within three hours;
  investor losses ~$251M across 44,000–74,000 wallets.
- Chill Guy's first five minutes on-chain were 15 sniper transactions — same-block buys followed
  by a sell — then literally nothing for 40.24 days, then 2,033 transactions in one day.
- The winning CHILLGUY contract's on-chain `description` field is a near-verbatim transcript of
  a specific TikTok AI-voiceover edit posted 2024-09-06. The crowd's exact words are sitting in
  the contract metadata.

### 3.2 The window between "detectably becoming a meme" and "coin minted" — and why the table is the wrong population

Read the table alone and the window looks like days to weeks. That reading is a sampling
artifact, and correcting it is the most important thing in this document.

**Measured on the population we can actually label.** X post IDs are snowflakes:
`post_ms = (id >> 22) + 1288834974657`. Decoding the `twitter` field of every coin in the
top-1,050 sample that carries a `/status/` permalink resolves all 135 in one pass, against their
`created_timestamp`:

| | p25 | **median** | p75 | p90 | <5 min | <1 h | <24 h | >30 d |
|---|---|---|---|---|---|---|---|---|
| All 135 | 0.5 min | **3.8 min** | 66 min | 26.7 h | 49.6% | 69.6% | 84.4% | 7.4% |
| Third-party sources only (n=117) | — | **2.4 min** | — | — | — | 74% | — | — |

**And the lag shortens monotonically as the outcome improves:**

| Outcome band | n | Median lag | Within 1 h | Beyond 7 d |
|---|---|---|---|---|
| ATH > $1M | 66 | 1.2 min | 80% | 3% |
| ATH > $10M | 17 | 1.1 min | 88% | 0% |
| ATH > $50M | 3 | — | 100% within 5 min | 0% |

The long-lag tail is **not a second meme regime**. All ten cases beyond 30 days are archived
tweets being re-minted years later — an SBF tweet from August 2020 minted 1,651 days later, an
Elon tweet from November 2022 at 1,365 days, a White House post at 361 days — with peaks of
$159K to $1.8M. The slow regime is the *losing* regime.

**Two honest caveats.** Permalink coverage is 13% of the top 1,050 and only 5% of the 76 coins
currently above $50K, and declaration is bot-skewed, so the unobserved 87% could in principle
behave differently. But the measurable population *is* the label population — Insidor can only
train on posts it can match to coins — and it contains every large winner in the sample.

**Reconciling the two views.** The famous cases are famous *because* they have a documentable
meme history. They are the tail. The population of coins that made money is dominated by mints
that happen minutes after a post. Both statements are true about different populations, and the
product has to serve the second one.

### 3.3 The window that is actually winnable

Post-to-ATH, same 135: median ≈ **143 hours (~6 days)**. For coins clearing $1M, **0% peak
within an hour** and only 14% within 24 hours [measured]. Stated against our own finding: this
figure is biased *long*, because the sample is top-1,050 by current cap and 287 of 1,033 have
their ATH within 24 hours of last update — they are peaking right now. Treat post-to-ATH as an
upper bound. Post-to-mint carries no such bias, because both endpoints are fixed.

The Penguin case is the clean illustration. The trend started on TikTok on 2026-01-16 and the
Solana mint landed the *same day*. The ATH came eight days later, on 2026-01-24, and it was
triggered by an exogenous White House post — not by the TikTok trend. **A social-trend signal
predicts that a coin gets minted, not that it runs.** Those are different predictions and they
need different models.

### 3.4 The cases that break the pattern

**Fartcoin and GOAT break the replication hypothesis entirely.** No human replication preceded
either mint. The "crowd" was one AI account. GOAT had 95 days of build-up, all of it visible in
one timeline; Fartcoin's name existed only in published Infinite Backrooms logs. Both reached
king-of-the-hill within eight minutes, which is the tell: the buyers were pre-assembled
off-platform, not recruited by a public signal. A consumer-platform virality detector returns
nothing for either. GOAT is the single strongest argument for a second, account-watchlist ingest
path.

**HAWK breaks the causal link between meme and coin.** The meme was real and heavily replicated
in June 2024. The coin launched in December at a pre-generated vanity address, which is proof it
was planned in advance rather than minted opportunistically. The June signal predicted the
December launch date not at all.

**LIBRA breaks detection in principle.** Coin first, promotion three minutes later, nothing
before. The only pre-signal was private phone calls.

**PNUT breaks the "news is uncoinable" framing.** Peanut was not news — he was a
534,000-follower influencer since 2017. The news event landed on a pre-existing named character
with a body of content and an audience. News is coinable when it lands on an audience that
already exists; it is not coinable in general. Note also that this is a category we would need a
*news feed* to catch, not a meme detector.

**Chill Guy breaks the monotone-score assumption twice.** Its larger September wave (6.6M plays
on one edit, 5,700 posts on one sound) produced a mint that sat dead for 40 days. Its smaller
November wave, which introduced a new format — a fixed sentence template — converted within 24
hours. Volume did not discriminate. And a `hot`-style monotone score cannot represent the second
wave at all.

**Penguin breaks name-matching.** The crowd used five competing names simultaneously (Nihilist,
Nietzschean, Lonely, Wandering, Deranged Penguin). The winning *token name* was a minority
variant and the winning *ticker* was the bare generic noun. A frequency-based name matcher would
have picked wrong.

**Penguin also breaks "the first mover is dead."** The day-zero Solana mint is not a
cautionary tale about being early — it graduated its bonding curve and peaked at $173.9M,
ranking 28th of 1,049 by ATH. It reads as dead only because its `king_of_the_hill_timestamp` is
null, and that field is null for **all 721 tokens created in 2026** in our own dataset (last
non-null anywhere: 2025-11-12). Reading a deprecated field's null as a fact about the token is
exactly the error that produces confident wrong architecture. Being earliest captured the entire
run.

---

## 4. WHAT THE CASES HAVE IN COMMON — AND WHERE THEY GENUINELY DIFFER

### 4.1 Three mechanisms, not one story

| | **A. Organic replication** | **B. Crypto-native / AI** | **C. Authority launch** |
|---|---|---|---|
| Cases | Chill Guy, Moo Deng, Penguin, Jimothy | Fartcoin, GOAT | HAWK, LIBRA |
| Where it forms | Consumer platforms (TikTok, IG, X) | One or a few crypto-adjacent X accounts | Nowhere public |
| Pre-mint public signal | Days to months of replication | None (Fartcoin) or single-account (GOAT) | None, or six months stale and unrelated |
| KOTH latency | 7m25s (MOODENG) to 40.8 days (CHILLGUY) | 57s, 7m37s — buyers pre-assembled | Not applicable; pre-planned |
| Detectable? | Yes, by replication signals | Only by account watchlist | No |
| Right product response | Detect and rank | Separate sensor | **Warn, do not surface as a buy** |

PNUT fits none cleanly: a pre-existing 534K-follower character plus a news shock, minted 28 hours
after the seizure and before the mainstream wave.

**These mechanisms are stable; what changes is which one dominates.** All three existed in 2024
and all three exist in 2026. The founder's instinct that "the meta changes" is right about the
*mix* and wrong if read as "the mechanisms themselves are new each cycle". That distinction is
what lets one model span regimes, provided regime state is fed in as features (§7).

### 4.2 What genuinely generalises across the organic cases

1. **A dormant carrier, reactivated.** Chill Guy's art was 11 months old and had ~17,000 likes.
   Penguin's clip was 19 years old. Moo Deng's zoo Instagram post had ~1,000 likes over two
   months. Novelty is *not* the trigger; **re-acceleration of old content is**. This is a
   concrete argument against any binary "seen recently → penalise" novelty term (§8).
2. **Format mutation, not volume, immediately precedes the money** [BET, but the best-supported
   one here]. Chill Guy's larger wave failed and its smaller, format-changing wave converted.
   Penguin's semantic shift from nihilism to motivation on 01-19 preceded the winning run by
   five days. Moo Deng moved from photograph to multiple artists' distinct styles. In all three
   the carrier stayed constant while the meaning changed. Measure the drift of the caption
   embedding centroid while volume stays high.
3. **Exogenous amplification postdates the mint, always.** Bukele posted six days after the
   CHILLGUY mint; Musk after PNUT was minted; the White House after both JIMOTHY and PENGUIN
   existed. **The amplifier signal is a pricing signal, not a discovery signal.** It is
   high-precision, cheap, legally clean, and it will never help mint first. Map it to the
   display and buy surface; never to detection.
4. **Multiple contracts per meme, and the winner is not reliably the first.** 306 "chill guy"
   tokens; Penguin had at least three Solana mints plus later derivatives. Chill Guy's winner
   was a *community takeover* of an abandoned mint (`x.com/chillguycto`). Selection is a
   separate decision at a different time from detection, and it needs liquidity and
   holder-concentration gates, not just a story-to-coin confidence score.
5. **The end state is the same everywhere.** Every organic winner is down 94.8%–99.3% from ATH.
   Median drawdown across all 2026 graduated tokens in our sample is 70.8% [measured]. A product
   record that reports "a coin appeared" and stops there is misleading.

### 4.3 Where we must not force a single story

- **AI-origin coins have no crowd.** Applying a replication detector to them is category error.
  Their observable is a single account's novel proper nouns, and their tell is that traction
  arrives within a minute of the mint because the audience was assembled privately.
- **KOL launches have no meme phase at all, or a stale and unrelated one.** Applying meme
  detection produces false confidence — HAWK's June signal was genuinely strong and genuinely
  predicted nothing.
- **News-on-an-audience is its own thing.** It has no replication cascade in the format-mutation
  sense; it has outrage reposting, which is a different shape. Catching it needs a news feed —
  cheap, high-precision, and separate from the meme pipeline. It would have caught PNUT.
- **Cross-platform ordering is not fixed.** The best published sequence data puts Reddit at the
  head 51–59% of the time, while head-to-head timing shows alternative news appearing on Twitter
  faster than the same subreddits 80% of the time, with a turning point around one hour. And the
  one peer-reviewed modern cross-platform meme case study describes a *loop* — X → TikTok/IG
  adaptation → back to X. Design the crossing detector as "count of distinct platforms observed
  for this identity", never as "who was first". Timestamps across pipes with different latencies
  are not comparable anyway.

---

## 5. THE SIGNALS WE CAN ACTUALLY MEASURE

| Signal | Platform | How measured | Visible from | Predictive value | Can we see it? |
|---|---|---|---|---|---|
| **Quote-to-retweet ratio** | X | `quoteCount`/`retweetCount`, both already in every fetched tweet object | τ ≈ 1 min, 100% of posts | High for replication-vs-broadcast; mechanism-grounded in the dedup filters. **[BET] until validated on the winner corpus** | **Free.** Zero marginal cost |
| **Second-half reshare acceleration** | X | Ratio of the most recent interval's rate to the prior interval's, off `post_snapshots` | τ ≈ 9 min (two samples) | Strongest single feature in the cascade literature (0.73 standalone accuracy on doubling, beating all structural/content/author families) | **Yes**, already stored |
| **Engagement per impression** | X | retweets/views, quotes/views — fields already ingested | First poll | Views-per-reshare correlates **negatively** with final size: needing fewer impressions per reshare is a quality signal, and it is reach-normalised so it survives regime change | **Yes** — *conditional on `viewCount` freshness being verified* |
| **Independent-root count** | X | Quote authors + exact-phrase search hits + pHash matches, minus authors who follow the origin | 2nd root, minutes; follow-graph subtraction is slower and costs $0.0045/1k follower IDs | This is the axis that is *separate from cascade size*. Size and structural virality are near-uncorrelated (r=0.2 news, 0.04 petitions, ~0 images/video) | Partially. Follow-graph subtraction only on promoted candidates |
| **Quote-with-new-media rate** | X | `/twitter/tweet/quotes`, 20/page, `sinceTime`-filterable, full objects incl. entities | Minutes; first quote | The strongest available proxy for "people are making their own versions" — a quote with new media is functionally a new original | Yes, gate expansion on `quoteCount` |
| **Foreign adoption of an original sound** | TikTok | `music.original == true AND music.authorName != author.uniqueId` | 2nd creator, minutes | Near-zero false positive for replication. **But it would have fired on none of the five organic cases** | **Free**, in the SSR payload |
| **Share/like and save/play ratios** | TikTok | `shareCount`/`diggCount`, `collectCount`/`playCount` | **First snapshot** — a level, not a rate, so no cold start | Operationalises "news gets views, memes get copied" on one snapshot. **[BET]** | **Free** |
| **Exact-count velocity** | TikTok | Deltas on `commentCount`/`shareCount`/`collectCount` only | Two snapshots | The only usable TikTok velocity. `playCount`/`diggCount` are 4-sig-fig quantized and read as flat below the step | **Free**, but requires the seed ID from elsewhere |
| **Effect-sticker adoption** | TikTok | `effectStickers[].ID`, distinct adopting creators over time | 2nd adopter | Covers visual format copying with no audio. Field confirmed present but empty in both probes — **[unverified] in the populated case** | **Free** |
| **Comment velocity vs. subreddit baseline** | Reddit | Poll `/r/{sub}/new`, re-poll at t+5/15/30/60. Comments, not votes — votes are fuzzed | ~5 min | The best-documented early curve on this exact task: PR-AUC 0.52 @30min → 0.82 @420min at a 4.8% base rate | Only via a mirror or a contract. Mirror lag measured at 25s |
| **`num_crossposts` derivative** | Reddit | Plain integer on the post object | First crosspost | The only native replication counter on any platform. **Untested against coin outcomes; nearly free, so measure it first** | Same access constraint |
| **Thread-birth and reply acceleration** | 4chan | Diff `catalog.json` every 10s across 6–7 boards | **Sub-minute** | Low precision alone (94.7% self-influence). High precision as a *crossing* detector | **Free, no auth, no contract.** No history — start now |
| **Format mutation / semantic drift** | All | Embed captions per carrier cluster; track centroid displacement in rolling 24h windows while volume stays high | ~24h of derivatives | The one signal that explains Chill Guy's internal contradiction. **[BET] — no published prior art** | Yes, on ingested content only |
| **Distinct-creator count on a pHash + embedding cluster** | All | pHash (Hamming ≤8) + DBSCAN, plus embedding distance for redrawings and cosplay that defeat pHash | Hours | Distinct creators, not distinct posts, is what separates a meme from a viral video. Published at 160M-image scale | Yes — **but recall is permanently bounded by our own ingest footprint; no platform offers reverse-image search** |
| **Fingerprint frequency acceleration** `d/dt log(df_hash)` | All | Daily hash-bucket counts over 30–90 days | **τ=0** — a property of the corpus, not the post | Separates repost spam (old, flat) from resurgence (old, accelerating). Two of the biggest cases were resurgences | Yes |
| **Novel-name adoption velocity** | All | Rolling 2–4-gram table; flag n-grams whose 1h rate far exceeds their 24h prior *and* which appear across ≥2 unconnected authors | Minutes after the 2nd independent use | **A name is the only cross-platform join key that is actually searchable** — pHash is not queryable through any API. Weak as a *trigger* (everything has a name; Penguin had five) | Yes |
| **Quoted-text match** | All → chain | Fuzzy-match distinctive phrases against new mint `description`/`name` fields | At mint | Strongest join key observed anywhere here: the winning CHILLGUY description is a near-verbatim TikTok voiceover transcript | Yes, free from the mint stream |
| **Cross-platform co-occurrence** | X ↔ TikTok (↔ Reddit) | Shared text/image embedding space; count distinct platforms per identity | Hours | Strongest meta-independent corroboration available. Note: only ~1.5–2% of memes ever cross at all, so it is a ~50–70× enrichment filter and a *late* signal | Yes, within covered platforms only |
| **Discoverer-roster membership** | X | Surprisal statistic over adoption history, controlling for account activity level, bootstrapped | **Instantaneous** at query time | 0.5–1% of accounts predicted top-5–10% outcomes out-of-sample across a 12-month gap; network-centrality hubs did **not** | Yes, from our own corpus. No follow graph needed |
| **Bonding-curve traction primitives** | Chain | Reserve progress, unique-buyer velocity, `complete=true` / pool migration | At mint, continuous | **The label.** Replaces `king_of_the_hill_timestamp`, which is null for 100% of 2026-minted coins, and `raydium_pool`, null since 2025-04 (graduation now goes to PumpSwap) | **Free**, public API + RPC |
| **On-chain social_count** | Chain | Presence of Twitter + website + Telegram in launch metadata | At mint | Launches advertising all three graduate at 1.919% vs 0.110% for none — a 17.4× lift, from 1.6% of launches producing ~16% of graduates | **Free.** A *selection* feature, not detection |
| **Amplifier post (Bukele/Musk/White House class)** | X | Roster monitoring for large accounts posting a subject that already has a matched coin | Late by construction | High precision, zero recall for minting. Postdates the mint in every case observed | Yes — **display gate only** |

**Signals we should not build, and why.**

- **Bookmark signal on X.** There is no bookmark term in the 2026 weighted scorer at all.
- **A name-*invention* detector.** Chill Guy's name was in the creator's own caption at t=0; the
  crowd adopted rather than invented. Measure adoption velocity of a string extracted from the
  origin post.
- **Cascade depth or branching as a *detection* signal.** Size and structural virality are
  near-uncorrelated on Twitter; even 10,000-repost cascades have median structural virality
  below 3 against a floor of 2. Depth does not distinguish winners. Demote branching factor to a
  *lifecycle* signal (supercritical / peaking / dying), which is what it is good for.
- **Weng-style community-dispersion features in their published form.** They require a
  reciprocal-follow network over ~600,000 users plus Infomap community detection. That graph
  costs more than our entire ingest budget. Our co-reshare-cluster approximation is [BET] and
  may not recover the signal — and the general warning applies: network-structural features
  transfer badly across platforms, and for early-adopter features even the *direction* of
  correlation flips between domains.
- **Any absolute "similarity to past winners" feature.** See §8.

---

## 6. WHAT WE TRAIN

### 6.1 The prediction target, and why

Four candidate targets, and only one survives:

| Target | Label source | Delay | Why it fails / survives |
|---|---|---|---|
| (a) Views ≥ N in H | Platform counter | H | Predicts the platform's recommender, not human behaviour. News wins. Breaks whenever ranking changes. |
| (b) K independent reproducers in H | Own corpus, passive | H | **Survives as an auxiliary head.** No coin in the label, backfillable, regime-independent. Fails as *primary* — see below. |
| (c) A coin was minted in H | Mint stream | H | ~30,000 mints/day at 97% noise: median fresh-mint cap $28, 174 of 300 duplicate names, one name minted 21 times. Training on it produces a spam detector. |
| (d) Coin peak ≥ $X within W | Mint stream + price | Days | **Primary.** The only label that measures what actually happened. |

**Why (b) is not primary, despite being the most intellectually attractive.** The argument for it
rests on the meme-to-coin lag being weeks. Measured, the median is 3.8 minutes and it shortens
as the outcome improves (§3.2). The two canonical cases used to support "weeks" disagree with
each other by an order of magnitude — Chill Guy at ~13 months from origin and ~2.5 months from
breakout, Moo Deng at days, with the coin arguably preceding peak virality. "Weeks" is the
arithmetic middle of two points that share no regime.

Two further practical reasons. First, (d) has a **free, continuous, self-refreshing label
stream** — every surfaced narrative either does or does not produce a coin that trades, arriving
forever at zero cost off PumpPortal. (b) has no equivalent: measuring derivative spread means
metered X reads. Demoting the free label to promote the metered one is a build-level cost error.
Second, our own Stage-0 work already committed to peak-based positives; (b)-as-primary would
silently overturn that without addressing it.

**Why (d) must be windowed peak, not current cap and not king-of-the-hill.**

- Current cap: the median coin among the best 1,050 ever minted peaked near $546,380 and now
  sits near $2,977. Every true positive would look like a failure.
- `king_of_the_hill_timestamp`: **null for all 721 tokens created in 2026** in our sample, last
  non-null anywhere 2025-11-12, superseded by `mayhem_state` (present on 428 of the 721).
  `raydium_pool` is null for 100% of coins minted since 2025-04 because graduation now goes to
  PumpSwap. Both fields are dead schema. Build the target on live primitives — bonding-curve
  reserve progress, buy-count and unique-buyer velocity in a rolling window, and the
  `complete=true` / pool-migration event. Backfill history with KOTH if useful; never depend on
  it at runtime.

**The two models.**

- **Model A — narrative traction.** `P(peak ≥ $1M within W days | narrative features at horizon
  h)`. This is the ranker behind the board.
- **Model B — mint selection.** Given a narrative and its *k* matching mints, rank them. Trained
  on the same peak label, with on-chain features (creator history, holder concentration, initial
  liquidity, `social_count`, buy/sell asymmetry in the first minutes) plus match confidence.
  This exists because meme-to-mint is many-to-one — 306 chill-guy tokens — and because the
  winner is not reliably the first: CHILLGUY's winner was a community takeover of a dead mint,
  while PENGUIN's day-zero mint captured the entire run. There is no rule; there is a model.
- **Auxiliary head — memeification** on a shared trunk. Dense free labels, regularises the
  trunk, and it is the component most likely to still work when the meta turns.

**Train on the doubling formulation, deploy on the absolute one.** Cascade sizes are
heavy-tailed and regression on size is unstable; "will this narrative double from *k*
reproducers to 2*k*" yields balanced classes at every scale for free and pushes all regime
dependence into a cheap calibration layer. Set the product's absolute threshold by quantile so
positives land at 1–3% of admits, recompute monthly, and **store a `label_version` on every
row** — the definition will change and we must be able to re-derive.

### 6.2 The label pipeline

**Positives.** Every ingested post gets a fingerprint set at ingest: pHash and an image
embedding for media, distinctive entity spans from the existing pre-pass, TikTok `music.id`,
cashtag, and quoted-phrase shingles. These write to an inverted index
`fingerprint → (author_id, ts)` covering **all** ingested posts, not just tracked ones. This is
what makes reproduction measurable *passively* — as a join over the corpus, with no per-post API
poll.

**Matching narrative to mint** uses five signals in confidence order: temporal ordering, quoted
text (the strongest join key observed here), image similarity, ticker, and free text. The
metadata permalink is a minor path — 5% coverage on the coins that worked — not the primary
mechanism.

**Traction** is read from the on-chain primitives above, and **peak** from `ath_market_cap` with
its timestamp, windowed to W days after creation, filtering the 16 known-corrupt rows above $1B.

**Negatives, in three tiers.** This is the hard half.

1. **Exposure-confirmed (gold).** Reached real reach and produced no matching mint within 24h.
   Constrained by the `viewCount` staleness problem: when `V_i == V_{i−1}` while `L_i > L_{i−1}`,
   mark view-censored and do not emit a zero rate.
2. **Amplifier-confirmed.** Reshared by at least one large account and still spawned nothing.
   Independent of the scraped view number, harder to fake, and it degrades more gracefully —
   make this the primary tier.
3. **Unexposed / unknown.** **Do not train on these at weight 1.** This is positive-unlabeled
   learning: fit an exposure propensity model `e(x)`, train the discriminative model on
   confirmed positives plus tiers 1–2, and use the unexposed pool only to calibrate the arrival
   prior.

**A 2% unconditional random tracking holdout is mandatory, from day one.** A fixed 2% of
arrivals bypass the admission gate and get tracked regardless of score. Without it, next month's
training set is selected by last month's model and the system goes progressively blind on
exactly the novel material it exists to find. It costs ~2% of snapshot budget and it is
simultaneously the unbiased evaluation set, an exploration source, and the only way to tell
whether the gate or the model is the recall bottleneck. It cannot be added retroactively.

**What genuinely cannot be backfilled** — the day-one list, stated precisely because an earlier
version of this argument aimed it at the wrong component:

1. **The PumpPortal `subscribeNewToken` stream** with supervised singleton, heartbeat and gap
   detection. This is the label source. A dropped connection is a permanent hole in `coin_mints`
   that silently *inflates* every measured lead time.
2. **The 5% ε-exploration slice** — posts sampled uniformly from admits, ignoring score, run
   down a shadow lane and coin-matched. The only uncensored control for the double censoring in
   the outcome labels.
3. **The 14-day document-frequency persistence history**, which only accrues forward.
4. **4chan catalogs**, which are deleted on rollover within 1.5–3 hours.
5. **Engagement curves, thumbnails and mint timings generally** — being written today and gone
   in six months.

Reproduction *level* is backfillable (bulk tweet lookup returns current quote and retweet counts
for arbitrary IDs of any age). Reproduction *kinetics* — the shape at τ=4/9/14 min — are not, nor
are posts that get deleted.

**A census of reproduction over all posts is unaffordable and must not be planned.** Two extra
observations of ~30,000 daily Tier-0 arrivals is 60,000 billable tweets/day on top of the
~24,000 the existing schedule spends, against a 33,000/day budget at $0.00015 per tweet —
roughly 3.5× over, against an explicit instruction never to starve probation. The affordable
version: log reproduction counters at every snapshot for the ~9,000/day already being polled,
plus the 5% uniform shadow slice. Zero marginal API cost, and the shadow slice gives an
unbiased-by-construction subsample rather than an unaffordable and still-biased census.

### 6.3 The feature set by availability horizon

**M0 (τ=0) — content and author only, no engagement exists yet.**
- Author: follower decile, account age, posting cadence, **historical derivative-spawn rate**
  (how often this author's content gets *copied*, distinct from reshared), historical median
  reproduction count. Shrink toward the follower-decile prior with weight `n_a/(n_a+10)`.
- Corpus-relative: **`d/dt log(df_hash)`** — fingerprint frequency acceleration. This is the
  single most valuable τ=0 feature because it is a property of the corpus rather than of the
  post, and it is available before any engagement exists.
- Content, structural only: single nameable subject; media present; close-up scale; face or
  character present; short text; template-shaped layout; slot-bearing phrase. The supporting
  evidence here (AUC 0.866 on hand-coded compositional features) rests on 100 annotated memes
  from one board — ship them and let the model decide; do not weight them by prior belief.
- Cross-platform: does this fingerprint already exist elsewhere at a materially different age?
- `IsAigc` as a negative filter.

**M5 (τ=5 min).** Adds: rate lower-confidence-bound on quote arrivals (Gamma-Poisson);
time-to-first-independent-derivative; quote-to-retweet ratio; engagement-per-impression;
breadth (distinct first-degree sources) — breadth beats depth early; TikTok share/like and
save/play ratios; discoverer-roster membership among the first *k* engagers.

**M15 (τ=15 min).** Adds: burst ratio `S_fast/S_slow` on the reproduction counter; distinct
language and region count; independent-root count; name-convergence entropy over the derivative
set; distinct-creator count on the pHash/embedding cluster.

**M60 (τ=60 min).** Adds: full kinetic history; second-wave detection against the subject
registry; cross-platform jump; derivative-of-derivative depth; format-mutation drift.

**Model class: gradient-boosted trees, not a neural net.** Tabular data, small *n*, nightly
retrain, monotone constraints needed, SHAP needed for the "why" panel the product already
promises — and on the one published result for this exact task, XGBoost beat every deep
multimodal baseline at every observation window.

**Monotone constraints on all kinetic features.** More reproducers, arriving faster, can never
lower the score. This is cheap adversarial hardening and it improves extrapolation into volume
regimes absent from training, which is half the regime-shift problem solved for free.

**Every learned model is a re-ranker inside the existing hard gates, never a replacement for
them.** A gate an adversary can open by buying 100 likes is worse than no gate.

### 6.4 The evaluation protocol

**Splits: rolling-origin walk-forward with purge and embargo.** Train [d−90, d−1], test day *d*,
step one day, aggregate over ≥60 test days. Because labels depend on a forward window, purge any
training example whose label window overlaps the test period and embargo after it. **Report the
distribution across days, not the mean** — walk-forward tests a single path, is easy to overfit,
and a mean hides exactly the regime episodes we care about.

**Primary metric: recall at a fixed alert budget, per horizon.**

```
Recall@B(h) = (# positives alerted at horizon ≤ h, alerting only the top B ranked candidates/day)
              ──────────────────────────────────────────────────────────────────────────────────
                                     (# positives that day)
```

with B = 50 alerts/day. Because an alert at τ=5 counts toward the τ=60 recall, `Recall@50(h)` is
monotone in *h*, and **that curve is the product's core chart**: it is literally "how much do we
miss as a function of how early we insist on being." Report at h ∈ {0, 5, 15, 60} minutes.

Alongside it:

- **Lead time** — median and quartiles of `alert_time − t_traction`, where t_traction is the
  on-chain inflection, **not** the coin's peak and **not** the mint. Using the coin as the
  reference reintroduces circularity into the metric itself.
- **PR-AUC** as the development metric. Not accuracy, not ROC-AUC — at a 1–3% base rate ROC-AUC
  flatters badly (the Reddit study reports ROC-AUC 0.93 alongside PR-AUC 0.52 on the same
  model).
- **Precision@B** — reported, not optimised, at the detection stage. Precision is the display
  stage's job.
- **Recall on the 2% random holdout, reported separately.** If it is much worse than on the
  gated population, the bottleneck is the gate, not the model. Almost nobody builds this and it
  is the most diagnostic number on the page.
- **Recall stratified by distance-to-nearest-training-positive.** See §8 — this is the direct
  measurement of circularity failure.

**Baselines that must be beaten or the model is not earning its keep:** the current hand-tuned
heuristic; raw reshare velocity; an HN-style score; and **author follower count alone**, the
celebrity-regime baseline. In early 2025 that last one would have been very hard to beat, and
reporting it honestly is how we know which regime we are in.

**The arithmetic that forces the two-stage split.** At the Reddit study's 4.8% base rate, 95%
recall with a 10% false-positive rate yields 32% precision — two false alarms per true, workable.
At a 0.1% base rate, plausible once we screen a broad post stream, the same settings yield
**0.94% precision: 105 false alarms per true positive**; even an excellent 1% FPR gives 8.7%.
High recall and high precision cannot coexist in one stage at our base rate. That is arithmetic,
not model quality. Notably, the most recent paper on this task names exactly this
cost-asymmetric, application-tuned-threshold architecture as unsolved future work — we would be
building it, not adopting it.

---

## 7. HOW IT ADAPTS

### 7.1 Two layers, two clocks

- **Slow layer (ranking).** Gradient-boosted trees on scale-free structural features, trained on
  the doubling question, 180-day window with 21-day half-life recency weighting, retrained
  nightly.
- **Fast layer (calibration).** Isotonic calibration from rank score to absolute probability,
  fit on the last 7 days only, plus an alert threshold set nightly by budget.

**This split is also the diagnostic.** If ranking PR-AUC falls, **the model is broken**. If
PR-AUC holds while calibration drifts, **the market moved** — and the fast layer has already
absorbed it. That is the concrete answer to "how do you tell broken from moved," and it is the
reason to build it as two layers rather than one.

### 7.2 The monitoring panel

Label-free, firing ~6 hours before any label arrives:
- **PSI / KL per input feature.** PSI > 0.25 on any top-10 feature → investigate.
- **Prediction-distribution drift** — mean and quantiles of the score.

Label-bearing, 7-day rolling:
- **PR-AUC.** Drop >20% relative against the trailing 28-day mean → page. *Model broken.*
- **Calibration error and reliability slope.** Alarm only if the calibrator's implied base rate
  moves more than 2× week-over-week. *Market moved.*
- **SHAP importance churn.** Spearman correlation of top-5 importances against 28 days ago
  < 0.5 → regime review. This is the most *interpretable* item on the panel: author-follower
  features overtaking kinetic features **is** the celebrity/KOL regime arriving, visibly, in one
  number.
- **ADWIN or Page-Hinkley on the per-alert loss stream** for a formal changepoint. ADWIN is
  parameter-light, which matters because nobody will tune a threshold they cannot explain.

### 7.3 Schema drift is a distinct failure class and needs its own monitor

This is under-appreciated and the evidence for it is overwhelming. In the space of eighteen
months: `king_of_the_hill_timestamp` went from populated on 92–100% of coins to **0%**;
`raydium_pool` went null as graduation moved to PumpSwap; TikTok's `SIGI_STATE` container
disappeared entirely; Reddit deprecated r/all and closed unauthenticated JSON; X replaced its
entire ranking stack and stopped publishing weights. Every one of these would silently corrupt a
feature or a label rather than throwing.

**Monitor per-field null rate and value-distribution by cohort month, and alarm on step
changes.** A field that goes null for new cohorts while remaining populated for old ones is the
signature, and it is invisible to any aggregate check.

### 7.4 Exploration and regime state

- **Exploration slots: 10–15% of the alert budget, allocated by rule, not by score.** A UCB
  bonus proportional to `1/sqrt(n_similar_training_examples)`, so candidates *unlike* the
  training set are scored **up**, plus the 2% unconditional random holdout. This costs real
  precision and should be written down as a product commitment alongside the abstain band, or it
  will be quietly cut the first bad week.
- **Regime state as features, not filters.** Trailing 7-day count of coins clearing $1M peak;
  share of top coins whose source came from a ≥1M-follower account; median observed post-to-mint
  lag; pooled graduation rate (which fell 3.18× year-over-year, from 0.63% to 0.198%). Feeding
  regime state *in* lets one model span regimes instead of needing a new model per regime — and
  we never know we are in a new regime until after.
- **Champion/challenger, always.** Last week's frozen model scores in shadow permanently. A
  fresh model that does not beat the frozen one on the last 7 days does not promote. This is
  what stops a bad retrain landing silently *through* a regime break.

---

## 8. HOW WE AVOID THE CIRCULARITY

The objection is that a system trained on things that became coins can only find things that
look like things that became coins, and will therefore be structurally incapable of surfacing
the next unlike-anything case. It is the sharpest objection to this design and it deserves a
structural answer rather than reassurance.

**First, separate two different circularities. Only one is fatal.**

**(a) Feature circularity** — encoding "resembles a past winner" as an input. **This is fatal
and we ban it structurally.** No feature in the detection model may use *absolute semantic
position*: no cosine similarity to past winners, no nearest-winner distance, no topic-cluster
membership derived from the winner corpus. Embeddings are permitted only *relationally* —
distance to the centroid of the candidate's **own** reproducer set, dispersion within that set,
drift of that centroid over time. A "similarity to previous winners" feature is by construction
a derivative-finder.

**The cost of this ban is measurably near zero, which is why it is enforceable.** Content
features are the weakest family in every study that has measured them: 0.558 accuracy versus
0.780 for temporal on Facebook cascades; content-only R² below 0.05 on Twitter against 0.48 for
everything; adding human-rated content features to a cascade model moved R² from 0.34 *down* to
0.31; and on 2025 Reddit memes, ablating visual features changed PR-AUC by 0.00 while ablating
contextual features *improved* it. We are giving up almost nothing.

*One caveat, so the ban does not delete the wrong half of the system.* "Content is weak" is a
statement about predicting **spread**. Content is the only signal that answers a different
question — **coinability**: does this contain a nameable, tickerable subject. That question has
no temporal proxy, and it is the display stage's job. Keep content modelling; just do not let it
predict spread and do not let it index on past winners.

**(b) Label circularity** — the outcome label is derived from coins. This is real and cannot be
eliminated, because the product's outcome *is* a coin. But it is far weaker than it looks, for
three reasons.

1. **The label is a fact about crowd behaviour, not a description of a subject.** "This narrative
   produced a mint that cleared $1M" says nothing about penguins, hippos, or cartoon characters.
   It says a market formed. A model trained on shape can rank a subject with no coined analogue
   as long as its shape matches.
2. **The features that carry the model are the ones that transfer.** Temporal features are the
   only family that generalises across platform, domain and era: models trained on one dataset
   and tested on others transfer well using temporal features and badly using
   network-structural ones, and for other early-adopter features *even the direction of
   correlation flips between domains*. The 2013 Facebook ordering (temporal > actor > structure
   > content) reproduced exactly on 2025 Reddit under a fully algorithmic feed. Anchoring on
   temporal shape is what makes the learned function about *kinetics* rather than about
   *subject*.
3. **The auxiliary memeification head has no coin in its label at all.** It is computable on a
   corpus containing zero coins. It shares the trunk, so it pulls the representation toward
   "things that get copied" rather than "things that got coined."

**The five structural guarantees, ranked by strength.**

1. **No absolute semantic position in detection features.** Enforced as a code boundary: no
   display-stage feature, and no gradient from the display model, may reach the detection model.
   This is the only true *guarantee* in the list; the rest are mitigations.
2. **Two-sided novelty.** Replace any binary `−0.8 · [perceptual_hash_seen_in_30d]` term with
   `d/dt log(df_hash)`. **This is a concrete bug, not a preference.** A "seen recently → penalise"
   term is a repost-spam filter that fires on exactly the resurgence pattern that produced our
   two largest cases: Chill Guy's art had been circulating for 13 months and had already had a
   major August wave before the November one that made the money; Penguin's clip was 19 years
   old. Flat frequency on old content is spam and should score down. Accelerating frequency on
   old content is resurgence and should score **up**.
3. **Exploration allocated by rule, not by score.** 10–15% of the alert budget with a UCB bonus
   that explicitly scores *up* candidates unlike anything in training, plus the 2% unconditional
   random holdout. The system is required to spend budget on things it does not understand.
4. **The subject registry, not the post scorer.** A per-post monotone score structurally cannot
   represent a second wave. Chill Guy's coinable moment was 82 days after its first wave; a
   first-virality detector would have fired in August 2024 and been silent in November. Keep a
   persistent registry of every named subject with its historical peak rate, and alert on rate
   exceeding a fraction of that peak after dormancy. **This is the case the platforms themselves
   will not surface, which is precisely where an independent system earns its keep.**
5. **Measurement, so the guarantee is checkable rather than asserted.** Bucket test positives by
   distance to the nearest training positive and **report recall in the far bucket as a
   first-class metric**. If far-bucket recall collapses, the model is a derivative-finder no
   matter what the headline says. Nothing else in this section is worth anything without this
   number on the dashboard.

---

## 9. WHAT WE WILL MISS

"Never miss" is the goal and it is not achievable. Here is the decomposition, with the reasoning
shown so the estimate can be argued with.

**Component 1 — mechanism blindness, ~25–40% of coins clearing $1M.**
Authority launches (LIBRA at −3 minutes, HAWK planned at a vanity address) are undetectable in
principle. Crypto-native and AI-origin coins (Fartcoin, GOAT) are invisible to every consumer
platform, and their king-of-the-hill latencies of 57 seconds and 7m37s prove the buyers were
assembled privately. This share is violently regime-dependent — it was large in early 2025 and
smaller in the current organic-heavy meta — which is exactly why it must be a monitored regime
covariate rather than a fixed assumption.

**Component 2 — origin-platform blindness, ~15–25%.**
Instagram has no public post search and no realistic research access; Discord prohibits scraping
and enforces; YouTube's free quota is 100 searches per day. Jimothy originated on Instagram and
was minted within 48 hours; PNUT's seven-year, 534,000-follower Instagram presence was entirely
invisible. This is the largest *closable* gap in the list and closing it is a data-access
problem, not a modelling one.

**Component 3 — the irreducible statistical residual, and this is the one that caps everything
else.**
The closest published analogue to our task — predicting meme virality from the first 50 tweets —
recovers **36–42% of top-decile viral memes** at 0.62–0.66 precision, against a 0.09–0.11 random
baseline. On 2025 Reddit memes, F1 is 0.46 at 30 minutes. And the sharpest result: once you
control for *speed of early adoption* — which is our exact situation, because every candidate
we see is already fast — accuracy across four independent domains **drops below 65%**. The
familiar ~80% figures are substantially the tautology that fast things get big. We live in the
residual.

Underneath that sits a genuine ceiling: the best ex-ante models explain under half the variance
in cascade size even with unprecedented data, and simulation shows that introducing just 15%
variation in product quality drops the theoretical maximum from R²=0.93 to 0.60. Social
influence itself is the mechanism — increasing its strength increases both inequality *and*
unpredictability of outcomes; outside the extremes, "any other result was possible." The
memecoin market is maximally socially driven, which is the worst case for that bound.

**Component 4 — self-inflicted and therefore fixable.** English-only ingest would have cost 7–11
days of lead on Moo Deng, whose real signal was a Thai-language post with 4.6M views. TikTok
velocity driven off quantized `playCount` reads as flat. A silently dead Apify lane reports
success. These are not misses; they are bugs, and they are in §10.

**The number.** Combining these, on the current regime and on coins clearing $1M peak:

| | Estimate | Basis |
|---|---|---|
| Surfaced at **any** lead time | **40–60%** | Mechanism + platform coverage × statistical recall |
| Surfaced with **useful** lead time (before the run, not merely before the peak) | **20–35%** | The above, times the recall curve at τ≤60 min |
| Recall on *observable, organic* events at τ=60 min | **0.75–0.85** | Extrapolated from PR-AUC 0.82 at 420 min and the shape of the earliness curve |
| Recall on observable organic events at τ=5 min | **0.35–0.50** | Extrapolated from PR-AUC 0.52 at 30 min |

**Mark these honestly.** The *shape* — recall roughly doubles from τ=5 to τ=60; content-only is
weak; a hard ceiling well below 1 — is high confidence and multiply attested across four
independent studies, two platforms and three modelling generations. The *bands* are
extrapolations from Reddit-meme and Facebook-photo studies onto X/TikTok crypto-adjacent
content, and the mechanism-share components are a construction rather than a measurement, with
the regime-dependent component the least well evidenced. **These numbers do not go in marketing
until the ledger has measured them**, and they should be replaced by measurement within eight
weeks.

**What to promise instead.** Reframe from recall to **lead time conditional on surfacing**: *"of
the coins that peaked above $X, we surfaced N%, and for those our median lead over the run was
T minutes."* Recall is capped by physics and coverage. Lead time is not, and lead time is what
the user actually buys — a user does not experience a miss they never knew about; they
experience being late on the ones they saw.

**One uncomfortable implication from our own data.** The median coin among the top 1,050 ever
minted peaked near $546,380 and now sits near $2,977; only 16% of $1M-peak coins peaked within
24 hours; every organic case in §3 is down 94.8–99.3%. Being thirty minutes early into something
that peaks four days later and then gives back 99% is not self-evidently a win. **The
commercially decisive system may be "detect early *and* signal the peak", and only the first
half is currently designed.** That changes what the second model is, not just how good the first
one is, and it should be decided now rather than discovered later.

---

## 10. WHAT TO BUILD FIRST

Ordered. Each step is independently useful and none blocks on the one after it.

**1. Clock A: the PumpPortal mint stream, with gap detection and the exploration reservation.**
Supervised singleton, heartbeat, reconnect backoff, and an explicit gap log. This is the label
source and it cannot be backfilled; a dropped connection silently *inflates* every lead-time
number we will ever publish. Reserve the 5% ε-exploration slots and the 2% unconditional random
tracking holdout in the same commit, because neither can be added retroactively.
*Useful alone:* it is the ground truth for every claim the product makes.

**2. Replace the dead on-chain schema with live traction primitives.** `king_of_the_hill_timestamp` is null for 100% of 2026-minted coins; `raydium_pool` is null since 2025-04. Build
traction on bonding-curve reserve progress, unique-buyer velocity, and the `complete=true` /
pool-migration event, and add a per-field null-rate-by-cohort-month monitor so the next schema
death is caught in days rather than months.
*Useful alone:* it makes the label computable at all on current data.

**3. Free X signals from fields already ingested.** Quote-to-retweet ratio; second-half
acceleration off `post_snapshots`; engagement-per-impression. Zero marginal API cost. Validate
all three retrospectively against the ~1,000-winner corpus **before** wiring any of them into a
promotion gate — they are theory-backed and none has been measured on our label.
*Useful alone:* three candidate features and one honest answer about whether the replication
hypothesis holds on our data.

**4. Measure `viewCount` freshness.** Post-and-poll, or track a known post at 30-second
intervals. This is a half-day of work and it decides whether the entire engagement-per-impression
family exists for us. It ranks alongside the existing filter-rule billing test in importance.
*Useful alone:* it either unlocks or permanently retires a feature family.

**5. Fix the two-sided novelty term.** Replace the binary hash-seen penalty with
`d/dt log(df_hash)` over a 30–90 day daily-frequency series. This is a bug fix, not a feature —
the current term would have suppressed both of our largest resurgence cases.
*Useful alone:* immediate improvement to the arrival prior, no new data required.

**6. TikTok correctness pass.** Switch velocity off `playCount`/`diggCount` onto exact
`commentCount`/`shareCount`/`collectCount` deltas; assert on payload *shape* rather than status
code or non-empty body; alarm on consecutive zero-item Apify cycles per actor; stop charging
budget for zero-item runs. Then harvest `music.id`, `effectStickers`, `hashtagId`,
`suggestedWords` and `IsAigc` from every video already being fetched — they arrive free.
*Useful alone:* the TikTok lane starts producing signal instead of silent zeros, and the flat-view
kill switch can be retired.

**7. The 4chan catalog poller.** Free, no auth, no contract, 1 req/s, complete board state in one
call, sub-minute latency. Build it early **because there is no history** — boards turn over in
1.5–3 hours and the training data does not exist until we start recording.
*Useful alone:* the cheapest high-signal data in the stack, and the first leg of the crossing
detector.

**8. The reproduction index over ingested posts.** pHash plus embedding, DBSCAN clustering,
distinctive-span and quoted-phrase shingles, TikTok `music.id`, written as an inverted index at
ingest. Passive, no per-post polling, no API cost. Add quoted-text matching against new mint
`description` and `name` fields — the strongest join key observed anywhere in this study.
*Useful alone:* it makes distinct-creator counts and the memeification auxiliary label
computable, and it improves story-to-coin matching immediately.

**9. Model M60 first, not M5.** It has the most signal, so it validates the pipeline end-to-end
on the easiest version of the task. If M60 does not beat the heuristic and the
follower-count-alone baseline, nothing downstream will. Then M15, then M5, then M0 last — M0 is
hardest and least informative per the content ceiling, but it is also the one that cuts API cost
most, because it decides who gets snapshotted at all.
*Useful alone:* each horizon is a shippable re-ranker inside the existing gates.

**10. Model B, mint selection.** 306 chill-guy tokens; Penguin had at least three Solana mints.
Detection without selection surfaces the right narrative and the wrong contract. On-chain
features plus match confidence, trained on the same peak label, with liquidity and
holder-concentration gates.
*Useful alone:* it is the difference between an interesting board and a usable buy button.

**11. The discoverer roster.** Surprisal over adoption history against the existing winner
corpus, controlling for account activity level, bootstrapped, recomputed on a rolling window
rather than assumed stable for a year — crypto-Twitter turns over far faster than the offline
retail setting where the method was validated. Build it from *track record*, never from follower
counts or network centrality; centrality hubs were measurably not predictive.
*Useful alone:* it is the earliest usable non-temporal feature, evaluated as a set-membership
test at τ=0.

**12. Instagram and the news sensor — the two gap-closers.** Instagram is the largest
origin-platform blind spot (Jimothy, PNUT) and closing it is a data-access problem to be scoped
and priced, not a modelling problem. A separate news-event pipeline covers a large slice of what
replication detection structurally cannot, is cheap and high-precision, and would have caught
PNUT.
*Useful alone:* each is a distinct sensor whose output can be evaluated on its own.

**Two things to stop planning for.** TikTok's Research API is dead twice over — commercial
entities are ineligible, and even for the eligible it lags 48 hours on indexing and 10 days on
statistics. Reddit's free tier is non-commercial and therefore unavailable to us; the path
forward there is a legal decision about mirrors and contracts, not a $12,000 budget line.
