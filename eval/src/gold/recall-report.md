# Gold-set recall of live discovery

Rendered by `eval/src/gold/run-recall.ts` from `recall-evidence.json` (settings measured 2026-10-13 00:15 UTC, posts read 2026-10-13 00:16 UTC by `tools/recall-check.ts gold-fetch`). A model of today's settings applied to the founders' origin posts — the gold coins launched before live discovery ran, so none of this was observed. The daily check (`tools/recall-check.ts status`) is the observed counterpart.

## Headline

| | caught | median delay after posting |
|---|---|---|
| X origin posts, tuning half | 76% (28 of 37) | 1.6 min |
| X origin posts, held out (read once, not used to rank changes) | 56% (10 of 18) | 2.1 min |
| X origin posts, all | 69% (38 of 55) | 1.8 min |
| every origin post (TikTok and Instagram count as misses) | 54% (38 of 71) | 1.8 min |
| X origin posts, all, if approvals grew 3× slower | 58% (32 of 55) | 2.1 min |

Misses, X posts: under_floor 1, not_in_search 9, between_checks 5, deleted 2, not_on_x 0. Every origin post: under_floor 1, not_in_search 9, between_checks 5, deleted 2, not_on_x 16.

Caught before the coin launched: 37 of the 38 caught X posts.

## Today's settings, as the model uses them

| lane | approvals floor sent | window asked | reach measured | median age found | every | media only | posts found |
|---|---|---|---|---|---|---|---|
| all | 85 (base 508) | 10 min | 9.9 min | 7.3 min | 2.2 min | no | 1014 |
| media | 135 (base 809) | 10 min | 9.9 min | 6.7 min | 2.2 min | yes | 236 |
| slow | 500 (base 500) | 360 min | 43.2 min | 35.6 min | 15 min | no | 98 |

- Language: `lang:en`; replies and reposts excluded (`-filter:replies -filter:retweets`). No keyword term runs: the runner's pass logs show only the catch-all lanes, so a post is found by its approvals alone, never by what it says.
- **Floor sent** is the stored base floor (internal.feed_floor) scaled to the lane's window (core `effectiveFloor`); it adapts after every pass toward the day's budget, so it moves over the day.
- **Reach measured** is the 95th percentile of the age at which the lane first found its posts (internal.item_found_by), capped at the window it asks for. The slow lane asks for 360 minutes, but it takes 3 pages of 20 posts newest first, and those fill within the first ~43 minutes: a post that crosses 500 approvals later than that is never returned.
- **Every** is the median gap between passes that found something (main lanes) or the policy cadence (slow lane).
- **Growth.** Approvals at age t are assumed to be `final × (1 − e^(−t/τ))`, with the count read now as final and τ = 64.3 min fitted to 258 live posts' first and last readings. A post is caught at the first pass after it crosses a lane's floor (taken as half a pass later), if that is still within the lane's reach. The 3× slower row shows how much rests on τ.
- Replies are detected by the text opening with a mention (the read post carries no reply flag); `zxx` is X's language for a post with no words.

## Cheapest change that catches the most misses

Ranked on the tuning half's X posts (9 missed there). Extra cost is the worst case at $0.00015 a post returned.

