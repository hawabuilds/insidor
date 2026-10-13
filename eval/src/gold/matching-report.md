# Gold-set matching: which coin is a feed post's

Rendered by `eval/src/gold/run-matching.ts` from `match-evidence.json` (`tools/gold-match-fetch.ts`). Each case is a post and its candidate coins: every name's search results, the coins whose address was posted in the replies under it, and the coins whose picture's hash is close to the post's (searched over every coin the evidence holds, the 851 gold coins included, as the mint stream would have held them). The subject's name is the coin's own (the best case for finding the right coin and the worst case for wrong links). See `match-cases.ts` for the three kinds of post and `match-eval.ts` for what each outcome means.

Proven is only: the one coin whose links name the post; the one coin with the post's picture (embedding near-identical, or hashes within 10 of 64 bits) launched after it inside 48 h with every other such coin compared; or the one coin whose address the poster's own account posted under it. Likely: the top coin of the score when its share against the other candidates and "none of these" is at least 0.3. Grace before the post 10 min.

Weights (Policy.postCoin.weights): base -7.232, linksPost 1.175, linksAccount -0.218, picture 0.825, hash 0.495, description 0.205, authorAddress 0, othersAddress 0, timing 2.134, nameExact 2.768, nameVariant -0.46, tradingJump 0. Mean log-likelihood of the unproven choices: tuning -0.414 (305), held out -2.978 (16).

Before 2026-10-13 evening (commit 731b339: name search only, proof by links or by same picture, no score): 13 of 71 origin posts right, 3 wrong, 55 missed; 4 wrong links in 354 posts (1.1%). Of the 58 origin posts it did not get right: 30 the right coin was not among the candidates, 13 it ranked first but nothing proved it, 12 it ranked lower, 0 the name did not match, 3 another coin was proven.

Cases with a finished search: 354 of 354. Picture comparisons: 184 embedding pairs, 2427 pictures hashed. Replies read under 311 X posts (38 with an address). Coin metadata read: 1962 of 2134.

## Candidates as the live projector finds them (name searches, replies, picture, and the mint stream by name)

### Tuning half (fitted on)

49 origin posts (the right coin among the candidates for 46), 282 posts whose right answer is no coin (6 viral after launch, 276 unrelated).

| | proven right | proven wrong | likely right | likely wrong | missed |
|---|---|---|---|---|---|
| origin posts | 32.7% (16) | 4.1% (2) | 2.0% (1) | 0.0% (0) | 61.2% (30) |
| no-coin posts | — | 2.8% (8) | — | 0.0% (0) | — |

Wrong links (proven, the only answer with a Buy), all posts: **3.0% (10)**; on posts a feed can show (the shill rule holds 26 of these as ads): **2.0% (6)**. Likely shown on a wrong coin, all posts: 0.0% (0).

### Held out (never fitted on; origin posts only)

22 origin posts (the right coin among the candidates for 21), 1 posts whose right answer is no coin (1 viral after launch, 0 unrelated).

| | proven right | proven wrong | likely right | likely wrong | missed |
|---|---|---|---|---|---|
| origin posts | 31.8% (7) | 0.0% (0) | 0.0% (0) | 0.0% (0) | 68.2% (15) |
| no-coin posts | — | 0.0% (0) | — | 0.0% (0) | — |

Wrong links (proven, the only answer with a Buy), all posts: **0.0% (0)**; on posts a feed can show (the shill rule holds 3 of these as ads): **0.0% (0)**. Likely shown on a wrong coin, all posts: 0.0% (0).

### All

71 origin posts (the right coin among the candidates for 67), 283 posts whose right answer is no coin (7 viral after launch, 276 unrelated).

| | proven right | proven wrong | likely right | likely wrong | missed |
|---|---|---|---|---|---|
| origin posts | 32.4% (23) | 2.8% (2) | 1.4% (1) | 0.0% (0) | 63.4% (45) |
| no-coin posts | — | 2.8% (8) | — | 0.0% (0) | — |

Wrong links (proven, the only answer with a Buy), all posts: **2.8% (10)**; on posts a feed can show (the shill rule holds 29 of these as ads): **1.8% (6)**. Likely shown on a wrong coin, all posts: 0.0% (0).

## Candidates from the market search alone (as measured before; a coin that died is no longer listed)

### All, market search, replies and picture only

71 origin posts (the right coin among the candidates for 42), 283 posts whose right answer is no coin (7 viral after launch, 276 unrelated).

| | proven right | proven wrong | likely right | likely wrong | missed |
|---|---|---|---|---|---|
| origin posts | 19.7% (14) | 4.2% (3) | 1.4% (1) | 0.0% (0) | 74.6% (53) |
| no-coin posts | — | 2.1% (6) | — | 0.0% (0) | — |

Wrong links (proven, the only answer with a Buy), all posts: **2.5% (9)**; on posts a feed can show (the shill rule holds 29 of these as ads): **1.8% (6)**. Likely shown on a wrong coin, all posts: 0.0% (0).

Ranked first among the candidates where nothing proved a coin but the right one was there: 31 of 44.

Proven answers by reason: links this post 27, same picture and timing 5, the poster posted its address 1.

