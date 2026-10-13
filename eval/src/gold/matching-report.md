# Gold-set matching: which coin is a feed post's

Rendered by `eval/src/gold/run-matching.ts` from `match-evidence.json` (`tools/gold-match-fetch.ts`). Each case is a post and the coins a search for its subject's name finds; the subject's name is taken to be the coin's own (the best case for finding the right coin and the worst case for wrong links). See `match-cases.ts` for the three kinds of post and `match-eval.ts` for what each outcome means.

Bars: grace before the post 10 min, timing window 48 h after it, a post id in a link at least 8 characters, a looser spelling at least 4 letters; picture bars are GROUP's (near-identical, or borderline and the judge said "the same subject").

Cases with a finished search: 353 of 354. Picture comparisons held: 24; judge answers on borderline pairs: 1; coins whose metadata was read: 31 of 68.

### Tuning half

49 origin posts (the right coin was among the search results for 17), 281 posts whose right answer is no coin (6 viral after launch, 275 unrelated).

| rule | origin posts: right | wrong | missed | no-coin posts: wrong | wrong links, all posts |
|---|---|---|---|---|---|
| today's rule (a post's search never names a coin) | 0.0% (0) | 0.0% (0) | 100.0% (49) | 0.0% (0) | 0.0% (0) |
| name only (the one coin with the exact name) | 22.4% (11) | 6.1% (3) | 71.4% (35) | 17.1% (48) | 15.5% (51) |
| evidence (this change) | 12.2% (6) | 2.0% (1) | 85.7% (42) | 1.8% (5) | 1.8% (6) |

### Held out (origin posts only)

22 origin posts (the right coin was among the search results for 8), 1 posts whose right answer is no coin (1 viral after launch, 0 unrelated).

| rule | origin posts: right | wrong | missed | no-coin posts: wrong | wrong links, all posts |
|---|---|---|---|---|---|
| today's rule (a post's search never names a coin) | 0.0% (0) | 0.0% (0) | 100.0% (22) | 0.0% (0) | 0.0% (0) |
| name only (the one coin with the exact name) | 13.6% (3) | 0.0% (0) | 86.4% (19) | 0.0% (0) | 0.0% (0) |
| evidence (this change) | 4.5% (1) | 0.0% (0) | 95.5% (21) | 0.0% (0) | 0.0% (0) |

### All

71 origin posts (the right coin was among the search results for 25), 282 posts whose right answer is no coin (7 viral after launch, 275 unrelated).

| rule | origin posts: right | wrong | missed | no-coin posts: wrong | wrong links, all posts |
|---|---|---|---|---|---|
| today's rule (a post's search never names a coin) | 0.0% (0) | 0.0% (0) | 100.0% (71) | 0.0% (0) | 0.0% (0) |
| name only (the one coin with the exact name) | 19.7% (14) | 4.2% (3) | 76.1% (54) | 17.0% (48) | 14.4% (51) |
| evidence (this change) | 9.9% (7) | 1.4% (1) | 88.7% (63) | 1.8% (5) | 1.7% (6) |

Confident answers by reason: links this post 6, same picture and timing 0, timing and the only exact name 7.

## Wrong links (evidence rule)

- bt2:150/2073522372272148980 (unrelated, baby toly wif hat / tolywifhat): timingAndName, 1 coins weighed
- bt2:203/2072374145447313813 (unrelated, HAAL-9000 / HAAL9K): timingAndName, 1 coins weighed
- bt2:203/2072415113995309563 (unrelated, HAAL-9000 / HAAL9K): timingAndName, 1 coins weighed
- bt2:214/2074695821896065360 (unrelated, Vled Tenuv / VLED): links, 2 coins weighed
- bt3:264/2061558621658394925 (origin, Jail Tristian Parsons / Tristian): links, 6 coins weighed
- bt3:371/2070553554335469883 (unrelated, GPT‑5.6 Sol / SOL): timingAndName, 25 coins weighed

## Origin posts found

- bt2:76/2079837600689332595 (origin, Half Rep / NADIA): links, 4 coins weighed
- bt2:111/2074111506992583138 (origin, Help Alex's Mom / KIRB): timingAndName, 5 coins weighed
- bt2:165/2072681271566708832 (origin, Dr Trump / DR TRUMP): timingAndName, 7 coins weighed
- bt2:306/2071770035425624410 (origin, The Jewish Bull / PORTNOY): timingAndName, 3 coins weighed
- bt3:34/2069498273346310313 (origin, ESTAMOS AQUI! / IM BACK): links, 4 coins weighed
- bt3:86/2069526985475244388 (origin, Trashcan Capital / TRASHCAN): links, 1 coins weighed
- bt3:421/2062062058376663408 (origin, Make Britain Great Again / MBGA): links, 4 coins weighed