| change | what it does | extra caught, tuning | extra caught, held out | extra X cost a day (worst) | cost basis |
|---|---|---|---|---|---|
| catch-all also accepts posts with no words (lang:zxx beside lang:en) | a picture or video with no text is tagged zxx, not en, so `lang:en` drops it — some of the biggest origin posts are exactly that | 2 | 2 | $0.10 | 1 post a pass (measured once) × 655 main passes a day |
| main lanes look back 20 min instead of 10 | floor scales with the window (Policy.feed.fullWindowMin), so all 85 → 170, media 135 → 270 | 0 | 0 | $0.00 | none at the lanes’ targets (the doubled floor holds posts per pass) |
| slow lane: 6 pages instead of 3 | reach 43 → ~58 min of a post's age (each page about 5 min, measured) | 0 | 0 | $0.86 | 3 more pages × 96 passes a day × 20 posts |
| slow lane floor 500 → 250, 6 pages | half the floor; the extra pages keep the reach where it is (assumed) | 0 | 0 | $0.86 | 3 more pages × 96 passes × 20 posts |
| slow lane: 9 pages instead of 3 | reach 43 → ~74 min of a post's age (each page about 5 min, measured) | 0 | 0 | $1.73 | 6 more pages × 96 passes a day × 20 posts |
| slow lane every 5 min instead of 15 | same reach, a third of the wait between passes | 0 | 0 | $1.73 | 3 pages × 192 more passes a day × 20 posts |
| no language filter at all | also Spanish, Russian, Thai… origin posts | 4 | 3 | not priced | not priced: every language is several times the English volume; at fixed targets the floors would rise and English posts near the floor would be lost, which this model does not see |

Best on the tuning half: **catch-all also accepts posts with no words (lang:zxx beside lang:en)** — 2 more caught for $0.10 a day at worst. Not applied.

## Every origin post

Delay is minutes from posting to the first pass that would return it; "before launch" is minutes from then to the coin's first transaction (negative: after). The last column is the verdict if approvals grew 3× slower.

