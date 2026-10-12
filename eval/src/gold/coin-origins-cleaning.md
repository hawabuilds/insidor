# Coin-origin gold set: what the import cleaned

Written by `tools/gold-import.ts` from the founders' backtest2 and backtest3 blind sheets. 850 coins.
Created times are the block time of each coin's first transaction on the chain; the sheet's own value is kept as `createdAtSheet`.

## The split (seed 20261012, 30% held out, stratified)

| stratum | coins | tune | holdout |
|---|---|---|---|
| no viral origin | 772 | 540 | 232 |
| x | 61 | 43 | 18 |
| tiktok | 11 | 8 | 3 |
| instagram | 6 | 4 | 2 |

## Coins left out, and duplicates removed (15)

- bt2:276 and bt3:74 (BIGTROUT): BIGTROUT is backtest2 row 276 (viral: x.com/pusholder/status/2079311468231545077) and backtest3 row 74 (no viral origin). The founders' rule: viral only if that post came before the mint. It did not — posted 2026-07-20 21:04 UTC (from its id), minted 2026-06-30 19:22 UTC (first transaction on the chain), 20 days earlier. Both copies are left out.
- bt2:20 (BANDOW) is the same coin as bt3:93, labelled the same (no viral origin); one copy kept, bt3:93.
- bt2:34 (Jazz) is the same coin as bt3:394, labelled the same (no viral origin); one copy kept, bt3:394.
- bt2:131 (JUNK) is the same coin as bt3:213, labelled the same (no viral origin); one copy kept, bt3:213.
- bt2:184 (maxing) is the same coin as bt3:310, labelled the same (no viral origin); one copy kept, bt3:310.
- bt2:205 (ARRR) is the same coin as bt3:165, labelled the same (no viral origin); one copy kept, bt3:165.
- bt2:235 (TEMPURA) is the same coin as bt3:236, labelled the same (no viral origin); one copy kept, bt3:236.
- bt2:267 (soltoly) is the same coin as bt3:214, labelled the same (no viral origin); one copy kept, bt3:214.
- bt2:300 (ansembrain) is the same coin as bt3:203, labelled the same (no viral origin); one copy kept, bt3:203.
- bt2:304 (Bullji) is the same coin as bt3:401, labelled the same (no viral origin); one copy kept, bt3:401.
- bt2:308 (MENSAHOOD) is the same coin as bt3:369, labelled the same (no viral origin); one copy kept, bt3:369.
- bt2:329 (MOTHER) is the same coin as bt3:83, labelled the same (no viral origin); one copy kept, bt3:83.
- bt2:365 (MOOBULL) is the same coin as bt3:295, labelled the same (no viral origin); one copy kept, bt3:295.
- bt2:381 (USWR) is the same coin as bt3:148, labelled the same (no viral origin); one copy kept, bt3:148.
- bt2:413 (USOX) is the same coin as bt3:412, labelled the same (no viral origin); one copy kept, bt3:412.

## Every fix, row by row

