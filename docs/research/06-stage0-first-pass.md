# Stage 0, first pass — what the live data says

Measured 2 Aug 2026 against pump.fun's public coins endpoint. Two samples:
300 freshly-minted coins (a 14-minute window) and the top 1,050 coins by
current market cap (back to Jan 2024 — the endpoint's hard pagination ceiling).
Raw data in `data/`.

## 1. The mint stream is ~97% noise

~30,000 coins minted per day. Of 300 consecutive fresh mints:

| | |
|---|---|
| above $10K market cap | 1 (0.3%) |
| above $1K | 3 (1.0%) |
| above $100 | 8 (2.7%) |
| **median market cap** | **$28** |
| duplicate names | 174 of 300 |

`20% sent to fomo wallets` was minted 21 times, `cented you have supply on fomo`
14 times. 29 of 300 carried Discord links or "airdrop" in the description.

**Consequence: "a coin exists" is not a usable positive label.** Training on it
would produce a spam detector. The label has to be traction, and traction is
100–300x rarer than existence.

## 2. The metadata join covers 5% of winners, not 72%

Earlier research reported that ~72% of new pump.fun tokens declare their source
tweet, and concluded story-to-coin matching was mostly a deterministic SQL join.
That number was measured on **fresh mints**. Measured on **coins that worked**:

| population | has a source-post permalink |
|---|---|
| 300 fresh mints | 50% |
| top 1,050 by market cap | 13% |
| the 76 above $50K | **5%** |

The bots that dominate fresh mints auto-fill a twitter field; the humans who make
coins that succeed mostly do not. **The deterministic join is a minor path, not the
primary mechanism.** The four-signal matcher — temporal ordering, ticker, text,
image — carries the buy path after all.

Selection effect worth remembering: the population you measure on decides the
answer. Both figures are correct about different things.

## 3. Current market cap is the wrong label — and the reason is ugly

1033 of 1050 coins carry a usable all-time-high figure (16 are corrupted,
up to 2e23 — filter anything above $1B).

| | current | peak |
|---|---|---|
| median of the top 1,050 | $2,977 | $546,380 |
| count above $50K | 76 | 1033 |

**The median coin in the best 1,050 ever minted peaked near $546,380 and now sits
around $2,977.** They do not fail to get traction. They get it and then collapse,
typically by more than 99%.

Two consequences:

- **Label on peak, not current.** It yields ~13x more positives and it measures
  what actually happened rather than what survived.
- **The product has to be honest about this.** Insidor's record commits to showing
  whether being early paid. On this evidence the truthful answer for most stories
  is "it peaked within hours and gave it all back". A record that reports only
  whether a coin appeared, and not what it did afterwards, would be misleading.

## 4. What this changes in the plan

1. Positives = coins whose **peak** cleared a threshold, deduplicated by name.
2. Negatives = posts with very high reach and no matching coin. Low-reach posts
   prove nothing — absence may mean nobody saw it.
3. Story-to-coin matching cannot lean on the metadata link.
4. The corpus is small and clean: ~1,000 winners, not 30,000 mints a day. That is
   the right scale for nearest-neighbour retrieval rather than a trained classifier.

## 5. What this first pass cannot tell us

The pagination ceiling (~1,050) means this is the survivors' list by *current*
cap, so it skews recent — 202 coins from June 2026, 21 from January. Coins that
peaked and fully died are under-represented. Getting an unbiased history needs
the on-chain mint stream, not this endpoint.

**Not yet done:** resolving the 135 source posts and characterising what they
have in common. That is the part that tests whether "one nameable subject" holds.
