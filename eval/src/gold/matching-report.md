# Gold-set matching: which coin is a feed post's

Rendered by `eval/src/gold/run-matching.ts` from `match-evidence.json` (`tools/gold-match-fetch.ts`). Each case is a post and the coins a search for its subject's name finds; the subject's name is taken to be the coin's own (the best case for finding the right coin and the worst case for wrong links). See `match-cases.ts` for the three kinds of post and `match-eval.ts` for what each outcome means.

Bars: grace before the post 10 min, timing window 48 h after it, a post id in a link at least 8 characters, a looser spelling at least 4 letters; "same picture" is GROUP's near-identical bar only (a judge's "same subject" on a borderline pair leaves it unknown; its "no" counts against). A name alone never makes an answer confident.

Before 2026-10-13 (commit a72648c, one name searched, metadata read for 31 of 68 coins, a judge's "same subject" counted as the same picture, and "the only coin of the exact name" made a confident answer): 7 of 71 origin posts right, 1 wrong, 63 missed; 6 wrong links in 353 posts (1.7%).

Cases with a finished search: 354 of 354. Picture comparisons held: 47; judge answers on borderline pairs: 7; coins whose metadata was read: 1748 of 1953 (708 from the creator's own host, the link naming no content id).

### Tuning half

49 origin posts (the right coin was among the search results for 28), 282 posts whose right answer is no coin (6 viral after launch, 276 unrelated).

| rule | origin posts: right | wrong | missed | no-coin posts: wrong | wrong links, all posts |
|---|---|---|---|---|---|
| today's rule (a post's search never names a coin) | 0.0% (0) | 0.0% (0) | 100.0% (49) | 0.0% (0) | 0.0% (0) |
| name only (the one coin with the exact name) | 16.3% (8) | 8.2% (4) | 75.5% (37) | 15.6% (44) | 14.5% (48) |
| evidence rule, one name searched (before 2026-10-13) | 16.3% (8) | 4.1% (2) | 79.6% (39) | 0.4% (1) | 0.9% (3) |
| evidence rule, every name searched (this change) | 20.4% (10) | 6.1% (3) | 73.5% (36) | 0.4% (1) | 1.2% (4) |

### Held out (origin posts only)

22 origin posts (the right coin was among the search results for 11), 1 posts whose right answer is no coin (1 viral after launch, 0 unrelated).

| rule | origin posts: right | wrong | missed | no-coin posts: wrong | wrong links, all posts |
|---|---|---|---|---|---|
| today's rule (a post's search never names a coin) | 0.0% (0) | 0.0% (0) | 100.0% (22) | 0.0% (0) | 0.0% (0) |
| name only (the one coin with the exact name) | 22.7% (5) | 4.5% (1) | 72.7% (16) | 0.0% (0) | 4.3% (1) |
| evidence rule, one name searched (before 2026-10-13) | 4.5% (1) | 0.0% (0) | 95.5% (21) | 0.0% (0) | 0.0% (0) |
| evidence rule, every name searched (this change) | 13.6% (3) | 0.0% (0) | 86.4% (19) | 0.0% (0) | 0.0% (0) |

### All

71 origin posts (the right coin was among the search results for 39), 283 posts whose right answer is no coin (7 viral after launch, 276 unrelated).

| rule | origin posts: right | wrong | missed | no-coin posts: wrong | wrong links, all posts |
|---|---|---|---|---|---|
| today's rule (a post's search never names a coin) | 0.0% (0) | 0.0% (0) | 100.0% (71) | 0.0% (0) | 0.0% (0) |
| name only (the one coin with the exact name) | 18.3% (13) | 7.0% (5) | 74.6% (53) | 15.5% (44) | 13.8% (49) |
| evidence rule, one name searched (before 2026-10-13) | 12.7% (9) | 2.8% (2) | 84.5% (60) | 0.4% (1) | 0.8% (3) |
| evidence rule, every name searched (this change) | 18.3% (13) | 4.2% (3) | 77.5% (55) | 0.4% (1) | 1.1% (4) |

Confident answers by reason: links this post 16, same picture and timing 1 (a name alone never makes one).

## Wrong links (evidence rule)

- bt2:214/2074695821896065360 (unrelated, Vled Tenuv / VLED): links, 3 coins weighed
- bt2:296/7658171823556676897 (origin, Nimis the Police Cat / Nimis): links, 15 coins weighed
- bt3:155/2072778994416603185 (origin, JUSTICE FOR CHRISTIAN ZEDIG / Christian): links, 15 coins weighed
- bt3:264/2061558621658394925 (origin, Jail Tristian Parsons / Tristian): links, 6 coins weighed

## Origin posts found

- bt2:1/7658657103057308942 (origin, Aura Bird / Stork): links, 18 coins weighed
- bt2:111/2074111506992583138 (origin, Help Alex's Mom / KIRB): links, 14 coins weighed
- bt2:145/2078521506007560474 (origin, Future Colosseum / CAGE): links, 22 coins weighed
- bt2:171/7666628409451121934 (origin, Nuannuan): links, 5 coins weighed
- bt2:179/2075190553185030606 (origin, The Jinchuriki of Black Bull / Bullchuriki): pictureAndTiming, 3 coins weighed
- bt2:242/2081733077198327841 (origin, TERMINATE THE FILIBUSTER / $SAVEACT): links, 13 coins weighed
- bt2:311/2077387825255690569 (origin, Solana soldiers / Solanadier): links, 2 coins weighed
- bt3:34/2069498273346310313 (origin, ESTAMOS AQUI! / IM BACK): links, 22 coins weighed
- bt3:86/2069526985475244388 (origin, Trashcan Capital / TRASHCAN): links, 2 coins weighed
- bt3:127/2069788716642582699 (origin, SpaceX Nasdaq-100 / SPCX NDX): links, 6 coins weighed
- bt3:223/2080002774582850025 (origin, TOTAL BEAR DEATH / Bear Rippe): links, 2 coins weighed
- bt3:327/2070253292383252879 (origin, Eyes Up, Guardians / Guardians): links, 12 coins weighed