- backtest2 header: `me` read as `name`.
- backtest2 header: `funny_t_serious (Y/N)` read as `funny_not_serious (Y/N)`.
- backtest2 header: `crypto_ticed (Y/N)` read as `crypto_noticed (Y/N)`.
- backtest2 header: `tes` read as `notes`.
- backtest2 row 72: origin_platform " X" trimmed to "X".
- backtest2 row 76: origin_platform " X" trimmed to "X".
- backtest2 row 118: origin_platform "Instagram " trimmed to "Instagram".
- backtest2 row 120: origin_platform "Instagram " trimmed to "Instagram".
- backtest2 row 133: origin_platform " X" trimmed to "X".
- backtest2 row 133: `has_character (Y/N)` "Yes " read as Yes.
- backtest2 row 145: origin_platform " X" trimmed to "X".
- backtest2 row 155: origin_platform " X" trimmed to "X".
- backtest2 row 159: origin_platform "Instagram " trimmed to "Instagram".
- backtest2 row 171: origin_platform " Tiktok " trimmed to "Tiktok".
- backtest2 row 220: origin_platform "X", but the link is on tiktok; the link wins.
- backtest2 row 241: `has_character (Y/N)` "Yes " read as Yes.
- backtest2 row 242: viral but no Y/N labels; features left unlabelled.
- backtest2 row 270: post_url is only whitespace; no origin.
- backtest2 row 310: post_url is only whitespace; no origin.
- backtest2 row 312: post_url is only whitespace; no origin.
- backtest2 row 316: post_url is only whitespace; no origin.
- backtest2 row 319: post_url is only whitespace; no origin.
- backtest2 row 323: post_url is only whitespace; no origin.
- backtest2 row 324: post_url is only whitespace; no origin.
- backtest2 row 328: post_url is only whitespace; no origin.
- backtest2 row 330: post_url is only whitespace; no origin.
- backtest2 row 331: post_url is only whitespace; no origin.
- backtest2 row 333: post_url is only whitespace; no origin.
- backtest2 row 339: post_url is only whitespace; no origin.
- backtest2 row 343: post_url is only whitespace; no origin.
- backtest2 row 344: post_url is only whitespace; no origin.
- backtest2 row 345: post_url is only whitespace; no origin.
- backtest2 row 359: post_url is only whitespace; no origin.
- backtest2 row 360: post_url is only whitespace; no origin.
- backtest2 row 361: post_url is only whitespace; no origin.
- backtest2 row 362: post_url is only whitespace; no origin.
- backtest2 row 363: post_url is only whitespace; no origin.
- backtest2 row 364: post_url is only whitespace; no origin.
- backtest2 row 365: post_url is only whitespace; no origin.
- backtest2 row 366: post_url is only whitespace; no origin.
- backtest2 row 367: post_url is only whitespace; no origin.
- backtest2 row 374: post_url is only whitespace; no origin.
- backtest2 row 375: post_url is only whitespace; no origin.
- backtest2 row 376: post_url is only whitespace; no origin.
- backtest2 row 377: post_url is only whitespace; no origin.
- backtest2 row 378: post_url is only whitespace; no origin.
- backtest2 row 379: post_url is only whitespace; no origin.
- backtest2 row 380: post_url is only whitespace; no origin.
- backtest2 row 381: post_url is only whitespace; no origin.
- backtest2 row 382: post_url is only whitespace; no origin.
- backtest2 row 383: post_url is only whitespace; no origin.
- backtest2 row 384: post_url is only whitespace; no origin.
- backtest2: 436 coins, 563 empty rows skipped.
- backtest3 row 2: origin_platform " X" trimmed to "X".
- backtest3 row 45: origin_platform " X" trimmed to "X".
- backtest3 row 55: `works_as_photo (Y/N)` "Yesss" read as Yes.
- backtest3 row 127: origin_platform " X" trimmed to "X".
- backtest3 row 155: origin_platform " X" trimmed to "X".
- backtest3 row 177: `one_word (Y/N)` "Yes " read as Yes.
- backtest3 row 179: origin https://www.instagram.com/kabosumama?igsh=e0YmV6ODh3cm03 is an account, not a post; imported as viral with an account origin, out of the "right origin" score.
- backtest3 row 274: `ticker_in_replies (Y/N)` "No " read as No.
- backtest3 row 307: viral but no Y/N labels; features left unlabelled.
- backtest3 row 320: `created` holds "6oPG5q5SPNtQTxeu8RRWvh6mngsauznC2SVVtXqPpump", not a date; created time from the chain.
- backtest3 row 322 (HODLY): mint was empty; taken from its pump.fun link (6oPG5q5SPNtQTxeu8RRWvh6mngsauznC2SVVtXqPpump).
- backtest3 row 341: origin_platform "Yes", but the link is on x; the link wins.
- backtest3 sheet row 435: no coin on it, only ["."]; skipped.
- backtest3: 430 coins, 569 empty rows skipped.
- backtest2 row 2: name "Toly The Claysaur" replaced by the CSV's "Toly The Claynosaur".
- backtest2 row 2: creatorLink "https://x.com/OrigilDevoor/status/2077044726558069187?s=20" replaced by the CSV's "https://x.com/OriginalDevoor/status/2077044726558069187?s=20".
- backtest2 row 4: description "Ansem sigled the trenches: Attack On PumpFun. 75% for Ansem!" replaced by the CSV's "Ansem signaled the trenches: Attack On PumpFun. 75% for Ansem!".
- backtest2 row 10: mint "GYyVR4v8RDXPmRzvCY9UUeD1hTnWYEzsReePF9pump" replaced by the CSV's "GYyVR4v8RDXPmRzvCY9UUeD1hTnWYEzsnoReePF9pump" (the sheet's is it with characters missing).
- backtest2 row 15: description "$CR7 - a Tribute to Cristia Roldo's Fil World Cup. Available on Phantom Wallet & Pump.fun." replaced by the CSV's "$CR7 - a Tribute to Cristiano Ronaldo's Final World Cup. Available on Phantom Wallet & Pump.fun.".
- backtest2 row 17: description "$CR7 - a Tribute to Cristia Roldo's Fil World Cup. Available on Phantom Wallet & Pump.fun." replaced by the CSV's "$CR7 - a Tribute to Cristiano Ronaldo's Final World Cup. Available on Phantom Wallet & Pump.fun.".
- backtest2 row 20: description "I’d describe BANDOW as a cryptocurrency with the spirit of a cturl opportunist: a bit bold, streetwise, and meme-y, but with a strong visual identity. t …" replaced by the CSV's "I’d describe BANDOW as a cryptocurrency with the spirit of a nocturnal opportunist: a bit bold, streetwise, and meme-y, but with a strong visual identity. Not a “serious bank in a suit,” but a crowned raccoon in a hoodie".
- backtest2 row 20: mint "6VeWzwfEbrsGhWtkZXvcnQn77i1wqh1QBzPMddpump" replaced by the CSV's "6VeWzwfEbrsGhWtkZXvcnQn77i1wqnah1QBzPMddpump" (the sheet's is it with characters missing).
- backtest2 row 22: description "TeddyLY – a little bear with a big heart. He doesn’t kw crypto, only love. Send TeddyLY to someone you care about. Because some things money can’t say." replaced by the CSV's "TeddyLY – a little bear with a big heart. He doesn’t know crypto, only love. Send TeddyLY to someone you care about. Because some things money can’t say.".
- backtest2 row 25: name "The Sola Bull" replaced by the CSV's "The Solana Bull".
- backtest2 row 25: description "Toly built the chain. w he's unleashing the bull. It's time to make SOL bullish again." replaced by the CSV's "Toly built the chain. Now he's unleashing the bull.\nIt's time to make SOL bullish again.".
- backtest2 row 25: creatorLink "https://x.com/SolaBull_toly" replaced by the CSV's "https://x.com/SolanaBull_toly".
- backtest2 row 27: description "From the deepest green of Sola rose Ansemhood — cloak of the capy, quiver of arrows, and the orange hat that marks every true ranger of the realm." replaced by the CSV's "From the deepest green of Solana rose Ansemhood — cloak of the canopy, quiver of arrows, and the orange hat that marks every true ranger of the realm.".
- backtest2 row 29: description "$VAGUE keeps it blurry on purpose — half-sentences, strange hints, and Sola sigl wrapped in pure fog 🫥 Say less, let minds wander, and watch the meme grow…" replaced by the CSV's "$VAGUE keeps it blurry on purpose — half-sentences, strange hints, and Solana signal wrapped in pure fog 🫥 Say less, let minds wander, and watch the meme grow through mystery, projection, and quiet obsession 🧠🧲".
- backtest2 row 30: name "Tung Tung Tung Agamemn" replaced by the CSV's "Tung Tung Tung Agamemnon".
- backtest2 row 34: mint "G2aMQNmM5H2ru1WpDPgPgqsjnzXDEYM4q7V9capump" replaced by the CSV's "G2aMQNmM5H2ru1WpDPgPgqsjNanzXDEYM4q7V9capump" (the sheet's is it with characters missing).
- backtest2 row 43: description "Reserve-Class Asset governce framework. Stewardship authority overseeing MXI on the XRPL. RAK Digital Assets Oasis." replaced by the CSV's "Reserve-Class Asset governance framework. Stewardship authority overseeing MXI on the XRPL. RAK Digital Assets Oasis.".
- backtest2 row 49: description "PLAN.STILL FLYING." replaced by the CSV's "NO PLAN.STILL FLYING.".
- backtest2 row 52: description "The image shows a plush toy with a white body, featuring two small, fabric-covered horns on its head. It is wearing large, dark sunglasses and has a small, bei…" replaced by the CSV's "The image shows a plush toy with a white body, featuring two small, fabric-covered horns on its head. It is wearing large, dark sunglasses and has a small, beige beak. Around its neck, there is a red ribbon tied into a bow. The background is a plain, light-colored wall.".
- backtest2 row 53: description "Yuan Token or e-CNY (Digital Yuan) is the official digital currency issued by the People's Bank of Chi (PBOC)" replaced by the CSV's "Yuan Token or e-CNY (Digital Yuan) is the official digital currency issued by the People's Bank of China (PBOC)".
- backtest2 row 53: creatorLink "https://x.com/Realfincial2/status/2024124468130443484?s=20" replaced by the CSV's "https://x.com/Realfinancial2/status/2024124468130443484?s=20".
- backtest2 row 54: description "$SHIPS - We don't chase green candles. We are the green candle. Every Piy sailor is a sleeping whale. You work 25 years for someone else's yacht. w make yo…" replaced by the CSV's "$SHIPS - We don't chase green candles. We are the green candle. Every Pinoy sailor is a sleeping whale. You work 25 years for someone else's yacht. Now make your own. 20% dev buy = 86M $SHIPS. Liquidity locked. From Manila Bay to the Moon. No rug, just waves. We ride together, we sink or we sail. All hands on deck. LFG SeamanDAO! 🚢💀".
- backtest2 row 57: description "Albemarle City is located in the Floyd Church Formation of the Caroli Slate Belt. Thickly bedded, axially cleaved meta-mudstone and meta-argillite are common…" replaced by the CSV's "Albemarle City is located in the Floyd Church Formation of the Carolina Slate Belt. Thickly bedded, axially cleaved meta-mudstone and meta-argillite are common in this formation, interbedded with meta-sandstone, meta-conglomerate and meta-volcanic rock. Biotite is the most prevalent Paleozoic metamorphic rock in the region.\n\nThough its bedrock is among the oldest in the region, the city itself is young, founded in early 2024. In its short history Albemarle has been abandoned and rebuilt more times than any settlement of comparable size. Local tradition holds that its foundations cannot be destroyed.".
- backtest2 row 58: description "You thought the grass was greener on the Robinhood chain? h, it's just synthetic and full of suits. You tried playing it safe, but the trenches are calling. …" replaced by the CSV's "You thought the grass was greener on the Robinhood chain? Nah, it's just synthetic and full of suits. You tried playing it safe, but the trenches are calling. Pumpfun is where the real ones make it, where legends are born, and rugs are dodged. Stop LARPing as an institutional investor. Bridge back, embrace the chaos, and reunite with the actual culture. We kept your seat warm. Welcome back, $HOMIE.".
- backtest2 row 60: description "$BULLPOST uses half of the creator rewards to spam new pairs, bullposting in the trenches. Furthermore, it uses the second half to pay people to bullpost. With…" replaced by the CSV's "$BULLPOST uses half of the creator rewards to spam new pairs, bullposting in the trenches.\n\nFurthermore, it uses the second half to pay people to bullpost. With an already hired team to start us off.\n\nThe coin will also be LIVE on PumpFun so you guys can see everything play out.".
- backtest2 row 62: description "The greatest meme cat is going hella viral again. Mei Mei is a cutie patootie. She has infinite different styles and rocks them all! She can even dance. In oth…" replaced by the CSV's "The greatest meme cat is going hella viral again. Mei Mei is a cutie patootie. She has infinite different styles and rocks them all! She can even dance. In other words, Mei Mei is the goat.".
- backtest2 row 69: description "Mitch is our leader, a legend, and the person we respect the most. However, he has been banned. I will live-stream and shout 'Free Mitch' a million times to pa…" replaced by the CSV's "Mitch is our leader, a legend, and the person we respect the most. However, he has been banned. I will live-stream and shout \"Free Mitch\" a million times to pay tribute to Mitch, uphold justice for him, and hope that his ban can be lifted. I will miss our hero".
- backtest2 row 70: name "Fibocci Frog" replaced by the CSV's "Fibonacci Frog".
- backtest2 row 72: ticker "Iry" replaced by the CSV's "Iryna".
- backtest2 row 72: name "Justice for Iry Gorb" replaced by the CSV's "Justice for Iryna Gorb".
- backtest2 row 72: description "Justice for Iry Gorb" replaced by the CSV's "Justice for Iryna Gorb".
- backtest2 row 75: description "trumplet: Bid bold and play smart with dymic trumps!" replaced by the CSV's "trumplet: Bid bold and play smart with dynamic trumps!".
- backtest2 row 76: ticker "DIA" replaced by the CSV's "NADIA".
- backtest2 row 77: description "It came from the static. A black sigl on a dead screen." replaced by the CSV's "It came from the static. A black signal on a dead screen.".
- backtest2 row 78: description "Accelerated is a permissionless perpetual futures layer for the long tail of Sola memecoins. It lets any token that has graduated on Pump.fun be leverage tra…" replaced by the CSV's "Accelerated is a permissionless perpetual futures layer for the long tail of Solana memecoins. It lets any token that has graduated on Pump.fun be leverage traded up to 5× regardless of market cap, liquidity, or how degenerate the chart looks by routing risk through a unified, oracle-priced margin engine instead of fragmented AMM pools.".
- backtest2 row 78: mint "gcAVCckv7CrCKQwxWYYxRkiUwsPqEEhd5jK8Qpump" replaced by the CSV's "gcAVCckv7CrCKQwxWYYNaxRkiUwsPqEEhd5jK8Qpump" (the sheet's is it with characters missing).
- backtest2 row 79: name "SBF did thing wrong" replaced by the CSV's "SBF did nothing wrong".
- backtest2 row 85: description "THE WORLD’S 1st ‘MEME SUPERSTAR’ 🐒✨ Welcome to $WOBBLE – The primate primed for world domition! Wobble Monkey is the world’s first Superstar Meme token. An …" replaced by the CSV's "THE WORLD’S 1st ‘MEME SUPERSTAR’ 🐒✨\n\nWelcome to $WOBBLE – The primate primed for world domination!\n\nWobble Monkey is the world’s first Superstar Meme token. An innovation that begins a new Meta for the Meme universe.\n\nOn launch, he drops his debut single ‘WOBBLE’ across all his Social Media Channels and showcases his music videos on his official Website.\n\n✅ Go check them out now!\n\nBringing together crypto, music, memes, creativity, and community into one unstoppable global movement 🔥🚀\n\nHolders, creators, artists, musicians, and fans will build Wobble into the Super Heavyweight King of Crypto & Music Culture. The new King of Pop has arrived!\n\nGET IN EARLY & JOIN THE WOBBLE ARMY\n✅ Remix WOBBLE’S tracks. ✅ Drop your dance video. ✅ Make a meme.  ✅ Create your own WOBBLE song. ✅ Tag us in all your posts on X and let’s build this superstar together.\n\n‘Ape in & Get Wobbling Y’all !‘💃🕺🐒\n\nDEV WALLET: Bought at launch and will only be used for LPs, competitions, rewards, and marketing. Never sells.".
- backtest2 row 89: description "In a world where most memecoins are just ise, Lobokay is a story. A story the community writes together." replaced by the CSV's "In a world where most memecoins are just noise, Lobokay is a story.\n\nA story the community writes together.".
- backtest2 row 93: description "Velaris — A Next-Generation Digital Asset Velaris is a modern digital currency designed to build a secure, transparent, and sustaible fincial ecosystem in …" replaced by the CSV's "Velaris — A Next-Generation Digital Asset\n\nVelaris is a modern digital currency designed to build a secure, transparent, and sustainable financial ecosystem in an increasingly digital world.\n\nThe project is driven by long-term vision and trust. Velaris combines the core principles of decentralization, security, and technological efficiency, providing a reliable foundation for storing and transferring value without intermediaries.\n\nAt its core, Velaris follows a strict economic model: a fixed supply, no hidden inflation mechanisms, and full execution through smart contracts. This ensures predictability, fairness, and protection against manipulation.\n\nVelaris is more than just a token — it is a tool for the future:\n\t•\tseamless peer-to-peer transactions\n\t•\tintegration with decentralized finance (DeFi)\n\t•\ta reliable store of value\n\t•\tscalable infrastructure for ecosystem growth\n\nOur mission is to create a digital asset that merges technology with trust, unlocking new financial opportunities worldwide.\n\nVelaris stands for stability, transparency, and forward momentum.".
- backtest2 row 94: description "The fil digital knight has loaded into a broken fantasy system." replaced by the CSV's "The final digital knight has loaded into a broken fantasy system.".
- backtest2 row 98: description "The Farmer Bull $SUPERMAN “Superman isn’t a hero. He’s just a farmer bull.” Promises a better future. Gets everyone to believe. Pumps hope to all-time highs. D…" replaced by the CSV's "The Farmer Bull $SUPERMAN\n\n“Superman isn’t a hero. He’s just a farmer bull.”\n\nPromises a better future. Gets everyone to believe. Pumps hope to all-time highs. \n\nDisappears when things get complicated. Comes back after every crash. Rebrand and repeats.\n\nBasically a soft-rugging and farmer dev with no mercy. By the time anyone noticed, he had launched 10+ coins in 1 day and farm it.".
- backtest2 row 105: description "$PUMPCAT is the community token of PumpCat.Fun - a cat catching game that runs in your browser, built on the Gamified Yield protocol. Playing extracts $GMYLD, …" replaced by the CSV's "$PUMPCAT is the community token of PumpCat.Fun - a cat catching game that runs in your browser, built on the Gamified Yield protocol. Playing extracts $GMYLD, the protocol's token.\nHolding $PUMPCAT unlocks access to game modes, boosts, perks and limited drops as they ship. The launch allocation sits in a public wallet used only for giveaways, bounties and airdrops. Do the tutorial and get a free ticket at pumpcat.fun".
- backtest2 row 106: description "I am just tired of these hype and scams on pumpfun. I will burn my dev share, making total supply of this coin to 824 million. Then I will leave forever. Just …" replaced by the CSV's "I am just tired of these hype and scams on pumpfun.\nI will burn my dev share, making total supply of this coin to 824 million.\nThen I will leave forever.\nJust a coin in memory of Kobe.".
- backtest2 row 111: creatorLink "https://x.com/blkiz06/status/2074111506992583138" replaced by the CSV's "https://x.com/blknoiz06/status/2074111506992583138".
- backtest2 row 112: description "The American AI Fund is the first tokenized infrastructure asset backing the United States' tiol artificial intelligence rollout. As AI demand surges, comp…" replaced by the CSV's "The American AI Fund is the first tokenized infrastructure asset backing the United States' national artificial intelligence rollout. As AI demand surges, compute, energy, and data infrastructure are becoming the most critical resources on earth. $AAIF consolidates the revenue from these pillars into a single on-chain asset for America's AI backbone. Backed by the architects of the AI revolution.".
- backtest2 row 113: name "The Sola Guy" replaced by the CSV's "The Solana Guy".
- backtest2 row 113: creatorLink "https://x.com/blkiz06/status/2072377674257801375" replaced by the CSV's "https://x.com/blknoiz06/status/2072377674257801375".
- backtest2 row 118: description "Ever feel like the outside world is way too complicated? Cubeman gets it. He chooses to focus on the simple things: retro gaming on a vintage PC, ranking up in…" replaced by the CSV's "Ever feel like the outside world is way too complicated? Cubeman gets it. He chooses to focus on the simple things: retro gaming on a vintage PC, ranking up in his headset, and enjoying chocolate bars on the couch.\n\nHe represents a generation looking for instant entertainment, a good laugh, and a zero-drama space. No fake promises—just good vibes, internet meme culture, and a solid community journey!".
- backtest2 row 120: description "Nenem is a cat from Taió, Santa Catari, Brazil. With jimothy virality Nenem is going insanely viral in Brazil again" replaced by the CSV's "Nenem is a cat from Taió, Santa Catarina, Brazil. With jimothy virality Nenem is going insanely viral in Brazil again".
- backtest2 row 121: name "The Sola Bull" replaced by the CSV's "The Solana Bull".
- backtest2 row 123: ticker "DOLD" replaced by the CSV's "DONALD".
- backtest2 row 123: creatorLink "https://x.com/USroldcarter/status/2074464529379918082?s=20" replaced by the CSV's "https://x.com/USronaldcarter/status/2074464529379918082?s=20".
- backtest2 row 126: ticker "Gambi" replaced by the CSV's "Gambino".
- backtest2 row 127: description "do u kw wtf ? This CATS ?" replaced by the CSV's "do u know wtf ? This CATS ?".
- backtest2 row 130: creatorLink "https://x.com/blkiz06/status/2073906741595570396" replaced by the CSV's "https://x.com/blknoiz06/status/2073906741595570396".
- backtest2 row 131: mint "EpfoYfZLxU42XJ92Yj1DWT9DCCX85pp4NsJyuipump" replaced by the CSV's "EpfoYfZLxU42XJ92Yj1DWT9DCCX85pNop4NsJyuipump" (the sheet's is it with characters missing).
- backtest2 row 133: description "Sophie just crossed the Delaware with Caitlin Clark and the rest of her team and took command! Happy Independence Day, America! 🇺🇸🏀" replaced by the CSV's "Sophie just crossed the Delaware with Caitlin Clark and the rest of her team and took command! \n\nHappy Independence Day, America! 🇺🇸🏀".
- backtest2 row 134: description "Automated arbitrage across prediction markets. BTC Up/Down module on @Sola. 90ms execution. Powered by @jup_predict. Runs 24/7." replaced by the CSV's "Automated arbitrage across prediction markets. BTC Up/Down module on @Solana. 90ms execution. Powered by @jup_predict. Runs 24/7.".
- backtest2 row 146: description "i kw! and aya say joe you mayaneva congress... well guess wat yaal tull me i couldn't pass... theyeeflashun reduction act... yaal tull me i couldn't.. basica…" replaced by the CSV's "i know! and aya say joe you mayaneva congress... well guess wat yaal tull me i couldn't pass... theyeeflashun reduction act... yaal tull me i couldn't.. basically... anyway...\n\nwegunnaburrensaa sam said we're gonna build 2 million affudable homes... caprenny increases 5 percenna year so cuurrporate landluhds can't... guuh... anyway...\n\nby the way! ...nunonly saves lives saves taxpayers just as i did on the first round on... doon doon pedicure... it save the taxpayer 160 billion dollars! cuzay dun haffta pay these exobidan prices to these... anyway...\n\n- joe biden, 2024".
- backtest2 row 150: description "Small hat. Big dreams. Infinite memes. Baby Toly wif hat is a community-driven parody memecoin bringing the cutest energy to the Sola ecosystem." replaced by the CSV's "Small hat. Big dreams. Infinite memes.\nBaby Toly wif hat is a community-driven parody memecoin bringing the cutest energy to the Solana ecosystem.".
- backtest2 row 152: name "Sola Life" replaced by the CSV's "Solana Life".
- backtest2 row 153: creatorLink "https://x.com/Supermanchain/status/2071833493475324271" replaced by the CSV's "https://x.com/Supermanonchain/status/2071833493475324271".
- backtest2 row 154: description "The origil me for Sola was Cash Cat." replaced by the CSV's "The original name for Solana was Cash Cat.".
- backtest2 row 155: mint "HHDRWwYw6FXFAaLMJ9XsUJ5NhMJHVEECTkkfpapump" replaced by the CSV's "HHDRWwYw6FXFAaLMJ9XsUJ5NhMJHVNoEECTkkfpapump" (the sheet's is it with characters missing).
- backtest2 row 156: ticker "WIFRMIE" replaced by the CSV's "WIFNORMIE".
- backtest2 row 156: name "Wif rmie" replaced by the CSV's "Wif Normie".
- backtest2 row 158: ticker "MOOM" replaced by the CSV's "MOONAM".
- backtest2 row 158: name "Moo m Tok" replaced by the CSV's "Moo Nam Tok".
- backtest2 row 166: description "plunge into the toly town $TOLY citadel where every 'Do it!' doubles as an airdrop ping—it's all interwoven with Sola-kept meta-vibes and DeFi currents swirl…" replaced by the CSV's "plunge into the toly town $TOLY citadel where every 'Do it!' doubles as an airdrop ping—it's all interwoven with Solana-kept meta-vibes and DeFi currents swirling like Olympic laps we didn't know we wanted to spectate, but hype needs no explanation, mark your wallets! 🚀".
- backtest2 row 168: name "Hex on Sola" replaced by the CSV's "Hex on Solana".
- backtest2 row 168: description "The Future of Fince is Here" replaced by the CSV's "The Future of Finance is Here".
- backtest2 row 170: description "“The One who never sold… The One who held through the fire… The One who believed when everyone else paper-handed… That One has been chosen.”" replaced by the CSV's "“The One who never sold…\nThe One who held through the fire…\nThe One who believed when everyone else paper-handed…\nThat One has been chosen.”".
- backtest2 row 171: creatorLink "https://x.com/genyratiol/status/2081742738802766303" replaced by the CSV's "https://x.com/genyrational/status/2081742738802766303".
- backtest2 row 173: description "In memory of the Ayatollah — the Iranian people have spoken. Freedom, resistance, and one last middle finger to the USA. 🇮🇷 $IRAN 100% of fees automatically …" replaced by the CSV's "In memory of the Ayatollah — the Iranian people have spoken. Freedom, resistance, and one last middle finger to the USA. 🇮🇷 $IRAN\n\n100% of fees automatically reinvested into buyback and burn in the name of Allah.".
- backtest2 row 178: description "The Smol Mole $SMOLE by @0xdekadente , Same deployer as the 2024 $SMOLE that raised ~$32M in presale and hit $200M MC. @0xdekadente is back and ready to run it…" replaced by the CSV's "The Smol Mole $SMOLE by @0xdekadente , Same deployer as the 2024 $SMOLE that raised ~$32M in presale and hit $200M MC. @0xdekadente is back and ready to run it again.  Smaller. Cuter. Stronger. Run it back turbo".
- backtest2 row 179: creatorLink "https://x.com/blkiz06/status/2075205751203610773" replaced by the CSV's "https://x.com/blknoiz06/status/2075205751203610773".
- backtest2 row 180: description "SolTrust isn't a meme—it's the next evolution of treasury infrastructure on Sola. Building the decentralized asset treasury (DAT) ecosystem with AI-powered a…" replaced by the CSV's "SolTrust isn't a meme—it's the next evolution of treasury infrastructure on Solana.\nBuilding the decentralized asset treasury (DAT) ecosystem with AI-powered automation, secure infrastructure, lightning-fast execution, and real-world utility.\nDesigned for users, builders, and enterprises. Backed by a strong community, with growing interest from multiple U.S. DAT companies.\nThe future of decentralized treasury starts here".
- backtest2 row 184: creatorLink "https://x.com/vaaaaaah/status/2040640915941826601?s=20" replaced by the CSV's "https://x.com/novaaaaaah/status/2040640915941826601?s=20".
- backtest2 row 184: mint "8Wv92jAVjPRGEf9c87XLiDkzdYq3dT2fa3scpump" replaced by the CSV's "8Wv92jAVjPRGEnaf9c87XLiDkzdYqNo3dT2fa3scpump" (the sheet's is it with characters missing).
- backtest2 row 189: description "$LONGDOG — The Longest Neck in Crypto Bitten by the crypto virus. Neck stretches to the moon with every green candle.  fear.  stop loss. Just pure chaotic …" replaced by the CSV's "$LONGDOG — The Longest Neck in Crypto Bitten by the crypto virus. Neck stretches to the moon with every green candle.\nNo fear. No stop loss. Just pure chaotic joy.Red candle? WEEEEEEEEEE!\n-70%? Still WEEEEEEEEEE!No Stop Loss. Only Longdog.\nStretch it till we hit the moon.In Longdog We Trust".
- backtest2 row 193: description "$ORCA puts Claude, Codex, and Cursor into isolated pods, letting agents run parallel without worktree chaos 🐋 Review touched files, swap models anytime, then …" replaced by the CSV's "$ORCA puts Claude, Codex, and Cursor into isolated pods, letting agents run parallel without worktree chaos 🐋 Review touched files, swap models anytime, then PR safely from containers that remember every task 🤖".
- backtest2 row 195: name "360scope420blazeit" replaced by the CSV's "360noscope420blazeit".
- backtest2 row 196: description "The bull who did t become angry. He became weather." replaced by the CSV's "The bull who did not become angry. He became weather.".
- backtest2 row 197: mint "F9fAYJUD7sgYif6aLFvSq6vM3A6KyU8KfF1k2ppump" replaced by the CSV's "F9fAYJUD7sgYinaf6aLFvSq6vM3A6KyU8KfF1k2ppump" (the sheet's is it with characters missing).
- backtest2 row 198: description "Toly Hood aims every arrow toward a stronger Sola" replaced by the CSV's "Toly Hood aims every arrow toward a stronger Solana".
- backtest2 row 200: description "$LONGDOG — The Longest Neck in Crypto Bitten by the crypto virus. Neck stretches to the moon with every green candle.  fear.  stop loss. Just pure chaotic …" replaced by the CSV's "$LONGDOG — The Longest Neck in Crypto Bitten by the crypto virus. Neck stretches to the moon with every green candle.\nNo fear. No stop loss. Just pure chaotic joy.Red candle? WEEEEEEEEEE!\n-70%? Still WEEEEEEEEEE!No Stop Loss. Only Longdog.\nStretch it till we hit the moon.In Longdog We Trust".
- backtest2 row 202: description "Born from the GME squeeze spirit and Keith Gill’s stand against Wall Street — inspired by $ANSEM. Man + Bull. Discipline. Diamond hands. For the retail warrior…" replaced by the CSV's "Born from the GME squeeze spirit and Keith Gill’s stand against Wall Street — inspired by $ANSEM. Man + Bull. Discipline. Diamond hands. For the retail warriors who believe the little guy wins.".
- backtest2 row 204: description "$LONGDOG — The Longest Neck in Crypto Bitten by the crypto virus. Neck stretches to the moon with every green candle.  fear.  stop loss. Just pure chaotic …" replaced by the CSV's "$LONGDOG — The Longest Neck in Crypto Bitten by the crypto virus. Neck stretches to the moon with every green candle.\nNo fear. No stop loss. Just pure chaotic joy.Red candle? WEEEEEEEEEE!\n-70%? Still WEEEEEEEEEE!No Stop Loss. Only Longdog.\nStretch it till we hit the moon.In Longdog We Trust".
- backtest2 row 205: description "The World's First Agentic Crowdcoded Game Play at www.arrr.fun" replaced by the CSV's "The World's First Agentic Crowdcoded Game\n\nPlay at www.arrr.fun".
- backtest2 row 205: mint "5u83eeMKS5drqAdchhJQeUpt7x4DU7ZBMZjUpump" replaced by the CSV's "5u83eeMKS5drqAdchhJQeUpt7x4DNaU7ZBnaMZjUpump" (the sheet's is it with characters missing).
- backtest2 row 207: description "Plant, Harvest, Own🌱 Grow your on-chain farm on Sola🚜" replaced by the CSV's "Plant, Harvest, Own🌱\nGrow your on-chain farm on Solana🚜".
- backtest2 row 210: description "$USWR | Tokenized exposure to the future of clean water infrastructure. As AI demand and global shortages rise, clean water becomes the world's most valuable r…" replaced by the CSV's "$USWR | Tokenized exposure to the future of clean water infrastructure. As AI demand and global shortages rise, clean water becomes the world's most valuable resource. Control the reserve. Control the future.".
- backtest2 row 211: description "Paint-born misfit with a cracked grin, wild eyes, and SPGR energy. Splinter Grin turns market ise into color." replaced by the CSV's "Paint-born misfit with a cracked grin, wild eyes, and SPGR energy. Splinter Grin turns market noise into color.".
- backtest2 row 215: description "Milton, the viral dancing rat with 4.5M+ followers and 800M+ views. Official creator onboarded, all creator fees directed to the artist. Artist has added CA in…" replaced by the CSV's "Milton, the viral dancing rat with 4.5M+ followers and 800M+ views. Official creator onboarded, all creator fees directed to the artist. Artist has added CA into his bio with 4M followers on Tiktok".
- backtest2 row 216: description "Im going to buy 65% of $ANSEMYIELD and will lock it fully! Every 15mins 0.065% unlocks and switches it to $ANSEM coins which will then be send out to all holde…" replaced by the CSV's "Im going to buy 65% of $ANSEMYIELD and will lock it fully! \nEvery 15mins 0.065% unlocks and switches it to $ANSEM coins which will then be send out to all holders. \n\nHold $ANSEMYIELD to receive $ANSEM coins".
- backtest2 row 223: description "world connects 50 country sub-coins on http://pump.fun, where fees from each tion's token flow back to burn the hub token $world. Built-in buybacks mechanism" replaced by the CSV's "world connects 50 country sub-coins on http://pump.fun, where fees from each nation's token flow back to burn the hub token $world. Built-in buybacks mechanism".
- backtest2 row 226: ticker "Sil" replaced by the CSV's "Snail".
- backtest2 row 228: description "$CASHCOON — They chased the pump. We found the treasure. The mascot of those who move first, think differently, and never stop building. Built for community." replaced by the CSV's "$CASHCOON — They chased the pump. We found the treasure.\nThe mascot of those who move first, think differently, and never stop building. Built for community.".
- backtest2 row 233: description "welfare work dera sacha sauda sirsa harya india help blood dotion other work tree 🎄 paltion body dotion eye dotion" replaced by the CSV's "welfare work dera sacha sauda sirsa haryana india help blood donation other work tree 🎄 palnation body donation eye donation".
- backtest2 row 235: mint "BXEk2tf9DfrdS7heWN9GyaQwf5QiLp4uxrwHUNpump" replaced by the CSV's "BXEk2tf9DfrdS7heWNNa9GyaQwf5QiLp4uxrwHUNpump" (the sheet's is it with characters missing).
- backtest2 row 236: name "DO T BUY DEV TO SNIPED" replaced by the CSV's "DO NOT BUY DEV TO SNIPED".
- backtest2 row 236: creatorLink "https://x.com/Supermanchain/status/2071984552386715879" replaced by the CSV's "https://x.com/Supermanonchain/status/2071984552386715879".
- backtest2 row 237: ticker "ob" replaced by the CSV's "noob".
- backtest2 row 237: name "ob" replaced by the CSV's "noob".
- backtest2 row 238: description "Billy is stuck in a 31-day loop where every day gets weirder than the last. Some days he’s chilling, some days he’s running, some days the hat is on fire. $BIL…" replaced by the CSV's "Billy is stuck in a 31-day loop where every day gets weirder than the last. Some days he’s chilling, some days he’s running, some days the hat is on fire. $BILLY31 is just the calendar of a guy who never gets a normal day.".
- backtest2 row 239: description "We are simply liquidity engineering. We are buying up lots of supply of this token, airdropping it as locked singlesided liquidity vs top 20 coins on sola at…" replaced by the CSV's "We are simply liquidity engineering. We are buying up lots of supply of this token, airdropping it as locked singlesided liquidity vs top 20 coins on solana at time of writing to a list of people who supported stacc.sol v1 and participated in oursum.lol airdrop and a few of the top traders by pnl on solana. Herein, this supply is untouchable unless people buy it from the raydium clmm curves - it's not exactly 'locked forever,' but some/most of it is, in all practical sense. This is the natural evolution of 1gm.app which has been more or less retired in favor of LIQENG.".
- backtest2 row 242: name "TERMITE THE FILIBUSTER" replaced by the CSV's "TERMINATE THE FILIBUSTER".
- backtest2 row 242: description "John Thune should t allow the United States Sete to 'leave town' until it passes The Save America Act or, far better still, TERMITES THE FILIBUSTER...' …" replaced by the CSV's "\"John Thune should not allow the United States  Senate to 'leave town' until it passes The Save America Act or, far better still, TERMINATES THE FILIBUSTER...\" - President Donald J. Trump".
- backtest2 row 244: description "There can be  crypto bull market without BitBoy. 65% supply and creator fees is reserved for Bitboy." replaced by the CSV's "There can be no crypto bull market without BitBoy. 65% supply and creator fees is reserved for Bitboy.".
- backtest2 row 248: description "coldest nigga breathing ...( we love you ansem )" replaced by the CSV's "coldest nigga breathing  ...( we love you ansem )".
- backtest2 row 248: creatorLink "https://x.com/blkiz06" replaced by the CSV's "https://x.com/blknoiz06".
- backtest2 row 252: mint "2Eh7NWE9EzhDaHy9GQVYMeU3yTr7mCSCTkLsAxpump" replaced by the CSV's "2Eh7NWE9EzhDaHy9GQVYMeU3yTNAr7mCSCTkLsAxpump" (the sheet's is it with characters missing).
- backtest2 row 255: description "$FLAVE is an apparition from the deep dark - part relic, part sigl, part living myth. It does t speak clearly." replaced by the CSV's "$FLAVE is an apparition from the deep dark - part relic, part signal, part living myth. It does not speak clearly.".
- backtest2 row 258: mint "2sx9fmNctZGdfrQmzHVLR18eHw8GxpnwDpLmJJpump" replaced by the CSV's "2sx9fmNctZGdfrQmzHVLR18enaHw8GxpnwDpLmJJpump" (the sheet's is it with characters missing).
- backtest2 row 260: name "Bitcoin on Sola" replaced by the CSV's "Bitcoin on Solana".
- backtest2 row 263: description "Kela was born from a glitch  one could erase - a bright error left alive inside a dark system." replaced by the CSV's "Kela was born from a glitch no one could erase - a bright error left alive inside a dark system.".
- backtest2 row 267: description "Sola soldiers rollcall" replaced by the CSV's "Solana soldiers rollcall".
- backtest2 row 267: mint "6dMydAmqtLsMtn9WZQW7stGqs4VkZ79pFPP1vbpump" replaced by the CSV's "6dMydAmqtLsMtn9WZQW7stGqs4VkZ79pFPP1vbnApump" (the sheet's is it with characters missing).
- backtest2 row 272: creatorLink "https://x.com/genyratiol/status/2078802887099244552" replaced by the CSV's "https://x.com/genyrational/status/2078802887099244552".
- backtest2 row 272: mint "3ujG4J8UVbyi5Kke7cZVe3qRirnbQvup9TtmBdpump" replaced by the CSV's "3ujG4J8UVbyi5Kke7cZVe3qRirnbQvnAup9TtmBdpump" (the sheet's is it with characters missing).
- backtest2 row 275: creatorLink "https://x.com/blkiz06/status/2077478413539869081" replaced by the CSV's "https://x.com/blknoiz06/status/2077478413539869081".
- backtest2 row 276: mint "AGpsaUA2cZnhUFeFDKAiv2TXZc1UWqijf6ms2ypump" replaced by the CSV's "AGpsaUA2cZnhUFeFDKAiv2TXZc1UWqnaijf6ms2ypump" (the sheet's is it with characters missing).
- backtest2 row 279: description "Bull In Hood is the mysterious bull who says thing, watches everything, and appears exactly when the timeline needs a new main character." replaced by the CSV's "Bull In Hood is the mysterious bull who says nothing, watches everything, and appears exactly when the timeline needs a new main character.".
- backtest2 row 281: description "Elon is The Bull Father. Every meme kws the me." replaced by the CSV's "Elon is The Bull Father. Every meme knows the name.".
- backtest2 row 281: creatorLink "https://x.com/USroldcarter" replaced by the CSV's "https://x.com/USronaldcarter".
- backtest2 row 282: description "$BMND is a private neural network w in devolopment. The first public wave will t open instantly: access will be distributed by mail to registered users." replaced by the CSV's "$BMND is a private neural network now in devolopment. The first public wave will not open instantly: access will be distributed by mail to registered users.".
- backtest2 row 284: creatorLink "https://x.com/quantistheme/status/2073440162554556743" replaced by the CSV's "https://x.com/quantisthename/status/2073440162554556743".
- backtest2 row 287: description "cash cupsey riding the biggest cash tokens on sola" replaced by the CSV's "cash cupsey riding the biggest cash tokens on solana".
- backtest2 row 289: description "USPR — the United States Power Reserve. AI is the hungriest machine ever built. The grid is the trade. A meme, on Sola." replaced by the CSV's "USPR — the United States Power Reserve. AI is the hungriest machine ever built. The grid is the trade. A meme, on Solana.".
- backtest2 row 291: ticker "DOLT" replaced by the CSV's "DONALT".
- backtest2 row 291: description "You didn't see the duck coming. body ever does. The timeline is crying. Portfolios are down 70%. The group chat is dead silent. Then, a duck waddles in. Clim…" replaced by the CSV's "You didn't see\nthe duck coming.\nNobody ever does.\n\nThe timeline is crying. Portfolios are down 70%. The group chat is dead silent. Then, a duck waddles in. Climbs on the bull. Flexes. And rides.\n\nWhile everybody else was watching the “lions” and the “wolves” — the guys who sound dangerous and call themselves killers — the duck was in the gym.\n\nQuietly. Every single day. No progress pics. No \"grind don't stop\" captions. Just the duck, the weights, and the charts. By the time the bull appeared, the duck was ready.\n\nSomeone says the duck is the dumbest thing they've ever seen. The duck doesn’t respond. The duck is up 4x.".
- backtest2 row 292: description "The empty-wallet bull with thing left to lose." replaced by the CSV's "The empty-wallet bull with nothing left to lose.".
- backtest2 row 296: description "Nimis, Amsterdam’s beloved “police cat,” proudly patrols the city’s historic cals while keeping a watchful eye on locals and visitors alike." replaced by the CSV's "Nimis, Amsterdam’s beloved “police cat,” proudly patrols the city’s historic canals while keeping a watchful eye on locals and visitors alike.".
- backtest2 row 298: description "Built Under Pressure. Built to Hold. The Diamond Bull doesn't flinch. It doesn't fold. It just charges forward — quietly, permanently — through every wick the …" replaced by the CSV's "Built Under Pressure.\nBuilt to Hold.\nThe Diamond Bull doesn't flinch. It doesn't fold. It just charges forward — quietly, permanently — through every wick the chart prints.".
- backtest2 row 299: description "#XIANBA: The Million-Dollar Legend of a Stray Cat! Can a cat rescued from the trash on a rainy night bring the entire fincial world to its knees? Yes. 82-yea…" replaced by the CSV's "#XIANBA: The Million-Dollar Legend of a Stray Cat!\nCan a cat rescued from the trash on a rainy night bring the entire financial world to its knees? Yes.\n82-year-old Grandpa Long living in China is handing over his jaw-dropping fortune under one condition:\n👉 \"All my money will belong to whoever cares for my cat, Xianba, as their own child for life.\"\nFinanciers in suits called this \"madness.\"\nAs for us, we launched the legend that will turn into the opportunity of a lifetime!\nA multi-million-dollar fortune, pure FOMO, and the power of the community are right behind us.\nSo, are you ready to become the new guardian of the Millionaire Cat, Xianba?\n🔥 Join Now | Fill Your Wallet | Be Part of the Legend".
- backtest2 row 300: mint "HJ1Ry6iJyAqN7jozMTErJHu66kpkDkowi7fhCRpump" replaced by the CSV's "HJ1Ry6iJyAqN7jozMTErJHuNA66kpkDkowi7fhCRpump" (the sheet's is it with characters missing).
- backtest2 row 301: description "$ROBINJACK — The Legend of Sherwood Reborn on Blockchain. Inspired by the Robinhood Chain movement. A community-powered uprising to reclaim fincial freedom. …" replaced by the CSV's "$ROBINJACK — The Legend of Sherwood Reborn on Blockchain.  \n\nInspired by the Robinhood Chain movement. A community-powered uprising to reclaim financial freedom. No insiders. No bullshit. Just pure solidarity.  Stand tall. Take your place. Let’s take the forest back.".
- backtest2 row 303: description "Establishing the World's Premier Ethereum Treasury. BitMine (BMNR) is a pioneering digital asset platform dedicated to maximizing ETH per share and advancing t…" replaced by the CSV's "Establishing the World's Premier Ethereum Treasury.\n\nBitMine (BMNR) is a pioneering digital asset platform dedicated to maximizing ETH per share and advancing the Ethereum ecosystem through strategic treasury management and native protocol participation.\n\nSecuring the global Ethereum ecosystem.\n\nOur strategic treasury management enhances shareholder value over the long term while also reinforcing the security and resilience of the global Ethereum network.".
- backtest2 row 304: mint "DGqcaiEscD7A7Jkyu84UDCwc9t7krQhDk3XAKXpump" replaced by the CSV's "DGqcaiEscD7A7JkyunA84UDCwc9t7krQhDk3XAKXpump" (the sheet's is it with characters missing).
- backtest2 row 306: ticker "PORTY" replaced by the CSV's "PORTNOY".
- backtest2 row 307: description "Born from rebellion, spread by community.  promises. Just consequence. #TEFT # TEFTLEGION" replaced by the CSV's "Born from rebellion, spread by community.\nNo promises. Just consequence. #TEFT # TEFTLEGION".
- backtest2 row 308: mint "CZSJaDpGigeprcSvdmtq3ePQPo3ZNYJeEvMDxBpump" replaced by the CSV's "CZSJaDpGigeprcSvdmtq3ePQPo3ZNYJeNoEvMDxBpump" (the sheet's is it with characters missing).
- backtest2 row 311: ticker "Soladier" replaced by the CSV's "Solanadier".
- backtest2 row 311: name "Sola soldiers" replaced by the CSV's "Solana soldiers".
- backtest2 row 311: description "Sola soldiers rollcall" replaced by the CSV's "Solana soldiers rollcall".
- backtest2 row 311: creatorLink "https://x.com/sola/status/2077453303500145141" replaced by the CSV's "https://x.com/solana/status/2077453303500145141".
- backtest2 row 312: ticker "MA" replaced by the CSV's "MANA".
- backtest2 row 312: name "MA MA" replaced by the CSV's "MANA MANA".
- backtest2 row 312: description "Ma Ma (ba dee bedebe) Ma ma (ba debe dee) Ma Ma (ba dee bedebe badebe badebe dee dee de-de de-de-de) ——————————————— Ma.mama  ma ma mwomp Ma …" replaced by the CSV's "Mana Mana\n(ba dee bedebe)\nMana mana\n(ba debe dee)\nMana Mana\n(ba dee bedebe badebe badebe \ndee dee de-de de-de-de)\n———————————————\n\nMa.mama na mana ma namwomp\nMa mo mo mana mo\nMana mana\n(ba dee bedebe)\nMana Mana!".
- backtest2 row 314: creatorLink "https://x.com/ScamcoifSOL" replaced by the CSV's "https://x.com/ScamcoinofSOL".
- backtest2 row 315: description "BeeCoon is a premium Sola tap-mining game. Harvest raw Wax, refine it into $HONEY, and claim your share of on-chain SOL prize pools. Fixed 1B supply, server-…" replaced by the CSV's "BeeCoon is a premium Solana tap-mining game. Harvest raw Wax, refine it into $HONEY, and claim your share of on-chain SOL prize pools. Fixed 1B supply, server-verified, non-custodial. Extract the wealth of the hive. 🍯".
- backtest2 row 316: description "He was supposed to have 9 lives. w he's on his tenth. Catjak is immortal." replaced by the CSV's "He was supposed to have 9 lives. Now he's on his tenth. Catjak is immortal.".
- backtest2 row 317: creatorLink "https://x.com/tisgambi/status/2081045680387416470?s=20" replaced by the CSV's "https://x.com/tisgambino/status/2081045680387416470?s=20".
- backtest2 row 317: mint "EZjCWZAf5rVMrEATVf6NpAnutDYHZdmBQZQXh2pump" replaced by the CSV's "EZjCWZAf5rVMrEATVf6NpNoAnutDYHZdmBQZQXh2pump" (the sheet's is it with characters missing).
- backtest2 row 321: description "$ROBINJACK — The Legend of Sherwood Reborn on Blockchain. Inspired by the Robinhood Chain movement. A community-powered uprising to reclaim fincial freedom. …" replaced by the CSV's "$ROBINJACK — The Legend of Sherwood Reborn on Blockchain.  \n\nInspired by the Robinhood Chain movement. A community-powered uprising to reclaim financial freedom. No insiders. No bullshit. Just pure solidarity.  Stand tall. Take your place. Let’s take the forest back.".
- backtest2 row 327: description "We aren't here to chase ather fleeting meta. We're here to give it a jawline. ANSOME turns raw on-chain momentum into institutiol-grade, community-backed l…" replaced by the CSV's "We aren't here to chase another fleeting meta. We're here to give it a jawline. ANSOME turns raw on-chain momentum into institutional-grade, community-backed liquidity. No VC handouts, no insider unlocks, no silent allocations — just a collective of delusional bulls who decided that if we're going to hold the line through the dips, we're going to look immaculate doing it. This is decentralized finance, re-architected with pure alpha energy.".
- backtest2 row 328: description "YMIR bridges real-world Bitcoin mining infrastructure with Sola. Built for long-term sustaibility through real mining operations, strategic buybacks, and t…" replaced by the CSV's "YMIR bridges real-world Bitcoin mining infrastructure with Solana. Built for long-term sustainability through real mining operations, strategic buybacks, and token burns.".
- backtest2 row 329: description "Iggy came into the trenches with Ansem and w we bring her back. Sending Mother 65% supply." replaced by the CSV's "Iggy came into the trenches with Ansem and now we bring her back. Sending Mother 65% supply.".
- backtest2 row 329: mint "7bRLkZEBjXhkuhz3CLzQ5wth2vLjT41MusuZVpump" replaced by the CSV's "7bRLkZEBjXhkunAhz3CLzQ5wth2vLjT41MusuZVpump" (the sheet's is it with characters missing).
- backtest2 row 330: description "Open beta amplifying $ANSEM holders. HBULL/SOL trading fees fund $ANSEM buybacks, paid as weekly yield to the ANSEM/HBULL pool. Supply 1,000,000,000, mint and …" replaced by the CSV's "Open beta amplifying $ANSEM holders. HBULL/SOL trading fees fund $ANSEM buybacks, paid as weekly yield to the  ANSEM/HBULL pool. Supply 1,000,000,000, mint and freeze authority revoked.".
- backtest2 row 332: creatorLink "https://x.com/genyratiol/status/2071995810586280252" replaced by the CSV's "https://x.com/genyrational/status/2071995810586280252".
- backtest2 row 333: description "Retro stalgia meets unstoppable blockchain energy. Join the legendary army chasing the ultimate green candle." replaced by the CSV's "Retro nostalgia meets unstoppable blockchain energy. Join the legendary army chasing the ultimate green candle.".
- backtest2 row 337: description "The baddest bull on Sola. Built for degens, fueled by memes, and backed by a community that never backs down. Charge first. Ask never." replaced by the CSV's "The baddest bull on Solana. Built for degens, fueled by memes, and backed by a community that never backs down. Charge first. Ask never.".
- backtest2 row 337: creatorLink "https://x.com/badbullsola" replaced by the CSV's "https://x.com/badbullsolana".
- backtest2 row 340: description "A stubborn little bull with a heavy stare, Bullrocky wanders through hand-drawn worlds collecting clues, recipes, songs, sketches and secrets. Every scene is a…" replaced by the CSV's "A stubborn little bull with a heavy stare, Bullrocky wanders through hand-drawn worlds collecting clues, recipes, songs, sketches and secrets. Every scene is another role. Every role is still Bullrocky.".
- backtest2 row 342: name "The Black Astrout" replaced by the CSV's "The Black Astronaut".
- backtest2 row 350: name "Sola Super Team" replaced by the CSV's "Solana Super Team".
- backtest2 row 350: description "the world has w summoned the sola superteam with badges" replaced by the CSV's "the world has now summoned the solana superteam with badges".
- backtest2 row 352: description "The queen has arrived on Sola, standing beside the Black Bull and rewarding the herd" replaced by the CSV's "The queen has arrived on Solana, standing beside the Black Bull and rewarding the herd".
- backtest2 row 353: description "The Legend of The Bull Frog While everyone else was busy chasing serious projects with complicated utility, one small frog decided to put on a giant bull helme…" replaced by the CSV's "The Legend of The Bull Frog\n\nWhile everyone else was busy chasing serious projects with complicated utility, one small frog decided to put on a giant bull helmet.\n\nThey laughed. They doubted. They asked, \"Why does a frog need bull horns?\"\n\nNobody knew. Not even Pepe. But one thing was absolutely certain: The frog was bullish, the bull was highly confused, and somehow... the market followed.\n\nThere are no impossible promises here. Just a legendary frog, a ridiculous helmet, and a community that believes the funniest meme wins.".
- backtest2 row 354: creatorLink "https://x.com/ket_on_sola" replaced by the CSV's "https://x.com/ket_on_solana".
- backtest2 row 355: description "Ansem keeps saying he's assembling a team to bring the Sola trenches back, yet there still isn't a coin representing that rrative." replaced by the CSV's "Ansem keeps saying he's assembling a team to bring the Solana trenches back, yet there still isn't a coin representing that narrative.".
- backtest2 row 355: creatorLink "https://x.com/Supermanchain/status/2071800428245979626" replaced by the CSV's "https://x.com/Supermanonchain/status/2071800428245979626".
- backtest2 row 358: description "https://x.com/ansumsola" replaced by the CSV's "https://x.com/ansumsolana".
- backtest2 row 358: creatorLink "https://x.com/ansumsola" replaced by the CSV's "https://x.com/ansumsolana".
- backtest2 row 361: ticker "Clowld" replaced by the CSV's "Clownald".
- backtest2 row 361: name "Clowld" replaced by the CSV's "Clownald".
- backtest2 row 364: name "Alos" replaced by the CSV's "Analos".
- backtest2 row 365: mint "CPqq4MNSgHBcujn4dFg75BHLY4B1gTv3QHY593pump" replaced by the CSV's "CPqq4MNSgHBcujn4dFg75BHLY4B1gTv3QHY59Na3pump" (the sheet's is it with characters missing).
- backtest2 row 368: name "Ske OS" replaced by the CSV's "Snake OS".
- backtest2 row 368: description "The kia 3310 is back — on Sola. We used to play Ske. w it does everything. 🐍 Play Ske, go 1v1, run Challenges, enter Tourments — with custom skins…" replaced by the CSV's "The Nokia 3310 is back — on Solana.\n\nWe used to play Snake. Now it does everything.\n\n🐍 Play Snake, go 1v1, run Challenges, enter Tournaments — with custom skins and arenas.\n📈 Trade any SPL token — memes, stocks, majors. Filter migrations, catch trending & boosted coins, see what KOLs are buying.\n🔮 Snake Oracle — scan CAs and get AI-powered market insights on demand.\n📡 Full perp intel — Hyperliquid & Solana data, smart money, whale positions, live liquidations.\n💬 Chat, browse CT feed, join communities.\n🎨 Customize your Nokia shell, PFP, and in-app items — buy with SOL or $SKR.\n\nPhantom verified. Solana Mobile dApp Store. Every wallet. One shell.\n\n$3310 — indestructible then. Unstoppable now.".
- backtest2 row 368: creatorLink "https://twitter.com/SkeOS_SOL" replaced by the CSV's "https://twitter.com/SnakeOS_SOL".
- backtest2 row 370: ticker "LEMODE" replaced by the CSV's "LEMONADE".
- backtest2 row 370: name "lemode coin" replaced by the CSV's "lemonade coin".
- backtest2 row 370: mint "GArCT1q33VLSLw86r8jztwBFDWThVhjNj4FtY2pump" replaced by the CSV's "GArCT1qNa33VLSLw86r8jztwBFDWThVhjNj4FtY2pump" (the sheet's is it with characters missing).
- backtest2 row 378: description null replaced by the CSV's "$CHOCI — Street Cookie Gang 🥠\n\nBorn in the oven, raised on the streets. \nSignature green beanie, hoodie full of dough stains, and heavy chain. \n\nCute but savage. Small cookie, massive gains.\n\nBaked Different.".
- backtest2 row 379: description "NEXRUNE is the internet's first forgotten rune - a symbol with  kwn creator that keeps resurfacing across the web" replaced by the CSV's "NEXRUNE is the internet's first forgotten rune - a symbol with no known creator that keeps resurfacing across the web".
- backtest2 row 381: description "$USWR | Tokenized exposure to the future of clean water infrastructure. As AI demand and global shortages rise, clean water becomes the world's most valuable r…" replaced by the CSV's "$USWR | Tokenized exposure to the future of clean water infrastructure. As AI demand and global shortages rise, clean water becomes the world's most valuable resource. Control the reserve. Control the future.".
- backtest2 row 381: mint "kQAUziZ1smycM7VkFoBuyTP49uo4kbJUUcAirpump" replaced by the CSV's "kQANAUziZ1smycM7VkFoBuyTP49uo4kbJUUcAirpump" (the sheet's is it with characters missing).
- backtest2 row 384: description "Just a good boy who found the best mango of his life and isn't sharing it with anyone.  utility,  roadmap,  promises — just a very happy dog and a very j…" replaced by the CSV's "Just a good boy who found the best mango of his life and isn't sharing it with anyone. No utility, no roadmap, no promises — just a very happy dog and a very juicy mango. Sometimes that's all you need.\n\nWAGMI, one bite at a time.".
- backtest2 row 386: creatorLink "https://x.com/dowonsola?s=11" replaced by the CSV's "https://x.com/dowonsolana?s=11".
- backtest2 row 388: description "$CHOCI — Street Cookie Gang 🥠 Born in the oven, raised on the streets. Sigture green beanie, hoodie full of dough stains, and heavy chain. Cute but savage. …" replaced by the CSV's "born to charge, built to pump. No brakes, no fear, just green candles and unstoppable bull energy.".
- backtest2 row 397: name "Holy Gabba" replaced by the CSV's "Holy Gabbana".
- backtest2 row 397: description "John Gaba, the legendary viral Boonk Gang from 2017 who broke the internet with billions of views. Onboarded with CA in bio, fees directed to him." replaced by the CSV's "John Gabana, the legendary viral Boonk Gang from 2017 who broke the internet with billions of views. Onboarded with CA in bio, fees directed to him.".
- backtest2 row 398: ticker "VER" replaced by the CSV's "VERNA".
- backtest2 row 398: name "Vercular LLM" replaced by the CSV's "Vernacular LLM".
- backtest2 row 398: description "Open AI model, the community votes the behavior, every vote on Sola" replaced by the CSV's "Open AI model, the community votes the behavior, every vote on Solana".
- backtest2 row 398: creatorLink "https://x.com/VercularLLM" replaced by the CSV's "https://x.com/VernacularLLM".
- backtest2 row 401: description "Rowing into the next round vulland" replaced by the CSV's "Rowing into the next round  vulland".
- backtest2 row 404: name "The Origil Bull" replaced by the CSV's "The Original Bull".
- backtest2 row 410: description "King Monkey Ansem Wukong is a legendary meme warrior, bringing unstoppable Sola energy, fearless vibes, and moon-bound chaos." replaced by the CSV's "King Monkey Ansem Wukong is a legendary meme warrior, bringing unstoppable Solana energy, fearless vibes, and moon-bound chaos.".
- backtest2 row 412: description "Zigzag Oracle is a painted market prophet decoding symbols, colors, and chaos into $ZIGO sigls from the Pattern Wall." replaced by the CSV's "Zigzag Oracle is a painted market prophet decoding symbols, colors, and chaos into $ZIGO signals from the Pattern Wall.".
- backtest2 row 413: mint "Pc9vGv7fxp3QHHrGksq7snrB2pCBHmWzatEtYpump" replaced by the CSV's "Pc9vGv7fxp3QHHrGkNasq7snrB2pCBHmWzatEtYpump" (the sheet's is it with characters missing).
- backtest2 row 415: description "$CR7 - a Tribute to Cristia Roldo's Fil World Cup. Available on Phantom Wallet & Pump.fun." replaced by the CSV's "$CR7 - a Tribute to Cristiano Ronaldo's Final World Cup. Available on Phantom Wallet & Pump.fun.".
- backtest2 row 416: description "Welcome to the chaos, soldier! 🪖 This token is your front-row seat to the apocalypse. In a world where thing makes sense, at least your portfolio can. Forge…" replaced by the CSV's "Welcome to the chaos, soldier! 🪖 This token is your front-row seat to the apocalypse. In a world where nothing makes sense, at least your portfolio can. Forget moonshots—we're aiming for fallout shelters. Trade, hold, or just laugh at the madness as we meme our way through the end of days.".
- backtest2 row 417: name "Delusiol Bull" replaced by the CSV's "Delusional Bull".
- backtest2 row 417: description "The creator of the delusiol bull mindset." replaced by the CSV's "The creator of the delusional bull mindset.".
- backtest2 row 417: creatorLink "https://x.com/delusiol_bull" replaced by the CSV's "https://x.com/delusional_bull".
- backtest2 row 418: description "Small Spark. Massive Gains. ⚡ Sparky is the cutest chaotic flame on Sola. Born from a glitch, running faster than rugs with electric energy and big dreams. C…" replaced by the CSV's "Small Spark. Massive Gains. ⚡\n\nSparky is the cutest chaotic flame on Solana. \nBorn from a glitch, running faster than rugs with electric energy and big dreams.\n\nCatch the spark before it moons 🔥\n\n$SPARKY".
- backtest2 row 420: description "A blue farm-sign monster broke loose from wet emel, stole a biker chorus, and keeps melting because every bass te makes his cartoon blood run hot" replaced by the CSV's "A blue farm-sign monster broke loose from wet enamel, stole a biker chorus, and keeps melting because every bass note makes his cartoon blood run hot".
- backtest2 row 420: mint "6WqMsiCQtSziRQJfD5SC8nbZ16RW2bznYMVH5Mpump" replaced by the CSV's "6WqMsNoiCQtSziRQJfD5SC8nbZ16RW2bznYMVH5Mpump" (the sheet's is it with characters missing).
- backtest2 row 421: creatorLink "https://x.com/Supermanchain/status/2071810184570400962" replaced by the CSV's "https://x.com/Supermanonchain/status/2071810184570400962".
- backtest2 row 427: creatorLink "https://x.com/Supermanchain/status/2071840751504548015" replaced by the CSV's "https://x.com/Supermanonchain/status/2071840751504548015".
- backtest2 row 429: creatorLink "https://x.com/xhang_bince/status/2082091362241945924" replaced by the CSV's "https://x.com/xhang_binance/status/2082091362241945924".
- backtest2 row 434: description "The legendary BTC mascot is back 🟠₿. Bitty has returned angrier, stronger, and ready to lead the next Bitcoin meme cycle.  utility. Just pure orange energy." replaced by the CSV's "The legendary BTC mascot is back 🟠₿. Bitty has returned angrier, stronger, and ready to lead the next Bitcoin meme cycle. No utility. Just pure orange energy.".
- backtest2 row 435: name "The Sola Whale" replaced by the CSV's "The Solana Whale".
- backtest2 row 436: ticker "stalgia" replaced by the CSV's "nostalgia".
- backtest2 row 436: name "stalgia, man." replaced by the CSV's "nostalgia, man.".
- conflict: BIGTROUT is backtest2 row 276 (viral: x.com/pusholder/status/2079311468231545077) and backtest3 row 74 (no viral origin). The founders' rule: viral only if that post came before the mint. It did not — posted 2026-07-20 21:04 UTC (from its id), minted 2026-06-30 19:22 UTC (first transaction on the chain), 20 days earlier. Both copies are left out.
- duplicate: bt2:20 (BANDOW) is the same coin as bt3:93, labelled the same (no viral origin); one copy kept, bt3:93.
- duplicate: bt2:34 (Jazz) is the same coin as bt3:394, labelled the same (no viral origin); one copy kept, bt3:394.
- duplicate: bt2:131 (JUNK) is the same coin as bt3:213, labelled the same (no viral origin); one copy kept, bt3:213.
- duplicate: bt2:184 (maxing) is the same coin as bt3:310, labelled the same (no viral origin); one copy kept, bt3:310.
- duplicate: bt2:205 (ARRR) is the same coin as bt3:165, labelled the same (no viral origin); one copy kept, bt3:165.
- duplicate: bt2:235 (TEMPURA) is the same coin as bt3:236, labelled the same (no viral origin); one copy kept, bt3:236.
- duplicate: bt2:267 (soltoly) is the same coin as bt3:214, labelled the same (no viral origin); one copy kept, bt3:214.
- duplicate: bt2:300 (ansembrain) is the same coin as bt3:203, labelled the same (no viral origin); one copy kept, bt3:203.
- duplicate: bt2:304 (Bullji) is the same coin as bt3:401, labelled the same (no viral origin); one copy kept, bt3:401.
- duplicate: bt2:308 (MENSAHOOD) is the same coin as bt3:369, labelled the same (no viral origin); one copy kept, bt3:369.
- duplicate: bt2:329 (MOTHER) is the same coin as bt3:83, labelled the same (no viral origin); one copy kept, bt3:83.
- duplicate: bt2:365 (MOOBULL) is the same coin as bt3:295, labelled the same (no viral origin); one copy kept, bt3:295.
- duplicate: bt2:381 (USWR) is the same coin as bt3:148, labelled the same (no viral origin); one copy kept, bt3:148.
- duplicate: bt2:413 (USOX) is the same coin as bt3:412, labelled the same (no viral origin); one copy kept, bt3:412.
- origins: tiktok post 11, none 772, x post 61, instagram post 5, instagram account 1.
- backtest2 row 1: https://vm.tiktok.com/ZN8eU5Cqw/ expanded to https://www.tiktok.com/@cazy.chan/video/7658657103057308942.
- backtest2 row 45: https://vm.tiktok.com/ZN8eUjnfM/ expanded to https://www.tiktok.com/@ivyvibing/video/7500005956563160366.
- backtest2 row 62: https://vm.tiktok.com/ZN8eU7Shh/ expanded to https://www.tiktok.com/@meimeiwarrior/photo/7565704323678702850.
- backtest2 row 171: https://vm.tiktok.com/ZN8eyhVNH/ expanded to https://www.tiktok.com/@sosspritee/video/7666628409451121934.
- backtest2 row 220: https://vm.tiktok.com/ZN8eySpyp/ expanded to https://www.tiktok.com/@stunna.nj/video/7667240394891005198.
- backtest2 row 252: https://vm.tiktok.com/ZN8ey8VwR/ expanded to https://www.tiktok.com/@drerivera6/video/7666851277107776798.
- backtest2 row 288: https://vm.tiktok.com/ZN8eykj3e/ expanded to https://www.tiktok.com/@speedvonandrea/video/7663039219471846669.
- backtest2 row 295: https://vm.tiktok.com/ZN8eyFsVf/ expanded to https://www.tiktok.com/@kinqspade69/video/7605892075527195918.
- backtest2 row 296: https://vm.tiktok.com/ZN8eyYYKQ/ expanded to https://www.tiktok.com/@dutchbreakingnews/video/7658171823556676897.
- backtest3 row 233: https://vm.tiktok.com/ZN8exCmF3/ expanded to https://www.tiktok.com/@michael_ovo/video/7645104036152134925.
- backtest3 row 307: https://vm.tiktok.com/ZN8exp9A6/ expanded to https://www.tiktok.com/@committee.of.affairs/video/7651009968115698966.
- the creator's link was the origin post on 21 of 78 viral coins (repaired links): bt2:4, bt2:28, bt2:72, bt2:76, bt2:111, bt2:133, bt2:145, bt2:155, bt2:242, bt3:34, bt3:82, bt3:86, bt3:91, bt3:122, bt3:127, bt3:155, bt3:201, bt3:219, bt3:223, bt3:274, bt3:327.

