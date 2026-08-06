# Merged Backtest Reveal Report (backtest2 + backtest3)

Generated: 2026-08-03T13:33:11.213Z
Rows: **866** (433 winners · 433 losers · 50.0% base rate)
Waves: backtest2 **436** · backtest3 **430**

> **Descriptive only — not statistically significant.** Case-control design. Small subgroups (especially viral-origin) cannot support strong inference. Cells flagged ⚠ when usable n<5.

## 1. Viral origin vs outcome group

Viral origin = row has a non-empty `post_url`.

| Metric | Value |
| --- | --- |
| Rows with viral origin | 79 (9.1% of 866) |
| └ X platform | 62 |
| └ Other platform | 17 |
| Viral + WINNER | **37** (46.8% of viral) |
| Viral + LOSER | **42** (53.2% of viral) |
| vs 50.0% base rate | -3.2 pts winner share |

### By wave

| Wave | Viral | Viral winners | Viral losers | Winner share |
| --- | ---: | ---: | ---: | ---: |
| backtest2 | 39 | 20 | 19 | 51.3% |
| backtest3 | 40 | 17 | 23 | 42.5% |

## 2. Judgement yes-rates — winners vs losers

Excludes `unclear` and blank. Judgement columns typically filled only where an origin was found.

| Feature | Winners yes-rate | n | Losers yes-rate | n | Δ (win−lose) |
| --- | ---: | ---: | ---: | ---: | ---: |
| one_word_name | 64.7% | 17 | 72.7% | 22 | -8.0 pts |
| has_character | 72.2% | 36 | 75.6% | 41 | -3.4 pts |
| works_as_photo | 80.6% | 36 | 82.5% | 40 | -1.9 pts |
| funny_not_serious | 44.4% | 36 | 29.3% | 41 | +15.2 pts |
| others_copying_it | 58.3% | 36 | 41.5% | 41 | +16.9 pts |
| crypto_noticed | 75.0% | 36 | 53.7% | 41 | +21.3 pts |
| ticker_in_replies | 52.9% | 17 | 27.3% | 22 | +25.7 pts |

### Viral-origin only

| Feature | Winner yes-rate | n | Loser yes-rate | n | Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| one_word_name | 64.7% | 17 | 72.7% | 22 | -8.0 pts |
| has_character | 72.2% | 36 | 75.6% | 41 | -3.4 pts |
| works_as_photo | 80.6% | 36 | 82.5% | 40 | -1.9 pts |
| funny_not_serious | 44.4% | 36 | 29.3% | 41 | +15.2 pts |
| others_copying_it | 58.3% | 36 | 41.5% | 41 | +16.9 pts |
| crypto_noticed | 75.0% | 36 | 53.7% | 41 | +21.3 pts |
| ticker_in_replies | 52.9% | 17 | 27.3% | 22 | +25.7 pts |

## 3. Enrichment & timing

| Metric | Value |
| --- | --- |
| Enriched successfully | 72 / 79 viral |
| Failed | 7 |
| Skipped | 0 |

Enrich methods (viral rows): syndication: 62 · tiktok_oembed: 10 · failed: 7

### author_followers (median, viral rows)

| Group | Median followers | n |
| --- | ---: | ---: |
| Viral winners | 1,415,425 | 27 |
| Viral losers | 1,240,773 | 35 |

### hours_post_to_launch (median)

| Group | Median hours | n |
| --- | ---: | ---: |
| Winners | 0.4 | 27 |
| Losers | 2.3 | 35 |
| Viral winners | 0.4 | 27 |
| Viral losers | 2.3 | 35 |

### media_type

| Group | Distribution |
| --- | --- |
| Winners | (blank): 401 · video: 16 · image: 11 · text: 5 |
| Losers | (blank): 393 · image: 19 · video: 14 · text: 7 |
| Viral winners | video: 16 · image: 11 · text: 5 · (blank): 5 |
| Viral losers | image: 19 · video: 14 · text: 7 · (blank): 2 |

### origin_platform (all rows)

| Platform | Winners | Losers |
| --- | ---: | ---: |
| instagram | 4 ⚠ n<5 | 2 ⚠ n<5 |
| tiktok | 5 | 5 |
| x | 28 | 34 |
| yes | 0 ⚠ n<5 | 1 ⚠ n<5 |
| (no platform) | 396 | 391 |

---
*Peak multiples and ATH mcap from Dune dex trades (v2 logic). Groups assigned at build time. Enrichment: syndication + X official fallback.*
