# Coinability prompt validation report

Generated: 2026-08-03T19:07:09.779Z
Posts rescored: **972** · Narratives evaluated: **629**
Gate thresholds: MEME_MIN_X=0.6 · MEME_MIN_TT=0.75

> Validation run — scores are **not** written to production tables.

## Gate vs launch rate (narratives)

| Group | Count | Coined | Rate |
| --- | ---: | ---: | ---: |
| PASS (≥ meme_min) | 210 | 154 | **73.3%** |
| FAIL (< meme_min) | 419 | 5 | 1.2% |

Pass-rate lift: **+72.1 pts** (pass coined % − fail coined %)

## K-pop / sports / fandom consistency

Named idols, groups, athletes, streamers — should score PASS (≥ meme_min) under v2 prompt.

| Metric | v2 (this run) | v1 (baseline) |
| --- | ---: | ---: |
| Fandom-tagged narratives | 88 | — |
| Fandom PASS rate | 72.7% (64/88) | — |
| **Fandom false negatives** (fail + coined) | **1** | **3** |
| Fandom fail below min | 24 | — |

### Remaining fandom false negatives

| Score | Title | Ticker | Coin matched |
| ---: | --- | --- | --- |
| 0.15 | Real Madrid Closed Training Match | MADRID | $Madrid FC |

## False positives — high score, never coined

These passed the gate but no matching Solana token launched after the post (DexScreener + GeckoTerminal).

| Score | Min | Title | Ticker | Reason |
| ---: | ---: | --- | --- | --- |
| 0.85 | 0.6 | Kangaroo Attack Becomes Meme Coin | KILLAROO | Named subject: the Kangaroo (KillaRoo) as a character/meme icon with clear coin  |
| 0.85 | 0.6 | Circe, By Wright Barker (1889) | CIRCE | Circe is a named mythological character/subject with visual art focus, deployabl |
| 0.85 | 0.6 | : Every British Drinks Black Tea In The *(fandom)* | YOONGI | Named idol (Yoongi/Suga) as the subject of fan appreciation; clear fanbase deplo |
| 0.85 | 0.6 | : Where Is Rm *(fandom)* | RM | RM (BTS member) is the named subject with massive fanbase; post depicts him as a |
| 0.85 | 0.6 | Maybe Next Time | ZUKKA | Named ship/pairing (Zukka) with established fandom; coinable character relations |
| 0.85 | 0.6 | God Of War Laufey Launches February 16, 2027 | LAUFEY | Named artist (Laufey) as the subject of a major project announcement with establ |
| 0.85 | 0.6 | When You Spot  | ANDREY | Named player (@04Andrey) as the focus subject with fan engagement and visual med |
| 0.85 | 0.6 | The Infamous Teen Frisk | FRISK | Named fictional character (Frisk from Undertale) with established fanbase and me |
| 0.85 | 0.6 | Singing Less By Olivia Rodrigo While Playing Piano | CARMEN | Named person (Carmen) as the subject performing/singing — clear deployable chara |
| 0.85 | 0.6 | Lmao Yoongi Face *(fandom)* | YOONGI | Named idol (Yoongi/SUGA from BTS) with fanbase, post centers on him as subject/c |

## False negatives — low score, but coined

These failed the gate but a subject-matching token launched after the narrative anchor post.

| Score | Min | Title | Matched | Launch | Source |
| ---: | ---: | --- | --- | --- | --- |
| 0.15 | 0.6 | Real Madrid Closed Training Match *(fandom)* | $Madrid FC (MADRID) | 2026-07-27 | gecko |
| 0.20 | 0.6 | Sealed With A Selfie  | $Villain (VILLA) | 2026-07-28 | gecko |
| 0.25 | 0.6 | The Best Kind Of Gift | $HOUSECAT (HOUSE) | 2026-07-27 | gecko |
| 0.25 | 0.6 | The Public Agrees With Julia: Samraj To Julia | $Julian (JULIA) | 2026-07-28 | gecko |
| 0.30 | 0.6 | Love Is Better When Multiplied  #알파드라이브원 #리오 | $FLASHDRIVE (DRIVE) | 2026-08-02 | gecko |

## Method

- **Rescore:** Claude coinability prompt (no Supabase writes)
- **Pass/fail:** narrative `meme_score` = highest-view member rescore vs `memeMinForNarrative`
- **Coined:** DexScreener + GeckoTerminal search on `suggested_ticker` / `suggested_name` words; pair must launch after oldest member `posted_at`
- **No X API** calls

## Old vs new score (posts)

| Metric | Value |
| --- | --- |
| Mean old score | 0.242 |
| Mean new score | 0.406 |
| Posts with score Δ ≥ 0.2 | 401 |