## Coins whose sheet date is off from the chain by more than a day (84)

Sheet times carry no time zone and the year was filled in by the spreadsheet; days are sheet minus chain.

| sheet | row | ticker | sheet | chain (UTC) | days |
|---|---|---|---|---|---|
| backtest2 | 10 | pisa down | 2026-07-03 19:09 | 2026-06-07 10:48 | +26.3 |
| backtest2 | 22 | TEDLY | 2026-07-13 03:07 | 2025-07-13 02:07 | +365.0 |
| backtest2 | 33 | POTO | 2026-07-22 18:30 | 2026-02-07 00:38 | +165.7 |
| backtest2 | 39 | CANCER | 2026-07-25 21:49 | 2026-04-29 22:11 | +87.0 |
| backtest2 | 41 | MRUG | 2026-07-09 01:45 | 2026-07-06 14:15 | +2.5 |
| backtest2 | 43 | MXI | 2026-07-23 20:21 | 2026-02-19 18:00 | +154.1 |
| backtest2 | 51 | USDT-TRC20 | 2026-11-23 20:13 | 2025-11-23 20:13 | +365.0 |
| backtest2 | 52 | DDP | 2026-07-18 11:30 | 2025-07-18 10:30 | +365.0 |
| backtest2 | 53 | e-CNY | 2026-07-25 20:22 | 2026-03-18 11:48 | +129.4 |
| backtest2 | 54 | SHIPS | 2026-07-23 11:09 | 2026-05-04 16:04 | +79.8 |
| backtest2 | 68 | BUCKARU | 2026-07-24 21:16 | 2026-02-10 18:55 | +164.1 |
| backtest2 | 69 | FreeMitch | 2026-07-08 13:10 | 2025-07-08 12:10 | +365.0 |
| backtest2 | 79 | FREESBF | 2026-03-08 23:00 | 2025-03-08 23:00 | +365.0 |
| backtest2 | 83 | RHOS | 2026-07-15 05:33 | 2026-07-13 23:19 | +1.3 |
| backtest2 | 85 | WOBBLE | 2026-07-22 16:37 | 2026-06-26 22:55 | +25.7 |
| backtest2 | 89 | lobokay | 2026-07-22 18:23 | 2026-02-27 21:34 | +144.9 |
| backtest2 | 92 | bold | 2026-06-30 17:59 | 2026-06-19 14:51 | +11.1 |
| backtest2 | 93 | VEL | 2026-07-22 19:10 | 2026-04-04 12:03 | +109.3 |
| backtest2 | 106 | KOBE | 2026-01-24 05:38 | 2025-01-24 05:38 | +365.0 |
| backtest2 | 146 | anyway | 2026-07-17 21:30 | 2024-07-17 20:30 | +730.0 |
| backtest2 | 162 | WEWON | 2026-09-06 21:45 | 2025-09-06 20:45 | +365.0 |
| backtest2 | 170 | ONE | 2026-07-24 22:21 | 2026-04-13 01:03 | +102.9 |
| backtest2 | 173 | IRAN | 2026-07-24 20:14 | 2026-03-25 13:41 | +121.3 |
| backtest2 | 186 | USDT | 2026-10-26 05:00 | 2024-10-26 04:00 | +730.0 |
| backtest2 | 191 | Mert | 2026-07-22 20:46 | 2026-06-28 18:50 | +24.1 |
| backtest2 | 223 | world | 2026-07-24 17:24 | 2026-06-24 12:33 | +30.2 |
| backtest2 | 225 | 🧲 | 2026-07-22 22:06 | 2026-06-28 16:22 | +24.2 |
| backtest2 | 233 | BIC | 2026-10-07 17:43 | 2025-10-07 16:43 | +365.0 |
| backtest2 | 234 | PVE | 2026-07-23 00:55 | 2026-07-15 19:13 | +7.2 |
| backtest2 | 240 | Aevon | 2026-07-23 01:13 | 2026-05-03 23:16 | +80.1 |
| backtest2 | 245 | Vortex | 2026-07-09 19:39 | 2026-07-06 21:20 | +2.9 |
| backtest2 | 246 | VRF | 2026-07-09 10:58 | 2026-07-07 16:01 | +1.8 |
| backtest2 | 268 | TFF | 2026-07-22 19:13 | 2026-05-05 15:21 | +78.2 |
| backtest2 | 277 | 🧲 | 2026-07-22 22:46 | 2026-06-19 17:10 | +33.2 |
| backtest2 | 286 | LAND | 2026-07-23 20:46 | 2026-07-21 09:20 | +2.5 |
| backtest2 | 303 | BitMine | 2026-07-23 03:13 | 2026-01-16 05:30 | +187.9 |
| backtest2 | 307 | TEFT | 2026-07-07 18:11 | 2025-07-07 17:11 | +365.0 |
| backtest2 | 312 | MANA | 2026-07-23 10:10 | 2025-07-23 09:10 | +365.0 |
| backtest2 | 314 | Scamcoin | 2026-06-30 09:27 | 2026-04-06 09:44 | +85.0 |
| backtest2 | 315 | HONEY | 2026-07-24 19:07 | 2026-07-03 08:42 | +21.4 |
| backtest2 | 326 | DWX | 2026-07-23 13:15 | 2026-03-01 07:31 | +144.2 |
| backtest2 | 407 | LOODY | 2026-07-27 23:05 | 2026-07-26 21:03 | +1.1 |
| backtest2 | 416 | WW3 | 2026-10-01 19:04 | 2024-10-01 18:04 | +730.0 |
| backtest2 | 419 | DOWGE | 2026-06-08 21:42 | 2025-06-08 20:42 | +365.0 |
| backtest3 | 3 | GIVVE | 2026-04-09 18:13 | 2025-04-09 17:13 | +365.0 |
| backtest3 | 4 | Bnut | 2026-07-22 21:51 | 2026-07-05 18:32 | +17.1 |
| backtest3 | 5 | ROVETAN | 2026-07-25 20:19 | 2026-05-06 14:31 | +80.2 |
| backtest3 | 6 | Smug | 2026-08-26 05:42 | 2025-08-26 04:42 | +365.0 |
| backtest3 | 14 | PIPI | 2026-07-07 20:52 | 2024-07-07 19:52 | +730.0 |
| backtest3 | 28 | Monke | 2026-06-02 13:07 | 2026-06-01 09:03 | +1.2 |
| backtest3 | 39 | Coin | 2026-07-30 16:23 | 2025-07-30 15:23 | +365.0 |
| backtest3 | 61 | HYPE | 2026-08-19 15:25 | 2025-08-19 14:25 | +365.0 |
| backtest3 | 63 | TCEE | 2026-11-11 06:16 | 2024-11-11 06:16 | +730.0 |
| backtest3 | 73 | ANSEM | 2026-07-22 22:03 | 2026-06-27 23:45 | +24.9 |
| backtest3 | 91 | MOODER | 2026-06-28 04:01 | 2026-05-20 16:14 | +38.5 |
| backtest3 | 105 | VORF | 2026-07-16 07:03 | 2026-06-20 13:22 | +25.7 |
| backtest3 | 112 | QF | 2026-12-12 08:09 | 2024-12-12 08:09 | +730.0 |
| backtest3 | 113 | CWN | 2026-06-08 09:42 | 2026-06-05 16:26 | +2.7 |
| backtest3 | 114 | SAINT | 2026-07-06 18:03 | 2026-06-22 02:19 | +14.7 |
| backtest3 | 115 | ALPACAS | 2026-06-19 23:58 | 2026-06-18 03:11 | +1.9 |
| backtest3 | 116 | 3KINGS | 2026-12-03 20:53 | 2024-12-03 20:53 | +730.0 |
| backtest3 | 118 | GREED III | 2026-02-20 01:39 | 2025-02-20 01:39 | +365.0 |
| backtest3 | 143 | AssetFunds | 2026-06-23 15:38 | 2026-06-06 18:14 | +16.9 |
| backtest3 | 215 | PNDZ | 2026-05-13 11:08 | 2025-05-13 10:08 | +365.0 |
| backtest3 | 216 | Maganomics | 2026-06-18 22:04 | 2024-06-18 21:04 | +730.0 |
| backtest3 | 220 | CRN | 2026-07-25 06:06 | 2026-05-03 09:40 | +82.9 |
| backtest3 | 231 | BIGRED | 2026-03-29 21:17 | 2025-03-29 21:17 | +365.0 |
| backtest3 | 238 | GPT-6 | 2026-07-22 21:04 | 2026-07-20 22:48 | +1.9 |
| backtest3 | 247 | IOS | 2026-07-25 18:35 | 2026-05-12 02:25 | +74.7 |
| backtest3 | 272 | LOAFTOKEN | 2026-10-14 20:31 | 2025-10-14 19:31 | +365.0 |
| backtest3 | 273 | Pearchua | 2026-05-29 00:17 | 2025-05-28 23:17 | +365.0 |
| backtest3 | 286 | SQRTR | 2026-07-24 04:06 | 2026-03-04 04:03 | +142.0 |
| backtest3 | 287 | UPPY | 2026-06-22 15:39 | 2026-06-21 15:25 | +1.0 |
| backtest3 | 310 | maxing | 2026-07-22 21:22 | 2026-04-05 04:01 | +108.7 |
| backtest3 | 312 | CHANNEL | 2026-07-02 12:26 | 2026-04-27 23:23 | +65.5 |
| backtest3 | 314 | WSOLP | 2026-06-16 13:32 | 2026-06-08 22:21 | +7.6 |
| backtest3 | 318 | SCD | 2026-07-24 19:49 | 2026-05-17 05:05 | +68.6 |
| backtest3 | 333 | ERA | 2026-07-24 20:03 | 2026-05-07 08:50 | +78.5 |
| backtest3 | 343 | Realized | 2026-07-28 00:37 | 2026-07-26 13:20 | +1.5 |
| backtest3 | 399 | Duffy | 2026-10-26 00:20 | 2025-10-25 23:20 | +365.0 |
| backtest3 | 403 | GDER | 2026-07-24 15:42 | 2026-04-08 16:19 | +107.0 |
| backtest3 | 418 | grok 4.5 | 2026-06-26 10:34 | 2025-06-26 09:34 | +365.0 |
| backtest3 | 423 | ELI | 2026-12-13 00:52 | 2024-12-13 00:52 | +730.0 |
| backtest3 | 425 | SPEEDRUN | 2026-07-03 14:04 | 2026-06-19 02:44 | +14.5 |