How the right coin became a candidate (origin posts where it was one, 67): by a market name search 39, by the replies 0, by its picture 9, by the mint stream's names 51; by its picture alone 0, by the replies alone 0, by the mint stream's names alone 25.

## Why an origin post was not proven right (after)

- the right coin was not among the candidates: 4
- it was a candidate, ranked first, but nothing proved it: 31
- it was a candidate but ranked lower: 13
- it was a candidate and the subject's name did not match it: 0
- of these, the likely coin was the right one: 1

## Proven wrong

- bt2:109/2071825984265809946 (unrelated, tune, just a dog / dog): provenWrong, pictureAndTiming, 15 candidates, held as an ad by the shill rule
- bt2:123/2074132167613919405 (unrelated, tune, The American Bull / DONALD): provenWrong, pictureAndTiming, 14 candidates
- bt2:130/2073906741595570396 (unrelated, tune, dog): provenWrong, links, 5 candidates
- bt2:147/2073485938341081101 (unrelated, tune, The Alpha Male / TATE): provenWrong, links, 16 candidates, held as an ad by the shill rule
- bt2:147/2073439229695136043 (unrelated, tune, The Alpha Male / TATE): provenWrong, links, 19 candidates, held as an ad by the shill rule
- bt2:150/2073522372272148980 (unrelated, tune, baby toly wif hat / tolywifhat): provenWrong, authorPostedAddress, 5 candidates, held as an ad by the shill rule
- bt2:296/7658171823556676897 (origin, tune, Nimis the Police Cat / Nimis): provenWrong, links, 15 candidates
- bt3:259/2068001364504904157 (unrelated, tune, Ligma Balls / LIGMA): provenWrong, links, 15 candidates
- bt3:264/2061558621658394925 (origin, tune, Jail Tristian Parsons / Tristian): provenWrong, links, 7 candidates
- bt3:407/2074132167613919405 (unrelated, tune, The American Bull / AMERICA): provenWrong, pictureAndTiming, 19 candidates

## Origin posts proven or likely right

- bt2:1/7658657103057308942 (origin, tune, Aura Bird / Stork): provenRight, links, 18 candidates
- bt2:4/2074100341155434793 (origin, tune, Attack On Pumpfun / AOP): likelyRight, likely, 37 candidates
- bt2:72/2080759984069947864 (origin, tune, Justice for Iryna Gorb / Iryna): provenRight, links, 15 candidates
- bt2:111/2074111506992583138 (origin, tune, Help Alex's Mom / KIRB): provenRight, links, 15 candidates, held as an ad by the shill rule
- bt2:133/2073034775569330570 (origin, holdout, Happy Independence Day / July 4th): provenRight, links, 17 candidates
- bt2:145/2078521506007560474 (origin, tune, Future Colosseum / CAGE): provenRight, links, 22 candidates
- bt2:155/2074224204132864115 (origin, tune, SpaceXAI): provenRight, links, 2 candidates
- bt2:171/7666628409451121934 (origin, holdout, Nuannuan): provenRight, links, 5 candidates
- bt2:179/2075190553185030606 (origin, tune, The Jinchuriki of Black Bull / Bullchuriki): provenRight, pictureAndTiming, 3 candidates
- bt2:242/2081733077198327841 (origin, holdout, TERMINATE THE FILIBUSTER / $SAVEACT): provenRight, links, 13 candidates
- bt2:311/2077387825255690569 (origin, tune, Solana soldiers / Solanadier): provenRight, links, 2 candidates
- bt3:34/2069498273346310313 (origin, tune, ESTAMOS AQUI! / IM BACK): provenRight, links, 22 candidates
- bt3:45/2066518673053868543 (origin, holdout, Пепе / Pepe): provenRight, links, 6 candidates
- bt3:71/2068615404919140775 (origin, tune, The Gambling Cat / Kirby): provenRight, pictureAndTiming, 5 candidates
- bt3:82/2071655261949788658 (origin, tune, Sonala reaches $200 / Sonala$200): provenRight, links, 1 candidates
- bt3:86/2069526985475244388 (origin, tune, Trashcan Capital / TRASHCAN): provenRight, links, 2 candidates
- bt3:122/2065107430787178590 (origin, tune, Evil Than Guns / GUILTY): provenRight, links, 19 candidates
- bt3:127/2069788716642582699 (origin, tune, SpaceX Nasdaq-100 / SPCX NDX): provenRight, links, 6 candidates
- bt3:189/2069911846812053747 (origin, holdout, The Hero / JUAN): provenRight, links, 28 candidates
- bt3:201/2073439229695136043 (origin, holdout, The Black Cobra / TATE): provenRight, links, 20 candidates, held as an ad by the shill rule
- bt3:223/2080002774582850025 (origin, holdout, TOTAL BEAR DEATH / Bear Rippe): provenRight, links, 3 candidates
- bt3:274/2062318641542988097 (origin, tune, Trump Mogged / MOGGED): provenRight, links, 11 candidates
- bt3:327/2070253292383252879 (origin, tune, Eyes Up, Guardians / Guardians): provenRight, links, 12 candidates
- bt3:421/2062062058376663408 (origin, tune, Make Britain Great Again / MBGA): provenRight, links, 20 candidates