| coin | split | ticker | platform | account | posted (UTC) | approvals now | lang | picture | kind | verdict | delay | before launch | slow growth |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bt2:1 | tune | Stork | tiktok | @cazy.chan | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:4 | tune | AOP | x | blkiz06 | 2026-07-06 11:57 | 4571 | en | yes | original | caught (all) | 2.3 min | 27 | caught |
| bt2:28 | holdout | HIM | x | himgajria | 2026-06-30 15:01 | 584 | en | no | reply | not_in_search | — | — | not_in_search |
| bt2:45 | holdout | Ivy | tiktok | @ivyvibing | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:49 | holdout | WINGIT | x | bayraktar_1love | 2026-07-12 10:50 | 43697 | en | yes | original | caught (all) | 1.2 min | 3197 | caught |
| bt2:62 | tune | MeiMei | tiktok | @meimeiwarrior | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:63 | holdout | imy | x | 7i__g | 2026-07-27 23:27 | 99437 | zxx | yes | original | not_in_search | — | — | not_in_search |
| bt2:64 | tune | GROK | x | elonmusk | 2026-07-23 05:38 | 18384 | en | no | original | caught (all) | 1.4 min | 485 | caught |
| bt2:72 | tune | Iryna | x | dailymail | 2026-07-24 21:00 | 14 | en | no | original | under_floor | — | — | under_floor |
| bt2:76 | tune | NADIA | x | theufcarchive | 2026-07-22 07:55 | 76143 | en | yes | original | caught (all) | 1.2 min | 2878 | caught |
| bt2:111 | tune | KIRB | x | blkiz06 | 2026-07-06 12:41 | 3193 | en | no | original | caught (all) | 2.8 min | -2 | caught |
| bt2:118 | tune | CUBEMAN | instagram | reel | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:120 | tune | Nenem | instagram | reel | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:133 | holdout | July 4th | x | trumpdailyposts | 2026-07-03 13:23 | 3883 | en | yes | original | caught (all) | 2.5 min | 9 | caught |
| bt2:145 | tune | CAGE | x | elonmusk | 2026-07-18 16:45 | 124044 | en | yes | original | caught (all) | 1.1 min | 3413 | caught |
| bt2:148 | holdout | America250 | x | karluskap | 2026-07-02 10:52 | 40289 | en | yes | original | caught (all) | 1.2 min | 327 | caught |
| bt2:155 | tune | SpaceXAI | x | cb_doge | 2026-07-06 20:09 | 1390 | en | yes | original | caught (all) | 5.2 min | 2 | between_checks |
| bt2:158 | tune | MOONAM | x | khaosodenglish | 2026-06-29 02:30 | 198 | en | yes | original | between_checks | — | — | between_checks |
| bt2:159 | tune | Gatoelho | instagram | reel | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:165 | holdout | DR TRUMP | x | realdoldtrump | 2026-07-02 13:58 | 177815 | zxx | yes | original | not_in_search | — | — | not_in_search |
| bt2:171 | holdout | Nuannuan | tiktok | @sosspritee | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:179 | tune | Bullchuriki | x | blkiz06 | 2026-07-09 12:09 | 9304 | en | yes | original | caught (all) | 1.7 min | 158 | caught |
| bt2:192 | holdout | Horses | x | breaking911 | 2026-07-27 15:20 | 3003 | en | yes | original | caught (all) | 2.9 min | 1223 | caught |
| bt2:209 | tune | blepunc | x | nypost | 2026-07-27 23:59 | 205 | en | yes | original | between_checks | — | — | between_checks |
| bt2:220 | holdout | FRANK | tiktok | @stunna.nj | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:241 | holdout | PVP | x | inkblotistan | 2026-07-26 17:42 | 6899 | en | yes | original | caught (all) | 1.9 min | 343 | caught |
| bt2:242 | holdout | $SAVEACT | x | whitehouse | 2026-07-27 13:26 | 50603 | en | yes | original | caught (all) | 1.2 min | 41 | caught |
| bt2:252 | tune | Himithy | tiktok | @drerivera6 | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:272 | tune | Lala | x | rainmaker1973 | 2026-07-18 13:30 | 21963 | en | yes | original | caught (all) | 1.3 min | 1312 | caught |
| bt2:288 | tune | Andrea | tiktok | @speedvonandrea | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:294 | holdout | NICK | x | nickshirleyy | 2026-07-02 16:42 | 40182 | en | yes | original | caught (all) | 1.2 min | 16 | caught |
| bt2:295 | tune | MrSue | tiktok | @kinqspade69 | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:296 | tune | Nimis | tiktok | @dutchbreakingnews | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt2:299 | holdout | Xianba | x | pubity | 2025-07-08 07:15 | 488 | en | yes | original | between_checks | — | — | between_checks |
| bt2:306 | tune | PORTNOY | x | polymarket | 2026-06-30 01:37 | 6359 | en | no | original | caught (all) | 2.0 min | 20 | caught |
| bt2:311 | tune | Solanadier | x | mert | 2026-07-15 13:40 | 3344 | en | no | original | caught (all) | 2.8 min | 295 | caught |
| bt3:2 | holdout | BANKS | x | banks | 2026-06-21 18:57 | 126 | qme | yes | reply | not_in_search | — | — | not_in_search |
| bt3:31 | tune | ME | x | bengruenbaum | 2026-06-29 18:51 | 2331 | en | no | original | caught (all) | 3.5 min | 373 | caught |
| bt3:34 | tune | IM BACK | x | cristia | 2026-06-23 19:10 | 1582033 | es | yes | original | not_in_search | — | — | not_in_search |
| bt3:45 | holdout | Pepe | x | wild_spb | 2026-06-15 13:50 | 3772 | ru | yes | original | not_in_search | — | — | not_in_search |
| bt3:55 | tune | Fushin | x | siligremlin | 2026-07-23 19:16 | 15794 | en | yes | original | caught (all) | 1.4 min | 6724 | caught |
| bt3:71 | tune | Kirby | x | nexta_tv | 2026-06-21 08:42 | 15791 | en | yes | original | caught (all) | 1.4 min | 12 | caught |
| bt3:82 | tune | Sonala$200 | x | mert | 2026-06-29 18:01 | 1836 | en | no | original | caught (all) | 4.1 min | 34 | between_checks |
| bt3:86 | tune | TRASHCAN | x | nypost | 2026-06-23 21:04 | 45892 | en | yes | original | caught (all) | 1.2 min | 1735 | caught |
| bt3:91 | tune | MOODER | x | and_khamoo | 2026-04-08 09:09 | 4446 | th | yes | original | not_in_search | — | — | not_in_search |
| bt3:122 | tune | GUILTY | x | litcapital | 2026-06-11 16:22 | 141352 | en | yes | original | caught (all) | 1.1 min | 628 | caught |
| bt3:127 | tune | SPCX NDX | x | cb_doge | 2026-06-24 14:24 | 4479 | en | yes | original | caught (all) | 2.3 min | 25 | caught |
| bt3:155 | tune | Christian | x | visegrad24 | 2026-07-02 20:26 | 16305 | en | yes | original | caught (all) | 1.4 min | 8 | caught |
| bt3:177 | tune | BUYDIP | x | 0xbags | 2026-03-24 11:08 | 13448 | en | yes | original | caught (all) | 1.5 min | 109500 | caught |
| bt3:189 | holdout | JUAN | x | weathermonitors | 2026-06-24 22:33 | 2928 | en | yes | original | caught (all) | 3.0 min | 52 | caught |
| bt3:201 | holdout | TATE | x | cobratate | 2026-07-04 16:10 | 4519 | en | yes | original | caught (all) | 2.3 min | 94 | caught |
| bt3:209 | tune | Carina | x | amazlngnature | 2026-07-22 18:14 | 1695 | en | yes | original | caught (all) | 4.4 min | 88 | between_checks |
| bt3:219 | tune | AIRDROP | x | polymarket | 2026-06-02 12:15 | 2099 | en | no | original | caught (all) | 3.8 min | 1493 | caught |
| bt3:223 | holdout | Bear Rippe | x | pumpfun | 2026-07-22 18:51 | 1712 | en | yes | original | caught (all) | 4.4 min | 42 | between_checks |
| bt3:233 | tune | DATBIHGAH | tiktok | @michael_ovo | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt3:235 | tune | Tubtim | instagram | reel | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt3:239 | holdout | DATBIHGAH | instagram | reel | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt3:264 | tune | Tristian | x | brokenbritain0 | — | — | — | — | — | deleted | — | — | deleted |
| bt3:274 | tune | MOGGED | x | whitehouse | 2026-06-03 23:40 | 23781 | en | yes | original | caught (all) | 1.3 min | 519 | caught |
| bt3:277 | tune | BOUTYWORK | x | discordiaclips | 2026-06-06 23:42 | 2514 | en | yes | original | caught (all) | 3.3 min | 256 | caught |
| bt3:291 | tune | AIRDROP | x | nichxbt | — | — | — | — | — | deleted | — | — | deleted |
| bt3:297 | holdout | Alfie | x | dexerto | 2026-06-17 15:00 | 470 | en | yes | original | between_checks | — | — | between_checks |
| bt3:307 | tune | LIGHT | tiktok | @committee.of.affairs | — | — | — | — | — | not_on_x | — | — | not_on_x |
| bt3:324 | holdout | FITNESS | x | fitness_solana | 2026-06-23 20:15 | 286 | en | yes | original | between_checks | — | — | between_checks |
| bt3:327 | tune | Guardians | x | whitehouse | 2026-06-25 21:10 | 41276 | en | yes | original | caught (all) | 1.2 min | 20 | caught |
| bt3:341 | tune | FIT | x | sciencegirl | 2026-07-27 11:14 | 218065 | en | no | original | caught (all) | 1.1 min | 1403 | caught |
| bt3:370 | tune | RTM | x | blkiz06 | 2026-06-21 02:45 | 4430 | zxx | yes | original | not_in_search | — | — | not_in_search |
| bt3:409 | tune | Becker | x | zssbecker | 2026-06-30 11:15 | 1262 | en | yes | original | caught (all) | 5.6 min | 2 | between_checks |
| bt3:421 | tune | MBGA | x | elonmusk | 2026-06-03 06:41 | 354979 | en | no | original | caught (all) | 1.1 min | 351 | caught |
| bt3:427 | tune | NoDi | x | emily_sundberg | 2026-06-06 13:54 | 1196 | en | yes | original | caught (all) | 5.8 min | 327 | between_checks |
| bt3:430 | tune | something | x | its_jawsh | 2026-07-27 18:57 | 75304 | zxx | yes | original | not_in_search | — | — | not_in_search |
