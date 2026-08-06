# Coinability prompt validation report

Generated: 2026-08-03T16:40:14.519Z
Posts rescored: **1305** · Narratives evaluated: **900**
Gate thresholds: MEME_MIN_X=0.6 · MEME_MIN_TT=0.75

> Validation run — scores are **not** written to production tables.

## Gate vs launch rate (narratives)

| Group | Count | Coined | Rate |
| --- | ---: | ---: | ---: |
| PASS (≥ meme_min) | 157 | 118 | **75.2%** |
| FAIL (< meme_min) | 743 | 11 | 1.5% |

Pass-rate lift: **+73.7 pts** (pass coined % − fail coined %)

## False positives — high score, never coined

These passed the gate but no matching Solana token launched after the post (DexScreener + GeckoTerminal).

| Score | Min | Title | Ticker | Reason |
| ---: | ---: | --- | --- | --- |
| 0.85 | 0.6 | Kangaroo Attack Becomes Meme Coin | KILLAROO | Kangaroo as a named, deployable character subject with clear visual identity and |
| 0.85 | 0.6 | Lee Know Kdrama Lead Casting | LEEKNOW | Lee Know is a named public figure (Stray Kids member) being memed as a potential |
| 0.85 | 0.6 | Robbo Is Our New Number 3️⃣ | ROBBO | Named player character (Robbo) joining a team with a specific jersey number — cl |
| 0.85 | 0.6 | Circe, By Wright Barker (1889) | CIRCE | Circe is a named mythological character with strong visual identity and meme pot |
| 0.85 | 0.6 | Tenna The Tv Host | TENNA | Tenna is a named character (TV host from Deltarune) with visual/meme potential a |
| 0.85 | 0.6 | Enhypen On The Walls Of The Hybe America | ENHYPEN | ENHYPEN is a named K-pop group with a clear visual identity and existing fanbase |
| 0.85 | 0.6 | Demigods Path Warning Emerges | DEMIGOD | Elden Ring is a named game/franchise with iconic lore and character archetypes;  |
| 0.85 | 0.6 | : Where Is Rm | RM | RM is a named public figure (BTS member) presented as a character in a cute, mem |
| 0.85 | 0.6 | How Remielle Shares Her Drink  | REMIELLE | Named character (Remielle) with a distinctive, repeatable behavioral trait that' |
| 0.85 | 0.6 | When You Spot  | ANDREY | Named player character (@04Andrey) with visual spotting moment; clear subject fo |

## False negatives — low score, but coined

These failed the gate but a subject-matching token launched after the narrative anchor post.

| Score | Min | Title | Matched | Launch | Source |
| ---: | ---: | --- | --- | --- | --- |
| 0.15 | 0.6 | Stray Kids(스트레이 키즈) "this & That" Unveil : | $$STRAY (STRAY) | 2026-07-25 | gecko |
| 0.20 | 0.6 | Hey Guys I'm Desvandev, I Was Part Of | $ZERO (ZERO) | 2026-08-02 | gecko |
| 0.25 | 0.6 | Feed Cleanse With A Smiley Lewis  | $Lewis (LEWIS) | 2026-07-25 | gecko |
| 0.25 | 0.6 | While All Of Crypto Twitter Is Mourning Decli | $PONS (PONS) | 2026-07-24 | gecko |
| 0.25 | 0.6 | The Story Event "wings Of Steam And Steel" | $Umamusume (UMAMUSUME) | 2026-07-30 | gecko |
| 0.30 | 0.6 | AI Trader Builds Real Economic Engine | $Trader (TRADER) | 2026-08-03 | gecko |
| 0.35 | 0.6 | Grok 4 | $GROKVASION (GROK) | 2026-07-30 | gecko |
| 0.50 | 0.6 | Yoongi Roasts Jungkook's Cake Lookalike | $JungKook (JUNGKOOK) | 2026-07-28 | gecko |
| 0.50 | 0.6 | Im Cryinggg…they Talked About Taehyung Pullin | $TAE (TAE) | 2026-07-28 | gecko |
| 0.50 | 0.6 | Mic Drop | $ElonCoin (ELONCOIN) | 2026-07-26 | gecko |

## Method

- **Rescore:** Claude coinability prompt (no Supabase writes)
- **Pass/fail:** narrative `meme_score` = highest-view member rescore vs `memeMinForNarrative`
- **Coined:** DexScreener + GeckoTerminal search on `suggested_ticker` / `suggested_name` words; pair must launch after oldest member `posted_at`
- **No X API** calls

## Old vs new score (posts)

| Metric | Value |
| --- | --- |
| Mean old score | 0.255 |
| Mean new score | 0.286 |
| Posts with score Δ ≥ 0.2 | 307 |

